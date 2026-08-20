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
 *  - **The managed-identity path WINS over a connection string (A48).** Both
 *    variables set is a misconfiguration either way; which one wins decides
 *    whether it degrades production to a long-lived account key silently, or
 *    is inert. Only the choice is testable — Azurite has no identity to offer.
 *  - **The container name comes from the environment (A48).** It was a
 *    hard-coded constant, which made rbac.bicep's per-container scoping
 *    pointless: staging asked for production's container by name.
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
/** Records the (endpoint, credential) pair the identity path constructs with. */
const blobServiceCtor = vi.fn();
const credentialCtor = vi.fn();

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: Object.assign(
    class {
      constructor(...args: unknown[]) {
        blobServiceCtor(...args);
      }
      getContainerClient(name: string) {
        return getContainerClient(name);
      }
    },
    { fromConnectionString: () => fromConnectionString() },
  ),
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {
    constructor() {
      credentialCtor();
    }
  },
}));

const { azureImageBlobStore, blobPathFor, IMAGE_CONTAINER, resetBlobStoreForTests } =
  await import('../../src/storage/blobStore.js');

const PATH = '01OWNER/01BATCH/01IMAGE.png';

beforeEach(() => {
  resetBlobStoreForTests();
  vi.clearAllMocks();
  exists.mockResolvedValue(true);
  process.env['AZURE_STORAGE_CONNECTION_STRING'] = 'UseDevelopmentStorage=true';
  delete process.env['AZURE_STORAGE_BLOB_ENDPOINT'];
  delete process.env['AZURE_STORAGE_CONTAINER'];
});

afterEach(() => {
  resetBlobStoreForTests();
  delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
  delete process.env['AZURE_STORAGE_BLOB_ENDPOINT'];
  delete process.env['AZURE_STORAGE_CONTAINER'];
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

  it('T-SEC-003h: the error names BOTH variables, so neither path is a guess', async () => {
    delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
    resetBlobStoreForTests();

    // Naming only the connection string would send whoever reads it towards
    // the account-key path ADR-0006 forbids — the message would be steering
    // them at the wrong fix while sounding authoritative.
    await expect(azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png')).rejects.toThrow(
      /AZURE_STORAGE_BLOB_ENDPOINT/,
    );
  });
});

describe('T-SEC-003 the identity path wins, and the container is per-environment (A48)', () => {
  it('T-SEC-003i: an endpoint alone uses managed identity, never a key', async () => {
    delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
    process.env['AZURE_STORAGE_BLOB_ENDPOINT'] = 'https://stnextupprod.blob.core.windows.net/';
    resetBlobStoreForTests();

    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');

    expect(credentialCtor).toHaveBeenCalledTimes(1);
    expect(fromConnectionString).not.toHaveBeenCalled();
    expect(blobServiceCtor.mock.calls[0]?.[0]).toBe('https://stnextupprod.blob.core.windows.net/');
  });

  it('T-SEC-003j: with BOTH set the endpoint wins, so a stray key is inert', async () => {
    // ⚠ THE ORDER IS THE SECURITY PROPERTY, not a preference. A connection
    // string carries an AccountKey. If it won, one stray variable would
    // silently downgrade production from identity auth to a long-lived
    // credential — and everything would keep working, which is what makes
    // that direction dangerous. This way the same mistake changes nothing.
    process.env['AZURE_STORAGE_CONNECTION_STRING'] = 'UseDevelopmentStorage=true';
    process.env['AZURE_STORAGE_BLOB_ENDPOINT'] = 'https://stnextupprod.blob.core.windows.net/';
    resetBlobStoreForTests();

    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');

    expect(fromConnectionString).not.toHaveBeenCalled();
    expect(credentialCtor).toHaveBeenCalledTimes(1);
  });

  it('T-SEC-003k: createIfNotExists is NOT called against a real account', async () => {
    // In Azure the container is made by storage.bicep and the app's grant is
    // scoped to that one container, so a create call is at best redundant and
    // at worst a 403 on the first upload of every deployment.
    delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
    process.env['AZURE_STORAGE_BLOB_ENDPOINT'] = 'https://stnextupprod.blob.core.windows.net/';
    resetBlobStoreForTests();

    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');

    expect(createIfNotExists).not.toHaveBeenCalled();
    expect(uploadData).toHaveBeenCalledTimes(1);
  });

  it('T-SEC-003m: staging writes to ITS OWN container, not production\u2019s', async () => {
    // The bug this replaces: the name was a constant, so staging asked for
    // `screenshots` every time. rbac.bicep scopes each environment's grant to
    // its own container, so that guaranteed only that staging would be
    // REFUSED — and had the two ever shared a credential, staging would have
    // written the owner's test screenshots into the production container.
    process.env['AZURE_STORAGE_CONTAINER'] = 'screenshots-staging';
    resetBlobStoreForTests();

    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');

    expect(getContainerClient).toHaveBeenCalledWith('screenshots-staging');
    expect(getContainerClient).not.toHaveBeenCalledWith(IMAGE_CONTAINER);
  });

  it('T-SEC-003n: an unset or blank container name falls back to the default', async () => {
    // Blank as well as unset: an ARM parameter that resolves to '' is the
    // realistic failure, and treating it as a container named '' would fail
    // far from the cause.
    process.env['AZURE_STORAGE_CONTAINER'] = '   ';
    resetBlobStoreForTests();

    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');

    expect(getContainerClient).toHaveBeenCalledWith(IMAGE_CONTAINER);
  });

  it('T-SEC-003p: the credential is memoised, and the reset seam forgets it too', async () => {
    // A fresh DefaultAzureCredential per call re-walks the credential chain
    // and re-hits IMDS instead of using the token cache the instance holds.
    delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
    process.env['AZURE_STORAGE_BLOB_ENDPOINT'] = 'https://stnextupprod.blob.core.windows.net/';
    resetBlobStoreForTests();

    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');
    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');
    expect(credentialCtor).toHaveBeenCalledTimes(1);

    resetBlobStoreForTests();
    await azureImageBlobStore.put(PATH, new Uint8Array([1]), 'png');
    expect(credentialCtor).toHaveBeenCalledTimes(2);
  });
});
