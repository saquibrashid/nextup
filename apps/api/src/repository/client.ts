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

let client: PrismaClient | undefined;

/**
 * The process-wide client, created on first use.
 *
 * Lazy rather than eager because importing this module must not require a
 * reachable database: `T-SEC-021` and the unit suite import repository code
 * purely to inspect it, and a top-level connection attempt would make those
 * runs depend on a container being up.
 */
export function getPrisma(): PrismaClient {
  client ??= new PrismaClient({
    // `error` and `warn` only. See the note above on query logging.
    log: ['error', 'warn'],
  });
  return client;
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
