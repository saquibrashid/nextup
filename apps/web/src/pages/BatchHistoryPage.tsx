/**
 * `/batches` — upload history (`specs/ux-states.md` §9.1–§9.3, `specs/ui.md`
 * §1, US-031, TASK-076).
 *
 * ⚠ **AN EMPTY LIST AND AN UNLOADED LIST ARE THE SAME PIXELS AND OPPOSITE
 * FACTS.** §9.1 specifies skeletons and §9.2 specifies a sentence, and they
 * are separate states here for that reason: showing "You haven't uploaded
 * anything yet." while the request is still in flight tells this owner —
 * whose entire list came from uploads — that their history is gone.
 *
 * ⚠ **THE COUNTS ARE THE SERVER'S, NOT RECOMPUTED FROM PROVENANCE.** The card
 * shows creations, and a creation is one `title_created` folded into one
 * `listing_added` (`data-model.md` §3.7). This page has no `batch_change` rows
 * to fold, and inventing an approximation from what it does have would make
 * the card disagree with the detail page it links to.
 *
 * Props-driven, like every other page here: the fetch is `BatchHistoryRoute`'s
 * job, so the suite can drive all three states without a server.
 */

import type { JSX } from 'react';
import { Link } from 'react-router-dom';

import {
  BATCHES_COUNTS,
  BATCHES_EMPTY,
  BATCHES_EMPTY_ACTION_LABEL,
  BATCHES_LOADING,
  BATCHES_LOAD_ERROR,
  BATCHES_TITLE,
  RETRY_LABEL,
} from '../copy';
import type { BatchHistoryItem } from '../lib/apiClient';

export interface BatchHistoryPageProps {
  readonly items?: readonly BatchHistoryItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  readonly onRetry?: () => void;
}

const SERVICE_LABELS: Record<string, string> = { netflix: 'Netflix', max: 'Max' };
const MODE_LABELS: Record<string, string> = {
  append: 'Add to list',
  'full-update': 'Full update',
};

/** The count triple, §9.3. Exported so the assertion reads the same rule. */
export function countsLine(counts: BatchHistoryItem['counts']): string {
  return BATCHES_COUNTS.replace('{created}', String(counts.created))
    .replace('{modified}', String(counts.modified))
    .replace('{removed}', String(counts.removed));
}

/**
 * The card's date.
 *
 * ⚠ `createdAt` is when the batch was OPENED, which for an abandoned batch is
 * the only date it has. `completedAt` is preferred when present so a batch
 * opened on Monday and applied on Friday files under Friday, which is when it
 * changed the list.
 */
export function batchDate(item: BatchHistoryItem): string {
  const iso = item.completedAt ?? item.submittedAt ?? item.createdAt;
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function BatchCard({ item }: { item: BatchHistoryItem }): JSX.Element {
  return (
    <li className="batch-card" data-testid="batch-card">
      <Link to={`/batches/${item.batchId}`} data-testid="batch-card-link">
        <span data-testid="batch-card-date">{batchDate(item)}</span>
        <span data-testid="batch-card-service">{SERVICE_LABELS[item.service] ?? item.service}</span>
        <span data-testid="batch-card-mode">{MODE_LABELS[item.mode] ?? item.mode}</span>
        <span data-testid="batch-card-status">
          {item.undoneAt === null ? item.status : 'undone'}
        </span>
        <span data-testid="batch-card-counts">{countsLine(item.counts)}</span>
      </Link>
    </li>
  );
}

export function BatchHistoryPage({
  items = [],
  loading = false,
  loadFailed = false,
  onRetry,
}: BatchHistoryPageProps): JSX.Element {
  return (
    <>
      <h1>{BATCHES_TITLE}</h1>

      {loadFailed ? (
        <div role="alert" data-testid="batches-load-error">
          <p>{BATCHES_LOAD_ERROR}</p>
          {onRetry !== undefined && (
            <button type="button" className="tap-target" onClick={onRetry}>
              {RETRY_LABEL}
            </button>
          )}
        </div>
      ) : loading ? (
        <p role="status" data-testid="batches-loading">
          {BATCHES_LOADING}
        </p>
      ) : items.length === 0 ? (
        <div data-testid="batches-empty">
          <p>{BATCHES_EMPTY}</p>
          <Link to="/upload" className="tap-target" data-testid="batches-empty-action">
            {BATCHES_EMPTY_ACTION_LABEL}
          </Link>
        </div>
      ) : (
        <ul className="batch-history" data-testid="batches-list">
          {items.map((item) => (
            <BatchCard key={item.batchId} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}
