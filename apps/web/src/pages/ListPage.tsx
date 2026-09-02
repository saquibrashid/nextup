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
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { FilterBar, parseFilters, applyFilters, NO_FILTERS } from '../components/FilterBar';
import { BatchAppliedNotice, type AppliedBatch } from '../components/BatchAppliedNotice';
import { FreshnessStrip, type ServiceFreshness } from '../components/FreshnessStrip';
import { ListEmptyState, ListLoadError } from '../components/ListEmptyState';
import { RowMenu } from '../components/RowMenu';
import { SortControl } from '../components/SortControl';
import { SuppressDialog, type RowState } from '../components/SuppressDialog';
import {
  FixMatchDialog,
  type FixMatchRequest,
  type FixMatchResponse,
  type TmdbSearchResponse,
} from '../components/FixMatchDialog';
import { TitleList } from '../components/TitleList';
import { LoadMoreSentinel } from '../components/LoadMoreSentinel';
import type { TitleListItem } from '../components/TitleRow';
import { LIST_LOADING_BODY, OFFLINE_NOTHING_LOADED, OFFLINE_SHOWING_CACHED } from '../copy';

export interface ListPageProps {
  readonly items?: readonly TitleListItem[];
  /** `null` when `GET /api/service-state` could not be read (`T-FRESH-014`). */
  readonly serviceState?: readonly ServiceFreshness[] | null;
  /** Rows the API would return unfiltered — the empty-state discriminator. */
  readonly total?: number;
  /**
   * `true` when more rows exist than were fetched (the API returned a
   * `nextCursor`), making `total` a lower bound rather than a count.
   *
   * ⚠ It is passed STRAIGHT THROUGH to `FilterBar` and deliberately NOT fed
   * to `ListEmptyState`: `hasMore` and "the list is empty" cannot both be
   * true, so a discriminator that consulted it would be reasoning about a
   * state that cannot occur — and would obscure the one that can.
   */
  readonly totalIsLowerBound?: boolean;
  /**
   * The load-more sentinel (`specs/ui.md` §2.1 item 4).
   *
   * ⚠ DEFAULTS TO `false`, so a caller that has not been taught to page shows
   * no control rather than an inert one. The page owns none of this state: the
   * cursor lives in the container, because the sentinel must survive the page
   * re-rendering for a row menu or a dialog.
   */
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly loadMoreFailed?: boolean;
  readonly onLoadMore?: () => void;
  readonly genres?: readonly string[];
  readonly removedCount?: number;
  readonly suppressedCount?: number;
  /** True when `GET /api/titles` failed (`ux-states.md` §2.9). */
  readonly loadFailed?: boolean;
  /**
   * §2.12 — the connection is gone. The list becomes READ-ONLY: cached rows
   * stay on screen and are marked as cached, and the row menu's mutating
   * actions are withheld rather than offered and then failing.
   */
  readonly offline?: boolean;
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
  /**
   * The batch that was just applied, when the owner arrived here from a close
   * (`ux-states.md` §6.13). Absent on every ordinary visit.
   */
  readonly applied?: AppliedBatch;
  readonly onUndoRemovalGroup?: (groupId: string) => Promise<unknown>;
  readonly onUndoBatch?: (batchId: string) => Promise<unknown>;
  /**
   * The four row-action calls (`ui.md` §2.3).
   *
   * ⚠ ALL FOUR OR NONE, exactly as `ReviewPage` treats the unmatched actions.
   * A menu offering "Fix match" over a missing `fixMatch` would open a dialog
   * whose search works and whose confirm cannot, which is worse than a row
   * with no menu at all: the owner picks the right work, presses confirm and
   * is told nothing.
   */
  readonly onSuppress?: (titleId: string) => Promise<SuppressedResult>;
  readonly onUnsuppress?: (suppressionId: string) => Promise<unknown>;
  readonly onSearchTmdb?: (query: string) => Promise<TmdbSearchResponse>;
  readonly onFixMatch?: (titleId: string, body: FixMatchRequest) => Promise<FixMatchResponse>;
}

/** `POST /api/titles/:titleId/suppress` — `specs/api.md` §6.6. */
interface SuppressedResult {
  suppressionId: string;
  workIdentity: string;
  alreadySuppressed: boolean;
}

/** Which dialog the row menu opened, and over which row. */
type OpenDialog =
  | { readonly kind: 'suppress'; readonly item: TitleListItem }
  | { readonly kind: 'fix-match'; readonly item: TitleListItem };

/**
 * ⚠ Rejects rather than resolving. A missing handler means the container did
 * not wire the undo, and a resolving stub would render "those titles are back"
 * over a list where nothing was reversed — the one lie this notice must never
 * tell. The rejection puts the owner in the failed state, which correctly says
 * the changes are still applied.
 */
function rejectMissingHandler(): Promise<never> {
  return Promise.reject(new Error('undo handler not wired'));
}

export function ListPage({
  items = [],
  serviceState = null,
  total,
  totalIsLowerBound = false,
  hasMore = false,
  loadingMore = false,
  loadMoreFailed = false,
  onLoadMore,
  genres = [],
  removedCount = 0,
  suppressedCount = 0,
  loadFailed = false,
  offline = false,
  loading = false,
  onRetry,
  applied,
  onUndoRemovalGroup,
  onUndoBatch,
  onSuppress,
  onUnsuppress,
  onSearchTmdb,
  onFixMatch,
}: ListPageProps): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const [menuFor, setMenuFor] = useState<TitleListItem | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  /**
   * ⚠ ROWS ARE HIDDEN ON `suppressed`, NEVER ON `pending`. `SuppressDialog`
   * reports `pending` while the POST is in flight and `suppressed` only once
   * the server has persisted it (`T-UX-085a`); hiding on `pending` would be
   * the optimistic-then-reconcile behaviour TASK-102 specifically rejected,
   * and a failed request would leave a row hidden that is still on the list.
   */
  const [rowStates, setRowStates] = useState<Readonly<Record<string, RowState>>>({});

  // ⚠ ALL FOUR OR NONE — see `onSuppress` above.
  const suppressFn = onSuppress;
  const unsuppressFn = onUnsuppress;
  const searchFn = onSearchTmdb;
  const fixMatchFn = onFixMatch;
  const rowActionsWired =
    suppressFn !== undefined &&
    unsuppressFn !== undefined &&
    searchFn !== undefined &&
    fixMatchFn !== undefined;

  const visible = items.filter((item) => rowStates[item.titleId] !== 'suppressed');
  const shown = visible.length;
  const unfilteredTotal = total ?? shown;

  const closeAll = (): void => {
    setMenuFor(null);
    setDialog(null);
  };

  return (
    <>
      <h1>Your list</h1>
      {/*
        ⚠ OUTSIDE the loading/failure branches below. The notice reports a
        write that has already happened; hiding it because `GET /api/titles`
        failed would take away the undo at exactly the moment the owner cannot
        see what the batch did.
      */}
      {applied !== undefined && (
        <BatchAppliedNotice
          applied={applied}
          undoRemovalGroup={onUndoRemovalGroup ?? rejectMissingHandler}
          undoBatch={onUndoBatch ?? rejectMissingHandler}
        />
      )}
      {/*
        The strip is informational and NEVER blocks the list (§2.1), so it is a
        sibling of the list rather than a gate in front of it: whatever it is
        showing, the rows below render unchanged.
      */}
      <FreshnessStrip services={serviceState} />

      {/*
        §2.12 (`T-UX-023`) — the rows the owner is looking at were loaded
        before the connection went, and they say so. The banner in `AppShell`
        states the fact; this states its consequence for what is on screen.
      */}
      {offline && items.length > 0 && (
        <p className="offline-cached-note" data-testid="list-cached-note">
          {OFFLINE_SHOWING_CACHED}
        </p>
      )}

      {loadFailed && !offline ? (
        // ⚠ The filter bar is NOT rendered over a failed read. Its live count
        // would have to invent numbers it does not have, and "Showing 0 of 0"
        // beside "Nothing has changed" contradicts the reassurance.
        <ListLoadError {...(onRetry === undefined ? {} : { onRetry })} />
      ) : offline && items.length === 0 ? (
        /*
          ⚠ §2.12 / `T-UX-023` — OFFLINE WITH NOTHING CACHED IS NOT AN EMPTY
          LIST, and it is not the generic load failure either. Falling through
          to the empty state would tell an owner with a full library that they
          have never uploaded anything, which is the same damaging lie the
          `loading` branch below exists to prevent — arrived at by a different
          route. Falling through to `ListLoadError` would blame nextup for the
          owner's network.
        */
        <p role="status" data-testid="list-offline-empty">
          {OFFLINE_NOTHING_LOADED}
        </p>
      ) : loading ? (
        // ⚠ Same reasoning as the failure branch, for the same reason: neither
        // the filter counts nor the empty state can tell the truth about data
        // that has not arrived, and the empty state's lie is the damaging one.
        <p role="status" data-testid="list-loading">
          {LIST_LOADING_BODY}
        </p>
      ) : (
        <>
          <FilterBar
            genres={genres}
            shown={shown}
            total={unfilteredTotal}
            totalIsLowerBound={totalIsLowerBound}
          />
          <SortControl />
          <TitleList
            items={visible}
            {...(rowActionsWired
              ? {
                  onOpenMenu: (item: TitleListItem) => {
                    setMenuFor(item);
                  },
                  // The unmatched row's "Find a match" goes STRAIGHT to the
                  // dialog (§2.2): there is no identity to suppress yet, so a
                  // two-item menu would offer one item.
                  onFixMatch: (item: TitleListItem) => {
                    setDialog({ kind: 'fix-match', item });
                  },
                }
              : {})}
          />
          {/*
            ⚠ BELOW THE LIST AND INSIDE THE SAME BRANCH. It must not render
            over the loading, failure or offline states: a "Load more" beneath
            "Couldn't load your list" offers to fetch page 2 of a list whose
            page 1 never arrived.

            ⚠ Rendered only when the container supplied a handler. `hasMore`
            alone would draw a button with nothing behind it — the exact defect
            the four row actions are passed as a set to avoid.
          */}
          {onLoadMore !== undefined && (
            <LoadMoreSentinel
              hasMore={hasMore}
              loadingMore={loadingMore}
              loadMoreFailed={loadMoreFailed}
              onLoadMore={onLoadMore}
            />
          )}
          {menuFor !== null && (
            <RowMenu
              item={menuFor}
              offline={offline}
              onDismiss={closeAll}
              onChoose={(choice) => {
                const item = menuFor;
                setMenuFor(null);
                setDialog(
                  choice === 'suppress' ? { kind: 'suppress', item } : { kind: 'fix-match', item },
                );
              }}
            />
          )}
          {dialog !== null && suppressFn !== undefined && unsuppressFn !== undefined && (
            <>
              {dialog.kind === 'suppress' && (
                <SuppressDialog
                  titleId={dialog.item.titleId}
                  name={dialog.item.name}
                  suppress={suppressFn}
                  unsuppress={unsuppressFn}
                  onRowState={(state) => {
                    setRowStates((prev) => ({ ...prev, [dialog.item.titleId]: state }));
                  }}
                  onClose={closeAll}
                />
              )}
            </>
          )}
          {dialog !== null &&
            dialog.kind === 'fix-match' &&
            searchFn !== undefined &&
            fixMatchFn !== undefined && (
              <FixMatchDialog
                titleId={dialog.item.titleId}
                name={dialog.item.name}
                badges={dialog.item.badges}
                searchTmdb={searchFn}
                fixMatch={fixMatchFn}
                onClose={closeAll}
              />
            )}
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
