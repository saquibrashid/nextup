import { useRef, useState, type JSX } from 'react';
import { SERVICE_LABELS } from '@nextup/domain';
import { RefusedError, type ApiClient, type BatchStatus } from '../lib/apiClient';
import { ImageDropzone, type QueuedImage, type ServerRejection } from './ImageDropzone';
import { RejectionList, mergeRejections, rejectionsFromError } from './RejectionList';
import { Button } from './ui/Button';
import { Fieldset } from './ui/Fieldset';
import { OFFLINE_DISABLED_REASON, SUBMIT_LABEL, UPLOAD_RECOVERY_NOTE } from '../copy';

interface DraftBatchProps {
  readonly batch: BatchStatus;
  readonly client: ApiClient;
  readonly offline: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onRefused: () => void;
  readonly onDiscarded: () => void;
}

/** The saved server draft is the authority after an interrupted upload. */
export function DraftBatch({
  batch,
  client,
  offline,
  onRefresh,
  onRefused,
  onDiscarded,
}: DraftBatchProps): JSX.Element {
  const [queue, setQueue] = useState<readonly QueuedImage[]>([]);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [rejected, setRejected] = useState<readonly ServerRejection[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const inFlight = useRef(false);

  function run(action: () => Promise<void>): void {
    if (inFlight.current || offline) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    void (async () => {
      try {
        await action();
      } catch (error) {
        if (error instanceof RefusedError) onRefused();
        else setFailure(error instanceof Error ? error.message : 'The request failed.');
      } finally {
        await onRefresh();
        inFlight.current = false;
        setBusy(false);
      }
    })();
  }

  function upload(): void {
    run(async () => {
      const errors: string[] = [];
      const refusals: ServerRejection[] = [];
      for (const image of queue) {
        const form = new FormData();
        form.append('files', image.file);
        form.append('ingestSource', image.source);
        try {
          const result = await client.addBatchImages(batch.batchId, form);
          refusals.push(...result.rejected);
        } catch (error) {
          if (error instanceof RefusedError) throw error;
          const entries = rejectionsFromError(error);
          refusals.push(...entries);
          if (entries.length === 0)
            errors.push(
              `${image.file.name}: ${error instanceof Error ? error.message : 'Upload failed.'}`,
            );
        }
      }
      setRejected(refusals);
      setQueue([]);
      setGeneration((current) => current + 1);
      if (errors.length > 0) setFailure(`${UPLOAD_RECOVERY_NOTE} ${errors.join(' ')}`);
    });
  }

  return (
    <section className="upload-flow">
      <h1>Check your saved screenshots</h1>
      <p>
        {SERVICE_LABELS[batch.service]} ·{' '}
        {batch.mode === 'full-update' ? 'Full update' : 'Add only'}
      </p>
      <Button
        variant="secondary"
        disabled={busy || offline}
        onClick={() => setConfirmDiscard(true)}
      >
        Discard batch and start again
      </Button>
      {confirmDiscard && (
        <section aria-label="Discard this draft">
          <p>Discard this saved batch? Your library will not change.</p>
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
              run(async () => {
                await client.discardBatch(batch.batchId);
                onDiscarded();
              });
            }}
          >
            Discard batch
          </Button>
        </section>
      )}
      <p>
        These screenshots are saved in this batch. Remove any you do not want, or attach a missing
        screenshot. Service and mode stay fixed for this saved batch.
      </p>
      {offline && <p role="status">{OFFLINE_DISABLED_REASON}</p>}
      {failure !== null && <p role="alert">{failure}</p>}
      <RejectionList entries={mergeRejections([], rejected)} />
      <ul className="draft-images" aria-label="Saved screenshots">
        {batch.images.map((image) => (
          <li key={image.imageId}>
            <span>{image.fileName}</span>
            <Button
              variant="secondary"
              disabled={busy || offline}
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
      <Fieldset legend="Add screenshots to this batch" disabled={busy || offline}>
        <ImageDropzone
          key={generation}
          batchReady
          offline={offline}
          disabled={busy || offline}
          onQueueChange={setQueue}
        />
        <Button
          variant="secondary"
          disabled={queue.length === 0 || busy || offline}
          onClick={upload}
        >
          Upload selected screenshots
        </Button>
      </Fieldset>
      <p>Check the saved list after an interrupted request before attaching the same file again.</p>
      {batch.images.length === 0 && <p>Attach at least one screenshot first.</p>}
      {queue.length > 0 && <p>Upload the selected screenshots before extracting titles.</p>}
      <Button
        variant="primary"
        data-testid="draft-submit"
        disabled={batch.images.length === 0 || queue.length > 0 || busy || offline}
        onClick={() => {
          run(async () => {
            await client.submitBatch(batch.batchId);
          });
        }}
      >
        {SUBMIT_LABEL}
      </Button>
      {busy && <p role="status">Saving your changes…</p>}
    </section>
  );
}
