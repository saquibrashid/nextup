/**
 * `/removed` — the removal history LOG, not a recycle bin (`specs/ui.md` §6,
 * `ux-states.md` §7, US-024, TASK-096, TASK-099).
 *
 * ⚠ **THIS PAGE IS THE VISIBLE HALF OF REQ-028.** Soft-delete-forever is only
 * a promise the owner can rely on if they can *see* what was kept. Everything
 * below follows from that, and the two rules it imposes are unusual enough to
 * be worth stating outright:
 *
 * ⚠ **ONE ROW PER REMOVAL, NEVER ONE ROW PER WORK (`T-UI-009`, US-024 AC-6).**
 * A reappearing title becomes a brand-new listing (product invariant 7), so one
 * work legitimately owns several removals over time. De-duplicating them — the
 * natural instinct, and what every other list in this product does — would
 * silently collapse a history into a single most-recent event and destroy the
 * only record of the earlier ones. The ordinal chip ("Removal 2 of 3") is what
 * makes the non-collapse legible rather than looking like a rendering bug.
 *
 * ⚠ **AN EMPTY LOG AND A FAILED LOAD MUST NEVER RENDER THE SAME (AC-8).** An
 * empty removal history reads as *"nothing has ever been removed"* — a strong,
 * reassuring claim. Letting a network error render it makes the product state
 * something false about the owner's own data, in the one place they come to
 * check that nothing was lost. The load failure is therefore an `alert`, not
 * an empty state, and the never-removed and no-search-results empties are two
 * distinct messages (§7.2 vs §7.3).
 *
 * TASK-099: each row now carries a restore control (§7.5–7.10, T-RES-016).
 * Restore is an EXPLICIT user action — never automatic (product invariant 7).
 */

import { useState, type JSX } from 'react';

import { SERVICE_LABELS, dateAddedLabel, removedOnLabel } from '@nextup/domain';

import {
  OFFLINE_DISABLED_REASON,
  REMOVED_CLEAR_SEARCH_LABEL,
  REMOVED_EMPTY_BODY,
  REMOVED_EMPTY_TITLE,
  REMOVED_LOADING,
  REMOVED_LOAD_ERROR,
  REMOVED_NO_MATCHES,
  REMOVED_VIEW_SUBTITLE,
  RESTORE_ALREADY_ACTIVE,
  RESTORE_ALREADY_ACTIVE_REFRESH,
  RESTORE_DUPLICATE_BODY,
  RESTORE_DUPLICATE_CANCEL,
  RESTORE_DUPLICATE_KEEP_BOTH,
  RESTORE_LABEL,
  RESTORE_SUBMITTING_LABEL,
  RESTORE_SUCCESS,
  RESTORE_SUPPRESSED_ACTION,
  RESTORE_SUPPRESSED_BODY,
  RESTORE_SUPPRESSED_CANCEL,
  RETRY_LABEL,
} from '../copy';
import { ApiError } from '../lib/apiClient';
import type { RemovedItem, RestoreResponse } from '../lib/apiClient';
import { TMDB_IMAGE_BASE } from '../components/TitleRow';
import { LoadMoreSentinel } from '../components/LoadMoreSentinel';
import { useOnline } from '../lib/useOnline';

export interface RemovedPageProps {
  readonly items?: readonly RemovedItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  /** The search text currently APPLIED to `items`, not the input's value. */
  readonly query?: string;
  readonly onRetry?: () => void;
  readonly onClearSearch?: () => void;
  readonly onRestore?: (
    listingId: string,
    opts?: { confirmDuplicate?: boolean },
  ) => Promise<RestoreResponse>;
  readonly onUnsuppress?: (suppressionId: string) => Promise<unknown>;
  /** The load-more sentinel (§7.4). Defaults leave it unrendered. */
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly loadMoreFailed?: boolean;
  readonly onLoadMore?: () => void;
}

/**
 * §7.5's ordinal chip.
 *
 * ⚠ EVERY ROW CARRIES ONE, INCLUDING A WORK REMOVED EXACTLY ONCE. This
 * function used to return `null` at `removalTotalForWork <= 1`, citing "§7.5"
 * — which does not say that. Three specs say the opposite, and one of them is
 * the definition of done:
 *   • `specs/testing.md` §5 step 7 (the authoritative AC→test mapping,
 *     NFR-003) requires /removed to show **"Removal 1 of 1"** by name;
 *   • `specs/ui.md` "/removed" lists the ordinal chip as a per-**row**
 *     element, with no singleton exception;
 *   • `specs/ux-states.md` §7.5 — "One row per removed listing, with ordinal
 *     chips."
 *
 * ⚠ AND THE CHIP EARNS ITS PLACE AT ONE. `/removed` is a historical LOG, not a
 * recycle bin (L1/A33), and `specs/ui.md` requires that framing to be visible
 * in the interface or repeated rows read as a bug. "Removal 1 of 1" is what
 * tells the owner this row is one entry in a log that can hold more — so the
 * singleton is the case the framing matters MOST for, not the case to drop it.
 *
 * `null` is reserved for a nonsensical total (< 1), which is a data fault
 * rather than a display choice.
 */
export function removalOrdinalLabel(item: {
  removalOrdinal: number;
  removalTotalForWork: number;
}): string | null {
  if (item.removalTotalForWork < 1) {
    return null;
  }
  return `Removal ${item.removalOrdinal} of ${item.removalTotalForWork}`;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `'2026-01-04'` → `'4 Jan 2026'` — same format used by `dateAddedLabel`. */
export function formatDateShort(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return iso;
  const [, year, month, day] = match as unknown as [string, string, string, string];
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (monthName === undefined) return iso;
  return `${Number(day)} ${monthName} ${year}`;
}

/** Substitute `{name}` in a copy template. */
function withName(template: string, name: string): string {
  return template.replace('{name}', name);
}

/** Build the §7.7 success announcement with all three substitutions. */
function restoreSuccessMessage(
  name: string,
  service: 'netflix' | 'max',
  dateAdded: string,
): string {
  return RESTORE_SUCCESS.replace('{name}', name)
    .replace('{service}', SERVICE_LABELS[service])
    .replace('{date}', formatDateShort(dateAdded));
}

// ── Restore control state machine ────────────────────────────────────────

type RestorePhase =
  'idle' | 'submitting' | 'confirm-duplicate' | 'unsuppress-first' | 'already-active' | 'success';

interface RestoreState {
  readonly phase: RestorePhase;
  readonly unsuppressId?: string;
  readonly successMessage?: string;
}

/**
 * Extract the suppression id from the href the API returns.
 * `/api/suppressions/{id}/unsuppress` → `{id}`
 */
function extractSuppressionId(href: string): string | undefined {
  const match = /\/api\/suppressions\/([^/]+)\/unsuppress/.exec(href);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : undefined;
}

function RestoreControl({
  item,
  onRestore,
  onUnsuppress,
  onDismiss,
  offline,
}: {
  item: RemovedItem;
  onRestore: (listingId: string, opts?: { confirmDuplicate?: boolean }) => Promise<RestoreResponse>;
  onUnsuppress: (suppressionId: string) => Promise<unknown>;
  onDismiss: (msg: string) => void;
  offline: boolean;
}): JSX.Element | null {
  const [state, setState] = useState<RestoreState>({ phase: 'idle' });

  async function attemptRestore(confirmDuplicate = false): Promise<void> {
    setState({ phase: 'submitting' });
    try {
      const result = await onRestore(item.listingId, { confirmDuplicate });
      const msg = restoreSuccessMessage(item.name, item.service, result.dateAdded);
      onDismiss(msg);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (err.code === 'WORK_SUPPRESSED') {
          const href =
            typeof err.details['unsuppressHref'] === 'string'
              ? err.details['unsuppressHref']
              : undefined;
          const suppressionId = href !== undefined ? extractSuppressionId(href) : undefined;
          if (suppressionId !== undefined) {
            setState({ phase: 'unsuppress-first', unsuppressId: suppressionId });
          } else {
            setState({ phase: 'unsuppress-first' });
          }
          return;
        }
        if (err.code === 'DUPLICATE_WORK_IDENTITY') {
          setState({ phase: 'confirm-duplicate' });
          return;
        }
        if (err.code === 'LISTING_NOT_REMOVED') {
          setState({ phase: 'already-active' });
          return;
        }
      }
      // Other errors: fall back to idle (the ApiError's message was shown
      // by the caller or is visible in devtools; no silent swallow).
      setState({ phase: 'idle' });
    }
  }

  async function doUnsuppressAndRetry(): Promise<void> {
    const id = state.unsuppressId;
    if (id === undefined) return;
    setState({ phase: 'submitting' });
    try {
      await onUnsuppress(id);
      await attemptRestore();
    } catch {
      setState({ phase: 'idle' });
    }
  }

  if (state.phase === 'idle') {
    return (
      <>
        <button
          type="button"
          className="tap-target"
          data-testid="restore-button"
          disabled={offline}
          onClick={() => void attemptRestore()}
        >
          {RESTORE_LABEL}
        </button>
        {offline && <span className="offline-reason">{OFFLINE_DISABLED_REASON}</span>}
      </>
    );
  }

  if (state.phase === 'submitting') {
    return (
      <span className="removed-row__restoring" data-testid="restore-submitting" aria-busy="true">
        {RESTORE_SUBMITTING_LABEL}
      </span>
    );
  }

  if (state.phase === 'confirm-duplicate') {
    return (
      <div data-testid="restore-duplicate-dialog" role="alertdialog">
        <p>{withName(RESTORE_DUPLICATE_BODY, item.name)}</p>
        <button
          type="button"
          className="tap-target"
          data-testid="restore-keep-both"
          disabled={offline}
          onClick={() => void attemptRestore(true)}
        >
          {RESTORE_DUPLICATE_KEEP_BOTH}
        </button>
        {offline && <span className="offline-reason">{OFFLINE_DISABLED_REASON}</span>}
        <button
          type="button"
          className="tap-target"
          data-testid="restore-duplicate-cancel"
          onClick={() => setState({ phase: 'idle' })}
        >
          {RESTORE_DUPLICATE_CANCEL}
        </button>
      </div>
    );
  }

  if (state.phase === 'unsuppress-first') {
    return (
      <div data-testid="restore-suppressed-dialog" role="alertdialog">
        <p>{withName(RESTORE_SUPPRESSED_BODY, item.name)}</p>
        <button
          type="button"
          className="tap-target"
          data-testid="restore-unsuppress-action"
          disabled={offline}
          onClick={() => void doUnsuppressAndRetry()}
        >
          {RESTORE_SUPPRESSED_ACTION}
        </button>
        {offline && <span className="offline-reason">{OFFLINE_DISABLED_REASON}</span>}
        <button
          type="button"
          className="tap-target"
          data-testid="restore-suppressed-cancel"
          onClick={() => setState({ phase: 'idle' })}
        >
          {RESTORE_SUPPRESSED_CANCEL}
        </button>
      </div>
    );
  }

  if (state.phase === 'already-active') {
    return (
      <div data-testid="restore-already-active" role="alert">
        <p>{withName(RESTORE_ALREADY_ACTIVE, item.name)}</p>
        <button
          type="button"
          className="tap-target"
          data-testid="restore-refresh"
          disabled={offline}
          onClick={() => window.location.reload()}
        >
          {RESTORE_ALREADY_ACTIVE_REFRESH}
        </button>
        {offline && <span className="offline-reason">{OFFLINE_DISABLED_REASON}</span>}
      </div>
    );
  }

  return null;
}

function RemovedRow({
  item,
  onRestore,
  onUnsuppress,
  onDismiss,
  offline,
}: {
  item: RemovedItem;
  onRestore: (listingId: string, opts?: { confirmDuplicate?: boolean }) => Promise<RestoreResponse>;
  onUnsuppress: (suppressionId: string) => Promise<unknown>;
  onDismiss: (msg: string) => void;
  offline: boolean;
}): JSX.Element {
  const ordinal = removalOrdinalLabel(item);

  return (
    <li className="removed-row" data-testid="removed-row">
      {item.posterPath !== null ? (
        <img
          className="removed-row__poster"
          src={`${TMDB_IMAGE_BASE}${item.posterPath}`}
          alt=""
          data-testid="removed-poster"
        />
      ) : (
        <div
          className="removed-row__poster removed-row__poster--empty"
          data-testid="removed-poster-placeholder"
        />
      )}
      <div className="removed-row__body">
        <span className="removed-row__name" data-testid="removed-name">
          {item.name}
        </span>
        {item.releaseYear !== null && <span data-testid="removed-year">{item.releaseYear}</span>}
        <span className="removed-row__service" data-testid="removed-service">
          {SERVICE_LABELS[item.service]}
        </span>
        <span data-testid="removed-date-added">{dateAddedLabel(item.dateAdded)}</span>
        <span data-testid="removed-date-removed">
          {removedOnLabel(item.removedAt.slice(0, 10))}
        </span>
        {ordinal !== null && (
          <span className="removed-row__ordinal" data-testid="removed-ordinal">
            {ordinal}
          </span>
        )}
        <RestoreControl
          item={item}
          onRestore={onRestore}
          onUnsuppress={onUnsuppress}
          onDismiss={onDismiss}
          offline={offline}
        />
      </div>
    </li>
  );
}

export function RemovedPage({
  items = [],
  loading = false,
  loadFailed = false,
  query = '',
  onRetry,
  onClearSearch,
  onRestore,
  onUnsuppress,
  hasMore = false,
  loadingMore = false,
  loadMoreFailed = false,
  onLoadMore,
}: RemovedPageProps): JSX.Element {
  const online = useOnline();
  const offline = !online;
  const searching = query.trim() !== '';
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const visible = items.filter((i) => !dismissed.has(i.listingId));

  function handleDismiss(listingId: string, msg: string): void {
    setDismissed((prev) => new Set([...prev, listingId]));
    setAnnouncement(msg);
  }

  // Fallback no-op handlers for when restore is not wired.
  const doRestore = onRestore ?? (() => Promise.reject(new Error('No restore handler')));
  const doUnsuppress = onUnsuppress ?? (() => Promise.reject(new Error('No unsuppress handler')));

  return (
    <>
      <h1>Removal history</h1>
      <p data-testid="removed-subtitle">{REMOVED_VIEW_SUBTITLE}</p>

      {announcement !== null && (
        <p role="status" data-testid="restore-success-announcement">
          {announcement}
        </p>
      )}

      {loadFailed ? (
        <div role="alert" data-testid="removed-load-error">
          <p>{REMOVED_LOAD_ERROR}</p>
          {onRetry !== undefined && (
            <button type="button" className="tap-target" onClick={onRetry}>
              {RETRY_LABEL}
            </button>
          )}
        </div>
      ) : loading ? (
        <div role="status" data-testid="removed-loading" aria-label={REMOVED_LOADING}>
          <ul
            className="removed-list removed-list--loading"
            data-testid="removed-loading-skeletons"
          >
            {[0, 1, 2].map((index) => (
              <li
                key={index}
                className="removed-row removed-row--skeleton"
                data-testid="removed-row-skeleton"
                aria-hidden="true"
              />
            ))}
          </ul>
        </div>
      ) : visible.length === 0 && !searching && dismissed.size === 0 ? (
        <div data-testid="removed-empty">
          <p className="removed-empty__title">{REMOVED_EMPTY_TITLE}</p>
          <p className="removed-empty__body">{REMOVED_EMPTY_BODY}</p>
        </div>
      ) : visible.length === 0 && searching ? (
        <div data-testid="removed-no-matches">
          <p>{REMOVED_NO_MATCHES.replace('{q}', query)}</p>
          {onClearSearch !== undefined && (
            <button type="button" className="tap-target" onClick={onClearSearch}>
              {REMOVED_CLEAR_SEARCH_LABEL}
            </button>
          )}
        </div>
      ) : (
        <ul className="removed-list" data-testid="removed-list">
          {visible.map((item) => (
            <RemovedRow
              key={item.listingId}
              item={item}
              onRestore={doRestore}
              onUnsuppress={doUnsuppress}
              onDismiss={(msg) => handleDismiss(item.listingId, msg)}
              offline={offline}
            />
          ))}
        </ul>
      )}
      {/*
        The load-more sentinel (`specs/ux-states.md` §7.4, `specs/ui.md` §2.1
        item 4). ⚠ OUTSIDE the branch above so it survives the "no matches"
        state — a search that matches nothing on page 1 may still match on page
        2, and hiding the control there strands the owner on an empty screen
        that is not actually empty. It renders nothing without a handler and
        nothing once `hasMore` is false, so no other state gains a control.

        ⚠ THE REMOVAL LOG IS WHERE THIS MATTERS MOST OVER TIME. By product
        invariant 7 it legitimately accumulates several rows for the same work,
        so it is the list most certain to outgrow one page — and the one whose
        truncation reads exactly like the deletions being forgotten.
      */}
      {onLoadMore !== undefined && !loading && !loadFailed && (
        <LoadMoreSentinel
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMoreFailed={loadMoreFailed}
          onLoadMore={onLoadMore}
        />
      )}
    </>
  );
}
