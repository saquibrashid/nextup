/**
 * TASK-189 — the waiting container (`/waiting`).
 *
 * ⚠ **CONTAINERS FETCH, PAGES RENDER**, and TASK-107 is why that rule is
 * written down: `SuppressedPage` was complete, correct and prop-driven while
 * `/not-interested` rendered an empty list against a working API, because the
 * route table mounted it with no props. This file is the layer that stops the
 * same thing happening here.
 *
 * ⚠ **THIS FETCH IS THE ONLY TRIGGER FOR THE AVAILABILITY REFRESH** (REQ-086,
 * product invariant 5). One read per mount, no polling, no interval, no
 * revalidate-on-focus. If the owner never opens this screen, nextup never asks
 * TMDB anything.
 *
 * ⚠ **"NOT INTERESTED" IS A MUTATION AND LIVES IN AN EVENT HANDLER**, never in
 * a render effect — React 19 double-invokes those under `<StrictMode>`. It
 * calls the ordinary `suppressTitle`, because a waiting work is suppressed on
 * canonical work identity exactly like any other work (US-043 AC-4,
 * REQ-070/071); a second, waiting-specific suppression path would be a second
 * thing that can disagree with the first.
 *
 * ⚠ **THE LIST IS NOT REFETCHED AFTER A SUPPRESSION.** The page already drops
 * the row, a refetch's only visible effect would be to make it disappear
 * twice, and a failed refetch would replace a screen that just worked with an
 * error about something that already succeeded.
 */

import type { JSX } from 'react';

import { apiClient, type ApiClient } from '../lib/apiClient';
import { useResource } from '../lib/useResource';
import { RefusalPage } from '../pages/RefusalPage';
import { WaitingPage } from '../pages/WaitingPage';

export interface WaitingRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
}

export function WaitingRoute({ client = apiClient }: WaitingRouteProps = {}): JSX.Element {
  const waiting = useResource((signal) => client.getWaiting(signal), 'waiting');

  // A refusal is the whole screen: the owner is authenticated, so the retry a
  // failure state offers could never succeed.
  if (waiting.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  const value = waiting.resource.kind === 'ok' ? waiting.resource.value : null;

  return (
    <WaitingPage
      items={value?.items ?? []}
      loading={waiting.resource.kind === 'loading'}
      loadFailed={waiting.resource.kind === 'failed'}
      refreshFailed={value?.availabilityRefreshFailed ?? false}
      onRetry={waiting.reload}
      onSuppress={(titleId) => client.suppressTitle(titleId)}
    />
  );
}
