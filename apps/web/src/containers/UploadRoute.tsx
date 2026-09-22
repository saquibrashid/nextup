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
 * Screenshots remain local until the explicit Extract action. The selection
 * and queue can therefore change without diverging from an already-created
 * server batch. A synchronous ref guards the entire upload/submit operation.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SERVICES, SERVICE_LABELS, ulid, type CaptureSelectionRefusal } from '@nextup/domain';

import { ImageDropzone, type QueuedImage, type ServerRejection } from '../components/ImageDropzone';
import { UploadCheckpoint } from '../components/UploadCheckpoint';
import { DraftBatch } from '../components/DraftBatch';
import { useCaptureNavigation } from '../components/CaptureNavigation';
import { uploadSelection, type ImageUploadState } from '../lib/uploadSelection';
import { resumeAction, useUploadCheckpoint } from '../lib/useUploadCheckpoint';
import {
  ApiError,
  RefusedError,
  apiClient,
  type ApiClient,
  type BatchStatus,
} from '../lib/apiClient';
import { RefusalPage } from '../pages/RefusalPage';
import { UploadPage, type BatchDraftSelection } from '../pages/UploadPage';
import {
  BATCH_LOCKED_NOTE,
  IMAGES_STEP_LEGEND,
  IMAGES_STEP_WAITING_HINT,
  SUBMIT_IN_FLIGHT,
  SUBMIT_LABEL,
  SUBMIT_NEEDS_IMAGES,
  SUBMIT_NEEDS_SELECTION,
  UPLOAD_LOCAL_NOTE,
  UPLOAD_SUMMARY_TITLE,
  UPLOAD_NEXT_NOTE,
  UPLOAD_RECOVERY_NOTE,
} from '../copy';
import { OFFLINE_DISABLED_REASON } from '../copy';
import { useOnline } from '../lib/useOnline';
import { useCaptureLifetime } from '../lib/useCaptureLifetime';
import { Button } from '../components/ui/Button';
import { Fieldset } from '../components/ui/Fieldset';
import { UploadStep } from '../components/UploadStep';
import { CaptureProgress } from '../components/CaptureProgress';
export { rejectionsFromError } from '../components/RejectionList';

export interface UploadRouteProps {
  /** Injected so the suite can drive every state without a server. */
  readonly client?: ApiClient;
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
export function UploadRoute({ client = apiClient }: UploadRouteProps = {}): JSX.Element {
  const navigate = useNavigate();
  const isActive = useCaptureLifetime();
  const online = useOnline();
  const [params] = useSearchParams();
  const requestedService = params.get('service');
  const initialService = SERVICES.find((service) => service === requestedService) ?? null;

  const [selection, setSelection] = useState<BatchDraftSelection>({
    service: initialService,
    mode: null,
  });
  const [batchId, setBatchId] = useState<string | null>(null);
  const [queue, setQueue] = useState<readonly QueuedImage[]>([]);
  const [localRefusals, setLocalRefusals] = useState<readonly CaptureSelectionRefusal[]>([]);
  const recordRefusals = useCallback((files: readonly { name: string; reason: string }[]) => {
    setLocalRefusals((current) => [
      ...current,
      ...files.map((file) => ({
        token: ulid(),
        name: file.name.slice(0, 255),
        message: file.reason.slice(0, 2000),
      })),
    ]);
  }, []);
  const [uploadStates, setUploadStates] = useState<ReadonlyMap<File, ImageUploadState>>(new Map());
  const [savedBatch, setSavedBatch] = useState<BatchStatus | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const [serverRejected, setServerRejected] = useState<readonly ServerRejection[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const allowNavigation = useCaptureNavigation(
    savedBatch === null && (queue.length > 0 || localRefusals.length > 0),
    savedBatch === null && busy,
  );
  useEffect(() => {
    if (savedBatch !== null && savedBatch.status !== 'draft' && !draftPending && !busy) {
      allowNavigation();
      void navigate(`/batches/${savedBatch.batchId}`);
    }
  }, [allowNavigation, busy, draftPending, navigate, savedBatch]);

  const inFlight = useRef(false);
  const checkpoint = useUploadCheckpoint(client, online, batchId === null);
  const { check } = checkpoint;
  const entryReady = checkpoint.state.kind === 'ready';

  const report = useCallback(
    (error: unknown): void => {
      if (error instanceof RefusedError) {
        setRefused(true);
        return;
      }
      if (error instanceof ApiError && error.code === 'OPEN_BATCH_EXISTS') {
        const existing = error.details['batchId'];
        if (typeof existing === 'string') {
          setConflictMessage(error.message);
          void check(existing);
          return;
        }
      }
      // ⚠ The server's own sentence, verbatim (REQ-104, §12.8). No table keyed
      // on `code` here: it would state yesterday's decode limit in the very
      // message whose job is to state the limit after an up-size.
      setFailure(error instanceof Error ? error.message : 'Something went wrong.');
    },
    [check],
  );

  const submit = useCallback((): void => {
    const { service, mode } = selection;
    if (
      inFlight.current ||
      !entryReady ||
      batchId !== null ||
      !online ||
      service === null ||
      mode === null ||
      queue.length === 0
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    void (async () => {
      let id: string | null = null;
      try {
        const created = await client.createBatch(service, mode, localRefusals);
        if (!isActive()) return;
        id = created.batchId;
        setBatchId(id);
        const result = await uploadSelection(
          client,
          id,
          queue,
          (file, state) => {
            setUploadStates((current) => new Map(current).set(file, state));
          },
          isActive,
        );
        if (!isActive()) return;
        setQueue(result.remaining);
        if (result.remaining.length > 0) {
          setServerRejected(result.rejected);
          setFailure(`${UPLOAD_RECOVERY_NOTE} ${result.problems.join(' ')}`);
          return;
        }
        if (localRefusals.length > 0) {
          const saved = await client.getBatch(id);
          if (isActive()) setSavedBatch(saved);
          return;
        }
        await client.submitBatch(id);
        if (!isActive()) return;
        setSubmitted(true);
        allowNavigation();
        // §4.9 — success IS the navigation. There is no interstitial: the
        // status screen is where the owner watches the work happen.
        void navigate(`/batches/${id}`);
      } catch (error) {
        if (!isActive()) return;
        if (id !== null && !(error instanceof RefusedError)) {
          // Never replay an upload or submit whose response may have been
          // lost. The saved draft is re-read before another explicit action.
          setFailure(
            `${UPLOAD_RECOVERY_NOTE} ${error instanceof Error ? error.message : 'Upload failed.'}`,
          );
        } else {
          report(error);
          if (!(error instanceof RefusedError) && !(error instanceof ApiError)) await check();
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  }, [
    allowNavigation,
    batchId,
    check,
    client,
    entryReady,
    isActive,
    navigate,
    online,
    queue,
    report,
    selection,
    localRefusals,
  ]);

  const resolveExisting = async (discard: boolean): Promise<void> => {
    if (checkpoint.state.kind !== 'open' || inFlight.current || !online) return;
    const id = checkpoint.state.batch.batchId;
    inFlight.current = true;
    setBusy(true);
    setCheckpointError(null);
    try {
      const latest = await client.getBatch(id);
      if (!isActive()) return;
      const action = resumeAction(latest.status);
      if (action === null) {
        await check();
        setConflictMessage('That upload is already finished. The saved status has been refreshed.');
        return;
      }
      if (!discard) {
        allowNavigation();
        void navigate(latest.status === 'in-review' ? `/batches/${id}/review` : `/batches/${id}`);
        return;
      }
      if (!action.discardable) {
        await check(id);
        setCheckpointError(
          'Reading has started. This upload cannot be discarded while it is running.',
        );
        return;
      }
      await client.discardBatch(id);
      await check();
      setConflictMessage(
        'The saved batch was discarded. Your library is unchanged. No new upload was started.',
      );
    } catch (error) {
      if (error instanceof RefusedError) setRefused(true);
      else {
        setCheckpointError(
          `${error instanceof Error ? error.message : 'The request failed.'} The saved status is being checked. Nothing was automatically retried.`,
        );
        await check();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (refused || checkpoint.state.kind === 'refused') return <RefusalPage reason="not-allowed" />;
  if (savedBatch !== null) {
    return (
      <DraftBatch
        key={savedBatch.batchId}
        batch={savedBatch}
        initialQueue={queue}
        initialStates={uploadStates}
        initialRejected={serverRejected}
        initialFailure={failure?.replace(UPLOAD_RECOVERY_NOTE, '').trim() || null}
        onPendingChange={setDraftPending}
        client={client}
        offline={!online}
        onRefused={() => setRefused(true)}
        onDiscarded={() => {
          allowNavigation();
          setSavedBatch(null);
          setBatchId(null);
          setQueue([]);
          setLocalRefusals([]);
          setUploadStates(new Map());
          setServerRejected([]);
          setFailure(null);
          setDraftPending(false);
          setConflictMessage('The saved batch was discarded. No new upload was started.');
          void check();
        }}
        onRefresh={async () => {
          const next = await client.getBatch(savedBatch.batchId);
          setSavedBatch(next);
        }}
      />
    );
  }

  const blocked = submitBlockedReason(selection, queue.length, !online);
  const ready = selection.service !== null && selection.mode !== null;
  const showCheckpoint = batchId === null && !entryReady;

  return (
    <div className="upload-flow">
      {showCheckpoint && (
        <UploadCheckpoint
          key={checkpoint.state.kind === 'checking' ? checkpoint.state.attempt : 'resolved'}
          state={checkpoint.state}
          online={online}
          busy={busy}
          heldCount={queue.length + localRefusals.length}
          message={conflictMessage}
          error={checkpointError}
          onRetry={() => {
            setCheckpointError(null);
            void check();
          }}
          onResume={() => resolveExisting(false)}
          onDiscard={() => resolveExisting(true)}
        />
      )}
      {!showCheckpoint && conflictMessage !== null && <p role="status">{conflictMessage}</p>}
      {!showCheckpoint && checkpointError !== null && <p role="alert">{checkpointError}</p>}
      <div hidden={showCheckpoint}>
        <CaptureProgress stage="prepare" />
        <div className="upload-flow__layout">
          <Fieldset
            legend="Prepare screenshots"
            hideLegend
            disabled={busy || batchId !== null || !entryReady}
          >
            <UploadPage initialService={initialService} onSelectionChange={setSelection} />

            <UploadStep
              index={3}
              legend={IMAGES_STEP_LEGEND}
              /*
               * ⚠ ALWAYS `active`, NEVER LOCKED — and that is deliberate, not an
               * oversight of the progressive reveal. `ImageDropzone` and
               * `PasteButton` HOLD what arrives before the two questions are
               * answered (`ux-states.md` §4.3), because the owner's primary path is
               * pasting the moment they have a screenshot. Dimming or disabling this
               * step would advertise the opposite of what it does and would lose
               * exactly that paste.
               */
              state="active"
              hint={ready ? null : IMAGES_STEP_WAITING_HINT}
              testId="images-step-panel"
            >
              <ImageDropzone
                images={queue}
                uploadStates={uploadStates}
                batchReady={ready}
                offline={!online}
                disabled={busy || batchId !== null}
                serverRejected={serverRejected}
                onQueueChange={setQueue}
                onSelectionRejected={recordRefusals}
              />
              {localRefusals.length > 0 && (
                <p role="status">
                  {localRefusals.length} rejected inputs remain part of this capture. After upload,
                  choose saved replacements or continue with additions only.
                </p>
              )}
              {(queue.length > 0 || localRefusals.length > 0) && batchId === null && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setQueue([]);
                    setLocalRefusals([]);
                  }}
                >
                  Discard local selection and start fresh
                </Button>
              )}
              {busy && <p role="status">{SUBMIT_IN_FLIGHT}</p>}
              <p className="upload-flow__note">{UPLOAD_LOCAL_NOTE}</p>
            </UploadStep>
          </Fieldset>
          <aside className="upload-summary" aria-label={UPLOAD_SUMMARY_TITLE}>
            <h2>{UPLOAD_SUMMARY_TITLE}</h2>
            <dl>
              <dt>Service</dt>
              <dd>
                {selection.service === null
                  ? 'Choose a service'
                  : SERVICE_LABELS[selection.service]}
              </dd>
              <dt>Update mode</dt>
              <dd>
                {selection.mode === null
                  ? 'Choose an update mode'
                  : selection.mode === 'append-only'
                    ? 'Add only'
                    : 'Full update'}
              </dd>
              <dt>Screenshots</dt>
              <dd>{queue.length}</dd>
            </dl>
            <p>{UPLOAD_NEXT_NOTE}</p>
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
              <Button
                variant="primary"
                data-testid="submit-button"
                disabled={blocked !== null || busy || batchId !== null || !entryReady}
                onClick={submit}
              >
                {SUBMIT_LABEL}
              </Button>
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
              {batchId !== null && !busy && (
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busy || !online}
                  onClick={() => {
                    if (inFlight.current) return;
                    inFlight.current = true;
                    setBusy(true);
                    void client
                      .getBatch(batchId)
                      .then(
                        (next) => {
                          setDraftPending(queue.length > 0);
                          setSavedBatch(next);
                        },
                        (error: unknown) => {
                          if (error instanceof RefusedError) setRefused(true);
                          else
                            setFailure(
                              'Saved status could not be checked. Your local screenshots remain here; try checking again.',
                            );
                        },
                      )
                      .finally(() => {
                        inFlight.current = false;
                        setBusy(false);
                      });
                  }}
                >
                  Open saved batch
                </Button>
              )}
            </section>
          </aside>
        </div>
      </div>

      {/* Present only so a test can prove the batch was created once. */}
      <span data-testid="draft-batch-id" hidden>
        {batchId ?? ''}
      </span>
    </div>
  );
}
