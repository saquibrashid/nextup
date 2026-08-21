/**
 * The Azure SQL connection settings and the driver adapter (TASK-141).
 *
 * WHY A DRIVER ADAPTER AT ALL
 * ---------------------------
 * `specs/security.md` §7 prefers managed identity: the container should hold
 * no database credential. Prisma's BUILT-IN `sqlserver` connector cannot do
 * that. It is the Rust `tiberius` driver, its URL grammar has no
 * `authentication=` parameter, and there is no way to hand it an Entra token
 * (prisma/prisma#12562, #13853, #7673 — all open). Passing a token as
 * `password=` does not work either; tiberius has a distinct AAD auth method
 * that Prisma's Node layer never invokes.
 *
 * `@prisma/adapter-mssql` runs the same queries through node `mssql`/`tedious`,
 * which DOES support Entra. Driver adapters are GA in Prisma 6.19 — no preview
 * flag — and `adapter-mssql` is published at our exact pinned version.
 *
 * ⚠ MIGRATIONS DELIBERATELY DO NOT USE THIS PATH. `prisma migrate deploy` in
 * `.github/workflows/deploy.yml` still runs on tiberius with the SQL admin
 * login, and that is correct rather than a leftover:
 *
 *   - it is a DEPLOY-time credential held as a GitHub secret and injected into
 *     a CI job. It never reaches the container, so the running app still holds
 *     zero database credentials — which is the whole point of §7;
 *   - migrations legitimately need more rights than the app (DDL), so a
 *     separate, more-privileged principal is what least privilege ASKS for;
 *   - it is the proven path. It has been applying `prisma/migrations/**`
 *     against the real Azure SQL Basic database on every deploy.
 *
 * Routing migrations through the adapter as well would mean enabling an
 * experimental `prisma.config.ts` schema engine to gain nothing and put the
 * one irreversible operation in the system on the newer code path.
 */

import { PrismaMssql } from '@prisma/adapter-mssql';
import type { config as MssqlConfig } from 'mssql';

/**
 * How the process proves who it is to Azure SQL.
 *
 * There are exactly two, and which one applies is DERIVED from the connection
 * string rather than configured separately — see {@link authModeFor}.
 */
export type SqlAuthMode = 'sql-login' | 'managed-identity';

/** The parts of a Prisma `sqlserver://` URL this application uses. */
export interface SqlConnectionSettings {
  server: string;
  port: number;
  database: string;
  /** Absent on the managed-identity path — that absence IS the mode. */
  user?: string;
  /** Absent on the managed-identity path. Never logged. */
  password?: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

/** Azure SQL's port. Fixed; the URL may omit it. */
const DEFAULT_SQL_PORT = 1433;

/**
 * Split on `;`, but not inside `{...}`.
 *
 * Prisma's SQL Server URL wraps values containing reserved characters in curly
 * braces, so a password may legitimately contain a semicolon. A naive
 * `split(';')` truncates such a password into a prefix, and the resulting
 * failure is a login error that names nothing about quoting.
 */
function splitParameters(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braced = false;

  for (const character of input) {
    if (character === '{') {
      braced = true;
    } else if (character === '}') {
      braced = false;
    } else if (character === ';' && !braced) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

/** Strip one layer of `{}` quoting from a parameter value. */
function unquote(value: string): string {
  return value.startsWith('{') && value.endsWith('}') && value.length >= 2
    ? value.slice(1, -1)
    : value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

/**
 * Parse a Prisma `sqlserver://host:port;key=value;…` URL.
 *
 * ⚠ This is NOT a standard URL and `new URL()` cannot read it — the parameters
 * are semicolon-separated, not a `?query`, so the whole parameter list would
 * land in the pathname and `database` would silently come back undefined.
 *
 * @throws if the URL is not a `sqlserver://` URL or names no database. Both are
 *   configuration errors that must fail loudly at startup rather than produce a
 *   client that connects to the wrong place.
 */
export function parseSqlServerUrl(url: string): SqlConnectionSettings {
  const prefix = 'sqlserver://';
  if (!url.startsWith(prefix)) {
    throw new Error(`DATABASE_URL must start with "${prefix}".`);
  }

  const [hostSegment = '', ...parameterSegments] = splitParameters(url.slice(prefix.length));

  const separator = hostSegment.lastIndexOf(':');
  const server = separator === -1 ? hostSegment : hostSegment.slice(0, separator);
  const portText = separator === -1 ? '' : hostSegment.slice(separator + 1);
  const port = portText === '' ? DEFAULT_SQL_PORT : Number(portText);

  if (server === '') {
    throw new Error('DATABASE_URL names no server.');
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`DATABASE_URL has an invalid port: "${portText}".`);
  }

  const parameters = new Map<string, string>();
  for (const segment of parameterSegments) {
    if (segment === '') continue;
    const equals = segment.indexOf('=');
    if (equals === -1) continue;
    parameters.set(
      segment.slice(0, equals).trim().toLowerCase(),
      unquote(segment.slice(equals + 1)),
    );
  }

  const database = parameters.get('database') ?? '';
  if (database === '') {
    throw new Error('DATABASE_URL names no database.');
  }

  const settings: SqlConnectionSettings = {
    server,
    port,
    database,
    // Azure SQL requires TLS and Prisma defaults `encrypt` to true, so the
    // default here must also be true. Defaulting to false would mean a URL
    // that omits it quietly downgrades the transport.
    encrypt: parseBoolean(parameters.get('encrypt'), true),
    trustServerCertificate: parseBoolean(parameters.get('trustservercertificate'), false),
  };

  const user = parameters.get('user');
  const secret = parameters.get('password');
  if (user !== undefined && user !== '') settings.user = user;
  if (secret !== undefined && secret !== '') settings.password = secret;

  return settings;
}

/**
 * Which auth mode a set of settings implies.
 *
 * ⚠ Derived from the presence of a credential, NOT from a separate switch.
 * A `NEXTUP_SQL_AUTH=managed-identity`-style flag can disagree with the URL,
 * and when it does the failure is a confusing login error rather than a
 * configuration error. Here the two cannot disagree: a URL with no credential
 * in it has nothing to authenticate with EXCEPT the managed identity.
 */
export function authModeFor(settings: SqlConnectionSettings): SqlAuthMode {
  return settings.user !== undefined && settings.password !== undefined
    ? 'sql-login'
    : 'managed-identity';
}

/**
 * Pool ceiling. Azure SQL Basic is 5 DTU and the container is 0.25 vCPU
 * (REQ-079), so this is bounded by the DATABASE, not by demand: a larger pool
 * against a 5-DTU database converts contention into timeouts.
 */
const MAX_POOL_CONNECTIONS = 5;

/**
 * ⚠ `min: 0` IS LOAD-BEARING ON THE MANAGED-IDENTITY PATH, not a tuning
 * choice. An Entra access token is acquired during LOGIN, so a connection that
 * is never closed is a connection that never re-authenticates. Letting idle
 * connections drain means every reconnection acquires a fresh token through
 * the credential — which is what makes token expiry a non-event here instead
 * of the overnight failure TASK-141 warns about.
 */
const MIN_POOL_CONNECTIONS = 0;

/**
 * Build the `mssql` configuration for these settings.
 *
 * On the managed-identity path this sets `azure-active-directory-default`,
 * which delegates token acquisition to `DefaultAzureCredential` — the same
 * credential type the blob store uses, so a Container App's system-assigned
 * identity works with no further configuration.
 *
 * ⚠ NOT `azure-active-directory-access-token`. That variant takes a token
 * STRING, which means the process fetches one token at startup and reuses it
 * for the life of the pool: it works perfectly all day and starts failing
 * about an hour after deploy, exactly the trap TASK-141 names. `-default`
 * hands the credential to the driver, which calls it per connection, so there
 * is no token lifetime for this code to know, cache, or get wrong.
 */
export function buildMssqlConfig(settings: SqlConnectionSettings): MssqlConfig {
  const mode = authModeFor(settings);

  const built: MssqlConfig = {
    server: settings.server,
    port: settings.port,
    database: settings.database,
    options: {
      encrypt: settings.encrypt,
      trustServerCertificate: settings.trustServerCertificate,
    },
    pool: {
      max: MAX_POOL_CONNECTIONS,
      min: MIN_POOL_CONNECTIONS,
    },
  };

  if (mode === 'sql-login') {
    built.user = settings.user;
    built.password = settings.password;
    return built;
  }

  built.authentication = { type: 'azure-active-directory-default', options: {} };
  return built;
}

/**
 * The Prisma driver-adapter factory for a connection URL.
 *
 * A FACTORY, not a connection: Prisma calls `connect()` itself, and on the
 * managed-identity path each of those connections authenticates afresh.
 */
export function createSqlAdapter(url: string): PrismaMssql {
  return new PrismaMssql(buildMssqlConfig(parseSqlServerUrl(url)));
}

/**
 * A redacted rendering of a connection URL, safe to log.
 *
 * `specs/security.md` §4 forbids logging credentials, and a connection failure
 * is exactly the moment somebody reaches for "just log the URL".
 */
export function describeConnection(settings: SqlConnectionSettings): string {
  return `${settings.server}:${settings.port}/${settings.database} (${authModeFor(settings)})`;
}
