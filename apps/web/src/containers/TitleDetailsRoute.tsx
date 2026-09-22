import type { JSX } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { apiClient, ApiError, type ApiClient } from '../lib/apiClient';
import { useResource } from '../lib/useResource';
import { useOnline } from '../lib/useOnline';
import { useSlowRequest } from '../lib/useSlowRequest';
import { libraryQuery } from '../components/LibraryNavigation';
import { SlowResponseNotice } from '../components/SlowResponseNotice';
import { Button } from '../components/ui/Button';
import { RefusalPage } from '../pages/RefusalPage';
import { TitleDetailsPage } from '../pages/TitleDetailsPage';

export function detailsReturnTo(state: unknown): string {
  if (
    typeof state !== 'object' ||
    state === null ||
    !('librarySearch' in state) ||
    typeof state.librarySearch !== 'string'
  )
    return '/';
  return `/?${libraryQuery(new URLSearchParams(state.librarySearch))}`;
}

export function TitleDetailsRoute({
  client = apiClient,
}: {
  readonly client?: ApiClient;
}): JSX.Element {
  const { titleId = '' } = useParams();
  const location = useLocation();
  const backTo = detailsReturnTo(location.state);
  const { resource, reload } = useResource(async (signal) => {
    try {
      return await client.getTitle(titleId, signal);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }, `title:${titleId}`);
  const online = useOnline();
  const phase = useSlowRequest(resource.kind === 'loading');

  if (resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;
  if (resource.kind === 'ok' && resource.value !== null) {
    return (
      <TitleDetailsPage
        key={`${titleId}:${resource.value.workIdentity}`}
        item={resource.value}
        backTo={backTo}
        actions={client}
        offline={!online}
        onReload={reload}
      />
    );
  }
  return (
    <section className="title-details">
      <Link className="tap-target" to={backTo}>
        Back to Your list
      </Link>
      <h1>Title details</h1>
      {resource.kind === 'loading' ? (
        <div role="status">
          <p>Loading title details...</p>
          <SlowResponseNotice phase={phase} onRetry={reload} />
        </div>
      ) : resource.kind === 'failed' ? (
        <div role="alert">
          <p>Could not load this title. Your list has not changed.</p>
          <Button onClick={reload} disabled={!online}>
            Try again
          </Button>
          {!online && <p>Reconnect to try again.</p>}
        </div>
      ) : (
        <p>This title is not available in your library.</p>
      )}
    </section>
  );
}
