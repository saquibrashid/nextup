/**
 * `/removed` — the removal history LOG, not a recycle bin (`specs/ui.md` §6,
 * `ux-states.md` §7, US-024, TASK-096).
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
 * ⚠ **RESTORE IS NOT HERE.** It is TASK-098/099 (`T-RES-*`), and `restorable`
 * / `suppressed` are carried on the row for it. Restoration is an explicit,
 * separate user action — never a consequence of viewing the log.
 */

import type { JSX } from 'react';

import { SERVICE_LABELS, dateAddedLabel, removedOnLabel } from '@nextup/domain';

import {
  REMOVED_CLEAR_SEARCH_LABEL,
  REMOVED_EMPTY_BODY,
  REMOVED_EMPTY_TITLE,
  REMOVED_LOADING,
  REMOVED_LOAD_ERROR,
  REMOVED_NO_MATCHES,
  REMOVED_VIEW_SUBTITLE,
  RETRY_LABEL,
} from '../copy';
import type { RemovedItem } from '../lib/apiClient';
import { TMDB_IMAGE_BASE } from '../components/TitleRow';

export interface RemovedPageProps {
  readonly items?: readonly RemovedItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  /** The search text currently APPLIED to `items`, not the input's value. */
  readonly query?: string;
  readonly onRetry?: () => void;
  readonly onClearSearch?: () => void;
}

/** §7.5's ordinal chip. `null` when the work has been removed exactly once. */
export function removalOrdinalLabel(item: {
  removalOrdinal: number;
  removalTotalForWork: number;
}): string | null {
  // ⚠ "Removal 1 of 1" is noise on the overwhelmingly common single-removal
  // row, and noise on every row is how the chip stops being read on the rows
  // where it carries the whole point.
  if (item.removalTotalForWork <= 1) {
    return null;
  }
  return `Removal ${item.removalOrdinal} of ${item.removalTotalForWork}`;
}

function RemovedRow({ item }: { item: RemovedItem }): JSX.Element {
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
        {/* ⚠ BOTH DATES, ALWAYS (US-024 AC-1). The date-added is what makes a
            restore honest — US-025 AC-2 gives the listing back its ORIGINAL
            date, and the owner can only trust that if they were shown it while
            it sat in the log. */}
        <span data-testid="removed-date-added">{dateAddedLabel(item.dateAdded)}</span>
        <span data-testid="removed-date-removed">
          {removedOnLabel(item.removedAt.slice(0, 10))}
        </span>
        {ordinal !== null && (
          <span className="removed-row__ordinal" data-testid="removed-ordinal">
            {ordinal}
          </span>
        )}
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
}: RemovedPageProps): JSX.Element {
  const searching = query.trim() !== '';

  return (
    <>
      <h1>Removal history</h1>
      {/* ⚠ `T-UI-011`. The subtitle is the framing, and it is shown in EVERY
          state including the empty one: an owner who arrives at an empty log
          needs to know it is a permanent record before they can read the
          emptiness as good news rather than as loss. */}
      <p data-testid="removed-subtitle">{REMOVED_VIEW_SUBTITLE}</p>

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
        <p role="status" data-testid="removed-loading">
          {REMOVED_LOADING}
        </p>
      ) : items.length === 0 ? (
        searching ? (
          <div data-testid="removed-no-matches">
            <p>{REMOVED_NO_MATCHES.replace('{q}', query)}</p>
            {onClearSearch !== undefined && (
              <button type="button" className="tap-target" onClick={onClearSearch}>
                {REMOVED_CLEAR_SEARCH_LABEL}
              </button>
            )}
          </div>
        ) : (
          <div data-testid="removed-empty">
            <p className="removed-empty__title">{REMOVED_EMPTY_TITLE}</p>
            <p className="removed-empty__body">{REMOVED_EMPTY_BODY}</p>
          </div>
        )
      ) : (
        <ul className="removed-list" data-testid="removed-list">
          {items.map((item) => (
            // ⚠ Keyed on the LISTING id, not the work identity. Two removals
            // of one work are two rows, and a work-keyed list would make React
            // discard one of them.
            <RemovedRow key={item.listingId} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}
