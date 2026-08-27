// `/not-interested` — suppressed works (specs/ui.md §7, TASK-107).
//
// ⚠ UN-SUPPRESSION IS EXPLICIT AND DELIBERATE. The page shows every work the
// owner has marked "not interested". Each row has one affordance: "Stop
// ignoring". The confirmation copy (`UNSUPPRESS_CONFIRM_BODY`) states plainly
// that this does not restore anything that was removed — un-suppression and
// restoration are two different things (US-029 AC-4).
//
// ⚠ The suppression id, not the row id, is what the API uses (REQ-071). The
// `displaySnapshot` is FROZEN at suppression time and may no longer correspond
// to a live title — the suppression key is the identity, and the snapshot is
// only for display.
//
// ⚠ A row with `identityStability: 'text-derived'` needs a caveat line
// (`UNMATCHED_SUPPRESSION_CAVEAT`): the suppression was keyed on read text,
// and a future screenshot that reads the title slightly differently would
// produce a new row and bypass it.

import { useState, type JSX } from 'react';

import { RETRY_LABEL, UNMATCHED_SUPPRESSION_CAVEAT, UNSUPPRESS_CONFIRM_BODY } from '../copy';
import { withName } from '../components/SuppressDialog';
import type { SuppressionItem } from '../lib/apiClient';
import { TMDB_IMAGE_BASE } from '../components/TitleRow';

export interface SuppressedPageProps {
  readonly items?: readonly SuppressionItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  readonly onRetry?: () => void;
  readonly onUnsuppress?: (suppressionId: string) => Promise<unknown>;
}

type RowPhase = 'idle' | 'confirming' | 'submitting' | 'done' | 'error';

interface RowState {
  readonly phase: RowPhase;
}

/** One row in the not-interested list. */
function SuppressionRow({
  item,
  onUnsuppress,
  onDone,
}: {
  item: SuppressionItem;
  onUnsuppress: (suppressionId: string) => Promise<unknown>;
  onDone: () => void;
}): JSX.Element {
  const [rowState, setRowState] = useState<RowState>({ phase: 'idle' });
  const { displaySnapshot, identityStability, suppressionId } = item;
  const name = displaySnapshot.name;
  const year = displaySnapshot.releaseYear;

  function confirm(): void {
    setRowState({ phase: 'submitting' });
    onUnsuppress(suppressionId).then(
      () => {
        onDone();
      },
      () => {
        setRowState({ phase: 'error' });
      },
    );
  }

  return (
    <li className="suppressed-row" data-testid="suppressed-row">
      {displaySnapshot.posterPath !== null ? (
        <img
          className="suppressed-row__poster"
          src={`${TMDB_IMAGE_BASE}${displaySnapshot.posterPath}`}
          alt=""
          data-testid="suppressed-poster"
        />
      ) : (
        <div
          className="suppressed-row__poster suppressed-row__poster--empty"
          data-testid="suppressed-poster-placeholder"
        />
      )}
      <div className="suppressed-row__body">
        <span data-testid="suppressed-name">{name}</span>
        {year !== null && <span data-testid="suppressed-year">{year}</span>}
        {identityStability === 'text-derived' && (
          <p data-testid="suppressed-caveat">{UNMATCHED_SUPPRESSION_CAVEAT}</p>
        )}

        {rowState.phase === 'idle' && (
          <button
            type="button"
            className="tap-target"
            data-testid="stop-ignoring-button"
            onClick={() => setRowState({ phase: 'confirming' })}
          >
            Stop ignoring
          </button>
        )}

        {rowState.phase === 'confirming' && (
          <div data-testid="unsuppress-confirm">
            <p data-testid="unsuppress-confirm-body">{withName(UNSUPPRESS_CONFIRM_BODY, name)}</p>
            <button
              type="button"
              className="tap-target"
              data-testid="unsuppress-confirm-button"
              onClick={confirm}
            >
              Stop ignoring
            </button>
            <button
              type="button"
              className="tap-target"
              data-testid="unsuppress-cancel-button"
              onClick={() => setRowState({ phase: 'idle' })}
            >
              Cancel
            </button>
          </div>
        )}

        {rowState.phase === 'submitting' && (
          <button type="button" className="tap-target" disabled>
            Removing…
          </button>
        )}

        {rowState.phase === 'error' && (
          <>
            <p role="alert" data-testid="unsuppress-error">
              {`Couldn\u2019t remove \u201c${name}\u201d from Not interested. Nothing has changed.`}
            </p>
            <button
              type="button"
              className="tap-target"
              data-testid="stop-ignoring-button"
              onClick={() => setRowState({ phase: 'confirming' })}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function SuppressedPage({
  items = [],
  loading = false,
  loadFailed = false,
  onRetry,
  onUnsuppress = () => Promise.resolve(),
}: SuppressedPageProps): JSX.Element {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const visible = items.filter((item) => !dismissed.has(item.suppressionId));

  return (
    <>
      <h1>Not interested</h1>
      <p data-testid="suppressed-subtitle">{'These won\u2019t be added back by future uploads.'}</p>

      {loadFailed ? (
        <div role="alert" data-testid="suppressed-load-error">
          <p>{'Couldn\u2019t load your Not interested list. Nothing has changed.'}</p>
          {onRetry !== undefined && (
            <button type="button" className="tap-target" onClick={onRetry}>
              {RETRY_LABEL}
            </button>
          )}
        </div>
      ) : loading ? (
        <p role="status" data-testid="suppressed-loading">
          Loading your Not interested list…
        </p>
      ) : (
        <ul data-testid="suppressed-list">
          {visible.map((item) => (
            <SuppressionRow
              key={item.suppressionId}
              item={item}
              onUnsuppress={onUnsuppress}
              onDone={() => {
                setDismissed((prev) => new Set([...prev, item.suppressionId]));
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}
