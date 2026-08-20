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

import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';

import type { ImageFormat } from '@nextup/domain';

/**
 * The DEFAULT private container. Prod writes here; staging must not.
 *
 * ⚠ THIS WAS A HARD-CODED CONSTANT AND THAT WAS AN ISOLATION BUG. `storage.bicep`
 * creates `screenshots` AND `screenshots-staging`, and `rbac.bicep` scopes each
 * environment's grant to its own container so that "the staging identity has no
 * grant on the production blob container" is true by construction. With the
 * name fixed here, staging asked for `screenshots` regardless — so the
 * construction guaranteed only that staging would be REFUSED, and had the two
 * ever shared a credential it would have written the owner's staging
 * experiments straight into production's container. Read from
 * `AZURE_STORAGE_CONTAINER`, which `aca.bicep` sets per environment.
 */
export const IMAGE_CONTAINER = 'screenshots';

function containerName(): string {
  const configured = process.env['AZURE_STORAGE_CONTAINER']?.trim();
  return configured === undefined || configured === '' ? IMAGE_CONTAINER : configured;
}

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
let cachedCredential: DefaultAzureCredential | undefined;

/**
 * Memoised for the same reason `configFromEnv.ts` memoises its own: a fresh
 * `DefaultAzureCredential` per call re-walks the credential chain and re-hits
 * IMDS instead of using the token cache the instance holds.
 */
function credential(): DefaultAzureCredential {
  cachedCredential ??= new DefaultAzureCredential();
  return cachedCredential;
}

/**
 * ⚠ THE ENDPOINT PATH IS TRIED FIRST, AND THE ORDER IS THE SECURITY PROPERTY.
 *
 * ADR-0006 says managed identity, no account key and no SAS. A connection
 * string carries an `AccountKey`, so the only legitimate use of that branch is
 * Azurite (`UseDevelopmentStorage=true`) for local dev and the integration
 * suite. Preferring the connection string would mean a stray variable in the
 * Container App could silently downgrade production from identity auth to a
 * long-lived key — and everything would keep working, which is what makes it
 * dangerous. Preferring the endpoint means the same mistake is inert.
 */
function containerClient(): ContainerClient {
  if (cached) {
    return cached;
  }
  const endpoint = process.env['AZURE_STORAGE_BLOB_ENDPOINT']?.trim();
  const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING'];

  if (endpoint !== undefined && endpoint !== '') {
    cached = new BlobServiceClient(endpoint, credential()).getContainerClient(containerName());
    return cached;
  }

  if (!connectionString) {
    // Deliberately explicit rather than a silent no-op store. Losing the bytes
    // while reporting 201 would be the worst available failure: the row would
    // exist, the review pass would run, and the image would be unviewable with
    // nothing to explain why.
    throw new Error(
      'Neither AZURE_STORAGE_BLOB_ENDPOINT nor AZURE_STORAGE_CONNECTION_STRING is set; ' +
        'refusing to accept uploads with nowhere to store them.',
    );
  }
  cached =
    BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName());
  return cached;
}

/** True when the store is talking to Azurite rather than to Azure. */
function isEmulated(): boolean {
  const endpoint = process.env['AZURE_STORAGE_BLOB_ENDPOINT']?.trim();
  return endpoint === undefined || endpoint === '';
}

/** Test seam: forget the memoised client after the environment changes. */
export function resetBlobStoreForTests(): void {
  cached = undefined;
  cachedCredential = undefined;
}

export const azureImageBlobStore: ImageBlobStore = {
  async put(blobPath, bytes, format) {
    const container = containerClient();
    // ⚠ ONLY against Azurite. In Azure the container is created by
    // `storage.bicep`, and the app's grant is scoped to that one container —
    // so a create call is at best redundant and at worst a 403 on the very
    // first upload of every deployment. Against a fresh Azurite there is
    // nothing to create it, hence the emulator-only branch.
    //
    // `createIfNotExists` with no access level: the container stays PRIVATE.
    // Passing `access: 'blob'` here would make every screenshot world-readable
    // by URL, which is the one thing ADR-0006 forbids.
    if (isEmulated()) await container.createIfNotExists();
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
