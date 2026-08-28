/**
 * TASK-076 — the batch-history container (`specs/ux-states.md` §9.1–§9.3).
 *
 * ⚠ `/batches` WAS MOUNTED ON A STUB THAT RENDERED THE WORDS "Batch history"
 * AND NOTHING ELSE. Containers fetch, pages render — the same split every
 * other screen here uses, and the same one whose absence made
 * `/not-interested` render an empty list against a working API (see
 * `SuppressedRoute`).
 */

import type { JSX } from 'react';

import { apiClient, type ApiClient } from '../lib/apiClient';
import { useResource } from '../lib/useResource';
import { BatchHistoryPage } from '../pages/BatchHistoryPage';
import { RefusalPage } from '../pages/RefusalPage';

export interface BatchHistoryRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
}

export function BatchHistoryRoute({
  client = apiClient,
}: BatchHistoryRouteProps = {}): JSX.Element {
  const batches = useResource((signal) => client.listBatches(signal), 'batches');

  if (batches.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  return (
    <BatchHistoryPage
      items={batches.resource.kind === 'ok' ? batches.resource.value.batches : []}
      loading={batches.resource.kind === 'loading'}
      loadFailed={batches.resource.kind === 'failed'}
      onRetry={batches.reload}
    />
  );
}
