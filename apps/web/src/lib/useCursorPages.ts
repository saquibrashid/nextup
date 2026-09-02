/**
 * Cursor pagination for the list and the removed view (`specs/ui.md` §2.1
 * item 4, `specs/api.md` §3).
 *
 * ⚠ WHY THIS EXISTS. `useResource` loads exactly one page and stops. The API
 * has always paged at `DEFAULT_PAGE_LIMIT = 50` and has always answered with a
 * `nextCursor`; `apiClient.ts` has always typed it. Nothing in `apps/web/src`
 * ever read it, so **every title past the fiftieth was unreachable in the UI**
 * — no error, no empty state, no hint that anything was missing. The count
 * even reported them as absent until `T-UX-015` made it hedge. This hook is
 * the other half of that fix: the hedge stops the lie, this stops the loss.
 *
 * ⚠ PAGES ACCUMULATE; THEY DO NOT REPLACE. Paging is additive here, unlike
 * every other read in the app. Replacing the rows on "Load more" would empty
 * the screen the owner was reading and scroll them into a list that starts at
 * row 51 with no way back — indistinguishable from the first fifty having been
 * deleted, which is the US-019 AC-5 misreading the whole product is designed
 * against.
 *
 * ⚠ ACCUMULATION IS DISCARDED WHENEVER THE FIRST PAGE CHANGES IDENTITY. A new
 * filter, a new sort, a retry and the reconnect refetch all produce a fresh
 * first page, and pages 2..n fetched under the OLD query do not belong beneath
 * it. Keeping them would show rows that contradict the filter chips on screen
 * — the silent desynchronisation REQ-101 exists to prevent, arrived at from
 * the other direction.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** The paged shape every list endpoint answers with (`specs/api.md` §3). */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface CursorPages<T> {
  /** Page 1 followed by every page loaded since, in order. */
  readonly items: readonly T[];
  /** `null` once the last page is in hand — the sentinel hides on `false`. */
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  /**
   * ⚠ A FAILED "load more" IS NOT A FAILED LIST. The rows already on screen
   * stay exactly as they are; only the sentinel reports the failure. Promoting
   * it to the page-level error state would blank a list that loaded perfectly
   * because its *next* page did not.
   */
  readonly loadMoreFailed: boolean;
  readonly loadMore: () => void;
}

export function useCursorPages<T>(
  firstPage: CursorPage<T> | null,
  loadPage: (cursor: string, signal: AbortSignal) => Promise<CursorPage<T>>,
  key: string,
): CursorPages<T> {
  const [pages, setPages] = useState<readonly CursorPage<T>[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  // `loadPage` is an inline arrow at every call site, so it is a new function
  // on every render; depending on it would re-fire the effects forever. Same
  // reasoning, and the same ref, as `useResource`.
  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;

  /**
   * The cursors already SUCCESSFULLY spent.
   *
   * ⚠ THIS IS A LOOP GUARD, NOT AN OPTIMISATION. The sentinel auto-loads on
   * intersection, so a server that answered with the cursor it was handed
   * would drive an unbounded request loop against a single 0.25 vCPU replica
   * as fast as the browser could dispatch it. Repeating a spent cursor is
   * therefore surfaced as a failure rather than ignored: it is a bug, and a
   * silently stalled sentinel would hide rows all over again.
   *
   * ⚠ A cursor is recorded only on SUCCESS. Recording it on dispatch would
   * make the "Try again" button — the whole point of the explicit control —
   * report a loop instead of retrying.
   */
  const spent = useRef<Set<string>>(new Set());
  const inFlight = useRef<AbortController | null>(null);
  const busy = useRef(false);

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    busy.current = false;
    spent.current = new Set();
    setPages([]);
    setLoadingMore(false);
    setLoadMoreFailed(false);
  }, []);

  // ⚠ Keyed on the first page's OBJECT IDENTITY as well as on `key`. `key` is
  // the query string, which does NOT change on a retry or on the reconnect
  // refetch — both of which still hand back a fresh page 1 that pages 2..n
  // were not fetched against.
  useEffect(() => {
    reset();
  }, [firstPage, key, reset]);

  // Abort a page still in flight when the route unmounts, so its `setState`
  // never lands on a component that is gone.
  useEffect(() => {
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, []);

  const last = pages.at(-1) ?? firstPage;
  const cursor = last?.nextCursor ?? null;

  // Read through a ref so `loadMore` keeps a stable identity: it is a
  // dependency of the sentinel's IntersectionObserver effect, and a new
  // function each render would tear down and re-create the observer on every
  // render — which re-fires `isIntersecting` and loads a page nobody asked for.
  const cursorRef = useRef<string | null>(cursor);
  cursorRef.current = cursor;

  const loadMore = useCallback(() => {
    const next = cursorRef.current;
    if (next === null || busy.current) return;

    if (spent.current.has(next)) {
      setLoadMoreFailed(true);
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    busy.current = true;
    setLoadingMore(true);
    setLoadMoreFailed(false);

    loadPageRef.current(next, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return;
        busy.current = false;
        spent.current.add(next);
        setPages((current) => [...current, page]);
        setLoadingMore(false);
      },
      () => {
        // An abort is not a failure — see `useResource`. Under StrictMode and
        // on unmount the controller fires before the promise settles.
        if (controller.signal.aborted) return;
        busy.current = false;
        setLoadingMore(false);
        setLoadMoreFailed(true);
      },
    );
  }, []);

  const items: readonly T[] =
    firstPage === null ? [] : [...firstPage.items, ...pages.flatMap((page) => [...page.items])];

  return { items, hasMore: cursor !== null, loadingMore, loadMoreFailed, loadMore };
}
