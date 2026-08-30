/**
 * TASK-076 / TASK-116 / the §9.6–§9.10 undo outcomes — the batch-history
 * container (`specs/ux-states.md` §9). Containers fetch, pages render; this is
 * also the caller that ATTEMPTS the undo and routes each of its outcomes.
 *
 * ⚠ **AN UNDO HAS FIVE OUTCOMES AND EVERY ONE IS OWNER-VISIBLE.** Before this
 * container grew the state machine below, only the §8.4 enumeration was handled
 * and every other outcome — success, "already undone", a network fault — was
 * silently swallowed: the owner tapped *Undo this batch* and watched nothing
 * happen. That is the dead-button failure §4.15 calls out ("MUST NEVER sit on a
 * spinner"). The outcomes are, and must stay, distinct:
 *   • §9.6 submitting — the card says *Undoing…*, guarded against a second tap;
 *   • §9.7 success — *"Undone. N titles and M service entries were removed."*
 *     with the counts from the response and a link to `/` (NOT an auto-nav);
 *   • §9.8/§9.9 refusal — the full-screen `<UndoRefusalPanel>`;
 *   • §9.10 already-undone — a settled fact, offering a refresh, never a retry;
 *   • unclassified fault — surfaced and retryable, never merged with §9.10.
 *
 * ⚠ The mutation is in a HANDLER, never an effect: a second undo of the same
 * batch under StrictMode's double invoke would be a spurious 409.
 */

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';

import type { UndoRefusalDetails } from '@nextup/domain';

import { apiClient, type ApiClient } from '../lib/apiClient';
import { isUndoRefusal, parseUndoRefusalDetails } from '../lib/undoRefusal';
import {
  formatUndoneSummary,
  isBatchAlreadyUndone,
  parseUndoResult,
  type UndoSuccess,
} from '../lib/undoResult';
import { useOnline } from '../lib/useOnline';
import { useResource } from '../lib/useResource';
import { BatchHistoryPage } from '../pages/BatchHistoryPage';
import { RefusalPage } from '../pages/RefusalPage';
import { UndoRefusalPanel } from '../components/UndoRefusalPanel';
import {
  BATCHES_ALREADY_UNDONE,
  BATCHES_ALREADY_UNDONE_REFRESH_LABEL,
  BATCHES_UNDO_FAILED,
  BATCHES_UNDO_FAILED_RETRY_LABEL,
  BATCHES_UNDONE_HOME_LABEL,
  OFFLINE_DISABLED_REASON,
} from '../copy';

export interface BatchHistoryRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
}

/** The undo state machine — exactly one outcome is live at a time. */
type UndoState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting'; readonly batchId: string }
  | { readonly kind: 'success'; readonly counts: UndoSuccess }
  | { readonly kind: 'refused'; readonly details: UndoRefusalDetails }
  | { readonly kind: 'already-undone' }
  | { readonly kind: 'failed'; readonly batchId: string };

export function BatchHistoryRoute({
  client = apiClient,
}: BatchHistoryRouteProps = {}): JSX.Element {
  const batches = useResource((signal) => client.listBatches(signal), 'batches');
  const [undo, setUndo] = useState<UndoState>({ kind: 'idle' });
  // §9.11 — offline. Reading the history stays available; the undo POST does
  // not. The global banner is AppShell's; here we only disable the mutations.
  const offline = !useOnline();

  if (batches.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  // §9.8/§9.9 — a full-screen replacement, not an overlay. The panel is shown
  // INSTEAD of the history, and its own actions are the way out.
  if (undo.kind === 'refused') {
    return (
      <UndoRefusalPanel
        details={undo.details}
        onClose={() => setUndo({ kind: 'idle' })}
        suppress={(titleId) => client.suppressTitle(titleId)}
        unsuppress={(suppressionId) => client.unsuppress(suppressionId)}
        searchTmdb={(query) => client.searchTmdb(query)}
        fixMatch={(titleId, body) => client.fixMatch(titleId, body)}
        restore={(listingId, opts) => client.restoreListing(listingId, opts)}
      />
    );
  }

  // §9.7 — the owner is TOLD what happened and chooses to continue. This
  // replaces the old unconditional navigate('/'): the link is theirs to follow.
  if (undo.kind === 'success') {
    return (
      <section role="status" data-testid="undo-success">
        <h1>{formatUndoneSummary(undo.counts)}</h1>
        <Link to="/" className="tap-target" data-testid="undo-success-home">
          {BATCHES_UNDONE_HOME_LABEL}
        </Link>
      </section>
    );
  }

  // The mutation is in a handler, never an effect (see the module note).
  const onUndo = (batchId: string): void => {
    if (undo.kind === 'submitting') return; // guard: one undo in flight at a time
    setUndo({ kind: 'submitting', batchId });
    client.undoBatch(batchId).then(
      (result) => setUndo({ kind: 'success', counts: parseUndoResult(result) }),
      (error: unknown) => {
        // Each outcome is kept distinct — an enumerated refusal, a settled
        // "already undone", and a retryable fault mean three different things.
        if (isUndoRefusal(error)) {
          setUndo({ kind: 'refused', details: parseUndoRefusalDetails(error.details) });
        } else if (isBatchAlreadyUndone(error)) {
          setUndo({ kind: 'already-undone' });
        } else {
          setUndo({ kind: 'failed', batchId });
        }
      },
    );
  };

  return (
    <>
      {undo.kind === 'already-undone' && (
        <div role="alert" data-testid="undo-already-undone">
          <p>{BATCHES_ALREADY_UNDONE}</p>
          <button
            type="button"
            className="tap-target"
            data-testid="undo-already-undone-refresh"
            onClick={() => {
              setUndo({ kind: 'idle' });
              batches.reload();
            }}
          >
            {BATCHES_ALREADY_UNDONE_REFRESH_LABEL}
          </button>
        </div>
      )}
      {undo.kind === 'failed' && (
        <div role="alert" data-testid="undo-failed">
          <p>{BATCHES_UNDO_FAILED}</p>
          <button
            type="button"
            className="tap-target"
            data-testid="undo-failed-retry"
            disabled={offline}
            onClick={() => onUndo(undo.batchId)}
          >
            {BATCHES_UNDO_FAILED_RETRY_LABEL}
          </button>
          {offline && (
            <span className="offline-reason" data-testid="undo-failed-offline-reason">
              {OFFLINE_DISABLED_REASON}
            </span>
          )}
        </div>
      )}
      <BatchHistoryPage
        items={batches.resource.kind === 'ok' ? batches.resource.value.batches : []}
        loading={batches.resource.kind === 'loading'}
        loadFailed={batches.resource.kind === 'failed'}
        onRetry={batches.reload}
        onUndo={onUndo}
        undoingBatchId={undo.kind === 'submitting' ? undo.batchId : null}
        offline={offline}
      />
    </>
  );
}
