/**
 * Credential, auth-library and automation-dependency gate
 * (TASK-030 — `T-SEC-011`, `T-SEC-001`).
 *
 * Two absolutes meet here.
 *
 *   • **NFR-001 / ADR-0002 — nextup writes ZERO application auth code.**
 *     Identity is Container Apps built-in auth (Easy Auth); the app reads a
 *     header and consults an allow-list. There is no session, no password, no
 *     token minting and therefore no auth library. `T-SEC-011` asserts the
 *     absence, because "we didn't need one" degrades into "someone added one
 *     for a quick admin page" without a gate.
 *
 *   • **NFR-009 / NFR-010 / NG-1 — no streaming credentials, ever, and no
 *     automated request to a streaming service, ever.** Not an API, not
 *     scraping, not a headless browser. `T-SEC-001` asserts that no credential
 *     field, cookie jar or secret named for a streaming service exists in
 *     code, schema or config, and that no automation dependency has entered
 *     the runtime tree.
 *
 * ⚠ Three deliberate scoping decisions, each of which a "tidy-up" would undo:
 *
 *   1. **`playwright` and `@playwright/test` are legitimate DEV dependencies**
 *      — they run the e2e suite (`specs/testing.md`). They are forbidden only
 *      in `dependencies` / `optionalDependencies`, where they would ship. A
 *      blanket ban would delete the e2e suite; a blanket allow would let a
 *      headless browser reach production. The distinction is the whole check.
 *   2. **The word "password" is legitimate in the SQL connection string** —
 *      `DATABASE_URL` carries one, and Azure SQL has no other shape. The ban
 *      is on the application HANDLING a password: a password field on a
 *      document, a column, a hashing call, a login form.
 *   3. **Streaming-service names are legitimate as SERVICE ENUM VALUES** —
 *      `'netflix'` and `'max'` are first-class domain values (REQ-053). What
 *      is forbidden is a streaming-service *host*, *credential* or *cookie*.
 *
 * Usage: `node tools/check-no-credentials.mjs` → exit 0 clean, exit 1 findings.
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * T-SEC-011 — no auth library, no password handling
 * ------------------------------------------------------------------ */

/**
 * Packages that exist to do the job Easy Auth already does, or to handle a
 * password nextup never sees. Matched as whole package names (and their
 * scoped/suffixed variants) in ANY dependency field of ANY package.json —
 * including devDependencies, because a session library in devDependencies is
 * still a session library someone will import.
 */
export const FORBIDDEN_AUTH_PACKAGES = [
  /^passport(-.*)?$/,
  /^@?[\w-]*\/?passport-[\w-]+$/,
  /^jsonwebtoken$/,
  /^jose$/,
  /^next-auth$/,
  /^@auth\//,
  /^oidc-client(-ts)?$/,
  /^openid-client$/,
  /^@azure\/msal-[\w-]+$/,
  /^express-session$/,
  /^cookie-session$/,
  /^connect-[\w-]*session[\w-]*$/,
  /^bcrypt(js)?$/,
  /^argon2(-[\w-]+)?$/,
  /^scrypt(-[\w-]+)?$/,
  /^pbkdf2$/,
  /^lucia(-auth)?$/,
  /^@clerk\//,
  /^@supabase\/auth[\w-]*$/,
  /^firebase-admin$/,
  /^auth0(-.*)?$/,
  /^express-jwt$/,
  /^passport-jwt$/,
];

/**
 * Identifiers that mean the application is HANDLING a password or a
 * hand-rolled session, as opposed to merely naming one in a database URL.
 *
 * Each entry is anchored on a word boundary so `passwordless` and
 * `trustServerCertificate` do not trip it, and the connection-string form
 * `password=` is excluded by requiring an identifier-ish context.
 */
export const PASSWORD_HANDLING_PATTERNS = [
  {
    re: /\b(password|passwd|pwd)\s*:\s*(z\.)?string/i,
    why: 'declares a password field on a schema (NFR-001: nextup never sees a password)',
  },
  {
    re: /\b(passwordHash|password_hash|hashedPassword|salt(Rounds|ed(Password)?))\b/,
    why: 'handles a password hash (NFR-001: authentication is Easy Auth, ADR-0002)',
  },
  {
    re: /\b(hashPassword|comparePassword|verifyPassword|checkPassword)\s*\(/,
    why: 'implements password verification (ADR-0002: zero application auth code)',
  },
  {
    re: /\b(signIn|logIn|login)\s*\([^)]*\b(password|credentials)\b/i,
    why: 'implements a credential sign-in (ADR-0002: zero application auth code)',
  },
  {
    re: /\b(jwt\.sign|jwt\.verify|signJwt|createSession|issueToken|mintToken)\s*\(/,
    why: 'mints or verifies a session token (ADR-0002: Easy Auth owns identity)',
  },
  {
    re: /\bres\.cookie\s*\(/,
    why: 'sets an application cookie (ADR-0002: nextup holds no session)',
  },
];

/**
 * Column and field names that would put a credential in the datastore. Checked
 * against the Prisma schema and every migration.
 */
export const CREDENTIAL_COLUMN_PATTERNS = [
  /\b(password|passwd|pwd)\b/i,
  /\b(secret|credential|cookie_?jar|refresh_?token|access_?token|session_?token)\b/i,
  /\bapi_?key\b/i,
];

/* ------------------------------------------------------------------ *
 * T-SEC-001 — no streaming credential, no automation dependency
 * ------------------------------------------------------------------ */

/**
 * Streaming-service HOSTS. A hostname is unambiguous in a way a service name
 * is not: `'netflix'` is a sanctioned enum value (REQ-053), `netflix.com` in
 * source is an outbound destination and therefore NFR-010 non-compliance.
 */
export const STREAMING_HOSTS = [
  'netflix.com',
  'nflxvideo.net',
  'nflxext.com',
  'max.com',
  'hbomax.com',
  'play.hbomax.com',
  'hbo.com',
  'primevideo.com',
  'disneyplus.com',
  'hulu.com',
  'peacocktv.com',
  'paramountplus.com',
  'appletv.com',
];

/**
 * Credential and cookie-jar shapes named for a streaming service. These are
 * the ones that would appear if someone tried to "just log in once".
 */
export const STREAMING_CREDENTIAL_PATTERNS = [
  {
    re: /\b(NETFLIX|MAX|HBO|HULU|DISNEY|PRIME_?VIDEO)_(PASSWORD|USER(NAME)?|EMAIL|COOKIE|SESSION|TOKEN|API_?KEY|SECRET)\b/i,
    why: 'a credential named for a streaming service (NFR-009: nextup never holds streaming credentials)',
  },
  {
    re: /\b(netflix|hbomax|hulu)(Password|Cookie|Session|Credentials|Token)\b/i,
    why: 'a credential named for a streaming service (NFR-009)',
  },
  {
    re: /\bcookie_?jar\b/i,
    why: 'a cookie jar, which exists only to keep a session with someone else’s site (NFR-010)',
  },
];

/**
 * Automation packages. Forbidden in SHIPPING dependency fields only — see the
 * scoping note at the top: `playwright` in devDependencies IS the e2e suite.
 */
export const AUTOMATION_PACKAGES = [
  /^puppeteer(-.*)?$/,
  /^playwright(-.*)?$/,
  /^@playwright\//,
  /^selenium-webdriver$/,
  /^webdriverio$/,
  /^chrome-remote-interface$/,
  /^cheerio$/,
  /^jsdom$/,
  /^tough-cookie$/,
  /^fetch-cookie$/,
  /^http-cookie-agent$/,
];

/** Fields whose contents ship to production. */
const SHIPPING_FIELDS = ['dependencies', 'optionalDependencies'];
/** Every field, for packages banned outright. */
const ALL_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
]);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * The files that necessarily CONTAIN the forbidden strings: this checker and
 * its own test. A checker cannot name what it forbids without matching itself.
 *
 * ⚠ Keep this at exactly these two paths. Exempting "tests" as a class would
 * hand any future credential a place to hide.
 */
export const SELF_REFERENTIAL = new Set([
  'tools/check-no-credentials.mjs',
  'tests/infra/noCredentials.spec.ts',
]);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Transient scratch directories created by mutation tests in OTHER spec
      // files, which run in parallel in the same project. Walking them makes
      // this checker fail on a violation someone else deliberately planted.
      if (entry.name.startsWith('.tmp-')) continue;
      await walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const relTo = (root, p) => path.relative(root, p).split(path.sep).join('/');

/**
 * `password=` inside a SQL Server connection string is unavoidable and is NOT
 * the application handling a password. Strip those before pattern matching so
 * the check stays honest instead of being suppressed wholesale.
 */
function stripConnectionStrings(text) {
  return text
    .replace(/sqlserver:\/\/[^\s"'`]*/gi, 'sqlserver://<redacted>')
    .replace(/\bDATABASE_URL\s*=\s*["'][^"'\n]*["']/gi, 'DATABASE_URL="<redacted>"')
    .replace(/\bDATABASE_URL\s*=\s*[^\s]*/g, 'DATABASE_URL=<redacted>');
}

/** @returns {string[]} findings */
export function checkAuthPackages(file, pkg, rel) {
  const findings = [];
  for (const field of ALL_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (FORBIDDEN_AUTH_PACKAGES.some((re) => re.test(name))) {
        findings.push(
          `${rel}: ${field} contains auth library "${name}". nextup writes ZERO application auth code — identity is Container Apps Easy Auth (ADR-0002, T-SEC-011).`,
        );
      }
    }
  }
  return findings;
}

/** @returns {string[]} findings */
export function checkAutomationPackages(file, pkg, rel) {
  const findings = [];
  for (const field of SHIPPING_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (AUTOMATION_PACKAGES.some((re) => re.test(name))) {
        findings.push(
          `${rel}: ${field} contains browser-automation/scraping package "${name}". NFR-010 forbids automated requests to streaming services; automation tooling belongs in devDependencies for the e2e suite only (T-SEC-001).`,
        );
      }
    }
  }
  return findings;
}

/** @returns {string[]} findings */
export function checkSourceFile(text, rel) {
  const findings = [];
  const scrubbed = stripConnectionStrings(text);

  for (const { re, why } of PASSWORD_HANDLING_PATTERNS) {
    const m = scrubbed.match(re);
    if (m) findings.push(`${rel}: ${why} — matched "${m[0].trim()}" (T-SEC-011)`);
  }

  for (const { re, why } of STREAMING_CREDENTIAL_PATTERNS) {
    const m = scrubbed.match(re);
    if (m) findings.push(`${rel}: ${why} — matched "${m[0].trim()}" (T-SEC-001)`);
  }

  for (const host of STREAMING_HOSTS) {
    if (scrubbed.toLowerCase().includes(host)) {
      findings.push(
        `${rel}: references streaming-service host "${host}". nextup makes NO automated request to any streaming service — no API, no scraping, no headless browsing (NFR-010, NG-1, T-SEC-001).`,
      );
    }
  }

  return findings;
}

/** @returns {string[]} findings */
export function checkSchemaFile(text, rel) {
  const findings = [];
  const scrubbed = stripConnectionStrings(text);
  for (const line of scrubbed.split(/\r?\n/)) {
    // Prisma and SQL comments are documentation, not schema.
    const code = line.replace(/(--|\/\/).*$/, '');
    for (const re of CREDENTIAL_COLUMN_PATTERNS) {
      const m = code.match(re);
      if (m) {
        findings.push(
          `${rel}: schema declares credential-shaped field "${m[0]}". No credential is ever stored: streaming access is screenshots only (NFR-009), and service keys are Container Apps secrets (T-SEC-011).`,
        );
      }
    }
  }
  return findings;
}

/**
 * @param {string} [root] repository root; overridable so the mutation tests can
 *   point the walker at a scratch tree.
 * @returns {Promise<string[]>} findings
 */
export async function checkNoCredentials(root = ROOT) {
  const files = await walk(root);
  const findings = [];

  for (const file of files) {
    const rel = relTo(root, file);
    if (SELF_REFERENTIAL.has(rel)) continue;

    const base = path.basename(file);
    const ext = path.extname(file);

    if (base === 'package.json') {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        findings.push(`${rel}: is not valid JSON`);
        continue;
      }
      findings.push(...checkAuthPackages(file, pkg, rel));
      findings.push(...checkAutomationPackages(file, pkg, rel));
      continue;
    }

    if (ext === '.prisma' || ext === '.sql') {
      findings.push(...checkSchemaFile(readFileSync(file, 'utf8'), rel));
      continue;
    }

    if (SOURCE_EXT.has(ext) || base === '.env.example' || ext === '.env') {
      findings.push(...checkSourceFile(readFileSync(file, 'utf8'), rel));
    }
  }

  return findings;
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const findings = await checkNoCredentials();
  if (findings.length > 0) {
    console.error('Credential / auth-library check FAILED:\n');
    for (const f of findings) console.error(`  ✗ ${f}`);
    console.error(`\n${findings.length} finding(s). See specs/security.md §3 and §9, ADR-0002.`);
    process.exit(1);
  }
  console.log('Credential check passed: no auth library, no password handling,');
  console.log('no streaming credential, no shipping automation dependency.');
}
