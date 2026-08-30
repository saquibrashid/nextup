/**
 * TASK-178 — the upload container (`specs/ui.md` §3, §12.6, ADR-0012).
 *
 * ⚠ **`/upload` COULD NOT UPLOAD.** `UploadPage` owned step 1, `ImageDropzone`
 * owned step 2, and step 3 — the submit — existed only in the spec. The three
 * pieces had twenty-odd green component tests between them and were never
 * composed, so the screen collected the owner's screenshots into React state
 * and posted nothing anywhere. This file is the missing layer, and the pages
 * below it are untouched: containers mutate, pages render.
 *
 * ⚠ **EVERY MUTATION HERE IS IN AN EVENT HANDLER, NEVER AN EFFECT** (REQ-102,
 * §12.6). React 19 double-invokes effects under `<StrictMode>`, which
 * `main.tsx` uses, so a `POST` on mount creates **two batches and two
 * extraction runs** — and the doubling vanishes in a production build, so it
 * would surface first in the owner's real data. `T-DATA-008` mounts under
 * `StrictMode` for exactly that reason.
 *
 * ⚠ **THE BATCH IS CREATED ON THE FIRST IMAGE, NOT ON THE SELECTION.** Both
 * are event handlers, so either satisfies REQ-102 — but creating on the
 * selection means every idle change of the radio buttons leaves an abandoned
 * server-side batch, and the *next* real upload is then refused with 409
 * `OPEN_BATCH_EXISTS` by the owner's own earlier indecision. Creation is
 * deferred to the first moment there is something to put in it.
 *
 * ⚠ **CREATION IS GUARDED BY A PROMISE, NOT A BOOLEAN.** Two files dropped in
 * the same tick both see `batchId === null` — a boolean flag is set too late,
 * and the second call creates a second batch. The in-flight promise is the
 * only value that exists before the first response comes back.
 */

import { useCallback, useRef, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BatchMode, Service } from '@nextup/domain';

import { ImageDropzone, type ServerRejection } from '../components/ImageDropzone';
import { ApiError, RefusedError, apiClient, type ApiClient } from '../lib/apiClient';
import { RefusalPage } from '../pages/RefusalPage';
import { UploadPage, type BatchDraftSelection } from '../pages/UploadPage';
import {
  BATCH_LOCKED_NOTE,
  OPEN_BATCH_DISCARD_LABEL,
  OPEN_BATCH_GO_LABEL,
  SUBMIT_IN_FLIGHT,
  SUBMIT_LABEL,
  SUBMIT_NEEDS_IMAGES,
  SUBMIT_NEEDS_SELECTION,
} from '../copy';
import { OFFLINE_DISABLED_REASON } from '../copy';
import { useOnline } from '../lib/useOnline';

export interface UploadRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
  /** Injected so §4.11 is drivable without a real network. Reads TRUE when online. */
  readonly connectivity?: () => boolean;
}

/** The 409 the owner can act on, kept apart from ordinary failures (§4.10). */
interface OpenBatchConflict {
  readonly batchId: string;
  readonly message: string;
}

/**
 * The reason the submit is unavailable, or `null` when it is available.
 *
 * ⚠ Exported and pure so `T-UX-045` can assert the *rule* rather than the
 * rendering of one arrangement of it. §3.3 forbids a silently disabled
 * button, and a reason computed inline in JSX is a reason that can be
 * forgotten in one branch.
 */
export function submitBlockedReason(
  selection: BatchDraftSelection,
  imageCount: number,
  offline = false,
): string | null {
  /*
   * ⚠ OFFLINE IS CHECKED FIRST AND IS NOT MERELY ANOTHER REASON IN THE LIST.
   * §4.11 disables submit while offline because the submit is a `POST`. The
   * order matters: with a service chosen and images attached, the other two
   * reasons are `null` and the button would otherwise be enabled, sending the
   * owner's screenshots into a connection that cannot carry them.
   */
  if (offline) return OFFLINE_DISABLED_REASON;
  if (selection.service === null || selection.mode === null) return SUBMIT_NEEDS_SELECTION;
  if (imageCount === 0) return SUBMIT_NEEDS_IMAGES;
  return null;
}

/**
 * Pulls `rejected[]` out of a failed attach.
 *
 * ⚠ The all-rejected case is an ERROR STATUS, not a 201 (`api.md` §6.12), so
 * the rejections ride in the envelope's `details`. Reading only the success
 * body would leave the owner with an empty rejection list on the one request
 * where every single file failed.
 */
export function rejectionsFromError(error: unknown): readonly ServerRejection[] {
  if (!(error instanceof ApiError)) return [];
  const rejected = error.details['rejected'];
  return Array.isArray(rejected) ? (rejected as ServerRejection[]) : [];
}

export function UploadRoute({
  client = apiClient,
  connectivity,
}: UploadRouteProps = {}): JSX.Element {
  const navigate = useNavigate();
  const online = useOnline({ connectivity });

  const [selection, setSelection] = useState<BatchDraftSelection>({ service: null, mode: null });
  const [batchId, setBatchId] = useState<string | null>(null);
  const [imageCount, setImageCount] = useState(0);
  const [serverRejected, setServerRejected] = useState<readonly ServerRejection[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState<OpenBatchConflict | null>(null);
  const [refused, setRefused] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // See the header: a boolean would be set after the first `await`.
  const creating = useRef<Promise<string> | null>(null);
  const batchIdRef = useRef<string | null>(null);

  const report = useCallback((error: unknown): void => {
    if (error instanceof RefusedError) {
      setRefused(true);
      return;
    }
    if (error instanceof ApiError && error.code === 'OPEN_BATCH_EXISTS') {
      const existing = error.details['batchId'];
      if (typeof existing === 'string') {
        setConflict({ batchId: existing, message: error.message });
        return;
      }
    }
    // ⚠ The server's own sentence, verbatim (REQ-104, §12.8). No table keyed
    // on `code` here: it would state yesterday's decode limit in the very
    // message whose job is to state the limit after an up-size.
    setFailure(error instanceof Error ? error.message : 'Something went wrong.');
  }, []);

  const ensureBatch = useCallback(
    async (service: Service, mode: BatchMode): Promise<string> => {
      const known = batchIdRef.current;
      if (known !== null) return known;
      const inFlight = creating.current;
      if (inFlight !== null) return inFlight;

      const pending = client.createBatch(service, mode).then((created) => {
        batchIdRef.current = created.batchId;
        setBatchId(created.batchId);
        return created.batchId;
      });
      creating.current = pending;
      try {
        return await pending;
      } finally {
        // Cleared either way: a failed creation must be retryable by attaching
        // again, not permanently poisoned by one rejected promise.
        creating.current = null;
      }
    },
    [client],
  );

  const attach = useCallback(
    (files: readonly File[]): void => {
      const { service, mode } = selection;
      if (service === null || mode === null) return;

      setBusy(true);
      setFailure(null);
      void (async () => {
        try {
          const id = await ensureBatch(service, mode);
          const form = new FormData();
          for (const file of files) form.append('files', file);
          const result = await client.addBatchImages(id, form);
          setServerRejected(result.rejected);
          setImageCount(result.batchTotals.imageCount);
        } catch (error) {
          setServerRejected(rejectionsFromError(error));
          report(error);
        } finally {
          setBusy(false);
        }
      })();
    },
    [client, ensureBatch, report, selection],
  );

  const submit = useCallback((): void => {
    const id = batchIdRef.current;
    if (id === null) return;
    setBusy(true);
    setFailure(null);
    void (async () => {
      try {
        await client.submitBatch(id);
        setSubmitted(true);
        // §4.9 — success IS the navigation. There is no interstitial: the
        // status screen is where the owner watches the work happen.
        void navigate(`/batches/${id}`);
      } catch (error) {
        report(error);
      } finally {
        setBusy(false);
      }
    })();
  }, [client, navigate, report]);

  const discardConflicting = useCallback((): void => {
    if (conflict === null) return;
    const doomed = conflict.batchId;
    setBusy(true);
    void (async () => {
      try {
        await client.discardBatch(doomed);
        setConflict(null);
      } catch (error) {
        report(error);
      } finally {
        setBusy(false);
      }
    })();
  }, [client, conflict, report]);

  if (refused) return <RefusalPage reason="not-allowed" />;

  const blocked = submitBlockedReason(selection, imageCount, !online);
  const ready = selection.service !== null && selection.mode !== null;

  return (
    <>
      <UploadPage onSelectionChange={setSelection} />

      {/*
        ⚠ Rendered AFTER step 1 and never in place of it. §4.10 offers the
        owner two ways out of the conflict; replacing the whole screen with the
        message would take away the third — changing their mind and leaving.
      */}
      {conflict !== null && (
        <section className="upload-conflict" data-testid="open-batch-conflict">
          <p data-testid="open-batch-message">{conflict.message}</p>
          <button
            className="tap-target"
            data-testid="open-batch-go"
            onClick={() => {
              void navigate(`/batches/${conflict.batchId}`);
            }}
            type="button"
          >
            {OPEN_BATCH_GO_LABEL}
          </button>
          <button
            className="tap-target"
            data-testid="open-batch-discard"
            onClick={discardConflicting}
            type="button"
          >
            {OPEN_BATCH_DISCARD_LABEL}
          </button>
        </section>
      )}

      <ImageDropzone
        batchReady={ready}
        offline={!online}
        onFilesAccepted={attach}
        serverRejected={serverRejected}
      />

      <section className="upload-submit" data-testid="submit-step">
        {/*
          ⚠ THE REASON IS TEXT, ALWAYS, AND SITS BESIDE THE CONTROL (§3.3). A
          disabled button with no reason is indistinguishable from a broken
          one, and this is the last step before the owner's screenshots leave
          the device.
        */}
        {blocked !== null && (
          <p className="upload-submit__reason" data-testid="submit-reason">
            {blocked}
          </p>
        )}
        <button
          className="tap-target upload-submit__button"
          data-testid="submit-button"
          disabled={blocked !== null || busy}
          onClick={submit}
          type="button"
        >
          {SUBMIT_LABEL}
        </button>
        {busy && (
          <p aria-live="polite" data-testid="submit-busy">
            {SUBMIT_IN_FLIGHT}
          </p>
        )}
        {submitted && <p data-testid="batch-locked">{BATCH_LOCKED_NOTE}</p>}
        {failure !== null && (
          <p className="upload-submit__failure" data-testid="submit-failure" role="alert">
            {failure}
          </p>
        )}
      </section>

      {/* Present only so a test can prove the batch was created once. */}
      <span data-testid="draft-batch-id" hidden>
        {batchId ?? ''}
      </span>
    </>
  );
}
