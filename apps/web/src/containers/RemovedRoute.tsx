/**
 * The removed-view container (`specs/ui.md` §7, ADR-0012).
 *
 * ⚠ **THREE FINISHED PIECES WERE JOINED BY NOTHING.** `GET /api/removed`
 * (§6.9) was built and registered; `RemovedPage` was built, 398 lines of it,
 * complete with TASK-099's `RestoreControl`; and `routes.tsx` mounted the page
 * **bare, with no props at all**, so `items` defaulted to `[]`. `/removed` told
 * every owner that nothing had ever been removed, against a working API, and
 * the restore control could never be reached because `onRestore` was
 * `undefined` on every row.
 *
 * This is the THIRD instance of the same defect and the second of this exact
 * shape — `SuppressedPage` had it until TASK-107, for the same reason and with
 * the same symptom. **Containers fetch, pages render**, and a page test that
 * injects `items` by hand measures rendering while saying nothing about
 * whether anything ever fetches. `T-INFRA-013b` is what surfaced it: the gate
 * reported `restoreListing` as a client method no screen referenced.
 *
 * ⚠ **AN EMPTY REMOVED VIEW IS THE ONE LIE THIS SCREEN MUST NOT TELL.** The
 * removed view is a historical LOG, not a recycle bin (product invariant 7),
 * and it is how the owner sees that a full-update lost nothing (REQ-028). A
 * failed read therefore renders the failure state; it must never degrade to an
 * empty list, which is indistinguishable from the log having been erased.
 *
 * ⚠ **RESTORE IS AN EXPLICIT USER ACTION AND STAYS IN AN EVENT HANDLER**
 * (product invariant 7, REQ-102). React 19 double-invokes effects under
 * `<StrictMode>`, so the same call placed in one would restore a listing the
 * owner never asked to restore — which, for a screen whose entire job is that
 * nothing changes without being asked, is the worst available bug.
 *
 * ⚠ **NO REFETCH AFTER A SUCCESSFUL RESTORE.** The page already dismisses the
 * row locally. A refetch's only visible effect would be to remove the row a
 * second time, and a refetch that FAILED would replace a screen that just
 * worked with an error about something that already succeeded.
 */

import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import { apiClient, type ApiClient } from '../lib/apiClient';
import { useResource } from '../lib/useResource';
import { useCursorPages } from '../lib/useCursorPages';
import { withCursor } from './ListRoute';
import { RefusalPage } from '../pages/RefusalPage';
import { RemovedPage } from '../pages/RemovedPage';

export interface RemovedRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
}

export function RemovedRoute({ client = apiClient }: RemovedRouteProps = {}): JSX.Element {
  const [params, setParams] = useSearchParams();
  const query = params.toString();

  const removed = useResource((signal) => client.getRemoved(query, signal), `removed:${query}`);

  /**
   * §7.4 — the pages after the first. ⚠ Called before the refusal return
   * below, because hooks may not be conditional.
   *
   * ⚠ THE REMOVAL LOG IS THE LIST MOST CERTAIN TO OUTGROW ONE PAGE. By product
   * invariant 7 a reappearing title becomes a brand-new row, so the log
   * legitimately holds several entries for the same work over time and only
   * ever grows. Truncated silently at 50, the oldest removals — the ones the
   * owner is most likely to be hunting for — simply cease to exist on screen.
   */
  const paged = useCursorPages(
    removed.resource.kind === 'ok' ? removed.resource.value : null,
    (cursor, signal) =>
      client.getRemoved(withCursor(query, cursor), signal).then((page) => ({
        items: page.items,
        nextCursor: page.nextCursor,
      })),
    query,
  );

  // A refusal is the whole screen (§12.2): the owner is authenticated, so the
  // retry the failure state offers could never succeed.
  if (removed.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  return (
    <RemovedPage
      items={paged.items}
      hasMore={paged.hasMore}
      loadingMore={paged.loadingMore}
      loadMoreFailed={paged.loadMoreFailed}
      onLoadMore={paged.loadMore}
      loading={removed.resource.kind === 'loading'}
      loadFailed={removed.resource.kind === 'failed'}
      // ⚠ The APPLIED search, read back from the URL rather than from an
      // input's value — `RemovedPage` renders no search box, and `query` feeds
      // only the "no matches for {q}" empty state. Passing an unapplied value
      // would name a term the results were not actually filtered by.
      query={params.get('q') ?? ''}
      onRetry={removed.reload}
      onClearSearch={() => {
        const next = new URLSearchParams(params);
        next.delete('q');
        // The cursor is a position within the OLD result set and cannot
        // survive the filter changing underneath it.
        next.delete('cursor');
        setParams(next);
      }}
      onRestore={(listingId, opts) => client.restoreListing(listingId, opts ?? {})}
      onUnsuppress={(suppressionId) => client.unsuppress(suppressionId)}
    />
  );
}
