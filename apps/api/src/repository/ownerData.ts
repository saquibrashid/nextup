/**
 * The owner-scoped data repository (TASK-017).
 *
 * =====================================================================
 * READ THIS BEFORE ADDING A METHOD
 * =====================================================================
 *
 * `ownerId` is the FIRST POSITIONAL PARAMETER of every function in this file,
 * without exception. That rule is compensating control #1 in
 * `specs/security.md` §3 (R3), and it exists because the datastore change from
 * Cosmos to Azure SQL gave up a real structural guarantee.
 *
 * Under Cosmos, `ownerId` was the partition key: a cross-owner read was not
 * merely refused, it was *inexpressible*. On Azure SQL, `owner_id` is an
 * ordinary column, so a query that forgets its `WHERE` clause returns another
 * owner's rows **at full speed, with no error, and with nothing in the log**.
 * Nothing about that failure looks like a failure.
 *
 * What is left is a signature and two tests:
 *
 *   - a required leading `ownerId` makes omitting it a COMPILE error;
 *   - `T-SEC-021` greps this directory for a Prisma call whose `where` omits
 *     `ownerId` and fails on a match;
 *   - `T-SEC-006` asserts `ownerId` is never accepted from a request.
 *
 * `specs/security.md` §3 states both tests are load-bearing and that weakening,
 * skipping or deleting either is a blocking review finding. That includes
 * "temporarily" adding a helper here that takes `ownerId` second, or building a
 * `where` object somewhere `T-SEC-021`'s grep cannot see it.
 *
 * WHY `OwnerId` IS BRANDED
 * ------------------------
 * A bare `string` first parameter is satisfied by any string, including the
 * `titleId` sitting in the next variable — argument-order mistakes between two
 * same-typed strings are exactly the class of bug the compiler is otherwise
 * blind to. The brand makes `getTitle(titleId, ownerId)` a type error rather
 * than a silent cross-owner read.
 *
 * WHY THERE IS NO `parseOrThrow` ON READS
 * ---------------------------------------
 * Prisma's generated types ARE the read contract (TASK-017). Re-validating
 * every row against a Zod schema on the way out would cost real CPU on a
 * 0.25-vCPU container to re-prove a property the database already enforces
 * through its CHECK constraints. Zod stays at the API boundary, where the data
 * is genuinely untrusted.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { TERMINAL_BATCH_STATUSES } from '@nextup/domain';

import { getPrisma } from './client.js';

/**
 * The authenticated owner's stable identity.
 *
 * Branded so it cannot be confused with any other string id. Mint one ONLY
 * from the authenticated principal (`specs/security.md` §3, control #2) —
 * never from a request body, query string or path parameter.
 */
export type OwnerId = string & { readonly __ownerId: unique symbol };

/** Mint an `OwnerId` from a verified principal. Auth middleware only. */
export function asOwnerId(verifiedPrincipal: string): OwnerId {
  if (verifiedPrincipal.length === 0) {
    throw new Error('ownerId cannot be empty');
  }
  return verifiedPrincipal as OwnerId;
}

/**
 * SQL Server's unique-violation error numbers.
 *
 * `2601` is raised by a unique *index* and `2627` by a unique *constraint* —
 * this schema produces both, so checking only one misses half the cases. These
 * are NOT interchangeable with PostgreSQL's `23505`, which appears in
 * superseded revisions of the specs (ADR-0005 Rev 3).
 */
export const SQL_UNIQUE_INDEX_VIOLATION = 2601;
export const SQL_UNIQUE_CONSTRAINT_VIOLATION = 2627;

/**
 * True when `error` is the database refusing a duplicate.
 *
 * Prisma normalises both numbers to `P2002`, but the raw number survives in
 * `meta` and the raw-SQL paths surface it directly, so both are accepted.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true;
  }
  const code = (error as { number?: unknown } | null)?.number;
  return code === SQL_UNIQUE_INDEX_VIOLATION || code === SQL_UNIQUE_CONSTRAINT_VIOLATION;
}

/**
 * Anything that can run a query: the client, or a transaction handle.
 *
 * Every method accepts one so a caller can compose several writes into ONE
 * transaction. Full-update batch close depends on this: it is transactional and
 * scoped to exactly one service (product invariant 3), and that is only
 * expressible if the repository can be pointed at a transaction.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

function db(tx?: Db): Db {
  return tx ?? getPrisma();
}

/* ------------------------------------------------------------------ *
 * upload_batch
 * ------------------------------------------------------------------ */

export async function createUploadBatch(
  ownerId: OwnerId,
  data: Omit<Prisma.UploadBatchUncheckedCreateInput, 'ownerId'>,
  tx?: Db,
) {
  return db(tx).uploadBatch.create({ data: { ...data, ownerId } });
}

export async function findUploadBatch(ownerId: OwnerId, id: string, tx?: Db) {
  return db(tx).uploadBatch.findFirst({ where: { ownerId, id } });
}

/**
 * Batches for one service, newest first.
 *
 * `findMany`, not `findUnique`: a unique lookup takes only the primary key, so
 * it CANNOT carry `ownerId` and would silently read across owners. Every
 * single-row read in this file is `findFirst` for that reason. Do not
 * "optimise" one back into `findUnique`.
 */
export async function listUploadBatches(ownerId: OwnerId, service: string, take = 50, tx?: Db) {
  return db(tx).uploadBatch.findMany({
    where: { ownerId, service },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/**
 * The owner's currently OPEN batch, if any (`specs/api.md` §5 "Open batches
 * per owner: 1", US-005 AC-5).
 *
 * "Open" is defined by exclusion, and that direction is deliberate. The three
 * TERMINAL statuses are `applied`, `undone` and `discarded`; every other
 * status is a batch the owner still has to resolve. Listing the open statuses
 * positively would mean a status added to `BATCH_STATUSES` later defaults to
 * CLOSED, letting a second batch open alongside it — the exact thing this
 * query exists to prevent. Defined negatively, a new status defaults to open,
 * which fails safe.
 *
 * ⚠ `extraction-failed` is OPEN. The batch retains its images and offers a
 * retry (US-006 AC-4), so the owner must discard or retry it before starting
 * another. Treating it as closed would strand the images behind a batch
 * nothing can reach.
 *
 * Not scoped to a service: the ceiling is one open batch per OWNER, not per
 * service, because a full-update batch reconciles a service against the whole
 * list and two concurrent batches could interleave (product invariant 3).
 */
export async function findOpenUploadBatch(ownerId: OwnerId, tx?: Db) {
  return db(tx).uploadBatch.findFirst({
    where: { ownerId, status: { notIn: [...TERMINAL_BATCH_STATUSES] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateUploadBatchStatus(
  ownerId: OwnerId,
  id: string,
  data: Pick<Prisma.UploadBatchUncheckedUpdateInput, 'status' | 'completedAt' | 'undoneAt'>,
  tx?: Db,
) {
  // `updateMany`, not `update`: `update` requires a unique selector and so
  // cannot be owner-scoped. A zero count means "not yours or not there" — the
  // caller must render that as 404, never 403 (NFR-008).
  return db(tx).uploadBatch.updateMany({ where: { ownerId, id }, data });
}

/* ------------------------------------------------------------------ *
 * title
 * ------------------------------------------------------------------ */

export async function createTitle(
  ownerId: OwnerId,
  data: Omit<Prisma.TitleUncheckedCreateInput, 'ownerId'>,
  tx?: Db,
) {
  return db(tx).title.create({ data: { ...data, ownerId } });
}

export async function findTitle(ownerId: OwnerId, id: string, tx?: Db) {
  return db(tx).title.findFirst({ where: { ownerId, id } });
}

/**
 * Active titles, newest-first by `sortDateAdded`.
 *
 * `sortDateAdded` is the EARLIEST date-added across the title's listings
 * (product invariant 6), computed on write — not `MIN()` at read time, which
 * would be unindexable. Newest-first is the confirmed default (REQ-038, A44).
 */
export async function listActiveTitles(
  ownerId: OwnerId,
  options: { take?: number; skip?: number; dir?: 'asc' | 'desc' } = {},
  tx?: Db,
) {
  const { take = 200, skip = 0, dir = 'desc' } = options;
  return db(tx).title.findMany({
    where: { ownerId, state: 'active' },
    // `id` breaks ties so paging is stable when several titles share a date.
    orderBy: [{ sortDateAdded: dir }, { id: dir }],
    take,
    skip,
  });
}

/**
 * ONE PAGE of the combined list (`specs/api.md` §6.2, TASK-033).
 *
 * Four things here are requirements rather than query-shaping choices:
 *
 * 1. **Suppressed works are excluded here, in the repository, never by the
 *    caller** (REQ-024). A route that filtered afterwards would return short
 *    pages and a wrong `nextCursor`, and any second caller that forgot the
 *    filter would silently re-show something the owner said they were not
 *    interested in.
 * 2. **Suppression is matched on `workIdentity`, never on a title id**
 *    (REQ-071, product invariant 1). A suppressed title that reappears in a
 *    later capture becomes a BRAND-NEW row (product invariant 7), so an
 *    id-keyed exclusion would work once and then quietly stop.
 * 3. **`badges` are the `active` listings only** (REQ-026). A removed
 *    listing's badge must be absent while the row itself survives.
 * 4. **Keyset pagination, never `OFFSET`** (`specs/data-model.md` §15.6).
 *
 * WHY THE ANTI-JOIN IS TWO QUERIES AND NOT RAW SQL
 * ------------------------------------------------
 * `suppression.work_identity` cannot carry a Prisma relation — it is not
 * unique, deliberately, because deactivated suppressions are retained forever
 * — so a single-statement `NOT EXISTS` would have to be `$queryRaw`. That is
 * the wrong trade here: `T-SEC-021` walks the AST of this directory and proves
 * every Prisma call binds `ownerId`, and it CANNOT see inside a raw SQL
 * string. Buying one round trip's worth of latency to keep the whole file
 * under that guarantee is worth it, and the suppression set is bounded by the
 * single owner's own "not interested" decisions.
 *
 * `take` is deliberately fetched as `limit + 1`: the extra row is how the
 * caller learns whether a next page exists without a `COUNT(*)`, which §3
 * forbids over an ever-growing history.
 */
export interface TitlePageOptions {
  limit: number;
  dir: 'asc' | 'desc';
  cursor?: { sortDateAdded: string; id: string } | undefined;
  services?: readonly string[];
  mediaType?: string | undefined;
}

export async function listTitlePage(ownerId: OwnerId, options: TitlePageOptions, tx?: Db) {
  const conn = db(tx);
  const { limit, dir, cursor, services = [], mediaType } = options;

  const suppressed = await conn.suppression.findMany({
    where: { ownerId, active: true },
    select: { workIdentity: true },
  });

  // The keyset predicate, spelled out because SQL Server has no row-value
  // comparison Prisma can express. `(sortDateAdded, id) < (@d, @id)` becomes
  // "an earlier date, OR the same date and a smaller id" — and the second
  // branch is what stops rows sharing a date from being skipped between pages.
  const before = dir === 'desc' ? 'lt' : 'gt';
  const keyset =
    cursor === undefined
      ? {}
      : {
          OR: [
            { sortDateAdded: { [before]: new Date(`${cursor.sortDateAdded}T00:00:00.000Z`) } },
            {
              sortDateAdded: new Date(`${cursor.sortDateAdded}T00:00:00.000Z`),
              id: { [before]: cursor.id },
            },
          ],
        };

  const rows = await conn.title.findMany({
    where: {
      ownerId,
      state: 'active',
      ...(suppressed.length > 0
        ? { workIdentity: { notIn: suppressed.map((s) => s.workIdentity) } }
        : {}),
      ...(mediaType === undefined ? {} : { tmdbMediaType: mediaType }),
      // A service filter selects titles HOLDING an active listing on one of
      // the named services. It deliberately does not narrow `badges` below:
      // filtering by Netflix must not hide the row's Max badge (REQ-032).
      ...(services.length > 0
        ? { listings: { some: { ownerId, state: 'active', service: { in: [...services] } } } }
        : {}),
      ...keyset,
    },
    orderBy: [{ sortDateAdded: dir }, { id: dir }],
    take: limit + 1,
    include: {
      listings: {
        where: { ownerId, state: 'active' },
        orderBy: [{ dateAdded: 'asc' }, { listingId: 'asc' }],
      },
    },
  });

  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function updateTitle(
  ownerId: OwnerId,
  id: string,
  data: Prisma.TitleUncheckedUpdateInput,
  tx?: Db,
) {
  return db(tx).title.updateMany({ where: { ownerId, id }, data });
}
/**
 * Titles whose TMDB metadata is older than the lazy-refresh horizon.
 *
 * ⚠ The caller supplies the cutoff from `TMDB_METADATA_MAX_AGE_DAYS`
 * (NFR-014, 183 days). It must NEVER be derived from the screenshot-retention
 * constant in `config.ts`, which is a different number for a different purpose
 * — the two must never be merged or cross-imported, and `T-INV-008` fails any
 * file that names both.
 *
 * This is a LAZY refresh, driven by a read of the row. It is not a scheduled
 * job, and it must not become one: no scheduler may change user-visible list
 * state (product invariant 5), and metadata-on-access is the sole exemption.
 */
export async function findTitlesWithStaleMetadata(
  ownerId: OwnerId,
  refreshedBefore: Date,
  take = 25,
  tx?: Db,
) {
  return db(tx).title.findMany({
    where: {
      ownerId,
      state: 'active',
      OR: [{ tmdbFetchedAt: null }, { tmdbFetchedAt: { lt: refreshedBefore } }],
    },
    take,
  });
}

/* ------------------------------------------------------------------ *
 * service_listing
 * ------------------------------------------------------------------ */

export async function createServiceListing(
  ownerId: OwnerId,
  data: Omit<Prisma.ServiceListingUncheckedCreateInput, 'ownerId'>,
  tx?: Db,
) {
  return db(tx).serviceListing.create({ data: { ...data, ownerId } });
}

export async function findServiceListing(ownerId: OwnerId, listingId: string, tx?: Db) {
  return db(tx).serviceListing.findFirst({ where: { ownerId, listingId } });
}

export async function listActiveListingsForTitle(ownerId: OwnerId, titleId: string, tx?: Db) {
  return db(tx).serviceListing.findMany({
    where: { ownerId, titleId, state: 'active' },
  });
}

/**
 * Soft-delete a listing.
 *
 * SOFT DELETE FOREVER (REQ-028, product invariant 4). There is no hard-delete
 * counterpart in this file and there must never be one: no TTL, no purge job,
 * no scheduled deletion anywhere. The *absence* of such a mechanism IS the
 * requirement, and `T-INV-013` / `T-MIG-001` guard it.
 */
export async function softDeleteServiceListing(
  ownerId: OwnerId,
  listingId: string,
  removal: { removedByBatchId: string; removedByGroupId?: string | null; removedAt: Date },
  tx?: Db,
) {
  return db(tx).serviceListing.updateMany({
    where: { ownerId, listingId, state: 'active' },
    data: { state: 'removed', ...removal },
  });
}

/* ------------------------------------------------------------------ *
 * service_state — the upsert path
 * ------------------------------------------------------------------ */

/**
 * Record the last completed batch for one service.
 *
 * WHY THIS IS UPDATE-THEN-INSERT AND NOT `MERGE`
 * ----------------------------------------------
 * TASK-017 forbids `MERGE`, and the reason is not stylistic. SQL Server's
 * `MERGE` has a documented history of correctness defects under concurrency —
 * it can raise spurious unique-key violations, and it does not take range locks
 * the way an equivalent `UPDATE`/`INSERT` pair does. Prisma's own `upsert()`
 * compiles to a form with the same hazards, so it is avoided here too.
 *
 * The sequence is therefore explicit: UPDATE first, and INSERT only when the
 * update affected zero rows. UPDATE-first (rather than INSERT-first) is the
 * right order because after the very first call, update is the common path, so
 * the exceptional branch stays exceptional.
 *
 * The INSERT can still lose a race with a concurrent inserter; that surfaces as
 * a unique violation on the composite primary key, and the retry re-enters the
 * UPDATE branch, which now finds the row. One retry is sufficient: the row can
 * only be created once, so the second pass cannot take the INSERT branch again.
 */
export async function upsertServiceState(
  ownerId: OwnerId,
  service: string,
  data: { lastCompletedBatchId: string | null; lastCompletedBatchAt: Date | null },
  tx?: Db,
) {
  const conn = db(tx);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const updated = await conn.serviceState.updateMany({
      where: { ownerId, service },
      data,
    });
    if (updated.count > 0) return;

    try {
      await conn.serviceState.create({ data: { ownerId, service, ...data } });
      return;
    } catch (error) {
      // Someone else inserted between our UPDATE and our INSERT. Loop once and
      // the UPDATE branch will now find the row. Anything else is a real fault.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new Error(`upsertServiceState: could not converge for service ${service}`);
}

export async function findServiceState(ownerId: OwnerId, service: string, tx?: Db) {
  return db(tx).serviceState.findFirst({ where: { ownerId, service } });
}

export async function listServiceStates(ownerId: OwnerId, tx?: Db) {
  return db(tx).serviceState.findMany({ where: { ownerId } });
}

/* ------------------------------------------------------------------ *
 * suppression
 * ------------------------------------------------------------------ */

/**
 * The active suppression for a canonical WORK IDENTITY.
 *
 * ⚠ Keyed on `workIdentity`, NEVER on a row id (REQ-071, product invariant 1).
 * A suppressed title that reappears in a later capture becomes a BRAND-NEW row
 * (product invariant 7), so a row-scoped suppression would appear to work and
 * then quietly stop working on the next upload — silently re-showing something
 * the owner said they were not interested in. That is the whole reason this
 * lookup takes an identity and not an id.
 */
export async function findActiveSuppression(ownerId: OwnerId, workIdentity: string, tx?: Db) {
  return db(tx).suppression.findFirst({
    where: { ownerId, workIdentity, active: true },
  });
}

export async function listActiveSuppressions(ownerId: OwnerId, tx?: Db) {
  return db(tx).suppression.findMany({ where: { ownerId, active: true } });
}

export async function createSuppression(
  ownerId: OwnerId,
  data: Omit<Prisma.SuppressionUncheckedCreateInput, 'ownerId'>,
  tx?: Db,
) {
  return db(tx).suppression.create({ data: { ...data, ownerId } });
}

/**
 * Lift a suppression ("interested again").
 *
 * Deactivates rather than deletes, so the history of the decision survives —
 * and so the `suppression_one_active` filtered unique index frees the identity
 * for a future suppression without ever losing the earlier one.
 */
export async function deactivateSuppression(
  ownerId: OwnerId,
  workIdentity: string,
  unsuppressedAt: Date,
  tx?: Db,
) {
  return db(tx).suppression.updateMany({
    where: { ownerId, workIdentity, active: true },
    data: { active: false, unsuppressedAt },
  });
}

/* ------------------------------------------------------------------ *
 * uploaded_image / extraction_candidate
 * ------------------------------------------------------------------ */

export async function createUploadedImage(
  ownerId: OwnerId,
  data: Omit<Prisma.UploadedImageUncheckedCreateInput, 'ownerId'>,
  tx?: Db,
) {
  return db(tx).uploadedImage.create({ data: { ...data, ownerId } });
}

export async function listImagesForBatch(ownerId: OwnerId, batchId: string, tx?: Db) {
  return db(tx).uploadedImage.findMany({ where: { ownerId, batchId } });
}

export async function createExtractionCandidate(
  ownerId: OwnerId,
  data: Omit<Prisma.ExtractionCandidateUncheckedCreateInput, 'ownerId'>,
  tx?: Db,
) {
  return db(tx).extractionCandidate.create({ data: { ...data, ownerId } });
}

/**
 * Every candidate in a batch — ALL of them, not just the new ones.
 *
 * ⚠ There is deliberately no `state`/`disposition` filter parameter here, and
 * adding one would be a safety regression. Full-update review must show ALL
 * extracted titles (product invariant 2), because a title that failed to
 * extract must never be silently reinterpreted as a removal. That is the single
 * most important safety property in the product, and narrowing this read is
 * exactly how it would be lost.
 */
export async function listCandidatesForBatch(ownerId: OwnerId, batchId: string, tx?: Db) {
  return db(tx).extractionCandidate.findMany({
    where: { ownerId, batchId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function updateCandidateDisposition(
  ownerId: OwnerId,
  id: string,
  data: Pick<
    Prisma.ExtractionCandidateUncheckedUpdateInput,
    'reviewDisposition' | 'resolvedTitleId' | 'collapsedIntoCandidateId'
  >,
  tx?: Db,
) {
  return db(tx).extractionCandidate.updateMany({ where: { ownerId, id }, data });
}

/* ------------------------------------------------------------------ *
 * batch_change / removal_group
 * ------------------------------------------------------------------ */

export async function recordBatchChange(
  ownerId: OwnerId,
  data: Omit<Prisma.BatchChangeUncheckedCreateInput, 'ownerId' | 'id'>,
  tx?: Db,
) {
  return db(tx).batchChange.create({ data: { ...data, ownerId } });
}

export async function listBatchChanges(ownerId: OwnerId, batchId: string, tx?: Db) {
  return db(tx).batchChange.findMany({
    where: { ownerId, batchId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createRemovalGroup(
  ownerId: OwnerId,
  data: Omit<Prisma.RemovalGroupUncheckedCreateInput, 'ownerId'>,
  tx?: Db,
) {
  return db(tx).removalGroup.create({ data: { ...data, ownerId } });
}

export async function findRemovalGroup(ownerId: OwnerId, id: string, tx?: Db) {
  return db(tx).removalGroup.findFirst({ where: { ownerId, id } });
}
