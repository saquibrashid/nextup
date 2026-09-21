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

import {
  ApiError,
  RefusedError,
  apiClient,
  type ApiClient,
  type BatchStatus,
} from '../lib/apiClient';
import { BatchStatusPage } from '../pages/BatchStatusPage';
import { RefusalPage } from '../pages/RefusalPage';
import { DraftBatch } from '../components/DraftBatch';
import { BatchAppliedNotice } from '../components/BatchAppliedNotice';
import { CaptureUnavailable } from '../components/CaptureUnavailable';
import { useCaptureLifetime } from '../lib/useCaptureLifetime';

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

export function BatchStatusRoute(props: BatchStatusRouteProps = {}): JSX.Element {
  const { batchId } = useParams();
  return <BatchStatusContent key={batchId} {...props} />;
}

function BatchStatusContent({
  client = apiClient,
  visibility,
}: BatchStatusRouteProps = {}): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const batchId = params['batchId'] ?? '';

  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const inFlight = useRef(false);
  const readVersion = useRef(0);
  const pendingRead = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const readFailed = useRef(false);
  const isActive = useCaptureLifetime();

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
    (replace = false): Promise<void> => {
      if (pendingRead.current !== null && !replace) return pendingRead.current.promise;
      pendingRead.current?.controller.abort();
      const controller = new AbortController();
      const signal = controller.signal;
      const version = ++readVersion.current;
      const promise = (async () => {
        try {
          const next = await client.getBatch(batchId, signal);
          if (signal.aborted || !isActive() || version !== readVersion.current) return;
          statusRef.current = next.status;
          setBatch(next);
          readFailed.current = false;
          setLoadFailed(false);
          setLoadErrorMessage(null);
        } catch (error) {
          if (signal.aborted || !isActive() || version !== readVersion.current) return;
          if (error instanceof RefusedError) {
            statusRef.current = 'refused';
            setRefused(true);
            return;
          }
          if (error instanceof ApiError && error.status === 404) {
            statusRef.current = 'unavailable';
            setUnavailable(true);
            return;
          }
          // §5.8 — offline is not a failure of the batch. The last known state
          // stays on screen under the banner.
          if (offlineRef.current) return;
          readFailed.current = true;
          setLoadFailed(true);
          setLoadErrorMessage(error instanceof ApiError ? error.message : null);
        } finally {
          if (pendingRead.current?.controller === controller) pendingRead.current = null;
        }
      })();
      pendingRead.current = { controller, promise };
      return promise;
    },
    [batchId, client, isActive],
  );

  /**
   * ⚠ A READ in an effect is correct and is NOT what REQ-102 forbids — that
   * rule is about mutations (§12.6). StrictMode double-invokes this, which for
   * a `GET` is a duplicate read the abort discards.
   */
  useEffect(() => {
    void load(true);

    const timer = setInterval(() => {
      // Checked on every tick, not once at set-up: the owner switches tabs
      // mid-extraction, which is the whole case this exists for.
      if (isHidden()) return;
      if (inFlight.current) return;
      if (readFailed.current) return;
      // §5.8 — the poll PAUSES rather than firing into a dead network. A tick
      // that fires offline costs a rejected request and, without the guard in
      // `load`, an invented error.
      if (offlineRef.current) return;
      const status = statusRef.current;
      if (status !== null && !isRunning(status)) return;
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      readVersion.current += 1;
      pendingRead.current?.controller.abort();
      pendingRead.current = null;
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
      if (status === null || isRunning(status)) void load(true);
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
    if (batch?.status === 'in-review' && !draftPending)
      void navigate(`/batches/${batchId}/review`, { state: skeletonState(batch) });
  }, [batch, batchId, navigate, draftPending]);

  function mutate(action: () => Promise<unknown>, destination?: string): void {
    if (inFlight.current || offline || loadFailed) return;
    inFlight.current = true;
    readVersion.current += 1;
    setBusy(true);
    setActionError(null);
    void (async () => {
      let navigated = false;
      try {
        await action();
        if (!isActive()) return;
        if (destination !== undefined) {
          navigated = true;
          void navigate(destination);
        }
      } catch (error) {
        if (!isActive()) return;
        if (error instanceof RefusedError) setRefused(true);
        else
          setActionError(
            `${error instanceof Error ? error.message : 'The request failed.'} ` +
              'Check the saved status before trying again. Nothing was automatically retried.',
          );
      } finally {
        if (isActive() && !navigated) await load(true);
        inFlight.current = false;
        if (isActive()) setBusy(false);
      }
    })();
  }

  if (refused) return <RefusalPage reason="not-allowed" />;
  if (unavailable) return <CaptureUnavailable />;
  if (batch !== null && (batch.status === 'draft' || draftPending)) {
    return (
      <DraftBatch
        batch={batch}
        key={batchId}
        onPendingChange={setDraftPending}
        client={client}
        offline={offline}
        onRefresh={load}
        onRefused={() => setRefused(true)}
        onDiscarded={() => {
          void navigate('/upload');
        }}
      />
    );
  }

  return (
    <BatchStatusPage
      outcome={
        batch?.status === 'applied' && batch.application != null ? (
          <>
            {batch.application.summary.listingsCreated + batch.application.summary.listingsRemoved >
              0 || batch.changedNothing ? (
              <BatchAppliedNotice
                key={batch.batchId}
                applied={{ batchId: batch.batchId, service: batch.service, ...batch.application }}
                undoBatch={(id) => client.undoBatch(id)}
                undoRemovalGroup={(id) => client.undoRemovalGroup(id)}
                offline={offline}
              />
            ) : (
              <p role="status">This capture applied the changes recorded below.</p>
            )}
            {batch.application.removalsUndone && (
              <p role="status">The removals from this capture have already been undone.</p>
            )}
          </>
        ) : null
      }
      batch={batch}
      loadFailed={loadFailed}
      loadErrorMessage={loadErrorMessage}
      offline={offline}
      busy={busy}
      actionError={actionError}
      onRetry={() => {
        if (batch?.status === 'extraction-failed' && !loadFailed)
          mutate(() => client.retryExtraction(batchId));
        else void load(true);
      }}
      onDiscard={() => {
        // A MUTATION, and therefore in a handler (REQ-102).
        mutate(() => client.discardBatch(batchId), '/');
      }}
      onContinue={() => {
        void navigate(`/batches/${batchId}/review`, { state: skeletonState(batch) });
      }}
      onUploadNew={() => {
        mutate(() => client.discardBatch(batchId), '/upload');
      }}
    />
  );
}
