/**
 * `useSlowRequest` — the timing behind *"Never an indefinite spinner"*
 * (`specs/ux-states.md` §1, `T-UX-001`).
 *
 * A pending request passes through three phases:
 *
 * | Phase     | From     | What the owner sees                        |
 * | --------- | -------- | ------------------------------------------ |
 * | `normal`  | 0 ms     | Skeletons / spinner                        |
 * | `slow`    | 1200 ms  | `SlowResponseNotice` — *"Still working…"*  |
 * | `stalled` | 15000 ms | The `slow` error state, with **Retry**     |
 *
 * ⚠ **THE 15 s PHASE IS THE POINT OF THE RULE.** A notice that says "Still
 * working…" forever is an indefinite spinner with better manners — it never
 * stops being true, so it can never tell the owner that something has gone
 * wrong, and it offers nothing to do about it. §1 requires the wait to
 * *terminate* in something actionable.
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
/** `specs/ux-states.md` §1 — past this the wait becomes an error with a remedy. */
export const STALLED_AFTER_MS = 15000;

export type RequestPhase = 'idle' | 'normal' | 'slow' | 'stalled';

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
    const stalled = setTimeout(() => setPhase('stalled'), STALLED_AFTER_MS);

    return () => {
      clearTimeout(slow);
      clearTimeout(stalled);
    };
  }, [pending]);

  return phase;
}
