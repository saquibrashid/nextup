/**
 * The post-confirmation success notice and its undo affordance (TASK-091,
 * `T-UX-065`, US-017 AC-1, `specs/ux-states.md` §6.13).
 *
 * ⚠ **THE UNDO MUST BE OFFERED HERE, NOT ONLY IN HISTORY.** US-017 AC-1 is
 * "the undo affordance is offered *immediately* after confirmation". A batch
 * close is the one moment the owner has just been told that N titles left a
 * service; an undo reachable only from `/batches/:id` means the owner who
 * mis-ticked a removal has to know that screen exists, find it, and identify
 * the right batch — while looking at a list that no longer has the title they
 * were looking for. The reversal is equally possible later (`T-GRP-011`: the
 * group is never time-limited); what is lost is the owner noticing.
 *
 * ⚠ **THERE ARE TWO SERVER UNDOS AND THEY ARE NOT INTERCHANGEABLE.**
 * `POST /api/removal-groups/:groupId/undo` (§6.26) puts removed listings back;
 * `POST /api/batches/:batchId/undo` (§6.25) discards what a **creates-only**
 * batch created and refuses anything else with 409 `BATCH_NOT_CREATES_ONLY`.
 * A batch that removed anything has a non-empty `provenance.removed` and is
 * therefore never `undoable` (`packages/domain/src/undo.ts`), so offering the
 * batch undo after a removal would put a button on screen whose only possible
 * outcome is a 409. `undoOffer` below picks between them from the summary the
 * server just sent, as one pure decision, so the control's label, its endpoint
 * and its argument are all the same fact.
 *
 * ⚠ **A ZERO-MEMBER REMOVAL GROUP IS NOT AN UNDO OPPORTUNITY.** Unticking every
 * removal is a supported outcome and still records a group (US-015 AC-5,
 * `T-REV-007`), so `removalGroupId` alone does not mean anything was removed.
 * Offering "Undo the removals" for a group with no members would promise to
 * reverse a change that never happened.
 */

import { useCallback, useState, type JSX } from 'react';

import { SERVICE_LABELS, type Service } from '@nextup/domain';

/** The §6.22 close response, as much of it as this notice reads. */
export interface AppliedBatch {
  readonly batchId: string;
  readonly service: Service;
  readonly summary: {
    readonly listingsCreated: number;
    readonly listingsRemoved: number;
    readonly removalGroupId: string | null;
  };
  readonly undoable: boolean;
}

/** Which undo, if either, this batch can be offered. */
export type UndoOffer =
  | { readonly kind: 'removal-group'; readonly groupId: string }
  | { readonly kind: 'batch'; readonly batchId: string }
  | { readonly kind: 'none' };

/**
 * ⚠ The removal branch is tested FIRST and the two branches are exclusive by
 * construction, not by convention. Both undos rewrite the same listings, and a
 * screen that offered both would let the owner start the second while the first
 * is in flight.
 */
export function undoOffer(applied: AppliedBatch): UndoOffer {
  const { listingsRemoved, removalGroupId } = applied.summary;
  if (listingsRemoved > 0) {
    // A removal with no group id is incoherent server data. Offering nothing is
    // the honest response; the alternative is a button that posts to
    // `/api/removal-groups/null/undo`.
    return removalGroupId === null
      ? { kind: 'none' }
      : { kind: 'removal-group', groupId: removalGroupId };
  }
  return applied.undoable ? { kind: 'batch', batchId: applied.batchId } : { kind: 'none' };
}

function titles(count: number): string {
  return count === 1 ? '1 title' : `${count} titles`;
}

/**
 * ⚠ FINDING — partly invented copy, pending owner review. `specs/ux-states.md`
 * §6.13 fixes exactly one wording, *"Added 9 titles, removed 3 from Netflix."*,
 * for a summary whose `listingsCreated` is 9 and `listingsRemoved` is 3 — so
 * the added count is **listings**, not `titlesCreated` (6 in the same example).
 * The three other arithmetic cases have no specified wording and are phrased on
 * that sentence's pattern.
 *
 * ⚠ The nothing-changed case must not be silently dropped: closing a batch that
 * applied nothing is a real outcome (every candidate discarded, every removal
 * unticked), and a notice that renders no sentence for it looks like a close
 * that failed.
 */
export function appliedSummary(applied: AppliedBatch): string {
  const service = SERVICE_LABELS[applied.service];
  const added = applied.summary.listingsCreated;
  const removed = applied.summary.listingsRemoved;

  if (added > 0 && removed > 0) {
    return `Added ${titles(added)}, removed ${titles(removed)} from ${service}.`;
  }
  if (added > 0) return `Added ${titles(added)} from ${service}.`;
  if (removed > 0) return `Removed ${titles(removed)} from ${service}.`;
  return `Nothing changed on your ${service} list.`;
}

/**
 * ⚠ FINDING — invented copy, pending owner review. §6.13 names the controls
 * ("Undo this batch", "View what changed") but supplies no wording for the
 * undone or failed outcomes.
 */
export const UNDO_REMOVALS_LABEL = 'Undo the removals';
export const UNDO_BATCH_LABEL = 'Undo this batch';
export const UNDO_PENDING_LABEL = 'Undoing…';
export const VIEW_CHANGES_LABEL = 'View what changed';
export const UNDO_REMOVALS_DONE = 'Those titles are back on your list.';
export const UNDO_BATCH_DONE = 'That batch has been undone. Nothing it added is on your list.';
/**
 * ⚠ States plainly that the change is STILL APPLIED. A failed undo that only
 * said "something went wrong" would leave the owner unable to tell whether the
 * removal stands, and the recovery — pressing Undo again — depends on knowing
 * that it does.
 */
export const UNDO_FAILED_BODY = 'Couldn\u2019t undo that. The changes are still applied.';

export interface BatchAppliedNoticeProps {
  readonly applied: AppliedBatch;
  readonly undoRemovalGroup: (groupId: string) => Promise<unknown>;
  readonly undoBatch: (batchId: string) => Promise<unknown>;
}

type Phase = 'applied' | 'undoing' | 'undone' | 'failed';

export function BatchAppliedNotice({
  applied,
  undoRemovalGroup,
  undoBatch,
}: BatchAppliedNoticeProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('applied');
  const offer = undoOffer(applied);

  // ⚠ The mutation is in the event handler, never an effect: React 19
  // double-invokes effects under `<StrictMode>`, and a second undo of the same
  // group is a 409 the owner would see as a failure of the first.
  const run = useCallback(() => {
    if (offer.kind === 'none') return;
    setPhase('undoing');
    const request =
      offer.kind === 'removal-group' ? undoRemovalGroup(offer.groupId) : undoBatch(offer.batchId);
    request.then(
      () => {
        setPhase('undone');
      },
      () => {
        // The change stands. `failed` deliberately returns to an offerable
        // state rather than hiding the control — the remedy is to retry.
        setPhase('failed');
      },
    );
  }, [offer, undoBatch, undoRemovalGroup]);

  const undone = phase === 'undone';

  return (
    <div className="applied-notice" data-testid="applied-notice">
      <p role="status" className="applied-notice-body">
        {undone
          ? offer.kind === 'removal-group'
            ? UNDO_REMOVALS_DONE
            : UNDO_BATCH_DONE
          : appliedSummary(applied)}
      </p>

      {phase === 'failed' && (
        <p role="alert" className="applied-notice-error">
          {UNDO_FAILED_BODY}
        </p>
      )}

      <div className="applied-notice-actions">
        {/*
          ⚠ Exactly one of these ever renders. §6.13 offers the undo *or* the
          history link, and a screen showing both invites the owner to leave for
          history while an undo is still one tap away.
        */}
        {offer.kind !== 'none' && !undone ? (
          <button
            type="button"
            className="applied-notice-undo tap-target"
            onClick={run}
            disabled={phase === 'undoing'}
          >
            {phase === 'undoing'
              ? UNDO_PENDING_LABEL
              : offer.kind === 'removal-group'
                ? UNDO_REMOVALS_LABEL
                : UNDO_BATCH_LABEL}
          </button>
        ) : (
          <a className="applied-notice-link tap-target" href={`/batches/${applied.batchId}`}>
            {VIEW_CHANGES_LABEL}
          </a>
        )}
      </div>
    </div>
  );
}
