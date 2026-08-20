/**
 * Blob storage for uploaded screenshots (ADR-0006, TASK-050).
 *
 * ⚠ `blobPath` IS COMPOSED FROM SERVER-GENERATED ULIDs ALONE —
 * `${ownerId}/${batchId}/${imageId}.${ext}` (`specs/security.md` T4).
 * **No part of any client-supplied file name reaches it, for any ingest
 * source.** `fileName` is display/provenance only. The composition lives in
 * `blobPathFor()` below and takes no name argument at all, so the rule is
 * structural rather than a convention someone has to remember.
 *
 * ⚠ `blobPath` MUST NEVER APPEAR IN AN HTTP RESPONSE (`T-SEC-003`). Bytes are
 * served by `GET /api/images/:imageId`, which resolves the path server-side
 * from the row.
 *
 * The container is private and carries a 30-day lifecycle purge (NFR-019,
 * `IMAGE_RETENTION_DAYS`). The lifecycle rule is NOT emulated by Azurite, so
 * retention is asserted two ways instead — by manipulating `retainUntil` at
 * the application boundary and by asserting the Bicep rule's shape
 * (`specs/testing.md` §3.4).
 */

import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';

import type { ImageFormat } from '@nextup/domain';

/** Private container. Created on demand so a fresh Azurite needs no setup. */
export const IMAGE_CONTAINER = 'screenshots';

const CONTENT_TYPE_BY_FORMAT: Readonly<Record<ImageFormat, string>> = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
});

/**
 * The `Content-Type` for a STORED format.
 *
 * ⚠ Keyed on the stored format, never on `uploadedFormat`. A HEIC upload is
 * transcoded to PNG on ingest (`specs/api.md` §5.1), so serving `image/heic`
 * would mislabel PNG bytes — and only Safari would even try to render it.
 * `image/heic` is therefore not a value this map can produce, by construction.
 */
export function contentTypeFor(format: ImageFormat): string {
  return CONTENT_TYPE_BY_FORMAT[format];
}

/**
 * Compose the storage path.
 *
 * Takes ULIDs and a stored format — deliberately NOT a file name. See the
 * header. This signature is what makes the "no client name in a path" rule
 * cheap to keep true.
 */
export function blobPathFor(
  ownerId: string,
  batchId: string,
  imageId: string,
  format: ImageFormat,
): string {
  return `${ownerId}/${batchId}/${imageId}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

export interface ImageBlobStore {
  put(blobPath: string, bytes: Uint8Array, format: ImageFormat): Promise<void>;
  get(blobPath: string): Promise<Uint8Array | null>;
  remove(blobPath: string): Promise<void>;
}

let cached: ContainerClient | undefined;

function containerClient(): ContainerClient {
  if (cached) {
    return cached;
  }
  const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING'];
  if (!connectionString) {
    // Deliberately explicit rather than a silent no-op store. Losing the bytes
    // while reporting 201 would be the worst available failure: the row would
    // exist, the review pass would run, and the image would be unviewable with
    // nothing to explain why.
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING is not set; refusing to accept uploads with nowhere to store them.',
    );
  }
  cached =
    BlobServiceClient.fromConnectionString(connectionString).getContainerClient(IMAGE_CONTAINER);
  return cached;
}

/** Test seam: forget the memoised client after the environment changes. */
export function resetBlobStoreForTests(): void {
  cached = undefined;
}

export const azureImageBlobStore: ImageBlobStore = {
  async put(blobPath, bytes, format) {
    const container = containerClient();
    // `createIfNotExists` with no access level: the container stays PRIVATE.
    // Passing `access: 'blob'` here would make every screenshot world-readable
    // by URL, which is the one thing ADR-0006 forbids.
    await container.createIfNotExists();
    await container.getBlockBlobClient(blobPath).uploadData(Buffer.from(bytes), {
      blobHTTPHeaders: { blobContentType: CONTENT_TYPE_BY_FORMAT[format] },
    });
  },

  async get(blobPath) {
    const client = containerClient().getBlockBlobClient(blobPath);
    if (!(await client.exists())) {
      // A missing blob and an expired `retainUntil` are the SAME, expected,
      // non-error condition (ADR-0006). Never a 500.
      return null;
    }
    return new Uint8Array(await client.downloadToBuffer());
  },

  async remove(blobPath) {
    await containerClient().getBlockBlobClient(blobPath).deleteIfExists();
  },
};
