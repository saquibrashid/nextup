import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';
import { SERVICE_LABELS, MAX_IMAGES_PER_BATCH, MAX_BATCH_UPLOAD_BYTES } from '@nextup/domain';
import { RefusedError, type ApiClient, type BatchStatus } from '../lib/apiClient';
import { ImageDropzone, type QueuedImage, type ServerRejection } from './ImageDropzone';
import { RejectionList, mergeRejections } from './RejectionList';
import { uploadSelection, type ImageUploadState } from '../lib/uploadSelection';
import { useCaptureLifetime } from '../lib/useCaptureLifetime';
import { useCaptureNavigation } from './CaptureNavigation';
import { ScreenshotPreview } from './ScreenshotPreview';
import { CaptureInputIssues } from './CaptureInputIssues';
import { CaptureProgress } from './CaptureProgress';
import { useCaptureRefusals } from '../lib/useCaptureRefusals';
import { Button } from './ui/Button';
import { Fieldset } from './ui/Fieldset';
import { Dialog } from './ui/Dialog';
import { OFFLINE_DISABLED_REASON, SUBMIT_LABEL } from '../copy';

interface DraftBatchProps {
  readonly batch: BatchStatus;
  readonly client: ApiClient;
  readonly offline: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onRefused: () => void;
  readonly onDiscarded: () => void;
  readonly initialQueue?: readonly QueuedImage[];
  readonly initialStates?: ReadonlyMap<File, ImageUploadState>;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly initialRejected?: readonly ServerRejection[];
  readonly initialFailure?: string | null;
}

/** The saved server draft is the authority after an interrupted upload. */
export function DraftBatch({
  batch: suppliedBatch,
  client,
  offline,
  onRefresh,
  onRefused,
  onDiscarded,
  initialQueue = [],
  initialStates = new Map(),
  onPendingChange,
  initialRejected = [],
  initialFailure = null,
}: DraftBatchProps): JSX.Element {
  const isActive = useCaptureLifetime();
  const [queue, setQueue] = useState<readonly QueuedImage[]>(initialQueue);
  const localRefusals = useCaptureRefusals(`nextup.capture.refusals.${suppliedBatch.batchId}`);
  const [states, setStates] = useState(initialStates);
  const [verified, setVerified] = useState<BatchStatus | null>(null);
  const batch = verified ?? suppliedBatch;
  const [needsCheck, setNeedsCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(initialFailure);
  const [rejected, setRejected] = useState<readonly ServerRejection[]>(initialRejected);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardTitle = useId();
  const inFlight = useRef(false);
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  const allowNavigation = useCaptureNavigation(
    queue.length > 0 ||
      needsCheck ||
      localRefusals.reports.length > 0 ||
      localRefusals.error !== null,
    busy,
  );
  const unknown = queue.some((image) => states.get(image.file) === 'unknown');
  const editable = batch.status === 'draft';
  useEffect(() => {
    setVerified(null);
  }, [suppliedBatch]);
  useEffect(() => {
    onPendingChange?.(
      queue.length > 0 ||
        busy ||
        needsCheck ||
        localRefusals.reports.length > 0 ||
        localRefusals.error !== null,
    );
  }, [
    queue.length,
    busy,
    needsCheck,
    localRefusals.reports.length,
    localRefusals.error,
    onPendingChange,
  ]);
  const changeQueue = useCallback((images: readonly QueuedImage[]) => {
    setQueue(images);
    const files = new Set(images.map((image) => image.file));
    setStates((current) => new Map([...current].filter(([file]) => files.has(file))));
  }, []);

  function update(file: File, state: ImageUploadState) {
    setStates((current) => new Map(current).set(file, state));
  }

  async function refresh(): Promise<void> {
    setNeedsCheck(true);
    try {
      const next = await client.getBatch(batch.batchId);
      if (!isActive()) return;
      setVerified(next);
      await onRefresh();
      setNeedsCheck(false);
    } catch (error) {
      if (error instanceof RefusedError) onRefused();
      else
        setFailure(
          'The saved screenshots could not be checked. Your local files are still held here. Check again before retrying.',
        );
    }
  }

  function run(action: () => Promise<void>, afterSuccess?: () => void): void {
    if (inFlight.current || offline || needsCheck || !editable) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    void (async () => {
      let succeeded = false;
      try {
        const latest = await client.getBatch(batch.batchId);
        if (!isActive()) return;
        setVerified(latest);
        if (offlineRef.current) {
          setFailure(OFFLINE_DISABLED_REASON);
          return;
        }
        if (latest.status !== 'draft') {
          setFailure(
            'This batch is no longer a draft. Your new local files have not been uploaded.',
          );
          return;
        }
        await action();
        succeeded = true;
      } catch (error) {
        if (isActive() && error instanceof RefusedError) onRefused();
        else setFailure(error instanceof Error ? error.message : 'The request failed.');
      } finally {
        if (isActive()) await refresh();
        inFlight.current = false;
        setBusy(false);
        if (succeeded && isActive()) afterSuccess?.();
      }
    })();
  }

  function upload(): void {
    if (unknown || localRefusals.error !== null) return;
    run(async () => {
      await saveRefusals();
      if (!isActive()) return;
      const result = await uploadSelection(client, batch.batchId, queue, update, isActive);
      if (!isActive()) return;
      setRejected(result.rejected);
      changeQueue(result.remaining);
      if (result.problems.length > 0) setFailure(result.problems.join(' '));
    });
  }

  async function saveRefusals(): Promise<void> {
    const reports = localRefusals.reports;
    for (let index = 0; index < reports.length; index += 100) {
      if (!isActive()) return;
      if (offlineRef.current) throw new Error(OFFLINE_DISABLED_REASON);
      const chunk = reports.slice(index, index + 100);
      await client.reportCaptureRefusals(batch.batchId, chunk);
      if (isActive()) localRefusals.saved(chunk);
    }
  }

  return (
    <section className="upload-flow saved-capture">
      {editable && <CaptureProgress stage="prepare" />}
      <RejectionList entries={mergeRejections([], rejected)} />
      <h1>Check your saved screenshots</h1>
      <p>
        {SERVICE_LABELS[batch.service]} ·{' '}
        {batch.mode === 'full-update' ? 'Full update' : 'Add only'}
      </p>
      {!editable && (
        <p role="alert">
          This batch is now {batch.status}. No more screenshots can be attached. Remove or keep your
          local selection before leaving.
        </p>
      )}
      {confirmDiscard && (
        <Dialog
          variant="overlay"
          aria-labelledby={discardTitle}
          onDismiss={() => {
            if (!busy) setConfirmDiscard(false);
          }}
        >
          <h2 id={discardTitle}>Discard this saved import?</h2>
          <p>Your library will not change.</p>
          {queue.length > 0 && (
            <p>The {queue.length} screenshots selected only on this device will also be cleared.</p>
          )}
          <Button
            variant="secondary"
            disabled={busy || offline}
            onClick={() => setConfirmDiscard(false)}
          >
            Keep batch
          </Button>
          <Button
            variant="danger"
            disabled={busy || offline}
            onClick={() => {
              run(
                async () => {
                  await client.discardBatch(batch.batchId);
                },
                () => {
                  localRefusals.clear();
                  allowNavigation();
                  onDiscarded();
                },
              );
            }}
          >
            Discard import
          </Button>
        </Dialog>
      )}
      <p>
        These screenshots are saved in this import. Remove any you do not want, or attach a missing
        screenshot. Service and mode stay fixed for this saved import.
      </p>
      {offline && <p role="status">{OFFLINE_DISABLED_REASON}</p>}
      {failure !== null && <p role="alert">{failure}</p>}
      {localRefusals.error !== null && <p role="alert">{localRefusals.error}</p>}
      {localRefusals.reports.length > 0 && (
        <section aria-label="Unsaved input issues">
          <h2>Input issues waiting to be saved</h2>
          <ul>
            {localRefusals.reports.map((report) => (
              <li key={report.token}>
                {report.name}: {report.message}
              </li>
            ))}
          </ul>
          <p>
            These issues must be saved before reading the screenshots. Reconnecting does not save
            them automatically.
          </p>
          <Button
            variant="secondary"
            disabled={busy || offline || needsCheck || !editable}
            onClick={() => run(saveRefusals)}
          >
            Save input issues
          </Button>
        </section>
      )}
      {needsCheck && (
        <p role="status">Saved status is unverified. Upload and Extract are paused.</p>
      )}
      <Button
        variant="secondary"
        disabled={busy || offline}
        onClick={() => {
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          void refresh().finally(() => {
            inFlight.current = false;
            setBusy(false);
          });
        }}
      >
        Check saved screenshots
      </Button>
      <p>
        {batch.images.length} saved + {queue.length} selected on this device /{' '}
        {MAX_IMAGES_PER_BATCH} screenshots.
      </p>
      <p>
        {batch.batchTotals === undefined
          ? 'Saved upload size is unavailable; the server will check the remaining capacity.'
          : `${((batch.batchTotals.uploadedByteSize + queue.reduce((sum, image) => sum + image.file.size, 0)) / (1024 * 1024)).toFixed(1)} MB saved and selected`}{' '}
        ({MAX_BATCH_UPLOAD_BYTES / (1024 * 1024)} MB upload limit).
      </p>
      <ul className="draft-images" aria-label="Saved screenshots">
        {batch.images.map((image) => (
          <li key={image.imageId}>
            {image.available ? (
              <ScreenshotPreview source={image.href} name={image.fileName} />
            ) : (
              <div className="capture-preview">Expired</div>
            )}
            <div className="capture-image-details">
              <span>{image.fileName}</span>
              <span>Saved{image.available ? '' : ' - screenshot expired'}</span>
            </div>
            <Button
              variant="secondary"
              disabled={busy || offline || needsCheck || !editable}
              onClick={() => {
                run(async () => {
                  await client.removeBatchImage(batch.batchId, image.imageId);
                });
              }}
            >
              Remove {image.fileName}
            </Button>
          </li>
        ))}
      </ul>
      <Fieldset legend="Selected on this device" disabled={busy}>
        <ImageDropzone
          images={queue}
          savedCount={batch.images.length}
          savedUploadedBytes={batch.batchTotals?.uploadedByteSize ?? 0}
          uploadStates={states}
          batchReady
          offline={offline}
          disabled={busy}
          onQueueChange={changeQueue}
          onSelectionRejected={localRefusals.record}
        />
        <Button
          variant="secondary"
          disabled={
            queue.length === 0 ||
            busy ||
            offline ||
            needsCheck ||
            unknown ||
            !editable ||
            localRefusals.error !== null
          }
          onClick={upload}
        >
          Upload selected screenshots
        </Button>
      </Fieldset>
      <CaptureInputIssues
        batch={batch}
        disabled={busy || offline || needsCheck || !editable}
        onResolve={(attemptId, imageIds) =>
          run(async () => {
            await client.resolveCaptureInput(batch.batchId, attemptId, imageIds);
          })
        }
        onRetryRemoval={(imageId) =>
          run(async () => {
            await client.removeBatchImage(batch.batchId, imageId);
          })
        }
      />
      {unknown && (
        <p role="alert">
          An upload outcome is unknown. Check the saved previews first. If it is already saved,
          remove its local copy. Otherwise remove it and select it again for an explicit retry.
          Nothing is replayed automatically.
        </p>
      )}
      <p>Check the saved list after an interrupted request before attaching the same file again.</p>
      {batch.images.length === 0 && <p>Attach at least one screenshot first.</p>}
      {batch.images.some((image) => !image.available) && (
        <p>Remove expired screenshots and select replacements before extracting.</p>
      )}
      {queue.length > 0 && <p>Upload the selected screenshots before extracting titles.</p>}
      <Button
        variant="primary"
        data-testid="draft-submit"
        disabled={
          batch.images.length === 0 ||
          batch.images.some((image) => !image.available) ||
          queue.length > 0 ||
          busy ||
          offline ||
          needsCheck ||
          localRefusals.error !== null ||
          (batch.mode === 'full-update' && batch.intake === undefined) ||
          !editable
        }
        onClick={() => {
          run(async () => {
            await saveRefusals();
            if (!isActive()) return;
            await client.submitBatch(batch.batchId);
          });
        }}
      >
        {SUBMIT_LABEL}
      </Button>
      <Button
        variant="secondary"
        disabled={busy || offline || needsCheck || !editable}
        onClick={() => setConfirmDiscard(true)}
      >
        Discard import and start again
      </Button>
      {busy && <p role="status">Saving your changes…</p>}
    </section>
  );
}
