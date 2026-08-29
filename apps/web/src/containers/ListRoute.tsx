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
import { useLocation, useSearchParams } from 'react-router-dom';

import { type AppliedBatch } from '../components/BatchAppliedNotice';
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

/**
 * The `location.state` left by `ReviewRoute` after a close, narrowed to an
 * `AppliedBatch` or to `undefined`.
 *
 * ⚠ **VALIDATED, NEVER CAST.** History state is not trusted input: it survives
 * a reload, it is restored by the back button, and a browser session restored
 * across a deploy can hand this route a shape from an older build. A cast
 * would put `undefined.listingsRemoved` into the notice's copy and blank the
 * list with a render error — on the one screen whose whole job is to prove
 * nothing was lost.
 *
 * ⚠ Returns `undefined` rather than a default notice. There is no safe
 * fallback: a notice with invented counts, or one offering an undo whose
 * `removalGroupId` we do not have, is worse than no notice at all.
 */
export function parseAppliedState(state: unknown): AppliedBatch | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const applied = (state as { applied?: unknown }).applied;
  if (typeof applied !== 'object' || applied === null) return undefined;

  const { batchId, service, summary, undoable } = applied as Record<string, unknown>;
  if (typeof batchId !== 'string' || batchId === '') return undefined;
  if (service !== 'netflix' && service !== 'max') return undefined;
  if (typeof undoable !== 'boolean') return undefined;
  if (typeof summary !== 'object' || summary === null) return undefined;

  const { listingsCreated, listingsRemoved, removalGroupId } = summary as Record<string, unknown>;
  if (typeof listingsCreated !== 'number' || typeof listingsRemoved !== 'number') return undefined;
  if (removalGroupId !== null && typeof removalGroupId !== 'string') return undefined;

  return {
    batchId,
    service,
    summary: { listingsCreated, listingsRemoved, removalGroupId },
    undoable,
  };
}

export function ListRoute({ client = apiClient }: ListRouteProps = {}): JSX.Element {
  const [params] = useSearchParams();
  const location = useLocation();
  const query = params.toString();
  const filtered = isFiltered(parseFilters(params));
  const applied = parseAppliedState(location.state);

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
   * ⚠ KNOWN GAP, DELIBERATELY NOT PAPERED OVER: `removedCount` is not passed.
   * `GET /api/removed` (§6.9) and `client.getRemoved` now both exist, so the
   * blocker is no longer availability but cost: reading it would add a fourth
   * request to every list load on a single 0.25 vCPU replica to answer a
   * question that only matters when the unfiltered list came back empty. Its
   * default of 0 is wrong in exactly one case: an empty list where titles were
   * removed and none suppressed, which then reads "Nothing here yet" instead
   * of "Nothing on your list right now" (US-019 AC-5). Inventing a number
   * would hide that; leaving it defaulted keeps it findable and grep-able.
   *
   * ~~Superseded: "because `GET /api/removed` (§6.9) does not exist yet — it
   * belongs to Epic H."~~ The endpoint shipped with TASK-099; the comment
   * outlived the fact it asserted.
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
      /*
        ⚠ THE UNDO CHAIN (US-017 AC-1, §6.13). `applied` is present only on the
        navigation `ReviewRoute` makes after a successful close; on every
        ordinary visit it is `undefined` and the notice does not render.

        ⚠ The two handlers are passed UNCONDITIONALLY, even when `applied` is
        absent. `ListPage` substitutes `rejectMissingHandler` for a missing
        one, so a notice wired to `applied` alone would render an Undo button
        whose only possible outcome is the failure message.
      */
      {...(applied !== undefined ? { applied } : {})}
      onUndoRemovalGroup={(groupId) => client.undoRemovalGroup(groupId)}
      onUndoBatch={(batchId) => client.undoBatch(batchId)}
      /*
        ⚠ THE FOUR ROW-ACTION CALLS. Without these the `⋮` renders and does
        nothing — the defect this wiring exists to close. They are passed as a
        set because `ListPage` refuses to render a partly-wired menu.
      */
      onSuppress={(titleId) => client.suppressTitle(titleId)}
      onUnsuppress={(suppressionId) => client.unsuppress(suppressionId)}
      onSearchTmdb={(query) => client.searchTmdb(query)}
      onFixMatch={(titleId, body) => client.fixMatch(titleId, body)}
    />
  );
}
