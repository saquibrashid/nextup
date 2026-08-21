/**
 * Integration harness — a REAL `mcr.microsoft.com/mssql/server:2022-latest`
 * (`specs/testing.md` §3.3a). Nothing here is mocked, on purpose: the
 * properties under test are unique constraints, owner scoping and
 * transactions, and a mock cannot have any of them. A mocked "database" would
 * agree with whatever the code did.
 *
 * Bring the store up with `docker compose -f docker-compose.test.yml up -d`.
 */

import { PrismaClient } from '@prisma/client';

import { createPrismaClient, setPrisma } from '../../src/repository/client.js';
import { asOwnerId, type OwnerId } from '../../src/repository/ownerData.js';

/**
 * ⚠ The database name here MUST match the one CI creates (`nextup_test`,
 * `.github/workflows/ci.yml`), because CI creates it with
 * `COLLATE Latin1_General_100_BIN2` and a database created any other way
 * gets the server default, `SQL_Latin1_General_CP1_CI_AS`.
 *
 * On a default-collation database Prisma's `create()` joins its
 * `DECLARE @generated_keys table([id] NVARCHAR(200))` variable — which takes
 * the DATABASE DEFAULT collation — back against the BIN2 `[id]` column, and
 * every insert fails with **Msg 468, "Cannot resolve the collation conflict"**.
 * That surfaces as dozens of unrelated-looking integration failures pointing at
 * `ownerData.ts`, so it reads as an application bug rather than a
 * provisioning one. `T-INV-018a` is the test that names the real cause — if
 * it fails, fix the DATABASE, not the code.
 *
 * See `specs/data-model.md` §16.2.1 and `specs/testing.md` §17.
 */
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'sqlserver://localhost:1433;database=nextup_test;user=sa;password=Str0ng!Passw0rd_ci;trustServerCertificate=true';

let prisma: PrismaClient | undefined;

export function testPrisma(): PrismaClient {
  // ⚠ Built through `createPrismaClient` rather than `new PrismaClient(...)`
  // so the suite runs on the SAME driver the application ships (TASK-141).
  // The URL above carries `user`/`password`, so this resolves to the SQL-login
  // path — the managed-identity path needs Azure and cannot run in CI.
  prisma ??= createPrismaClient(TEST_DATABASE_URL);
  setPrisma(prisma);
  return prisma;
}

export async function closeTestPrisma(): Promise<void> {
  await prisma?.$disconnect();
  prisma = undefined;
  setPrisma(undefined);
}

/**
 * Truncate every table between tests.
 *
 * ⚠ This is TEST-HARNESS ONLY and must never be imitated in `apps/api/src/**`.
 * REQ-028 is soft-delete forever: there is no hard delete anywhere in the
 * application, and `T-INV-013`/`T-MIG-001` exist to keep it that way. The
 * order below is the reverse of the FK dependency order.
 */
export async function resetDatabase(db = testPrisma()): Promise<void> {
  await db.$executeRawUnsafe(`
    DELETE FROM candidate_source_image;
    DELETE FROM extraction_candidate;
    DELETE FROM uploaded_image;
    DELETE FROM batch_change;
    DELETE FROM suppression;
    DELETE FROM service_state;
    DELETE FROM service_listing;
    DELETE FROM removal_group;
    DELETE FROM title;
    DELETE FROM upload_batch;
  `);
}

/** Two owners, so every scoping assertion has something to leak *to*. */
export const OWNER_A: OwnerId = asOwnerId('owner-a');
export const OWNER_B: OwnerId = asOwnerId('owner-b');

let seq = 0;
export function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}

/**
 * A canonical work identity for a MATCHED title.
 *
 * ⚠ Must start with `tmdb:`. The `title_match_coherent` CHECK ties the four
 * match fields together: a `matched` title needs a non-null `tmdb_id`, a
 * `tmdb:`-prefixed work identity and a NULL `raw_extracted_text`. That
 * coherence is the point — a half-matched row is not a state the product has.
 */
export function workId(): string {
  seq += 1;
  return `tmdb:movie:${seq}`;
}

export function batchInput(overrides: Record<string, unknown> = {}) {
  return {
    id: id('batch'),
    mode: 'append-only',
    service: 'netflix',
    status: 'draft',
    ...overrides,
  };
}

export function titleInput(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: id('title'),
    workIdentity: workId(),
    state: 'active',
    matchState: 'matched',
    tmdbId: seq,
    tmdbMediaType: 'movie',
    ...overrides,
  };
}

export function listingInput(
  titleId: string,
  createdByBatchId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    listingId: id('listing'),
    titleId,
    service: 'netflix',
    state: 'active',
    dateAdded: new Date('2026-01-15'),
    createdByBatchId,
    ...overrides,
  };
}

export function suppressionInput(workIdentity: string, overrides: Record<string, unknown> = {}) {
  return {
    id: id('supp'),
    workIdentity,
    displayName: 'A Suppressed Work',
    ...overrides,
  };
}
