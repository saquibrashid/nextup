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
 *
 * ⚠ **THE `waking` PHASE IS NOT THE DELETED `ColdStartNotice` COMING BACK.**
 * TASK-143 was right: the APP never cold-starts (`minReplicas = 1`), so copy
 * blaming a sleeping app named a cause that cannot occur, and it stays
 * deleted. The staging DATABASE is Azure SQL serverless and genuinely does
 * pause — deliberately, to bill nothing — taking 30-60 s to resume. The
 * server waits that out (`SQL_CONNECT_TIMEOUT_MS` = 60 s) and the request
 * succeeds; it was this component that called it a failure at 15 s. `waking`
 * therefore names the **database**, keeps `role="status"`, and offers no
 * Retry — there is nothing to retry, only something to wait for, and a Retry
 * here restarts the wait it is trying to escape.
 */
import type { JSX } from 'react';

import {
  RETRY_LABEL,
  SLOW_RESPONSE_BODY,
  SLOW_RESPONSE_STALLED_BODY,
  SLOW_RESPONSE_WAKING_BODY,
} from '../copy';
import type { RequestPhase } from '../lib/useSlowRequest';
import { Button } from './ui/Button';

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
  if (phase !== 'slow' && phase !== 'waking' && phase !== 'stalled') return null;

  if (phase === 'slow') {
    return (
      <p role="status" className="slow-response" data-testid="slow-response">
        {SLOW_RESPONSE_BODY}
      </p>
    );
  }

  // ⚠ `role="status"`, NOT `role="alert"` — a resuming database is progress,
  // and this phase exists precisely because announcing it as a failure was
  // the defect. See `useSlowRequest`'s header and `SLOW_RESPONSE_WAKING_BODY`.
  if (phase === 'waking') {
    return (
      <p role="status" className="slow-response" data-testid="slow-waking">
        {SLOW_RESPONSE_WAKING_BODY}
      </p>
    );
  }

  return (
    <div role="alert" className="slow-response slow-response--stalled" data-testid="slow-stalled">
      <p>{SLOW_RESPONSE_STALLED_BODY}</p>
      {onRetry !== undefined && (
        <Button variant="secondary" onClick={onRetry} data-testid="slow-retry">
          {RETRY_LABEL}
        </Button>
      )}
    </div>
  );
}
