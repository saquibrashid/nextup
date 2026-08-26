/**
 * TASK-071 — `POST /api/batches/:batchId/close` (`specs/api.md` §6.22).
 *
 * The I/O half of closing a batch. What may be applied is decided purely in
 * `packages/domain/src/close.ts`; this file performs the writes.
 *
 * THE THREE PROPERTIES THIS FILE EXISTS TO HOLD
 * ---------------------------------------------
 * 1. **ONE TRANSACTION, ONE SERVICE** (product invariant 3). Every write below
 *    runs on the handle from `runInTransaction` and every repository call is
 *    passed that handle. A call that omits it runs on the pooled client and is
 *    NOT rolled back — invisibly, and only after a mid-close failure.
 *
 * 2. **NO ACCEPT BY INACTION** (REQ-014, US-012 AC-3). A pending addition
 *    refuses the whole close with 409 `PENDING_ADDITIONS` and writes nothing.
 *    It is never skipped, never defaulted, never applied.
 *
 * 3. **THE SUPPRESSION GATE IS RE-CHECKED HERE, INSIDE THE TRANSACTION.** The
 *    review already filtered suppressed works out, but review and close are
 *    separate requests: a work suppressed from another tab between the two
 *    would otherwise be re-added by a close the owner started before they
 *    suppressed it. The gate is keyed on WORK IDENTITY (REQ-071, product
 *    invariant 1), never on a candidate or listing id.
 *
 * ⚠ REMOVALS ARE NOT HANDLED HERE, AND THAT IS NOT AN OVERSIGHT. `summary
 * .listingsRemoved` is `0` and `removalGroupId` is `null` because full-update
 * removals, their tick state and the `confirmRemovals` gate are TASK-083 to
 * TASK-086. Until those land, closing a full-update batch applies its
 * additions and removes nothing — which is the safe direction: REQ-020 says
 * removal is never a side effect of closing.
 */

import {
  applicableCandidates,
  discardedCount,
  jsonScalar,
  pendingAdditionIds,
  ulid,
  workIdentityForUnmatched,
  type CloseSummary,
  type ReviewCandidate,
  type Service,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { loadReviewCandidates } from '../routes/batchReview.js';
import {
  createServiceListing,
  createTitle,
  findActiveSuppression,
  findTitleByWorkIdentity,
  recordBatchChange,
  runInTransaction,
  updateTitle,
  upsertServiceState,
  type Db,
  type OwnerId,
} from '../repository/ownerData.js';
import { canTransition, loadOwnedBatch, transitionBatch } from './batchLifecycle.js';

export interface CloseResult {
  batchId: string;
  status: 'applied';
  completedAt: string;
  summary: CloseSummary;
  serviceState: { service: Service; lastCompletedBatchAt: string };
  undoable: boolean;
}

/**
 * Midnight UTC of `at`, as a date-only value.
 *
 * `ServiceListing.dateAdded` is a SQL `date`, and REQ-030 makes it WRITE-ONCE:
 * whatever goes in here is what the owner sees forever and what the title-level
 * date sort is computed from (product invariant 6). Truncating explicitly —
 * rather than letting the driver coerce a datetime — keeps "added today" from
 * depending on the container's clock offset at the moment of close.
 */
function dateOnly(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * The work identity a confirmed candidate becomes a title under.
 *
 * ⚠ The `unmatched:` fallback is recomputed from `rawText` rather than trusted
 * from the row when the row has none. That path is US-008's keep-anyway: a
 * title TMDB could not identify is still a title, and it needs a stable
 * identity or suppression and dedup cannot see it at all.
 */
function identityFor(candidate: ReviewCandidate): string {
  return candidate.resolvedWorkIdentity ?? workIdentityForUnmatched(candidate.rawText);
}

/**
 * Create the title row for a confirmed candidate.
 *
 * ⚠ THE TWO SHAPES ARE MUTUALLY EXCLUSIVE AND THE DATABASE ENFORCES IT. The
 * `title_match_coherent` CHECK requires `matched` ⇒ `tmdb_id NOT NULL` AND
 * `raw_extracted_text NULL`, and `unmatched` ⇒ exactly the opposite. Prisma
 * reports a violation as a *foreign key* error, so getting this wrong reads as
 * an unrelated relational fault rather than as the coherence rule it is.
 */
async function insertTitle(
  ownerId: OwnerId,
  tx: Db,
  candidate: ReviewCandidate,
  kind: 'addition' | 'unresolved',
  workIdentity: string,
  batchId: string,
  today: Date,
): Promise<string> {
  const id = ulid();
  const match = candidate.match;

  if (kind === 'addition' && match !== null) {
    await createTitle(
      ownerId,
      {
        id,
        workIdentity,
        state: 'active',
        matchState: 'matched',
        tmdbId: match.tmdbId,
        tmdbMediaType: match.mediaType,
        tmdbName: match.name,
        tmdbReleaseYear: match.releaseYear,
        tmdbPosterPath: match.posterPath,
        sortDateAdded: today,
        createdByBatchId: batchId,
      },
      tx,
    );
    return id;
  }

  await createTitle(
    ownerId,
    {
      id,
      workIdentity,
      state: 'active',
      matchState: 'unmatched',
      rawExtractedText: candidate.rawText,
      sortDateAdded: today,
      createdByBatchId: batchId,
    },
    tx,
  );
  return id;
}

/**
 * Apply a reviewed batch.
 *
 * Throws `PENDING_ADDITIONS` (409) or `BATCH_NOT_IN_REVIEW` (409) rather than
 * returning a refusal, so a refusal cannot be mistaken for a zero-count
 * success by a caller that forgot to check.
 */
export async function closeBatch(
  ownerId: OwnerId,
  batchId: string,
  now: Date = new Date(),
): Promise<CloseResult> {
  const batch = await loadOwnedBatch(ownerId, batchId);
  const service = batch.service as Service;

  // ⚠ Read BEFORE the transition, not after. The candidate load is the input
  // to the pending guard, and a guard that ran after the batch had already
  // been marked `applied` could only refuse a batch it had itself closed.
  const { candidates, rows, suppressed } = await loadReviewCandidates(ownerId, batch.id, service);

  const pending = pendingAdditionIds(candidates);
  if (pending.length > 0) {
    throw new AppError(
      'PENDING_ADDITIONS',
      409,
      pending.length === 1
        ? '1 title still needs a decision.'
        : `${pending.length} titles still need a decision.`,
      // The client scrolls to and focuses the FIRST of these
      // (`specs/ux-states.md` §6.14), so the order must be the review's.
      { batchId: batch.id, pendingCandidateIds: pending },
    );
  }

  const applicable = applicableCandidates(candidates);
  const discarded = discardedCount(candidates);
  // Gated rows are absent from `candidates` by construction, so this is
  // counted from the raw rows the same read returned.
  const suppressedGated = rows.filter(
    (row) => row.resolvedWorkIdentity !== null && suppressed.has(row.resolvedWorkIdentity),
  ).length;

  const today = dateOnly(now);

  const summary = await runInTransaction(async (tx) => {
    let titlesCreated = 0;
    let listingsCreated = 0;
    let unresolvedKept = 0;
    let gatedInTransaction = 0;

    for (const { candidate, kind } of applicable) {
      const workIdentity = identityFor(candidate);

      // Property 3. Re-checked here because review and close are separate
      // requests and the store is the only thing that has seen both.
      if ((await findActiveSuppression(ownerId, workIdentity, tx)) !== null) {
        gatedInTransaction += 1;
        continue;
      }

      const existing = await findTitleByWorkIdentity(ownerId, workIdentity, tx);
      let titleId: string;

      if (existing === null || existing.state !== 'active') {
        titleId = await insertTitle(ownerId, tx, candidate, kind, workIdentity, batch.id, today);
        titlesCreated += 1;
        // REQ-068 / US-031 AC-6. Written INSIDE the transaction, immediately
        // after the mutation it describes: a change without provenance must
        // not be persisted, and only sharing the transaction can guarantee
        // that. A batch closed without this record can never be undone
        // correctly later — the information does not exist anywhere else.
        await recordBatchChange(
          ownerId,
          {
            batchId: batch.id,
            kind: 'title_created',
            titleId,
            nextValue: jsonScalar(workIdentity),
          },
          tx,
        );
      } else {
        titleId = existing.id;
        // Product invariant 6: the title-level date is the EARLIEST across its
        // listings. A work already on Netflix that now appears on Max keeps
        // the older date, so the combined list does not reorder itself just
        // because a second service was captured later.
        if (existing.sortDateAdded === null || existing.sortDateAdded > today) {
          await updateTitle(ownerId, titleId, { sortDateAdded: today }, tx);
        }
      }

      if (kind === 'unresolved') unresolvedKept += 1;

      const listingId = ulid();
      await createServiceListing(
        ownerId,
        {
          listingId,
          titleId,
          service,
          state: 'active',
          dateAdded: today,
          createdByBatchId: batch.id,
        },
        tx,
      );
      listingsCreated += 1;
      // §8.1: a listing added to an existing title is `created` with
      // `titleWasCreated: false`; a listing on a title this batch created
      // folds together with the row above into ONE §3.7 entry carrying both
      // ids. `toBatchProvenance` does the folding, so the two flavours are
      // distinguished in exactly one place.
      await recordBatchChange(
        ownerId,
        { batchId: batch.id, kind: 'listing_added', titleId, listingId },
        tx,
      );
    }

    await transitionBatch(
      ownerId,
      batch,
      'applied',
      'BATCH_NOT_IN_REVIEW',
      'That batch is not in review.',
      { completedAt: now },
      tx,
    );

    // US-022's factual per-service last-updated date (REQ-039). Written in the
    // same transaction as the listings it describes: a `lastCompletedBatchAt`
    // that survived a rolled-back close would tell the owner their list was
    // updated when it was not.
    await upsertServiceState(
      ownerId,
      service,
      { lastCompletedBatchId: batch.id, lastCompletedBatchAt: now },
      tx,
    );

    return {
      titlesCreated,
      listingsCreated,
      // TASK-083 to TASK-086. See the header: removal is never a side effect
      // of closing (REQ-020).
      listingsRemoved: 0,
      unresolvedKept,
      discarded,
      suppressedGated: suppressedGated + gatedInTransaction,
      removalGroupId: null,
    } satisfies CloseSummary;
  });

  return {
    batchId: batch.id,
    status: 'applied',
    completedAt: now.toISOString(),
    summary,
    serviceState: { service, lastCompletedBatchAt: now.toISOString() },
    // Derived from the state machine, never asserted. Undo itself is TASK-112,
    // but whether the batch is in a state undo could ever act on is already
    // knowable — and hard-coding `true` would keep reading `true` if the
    // transition were later removed.
    undoable: canTransition('applied', 'undone'),
  };
}
