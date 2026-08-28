// `/removed` - the removal history LOG, not a recycle bin (specs/ui.md §6).
// TASK-096 — RemovedPage + REMOVED_VIEW_SUBTITLE (T-UI-009, T-UI-011).
// TASK-099 — restore UI and un-suppress-first flow (T-RES-016).
//
// ⚠ THE REMOVED VIEW IS A LOG (product invariant 7). A work removed three
// times yields three rows with ordinals — never de-duplicated. T-UI-009
// asserts three rows are rendered for one work with ordinals 1/3, 2/3, 3/3.
//
// ⚠ T-RES-016: each row has a Restore control. When the work is suppressed,
// the control drives the un-suppress-first flow rather than a bare 409.
// Restore stays an EXPLICIT user action — this file must never auto-restore.

import { useState, type JSX } from 'react';

import { REMOVED_VIEW_SUBTITLE, RETRY_LABEL } from '../copy';
import { ApiError } from '../lib/apiClient';
import type { RemovedItem } from '../lib/apiClient';

export interface RemovedPageProps {
  readonly items?: readonly RemovedItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  readonly onRetry?: () => void;
  readonly onRestore?: (
    listingId: string,
    opts?: { confirmDuplicate?: boolean },
  ) => Promise<unknown>;
  readonly onUnsuppress?: (unsuppressHref: string) => Promise<unknown>;
}

type RestorePhase =
  'idle' | 'submitting' | 'confirm-duplicate' | 'unsuppress-first' | 'done' | 'error';

interface RestoreState {
  readonly phase: RestorePhase;
  readonly errorMessage?: string;
  readonly unsuppressHref?: string;
}

/**
 * Restore control for one removed row.
 *
 * State machine: idle → submit → success (parent dismisses row)
 *                             → WORK_SUPPRESSED → unsuppress-first → idle
 *                             → DUPLICATE_WORK_IDENTITY → confirm-duplicate → submit
 *                             → error
 */
function RestoreControl({
  item,
  onRestore,
  onUnsuppress,
  onDone,
}: {
  item: RemovedItem;
  onRestore: (listingId: string, opts?: { confirmDuplicate?: boolean }) => Promise<unknown>;
  onUnsuppress: (unsuppressHref: string) => Promise<unknown>;
  onDone: () => void;
}): JSX.Element {
  const [state, setState] = useState<RestoreState>({ phase: 'idle' });

  async function attemptRestore(confirmDuplicate = false): Promise<void> {
    setState({ phase: 'submitting' });
    try {
      await onRestore(item.listingId, { confirmDuplicate });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (err.code === 'WORK_SUPPRESSED') {
          const href =
            typeof err.details['unsuppressHref'] === 'string'
              ? err.details['unsuppressHref']
              : undefined;
          setState({
            phase: 'unsuppress-first',
            ...(href !== undefined ? { unsuppressHref: href } : {}),
          });
          return;
        }
        if (err.code === 'DUPLICATE_WORK_IDENTITY') {
          setState({ phase: 'confirm-duplicate' });
          return;
        }
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setState({ phase: 'error', ...(msg !== undefined ? { errorMessage: msg } : {}) });
    }
  }

  async function doUnsuppress(): Promise<void> {
    const href = state.unsuppressHref;
    if (href === undefined) return;
    setState({ phase: 'submitting' });
    try {
      await onUnsuppress(href);
      setState({ phase: 'idle' });
    } catch {
      setState({ phase: 'error', errorMessage: 'Could not un-suppress. Nothing has changed.' });
    }
  }

  if (state.phase === 'idle') {
    return (
      <button
        type="button"
        className="tap-target"
        data-testid="restore-button"
        onClick={() => void attemptRestore()}
      >
        Restore
      </button>
    );
  }

  if (state.phase === 'submitting') {
    return (
      <button type="button" className="tap-target" disabled data-testid="restore-submitting">
        Restoring…
      </button>
    );
  }

  if (state.phase === 'unsuppress-first') {
    return (
      <div data-testid="unsuppress-first">
        <p data-testid="unsuppress-first-message">
          {`"\u200b${item.name}\u200b" is marked as not interested. Remove that first, then restore.`}
        </p>
        <button
          type="button"
          className="tap-target"
          data-testid="unsuppress-first-button"
          onClick={() => void doUnsuppress()}
        >
          Stop ignoring &amp; restore
        </button>
      </div>
    );
  }

  if (state.phase === 'confirm-duplicate') {
    return (
      <div data-testid="confirm-duplicate">
        <p data-testid="confirm-duplicate-message">
          {`A newer version of "\u200b${item.name}\u200b" is already on your list. Add this old listing back anyway?`}
        </p>
        <button
          type="button"
          className="tap-target"
          data-testid="confirm-duplicate-button"
          onClick={() => void attemptRestore(true)}
        >
          Add back anyway
        </button>
        <button
          type="button"
          className="tap-target"
          data-testid="confirm-duplicate-cancel"
          onClick={() => setState({ phase: 'idle' })}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <>
        <p role="alert" data-testid="restore-error">
          {state.errorMessage ??
            `Could not restore "\u200b${item.name}\u200b". Nothing has changed.`}
        </p>
        <button
          type="button"
          className="tap-target"
          data-testid="restore-button"
          onClick={() => void attemptRestore()}
        >
          Try again
        </button>
      </>
    );
  }

  // phase === 'done' — parent has dismissed the row; this branch is unreachable
  return <></>;
}

/** One row in the removal history log. */
function RemovedRow({
  item,
  onRestore,
  onUnsuppress,
  onDone,
}: {
  item: RemovedItem;
  onRestore: (listingId: string, opts?: { confirmDuplicate?: boolean }) => Promise<unknown>;
  onUnsuppress: (unsuppressHref: string) => Promise<unknown>;
  onDone: () => void;
}): JSX.Element {
  return (
    <li className="removed-row" data-testid="removed-row">
      <div className="removed-row__body">
        <span data-testid="removed-name">{item.name}</span>
        {item.releaseYear !== null && <span data-testid="removed-year">{item.releaseYear}</span>}
        <span data-testid="removed-service">{item.service}</span>
        <span data-testid="removed-ordinal">
          {`Removal ${String(item.removalOrdinal)} of ${String(item.removalTotalForWork)}`}
        </span>
        <RestoreControl
          item={item}
          onRestore={onRestore}
          onUnsuppress={onUnsuppress}
          onDone={onDone}
        />
      </div>
    </li>
  );
}

export function RemovedPage({
  items = [],
  loading = false,
  loadFailed = false,
  onRetry,
  onRestore = () => Promise.resolve(),
  onUnsuppress = () => Promise.resolve(),
}: RemovedPageProps): JSX.Element {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const visible = items.filter((item) => !dismissed.has(item.listingId));

  return (
    <>
      <h1>Removal history</h1>
      <p data-testid="removed-subtitle">{REMOVED_VIEW_SUBTITLE}</p>

      {loadFailed ? (
        <div role="alert" data-testid="removed-load-error">
          <p>{'Couldn\u2019t load your removal history. Nothing has changed.'}</p>
          {onRetry !== undefined && (
            <button type="button" className="tap-target" onClick={onRetry}>
              {RETRY_LABEL}
            </button>
          )}
        </div>
      ) : loading ? (
        <p role="status" data-testid="removed-loading">
          {'Loading your removal history\u2026'}
        </p>
      ) : (
        <ul data-testid="removed-list">
          {visible.map((item) => (
            <RemovedRow
              key={item.listingId}
              item={item}
              onRestore={onRestore}
              onUnsuppress={onUnsuppress}
              onDone={() => {
                setDismissed((prev) => new Set([...prev, item.listingId]));
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}
