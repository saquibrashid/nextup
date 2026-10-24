/**
 * The Recently watched container (US-074, `A66`). Containers fetch, pages
 * render. A failed read is a failure state, never an empty history.
 */

import type { JSX } from 'react';

import { apiClient, type ApiClient } from '../lib/apiClient';
import { useCursorPages } from '../lib/useCursorPages';
import { useResource } from '../lib/useResource';
import { RefusalPage } from '../pages/RefusalPage';
import { WatchedPage } from '../pages/WatchedPage';

export interface WatchedRouteProps {
  readonly client?: ApiClient;
}

export function WatchedRoute({ client = apiClient }: WatchedRouteProps = {}): JSX.Element {
  const history = useResource((signal) => client.getWatchedHistory(null, signal), 'watched');

  const paged = useCursorPages(
    history.resource.kind === 'ok' ? history.resource.value : null,
    (cursor, signal) =>
      client.getWatchedHistory(cursor, signal).then((page) => ({
        items: page.items,
        nextCursor: page.nextCursor,
      })),
    'watched',
  );

  if (history.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  return (
    <WatchedPage
      items={paged.items}
      hasMore={paged.hasMore}
      loadingMore={paged.loadingMore}
      loadMoreFailed={paged.loadMoreFailed}
      onLoadMore={paged.loadMore}
      loading={history.resource.kind === 'loading'}
      loadFailed={history.resource.kind === 'failed'}
      onRetry={history.reload}
      api={client}
    />
  );
}
