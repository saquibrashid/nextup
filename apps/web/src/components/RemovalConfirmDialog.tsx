/**
 * The removal confirmation dialog (US-015 AC-3, `specs/ui.md` §5.2,
 * TASK-093).
 *
 * Opened by "Apply changes" when there are ticked removals. Lists every ticked
 * title; has a single group-confirm button. There is no per-row remove control
 * anywhere (`T-UI-008`). After confirmation the undo affordance appears
 * immediately (`T-UX-065`).
 *
 * ⚠ The undo affordance (US-017 AC-1) is rendered INSIDE this component,
 * immediately after the owner confirms, so the window to undo is never hidden
 * behind a navigation. It is offered here and also on the list page after
 * navigation — two entry points for the same action.
 */

import { useState, type JSX } from 'react';

import type { ReviewRemovalItem } from '@nextup/domain';

export interface RemovalConfirmDialogProps {
  /** The ticked removal items to be confirmed. */
  readonly removals: readonly ReviewRemovalItem[];
  readonly service: string;
  readonly onConfirm: (tickedIds: readonly string[]) => void;
  readonly onCancel: () => void;
  /** Set to true while the close request is in flight. */
  readonly applying?: boolean;
}

function serviceLabel(service: string): string {
  if (service === 'netflix') return 'Netflix';
  if (service === 'max') return 'Max';
  return service;
}

export function RemovalConfirmDialog({
  removals,
  service,
  onConfirm,
  onCancel,
  applying = false,
}: RemovalConfirmDialogProps): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const ticked = removals.filter((r) => r.ticked);
  const tickedIds = ticked.map((r) => r.listingId);
  const count = ticked.length;
  const svcLabel = serviceLabel(service);

  function handleConfirm(): void {
    setConfirmed(true);
    onConfirm(tickedIds);
  }

  return (
    <dialog
      open
      aria-modal="true"
      aria-label="Confirm removals"
      data-testid="removal-confirm-dialog"
    >
      {!confirmed ? (
        <>
          <h2>
            {count === 0
              ? 'No removals selected. Nothing will be removed.'
              : `Remove ${String(count)} title${count === 1 ? '' : 's'} from ${svcLabel}?`}
          </h2>
          {count > 0 && (
            <>
              <p>{"They'll be kept in Removal history and you can restore them any time."}</p>
              <ul data-testid="removal-dialog-list">
                {ticked.map((r) => (
                  <li key={r.listingId} data-testid={`removal-dialog-item-${r.listingId}`}>
                    {r.name}
                    {r.releaseYear !== null && ` (${String(r.releaseYear)})`}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div data-testid="removal-dialog-actions">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={applying}
              data-testid="removal-dialog-confirm"
            >
              {applying
                ? 'Applying…'
                : count === 0
                  ? 'Close (nothing removed)'
                  : `Remove ${String(count)} title${count === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={applying}
              data-testid="removal-dialog-cancel"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        // T-UX-065: The undo affordance is offered immediately after confirmation.
        <div data-testid="removal-dialog-undo">
          <p>Changes applied.</p>
          <p>
            {count === 0
              ? 'Nothing was removed.'
              : `${String(count)} title${count === 1 ? '' : 's'} removed from ${svcLabel}.`}
          </p>
          <button type="button" data-testid="removal-undo-button" onClick={onCancel}>
            Undo this batch
          </button>
        </div>
      )}
    </dialog>
  );
}
