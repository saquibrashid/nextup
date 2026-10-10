/**
 * US-068 AC-1/AC-2 — the owner's "Check now" for ONE title (PRD `A59`,
 * `specs/ui.md` §7d).
 *
 * ⚠ **OWNER-INITIATED, METADATA-ONLY (invariant 5).** One press asks TMDB about
 * this one title right away, whatever the stored answer's age, and the server
 * writes the four availability columns and nothing else. Any move it reveals —
 * "Left Starz", "Now also on Max" and its Add badge — appears in the marker
 * above and stays the owner's to make. This control never adds, removes or
 * re-badges anything, and it is never pressed on the owner's behalf.
 *
 * ⚠ **SHOW THE FACT, NEVER NAG (invariant 8a).** "Checked just now" and
 * "Checked 4 Oct" state when the answer was last asked for; there is no
 * threshold, no "overdue" and no reminder. The label is derived from the STORED
 * `checkedAt`, so it is still true after the reload a successful check
 * triggers remounts the page.
 */

import { useState, type JSX } from 'react';

import {
  CHECK_NOW_FAILED,
  CHECK_NOW_JUST_NOW,
  CHECK_NOW_LABEL,
  CHECK_NOW_NEVER,
  CHECK_NOW_NO_MATCH,
  CHECK_NOW_ON,
  CHECK_NOW_RETRY,
  CHECK_NOW_TODAY,
  CHECK_NOW_WORKING,
  OFFLINE_DISABLED_REASON,
} from '../copy';
import { formatDateShort } from '../pages/RemovedPage';
import { Button } from './ui/Button';

const JUST_NOW_MS = 2 * 60_000;

/** When the answer was last asked for, as a plain statement of fact. */
export function checkedLabel(checkedAt: string | null | undefined, now: Date): string {
  if (checkedAt == null) return CHECK_NOW_NEVER;
  const at = new Date(checkedAt);
  if (Number.isNaN(at.getTime())) return CHECK_NOW_NEVER;
  if (now.getTime() - at.getTime() < JUST_NOW_MS) return CHECK_NOW_JUST_NOW;
  if (at.toDateString() === now.toDateString()) return CHECK_NOW_TODAY;
  return `${CHECK_NOW_ON} ${formatDateShort(checkedAt.slice(0, 10))}`;
}

export interface CheckNowControlProps {
  readonly name: string;
  /** The stored answer's `checkedAt`; `null` when never checked. */
  readonly checkedAt: string | null | undefined;
  /** `false` when the title has no TMDB id, so there is nothing to ask about. */
  readonly hasMatch: boolean;
  readonly offline: boolean;
  /** Performs the lookup; a rejection is "TMDB could not be reached". */
  readonly check: () => Promise<unknown>;
  /** Called after a successful check, so the page can re-read the stored answer. */
  readonly onChecked: () => void;
}

export function CheckNowControl({
  name,
  checkedAt,
  hasMatch,
  offline,
  check,
  onChecked,
}: CheckNowControlProps): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'done' | 'failed'>('idle');
  const [doneAt, setDoneAt] = useState<string | null>(null);

  const run = (): void => {
    setPhase('checking');
    check().then(
      () => {
        setDoneAt(new Date().toISOString());
        setPhase('done');
        onChecked();
      },
      () => setPhase('failed'),
    );
  };

  const disabled = !hasMatch || offline || phase === 'checking';
  const label = checkedLabel(phase === 'done' ? doneAt : checkedAt, new Date());
  const reason = !hasMatch ? CHECK_NOW_NO_MATCH : offline ? OFFLINE_DISABLED_REASON : null;

  return (
    <div
      className="check-now"
      data-testid="check-now"
      aria-busy={phase === 'checking' || undefined}
    >
      <Button
        variant="secondary"
        data-testid="check-now-button"
        aria-label={`${CHECK_NOW_LABEL}: ${name}`}
        disabled={disabled}
        onClick={run}
      >
        {phase === 'checking'
          ? CHECK_NOW_WORKING
          : phase === 'failed'
            ? CHECK_NOW_RETRY
            : CHECK_NOW_LABEL}
      </Button>
      {hasMatch && (
        <span className="check-now__fact" data-testid="check-now-fact" aria-live="polite">
          {label}
        </span>
      )}
      {reason !== null && (
        <span className="check-now__reason" data-testid="check-now-reason">
          {reason}
        </span>
      )}
      {phase === 'failed' && (
        <p role="alert" data-testid="check-now-error">
          {CHECK_NOW_FAILED}
        </p>
      )}
    </div>
  );
}
