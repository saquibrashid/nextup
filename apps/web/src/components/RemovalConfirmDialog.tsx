/**
 * The removal confirmation dialog (TASK-086's deferred web half, `T-UI-008`,
 * `T-REV-007`, `ux-states.md` §6.10 and §6.11).
 *
 * ⚠ **THIS IS THE ONLY CONFIRMATION, AND THAT IS DELIBERATE (REQ-020).** There
 * is no per-row remove affordance anywhere in the review (`T-UI-008c`), so the
 * owner is never one stray tap away from a deletion; the price of that design
 * is that this single dialog carries the whole decision. It therefore **names
 * every title that will go** rather than reporting a count: a count alone is
 * unfalsifiable to the person reading it, and the one failure this screen
 * exists to catch — a title the owner meant to rescue still ticked — is
 * invisible unless the name is on screen.
 *
 * ⚠ **IT NAMES THE TICKED ITEMS AND ONLY THE TICKED ITEMS.** Listing a rescued
 * title here would tell the owner it is about to be removed when the close will
 * not touch it, which invites them to cancel a correct batch; omitting a ticked
 * one hides a removal they are in the act of authorising. The heading's count
 * is derived from **the same filtered array** that produces the names, so the
 * two cannot disagree.
 *
 * ⚠ **THE ZERO CASE IS A CONFIRMATION, NOT A REFUSAL** (§6.11, US-015 AC-5).
 * Unticking everything is a decision the owner made and the close proceeds,
 * recording a zero-member group. Disabling Confirm here would make a batch
 * whose removals were all rescued **unclosable** — the owner would have to
 * discard work they had just reviewed to escape.
 *
 * ⚠ **THE DIALOG OPENS ON PROPOSALS, NOT ON TICKS.** That mirrors the server's
 * gate (TASK-086: `confirmRemovals` is required whenever `removals.count > 0`
 * and the section was not withheld), and the two must agree or the owner meets
 * a 409 `REMOVALS_NOT_CONFIRMED` they cannot act on. The values come from the
 * review response; nothing is recomputed here.
 */

import { useId, type JSX } from 'react';

import { SERVICE_LABELS, type ReviewRemovalItem, type Service } from '@nextup/domain';

import { useDialogFocus } from '../lib/useDialogFocus';

import {
  REMOVAL_CANCEL_LABEL,
  REMOVAL_CONFIRM_LABEL,
  REMOVAL_CONFIRM_NONE,
  REMOVAL_CONFIRM_REASSURANCE,
} from '../copy';

export interface RemovalConfirmDialogProps {
  readonly service: Service;
  /** The whole proposed section. Filtering to the ticked rows happens here. */
  readonly items: readonly ReviewRemovalItem[];
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** §6.12 — the close is in flight; every control is disabled. */
  readonly submitting?: boolean;
}

/**
 * §6.10's question. ⚠ Takes the count that was actually rendered, so a heading
 * that says three and a list that shows two is not expressible.
 */
export function removalConfirmTitle(count: number, service: Service): string {
  const noun = count === 1 ? '1 title' : `${count} titles`;
  return `Remove ${noun} from ${SERVICE_LABELS[service]}?`;
}

export function RemovalConfirmDialog({
  service,
  items,
  onConfirm,
  onCancel,
  submitting = false,
}: RemovalConfirmDialogProps): JSX.Element {
  const headingId = useId();
  const ticked = items.filter((item) => item.ticked);
  /*
    ⚠ Escape maps to CANCEL, never to confirm. This dialog authorises
    deletions; the dismissal gesture must be the safe one.
  */
  const dialogRef = useDialogFocus(onCancel);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="removal-confirm"
      data-testid="removal-confirm"
    >
      <h2 id={headingId} className="removal-confirm__title">
        {ticked.length === 0 ? REMOVAL_CONFIRM_NONE : removalConfirmTitle(ticked.length, service)}
      </h2>

      {ticked.length > 0 && (
        <>
          <ul className="removal-confirm__list" data-testid="removal-confirm-list">
            {ticked.map((item) => (
              <li key={item.listingId} className="removal-confirm__item">
                {item.name}
              </li>
            ))}
          </ul>
          <p className="removal-confirm__reassurance">{REMOVAL_CONFIRM_REASSURANCE}</p>
        </>
      )}

      <div className="removal-confirm__actions">
        {/*
          ⚠ Cancel is listed first and is never disabled while the owner can
          still act. A destructive confirmation whose only reachable control is
          the destructive one is not a confirmation.
        */}
        <button
          type="button"
          className="removal-confirm__cancel tap-target"
          onClick={onCancel}
          disabled={submitting}
        >
          {REMOVAL_CANCEL_LABEL}
        </button>
        <button
          type="button"
          className="removal-confirm__confirm tap-target"
          onClick={onConfirm}
          disabled={submitting}
        >
          {REMOVAL_CONFIRM_LABEL}
        </button>
      </div>
    </div>
  );
}
