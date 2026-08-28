/**
 * TASK-178 — the extraction-status container (`specs/ui.md` §4, §12.7).
 *
 * ⚠ **`BatchStatusPage` WAS MOUNTED BARE**, so `/batches/:batchId` rendered
 * the "no batch" state against a batch that existed and was running. The page
 * is prop-driven and correct; nothing fetched it.
 *
 * ⚠ **THE POLL IS THE ONLY TIMER IN THE SPA, AND IT STOPS THREE WAYS**
 * (REQ-103, `T-DATA-009`): at a status that is no longer running, on unmount,
 * and while `document.hidden`. The hidden stop is not politeness — without it
 * a forgotten tab hammers a single 0.25 vCPU replica indefinitely, which is a
 * background process by behaviour whatever the intent.
 *
 * ⚠ **THIS DOES NOT ENGAGE REQ-041 / `T-MUT-001f`.** That invariant forbids a
 * *non-owner* process changing *user-visible list state*. This is the owner's
 * own browser, looking at the screen, issuing a **read** (§12.7).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { RefusedError, apiClient, type ApiClient, type BatchStatus } from '../lib/apiClient';
import { BatchStatusPage } from '../pages/BatchStatusPage';
import { RefusalPage } from '../pages/RefusalPage';

/** §4 — "every 2 s while `submitted`/`extracting`". */
export const POLL_INTERVAL_MS = 2_000;

/**
 * Whether the batch is still doing work the owner is waiting for.
 *
 * ⚠ **THIS IS A POSITIVE WHITELIST OF THE TWO RUNNING STATUSES, AND IT IS NOT
 * `isBatchOpen`.** The domain's open/terminal split answers a different
 * question — "may the owner start another batch?" — and counts `in-review` and
 * `extraction-failed` as open, because both still need resolving. Polling on
 * that predicate would keep requesting every two seconds for as long as the
 * owner reads their review, forever, on a batch whose status can no longer
 * change by itself.
 */
export function isRunning(status: string): boolean {
  return status === 'submitted' || status === 'extracting';
}

export interface BatchStatusRouteProps {
  readonly client?: ApiClient;
  /** Injected so the hidden-tab rule is drivable without a real document. */
  readonly visibility?: () => boolean;
}

export function BatchStatusRoute({
  client = apiClient,
  visibility,
}: BatchStatusRouteProps = {}): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const batchId = params['batchId'] ?? '';

  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refused, setRefused] = useState(false);

  const isHidden = useCallback(
    (): boolean =>
      visibility === undefined ? typeof document !== 'undefined' && document.hidden : visibility(),
    [visibility],
  );

  // Read by the interval so the tick never closes over a stale status; state
  // alone would restart the timer on every response.
  const statusRef = useRef<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const next = await client.getBatch(batchId, signal);
        statusRef.current = next.status;
        setBatch(next);
        setLoadFailed(false);
      } catch (error) {
        if (signal?.aborted === true) return;
        if (error instanceof RefusedError) {
          setRefused(true);
          return;
        }
        setLoadFailed(true);
      }
    },
    [batchId, client],
  );

  /**
   * ⚠ A READ in an effect is correct and is NOT what REQ-102 forbids — that
   * rule is about mutations (§12.6). StrictMode double-invokes this, which for
   * a `GET` is a duplicate read the abort discards.
   */
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);

    const timer = setInterval(() => {
      // Checked on every tick, not once at set-up: the owner switches tabs
      // mid-extraction, which is the whole case this exists for.
      if (isHidden()) return;
      const status = statusRef.current;
      if (status !== null && !isRunning(status)) return;
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [isHidden, load]);

  /**
   * §4 / §5.4 — on `in-review` the owner is taken to the review pass.
   *
   * ⚠ A NAVIGATION, NOT A MUTATION. REQ-102 governs requests; this issues
   * none, and it is idempotent under StrictMode's double invoke because
   * navigating twice to the same path is one navigation.
   */
  useEffect(() => {
    if (batch?.status === 'in-review') void navigate(`/batches/${batchId}/review`);
  }, [batch?.status, batchId, navigate]);

  if (refused) return <RefusalPage reason="not-allowed" />;

  return (
    <BatchStatusPage
      batch={batch}
      loadFailed={loadFailed}
      onRetry={() => {
        void load();
      }}
      onDiscard={() => {
        // A MUTATION, and therefore in a handler (REQ-102).
        void client.discardBatch(batchId).then(() => navigate('/'));
      }}
      onContinue={() => {
        void navigate(`/batches/${batchId}/review`);
      }}
      onUploadNew={() => {
        void navigate('/upload');
      }}
    />
  );
}
