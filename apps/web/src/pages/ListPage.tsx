// `/` - the combined list (`specs/ui.md` §2, TASK-038).
//
// The filter bar (TASK-039) and the empty/error states (TASK-040) are wired in
// here. Still absent, deliberately, because a placeholder that renders would
// report as shipped: the sort control (TASK-166) and the load-more and offline
// states.
//
// ⚠ THE EMPTY STATES ARE NOT INTERCHANGEABLE (US-019 AC-5). "Nothing here yet"
// (never uploaded), "No titles match these filters" and "Nothing on your list
// right now" (all removed or suppressed) are three different facts, and showing
// the first when the truth is the second reads as data loss. The choice is made
// by `listEmptyKind()` from the facts, never by this page picking a message.

import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import { FilterBar, parseFilters, applyFilters, NO_FILTERS } from '../components/FilterBar';
import { FreshnessStrip, type ServiceFreshness } from '../components/FreshnessStrip';
import { ListEmptyState, ListLoadError } from '../components/ListEmptyState';
import { TitleList } from '../components/TitleList';
import type { TitleListItem } from '../components/TitleRow';
import { LIST_LOADING_BODY } from '../copy';

export interface ListPageProps {
  readonly items?: readonly TitleListItem[];
  /** `null` when `GET /api/service-state` could not be read (`T-FRESH-014`). */
  readonly serviceState?: readonly ServiceFreshness[] | null;
  /** Rows the API would return unfiltered — the empty-state discriminator. */
  readonly total?: number;
  readonly genres?: readonly string[];
  readonly removedCount?: number;
  readonly suppressedCount?: number;
  /** True when `GET /api/titles` failed (`ux-states.md` §2.9). */
  readonly loadFailed?: boolean;
  /**
   * True while the first read is in flight (`ux-states.md` §2.1).
   *
   * ⚠ NOT COSMETIC. Zero rows and no filters is indistinguishable from an
   * empty library, so without this the never-uploaded empty state renders on
   * every page load before the data arrives — telling an owner with a full
   * list that they have never uploaded anything.
   */
  readonly loading?: boolean;
  readonly onRetry?: () => void;
}

export function ListPage({
  items = [],
  serviceState = null,
  total,
  genres = [],
  removedCount = 0,
  suppressedCount = 0,
  loadFailed = false,
  loading = false,
  onRetry,
}: ListPageProps): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const shown = items.length;
  const unfilteredTotal = total ?? shown;

  return (
    <>
      <h1>Your list</h1>
      {/*
        The strip is informational and NEVER blocks the list (§2.1), so it is a
        sibling of the list rather than a gate in front of it: whatever it is
        showing, the rows below render unchanged.
      */}
      <FreshnessStrip services={serviceState} />

      {loadFailed ? (
        // ⚠ The filter bar is NOT rendered over a failed read. Its live count
        // would have to invent numbers it does not have, and "Showing 0 of 0"
        // beside "Nothing has changed" contradicts the reassurance.
        <ListLoadError {...(onRetry === undefined ? {} : { onRetry })} />
      ) : loading ? (
        // ⚠ Same reasoning as the failure branch, for the same reason: neither
        // the filter counts nor the empty state can tell the truth about data
        // that has not arrived, and the empty state's lie is the damaging one.
        <p role="status" data-testid="list-loading">
          {LIST_LOADING_BODY}
        </p>
      ) : (
        <>
          <FilterBar genres={genres} shown={shown} total={unfilteredTotal} />
          <TitleList items={items} />
          <ListEmptyState
            facts={{ shown, total: unfilteredTotal, filters, removedCount, suppressedCount }}
            onClearFilters={() => {
              setParams(applyFilters(params, NO_FILTERS));
            }}
          />
        </>
      )}
    </>
  );
}
