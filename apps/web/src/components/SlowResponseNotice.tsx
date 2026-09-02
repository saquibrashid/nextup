/**
 * `SlowResponseNotice` — *"Never an indefinite spinner"* (`specs/ux-states.md`
 * §1, `T-UX-001`).
 *
 * ⚠ **RENAMED FROM `ColdStartNotice` BY TASK-143, AND THE RENAME WAS A FACT
 * CHANGE, NOT A TIDY-UP.** The old copy — *"Waking things up…"* — named a cause
 * that cannot occur: ADR-0003 Rev 3 pins `minReplicas = 1`, so the container is
 * always warm and there is no cold start to wake from. Telling the owner their
 * request is slow because the app was asleep would be a confident, specific,
 * wrong explanation, which is worse than the vaguer true one.
 *
 * ⚠ **THE 15 s STATE IS NOT A LOUDER NOTICE, IT IS AN EXIT.** *"Still
 * working…"* is always true while a request is pending, so on its own it is an
 * indefinite spinner that has learned to talk: it can never report that
 * something has gone wrong, and offers nothing to do. §1 requires the wait to
 * terminate in an error state carrying a **Retry**.
 *
 * ⚠ **`role="status"` WHILE WORKING, `role="alert"` ONCE STALLED.** The first
 * is a progress update and must not interrupt what a screen-reader user is
 * doing; the second is a failure they need now. Announcing the 1200 ms notice
 * assertively would interrupt on every ordinary slow request.
 */
import type { JSX } from 'react';

import { RETRY_LABEL, SLOW_RESPONSE_BODY, SLOW_RESPONSE_STALLED_BODY } from '../copy';
import type { RequestPhase } from '../lib/useSlowRequest';

export interface SlowResponseNoticeProps {
  readonly phase: RequestPhase;
  /** Absent when the caller has no way to re-issue the request. */
  readonly onRetry?: (() => void) | undefined;
}

export function SlowResponseNotice({
  phase,
  onRetry,
}: SlowResponseNoticeProps): JSX.Element | null {
  // ⚠ Renders NOTHING before 1200 ms. A notice that appears with the skeletons
  // fires on every ordinary load and stops carrying information at all.
  if (phase !== 'slow' && phase !== 'stalled') return null;

  if (phase === 'slow') {
    return (
      <p role="status" className="slow-response" data-testid="slow-response">
        {SLOW_RESPONSE_BODY}
      </p>
    );
  }

  return (
    <div role="alert" className="slow-response slow-response--stalled" data-testid="slow-stalled">
      <p>{SLOW_RESPONSE_STALLED_BODY}</p>
      {onRetry !== undefined && (
        <button type="button" className="tap-target" onClick={onRetry} data-testid="slow-retry">
          {RETRY_LABEL}
        </button>
      )}
    </div>
  );
}
