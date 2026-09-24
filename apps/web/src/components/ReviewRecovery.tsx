import { useId, useRef, useState } from 'react';
import type { ApiClient, BatchStatus } from '../lib/apiClient';
import { useCaptureLifetime } from '../lib/useCaptureLifetime';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

export function ReviewRecovery({
  batchId,
  client,
  offline,
  busy,
  begin,
  end,
  onDiscarded,
  onNavigate,
}: {
  batchId: string;
  client: ApiClient;
  offline: boolean;
  busy: boolean;
  begin: () => boolean;
  end: () => void;
  onDiscarded: () => void;
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<BatchStatus | null>(null);
  const [unfinished, setUnfinished] = useState<BatchStatus | null>(null);
  const [unknown, setUnknown] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const title = useId();
  const isActive = useCaptureLifetime();
  const requestedDiscard = useRef(false);
  async function check() {
    const [saved, history] = await Promise.all([
      client.getBatch(batchId),
      client.listBatches(undefined, true),
    ]);
    const row = history.batches[0];
    const existing =
      row === undefined
        ? null
        : row.batchId === batchId
          ? saved
          : await client.getBatch(row.batchId);
    if (!isActive()) return;
    setSource(saved);
    setUnfinished(existing);
    setUnknown(false);
    if (saved.status === 'discarded' && requestedDiscard.current) onDiscarded();
  }
  async function run(action?: () => Promise<void>) {
    if (offline || !begin()) return;
    setFailure(null);
    setUnknown(true);
    try {
      if (action !== undefined) await action();
      if (isActive()) await check();
    } catch (error) {
      if (isActive())
        setFailure(
          `${error instanceof Error ? error.message : 'The request failed.'} Check saved status before continuing. Nothing is automatically retried.`,
        );
    } finally {
      if (isActive()) end();
    }
  }
  const available =
    source !== null && source.images.length > 0 && source.images.every((image) => image.available);
  const other = unfinished !== null && unfinished.batchId !== batchId;
  const closed = source !== null && ['applied', 'undone', 'discarded'].includes(source.status);
  return (
    <>
      <Button
        variant="secondary"
        disabled={offline || busy}
        onClick={() => {
          setOpen(true);
          void run();
        }}
      >
        Read screenshots again
      </Button>
      {open && (
        <Dialog
          variant="overlay"
          aria-labelledby={title}
          onDismiss={() => {
            if (busy) return;
            if (closed) onNavigate(`/batches/${batchId}`);
            else setOpen(false);
          }}
        >
          <h2 id={title}>Read these screenshots again?</h2>
          <p>
            A new batch keeps the original service, mode and screenshot expiry. It never applies
            changes automatically.
          </p>
          <p>
            Discarding this review clears its decisions, including local unsaved choices. Your
            library will not change. Reading again is a separate action.
          </p>
          {failure !== null && <p role="alert">{failure}</p>}
          {busy && <p role="status">Checking or saving the import...</p>}
          {source !== null && !available && (
            <p role="alert">
              The saved screenshots are missing or expired. Start a new capture with fresh
              screenshots instead.
            </p>
          )}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (closed) onNavigate(`/batches/${batchId}`);
              else setOpen(false);
            }}
          >
            {closed ? 'View saved import' : 'Keep reviewing'}
          </Button>
          <Button
            variant="secondary"
            disabled={offline || busy}
            onClick={() => {
              void run();
            }}
          >
            Check saved status
          </Button>
          {source?.status === 'in-review' && !other && (
            <Button
              variant="danger"
              disabled={offline || busy || unknown}
              onClick={() => {
                requestedDiscard.current = true;
                void run(async () => {
                  const latest = await client.getBatch(batchId);
                  if (!isActive()) return;
                  if (latest.status !== 'in-review')
                    throw new Error('The import changed. Check its saved status.');
                  await client.discardBatch(batchId);
                });
              }}
            >
              Discard this review
            </Button>
          )}
          {other && unfinished !== null && (
            <Button
              variant="primary"
              disabled={busy || unknown}
              onClick={() => onNavigate(`/batches/${unfinished.batchId}`)}
            >
              {unfinished.derivedFromBatchId === batchId
                ? 'Continue the new read'
                : 'Resolve the unfinished import'}
            </Button>
          )}
          {closed && !other && available && (
            <Button
              variant="primary"
              disabled={offline || busy || unknown}
              onClick={() => {
                void run(async () => {
                  const result = await client.reextractBatch(batchId);
                  if (isActive()) onNavigate(`/batches/${result.batchId}`);
                });
              }}
            >
              Read saved screenshots
            </Button>
          )}
          {closed && !other && !available && (
            <Button
              variant="primary"
              disabled={busy || unknown}
              onClick={() =>
                onNavigate(
                  source?.service === null
                    ? '/upload'
                    : `/upload?service=${encodeURIComponent(source?.service ?? '')}`,
                )
              }
            >
              Upload new screenshots
            </Button>
          )}
        </Dialog>
      )}
    </>
  );
}
