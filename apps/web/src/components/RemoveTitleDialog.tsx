/**
 * "Remove from list" confirmation, with immediate undo (US-048, TASK-207).
 *
 * Modelled on `SuppressDialog` deliberately — same state machine, same
 * pending/outcome discipline, same `role="status"` + Undo shape
 * (`specs/ux-states.md` §2.13, §2.14) — because the two dialogs sit behind
 * adjacent menu items and an owner who has learnt one should not have to learn
 * the other.
 *
 * ⚠ THE ROW IS NEVER HIDDEN BEFORE THE SERVER HAS PERSISTED THE REMOVAL. The
 * only state a rejected request can reach is `present`, so a failure cannot
 * leave a hidden row behind claiming to be gone.
 *
 * ⚠ UNDO IS `POST /api/listings/:id/restore` — THE EXISTING ONE (§6.10). No
 * second restore path was built: `T-REAP-014` asserts `restoreServiceListing`
 * has exactly two call sites, and a bespoke un-remove would silently become a
 * third with its own rules about suppression and duplicates.
 *
 * ⚠ UNDO RESTORES *EVERY* LISTING THE REMOVAL TOOK, because the removal took
 * the whole row (both badges of a two-service title). Restoring only the first
 * would return the row with a badge missing and no indication that it had.
 * They are restored SEQUENTIALLY rather than with `Promise.all`: each restore
 * recomputes the title's derived `state`/`sortDateAdded` from its listings, so
 * two concurrent restores race on that derivation and the loser's write can
 * pin the title to a value read before the other landed.
 */
import { useCallback, useId, useState, type JSX } from 'react';

import {
  REMOVE_TITLE_CONFIRM_BODY,
  REMOVE_TITLE_DONE,
  REMOVE_TITLE_FAILED,
  REMOVE_TITLE_NOT_ACTIVE,
  REMOVE_TITLE_UNDONE,
  REMOVE_TITLE_UNDO_LABEL,
  ROW_MENU_REMOVE_LABEL,
} from '../copy';
import { useDialogFocus } from '../lib/useDialogFocus';
import { useOutcomeFocus } from '../lib/useOutcomeFocus';
import { withName, type RowState } from './SuppressDialog';

/** `DELETE /api/titles/:titleId` — `specs/api.md` §6.32. */
export interface RemoveTitleResult {
  titleId: string;
  removedListingIds: string[];
}

export interface RemoveTitleDialogProps {
  titleId: string;
  name: string;
  removeTitle: (titleId: string) => Promise<RemoveTitleResult>;
  restoreListing: (listingId: string) => Promise<unknown>;
  onRowState: (state: RowState) => void;
  onClose: () => void;
}

type Phase = 'confirm' | 'submitting' | 'removed' | 'undoing' | 'undone' | 'failed' | 'not-active';

export function RemoveTitleDialog({
  titleId,
  name,
  removeTitle,
  restoreListing,
  onRowState,
  onClose,
}: RemoveTitleDialogProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [removedListingIds, setRemovedListingIds] = useState<readonly string[]>([]);
  const headingId = useId();
  const dialogRef = useDialogFocus(onClose);
  const outcomeRef = useOutcomeFocus<HTMLParagraphElement>(
    phase === 'removed' || phase === 'undone',
  );

  const submit = useCallback(() => {
    setPhase('submitting');
    onRowState('pending');
    removeTitle(titleId).then(
      (result) => {
        setRemovedListingIds(result.removedListingIds);
        setPhase('removed');
        // ⚠ `'suppressed'` is the row-state the LIST uses to mean "hide this
        // row", and it is reused here rather than adding a fourth member. The
        // name is a `SuppressDialog` inheritance and is wrong for this caller;
        // what it means to `ListPage` is "hidden", and nothing about
        // suppression is written by this path (§6.32 writes none).
        onRowState('suppressed');
      },
      (error: unknown) => {
        onRowState('present');
        const code =
          error instanceof Error && 'code' in error ? (error as { code: string }).code : '';
        // 409 TITLE_NOT_ACTIVE is not a failure: the title is already off the
        // list, which is the state the owner asked for. Reporting it as an
        // error would invite a retry of something already done.
        setPhase(code === 'TITLE_NOT_ACTIVE' ? 'not-active' : 'failed');
      },
    );
  }, [onRowState, removeTitle, titleId]);

  const undo = useCallback(() => {
    setPhase('undoing');
    void (async () => {
      try {
        for (const listingId of removedListingIds) {
          await restoreListing(listingId);
        }
        onRowState('present');
        setPhase('undone');
      } catch {
        // ⚠ The row stays HIDDEN on a failed undo, because the removal itself
        // did succeed — the title really is off the list. Showing it again
        // here would claim a restore that did not happen.
        setPhase('failed');
      }
    })();
  }, [onRowState, removedListingIds, restoreListing]);

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <h2 id={headingId}>{ROW_MENU_REMOVE_LABEL}</h2>

      {(phase === 'confirm' || phase === 'submitting') && (
        <>
          <p data-testid="remove-confirm-body">{withName(REMOVE_TITLE_CONFIRM_BODY, name)}</p>
          <button
            type="button"
            className="tap-target"
            data-testid="confirm-remove-title"
            disabled={phase === 'submitting'}
            onClick={submit}
          >
            {phase === 'submitting' ? 'Removing…' : ROW_MENU_REMOVE_LABEL}
          </button>
        </>
      )}

      {phase === 'removed' && (
        <>
          <p role="status" data-testid="remove-done" ref={outcomeRef} tabIndex={-1}>
            {withName(REMOVE_TITLE_DONE, name)}
          </p>
          <button
            type="button"
            className="tap-target"
            data-testid="undo-remove-title"
            onClick={undo}
          >
            {REMOVE_TITLE_UNDO_LABEL}
          </button>
        </>
      )}

      {phase === 'undoing' && <p aria-busy="true">Putting it back…</p>}

      {phase === 'undone' && (
        <p role="status" data-testid="remove-undone" ref={outcomeRef} tabIndex={-1}>
          {REMOVE_TITLE_UNDONE}
        </p>
      )}

      {phase === 'failed' && (
        <p role="alert" data-testid="remove-failed">
          {REMOVE_TITLE_FAILED}
        </p>
      )}

      {phase === 'not-active' && (
        <p role="status" data-testid="remove-not-active">
          {REMOVE_TITLE_NOT_ACTIVE}
        </p>
      )}

      {phase !== 'submitting' && phase !== 'undoing' && (
        <button type="button" className="tap-target" onClick={onClose}>
          {phase === 'confirm' ? 'Cancel' : 'Close'}
        </button>
      )}
    </div>
  );
}
