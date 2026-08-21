/**
 * The single Prisma client for the process (TASK-017).
 *
 * WHY A SINGLETON, AND WHY IT MATTERS HERE MORE THAN USUALLY
 * ----------------------------------------------------------
 * The container runs at 0.25 vCPU / 0.5 GiB (REQ-079) against Azure SQL Basic,
 * which is 5 DTU. Each `new PrismaClient()` opens its own connection pool, so a
 * second client is not a tidiness problem — it is a doubling of the connection
 * footprint against a database tier that has very little of it to give.
 *
 * Also note what is deliberately NOT here: no query logging of parameters. Row
 * data includes title text the owner uploaded, and `specs/security.md` §4
 * classifies that as never-logged. `log: ['query']` would put bound parameters
 * into stdout.
 */

import { PrismaClient } from '@prisma/client';

import { createSqlAdapter } from '../db/connection.js';

let client: PrismaClient | undefined;

/**
 * Build a client for an explicit connection URL.
 *
 * Exported so the integration harness builds its client the SAME way the
 * application does. That matters more than it looks: the adapter replaces the
 * query engine, so a harness that kept constructing `new PrismaClient({
 * datasources })` would be exercising tiberius while production runs
 * `mssql`/`tedious` — two different drivers with different type coercion and
 * different error shapes, and every integration test would still pass.
 */
export function createPrismaClient(url: string): PrismaClient {
  return new PrismaClient({
    adapter: createSqlAdapter(url),
    // `error` and `warn` only. See the note above on query logging.
    log: ['error', 'warn'],
  });
}

/**
 * The process-wide client, created on first use.
 *
 * Lazy rather than eager because importing this module must not require a
 * reachable database: `T-SEC-021` and the unit suite import repository code
 * purely to inspect it, and a top-level connection attempt would make those
 * runs depend on a container being up.
 */
export function getPrisma(): PrismaClient {
  client ??= createPrismaClient(requireDatabaseUrl());
  return client;
}

/**
 * ⚠ Read at CALL time, not at module load. Reading it at import time would
 * make merely importing repository code fail without a database configured,
 * which is the property the laziness above exists to preserve.
 */
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set.');
  }
  return url;
}

/** Test-suite hook: point the repository at a caller-owned client. */
export function setPrisma(next: PrismaClient | undefined): void {
  client = next;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
