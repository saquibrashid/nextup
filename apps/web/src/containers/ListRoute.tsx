/**
 * TASK-177 — the list container (`specs/ui.md` §12, ADR-0012).
 *
 * ⚠ THIS IS THE TASK THE WHOLE EPIC EXISTS FOR. `ListPage` was complete,
 * correct and prop-driven the entire time, rendering "Showing 0 of 0" against
 * a working API, and every gate stayed green because every test injected its
 * props. The page is barely touched here: containers fetch, pages render.
 *
 * ⚠ THE REQUEST IS DERIVED FROM THE URL, NOT MIRRORED FROM IT (REQ-101). The
 * query string is handed to the API verbatim, so the back button, a reload and
 * a shared link all produce the list the visible controls claim. A copy in
 * component state desynchronises on all three — silently.
 */

import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import { isFiltered, parseFilters } from '../components/FilterBar';
import { apiClient, type ApiClient, type TitleListItem } from '../lib/apiClient';
import { useResource } from '../lib/useResource';
import { ListPage } from '../pages/ListPage';
import { RefusalPage } from '../pages/RefusalPage';

export interface ListRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
}

/** The genre facet, derived from the rows rather than requested separately. */
export function collectGenres(items: readonly TitleListItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b));
}

export function ListRoute({ client = apiClient }: ListRouteProps = {}): JSX.Element {
  const [params] = useSearchParams();
  const query = params.toString();
  const filtered = isFiltered(parseFilters(params));

  const titles = useResource((signal) => client.getTitles(query, signal), `titles:${query}`);

  /**
   * The unfiltered rows behind "Showing X of Y" and the genre facet.
   *
   * ⚠ Requested ONLY when a filter is active, because when none is, the
   * filtered request already IS the unfiltered one — a second identical call
   * would double the cost of every list load on a single 0.25 vCPU replica to
   * re-fetch a number already on screen.
   */
  const all = useResource(
    (signal) => (filtered ? client.getTitles('', signal) : Promise.resolve(null)),
    `titles-all:${String(filtered)}`,
  );

  /**
   * ⚠ Read for the EMPTY-STATE DISCRIMINATOR, not for decoration. On an empty
   * list, `suppressedCount > 0` is what separates "Nothing on your list right
   * now" from "Nothing here yet", and showing the latter when the former is
   * true reads as data loss (US-019 AC-5).
   */
  const suppressions = useResource((signal) => client.getSuppressions(signal), 'suppressions');

  /**
   * ⚠ Informational, and NEVER a gate in front of the list (§2.1). Its failure
   * renders as `null`, which `FreshnessStrip` already treats as "state
   * unknown" (`T-FRESH-014`) — a failed strip must not blank the list.
   */
  const serviceState = useResource((signal) => client.getServiceState(signal), 'service-state');

  // A refusal is the whole screen: there is nothing to show around it, and the
  // retry the failure state offers could never succeed here (§12.2).
  // `not-allowed` specifically — a 403 is the allow-list, never an expired
  // session, which by §12.3 has already redirected and never reaches here.
  if (titles.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  const items = titles.resource.kind === 'ok' ? titles.resource.value.items : [];
  const unfiltered =
    all.resource.kind === 'ok' && all.resource.value !== null ? all.resource.value.items : items;

  /**
   * ⚠ KNOWN GAP, DELIBERATELY NOT PAPERED OVER: `removedCount` is not passed,
   * because `GET /api/removed` (§6.9) does not exist yet — it belongs to Epic
   * H. Its default of 0 is wrong in exactly one case: an empty list where
   * titles were removed and none suppressed, which then reads "Nothing here
   * yet" instead of "Nothing on your list right now". Inventing a number would
   * hide that; leaving it defaulted keeps it findable and grep-able.
   *
   * ⚠ `total` is capped at one page until the API returns a count, because
   * §6.2 answers with `items`/`nextCursor`/`limit` and no total. It is only
   * consulted for the "of Y" display and for an empty unfiltered list, both of
   * which are correct below the page size.
   */
  return (
    <ListPage
      items={items}
      serviceState={
        serviceState.resource.kind === 'ok' ? serviceState.resource.value.services : null
      }
      total={unfiltered.length}
      genres={collectGenres(unfiltered)}
      suppressedCount={
        suppressions.resource.kind === 'ok' ? suppressions.resource.value.items.length : 0
      }
      loading={titles.resource.kind === 'loading'}
      loadFailed={titles.resource.kind === 'failed'}
      onRetry={titles.reload}
    />
  );
}
