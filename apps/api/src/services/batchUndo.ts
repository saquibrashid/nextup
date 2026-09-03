/**
 * TASK-112 — `POST /api/batches/:batchId/undo`, creates-only
 * (`specs/api.md` §6.25, `specs/data-model.md` §8.3, SD-03, REQ-067, US-032).
 *
 * ⚠ SCOPE. This module implements the CREATES-ONLY undo, the two lifecycle
 * refusals (`BATCH_ALREADY_UNDONE`, `BATCH_NOT_APPLIED`), and the §8.4 refusal
 * ENUMERATION (TASK-114, REQ-075, US-033) — every created/modified/removed
 * entry with its per-item remedy, per-title `currentState`, and
 * `truncated: false`. The `later-owner-edits` detection (TASK-113) is NOT here:
 * it is not decidable from provenance alone, is owner-gated, and its literal is
 * kept in the `reason` union only so the shape does not change when it lands.
 *
 * ⚠ THE WHOLE UNDO IS ONE TRANSACTION. Discarding titles, discarding listings,
 * re-deriving survivors, moving the batch to `undone` and reverting
 * `serviceState` are five writes that are only correct together. A failure
 * halfway through the first four leaves list rows gone with the batch still
 * `applied` — which reads to the owner as "undo did nothing" while the titles
 * are already destroyed, and there is no soft-deleted copy to recover from
 * because SD-03 discards. Thread `tx` through EVERY call below.
 */

import {
  createsOnlyRefusalReason,
  deriveSortDateAdded,
  detectLaterOwnerEdits,
  deriveTitleState,
  isCreatesOnly,
  planCreatesOnlyUndo,
  toBatchProvenance,
} from '@nextup/domain';
import type { BatchProvenance, LaterOwnerEdit } from '@nextup/domain';
import type {
  UndoRefusalCreatedEntry,
  UndoRefusalCurrentState,
  UndoRefusalDetails,
  UndoRefusalModifiedEntry,
  UndoRefusalReason,
  UndoRefusalRemovedEntry,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import {
  type Db,
  type OwnerId,
  countBatchCreatedEffects,
  findPreviousAppliedBatch,
  findUploadBatch,
  listActiveSuppressions,
  listBatchChanges,
  listCandidatesForBatch,
  listListingsForTitle,
  listServiceListingStatesByIds,
  listTitleDisplaysByIds,
  runInTransaction,
  transitionUploadBatchStatus,
  updateTitle,
  upsertServiceState,
} from '../repository/ownerData.js';
import {
  detachReferencesToDiscarded,
  discardCreatedListings,
  discardCreatedTitles,
} from '../repository/undoDiscard.js';
import { toIsoDate } from '../routes/titles.js';

export interface UndoResult {
  batchId: string;
  status: 'undone';
  undoneAt: string;
  reversed: { titlesDeleted: number; listingsRemoved: number };
  serviceState: { service: string; lastCompletedBatchAt: string | null };
}

/**
 * Undo a creates-only batch.
 *
 * @throws AppError 404 `NOT_FOUND`, 409 `BATCH_ALREADY_UNDONE`,
 *   409 `BATCH_NOT_APPLIED`, 409 `BATCH_NOT_CREATES_ONLY`.
 */
export async function undoBatch(ownerId: OwnerId, batchId: string): Promise<UndoResult> {
  const batch = await findUploadBatch(ownerId, batchId);
  // 404 rather than 403 for somebody else's id (NFR-008): a 403 confirms the
  // row exists, which is information the caller is not entitled to.
  if (batch === null) throw new AppError('NOT_FOUND', 404, 'No such batch.');

  // ⚠ Checked BEFORE `BATCH_NOT_APPLIED`, and the order is the contract.
  // `undone` is not `applied`, so the generic check would swallow the specific
  // one and a second undo would be reported as "that batch was never applied"
  // — which is both false and unactionable.
  if (batch.status === 'undone') {
    throw new AppError('BATCH_ALREADY_UNDONE', 409, 'That batch has already been undone.', {
      batchId,
      undoneAt: batch.undoneAt?.toISOString() ?? null,
    });
  }

  if (batch.status !== 'applied') {
    throw new AppError('BATCH_NOT_APPLIED', 409, 'Only an applied batch can be undone.', {
      batchId,
      status: batch.status,
    });
  }

  const changeRows = await listBatchChanges(ownerId, batchId);
  const provenance = toBatchProvenance(changeRows);

  // §8.4 `provenance-unavailable` (US-033 AC-7). No `batch_change` rows can mean
  // one of two things that look identical here: a batch that legitimately
  // created nothing (undo is a no-op, US-032 AC-5), or a batch whose provenance
  // was lost. Only the downstream effects tell them apart — a batch with no
  // provenance but real created rows cannot be reversed and must be REFUSED,
  // enumerated as far as it can be, rather than silently no-op'd into
  // destroying rows it has no record of. US-031 AC-6 makes this unreachable in
  // normal operation; the branch exists because the refusal must stay
  // actionable if it ever is reached.
  if (changeRows.length === 0) {
    const effects = await countBatchCreatedEffects(ownerId, batchId);
    if (effects > 0) {
      throw new AppError(
        'BATCH_NOT_CREATES_ONLY',
        409,
        'This batch cannot be undone as a whole.',
        await buildRefusalDetails(ownerId, batchId, null),
      );
    }
  }

  if (!isCreatesOnly(provenance)) {
    throw new AppError(
      'BATCH_NOT_CREATES_ONLY',
      409,
      'This batch cannot be undone as a whole.',
      await buildRefusalDetails(ownerId, batchId, provenance),
    );
  }

  // TASK-113 (US-032 AC-4) — creates-only BY PROVENANCE is not the same as safe
  // to reverse. If the owner has since suppressed or fix-matched one of the
  // titles this batch created, undoing would DISCARD (SD-03, a hard delete)
  // a row carrying a decision the batch has no record of and cannot restore.
  // Refused and enumerated, never partially applied.
  const laterEdits = await findLaterOwnerEdits(ownerId, batchId, provenance);
  if (laterEdits.length > 0) {
    throw new AppError(
      'BATCH_NOT_CREATES_ONLY',
      409,
      'This batch cannot be undone as a whole.',
      await buildRefusalDetails(ownerId, batchId, provenance, 'later-owner-edits'),
    );
  }

  const plan = planCreatesOnlyUndo(provenance);
  // ⚠ Read the predecessor BEFORE the transaction moves this batch out of
  // `applied`. Doing it inside would still be correct today because the query
  // excludes this batch by id, but it makes the revert depend on that
  // exclusion staying exactly as written.
  const previous = await findPreviousAppliedBatch(ownerId, batch.service, batchId);
  const revertedTo = previous?.completedAt ?? null;

  const undoneAt = new Date();

  return runInTransaction(async (tx) => {
    // ⚠ The status move is FIRST and is conditional on `applied`. It is the
    // concurrency control, not bookkeeping: two concurrent undos both read
    // `applied` above, and without a conditional write both would proceed to
    // discard — the second one deleting nothing and reporting a successful
    // undo of rows the first already destroyed. Exactly one caller can see a
    // count of 1 here.
    const claimed = await transitionUploadBatchStatus(
      ownerId,
      batchId,
      'applied',
      { status: 'undone', undoneAt },
      tx,
    );
    if (claimed === 0) {
      throw new AppError('BATCH_ALREADY_UNDONE', 409, 'That batch has already been undone.', {
        batchId,
      });
    }

    const listingsUnderTitles = await listingIdsUnder(ownerId, plan.titleIdsToDiscard, tx);

    // ⚠ BEFORE the deletes. Provenance and retained candidates hold plain FKs
    // onto the rows about to go, and only `service_listing → title` cascades.
    await detachReferencesToDiscarded(
      ownerId,
      plan.titleIdsToDiscard,
      [...listingsUnderTitles, ...plan.listingIdsToDiscard],
      tx,
    );

    const titlesDeleted = await discardCreatedTitles(ownerId, plan.titleIdsToDiscard, tx);
    const listingsDeleted = await discardCreatedListings(ownerId, plan.listingIdsToDiscard, tx);

    await rederiveSurvivors(ownerId, plan.titleIdsToRederive, tx);

    await upsertServiceState(
      ownerId,
      batch.service,
      {
        lastCompletedBatchId: previous?.id ?? null,
        lastCompletedBatchAt: revertedTo,
      },
      tx,
    );

    return {
      batchId,
      status: 'undone' as const,
      undoneAt: undoneAt.toISOString(),
      reversed: {
        titlesDeleted,
        // Listings the cascade took plus listings discarded directly. The
        // owner counts rows that left their list, not rows this code named.
        listingsRemoved: listingsUnderTitles.length + listingsDeleted,
      },
      serviceState: {
        service: batch.service,
        lastCompletedBatchAt: revertedTo?.toISOString() ?? null,
      },
    };
  });
}

/**
 * Every listing id the cascade is about to take.
 *
 * ⚠ Read BEFORE the delete, obviously, but also READ rather than inferred from
 * the plan: a discarded title may carry listings this batch never created — a
 * second service added later by another batch — and those rows leave the
 * owner's list too. Reporting only what this batch added would under-count
 * what the owner actually loses, and detaching only those ids would leave the
 * other listing's provenance FK pointing at a row the cascade removed.
 */
async function listingIdsUnder(
  ownerId: OwnerId,
  titleIds: readonly string[],
  tx: Db,
): Promise<string[]> {
  const ids: string[] = [];
  for (const titleId of titleIds) {
    for (const row of await listListingsForTitle(ownerId, titleId, tx)) ids.push(row.listingId);
  }
  return ids;
}

/**
 * Recompute `state` and `sortDateAdded` for titles that kept listings.
 *
 * ⚠ Both values are DERIVED (invariant I-4) and must equal what `derive.ts`
 * computes. Leaving `sortDateAdded` behind after removing the listing that set
 * it would pin the row at a position no surviving listing justifies — and the
 * title-level date sort is the earliest date across the title's listings, so
 * the stale value is always the wrong one in the direction that keeps the row
 * looking newer than it is.
 *
 * ⚠ A title left with ZERO listings is an I-3 violation, not a state to write.
 * `deriveTitleState` throws on it deliberately; that throw aborts the whole
 * transaction, which is the correct outcome — the alternative is persisting a
 * title nothing can reach.
 */
async function rederiveSurvivors(
  ownerId: OwnerId,
  titleIds: readonly string[],
  tx: Db,
): Promise<void> {
  for (const titleId of titleIds) {
    const listings = (await listListingsForTitle(ownerId, titleId, tx)).map((row) => ({
      state: row.state as 'active' | 'removed',
      dateAdded: toIsoDate(row.dateAdded),
    }));
    const nextDate = deriveSortDateAdded(listings);
    await updateTitle(
      ownerId,
      titleId,
      {
        state: deriveTitleState(listings),
        // ⚠ Stored as a `DateTime2`, so the derived `YYYY-MM-DD` is widened at
        // midnight UTC — the same conversion `batchClose.ts` performs. Passing
        // the bare string would be silently coerced by the driver in a local
        // timezone and could shift the row by a day.
        sortDateAdded: nextDate === null ? null : new Date(`${nextDate}T00:00:00.000Z`),
      },
      tx,
    );
  }
}

/* ── §8.4 refusal enumeration (TASK-114, REQ-075, US-033) ─────────────────── */

/**
 * ⚠ THE §8.4 REFUSAL TYPES NOW LIVE IN `@nextup/domain`, NOT HERE. They are
 * re-exported so existing importers of this module keep working, but the
 * declaration is shared because `apps/web`'s refusal panel renders the same
 * contract and must fail to compile when this shape changes.
 */
export type {
  UndoRefusalCreatedEntry,
  UndoRefusalCurrentState,
  UndoRefusalDetails,
  UndoRefusalEntry,
  UndoRefusalModifiedEntry,
  UndoRefusalReason,
  UndoRefusalRemovedEntry,
} from '@nextup/domain';

interface TitleDisplay {
  workIdentity: string;
  state: UndoRefusalCurrentState;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
}

/**
 * Read the rows `detectLaterOwnerEdits` needs and run it (TASK-113, US-032
 * AC-4).
 *
 * ⚠ **READ-ONLY, like `buildRefusalDetails`.** `T-UNDO-005` snapshots the owner
 * partition around a refusal and asserts equality: asking whether an undo is
 * allowed must never change anything.
 *
 * ⚠ **THE CANDIDATE IS THE ONLY RECORD OF THE IDENTITY THE BATCH CHOSE.**
 * `batch_change` holds no `create_title` identity, and suppression writes no
 * change row at all (`T-PROV-013`), so there is nothing in the ledger to
 * compare against — `extraction_candidate.resolvedWorkIdentity` is it. Undo
 * detaches `resolved_title_id` (TASK-112), but only on a SUCCESSFUL undo, and
 * this runs before one.
 */
async function findLaterOwnerEdits(
  ownerId: OwnerId,
  batchId: string,
  provenance: BatchProvenance,
): Promise<LaterOwnerEdit[]> {
  if (provenance.created.length === 0) return [];

  const titleIds = [...new Set(provenance.created.map((entry) => entry.titleId))];
  const [titleRows, candidates, suppressions] = await Promise.all([
    listTitleDisplaysByIds(ownerId, titleIds),
    listCandidatesForBatch(ownerId, batchId),
    listActiveSuppressions(ownerId),
  ]);

  const currentIdentityByTitleId = new Map(titleRows.map((row) => [row.id, row.workIdentity]));

  // ⚠ CONFIRMED ONLY. A discarded candidate's identity is a reachable
  // fix-match target, so leaving it in the set would silently permit the undo
  // that moved a title onto it. Confirmed identities cannot be reached by a
  // fix-match (the work-identity unique index refuses the collision), so
  // narrowing here loses nothing and closes the hole.
  const identitiesResolvedByBatch = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.reviewDisposition !== 'confirmed') continue;
    if (candidate.resolvedWorkIdentity === null) continue;
    identitiesResolvedByBatch.add(candidate.resolvedWorkIdentity);
  }

  return detectLaterOwnerEdits({
    created: provenance.created,
    currentIdentityByTitleId,
    identitiesResolvedByBatch,
    suppressedWorks: new Set(suppressions.map((row) => row.workIdentity)),
  });
}

/**
 * Build the §8.4 `details` payload for a non-creates-only (or
 * provenance-unavailable) batch.
 *
 * ⚠ READ-ONLY. `T-UNDO-005` snapshots the owner partition before and after a
 * refusal and asserts equality; this must not write. It reads the CURRENT
 * title/listing/suppression rows so each entry's `currentState` reflects what
 * has happened to the work SINCE the batch — a title the batch touched that has
 * since been removed or suppressed STILL APPEARS, annotated (US-033 AC-6).
 * Filtering those out is the tempting bug: it loses exactly the entries the
 * owner most needs to see.
 *
 * @param provenance the batch's provenance, or `null` when it could not be read
 *   (`reason: 'provenance-unavailable'`, US-033 AC-7).
 */
async function buildRefusalDetails(
  ownerId: OwnerId,
  batchId: string,
  provenance: BatchProvenance | null,
  reasonOverride?: UndoRefusalReason,
): Promise<UndoRefusalDetails> {
  // ⚠ The override exists for `later-owner-edits` ONLY, and it is a parameter
  // rather than a second builder because the ENUMERATION is identical: the
  // owner needs the same actionable list of what the batch touched whichever
  // way it was refused. `createsOnlyRefusalReason` cannot produce this value —
  // by provenance the batch really is creates-only.
  const reason = reasonOverride ?? createsOnlyRefusalReason(provenance) ?? 'modified-or-removed';

  // Provenance-unavailable: there is nothing to enumerate, but the refusal must
  // still be a structured, actionable §8.4 body rather than a bare 409.
  if (provenance === null) {
    return { batchId, reason, created: [], modified: [], removed: [], truncated: false };
  }

  const titleIds = [
    ...new Set([
      ...provenance.created.map((entry) => entry.titleId),
      ...provenance.modified.map((entry) => entry.titleId),
      ...provenance.removed.map((entry) => entry.titleId),
    ]),
  ];
  const listingIds = provenance.removed.map((entry) => entry.listingId);

  const [titleRows, listingRows, suppressions] = await Promise.all([
    listTitleDisplaysByIds(ownerId, titleIds),
    listServiceListingStatesByIds(ownerId, listingIds),
    listActiveSuppressions(ownerId),
  ]);

  const titles = new Map<string, TitleDisplay>(
    titleRows.map((row) => [
      row.id,
      {
        workIdentity: row.workIdentity,
        state: row.state === 'removed' ? 'removed' : 'active',
        name: row.tmdbName ?? row.rawExtractedText ?? '(unknown title)',
        releaseYear: row.tmdbReleaseYear,
        posterPath: row.tmdbPosterPath,
      },
    ]),
  );
  const listingStates = new Map<string, UndoRefusalCurrentState>(
    listingRows.map((row) => [row.listingId, row.state === 'removed' ? 'removed' : 'active']),
  );
  const suppressedWorks = new Set(suppressions.map((row) => row.workIdentity));

  // A title named by provenance that is somehow no longer readable is still
  // enumerated — never dropped — so the count the owner sees matches what the
  // batch touched.
  const display = (titleId: string): TitleDisplay =>
    titles.get(titleId) ?? {
      workIdentity: '',
      state: 'removed',
      name: '(unavailable)',
      releaseYear: null,
      posterPath: null,
    };

  const currentState = (
    titleId: string,
    fallback: UndoRefusalCurrentState,
  ): UndoRefusalCurrentState => {
    const info = titles.get(titleId);
    if (info !== undefined && suppressedWorks.has(info.workIdentity)) return 'suppressed';
    return fallback;
  };

  const created: UndoRefusalCreatedEntry[] = provenance.created.map((entry) => {
    const info = display(entry.titleId);
    return {
      titleId: entry.titleId,
      name: info.name,
      releaseYear: info.releaseYear,
      posterPath: info.posterPath,
      currentState: currentState(entry.titleId, info.state),
      remedy: 'not-interested',
      remedyHref: `/api/titles/${entry.titleId}/suppress`,
    };
  });

  const modified: UndoRefusalModifiedEntry[] = provenance.modified.map((entry) => {
    const info = display(entry.titleId);
    return {
      titleId: entry.titleId,
      name: info.name,
      releaseYear: info.releaseYear,
      posterPath: info.posterPath,
      attr: entry.attr,
      before: entry.before,
      currentState: currentState(entry.titleId, info.state),
      remedy: 'fix-match',
      remedyHref: `/api/titles/${entry.titleId}/fix-match`,
    };
  });

  const removed: UndoRefusalRemovedEntry[] = provenance.removed.map((entry) => {
    const info = display(entry.titleId);
    return {
      titleId: entry.titleId,
      listingId: entry.listingId,
      name: info.name,
      releaseYear: info.releaseYear,
      posterPath: info.posterPath,
      // The remedy is `restore`, so the actionable state is the LISTING's — is
      // it still removed? — falling back to the title's when the listing row
      // could not be read. Suppression still wins: a restore onto a suppressed
      // work is held back.
      currentState: currentState(entry.titleId, listingStates.get(entry.listingId) ?? info.state),
      remedy: 'restore',
      remedyHref: `/api/listings/${entry.listingId}/restore`,
    };
  });

  return { batchId, reason, created, modified, removed, truncated: false };
}
