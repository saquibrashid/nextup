/**
 * TASK-076 — the batch-history container (`specs/ux-states.md` §9.1–§9.3), now
 * also the caller that produces and routes a §9.8 undo refusal (TASK-116).
 *
 * ⚠ `/batches` WAS MOUNTED ON A STUB THAT RENDERED THE WORDS "Batch history"
 * AND NOTHING ELSE. Containers fetch, pages render — the same split every
 * other screen here uses, and the same one whose absence made
 * `/not-interested` render an empty list against a working API (see
 * `SuppressedRoute`).
 *
 * ⚠ **THE UNDO IS ATTEMPTED HERE, AND ITS REFUSAL IS THE WHOLE POINT.** The
 * owner asks to undo a batch; a creates-only batch is reversed and the owner
 * returns to their list, but anything else answers 409 `BATCH_NOT_CREATES_
 * ONLY` with the §8.4 enumeration. That refusal is rendered as the full-screen
 * `<UndoRefusalPanel>` — replacing the history, never floating over it as a
 * toast (§9.8) — so every title the undo would have touched carries a working
 * remedy. A lifecycle 409 (`BATCH_ALREADY_UNDONE`) is not a refusal to
 * enumerate and is deliberately not routed here.
 */

import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';

import type { UndoRefusalDetails } from '@nextup/domain';

import { apiClient, type ApiClient } from '../lib/apiClient';
import { isUndoRefusal, parseUndoRefusalDetails } from '../lib/undoRefusal';
import { useResource } from '../lib/useResource';
import { BatchHistoryPage } from '../pages/BatchHistoryPage';
import { RefusalPage } from '../pages/RefusalPage';
import { UndoRefusalPanel } from '../components/UndoRefusalPanel';

export interface BatchHistoryRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
}

export function BatchHistoryRoute({
  client = apiClient,
}: BatchHistoryRouteProps = {}): JSX.Element {
  const navigate = useNavigate();
  const batches = useResource((signal) => client.listBatches(signal), 'batches');
  const [refusal, setRefusal] = useState<UndoRefusalDetails | null>(null);

  if (batches.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  // ⚠ A full-screen replacement, not an overlay. §9.8 is a panel, not a toast:
  // it is shown INSTEAD of the history, and its own actions are the way out.
  if (refusal !== null) {
    return (
      <UndoRefusalPanel
        details={refusal}
        onClose={() => setRefusal(null)}
        suppress={(titleId) => client.suppressTitle(titleId)}
        unsuppress={(suppressionId) => client.unsuppress(suppressionId)}
        searchTmdb={(query) => client.searchTmdb(query)}
        fixMatch={(titleId, body) => client.fixMatch(titleId, body)}
        restore={(listingId, opts) => client.restoreListing(listingId, opts)}
      />
    );
  }

  // The mutation is in a handler, never an effect: a second undo of the same
  // batch under StrictMode's double invoke would be a spurious 409.
  const onUndo = (batchId: string): void => {
    client.undoBatch(batchId).then(
      () => {
        // The batch has been reversed; return the owner to their list.
        void navigate('/');
      },
      (error: unknown) => {
        // Only the enumerated refusal opens the panel. A lifecycle 409, an
        // expired session (already redirected) or a network failure is not a
        // §8.4 body and must not be forced into one.
        if (isUndoRefusal(error)) setRefusal(parseUndoRefusalDetails(error.details));
      },
    );
  };

  return (
    <BatchHistoryPage
      items={batches.resource.kind === 'ok' ? batches.resource.value.batches : []}
      loading={batches.resource.kind === 'loading'}
      loadFailed={batches.resource.kind === 'failed'}
      onRetry={batches.reload}
      onUndo={onUndo}
    />
  );
}
