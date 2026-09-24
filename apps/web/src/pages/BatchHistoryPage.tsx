/**
 * `/batches` — the Review destination (issue 369): imports that need review,
 * then import history (`specs/ux-states.md` §9.1–§9.3, `specs/ui.md`
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
import { batchSourceLabel } from '@nextup/domain';

import {
  BATCHES_COUNTS,
  BATCHES_EMPTY,
  BATCHES_EMPTY_ACTION_LABEL,
  BATCHES_HISTORY_TITLE,
  BATCHES_LOADING,
  BATCHES_LOAD_ERROR,
  BATCHES_NEEDS_REVIEW_TITLE,
  BATCHES_TITLE,
  BATCHES_UNDO_LABEL,
  BATCHES_UNDO_SUBMITTING,
  OFFLINE_DISABLED_REASON,
  RETRY_LABEL,
} from '../copy';
import type { BatchHistoryItem } from '../lib/apiClient';
import { Button } from '../components/ui/Button';
import { resumeAction } from '../lib/useUploadCheckpoint';

export interface BatchHistoryPageProps {
  readonly items?: readonly BatchHistoryItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  readonly onRetry?: () => void;
  /**
   * §9.3 — attempt to undo a batch. The server decides whether it can: a
   * creates-only batch is reversed, anything else answers 409 and the container
   * routes that refusal into the §9.8 panel. Absent when undo is not wired.
   */
  readonly onUndo?: (batchId: string) => void;
  /**
   * §9.6 — the batch whose undo is in flight. Its card shows *"Undoing…"* and
   * its button is guarded against a second submit; every other card stays
   * actionable. `null`/absent when no undo is in flight.
   */
  readonly undoingBatchId?: string | null;
  /**
   * §9.11 — offline. Undo is an irreversible `POST`; offline it can only fail,
   * so every *Undo this batch* button is disabled with the reason as visible
   * text. Reading the history stays available — this blocks the mutation, not
   * the browse. The global banner is `AppShell`'s job, not this page's.
   */
  readonly offline?: boolean;
}

/**
 * Issue 369 — the Review page's two sections. An import NEEDS REVIEW only while
 * it still has a next step (`resumeAction`: a draft, a read in progress, a
 * review to finish, an extraction to resolve). Applied, undone and discarded
 * imports are history: putting them under "Needs review" would claim work the
 * owner has already done.
 */
export function needsReview(item: BatchHistoryItem): boolean {
  return item.undoneAt === null && resumeAction(item.status) !== null;
}

/**
 * §9.3 — a batch the owner may attempt to undo. An `applied` batch not already
 * undone is offerable; the server has the final say and refuses the rest into
 * the §9.8 panel, so this is deliberately the coarse gate rather than a client
 * re-derivation of `undoable` the history DTO does not carry.
 */
export function canOfferUndo(item: BatchHistoryItem): boolean {
  return item.status === 'applied' && item.undoneAt === null;
}

const MODE_LABELS: Record<string, string> = {
  'append-only': 'Add to library',
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

function BatchCard({
  item,
  onUndo,
  undoing = false,
  offline = false,
}: {
  item: BatchHistoryItem;
  onUndo?: (batchId: string) => void;
  undoing?: boolean;
  offline?: boolean;
}): JSX.Element {
  const resume = item.undoneAt === null ? resumeAction(item.status) : null;
  return (
    <li className="batch-card" data-testid="batch-card">
      <Link to={`/batches/${item.batchId}`} data-testid="batch-card-link">
        <span data-testid="batch-card-date">{batchDate(item)}</span>
        <span data-testid="batch-card-service">{batchSourceLabel(item)}</span>
        <span data-testid="batch-card-mode">{MODE_LABELS[item.mode] ?? item.mode}</span>
        <span data-testid="batch-card-status">
          {item.undoneAt === null ? (resume?.state ?? item.status) : 'undone'}
        </span>
        <span data-testid="batch-card-counts">{countsLine(item.counts)}</span>
        {resume !== null && <span>{resume.label}</span>}
      </Link>
      {onUndo !== undefined && canOfferUndo(item) && (
        <>
          <span className="batch-card__undo">
            {/* Layout only — the margin belongs to the card, the look to §7d. */}
            <Button
              variant="secondary"
              data-testid="batch-card-undo"
              disabled={undoing || offline}
              aria-busy={undoing}
              onClick={() => onUndo(item.batchId)}
            >
              {undoing ? BATCHES_UNDO_SUBMITTING : BATCHES_UNDO_LABEL}
            </Button>
          </span>
          {offline && (
            <span className="offline-reason" data-testid="batch-card-offline-reason">
              {OFFLINE_DISABLED_REASON}
            </span>
          )}
        </>
      )}
    </li>
  );
}

export function BatchHistoryPage({
  items = [],
  loading = false,
  loadFailed = false,
  onRetry,
  onUndo,
  undoingBatchId = null,
  offline = false,
}: BatchHistoryPageProps): JSX.Element {
  return (
    <>
      <h1>{BATCHES_TITLE}</h1>

      {loadFailed ? (
        <div role="alert" data-testid="batches-load-error">
          <p>{BATCHES_LOAD_ERROR}</p>
          {onRetry !== undefined && (
            <Button variant="secondary" onClick={onRetry}>
              {RETRY_LABEL}
            </Button>
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
        <div data-testid="batches-list">
          {(
            [
              ['needs-review', BATCHES_NEEDS_REVIEW_TITLE, items.filter(needsReview)],
              ['history', BATCHES_HISTORY_TITLE, items.filter((item) => !needsReview(item))],
            ] as const
          ).map(([key, title, group]) =>
            group.length === 0 ? null : (
              <section key={key} aria-labelledby={`batches-${key}-heading`}>
                <h2 id={`batches-${key}-heading`}>{title}</h2>
                <ul className="batch-history" data-testid={`batches-${key}`}>
                  {group.map((item) => (
                    <BatchCard
                      key={item.batchId}
                      item={item}
                      undoing={item.batchId === undoingBatchId}
                      offline={offline}
                      {...(onUndo ? { onUndo } : {})}
                    />
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}
    </>
  );
}
