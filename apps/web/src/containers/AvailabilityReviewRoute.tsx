/**
 * US-064 — the "Availability changes" container (`/availability`, PRD `A55`).
 *
 * ⚠ **CONTAINERS FETCH, PAGES RENDER.** One read per mount, no polling, no
 * interval. The read asks TMDB nothing (§6.45); the only lookups are the
 * owner's explicit "Check more titles" taps, made by the page.
 */

import { useRef, type JSX } from 'react';

import { apiClient, type ApiClient, type AvailabilityReviewResponse } from '../lib/apiClient';
import { useOnline } from '../lib/useOnline';
import { useResource } from '../lib/useResource';
import { AvailabilityReviewPage } from '../pages/AvailabilityReviewPage';
import { RefusalPage } from '../pages/RefusalPage';

export interface AvailabilityReviewRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
}

export function AvailabilityReviewRoute({
  client = apiClient,
}: AvailabilityReviewRouteProps = {}): JSX.Element {
  const review = useResource((signal) => client.getAvailabilityReview(signal), 'availability');
  const online = useOnline();
  // ⚠ A re-read after an answer keeps the last screen up, so the result line
  // and any refused rows do not vanish while the fresh read is in flight.
  const last = useRef<AvailabilityReviewResponse | null>(null);

  if (review.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;
  if (review.resource.kind === 'ok') last.current = review.resource.value;
  if (review.resource.kind === 'failed') last.current = null;

  return (
    <AvailabilityReviewPage
      data={last.current}
      loading={review.resource.kind === 'loading'}
      loadFailed={review.resource.kind === 'failed'}
      onRetry={review.reload}
      offline={!online}
      actions={client}
      onChanged={review.reload}
    />
  );
}
