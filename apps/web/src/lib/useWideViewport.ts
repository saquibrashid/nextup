/**
 * `useWideViewport` — whether the viewport is at or above `--bp-sm`
 * (REQ-117, `specs/ui-refresh.md` §6, TASK-211).
 *
 * ⚠ **THIS IS A JAVASCRIPT DECISION BECAUSE IT IS A DOM DECISION.** The
 * obvious implementation of REQ-117 is CSS: render all eight destinations and
 * `display: none` the six that do not belong on a phone. That fails the
 * requirement in a way that looks like it passes. A hidden link is still in
 * the accessibility tree's reading order unless it is hidden in exactly the
 * right way, still focusable in several of the wrong ways, and — the part
 * that matters here — the phone bar's three slots would be a *claim* made by a
 * stylesheet that no test running in jsdom can see. `T-UX-132` asserts the bar
 * renders EXACTLY three things; only a real DOM difference can satisfy that.
 *
 * ⚠ **THE FALLBACK IS THE WIDE LAYOUT, AND THE DIRECTION IS LOAD-BEARING.**
 * When `matchMedia` is unavailable — jsdom without a stub, and any
 * non-browser render — this returns `true`, so every destination is a
 * first-class link. Defaulting the other way would collapse six routes behind
 * a disclosure in precisely the environments that cannot open it. The safe
 * failure of a progressive enhancement is *everything visible*, never
 * *something hidden*.
 *
 * ⚠ **SUBSCRIBED, NOT SAMPLED.** Reading `matchMedia(...).matches` once on
 * mount is the tempting one-liner and it is wrong: a phone rotating to
 * landscape crosses 640 px without remounting anything, and the bar would
 * stay in its phone shape with no event to blame. The listener is the feature.
 */

import { useEffect, useState } from 'react';

import { WIDE_VIEWPORT_QUERY } from '../breakpoints';

function readWideViewport(): boolean {
  /*
   * ⚠ Probed defensively — `matchMedia` is absent in jsdom unless a test
   * stubs it, and `window` is absent entirely under a non-DOM renderer. The
   * same probe shape as `ImageDropzone`'s coarse-pointer check, for the same
   * reason: a bare call throws at render time and takes the whole shell down.
   */
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches;
}

export function useWideViewport(): boolean {
  const [wide, setWide] = useState(readWideViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(WIDE_VIEWPORT_QUERY);
    const update = (): void => setWide(query.matches);

    /*
     * ⚠ RE-READ ON MOUNT for the same reason `useOnline` does: the viewport
     * can cross the breakpoint between the initial `useState` and this
     * effect, and a component mounted after the crossing receives no event
     * at all because the transition happened before it existed.
     */
    update();

    /*
     * ⚠ `addEventListener` WITH AN `addListener` FALLBACK. Safari only gained
     * `addEventListener` on `MediaQueryList` in 14, and this application's
     * primary device is an iPhone. On an older engine the modern call is
     * simply absent, the subscription never happens, and the bar freezes in
     * whatever shape it first rendered — with no error anywhere.
     */
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return wide;
}
