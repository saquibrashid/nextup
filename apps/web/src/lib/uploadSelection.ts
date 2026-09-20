import { RefusedError, type ApiClient } from './apiClient';
import type { QueuedImage, ServerRejection } from '../components/ImageDropzone';
import { rejectionsFromError } from '../components/RejectionList';

export type ImageUploadState = 'selected' | 'uploading' | 'saved' | 'rejected' | 'unknown';

export const IMAGE_UPLOAD_LABELS: Record<ImageUploadState, string> = {
  selected: 'Selected on this device',
  uploading: 'Uploading',
  saved: 'Saved',
  rejected: 'Rejected',
  unknown: 'Outcome unknown',
};

export async function uploadSelection(
  client: ApiClient,
  batchId: string,
  images: readonly QueuedImage[],
  update: (file: File, state: ImageUploadState) => void,
  isActive: () => boolean,
) {
  const remaining: QueuedImage[] = [];
  const rejected: ServerRejection[] = [];
  const problems: string[] = [];
  for (const image of images) {
    if (!isActive()) break;
    update(image.file, 'uploading');
    const form = new FormData();
    form.append('files', image.file);
    form.append('ingestSource', image.source);
    try {
      const result = await client.addBatchImages(batchId, form);
      if (result.accepted.length === 1 && result.rejected.length === 0) {
        update(image.file, 'saved');
      } else if (result.accepted.length === 0 && result.rejected.length > 0) {
        rejected.push(...result.rejected);
        remaining.push(image);
        update(image.file, 'rejected');
      } else {
        throw new Error('The upload response could not confirm whether this screenshot was saved.');
      }
    } catch (error) {
      const entries = rejectionsFromError(error);
      remaining.push(image);
      rejected.push(...entries);
      update(image.file, entries.length > 0 ? 'rejected' : 'unknown');
      if (error instanceof RefusedError) throw error;
      if (entries.length === 0)
        problems.push(
          `${image.file.name}: ${error instanceof Error ? error.message : 'The upload response was lost.'}`,
        );
    }
  }
  return { remaining, rejected, problems };
}
