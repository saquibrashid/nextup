import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, RefusedError, type ApiClient, type BatchHistoryItem } from './apiClient';

class CheckpointStateError extends Error {}

export type OpenUpload = Pick<
  BatchHistoryItem,
  'batchId' | 'service' | 'mode' | 'status' | 'createdAt'
>;

export function resumeAction(status: string) {
  switch (status) {
    case 'draft':
      return { label: 'Continue adding screenshots', state: 'Saved draft', discardable: true };
    case 'submitted':
    case 'extracting':
      return { label: 'View progress', state: 'Reading screenshots', discardable: false };
    case 'in-review':
      return { label: 'Continue review', state: 'Ready to review', discardable: true };
    case 'extraction-failed':
      return { label: 'Resolve extraction issue', state: 'Needs attention', discardable: true };
    case 'applied':
    case 'undone':
    case 'discarded':
      return null;
    default:
      throw new CheckpointStateError(
        'This import has an unrecognized status. Refresh before continuing.',
      );
  }
}

export type UploadCheckpointState =
  | { kind: 'checking'; attempt: number }
  | { kind: 'ready' }
  | { kind: 'open'; batch: OpenUpload }
  | { kind: 'failed'; message: string }
  | { kind: 'refused' };

export function useUploadCheckpoint(client: ApiClient, online: boolean, enabled: boolean) {
  const [state, setState] = useState<UploadCheckpointState>({ kind: 'checking', attempt: 0 });
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef(0);

  const check = useCallback(
    async (knownBatchId?: string): Promise<void> => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      setState({ kind: 'checking', attempt: ++attempt.current });
      try {
        let open: OpenUpload | undefined;
        if (knownBatchId !== undefined) {
          const batch = await client.getBatch(knownBatchId, request.signal);
          if (resumeAction(batch.status) !== null) open = batch;
        }
        if (open === undefined) {
          const history = await client.listBatches(request.signal, true);
          const unfinished = history.batches.filter((batch) => resumeAction(batch.status) !== null);
          if (unfinished.length > 1) {
            throw new CheckpointStateError(
              'More than one unfinished import was returned. Check Review before continuing.',
            );
          }
          open = unfinished[0];
        }
        if (request.signal.aborted) return;
        setState(open === undefined ? { kind: 'ready' } : { kind: 'open', batch: open });
      } catch (error) {
        if (request.signal.aborted) return;
        setState(
          error instanceof RefusedError
            ? { kind: 'refused' }
            : {
                kind: 'failed',
                message:
                  error instanceof ApiError || error instanceof CheckpointStateError
                    ? error.message
                    : 'We could not check your saved uploads. Check your connection and try again.',
              },
        );
      }
    },
    [client],
  );

  useEffect(() => {
    if (!enabled) return;
    if (online) void check();
    else setState({ kind: 'checking', attempt: ++attempt.current });
    return () => controller.current?.abort();
  }, [check, enabled, online]);

  return { state, check };
}
