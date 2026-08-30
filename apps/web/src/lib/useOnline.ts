/**
 * `useOnline` — the one place the app learns it has no network
 * (`specs/ux-states.md` §11: every surface owes an offline state).
 *
 * ⚠ **THIS EXISTS BECAUSE OFFLINE WAS IMPLEMENTED ON EXACTLY ONE SURFACE.**
 * Batch status (§5.8) had a full, careful implementation — banner, paused
 * polling, an immediate refetch on reconnect — and the other six surfaces had
 * none. Offline on the list, upload, review, removed, not-interested and
 * batches screens surfaced as whatever the failed `fetch` happened to produce:
 * the generic load-failure error, or nothing at all. §11 requires a state per
 * surface precisely so a lost connection never reads as "nextup is broken".
 *
 * ⚠ **`onReconnect` IS HALF OF `T-UX-024`, NOT A CONVENIENCE.** An offline
 * state that never clears is as bad as none: the owner reconnects and the
 * screen still tells them they are offline. The other half is what this hook
 * deliberately does NOT do — it never touches, resets or remounts anything the
 * owner has typed or decided. `T-UX-024` pairs with `T-UX-023` because an
 * offline state that recovers by discarding a half-finished review is a
 * data-loss bug wearing an error message.
 *
 * ⚠ **`connectivity` READS TRUE WHEN ONLINE**, matching `navigator.onLine`
 * rather than inverting it. Every consumer is then named after the DOM
 * property it stands in for, and no call site has to remember a local
 * inversion.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseOnlineOptions {
  /**
   * Injected so the offline states are drivable without a real network.
   *
   * ⚠ `| undefined` is explicit because `exactOptionalPropertyTypes` is on and
   * every caller forwards an optional prop straight through.
   */
  readonly connectivity?: (() => boolean) | undefined;
  /**
   * Run when the connection comes back — a refetch or a retry.
   *
   * ⚠ Called on the `online` EVENT only, never on mount, so a surface that
   * loads normally does not immediately load a second time.
   */
  readonly onReconnect?: (() => void) | undefined;
}

export function useOnline({ connectivity, onReconnect }: UseOnlineOptions = {}): boolean {
  const isOnline = useCallback(
    (): boolean =>
      connectivity === undefined
        ? typeof navigator === 'undefined' || navigator.onLine !== false
        : connectivity(),
    [connectivity],
  );

  const [online, setOnline] = useState(isOnline);

  /*
   * ⚠ HELD IN A REF SO THE LISTENERS ARE REGISTERED ONCE. A caller passing an
   * inline arrow — which is every caller — would otherwise tear down and
   * re-add the `online`/`offline` listeners on every single render. That is
   * not merely wasteful: a reconnect landing in the gap between removal and
   * re-addition is missed entirely, and the banner never clears.
   */
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const goOffline = (): void => setOnline(false);
    const goOnline = (): void => {
      setOnline(true);
      onReconnectRef.current?.();
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    /*
     * ⚠ RE-READ ON MOUNT. The connection can drop between the initial
     * `useState` and this effect — and, more commonly in practice, a surface
     * mounted while already offline never receives an `offline` event at all,
     * because the transition happened before it existed.
     */
    setOnline(isOnline());

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [isOnline]);

  return online;
}
