import { Dialog } from './ui/Dialog';
/**
 * The final confirmation for both modes (TASK-225, `T-UX-159`), retaining
 * the removal-consent contract (`T-UI-008`, `T-REV-007`).
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
 * The summary opens for both modes, even without removal proposals.
 * Removal consent still depends on proposal count, not selected count.
 */

import { useId, type JSX } from 'react';

import {
  SERVICE_LABELS,
  type ReviewCandidate,
  type ReviewRemovalItem,
  type Service,
} from '@nextup/domain';

import { Button } from './ui/Button';
import { EditionLabels } from './EditionLabels';

import {
  REMOVAL_CANCEL_LABEL,
  REMOVAL_CONFIRM_LABEL,
  REMOVAL_CONFIRM_NONE,
  REMOVAL_CONFIRM_REASSURANCE,
  OFFLINE_DISABLED_REASON,
} from '../copy';

export interface RemovalConfirmDialogProps {
  readonly service: Service | null;
  readonly additions?: readonly ReviewCandidate[];
  readonly editionUpdates?: readonly ReviewCandidate[];
  readonly disabled?: boolean;
  readonly offline?: boolean;
  readonly error?: string | null;
  readonly recovery?: JSX.Element | null;
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
  additions = [],
  editionUpdates = [],
  disabled = false,
  offline = false,
  error = null,
  recovery = null,
}: RemovalConfirmDialogProps): JSX.Element {
  const headingId = useId();
  const ticked = items.filter((item) => item.ticked);
  /*
    ⚠ Escape maps to CANCEL, never to confirm. This dialog authorises
    deletions; the dismissal gesture must be the safe one.
  */

  return (
    <Dialog
      onDismiss={() => {
        if (!submitting) onCancel();
      }}

      aria-labelledby={headingId}
      variant="overlay"
      data-testid="removal-confirm"
    >
      <div className="review-confirm">
        <h2 id={headingId} className="removal-confirm__title">
          Confirm changes
        </h2>
        <p className="review-section__description">
          {service === null ? 'Discovery capture' : SERVICE_LABELS[service]}. Check the exact
          changes below. Apply updates your nextup list, not the streaming service.
        </p>
        <section className="review-confirm__group">
          <h3>{`Add to your list (${additions.length})`}</h3>
          {additions.length === 0 ? (
            <p>No titles will be added.</p>
          ) : (
            <ul className="removal-confirm__list" data-testid="confirmation-additions">
              {additions.map((item) => (
                <li key={item.candidateId}>
                  {item.match?.name ?? item.inferredTitle ?? item.rawText}
                  {item.match === null
                    ? ' (unidentified)'
                    : ` (${item.match.releaseYear ?? 'year unknown'}, ${item.match.mediaType === 'tv' ? 'series' : 'film'})`}
                  {item.match?.edition !== undefined && (
                    <EditionLabels labels={[item.match.edition]} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        {editionUpdates.length > 0 && (
          <section className="review-confirm__group" data-testid="confirmation-editions">
            <h3>Keep edition labels on existing films</h3>
            <p>
              These labels stay on the existing film entry. No duplicate title or new date is
              created.
            </p>
            <ul>
              {editionUpdates.map((item) => (
                <li key={item.candidateId}>
                  {item.match?.name}
                  {item.match?.edition !== undefined && (
                    <EditionLabels labels={[item.match.edition]} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="review-confirm__group">
          <h3>Removals</h3>
          <p>
            {ticked.length === 0 || service === null
              ? REMOVAL_CONFIRM_NONE
              : removalConfirmTitle(ticked.length, service)}
          </p>

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
        </section>

        {error !== null && (
          <p role="alert" data-testid="review-apply-error">
            {error}
          </p>
        )}
        {offline && <p className="offline-reason">{OFFLINE_DISABLED_REASON}</p>}
        {recovery}

        <div className="removal-confirm__actions">
          {/*
          ⚠ Cancel is listed first and is never disabled while the owner can
          still act. A destructive confirmation whose only reachable control is
          the destructive one is not a confirmation.
        */}
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            {REMOVAL_CANCEL_LABEL}
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={submitting || disabled}>
            {submitting ? 'Applying...' : REMOVAL_CONFIRM_LABEL}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
