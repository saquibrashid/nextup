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
 * ⚠ REMOVALS ARE APPLIED HERE (TASK-086/087/088), AND EVERY PART OF THAT IS
 * LOAD-BEARING.
 *
 * - **The confirmation gate counts PROPOSALS, not ticks.** An owner who
 *   unticked every row still has to confirm: they were shown a removal section
 *   and made a decision about it. Counting ticks would let a close the owner
 *   believes rescued two hundred titles proceed without ever asking them.
 * - **The gate runs BEFORE the transaction is opened**, so "a refusal writes
 *   nothing" needs no rollback to be true.
 * - **Unticking everything is a ZERO-MEMBER GROUP; a WITHHELD section is NO
 *   GROUP AT ALL.** The same distinction the review draws between `count: 0`
 *   and `omitted: true`. Withheld means the owner was never shown anything to
 *   confirm, so recording a group would log a decision nobody made and
 *   requiring confirmation would make the batch unclosable.
 * - **A removal group applies in full or not at all** (`PARTIAL_FAILURE_
 *   PREVENTED`). A half-applied group cannot be undone as a group, and the
 *   owner has no way to see which half landed.
 *
 * REQ-020 still holds: removal is never a *side effect* of closing. It happens
 * only when the owner explicitly confirmed it.
 */

import {
  applicableCandidates,
  deriveSortDateAdded,
  deriveTitleState,
  discardedCount,
  jsonScalar,
  pendingAdditionIds,
  removalWithheldReason,
  ulid,
  workIdentityForTmdb,
  workIdentityForUnmatched,
  type BatchMode,
  type CloseSummary,
  type CrossCheckOutcome,
  type ReviewCandidate,
  type Service,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { loadReviewCandidates, proposedRemovalsFrom } from '../routes/batchReview.js';
import { toIsoDate } from '../routes/titles.js';
import {
  createRemovalGroup,
  createServiceListing,
  createTitle,
  findActiveSuppression,
  findTitleByWorkIdentity,
  listListingsForTitle,
  listRemovalDecisions,
  recordBatchChange,
  runInTransaction,
  setCandidateResolvedTitles,
  softDeleteServiceListing,
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
 * The work identity the pipeline had proposed before the owner corrected it.
 *
 * `null` when it proposed nothing — an unmatched candidate the owner named by
 * hand genuinely has no prior identity, and inventing the `unmatched:` hash
 * here would record a value the row never actually held.
 */
function originalIdentityFor(candidate: ReviewCandidate): string | null {
  const top = candidate.alternatives[0];
  if (top === undefined) return null;
  return workIdentityForTmdb(top.mediaType, top.tmdbId);
}

/**
 * The TMDB metadata to store for `workIdentity` — chosen BY IDENTITY, never by
 * position.
 *
 * ⚠ THIS IS WHY A CORRECTION USED TO STORE THE WRONG FILM. `candidate.match`
 * is `alternatives[0]`, the original top match, and correcting a candidate
 * deliberately does NOT rewrite `matchCandidates` (the owner corrected the
 * decision, not the extraction). Reading `match` at close therefore built the
 * title from the identity the owner rejected: the row said `tmdb:movie:949`
 * while its `tmdb_id`, name, year and poster all still said 438631. Nothing
 * refuses that — `title_match_coherent` only checks null-ness, not agreement —
 * so the combined list would have shown the owner the very title they fixed,
 * under a work identity that suppression and dedup key on and would never
 * match it.
 *
 * When the corrected target is not among the alternatives there is no name to
 * store and none is invented: `tmdbId` and `tmdbMediaType` come from the
 * identity, and `tmdbFetchedAt` stays null so the lazy refresh (REQ-076,
 * NFR-014) fills the display fields on first access.
 */
function tmdbFieldsFor(
  candidate: ReviewCandidate,
  workIdentity: string,
): {
  tmdbId: number;
  tmdbMediaType: string;
  tmdbName: string | null;
  tmdbReleaseYear: number | null;
  tmdbPosterPath: string | null;
} | null {
  const parts = workIdentity.split(':');
  const mediaType = parts[1];
  const tmdbId = Number(parts[2]);
  if (parts[0] !== 'tmdb' || mediaType === undefined || !Number.isFinite(tmdbId)) return null;

  const known = candidate.alternatives.find(
    (alternative) =>
      alternative.tmdbId === tmdbId && String(alternative.mediaType) === String(mediaType),
  );

  return {
    tmdbId,
    tmdbMediaType: mediaType,
    tmdbName: known?.name ?? null,
    tmdbReleaseYear: known?.releaseYear ?? null,
    tmdbPosterPath: known?.posterPath ?? null,
  };
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
  const tmdb = tmdbFieldsFor(candidate, workIdentity);

  if (kind === 'addition' && tmdb !== null) {
    await createTitle(
      ownerId,
      {
        id,
        workIdentity,
        state: 'active',
        matchState: 'matched',
        ...tmdb,
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

export interface CloseOptions {
  /** `specs/api.md` §6.22. REQUIRED in full-update when removals are proposed. */
  confirmRemovals?: boolean;
}

/**
 * The removals this close will apply, or `null` when removals are not on the
 * table at all for this batch.
 *
 * ⚠ `null` and `{ ticked: [] }` are DIFFERENT and both meaningful — the same
 * distinction `omitted: true` vs `count: 0` draws in the review (product
 * invariant 2). `null` means the owner was never shown a removal section, so
 * no group is recorded and no confirmation is required. `{ ticked: [] }` means
 * they were shown one and unticked every row, which is a decision: a
 * zero-member group is recorded and the close still required confirmation.
 */
interface RemovalPlan {
  ticked: { listingId: string; titleId: string }[];
  proposedCount: number;
}

/**
 * Decide what this close will remove, and refuse it if the owner has not
 * confirmed.
 *
 * Runs BEFORE the transaction on purpose: a refusal must write nothing, and
 * the cheapest way to guarantee that is for the refusal to happen before
 * anything is opened. `T-REV-005` asserts the "nothing written" half directly.
 *
 * ⚠ THE GATE COUNTS PROPOSALS, NOT TICKS. An owner who unticked every row
 * still has to confirm: they were shown a removal section and made a decision
 * about it, and that decision is recorded as a zero-member group (US-015 AC-5,
 * `T-REV-007`). Counting ticks instead would let a close that the owner
 * believes rescued two hundred titles proceed without ever asking them.
 */
async function planRemovals(
  ownerId: OwnerId,
  batch: { id: string; mode: string; lowYield: boolean; crossCheck: string | null },
  service: Service,
  loaded: Awaited<ReturnType<typeof loadReviewCandidates>>,
  options: CloseOptions,
): Promise<RemovalPlan | null> {
  // REQ-022: an append-only batch proposes no removals, so absence changes
  // nothing (`T-REM-019`). No group, no gate.
  if ((batch.mode as BatchMode) !== 'full-update') return null;

  // Withheld is NOT an empty group — see the `RemovalPlan` doc comment. The
  // same function the review used, so the two cannot disagree about whether
  // the owner was shown anything to confirm.
  const withheld = removalWithheldReason({
    lowYield: batch.lowYield,
    crossCheck: (batch.crossCheck ?? 'ok') as CrossCheckOutcome,
  });
  if (withheld !== null) return null;

  const proposed = proposedRemovalsFrom(service, loaded);
  if (proposed.length === 0) return null;

  if (options.confirmRemovals !== true) {
    throw new AppError(
      'REMOVALS_NOT_CONFIRMED',
      409,
      proposed.length === 1
        ? '1 removal still needs confirming.'
        : `${proposed.length} removals still need confirming.`,
      { batchId: batch.id, removalCount: proposed.length },
    );
  }

  // Absence of a decision row means TICKED (REQ-055, TASK-085). Read here
  // rather than trusted from the request: the tick state belongs to the batch,
  // and a close that took it from its own body would let a client remove rows
  // the owner had rescued.
  const decisions = await listRemovalDecisions(ownerId, batch.id);
  const unticked = new Set(decisions.filter((d) => !d.ticked).map((d) => d.listingId));

  return {
    ticked: proposed
      .filter((item) => !unticked.has(item.listingId))
      .map((item) => ({ listingId: item.listingId, titleId: item.titleId })),
    proposedCount: proposed.length,
  };
}

/**
 * Apply a reviewed batch.
 *
 * Throws `PENDING_ADDITIONS` (409), `REMOVALS_NOT_CONFIRMED` (409) or
 * `BATCH_NOT_IN_REVIEW` (409) rather than returning a refusal, so a refusal
 * cannot be mistaken for a zero-count success by a caller that forgot to
 * check.
 */
export async function closeBatch(
  ownerId: OwnerId,
  batchId: string,
  now: Date = new Date(),
  options: CloseOptions = {},
): Promise<CloseResult> {
  const batch = await loadOwnedBatch(ownerId, batchId);
  const service = batch.service as Service;

  // ⚠ Read BEFORE the transition, not after. The candidate load is the input
  // to the pending guard, and a guard that ran after the batch had already
  // been marked `applied` could only refuse a batch it had itself closed.
  const loaded = await loadReviewCandidates(ownerId, batch.id, service);
  const { candidates, rows, suppressed } = loaded;

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

  const removalPlan = await planRemovals(ownerId, batch, service, loaded, options);

  const today = dateOnly(now);

  const summary = await runInTransaction(async (tx) => {
    let titlesCreated = 0;
    let listingsCreated = 0;
    let unresolvedKept = 0;
    let gatedInTransaction = 0;
    /** The candidate → Title links this close will flush (TASK-182). */
    const resolvedTitleLinks: { candidateId: string; titleId: string }[] = [];

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

      // TASK-182. Recorded for BOTH branches: "which title did this read
      // become" is as true of a candidate that attached to a pre-existing
      // title as of one that created a new one, and restricting it to
      // creations would make the column mean something narrower than its name.
      resolvedTitleLinks.push({ candidateId: candidate.candidateId, titleId });

      // REQ-068 / §8.1: "match corrected during review" is a `modified` entry
      // carrying the BEFORE value. It is written here, at close, and not at
      // PATCH time for two reasons: the title id the §3.7 shape requires does
      // not exist until now, and a batch the owner discards must leave no
      // provenance behind at all.
      //
      // ⚠ The before value is `alternatives[0]`, NOT `resolvedWorkIdentity` —
      // the correction overwrote that column, and `matchCandidates` is the
      // only surviving record of what the pipeline had proposed. `null` means
      // the pipeline proposed nothing, which is a real answer and not a
      // missing read.
      if (candidate.disposition === 'corrected') {
        const before = originalIdentityFor(candidate);
        if (before !== workIdentity) {
          await recordBatchChange(
            ownerId,
            {
              batchId: batch.id,
              kind: 'attr_modified',
              titleId,
              attr: 'workIdentity',
              prevValue: before === null ? null : jsonScalar(before),
              nextValue: jsonScalar(workIdentity),
            },
            tx,
          );
        }
      }

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

    // TASK-182 — point each applied candidate at the Title it resolved to.
    //
    // ⚠ AFTER THE LOOP, NOT INSIDE IT. `fk_cand_resolved_title` is a real
    // foreign key, so the link cannot precede its title; flushing once here
    // also keeps the per-candidate critical section as it was rather than
    // adding a sixth round trip to it.
    //
    // ⚠ ONE STATEMENT PER CANDIDATE, NOT PER TITLE. Two applied candidates for
    // one work would need two listings on one service, which
    // listing_one_per_service refuses — SD-02 collapses them at review so it
    // never reaches close. Grouping was therefore a branch nothing legitimate
    // could exercise; the statement count is identical either way.
    //
    // ⚠ SD-02-COLLAPSED CANDIDATES ARE DELIBERATELY NOT LINKED. They are
    // absent from `applicable` by construction, and their
    // `collapsedIntoCandidateId` already names the survivor, which now names
    // the title — so the link is derivable in one hop. Writing it twice would
    // create a second thing that can disagree with the first.
    await setCandidateResolvedTitles(ownerId, resolvedTitleLinks, tx);

    // ── removals (TASK-086/087/088) ─────────────────────────────────────
    //
    // AFTER the additions, and in the same transaction. Order matters here in
    // one direction only: a work that this batch both re-adds and would have
    // removed cannot exist (a candidate resolving to a listing's work is
    // exactly what stops it being proposed), but running removals first would
    // make that assumption load-bearing instead of incidental.
    let listingsRemoved = 0;
    let removalGroupId: string | null = null;

    if (removalPlan !== null) {
      const groupId = ulid();
      // ⚠ The group is created even when NOTHING is ticked (`T-REV-007`). The
      // owner unticking every row is a decision they made about a group they
      // were shown, and the batch history must be able to say so; a group that
      // only appeared when something was removed would make "I rescued all of
      // them" indistinguishable from "there was nothing to remove".
      await createRemovalGroup(ownerId, { id: groupId, batchId: batch.id }, tx);
      removalGroupId = groupId;

      for (const item of removalPlan.ticked) {
        const changed = await softDeleteServiceListing(
          ownerId,
          item.listingId,
          { removedByBatchId: batch.id, removedByGroupId: groupId, removedAt: now },
          tx,
        );
        // ⚠ PARTIAL-FAILURE PREVENTION (US-015 AC-7, `T-REM-015`). The update
        // is guarded on `state: 'active'`, so zero rows means the listing
        // stopped being active between the proposal and this write. Throwing
        // rolls the WHOLE close back: a removal group is applied in full or
        // not at all, because a half-applied group cannot be undone as a group
        // and the owner has no way to see which half landed.
        if (changed.count !== 1) {
          throw new AppError(
            'PARTIAL_FAILURE_PREVENTED',
            409,
            'One of those titles changed while you were reviewing. Nothing was changed.',
            { batchId: batch.id, listingId: item.listingId },
          );
        }

        // §3.7 requires the group id on every removed entry, because US-017
        // undoes a GROUP rather than a listing. It travels in `nextValue`.
        await recordBatchChange(
          ownerId,
          {
            batchId: batch.id,
            kind: 'listing_removed',
            titleId: item.titleId,
            listingId: item.listingId,
            nextValue: jsonScalar(groupId),
          },
          tx,
        );
        listingsRemoved += 1;

        // Invariant I-4: the stored derived fields must always equal what
        // `derive.ts` returns. Recomputed from the title's WHOLE listing set,
        // so a two-badge title keeps its other badge and stays in the list
        // (`T-REM-017`) while a title whose last active listing just went
        // becomes `removed` with a null date (`T-REM-018`).
        const siblings = (await listListingsForTitle(ownerId, item.titleId, tx)).map((row) => ({
          state: row.state as 'active' | 'removed',
          dateAdded: toIsoDate(row.dateAdded),
        }));
        const nextDate = deriveSortDateAdded(siblings);
        await updateTitle(
          ownerId,
          item.titleId,
          {
            state: deriveTitleState(siblings),
            sortDateAdded: nextDate === null ? null : new Date(`${nextDate}T00:00:00.000Z`),
          },
          tx,
        );
      }
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
      listingsRemoved,
      unresolvedKept,
      discarded,
      suppressedGated: suppressedGated + gatedInTransaction,
      removalGroupId,
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
