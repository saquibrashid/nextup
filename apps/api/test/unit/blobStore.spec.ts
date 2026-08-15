/**
 * `apps/api/src/storage/blobStore.ts` — the screenshot store (ADR-0006,
 * TASK-050), with `@azure/storage-blob` mocked.
 *
 * The properties here are ones a REAL Azurite cannot prove:
 *
 *  - **The container is private.** Azurite happily serves a public container
 *    and the integration suite would look identical either way; the only
 *    evidence is that `createIfNotExists()` is called with **no access
 *    argument**. `access: 'blob'` would make every screenshot world-readable
 *    by URL, which is the one thing ADR-0006 forbids, and it is a one-word
 *    edit away at all times.
 *  - **A missing blob is `null`, not a throw.** A blob past its 30-day
 *    lifecycle purge is an EXPECTED condition, never a 500 — and Azurite does
 *    not implement lifecycle rules, so it can never produce the case.
 *  - **A missing connection string refuses loudly.** Falling back to a no-op
 *    store would report 201 while losing the bytes: the row would exist, the
 *    review pass would run, and the image would be unviewable with nothing to
 *    explain why. That is the worst available failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createIfNotExists = vi.fn(() => Promise.resolve());
const uploadData = vi.fn(() => Promise.resolve());
const exists = vi.fn(() => Promise.resolve(true));
const downloadToBuffer = vi.fn(() => Promise.resolve(Buffer.from([1, 2, 3])));
const deleteIfExists = vi.fn(() => Promise.resolve());
const getBlockBlobClient = vi.fn(() => ({ uploadData, exists, downloadToBuffer, deleteIfExists }));
const getContainerClient = vi.fn(() => ({ createIfNotExists, getBlockBlobClient }));
const fromConnectionString = vi.fn(() => ({ getContainerClient }));

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: { fromConnectionString: () => fromConnectionString() },
}));

const { azureImageBlobStore, blobPathFor, IMAGE_CONTAINER, resetBlobStoreForTests } =
  await import('../../src/storage/blobStore.js');

const PATH = '01OWNER/01BATCH/01IMAGE.png';

beforeEach(() => {
  resetBlobStoreForTests();
  vi.clearAllMocks();
  exists.mockResolvedValue(true);
  process.env['AZURE_STORAGE_CONNECTION_STRING'] = 'UseDevelopmentStorage=true';
});

afterEach(() => {
  resetBlobStoreForTests();
  delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
});

describe('T-SEC-003 the screenshot container is private and its paths carry no client input', () => {
  it('T-SEC-003c: createIfNotExists is called with NO access argument', async () => {
    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');

    expect(getContainerClient).toHaveBeenCalledWith(IMAGE_CONTAINER);
    expect(createIfNotExists).toHaveBeenCalledTimes(1);
    // ⚠ THE ASSERTION. `createIfNotExists({ access: 'blob' })` — or
    // `'container'` — publishes every screenshot to anyone holding the URL.
    // Asserting on the ARGUMENT COUNT is what makes adding one fail; an
    // assertion that it "was called" would pass either way.
    expect(createIfNotExists.mock.calls[0]).toEqual([]);
  });

  it('T-SEC-003d: the path is owner/batch/image only, and jpeg stores as .jpg', () => {
    expect(blobPathFor('own', 'bat', 'img', 'png')).toBe('own/bat/img.png');
    // `.jpg`, not `.jpeg` — the same mapping the synthesised file name uses,
    // so a stored object and its display name never disagree on extension.
    expect(blobPathFor('own', 'bat', 'img', 'jpeg')).toBe('own/bat/img.jpg');
  });

  it('T-SEC-003e: the stored content type follows the STORED format', async () => {
    await azureImageBlobStore.put(PATH, new Uint8Array([1, 2]), 'jpeg');

    expect(uploadData).toHaveBeenCalledTimes(1);
    const options = uploadData.mock.calls[0]?.[1] as
      { blobHTTPHeaders: { blobContentType: string } } | undefined;
    expect(options?.blobHTTPHeaders.blobContentType).toBe('image/jpeg');
  });
});

describe('T-RET-014 a purged blob is an expected condition, never an error', () => {
  it('T-RET-014b: a missing blob reads as null rather than throwing', async () => {
    exists.mockResolvedValue(false);

    await expect(azureImageBlobStore.get(PATH)).resolves.toBeNull();
    // The download must not even be attempted: the SDK would throw, and the
    // caller would surface a 500 for an image the 30-day lifecycle rule was
    // always going to remove.
    expect(downloadToBuffer).not.toHaveBeenCalled();
  });

  it('T-RET-014c: a present blob reads back as bytes', async () => {
    await expect(azureImageBlobStore.get(PATH)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('T-RET-014d: remove is idempotent, so a second purge is not an error', async () => {
    await azureImageBlobStore.remove(PATH);
    expect(deleteIfExists).toHaveBeenCalledTimes(1);
  });
});

describe('T-SEC-003 configuration failures are loud', () => {
  it('T-SEC-003f: an absent connection string refuses the upload by name', async () => {
    delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
    resetBlobStoreForTests();

    await expect(azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png')).rejects.toThrow(
      /AZURE_STORAGE_CONNECTION_STRING/,
    );
    // Nothing was attempted — no silent no-op store standing in for a real one.
    expect(uploadData).not.toHaveBeenCalled();
  });

  it('T-SEC-003g: the client is memoised, and resetBlobStoreForTests forgets it', async () => {
    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');
    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');
    expect(fromConnectionString).toHaveBeenCalledTimes(1);

    // Without the reset seam a suite that changed the environment would keep
    // talking to the previous account, and the change would appear to have no
    // effect — a debugging trap rather than a failure.
    resetBlobStoreForTests();
    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');
    expect(fromConnectionString).toHaveBeenCalledTimes(2);
  });
});
