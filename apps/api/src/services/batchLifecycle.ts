/**
 * TASK-054 — the batch state machine (`specs/api.md` §6.13–§6.25, US-005).
 *
 * One table decides every legal status change in the product. Submit, retry,
 * close, discard and undo all route through it, so there is exactly one place
 * to read to know what a batch can do next.
 *
 * Three properties are load-bearing, and each one fails silently if it is
 * relaxed:
 *
 *   1. **The table is TOTAL over `BATCH_STATUSES`.** It is typed as a
 *      `Record<BatchStatus, …>`, so adding a status to the enum without
 *      deciding its outgoing edges is a compile error rather than a status
 *      from which nothing — or anything — is permitted. A partial lookup map
 *      would answer `undefined` for the new status, and the natural
 *      `?? []`/`?? ALL` default silently either strands the batch or opens
 *      every door.
 *
 *   2. **A terminal status can never lead back to an OPEN one**, asserted
 *      against `TERMINAL_BATCH_STATUSES` rather than assumed (`T-BATCH-017`).
 *      If a closed batch could reopen, the owner would have two open batches
 *      and two full-update reconciliations could interleave (product
 *      invariant 3, `specs/api.md` §5).
 *
 *      ⚠ "Terminal" does NOT mean "no outgoing edge", and conflating the two
 *      is a mistake this file made first time round: `applied` is terminal —
 *      the owner may start another batch — and still transitions, to `undone`
 *      (§6.25). Terminal means *no longer blocks a new batch*. The property
 *      that must hold is the one-way-ness, not the absence of edges.
 *      ~~Superseded: "The terminal statuses have NO outgoing edges, and that
 *      agrees with `TERMINAL_BATCH_STATUSES`."~~
 *
 *   3. **The transition is applied CONDITIONALLY on the source status**, in
 *      the same statement that writes the new one. Checking the status in
 *      JavaScript and then writing it is a read-modify-write across an `await`
 *      boundary: two concurrent submits both read `draft`, both pass the
 *      guard, and extraction runs twice on one batch. `transitionBatch` uses
 *      an `UPDATE … WHERE status = @from` and treats a zero row count as the
 *      loser of the race, not as a missing batch.
 *
 * ⚠ The error code is supplied BY THE CALLER, not chosen here. `specs/api.md`
 * names a different code per endpoint for the same shape of failure —
 * `BATCH_NOT_DRAFT` on submit (§6.14), `BATCH_NOT_FAILED` on retry (§6.16),
 * `BATCH_NOT_IN_REVIEW` on close (§6.22), `BATCH_NOT_APPLIED` on undo (§6.25)
 * — because the code is what tells the SPA which remedy to offer. A single
 * generic "illegal transition" code would be tidier here and useless there.
 */

import { BATCH_STATUSES, isBatchOpen, type BatchStatus, type ErrorCode } from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import {
  findUploadBatch,
  listImagesForBatch,
  transitionUploadBatchStatus,
  type Db,
  type OwnerId,
} from '../repository/ownerData.js';

/**
 * Every legal status change, from `specs/api.md` §6.13–§6.25.
 *
 * ⚠ `submitted` and `extracting` cannot be discarded. §6.23 lists discard as
 * valid from `draft`, `in-review` and `extraction-failed` only, and the
 * omission is deliberate rather than an oversight in the spec: extraction is
 * running in-process against that batch, and letting the owner discard it
 * mid-flight would leave a runner writing candidates to a batch the owner has
 * been told no longer exists. The owner waits for it to reach `in-review` or
 * `extraction-failed`, both of which discard.
 *
 * ⚠ `extraction-failed → submitted` is RETRY (§6.16), and it deliberately
 * re-enters the same batch rather than deriving a new one. Re-extraction
 * (§6.24) is the different operation that creates a derived batch, and the two
 * must not be collapsed: retry keeps the batch id the owner is looking at.
 */
export const BATCH_TRANSITIONS: Readonly<Record<BatchStatus, readonly BatchStatus[]>> = {
  draft: ['submitted', 'discarded'],
  submitted: ['extracting', 'extraction-failed'],
  extracting: ['in-review', 'extraction-failed'],
  'extraction-failed': ['submitted', 'discarded'],
  'in-review': ['applied', 'discarded'],
  applied: ['undone'],
  undone: [],
  discarded: [],
};

/**
 * The statuses in which `service` and `mode` may still be changed (US-003
 * AC-6, `specs/api.md` §6.14).
 *
 * `draft` only. Once extraction has been queued the candidates are being
 * produced against a declared service, and in `full-update` the mode decides
 * whether titles get REMOVED — so a mode change after submit would retarget a
 * destructive reconciliation at a service whose screenshots were never read.
 */
export const MUTABLE_BATCH_STATUSES = ['draft'] as const;

/** Statuses a discard is offered from (`specs/api.md` §6.23). */
export const DISCARDABLE_BATCH_STATUSES = BATCH_STATUSES.filter((status) =>
  BATCH_TRANSITIONS[status].includes('discarded'),
);

/** Is `to` reachable from `from` in one step? */
export function canTransition(from: BatchStatus, to: BatchStatus): boolean {
  return BATCH_TRANSITIONS[from].includes(to);
}

/** The batch, or a 404 — never a 403, which would confirm the id exists (NFR-008). */
export async function loadOwnedBatch(ownerId: OwnerId, batchId: string) {
  const batch = await findUploadBatch(ownerId, batchId);
  if (!batch) {
    throw new AppError('NOT_FOUND', 404, 'No such batch.');
  }
  return batch;
}

/**
 * Refuses a change to `service` or `mode` after submit (US-003 AC-6,
 * `T-BATCH-013`).
 *
 * Separate from the transition table because it is not a transition: it
 * guards the batch's *declared* fields, which are frozen a full state earlier
 * than the batch itself becomes terminal.
 */
export function assertBatchMutable(batch: { id: string; status: string }): void {
  if (!(MUTABLE_BATCH_STATUSES as readonly string[]).includes(batch.status)) {
    throw new AppError(
      'BATCH_IMMUTABLE',
      409,
      'This batch has already been submitted, so its service and mode can no longer be changed.',
      { batchId: batch.id, status: batch.status, mutableIn: [...MUTABLE_BATCH_STATUSES] },
    );
  }
}

/**
 * Applies a transition, or throws the caller's code.
 *
 * The legality check and the write are one statement (property 3 above). A
 * zero row count means another request moved the batch first — reported with
 * the same code as an outright illegal transition, because from the client's
 * point of view they are the same event: the batch is no longer in the state
 * the request assumed.
 */
export async function transitionBatch(
  ownerId: OwnerId,
  batch: { id: string; status: string },
  to: BatchStatus,
  illegalCode: ErrorCode,
  message: string,
  fields: { submittedAt?: Date; completedAt?: Date; undoneAt?: Date } = {},
  /**
   * Optional transaction handle. Close threads its own through so the status
   * flip and the list writes commit or roll back together (product invariant
   * 3) — a batch marked `applied` beside listings that were never written is
   * exactly the half-applied state the transaction exists to prevent.
   */
  tx?: Db,
): Promise<BatchStatus> {
  const from = batch.status as BatchStatus;
  const refuse = (): never => {
    throw new AppError(illegalCode, 409, message, {
      batchId: batch.id,
      status: batch.status,
      // The states this transition IS legal from, so the SPA can say what the
      // owner would have to do first rather than only that it refused.
      expectedOneOf: BATCH_STATUSES.filter((candidate) =>
        BATCH_TRANSITIONS[candidate].includes(to),
      ),
    });
  };

  if (!(BATCH_STATUSES as readonly string[]).includes(from) || !canTransition(from, to)) {
    return refuse();
  }

  const changed = await transitionUploadBatchStatus(
    ownerId,
    batch.id,
    from,
    {
      status: to,
      ...fields,
    },
    tx,
  );
  if (changed === 0) {
    return refuse();
  }
  return to;
}

/** The §6.14 poll interval, in milliseconds. Named so the SPA and the spec agree. */
export const SUBMIT_POLL_AFTER_MS = 2000;

export interface SubmitResult {
  batchId: string;
  status: BatchStatus;
  imageCount: number;
  submittedAt: string;
  pollAfterMs: number;
}

/**
 * `POST /api/batches/:batchId/submit` (§6.14).
 *
 * ⚠ The empty-batch check is a **400 `NO_IMAGES`**, not a 409, and it is made
 * before the transition — but only while the batch is still `draft`, so a
 * second submit of an empty-but-already-submitted batch still reports the
 * 409 the client is waiting for rather than changing its answer.
 *
 * Refusing an empty submit is cheap protection for product invariant 2: an
 * extraction over zero images can only report zero candidates, and in
 * `full-update` zero candidates is indistinguishable downstream from a
 * service whose list is genuinely now empty.
 */
export async function submitBatch(
  ownerId: OwnerId,
  batchId: string,
  now: Date = new Date(),
): Promise<SubmitResult> {
  const batch = await loadOwnedBatch(ownerId, batchId);

  const images = await listImagesForBatch(ownerId, batchId);
  if (images.length === 0 && batch.status === 'draft') {
    throw new AppError('NO_IMAGES', 400, 'Add at least one screenshot before submitting.', {
      batchId,
    });
  }

  await transitionBatch(
    ownerId,
    batch,
    'submitted',
    'BATCH_NOT_DRAFT',
    'This batch has already been submitted.',
    { submittedAt: now },
  );

  return {
    batchId,
    status: 'submitted',
    imageCount: images.length,
    submittedAt: now.toISOString(),
    pollAfterMs: SUBMIT_POLL_AFTER_MS,
  };
}

export interface DiscardResult {
  batchId: string;
  status: BatchStatus;
  listStateChanged: boolean;
}

/**
 * `POST /api/batches/:batchId/discard` (§6.23, US-005 AC-4).
 *
 * Writes NOTHING to the list — no listing is created, none is removed, and no
 * `serviceState` row is touched (`T-BATCH-006`). That is not a property of
 * this function so much as of the whole design: a batch becomes visible only
 * in the single close transaction (§6.22), so an abandoned batch has nothing
 * to unwind. This function therefore does exactly one thing, and any future
 * edit that gives it a second thing to do is a bug.
 *
 * Images are RETAINED (§6.23). NFR-019's 30-day purge governs them; discard
 * is not a delete, and deleting here would destroy the owner's evidence of a
 * capture they might want to re-extract.
 *
 * ⚠ `specs/api.md` §6.23 names no error code for a discard from an
 * undiscardable status — reported as a spec gap in `specs/testing.md` §24.2.
 * `BATCH_IMMUTABLE` is used because it is the only member of the closed
 * enumeration that means "this batch can no longer be changed", and inventing
 * a code is forbidden (§8). It is NOT made idempotent: answering 200 to a
 * discard of an already-discarded batch would let the SPA report that it threw
 * away work it never touched.
 */
export async function discardBatch(ownerId: OwnerId, batchId: string): Promise<DiscardResult> {
  const batch = await loadOwnedBatch(ownerId, batchId);

  await transitionBatch(
    ownerId,
    batch,
    'discarded',
    'BATCH_IMMUTABLE',
    'This batch can no longer be discarded.',
  );

  return { batchId, status: 'discarded', listStateChanged: false };
}

/**
 * Cross-check between the two definitions of "finished with".
 *
 * Exported rather than inlined into the test so the assertion reads from the
 * same expression the application would: a test that recomputes the rule is a
 * test of its own copy of it.
 */
export function statusesWithNoOutgoingTransitions(): BatchStatus[] {
  return BATCH_STATUSES.filter((status) => BATCH_TRANSITIONS[status].length === 0);
}

/** The open/terminal split, computed from `isBatchOpen`. */
export function openStatuses(): BatchStatus[] {
  return BATCH_STATUSES.filter((status) => isBatchOpen(status));
}
