/**
 * TASK-112 — `POST /api/batches/:batchId/undo`, creates-only
 * (`specs/api.md` §6.25, `specs/data-model.md` §8.3, SD-03, REQ-067, US-032).
 *
 * ⚠ SCOPE. This module implements the CREATES-ONLY undo and the two lifecycle
 * refusals (`BATCH_ALREADY_UNDONE`, `BATCH_NOT_APPLIED`). The §8.4 refusal
 * ENUMERATION — every created/modified/removed entry with its per-item remedy
 * and `truncated: false` — is TASK-114, and the `later-owner-edits` detection
 * is TASK-113. Until those land, a non-creates-only batch is refused with the
 * right code and the right `reason` but a `details` payload carrying only the
 * batch id. That is deliberately visible rather than silently absent: the
 * refusal is a FEATURE (REQ-075), not an error path, and shipping it as a bare
 * 409 with no marker would leave nothing for the later task to find.
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
  deriveSortDateAdded,
  deriveTitleState,
  isCreatesOnly,
  planCreatesOnlyUndo,
  toBatchProvenance,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import {
  type Db,
  type OwnerId,
  findPreviousAppliedBatch,
  findUploadBatch,
  listBatchChanges,
  listListingsForTitle,
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

  const provenance = toBatchProvenance(await listBatchChanges(ownerId, batchId));

  if (!isCreatesOnly(provenance)) {
    // TASK-114 replaces `details` with the full §8.4 enumeration. The `reason`
    // is already the spec's value so the shape only grows.
    throw new AppError('BATCH_NOT_CREATES_ONLY', 409, 'This batch cannot be undone as a whole.', {
      batchId,
      reason: 'modified-or-removed',
      truncated: false,
    });
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
