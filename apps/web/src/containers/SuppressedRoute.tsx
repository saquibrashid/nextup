/**
 * TASK-107 — the not-interested container (`specs/ui.md` §7/§12, ADR-0012).
 *
 * ⚠ **`SuppressedPage` WAS COMPLETE, CORRECT AND PROP-DRIVEN THE WHOLE TIME,
 * AND `/not-interested` RENDERED AN EMPTY LIST AGAINST A WORKING API.** Twenty
 * component tests passed, every one of them injecting `items` by hand; the
 * route table mounted the page with no props at all, so `items` defaulted to
 * `[]` and the screen said, in effect, "you have never marked anything not
 * interested" to an owner who had. That reads as data loss and is
 * indistinguishable from it. This file is the missing layer, not a change to
 * the page: containers fetch, pages render.
 *
 * ⚠ **UN-SUPPRESSION IS A MUTATION AND LIVES IN AN EVENT HANDLER** (REQ-102,
 * §12.6). It is passed down as `onUnsuppress` and invoked from the row's
 * confirmed click — never from a render effect, which React 19 double-invokes
 * under `<StrictMode>` and would fire twice.
 *
 * ⚠ **THE LIST IS NOT REFETCHED AFTER A SUCCESSFUL UN-SUPPRESSION.** The page
 * already drops the row locally, and a refetch would be a second read whose
 * only visible effect is to make the row disappear a second time — while a
 * failed refetch would replace a screen that just worked with an error state
 * about something that already succeeded.
 */

import type { JSX } from 'react';

import { apiClient, type ApiClient } from '../lib/apiClient';
import { useResource } from '../lib/useResource';
import { RefusalPage } from '../pages/RefusalPage';
import { SuppressedPage } from '../pages/SuppressedPage';

export interface SuppressedRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
}

export function SuppressedRoute({ client = apiClient }: SuppressedRouteProps = {}): JSX.Element {
  const suppressions = useResource((signal) => client.getSuppressions(signal), 'suppressions');

  // A refusal is the whole screen (§12.2): the owner is authenticated, so the
  // retry the failure state offers could never succeed, and merging the two
  // would offer it anyway.
  if (suppressions.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  return (
    <SuppressedPage
      items={suppressions.resource.kind === 'ok' ? suppressions.resource.value.items : []}
      loading={suppressions.resource.kind === 'loading'}
      loadFailed={suppressions.resource.kind === 'failed'}
      onRetry={suppressions.reload}
      onUnsuppress={(suppressionId) => client.unsuppress(suppressionId)}
    />
  );
}
