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

/**
 * Run `work` inside ONE interactive transaction (product invariant 3).
 *
 * ⚠ THE HANDLE MUST BE THREADED THROUGH EVERY WRITE INSIDE `work`. Prisma's
 * transaction client is a separate connection; a repository call inside the
 * callback that omits its `tx` argument silently runs on the pooled client
 * instead and is therefore NOT rolled back with the rest. Nothing about that
 * mistake is visible at the call site or in a passing test — it only shows up
 * as a half-applied batch after a failure, which is precisely the outcome the
 * transaction exists to make impossible.
 *
 * ⚠ The timeout is deliberately generous. Azure SQL Basic is 5 DTU, and close
 * is the largest write the product makes; the default 5 s aborts a realistic
 * 200-title batch under load and reports it as a timeout rather than as
 * anything the owner could act on.
 */
export async function runInTransaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  return getPrisma().$transaction(async (tx) => work(tx), {
    maxWait: 10_000,
    timeout: 30_000,
  });
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

/**
 * The batch whose completion `serviceState` should revert to when the newest
 * one is undone (US-032 AC-2, `specs/data-model.md` §8.3).
 *
 * ⚠ ORDERED BY `completedAt`, NOT `createdAt`. Batches complete in the order
 * the owner finishes reviewing them, which is not the order they were opened —
 * a batch created on Monday and closed on Friday completed AFTER one created
 * on Tuesday and closed on Wednesday. `serviceState.lastCompletedBatchAt` is a
 * completion fact, so ordering it by creation would revert to a value that was
 * never the last completion.
 *
 * ⚠ EXCLUDES `undone` batches, not just this one. Undoing two batches in a row
 * must walk back past both; treating an already-undone batch as a predecessor
 * would restore a completion the owner has explicitly reversed.
 *
 * Returns `null` when this was the first applied batch for the service — the
 * caller then writes `lastCompletedBatchAt: null`, which is the honest "never
 * updated" state `FreshnessStrip` renders (REQ-039).
 */
export async function findPreviousAppliedBatch(
  ownerId: OwnerId,
  service: string,
  excludingBatchId: string,
  tx?: Db,
) {
  return db(tx).uploadBatch.findFirst({
    where: {
      ownerId,
      service,
      status: 'applied',
      id: { not: excludingBatchId },
      completedAt: { not: null },
    },
    orderBy: { completedAt: 'desc' },
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

/**
 * A status change applied ONLY if the batch is still in `from` (TASK-054).
 *
 * ⚠ This is not a convenience wrapper over `updateUploadBatchStatus` — the
 * `status: from` predicate is the concurrency control. Reading the status,
 * deciding in JavaScript and then writing is a read-modify-write across an
 * `await`: two concurrent submits both observe `draft`, both pass the guard,
 * and the batch is extracted twice. Here the check and the write are one
 * statement, so exactly one caller can see a count of 1.
 *
 * Returns the number of rows changed — 0 means the batch moved first (or is
 * not this owner's). The caller decides which of those it is; this function
 * deliberately does not, because distinguishing them requires a second read
 * that would reintroduce the race it exists to close.
 */
export async function transitionUploadBatchStatus(
  ownerId: OwnerId,
  id: string,
  from: string,
  data: Pick<
    Prisma.UploadBatchUncheckedUpdateInput,
    'status' | 'submittedAt' | 'extractionStartedAt' | 'completedAt' | 'undoneAt'
  >,
  tx?: Db,
): Promise<number> {
  const result = await db(tx).uploadBatch.updateMany({
    where: { ownerId, id, status: from },
    data,
  });
  return result.count;
}

/**
 * Write the outcome of a stage-1 extraction run (TASK-058 wiring).
 *
 * ⚠ `degradedExtraction`, `lowYield` and `crossCheck` are SAFETY STATE, not
 * statistics: each forces `computeRemovals: false` at review close, which is
 * the invariant that a failed extraction is never misread as a removal.
 * Extraction and review are separate requests, so they are persisted here and
 * must never be recomputed on read.
 *
 * Unlike `transitionUploadBatchStatus` there is deliberately no `from`
 * predicate: the caller already claimed the batch by moving it into
 * `extracting`, and re-checking here would leave a genuinely finished run
 * unable to record its own result if the claim row was touched meanwhile —
 * i.e. it would lose the outcome to protect against a race that has already
 * been won.
 */
export async function recordExtractionOutcome(
  ownerId: OwnerId,
  id: string,
  data: Pick<
    Prisma.UploadBatchUncheckedUpdateInput,
    | 'status'
    | 'extractionStats'
    | 'extractionErrorCode'
    | 'extractionErrorMessage'
    | 'extractionErrorAt'
    | 'degradedExtraction'
    | 'lowYield'
    | 'crossCheck'
  >,
  tx?: Db,
) {
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
    // Ordering must match `listTitlePage` and `compareTitlesForList` exactly:
    // `id` ASCENDING in both directions (`T-LIST-016`), nulls last in both
    // (`T-LIST-027`). Two list queries that order differently is the shape a
    // "the list looks different depending on where you came from" bug takes.
    orderBy: [{ sortDateAdded: { sort: dir, nulls: 'last' } }, { id: 'asc' }],
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
  genres?: readonly string[];
}

export async function listTitlePage(ownerId: OwnerId, options: TitlePageOptions, tx?: Db) {
  const conn = db(tx);
  const { limit, dir, cursor, services = [], mediaType, genres = [] } = options;

  const suppressed = await conn.suppression.findMany({
    where: { ownerId, active: true },
    select: { workIdentity: true },
  });

  // The keyset predicate, spelled out because SQL Server has no row-value
  // comparison Prisma can express. `(sortDateAdded, id) < (@d, @id)` becomes
  // "an earlier date, OR the same date and a smaller id" — and the second
  // branch is what stops rows sharing a date from being skipped between pages.
  //
  // ⚠ The two branches use DIFFERENT operators, and that asymmetry is
  // deliberate. The date branch follows `dir`; the id branch is always `gt`,
  // because the tie-breaker is `id` ASCENDING in both directions
  // (`T-LIST-016`). Writing both as `[before]` reads as symmetric and is what
  // this function did originally — it makes the tie order flip when the owner
  // reverses the sort, and, worse, it makes page 2 skip or repeat rows that
  // share a date, because the keyset would then disagree with the `ORDER BY`.
  // A keyset predicate must mirror its `ORDER BY` exactly or paging silently
  // loses rows.
  const before = dir === 'desc' ? 'lt' : 'gt';
  const keyset =
    cursor === undefined
      ? {}
      : {
          OR: [
            { sortDateAdded: { [before]: new Date(`${cursor.sortDateAdded}T00:00:00.000Z`) } },
            {
              sortDateAdded: new Date(`${cursor.sortDateAdded}T00:00:00.000Z`),
              id: { gt: cursor.id },
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
      // A row requires at least one ACTIVE listing (US-018 AC-4). Without it a
      // work whose only listing was removed stayed in the list as a row with
      // zero badges — `badges` is derived from active listings, so the row
      // rendered as a title belonging to no service at all. `T-LIST-013a` is
      // that guard.
      //
      // ⚠ This is deliberately NOT a check on `Title.state`. That flag is set
      // by the reconciliation pipeline, so relying on it makes the list's
      // correctness depend on another component remembering to write a field;
      // requiring a live listing is the same rule the badges already follow
      // and cannot be bypassed by a pipeline bug. `T-LIST-013c` pins the
      // discriminating case — one removed and one active listing KEEPS its
      // row, which is what separates "no active listings" from "has a removed
      // listing".
      //
      // ⚠ The two branches are one `listings` key, not two. A service filter
      // selects titles holding an active listing on one of the named services,
      // which already implies the general condition — but writing the general
      // condition as a SECOND `listings` key would silently replace the first
      // (the same object-shape hazard as the `OR` keys below), and the service
      // filter would stop filtering.
      //
      // It deliberately does not narrow `badges` below: filtering by Netflix
      // must not hide the row's Max badge (REQ-032).
      ...(services.length > 0
        ? { listings: { some: { ownerId, state: 'active', service: { in: [...services] } } } }
        : { listings: { some: { ownerId, state: 'active' } } }),
      // GENRE — OR within the dimension, AND against every other filter
      // (US-019 AC-4). Genres live as a JSON array in one `NVARCHAR(MAX)`
      // column (`specs/data-model.md` §16), so the match is on the QUOTED
      // token `"Name"` within that text, never on the bare name.
      //
      // ⚠ The quotes are what make this exact rather than a prefix match.
      // Searching for `Drama` would also match a title whose only genre is
      // `Dramatic Arts`; searching for `"Drama"` cannot, because the stored
      // text has `"Dramatic Arts"` and the closing quote does not line up.
      // `T-LIST-022c` is that guard, and it fails if the quotes are dropped.
      //
      // A title with `genres: []` stores `"[]"`, which contains no token at
      // all, so it is excluded from every genre-filtered result and included
      // when none is set — US-019 AC-6, for free and by construction rather
      // than by a special case that could be forgotten (`T-LIST-024`).
      //
      // ⚠ Matching is CASE- and ACCENT-SENSITIVE, because the column collates
      // `Latin1_General_100_BIN2`. That is correct here: the values come from
      // TMDB's fixed genre vocabulary and the filter bar offers them from the
      // owner's own data, so a near-miss spelling should return nothing rather
      // than guess. `T-LIST-022d` records the behaviour so it cannot change by
      // accident.
      //
      // The alternative was `EXISTS (SELECT 1 FROM OPENJSON(tmdb_genres) …)`,
      // which is the more literal reading of the storage. It is not used
      // because Prisma cannot express a raw fragment inside `where`, so it
      // would mean hand-writing this entire query — the keyset predicate, the
      // suppression anti-join and the listings `include` — in raw SQL, and
      // that is a much larger surface to get wrong than one quoted token.
      // ⚠ The genre and keyset predicates are combined under `AND` and NOT
      // spread as sibling keys. Both are expressed with `OR`, and two `OR`
      // keys in one object literal means the second silently REPLACES the
      // first — so spreading them would drop the genre filter the moment a
      // cursor was present. Page 1 would filter and page 2 would not, which
      // reads as the filter randomly giving up rather than as an error.
      AND: [
        genres.length > 0
          ? { OR: genres.map((genre) => ({ tmdbGenres: { contains: `"${genre}"` } })) }
          : {},
        keyset,
      ],
    },
    // `compareTitlesForList` in `@nextup/domain` is the same order expressed
    // as a comparator, and the integration suite checks this query against it.
    // Nulls last is stated EXPLICITLY: SQL Server puts them last on `desc` for
    // free and first on `asc`, so relying on the default is correct in the
    // default direction and wrong the moment the owner reverses it
    // (`T-LIST-027`). `id` is `asc` in both directions (`T-LIST-016`).
    orderBy: [{ sortDateAdded: { sort: dir, nulls: 'last' } }, { id: 'asc' }],
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

/**
 * ONE title with ALL of its listings, for `GET /api/titles/:titleId`
 * (`specs/api.md` §6.3, TASK-034).
 *
 * Three scoping decisions, each deliberate:
 *
 * 1. **No `state` filter on the title.** The removed view is a historical LOG
 *    the owner browses and restores from (product invariant 7), so a
 *    soft-deleted title must still be openable — otherwise the row the removed
 *    view renders has no detail page and restore has nothing to confirm
 *    against.
 * 2. **No suppression filter.** `listTitlePage` excludes suppressed works
 *    because they must not appear in the LIST (REQ-024); "not interested" is
 *    not deletion, and the undo-refusal flow (US-033) exists precisely to read
 *    a suppressed work back. Applying the list's filter here would make the
 *    escape hatch unreachable.
 * 3. **ALL listings, active and removed.** §6.3 requires `removedListings[]`
 *    alongside the active badges, so the route splits one fetched set rather
 *    than issuing two queries that could observe different states.
 *
 * ⚠ Scoping is `{ ownerId, id }` and `findFirst`, never `findUnique({ id })`
 * with an ownership check afterwards. The check-afterwards shape leaks
 * existence through timing and through any future code path that forgets it;
 * this one cannot return another owner's row at all, which is what lets the
 * route answer a flat 404 (`T-LIST-028`, `T-SEC-002`).
 */
export async function findTitleDetail(ownerId: OwnerId, id: string, tx?: Db) {
  return db(tx).title.findFirst({
    where: { ownerId, id },
    include: {
      listings: {
        where: { ownerId },
        orderBy: [{ dateAdded: 'asc' }, { listingId: 'asc' }],
      },
    },
  });
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

/**
 * Is this work already on the owner's list? (REQ-092 / US-045 AC-4.)
 *
 * ⚠ Keyed on `workIdentity`, not on a TMDB id, so it agrees with the identity
 * every other part of the product deduplicates on. Returns the row whatever
 * its `state`: a work sitting in the removed log IS "already known", and
 * telling the owner it is unknown would invite a duplicate capture.
 */
export async function findTitleByWorkIdentity(ownerId: OwnerId, workIdentity: string, tx?: Db) {
  return db(tx).title.findFirst({
    where: { ownerId, workIdentity },
    orderBy: [{ createdAt: 'desc' }],
  });
}

/**
 * The ACTIVE title holding a work identity, if any (US-030 AC-4, TASK-109).
 *
 * ⚠ Deliberately NOT `findTitleByWorkIdentity` with a state check bolted on
 * afterwards. That read is `findFirst` ordered by `createdAt desc` across
 * EVERY state, so a work removed yesterday and re-added last month comes back
 * as the removed row — and a caller filtering the result would conclude no
 * active title exists while `title_one_active_per_work` is about to reject the
 * write. The duplicate warning fix-match shows the owner has to agree with the
 * index that enforces it, so the state filter belongs in the query.
 *
 * `createdAt asc` because at most one active row can hold an identity for a
 * given `duplicateAckSeq`; where several exist they are acknowledged
 * duplicates, and the FIRST is the one the owner has lived with longest and so
 * the one worth naming in the warning.
 */
export async function findActiveTitleByWorkIdentity(
  ownerId: OwnerId,
  workIdentity: string,
  tx?: Db,
) {
  return db(tx).title.findFirst({
    where: { ownerId, workIdentity, state: 'active' },
    orderBy: [{ createdAt: 'asc' }],
  });
}

/**
 * Persist ONE work's IMDb rating (REQ-090, ADR-0011).
 *
 * ⚠ **THE COLUMN SET IS CLOSED, AND THAT IS WHAT MAKES THE LAZY REFRESH
 * LEGAL.** This is the write executed by the access-triggered refresh — the
 * third and last of the non-owner processes product invariant 5 permits. It is
 * permitted only because it cannot change user-visible LIST state, and the
 * only reason it cannot is that it writes exactly these two columns.
 *
 * Widening it to take a `data` object, or adding any field that participates
 * in membership, ordering or service badges, would put a background write
 * inside invariant 5 while every existing test still passed. `T-IMDB-005a`
 * asserts the write's shape from the other end.
 *
 * Owner-scoped via `updateMany` like every other writer here: `update({ id })`
 * would touch another owner's row if an id ever leaked.
 */
export async function updateTitleRating(
  ownerId: OwnerId,
  id: string,
  rating: { imdbRatingTenths: number | null; imdbRatingFetchedAt: Date },
  tx?: Db,
) {
  return db(tx).title.updateMany({
    where: { ownerId, id },
    data: {
      imdbRatingTenths: rating.imdbRatingTenths,
      imdbRatingFetchedAt: rating.imdbRatingFetchedAt,
    },
  });
}

/**
 * Persist ONE work's refreshed TMDB metadata (REQ-076, NFR-014).
 *
 * ⚠ **THE COLUMN SET IS CLOSED, FOR THE SAME REASON `updateTitleRating`'S IS.**
 * This is the write executed by the lazy, access-triggered metadata refresh —
 * the exemption product invariant 5 grants to metadata-only work. It stays an
 * exemption only while it cannot change user-visible LIST state, and the only
 * thing making that true is this closed column set.
 *
 * Specifically absent, and each for a reason: `workIdentity` (the dedup key —
 * rewriting it would silently merge or split rows), `tmdbId`/`tmdbMediaType`
 * (the identity's own components), `sortDateAdded` (the default ordering),
 * `state`/`matchState` (membership), and everything on `service_listing`
 * (the badges). `T-TMDB-014` asserts this from the other end.
 *
 * `imdbId` IS refreshable: it is TMDB's descriptive mapping to another
 * catalogue, it is display-only via the rating (REQ-095), and TMDB adding one
 * to a work that previously had none is the ordinary case a refresh exists to
 * pick up.
 *
 * Owner-scoped via `updateMany`, like every other writer here.
 */
export async function updateTitleMetadata(
  ownerId: OwnerId,
  id: string,
  metadata: {
    tmdbName: string;
    tmdbReleaseYear: number | null;
    tmdbRuntimeMinutes: number | null;
    tmdbGenres: string;
    tmdbPosterPath: string | null;
    imdbId: string | null;
    tmdbFetchedAt: Date;
  },
  tx?: Db,
) {
  return db(tx).title.updateMany({
    where: { ownerId, id },
    data: {
      tmdbName: metadata.tmdbName,
      tmdbReleaseYear: metadata.tmdbReleaseYear,
      tmdbRuntimeMinutes: metadata.tmdbRuntimeMinutes,
      tmdbGenres: metadata.tmdbGenres,
      tmdbPosterPath: metadata.tmdbPosterPath,
      // ⚠ `null` means LEAVE IT ALONE, not "clear it". TMDB answers a detail
      // request without an `imdb_id` more often than one would like — a series
      // carries it only under `external_ids`, and an occasional response omits
      // it entirely — and blanking a good id on one such answer would silently
      // end the work's ratings (REQ-094) with no way to tell it apart from
      // "TMDB never had one". Gaining an id is an ordinary refresh outcome;
      // losing one is not.
      ...(metadata.imdbId === null ? {} : { imdbId: metadata.imdbId }),
      tmdbFetchedAt: metadata.tmdbFetchedAt,
    },
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

/**
 * Fetch a listing plus its title's `workIdentity` in one read.
 *
 * Used by `POST /api/listings/:listingId/restore` which needs to check
 * suppression (keyed on workIdentity) and the duplicate-title guard without
 * a separate title lookup.
 */
export async function findServiceListingWithWork(ownerId: OwnerId, listingId: string, tx?: Db) {
  return db(tx).serviceListing.findFirst({
    where: { ownerId, listingId },
    include: { title: { select: { workIdentity: true } } },
  });
}

export async function listActiveListingsForTitle(ownerId: OwnerId, titleId: string, tx?: Db) {
  return db(tx).serviceListing.findMany({
    where: { ownerId, titleId, state: 'active' },
  });
}

/**
 * EVERY listing on one title, active or removed.
 *
 * ⚠ This is NOT a relaxed `listActiveListingsForTitle`, and the two must not be
 * merged. That one answers "what is this title still on?", which is a product
 * question and where `state: 'active'` is load-bearing. This one exists solely
 * to feed `deriveTitleState`/`deriveSortDateAdded`, which are DEFINED over the
 * whole set — a title is `removed` only when EVERY listing is (invariant I-3),
 * so a caller handed only the active ones would see an empty array and get a
 * `RangeError` instead of the `removed` state it should have computed.
 *
 * Only the columns the derivation reads are selected, so it cannot accidentally
 * become a general-purpose listing reader.
 */
export async function listListingsForTitle(ownerId: OwnerId, titleId: string, tx?: Db) {
  return db(tx).serviceListing.findMany({
    where: { ownerId, titleId },
    select: { listingId: true, service: true, state: true, dateAdded: true },
    orderBy: { listingId: 'asc' },
  });
}

/**
 * Every ACTIVE listing on ONE service, with just enough of its title to render
 * a removal proposal (`specs/api.md` §6.17) and to key classification
 * (`packages/domain/src/classify.ts`).
 *
 * ⚠ `state: 'active'` is not an optimisation and there is deliberately no
 * parameter to relax it. Two callers depend on it:
 *
 * 1. Classification — a `removed` listing for this service must classify as
 *    `new`, because a reappearance is a brand-new row dated today (invariant
 *    L1/A33). Including removed rows here would classify it `already-present`,
 *    the row would never be created, and the title would silently never come
 *    back. `T-CLS-012`.
 * 2. The removal proposal — a listing already removed cannot disappear again,
 *    and proposing it would double-count the removal in the owner's summary.
 *
 * Scoped to ONE service because a batch is scoped to one service (product
 * invariant 3); a cross-service read here would let a Netflix batch propose
 * removing a Max listing.
 */
export async function listActiveListingsForService(ownerId: OwnerId, service: string, tx?: Db) {
  return db(tx).serviceListing.findMany({
    where: { ownerId, service, state: 'active' },
    select: {
      listingId: true,
      titleId: true,
      service: true,
      // Selected even though the WHERE above hard-codes `active`: TASK-083's
      // `computeRemovals` re-checks it, and a filter that cannot see the value
      // it filters on is a guard in name only.
      state: true,
      dateAdded: true,
      title: {
        select: {
          workIdentity: true,
          tmdbName: true,
          tmdbReleaseYear: true,
          tmdbPosterPath: true,
          rawExtractedText: true,
        },
      },
    },
    orderBy: { listingId: 'asc' },
  });
}

/**
 * Every removal decision stored for a batch (TASK-085, US-015).
 *
 * ⚠ Returns ALL of them, ticked and unticked alike. Filtering to the unticked
 * ones here would make "the owner ticked this back on" indistinguishable from
 * "the owner never touched it" — the same value, two different histories — and
 * the batch history has to be able to tell them apart.
 */
export async function listRemovalDecisions(ownerId: OwnerId, batchId: string, tx?: Db) {
  return db(tx).removalDecision.findMany({
    where: { ownerId, batchId },
    select: { listingId: true, ticked: true },
    orderBy: { listingId: 'asc' },
  });
}

/**
 * Record the owner's tick/untick for a set of proposed removals.
 *
 * ⚠ An explicit UPDATE-then-INSERT-if-zero-rows, NOT `upsert`. TASK-017
 * requires that form everywhere: Prisma's `upsert()` compiles to SQL Server's
 * `MERGE`, which has documented concurrency defects, and its unique selector
 * cannot bind `ownerId` at the top level of the `where` — so `T-SEC-021`
 * could not see whether the call was owner-scoped at all.
 *
 * ⚠ One statement pair per listing rather than a `createMany`/`updateMany`
 * over the whole set: ticking a removal that was never unticked and unticking
 * one twice must both be ordinary successes. The caller wraps the whole set in
 * a transaction so a half-applied press cannot leave the owner looking at a
 * removal list that is neither the old one nor the new one.
 */
export async function setRemovalDecisions(
  ownerId: OwnerId,
  batchId: string,
  listingIds: readonly string[],
  ticked: boolean,
  tx?: Db,
): Promise<void> {
  for (const listingId of listingIds) {
    const updated = await db(tx).removalDecision.updateMany({
      where: { ownerId, batchId, listingId },
      data: { ticked, decidedAt: new Date() },
    });
    if (updated.count === 0) {
      await db(tx).removalDecision.create({
        data: { ownerId, batchId, listingId, ticked },
      });
    }
  }
}

/** One page of the removed view. Newest removal first, ties by listing id. */
export interface RemovedListingRow {
  listing_id: string;
  title_id: string;
  service: string;
  removed_at: Date;
  tmdb_name: string | null;
}

export interface RemovedPageCursor {
  removedAt: Date;
  listingId: string;
}

/**
 * The removed view, keyset-paginated (TASK-047, `specs/data-model.md` §16.6).
 *
 * ⚠ `OFFSET` MUST NOT be used here. The removed view is append-only for the
 * life of the product — REQ-028 keeps every removal for ever — so an `OFFSET`
 * page cost grows without bound and would break the exact `NFR-018` claim the
 * `listing_removed_view` index exists to defend. `T-PERF-001` asserts the plan
 * at 20,000 rows.
 *
 * The predicate mirrors the `ORDER BY` exactly, and the two branches use
 * DIFFERENT operators for the same reason `listTitlePage` does: `removed_at`
 * descends, the `listing_id` tie-breaker ASCENDS. Writing both as `<` reads as
 * symmetric and silently drops rows sharing a removal timestamp — and a
 * full-update close removes many listings in ONE transaction, so identical
 * timestamps are the normal case here, not a rare tie.
 *
 * ⚠ There is deliberately NO redundant `removed_at <= @cursor` leading
 * predicate here. One was added, on the belief that the bare `OR` form is not
 * sargable on SQL Server — a widely repeated claim. It was then MEASURED and
 * removed: at 20,000 rows, with the cursor taken from row 15,000, both forms
 * cost the same (`T-PERF-001d`). The apparent regression that motivated it was
 * an artefact of the test clearing the plan cache before reading its own
 * measurement. Do not reintroduce it without a number.
 */
export async function listRemovedListingPage(
  ownerId: OwnerId,
  options: { limit: number; cursor?: RemovedPageCursor },
  tx?: Db,
): Promise<RemovedListingRow[]> {
  const { limit, cursor } = options;
  const conn = db(tx);

  const rows = cursor
    ? await conn.$queryRaw<RemovedListingRow[]>`
        SELECT TOP (${limit})
          l.listing_id, l.title_id, l.service, l.removed_at, t.tmdb_name
        FROM service_listing l
        JOIN title t ON t.owner_id = l.owner_id AND t.id = l.title_id
        WHERE l.owner_id = ${ownerId}
          AND l.state = 'removed'
          AND (l.removed_at < ${cursor.removedAt}
               OR (l.removed_at = ${cursor.removedAt} AND l.listing_id > ${cursor.listingId}))
        ORDER BY l.removed_at DESC, l.listing_id ASC`
    : await conn.$queryRaw<RemovedListingRow[]>`
        SELECT TOP (${limit})
          l.listing_id, l.title_id, l.service, l.removed_at, t.tmdb_name
        FROM service_listing l
        JOIN title t ON t.owner_id = l.owner_id AND t.id = l.title_id
        WHERE l.owner_id = ${ownerId}
          AND l.state = 'removed'
        ORDER BY l.removed_at DESC, l.listing_id ASC`;

  return rows;
}

/** The `ESCAPE` character for {@link escapeLikeTerm}. Not a backslash. */
export const LIKE_ESCAPE_CHAR = '!';

/**
 * Neutralise T-SQL `LIKE` metacharacters in a user-supplied search term.
 *
 * ⚠ This is a CORRECTNESS control as well as a safety one. `LIKE` treats `%`,
 * `_` and `[` as syntax, so a term containing any of them silently matches the
 * wrong rows — searching for `100%` would match every title. Escaping them
 * makes the search mean what the owner typed.
 *
 * ⚠ The escape character itself must be escaped FIRST, or escaping `%` would
 * then have its own escape character escaped again and the pattern would be
 * corrupt. `!` is used rather than `\` because a backslash has to survive both
 * a JavaScript string literal and T-SQL, and every extra layer of quoting here
 * is a place for the guard to be silently defeated.
 *
 * This is NOT the SQL-injection control — parameterisation is, and every call
 * site passes the term as a bound parameter through a tagged template. Both
 * are required: escaping without parameterisation is still injectable, and
 * parameterisation without escaping still returns wrong answers.
 */
export function escapeLikeTerm(term: string): string {
  return term
    .replaceAll(LIKE_ESCAPE_CHAR, `${LIKE_ESCAPE_CHAR}${LIKE_ESCAPE_CHAR}`)
    .replaceAll('%', `${LIKE_ESCAPE_CHAR}%`)
    .replaceAll('_', `${LIKE_ESCAPE_CHAR}_`)
    .replaceAll('[', `${LIKE_ESCAPE_CHAR}[`);
}

/**
 * Substring search over the removed view's title names.
 *
 * ⚠ This is deliberately NOT index-backed, and that is a known, accepted cost
 * of the move to Azure SQL Basic (`specs/data-model.md` §16.6). There is no
 * `pg_trgm` analogue on this tier, so fuzzy matching and typo tolerance are
 * GONE: this is exact substring only. A leading wildcard cannot use a B-tree,
 * so the plan is a scan by design — `T-PERF-001` asserts a seek for the
 * LISTING path and explicitly does not assert one here. Full-Text Search is
 * the named escalation and is an ADR-level decision, not silent scope.
 *
 * The column is collated `Latin1_General_100_BIN2`, which would make search
 * case- AND accent-sensitive; §16.6 overrides it to `Latin1_General_100_CI_AI`
 * per query so that searching `amelie` finds `Amélie`.
 */
export async function searchRemovedListings(
  ownerId: OwnerId,
  term: string,
  take = 50,
  tx?: Db,
): Promise<RemovedListingRow[]> {
  const pattern = `%${escapeLikeTerm(term)}%`;
  return db(tx).$queryRaw<RemovedListingRow[]>`
    SELECT TOP (${take})
      l.listing_id, l.title_id, l.service, l.removed_at, t.tmdb_name
    FROM service_listing l
    JOIN title t ON t.owner_id = l.owner_id AND t.id = l.title_id
    WHERE l.owner_id = ${ownerId}
      AND l.state = 'removed'
      AND t.tmdb_name COLLATE Latin1_General_100_CI_AI LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}
    ORDER BY l.removed_at DESC, l.listing_id ASC`;
}

/** One row of the removed view, widened for `GET /api/removed` (§6.9). */
export interface RemovedViewRow {
  listing_id: string;
  title_id: string;
  service: string;
  removed_at: Date;
  date_added: Date;
  removed_by_batch_id: string | null;
  removed_by_group_id: string | null;
  work_identity: string;
  match_state: string;
  tmdb_name: string | null;
  tmdb_media_type: string | null;
  tmdb_release_year: number | null;
  tmdb_poster_path: string | null;
  raw_extracted_text: string | null;
}

/**
 * One page of the removed view, with the §11 filters applied (TASK-095).
 *
 * ⚠ THIS IS NOT `listRemovedListingPage` WITH EXTRA COLUMNS, AND THE OLDER
 * FUNCTION IS NOT A SUBSET OF IT. `searchRemovedListings` matches `tmdb_name`
 * only, which silently makes every UNMATCHED row unfindable — and unmatched
 * rows are precisely the ones an owner is most likely to go looking for.
 * `specs/data-model.md` §11 rule 1 requires the term to match `tmdb_name`
 * **or** `normalised_text`; `T-REM-021` asserts both halves.
 *
 * The `LIKE` is deliberately NOT index-backed: a leading wildcard cannot seek a
 * B-tree, and §11 accepts that (NFR-018). `T-PERF-001` asserts the plan for the
 * *listing* path only. The term is parameterised and `ESCAPE`d — see
 * {@link escapeLikeTerm}; `q` reaches SQL Server as a bind, never as text.
 *
 * ⚠ ORDINALS ARE NOT COMPUTED HERE, AND NOT WITH A WINDOW FUNCTION. A
 * `ROW_NUMBER() OVER (PARTITION BY work_identity)` would have to be evaluated
 * over the owner's ENTIRE removed history before `TOP (n)` could be applied,
 * which turns the keyset seek `T-PERF-001` asserts into a full scan of a table
 * that grows for ever. {@link countRemovalsForWorks} ranks only the works on
 * the page instead.
 */
export async function listRemovedView(
  ownerId: OwnerId,
  options: { limit: number; cursor?: RemovedPageCursor; q?: string; service?: string },
  tx?: Db,
): Promise<RemovedViewRow[]> {
  const { limit, cursor, q, service } = options;

  const filters: Prisma.Sql[] = [];
  if (service) filters.push(Prisma.sql`AND l.service = ${service}`);
  if (q) {
    const pattern = `%${escapeLikeTerm(q)}%`;
    filters.push(
      Prisma.sql`AND (t.tmdb_name COLLATE Latin1_General_100_CI_AI LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}
                   OR t.normalised_text COLLATE Latin1_General_100_CI_AI LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR})`,
    );
  }
  if (cursor) {
    filters.push(
      Prisma.sql`AND (l.removed_at < ${cursor.removedAt}
                   OR (l.removed_at = ${cursor.removedAt} AND l.listing_id > ${cursor.listingId}))`,
    );
  }

  return db(tx).$queryRaw<RemovedViewRow[]>`
    SELECT TOP (${limit})
      l.listing_id, l.title_id, l.service, l.removed_at, l.date_added,
      l.removed_by_batch_id, l.removed_by_group_id,
      t.work_identity, t.match_state, t.tmdb_name, t.tmdb_media_type,
      t.tmdb_release_year, t.tmdb_poster_path, t.raw_extracted_text
    FROM service_listing l
    JOIN title t ON t.owner_id = l.owner_id AND t.id = l.title_id
    WHERE l.owner_id = ${ownerId}
      AND l.state = 'removed'
      ${filters.length > 0 ? Prisma.join(filters, ' ') : Prisma.empty}
    ORDER BY l.removed_at DESC, l.listing_id ASC`;
}

/** Every removed listing belonging to the given works, oldest removal first. */
export interface WorkRemovalRow {
  work_identity: string;
  listing_id: string;
  removed_at: Date;
}

/**
 * The removal history of the works on one page of the removed view (US-024
 * AC-6, `specs/data-model.md` §11 rule 4).
 *
 * ⚠ THE ORDINAL IS A PROPERTY OF THE WORK'S HISTORY, NOT OF THE CURRENT
 * FILTER. This query is deliberately NOT given the caller's `q` or `service`
 * filter. If it were, filtering to Max would renumber a work removed twice from
 * Netflix and once from Max as "removal 1 of 1" — the annotation exists to make
 * repetition read as history (§11 rule 4), and history that renumbers itself
 * when you narrow the view is worse than no annotation at all. `T-REM-022`
 * filters by service and asserts the ordinals are unchanged.
 */
export async function countRemovalsForWorks(
  ownerId: OwnerId,
  workIdentities: string[],
  tx?: Db,
): Promise<WorkRemovalRow[]> {
  if (workIdentities.length === 0) return [];
  return db(tx).$queryRaw<WorkRemovalRow[]>`
    SELECT t.work_identity, l.listing_id, l.removed_at
    FROM service_listing l
    JOIN title t ON t.owner_id = l.owner_id AND t.id = l.title_id
    WHERE l.owner_id = ${ownerId}
      AND l.state = 'removed'
      AND t.work_identity IN (${Prisma.join(workIdentities)})
    ORDER BY l.removed_at ASC, l.listing_id ASC`;
}

/** The work identities, among those given, that currently have an ACTIVE suppression. */
export async function findActiveSuppressedWorks(
  ownerId: OwnerId,
  workIdentities: string[],
  tx?: Db,
): Promise<Set<string>> {
  if (workIdentities.length === 0) return new Set();
  const rows = await db(tx).suppression.findMany({
    where: { ownerId, active: true, workIdentity: { in: workIdentities } },
    select: { workIdentity: true },
  });
  return new Set(rows.map((r) => r.workIdentity));
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

/**
 * Active suppressions, most recent decision first (`specs/api.md` §6.7).
 *
 * The ordering is here rather than in the route so that it is a property of
 * the read and not of one caller: the suppressed view is the owner's record of
 * decisions they made, and the one they are most likely to want to reverse is
 * the one they made last.
 *
 * `id` is the tie-break because `suppressedAt` is `DATETIME2` defaulted from
 * `SYSUTCDATETIME()` and two suppressions written in the same millisecond
 * would otherwise come back in an order the store is free to change between
 * reads — which reads as rows jumping around for no reason.
 */
export async function listActiveSuppressions(ownerId: OwnerId, tx?: Db) {
  return db(tx).suppression.findMany({
    where: { ownerId, active: true },
    orderBy: [{ suppressedAt: 'desc' }, { id: 'desc' }],
  });
}

/**
 * One suppression by its id, owner-scoped.
 *
 * ⚠ NOT filtered on `active`. Un-suppressing an already-lifted suppression has
 * to answer **200 with `active: false`**, not 404: the owner is looking at a
 * stale page and pressing a button whose outcome has already happened, and
 * telling them the record does not exist would be false as well as alarming.
 * The route decides idempotency; this read must not pre-empt it.
 */
export async function findSuppression(ownerId: OwnerId, id: string, tx?: Db) {
  return db(tx).suppression.findFirst({ where: { ownerId, id } });
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

/**
 * Re-arm a previously lifted suppression, in one statement.
 *
 * `active: false` in the `where` is what makes the suppress route idempotent
 * (US-027 AC-4): an ALREADY-ACTIVE suppression matches nothing, so `count` is
 * 0 and `suppressedAt` is left exactly as it was. Written as a conditional
 * `updateMany` rather than read-then-write so the decision and the write are
 * one statement — a plain update would silently reset `suppressedAt` on every
 * repeat press, quietly rewriting the date the owner made the decision.
 */
export async function reactivateSuppression(
  ownerId: OwnerId,
  workIdentity: string,
  suppressedAt: Date,
  tx?: Db,
) {
  return db(tx).suppression.updateMany({
    where: { ownerId, workIdentity, active: false },
    data: { active: true, suppressedAt, unsuppressedAt: null },
  });
}

/**
 * SD-06 — move an ACTIVE suppression from one work identity to another
 * (`specs/data-model.md` §6.3 step 6, TASK-110, `T-FIX-005`).
 *
 * ⚠ **Silently dropping the suppression here re-opens the REQ-071 hole.** A
 * fix-match replaces the identity a suppression is keyed on. Leave the old
 * suppression where it is and it now guards an identity nothing holds, while
 * the work the owner rejected becomes visible again on the next render — with
 * nothing anywhere to say why. So the decision moves with the work.
 *
 * The old row is DEACTIVATED, never deleted (REQ-028): the record that the
 * owner made the decision, and when, survives the move. `migratedFrom` on the
 * new row is the breadcrumb back to it — the title table carries no
 * `previousWorkIdentity` column, so this is the only place the link is kept.
 *
 * Reactivate-then-create, in that order, because the suppression id is
 * `supp:<workIdentity>` and therefore deterministic: at most ONE row can ever
 * exist per identity, and a target the owner suppressed and later lifted
 * already has one. A bare `create` would collide on the primary key and fail
 * the whole fix-match for a case that is entirely normal.
 *
 * The caller has already refused the fix-match with `TARGET_WORK_SUPPRESSED`
 * when an ACTIVE suppression holds the target, so this can never overwrite a
 * live decision — it only ever re-arms a lifted one or writes a fresh row.
 */
export async function migrateSuppression(
  ownerId: OwnerId,
  params: {
    id: string;
    from: string;
    to: string;
    at: Date;
    snapshot: {
      displayName: string;
      displayReleaseYear: number | null;
      displayMediaType: string | null;
      displayPosterPath: string | null;
    };
  },
  tx?: Db,
): Promise<void> {
  await deactivateSuppression(ownerId, params.from, params.at, tx);

  const { count } = await db(tx).suppression.updateMany({
    where: { ownerId, workIdentity: params.to },
    data: {
      active: true,
      suppressedAt: params.at,
      unsuppressedAt: null,
      migratedFrom: params.from,
    },
  });
  if (count > 0) return;

  await createSuppression(
    ownerId,
    {
      id: params.id,
      workIdentity: params.to,
      active: true,
      suppressedAt: params.at,
      migratedFrom: params.from,
      ...params.snapshot,
    },
    tx,
  );
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

export async function findUploadedImage(
  ownerId: OwnerId,
  batchId: string,
  imageId: string,
  tx?: Db,
) {
  // Scoped by `batchId` as well as `imageId` so that a correct id under the
  // WRONG batch is a 404 rather than a successful delete. Both are
  // owner-scoped; neither is guessable, but a route that ignored the batch
  // would let a stale client page delete from a batch it is not looking at.
  return db(tx).uploadedImage.findFirst({ where: { ownerId, batchId, id: imageId } });
}

/**
 * One image by id alone, owner-scoped (`specs/api.md` §6.27, TASK-052).
 *
 * Deliberately NOT batch-scoped, unlike {@link findUploadedImage}: `GET
 * /api/images/:imageId` is reached from an `href` that carries no batch, and
 * the id is a server-generated ULID that is not guessable. The batch scope on
 * the delete route guards a *destructive* action against a stale client page;
 * there is nothing here for a wrong batch id to protect.
 *
 * ⚠ `ownerId` stays in the predicate. `findUnique({ id })` would serve another
 * owner's screenshot to anyone holding an id — the exact failure US-036 AC-3
 * is written against, and it would look identical in every test that only ever
 * uses one owner.
 */
export async function findUploadedImageById(ownerId: OwnerId, imageId: string, tx?: Db) {
  return db(tx).uploadedImage.findFirst({ where: { ownerId, id: imageId } });
}

/**
 * ⚠ THE ONLY HARD DELETE OF OWNER DATA IN THIS CODEBASE (`T-INV-012`).
 *
 * REQ-028 is soft-delete-forever: a removed listing is a STATE, never a
 * deletion, and the removed view is a historical log. `data-model.md` I-7
 * carves out exactly one exemption, and this is it — a **pre-submit draft**
 * image. That is a correction to an upload the owner has not yet submitted,
 * not history: nothing has been reconciled against the list, no candidate has
 * been extracted from it, and no row anywhere references it. Deleting it
 * removes something that never became part of the record.
 *
 * The exemption is scoped by the CALLER, and the caller must check
 * `status === 'draft'` before calling. It is not re-checked here, because a
 * repository function that silently no-ops on a non-draft batch would hide a
 * routing bug rather than surface it; §6.13's answer to a submitted batch is a
 * 409, which only the route can produce.
 *
 * ⚠ Do not generalise this into a `deleteX` for any other model. `T-INV-012`
 * scans the source tree for exactly that and fails on a new one.
 *
 * ⚠ `deleteMany`, NOT `delete`, and that is about the OWNER SCOPE rather than
 * about cardinality. `UploadedImage` has no composite `(ownerId, id)` unique,
 * so Prisma's `delete` would accept only `{ id }` and would happily delete a
 * row belonging to somebody else. `deleteMany` takes a non-unique filter, so
 * `ownerId` stays in the predicate. It returns a count, which the caller uses
 * to tell "deleted" from "was not there".
 */
export async function deleteUploadedImage(
  ownerId: OwnerId,
  imageId: string,
  tx?: Db,
): Promise<number> {
  const { count } = await db(tx).uploadedImage.deleteMany({ where: { ownerId, id: imageId } });
  return count;
}

/**
 * Current image count and cumulative bytes for one batch (`specs/api.md` §5).
 *
 * ⚠ COUNTED ACROSS ALL THREE INGEST SOURCES — there is no `ingestSource`
 * filter here and there must never be one. 30 pasted plus 11 uploaded is 41
 * and is refused; a per-source tally would let a batch hold 120 images.
 *
 * ⚠ TWO BYTE TOTALS, IN TWO DIFFERENT UNITS, AND THEY ARE NOT INTERCHANGEABLE.
 * `uploadedByteSize` is what the owner sent; `storedByteSize` is what is kept
 * after the HEIC→PNG transcode and can be many times larger. The per-batch
 * ceiling is an UPLOAD ceiling, so it compares against `uploadedByteSize`
 * only. This function used to return a single `byteSize` (the stored sum),
 * which the route then added to incoming uploaded bytes.
 */
export async function batchImageTotals(ownerId: OwnerId, batchId: string, tx?: Db) {
  const result = await db(tx).uploadedImage.aggregate({
    where: { ownerId, batchId },
    _count: { _all: true },
    _sum: { byteSize: true, uploadedByteSize: true },
  });
  return {
    imageCount: result._count._all,
    // `byteSize` is BigInt in the store; the ceilings are Numbers. 60 MiB is
    // nowhere near `Number.MAX_SAFE_INTEGER`, so the narrowing is safe here
    // and keeps the ceiling comparison ordinary arithmetic.
    uploadedByteSize: Number(result._sum.uploadedByteSize ?? 0n),
    storedByteSize: Number(result._sum.byteSize ?? 0n),
  };
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

/**
 * The same read as `listCandidatesForBatch`, plus each candidate's source
 * images — which the review response needs so a tile thumbnail can be shown
 * (`T-AI-041`) and so an SD-02 survivor can show the provenance it absorbed.
 *
 * ⚠ Same rule as `listCandidatesForBatch`: **no disposition filter, ever.**
 * Full-update review must show ALL extracted titles (product invariant 2).
 */
export async function listCandidatesForReview(ownerId: OwnerId, batchId: string, tx?: Db) {
  return db(tx).extractionCandidate.findMany({
    where: { ownerId, batchId },
    include: { sourceImages: { select: { imageId: true }, orderBy: { id: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findExtractionCandidate(ownerId: OwnerId, id: string, tx?: Db) {
  return db(tx).extractionCandidate.findFirst({ where: { ownerId, id } });
}

export async function updateCandidateDisposition(
  ownerId: OwnerId,
  id: string,
  data: Pick<
    Prisma.ExtractionCandidateUncheckedUpdateInput,
    | 'reviewDisposition'
    | 'resolvedTitleId'
    | 'collapsedIntoCandidateId'
    | 'resolvedWorkIdentity'
    | 'correctedToTmdbId'
    | 'cleanupVerdict'
    | 'classification'
    | 'matchCandidates'
  >,
  tx?: Db,
) {
  return db(tx).extractionCandidate.updateMany({ where: { ownerId, id }, data });
}

/**
 * Bulk `pending` → `confirmed` for the ids given (`specs/api.md` §6.19).
 *
 * ⚠ `reviewDisposition: 'pending'` is in the WHERE, not just in the caller's
 * filter. The caller reads, decides, then writes, and in between the owner may
 * have discarded one of those items in another tab; without this predicate the
 * bulk press would silently reverse an explicit decision. It also makes the
 * returned `count` the number of decisions this press really made, which is
 * what §6.19 reports back.
 */
export async function confirmPendingCandidates(ownerId: OwnerId, ids: readonly string[], tx?: Db) {
  if (ids.length === 0) return { count: 0 };
  return db(tx).extractionCandidate.updateMany({
    where: { ownerId, id: { in: [...ids] }, reviewDisposition: 'pending' },
    data: { reviewDisposition: 'confirmed' },
  });
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

/**
 * Every listing this removal group removed, with the identity its undo needs.
 *
 * ⚠ NOT filtered to `state: 'removed'`. US-017's undo has to be able to see a
 * listing that has already come back — through a per-listing restore (§6.10),
 * or through a reappearance the owner accepted — and DECIDE about it. Filtering
 * it out here would make it invisible to the guarded write below, which would
 * then find nothing to do and report a clean undo of a group it had silently
 * skipped part of. The group's membership is history and does not change.
 */
export async function listListingsInRemovalGroup(ownerId: OwnerId, groupId: string, tx?: Db) {
  return db(tx).serviceListing.findMany({
    where: { ownerId, removedByGroupId: groupId },
    select: {
      listingId: true,
      titleId: true,
      service: true,
      state: true,
      title: { select: { workIdentity: true, tmdbName: true, rawExtractedText: true } },
    },
    orderBy: { listingId: 'asc' },
  });
}

/**
 * Return one listing to `active` (US-017 AC-2, US-025 AC-1).
 *
 * ⚠ GUARDED ON `state: 'removed'`, and the count is the caller's signal. An
 * unguarded update would silently "restore" a listing that was already active
 * and report success, which is how a half-applied group reads as a whole one.
 *
 * ⚠ `dateAdded` IS NOT TOUCHED, and it must never be. It is write-once
 * (REQ-030) and it is the value the whole default sort is built from: a
 * restore that stamped today's date would move the title to the top of the
 * owner's list, which is a silent edit of data that came off a screenshot they
 * may no longer have (US-017 AC-2, US-025 AC-2).
 *
 * `removedByBatchId` and `removedByGroupId` are cleared with the state. Leaving
 * them behind would keep the listing in a group whose undo has already run,
 * so a later undo of the same group would try to restore it a second time.
 */
export async function restoreServiceListing(ownerId: OwnerId, listingId: string, tx?: Db) {
  return db(tx).serviceListing.updateMany({
    where: { ownerId, listingId, state: 'removed' },
    data: { state: 'active', removedAt: null, removedByBatchId: null, removedByGroupId: null },
  });
}

/**
 * Restore a removed listing and re-home it under an existing active title
 * (`specs/api.md` §6.10, `confirmDuplicate` path, TASK-098).
 *
 * Used ONLY when the owner has confirmed awareness of a duplicate work
 * identity — i.e. when a newer active title already holds the same
 * `workIdentity` and `confirmDuplicate === true`. Moving the listing to the
 * existing title is the only way to avoid violating
 * `title_one_active_per_work`, which prevents two active titles sharing an
 * identity. The original title stays `removed` (because, after this move, all
 * its remaining listings are still removed); the target title is re-derived by
 * the route handler.
 *
 * ⚠ `listing_one_per_service` may still fire if the target title already has
 * an active listing for the same service — that is a correct rejection and
 * the caller gets a DB-mapped AppError. The route does not pre-check this
 * because the constraint does the work.
 */
export async function restoreListingToExistingTitle(
  ownerId: OwnerId,
  listingId: string,
  targetTitleId: string,
  tx?: Db,
) {
  return db(tx).serviceListing.updateMany({
    where: { ownerId, listingId, state: 'removed' },
    data: {
      state: 'active',
      removedAt: null,
      removedByBatchId: null,
      removedByGroupId: null,
      titleId: targetTitleId,
    },
  });
}

/**
 * Mark a removal group reversed (US-017 AC-5).
 *
 * ⚠ GUARDED ON `undoneAt: null`, so a concurrent second undo updates zero rows
 * rather than overwriting the first one's timestamp. The read-then-check in the
 * handler answers the ordinary case; this is what makes it true under a double
 * submit, where both requests read `null` before either wrote.
 */
export async function markRemovalGroupUndone(
  ownerId: OwnerId,
  groupId: string,
  undoneAt: Date,
  tx?: Db,
) {
  return db(tx).removalGroup.updateMany({
    where: { ownerId, id: groupId, undoneAt: null },
    data: { undoneAt },
  });
}
