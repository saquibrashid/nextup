/**
 * The load-more sentinel (`specs/ui.md` §2.1 item 4, `specs/ux-states.md` §2.6).
 *
 * ⚠ TWO AFFORDANCES, BOTH REQUIRED. §2.1 item 4 asks for an
 * `IntersectionObserver` that auto-loads the next page **plus** an explicit
 * "Load more" button, and the button is not decoration: a keyboard-only owner
 * tabbing down the rows never scrolls anything into view, so for them the
 * observer never fires and the list simply ends at row 50.
 *
 * ⚠ `IntersectionObserver` IS FEATURE-DETECTED. jsdom does not implement it,
 * and neither do the oldest browsers in scope; an unguarded `new
 * IntersectionObserver` throws during render and takes the whole list down
 * rather than losing an enhancement. The button works either way.
 */

import { useEffect, useRef, type JSX } from 'react';

import { LOAD_MORE, LOAD_MORE_BUSY, LOAD_MORE_FAILED, LOAD_MORE_RETRY } from '../copy';

export interface LoadMoreSentinelProps {
  readonly hasMore: boolean;
  readonly loadingMore?: boolean;
  readonly loadMoreFailed?: boolean;
  readonly onLoadMore: () => void;
}

export function LoadMoreSentinel({
  hasMore,
  loadingMore = false,
  loadMoreFailed = false,
  onLoadMore,
}: LoadMoreSentinelProps): JSX.Element | null {
  const target = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    /*
      ⚠ THE OBSERVER IS DETACHED AFTER A FAILURE, deliberately. The sentinel
      stays in view once the list stops growing, so an observer left attached
      re-fires on every scroll and retries a failing request forever — against
      one 0.25 vCPU replica, and with no way for the owner to stop it. After a
      failure the retry is the owner's explicit click.
    */
    if (!hasMore || loadMoreFailed || loadingMore) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const element = target.current;
    if (element === null) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMoreRef.current();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadMoreFailed, loadingMore]);

  // ⚠ Renders NOTHING once the last page is in hand. A permanently visible
  // "Load more" on a complete list claims there is more to see and, clicked,
  // does nothing at all.
  if (!hasMore) return null;

  return (
    <div className="load-more" ref={target} data-testid="load-more-sentinel">
      {loadMoreFailed && (
        <p role="alert" data-testid="load-more-error">
          {LOAD_MORE_FAILED}
        </p>
      )}
      <button
        type="button"
        className="tap-target"
        data-testid="load-more"
        aria-busy={loadingMore}
        onClick={onLoadMore}
      >
        {loadMoreFailed ? LOAD_MORE_RETRY : LOAD_MORE}
      </button>
      {loadingMore && (
        <p role="status" data-testid="load-more-busy">
          {LOAD_MORE_BUSY}
        </p>
      )}
    </div>
  );
}
