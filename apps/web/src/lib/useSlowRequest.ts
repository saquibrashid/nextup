/**
 * `useSlowRequest` — the timing behind *"Never an indefinite spinner"*
 * (`specs/ux-states.md` §1, `T-UX-001`).
 *
 * A pending request passes through three phases:
 *
 * | Phase     | From     | What the owner sees                          |
 * | --------- | -------- | -------------------------------------------- |
 * | `normal`  | 0 ms     | Skeletons / spinner                          |
 * | `slow`    | 1200 ms  | `SlowResponseNotice` — *"Still working…"*    |
 * | `waking`  | 15000 ms | *"Waking the database…"* — still progress    |
 * | `stalled` | 70000 ms | The `slow` error state, with **Retry**       |
 *
 * ⚠ **THE 15 s PHASE IS THE POINT OF THE RULE.** A notice that says "Still
 * working…" forever is an indefinite spinner with better manners — it never
 * stops being true, so it can never tell the owner that something has gone
 * wrong, and it offers nothing to do about it. §1 requires the wait to
 * *terminate* in something actionable.
 *
 * ⚠ **`waking` WAS INSERTED, NOT SUBSTITUTED FOR `stalled`, AND THE EXIT IS
 * STILL THERE.** The rule above is unchanged: the wait still terminates in an
 * error with a remedy. What moved is *when*, and why — see
 * `SLOW_RESPONSE_WAKING_BODY`. The staging database is Azure SQL serverless
 * with `autoPauseDelay = 60` (ADR-0003 Rev 3), paused deliberately to bill
 * nothing while idle, and a resume takes 30-60 s. `SQL_CONNECT_TIMEOUT_MS` is
 * 60 s so the server waits it out and the request genuinely succeeds — but
 * this machine declared it STALLED at 15 s and showed a failure with a Retry
 * that could only hit the same wall. Every cold start was reported as a fault.
 *
 * ⚠ **EXTENDING THE STALL THRESHOLD COSTS ALMOST NOTHING, AND THAT IS WHY IT
 * IS SAFE.** This machine only governs requests that are STILL PENDING; a
 * request that genuinely fails REJECTS, and its caller renders the error
 * immediately without consulting any phase. So the only waits pushed from 15 s
 * to 70 s are ones still in flight at 15 s — which, given a 60 s server-side
 * connect timeout, are overwhelmingly resumes. 70 s is past that timeout plus
 * margin, so by the time `stalled` fires the request really has no way left to
 * succeed.
 *
 * ⚠ **`waking` IS `role="status"`, NOT `role="alert"`.** It is progress, not
 * failure. This is the same distinction the 1200 ms notice makes, and it is
 * the whole correction: the old behaviour announced a healthy resume
 * assertively, as a fault.
 *
 * ⚠ **THE TIMERS RESET WHEN THE REQUEST DOES.** A retry that inherits the
 * previous attempt's elapsed time shows "Still working…" instantly, or lands
 * straight in the stalled state, telling the owner the fresh request has
 * already failed. Every phase change is driven off `pending` going false and
 * back to true, which is why `pending` is the only dependency.
 */
import { useEffect, useState } from 'react';

/** `specs/ux-states.md` §1. Exported so tests state the threshold once. */
export const SLOW_AFTER_MS = 1200;
/**
 * `specs/ux-states.md` §1 — past this the wait is attributed to a resuming
 * database, which is progress rather than failure. See the header.
 */
export const WAKING_AFTER_MS = 15000;
/**
 * `specs/ux-states.md` §1 — past this the wait becomes an error with a remedy.
 *
 * ⚠ MUST EXCEED `SQL_CONNECT_TIMEOUT_MS` (60 s, `apps/api/src/db/connection.ts`).
 * Set below it and this machine calls a request stalled while the server is
 * still waiting for the database to come back — reporting failure for a
 * request that is about to succeed, which is the exact defect it was changed
 * to fix.
 */
export const STALLED_AFTER_MS = 70000;

export type RequestPhase = 'idle' | 'normal' | 'slow' | 'waking' | 'stalled';

export function useSlowRequest(pending: boolean): RequestPhase {
  const [phase, setPhase] = useState<RequestPhase>(pending ? 'normal' : 'idle');

  useEffect(() => {
    if (!pending) {
      setPhase('idle');
      return;
    }

    // ⚠ Set synchronously as well as via the timers: a request that starts
    // after a previous one stalled must not keep showing the stalled state.
    setPhase('normal');
    const slow = setTimeout(() => setPhase('slow'), SLOW_AFTER_MS);
    const waking = setTimeout(() => setPhase('waking'), WAKING_AFTER_MS);
    const stalled = setTimeout(() => setPhase('stalled'), STALLED_AFTER_MS);

    return () => {
      clearTimeout(slow);
      clearTimeout(waking);
      clearTimeout(stalled);
    };
  }, [pending]);

  return phase;
}
