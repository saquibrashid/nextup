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

/**
 * The history state that sizes the review's loading skeleton (§6.1,
 * `T-UX-060`).
 *
 * ⚠ **`null` UNLESS EVERY IMAGE HAS REPORTED.** `candidateCount` is `null` on
 * an image whose extraction has not landed, and summing it as zero would draw
 * a confidently-too-small skeleton — a placeholder that under-reports what was
 * read from the owner's screenshots. An absent count is the honest answer, and
 * `parseSkeletonCount` renders the countless skeleton for it.
 */
export function skeletonState(batch: BatchStatus | null): { skeletonCount: number } | undefined {
  if (batch === null) return undefined;
  let total = 0;
  for (const image of batch.images) {
    if (image.candidateCount === null) return undefined;
    total += image.candidateCount;
  }
  return { skeletonCount: total };
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

  const isOnline = useCallback(
    (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false,
    [],
  );

  const [offline, setOffline] = useState(() => !isOnline());

  const isHidden = useCallback(
    (): boolean =>
      visibility === undefined ? typeof document !== 'undefined' && document.hidden : visibility(),
    [visibility],
  );

  // Read by the interval so the tick never closes over a stale status; state
  // alone would restart the timer on every response.
  const statusRef = useRef<string | null>(null);

  /*
   * ⚠ READ BY THE FAILURE PATH, not just the tick. §5.8 says "no error is
   * invented", and the request that was already in flight when the connection
   * dropped rejects a moment LATER — after the offline state is known, but
   * from a `load()` the pause could not prevent. Without this the owner sees
   * the extraction-failed screen for a batch that is extracting perfectly
   * well, which is precisely the invented error.
   */
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

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
        // §5.8 — offline is not a failure of the batch. The last known state
        // stays on screen under the banner.
        if (offlineRef.current) return;
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
      // §5.8 — the poll PAUSES rather than firing into a dead network. A tick
      // that fires offline costs a rejected request and, without the guard in
      // `load`, an invented error.
      if (offlineRef.current) return;
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
   * §5.8 — the banner, the pause, and the resume.
   *
   * ⚠ THE RESUME IS AN IMMEDIATE READ, not merely an un-pause. Waiting for the
   * next tick would leave the owner looking at a stale status for up to the
   * full interval after their connection visibly came back — which reads as
   * the page having given up, the impression §5.8 exists to prevent.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const goOffline = (): void => setOffline(true);
    const goOnline = (): void => {
      setOffline(false);
      const status = statusRef.current;
      if (status === null || isRunning(status)) void load();
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [load]);

  /**
   * §4 / §5.4 — on `in-review` the owner is taken to the review pass.
   *
   * ⚠ A NAVIGATION, NOT A MUTATION. REQ-102 governs requests; this issues
   * none, and it is idempotent under StrictMode's double invoke because
   * navigating twice to the same path is one navigation.
   *
   * ⚠ **THE COUNT RIDES ALONG** (§6.1, `T-UX-060`). This screen already holds
   * the batch, so the review's loading skeleton can be drawn at the right size
   * without a second request. Carrying it here rather than fetching it there
   * is the whole design: a request issued to size a loading state would outlast
   * the load it is covering for.
   */
  useEffect(() => {
    if (batch?.status === 'in-review')
      void navigate(`/batches/${batchId}/review`, { state: skeletonState(batch) });
  }, [batch, batchId, navigate]);

  if (refused) return <RefusalPage reason="not-allowed" />;

  return (
    <BatchStatusPage
      batch={batch}
      loadFailed={loadFailed}
      offline={offline}
      onRetry={() => {
        void load();
      }}
      onDiscard={() => {
        // A MUTATION, and therefore in a handler (REQ-102).
        void client.discardBatch(batchId).then(() => navigate('/'));
      }}
      onContinue={() => {
        void navigate(`/batches/${batchId}/review`, { state: skeletonState(batch) });
      }}
      onUploadNew={() => {
        void navigate('/upload');
      }}
    />
  );
}
