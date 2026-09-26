/**
 * #391 — the waiting details container (`/waiting/:titleId`).
 *
 * CONTAINERS FETCH, PAGES RENDER (see `WaitingRoute`). Two reads, side by
 * side:
 *
 * - `GET /api/waiting` for the row itself — its access state and forecast.
 *   ⚠ It is the SAME read `/waiting` makes, so the availability refresh still
 *   has exactly one trigger and one caller (`T-AVAIL-002b`); this page adds
 *   no second path to it.
 * - `GET /api/titles/:titleId` for everything TMDB knows — runtime, genres,
 *   rating, synopsis, credits and trailer. A waiting work is stored as a
 *   title with no listing, so the Library's detail read serves it unchanged
 *   and its lazy metadata refresh is the only one involved.
 */

import type { JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { apiClient, ApiError, type ApiClient } from '../lib/apiClient';
import { useOnline } from '../lib/useOnline';
import { useResource } from '../lib/useResource';
import { useSlowRequest } from '../lib/useSlowRequest';
import { SlowResponseNotice } from '../components/SlowResponseNotice';
import { Button } from '../components/ui/Button';
import { RefusalPage } from '../pages/RefusalPage';
import { WaitingDetailsPage } from '../pages/WaitingDetailsPage';

export function WaitingDetailsRoute({
  client = apiClient,
}: {
  readonly client?: ApiClient;
}): JSX.Element {
  const { titleId = '' } = useParams();
  const navigate = useNavigate();
  const { resource, reload } = useResource(async (signal) => {
    const [waiting, title] = await Promise.all([
      client.getWaiting(signal),
      client.getTitle(titleId, signal).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    ]);
    const item = waiting.items.find((candidate) => candidate.titleId === titleId) ?? null;
    return item === null || title === null ? null : { item, title };
  }, `waiting:${titleId}`);
  const online = useOnline();
  const phase = useSlowRequest(resource.kind === 'loading');

  if (resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;
  if (resource.kind === 'ok' && resource.value !== null) {
    return (
      <WaitingDetailsPage
        key={`${titleId}:${resource.value.item.intentId}`}
        item={resource.value.item}
        title={resource.value.title}
        offline={!online}
        onReload={reload}
        onSuppress={(id) => client.suppressTitle(id)}
        onSuppressed={() => navigate('/waiting')}
      />
    );
  }
  return (
    <section className="title-details">
      <Link className="tap-target" to="/waiting">
        Back to Waiting to stream
      </Link>
      <h1>Waiting title details</h1>
      {resource.kind === 'loading' ? (
        <div role="status">
          <p>Loading title details...</p>
          <SlowResponseNotice phase={phase} onRetry={reload} />
        </div>
      ) : resource.kind === 'failed' ? (
        <div role="alert">
          <p>Could not load this title. Your waiting list has not changed.</p>
          <Button onClick={reload} disabled={!online}>
            Try again
          </Button>
          {!online && <p>Reconnect to try again.</p>}
        </div>
      ) : (
        <p data-testid="waiting-details-missing">This title is not on your waiting list.</p>
      )}
    </section>
  );
}
