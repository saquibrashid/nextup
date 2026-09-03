/**
 * "Not interested" confirmation, with immediate undo and rollback on failure
 * (TASK-102, `T-UX-085`, `T-UX-022`).
 *
 * `specs/ux-states.md` §3.1 (confirm), §3.2 (idempotent 200), §2.13
 * (submitting) and §2.14 (success + undo) between them describe one small
 * state machine, and `specs/ui.md` §2.3 fixes the confirm wording.
 *
 * ⚠ The row is NEVER hidden before the server has persisted the suppression.
 * US-027 AC-6 / `T-UX-085` reads "the row returns and an error is shown; never
 * a silent optimistic hide" - so this component reports `pending` while the
 * request is in flight and only reports `suppressed` once the promise
 * resolves. A failure therefore cannot leave a hidden row behind: the only
 * state a rejected request can reach is `present`.
 *
 * ⚠ Suppression is keyed on canonical WORK identity, not on a row id
 * (REQ-071). This component never sees a work identity - it posts to
 * `POST /api/titles/:titleId/suppress`, which derives it server-side
 * (`specs/api.md` §6.6, TASK-101) - and it deliberately does not cache or
 * re-key anything on `titleId` afterwards. The undo goes back through the
 * `suppressionId` the server returned, which IS the work-identity key
 * (`supp:<workIdentity>`).
 */
import { useCallback, useId, useState, type JSX } from 'react';

import { useDialogFocus } from '../lib/useDialogFocus';
import { useOutcomeFocus } from '../lib/useOutcomeFocus';

import { SUPPRESS_CONFIRM_BODY } from '../copy';

/** What the list should do with the row this dialog is acting on. */
export type RowState = 'present' | 'pending' | 'suppressed';

/** `POST /api/titles/:titleId/suppress` - `specs/api.md` §6.6. */
export interface SuppressResult {
  suppressionId: string;
  workIdentity: string;
  alreadySuppressed: boolean;
}

export interface SuppressDialogProps {
  titleId: string;
  name: string;
  suppress: (titleId: string) => Promise<SuppressResult>;
  unsuppress: (suppressionId: string) => Promise<unknown>;
  onRowState: (state: RowState) => void;
  onClose: () => void;
}

/** `specs/ui.md` §9 substitutes `{name}` into the specified bodies. */
export function withName(template: string, name: string): string {
  return template.split('{name}').join(name);
}

/**
 * ⚠ FINDING - invented copy, pending owner review.
 *
 * `specs/ux-states.md` §3.2 writes this state out in full ("'{name}' was
 * already on your Not interested list."), but `specs/ui.md` §9 - the copy
 * register this file mirrors - has no row for it, so it cannot be transcribed
 * from §9 and lives here beside its only consumer rather than pretending to be
 * a §9 constant.
 */
export const ALREADY_SUPPRESSED_BODY = '"{name}" was already on your Not interested list.';

/**
 * ⚠ FINDING - invented copy, pending owner review. `specs/ux-states.md` §2.14
 * requires "a `role="status"` message names what happened and offers Undo" but
 * supplies no wording for the suppress case.
 */
export const SUPPRESS_SUCCESS_BODY = '"{name}" is now on your Not interested list.';

/**
 * ⚠ FINDING - invented copy, pending owner review. US-027 AC-6 requires an
 * error rather than a silent hide but supplies no wording. Phrased on the
 * pattern §2.9 uses for every other failed write: say plainly that nothing
 * changed, because the whole point of the state is that the row is still there.
 */
export const SUPPRESS_FAILED_BODY = 'Couldn\u2019t hide "{name}". Nothing has changed.';

/**
 * ⚠ FINDING - invented copy, pending owner review. `specs/ux-states.md` §2.14
 * offers Undo but does not say what the owner reads once it succeeds. It must
 * not promise a restore: un-suppression never brings a removed listing back
 * (`specs/api.md` §6.8, `restoredAnything` is always `false`).
 */
export const SUPPRESS_UNDONE_BODY =
  '"{name}" is off your Not interested list. This doesn\u2019t bring back anything that was removed.';

type Phase = 'confirm' | 'submitting' | 'done' | 'already' | 'error' | 'undoing' | 'undone';

export function SuppressDialog({
  titleId,
  name,
  suppress,
  unsuppress,
  onRowState,
  onClose,
}: SuppressDialogProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('confirm');
  // Holds the suppression id ONLY while an undo is genuinely available, so the
  // control's presence and its argument are the same fact and cannot diverge.
  const [undoTarget, setUndoTarget] = useState<string | null>(null);
  const headingId = useId();
  const dialogRef = useDialogFocus(onClose);

  /*
   * `T-A11Y-006` outcome half (`specs/ux-states.md` §1). Suppression is the
   * one action here that makes a title disappear from the list, and the
   * `role="status"` message is also where **Undo** lives — so a keyboard user
   * who is not moved here has to hunt for the remedy for a change they may
   * have made by mistake.
   *
   * ⚠ `'undone'` is deliberately EXCLUDED. It is reached by pressing **Undo**
   * inside this dialog, and focusing the outcome then takes focus off the
   * control the owner is still on.
   */
  const outcomeRef = useOutcomeFocus<HTMLParagraphElement>(phase === 'done' || phase === 'already');

  const confirm = useCallback(() => {
    setPhase('submitting');
    onRowState('pending');
    suppress(titleId).then(
      (result) => {
        setUndoTarget(result.alreadySuppressed ? null : result.suppressionId);
        onRowState('suppressed');
        setPhase(result.alreadySuppressed ? 'already' : 'done');
      },
      () => {
        // Rollback. The row was dimmed, never hidden, so "returns" here means
        // it becomes interactive again — and the error is stated, not swallowed.
        onRowState('present');
        setPhase('error');
      },
    );
  }, [onRowState, suppress, titleId]);

  const undo = useCallback(
    (suppressionId: string) => {
      setPhase('undoing');
      onRowState('pending');
      unsuppress(suppressionId).then(
        () => {
          setUndoTarget(null);
          onRowState('present');
          setPhase('undone');
        },
        () => {
          // The suppression is still in place, so the row must stay hidden.
          onRowState('suppressed');
          setPhase('done');
        },
      );
    },
    [onRowState, unsuppress],
  );

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <h2 id={headingId}>Not interested</h2>

      {(phase === 'confirm' || phase === 'submitting' || phase === 'error') && (
        <p>{withName(SUPPRESS_CONFIRM_BODY, name)}</p>
      )}

      {phase === 'error' && <p role="alert">{withName(SUPPRESS_FAILED_BODY, name)}</p>}

      {(phase === 'done' || phase === 'undoing') && (
        <p role="status" ref={outcomeRef} tabIndex={-1}>
          {withName(SUPPRESS_SUCCESS_BODY, name)}
        </p>
      )}

      {phase === 'already' && (
        <p role="status" ref={outcomeRef} tabIndex={-1}>
          {withName(ALREADY_SUPPRESSED_BODY, name)}
        </p>
      )}

      {phase === 'undone' && (
        // ⚠ Carries the ref but is NOT in the active set above. The ref is here
        // so that widening the set to include `'undone'` genuinely moves focus
        // — and is therefore caught by `T-A11Y-006i` — rather than being a
        // no-op the suite cannot see. Undo is reached from a control the owner
        // is standing on; focusing the result takes them off it.
        <p role="status" ref={outcomeRef} tabIndex={-1}>
          {withName(SUPPRESS_UNDONE_BODY, name)}
        </p>
      )}

      {(phase === 'confirm' || phase === 'error') && (
        <button type="button" onClick={confirm}>
          {phase === 'error' ? 'Try again' : 'Not interested'}
        </button>
      )}

      {phase === 'submitting' && (
        <button type="button" disabled>
          Hiding…
        </button>
      )}

      {undoTarget !== null && (
        <button
          type="button"
          onClick={() => {
            undo(undoTarget);
          }}
          disabled={phase === 'undoing'}
        >
          {phase === 'undoing' ? 'Undoing…' : 'Undo'}
        </button>
      )}

      <button type="button" onClick={onClose}>
        {phase === 'confirm' || phase === 'error' ? 'Cancel' : 'Close'}
      </button>
    </div>
  );
}
