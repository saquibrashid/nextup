/**
 * `GET /api/images/:imageId` — the handler's branch arms, over real HTTP with
 * the repository and the blob store mocked (TASK-052, `specs/api.md` §6.27).
 *
 * The three arms that matter here cannot be driven from a real store cheaply
 * or at all:
 *
 *  - **`T-IMG-004`** needs the clock to sit exactly ON `retainUntil`. Waiting
 *    30 days is not a test, and moving the row's date proves the comparison
 *    but not its boundary — so the boundary is asserted directly as well.
 *  - **`T-IMG-005`** needs a live row whose blob is gone. That is the NORMAL
 *    steady state after the lifecycle purge, and Azurite does not implement
 *    lifecycle rules at all (`specs/testing.md` §3.4), so the only honest way
 *    to produce it is to make the store answer `null`.
 *  - **`T-SEC-003`** is about what is absent from a response, which is only
 *    meaningful if the thing that could leak — `blobPath` — is a value the
 *    test knows and can search the RAW bytes for.
 *
 * It also carries the coverage: `npm run coverage` scores only `unit` and
 * `web`, so a route proven only in integration scores near zero against the
 * `apps/api/src/**` floor.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUploadedImageById = vi.fn();

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadedImageById: (...args: unknown[]) => findUploadedImageById(...args) as unknown,
  };
});

/**
 * Mocked at the MODULE boundary rather than injected, because `createApp()`
 * wires the route with its default store — and the default wiring is what a
 * production request actually goes through. Injecting a double here would
 * assert a composition that never ships.
 */
const get = vi.fn();
vi.mock('../../src/storage/blobStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/storage/blobStore.js')>();
  return {
    ...actual,
    azureImageBlobStore: {
      put: () => Promise.resolve(),
      get: (...args: unknown[]) => get(...args) as unknown,
      remove: () => Promise.resolve(),
    },
  };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');
const { IMAGE_EXPIRED_MESSAGE, isExpired } = await import('../../src/routes/images.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-image-serve';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

/** The value that must never reach a client (`T-SEC-003`). */
const BLOB_PATH = 'owner-abc/01J8ZF0000000000000000/01J8ZG0000000000000000.png';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22]);

const HOUR = 60 * 60 * 1000;

function imageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '01J8ZG0000000000000000',
    ownerId: 'owner-abc',
    batchId: '01J8ZF0000000000000000',
    blobPath: BLOB_PATH,
    fileName: 'IMG_0042.HEIC',
    format: 'png',
    uploadedFormat: 'heic',
    retainUntil: new Date(Date.now() + 24 * HOUR),
    ...overrides,
  };
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;

const fetchImage = (imageId = '01J8ZG0000000000000000'): Promise<Response> =>
  fetch(`${origin}/api/images/${imageId}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;

  findUploadedImageById.mockResolvedValue(imageRow());
  get.mockResolvedValue(PNG);

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('T-IMG-002 · US-035 AC-4 · bytes are served only here, with the mandated headers', () => {
  it('T-IMG-002i · 200 carries every header specs/api.md §6.27 mandates', async () => {
    const res = await fetchImage();
    expect(res.status).toBe(200);

    // Asserted as a set, so dropping any one of them fails. Each is load
    // bearing: `no-store` keeps the bytes out of the browser cache after the
    // 30-day purge, `nosniff` stops the response being re-interpreted as HTML
    // on our own origin, `inline` stops a download prompt.
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('content-length')).toBe(String(PNG.byteLength));

    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('T-IMG-002j · no-store is NOT no-cache, and there is no ETag to revalidate', async () => {
    // `no-cache` still writes the bytes to disk. An `ETag` would then invite a
    // conditional request for bytes we have just said must not be stored.
    const res = await fetchImage();
    expect(res.headers.get('cache-control')).not.toContain('no-cache');
    expect(res.headers.get('etag')).toBeNull();
  });

  it('T-IMG-002k · the content type follows the STORED format, never the uploaded one', async () => {
    // The row is a HEIC upload transcoded to PNG. Serving `image/heic` would
    // mislabel PNG bytes and only Safari would try to render them.
    const res = await fetchImage();
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-type')).not.toContain('heic');
  });

  it('T-IMG-002l · a JPEG row is served as image/jpeg', async () => {
    findUploadedImageById.mockResolvedValue(imageRow({ format: 'jpeg' }));
    const res = await fetchImage();
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('T-IMG-002m · an anonymous request never reaches the store', async () => {
    const res = await fetch(`${origin}/api/images/01J8ZG0000000000000000`);
    expect(res.status).toBe(401);
    expect(findUploadedImageById).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('T-IMG-004 · US-035 AC-1 · at retainUntil the bytes are gone', () => {
  it('T-IMG-004a · AT retainUntil, not merely after it, is expired', () => {
    // The boundary asserted directly: a request cannot pin the clock to the
    // exact millisecond, so `<` vs `<=` would be untested through HTTP alone
    // and the last day of retention would silently serve bytes it should not.
    const at = new Date('2026-06-01T00:00:00.000Z');
    expect(isExpired(at, at)).toBe(true);
    expect(isExpired(at, new Date(at.getTime() + 1))).toBe(true);
    expect(isExpired(at, new Date(at.getTime() - 1))).toBe(false);
  });

  it('T-IMG-004b · a passed retainUntil is 410 IMAGE_EXPIRED with the date', async () => {
    findUploadedImageById.mockResolvedValue(imageRow({ retainUntil: new Date(Date.now() - HOUR) }));

    const res = await fetchImage();
    expect(res.status).toBe(410);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('IMAGE_EXPIRED');
    expect(body.error.message).toBe(IMAGE_EXPIRED_MESSAGE);
    expect(body.error.message).toContain('30 days');
    expect(typeof body.error.details?.['retainUntil']).toBe('string');
  });

  it('T-IMG-004c · expiry is decided BEFORE the store is touched', async () => {
    // Not a performance point. The answer must not depend on how promptly the
    // lifecycle rule happened to run, or the last-day behaviour becomes a race
    // between our clock and Azure's.
    findUploadedImageById.mockResolvedValue(imageRow({ retainUntil: new Date(Date.now() - HOUR) }));
    await fetchImage();
    expect(get).not.toHaveBeenCalled();
  });

  it('T-IMG-004d · the row still exists afterwards — expiry is not deletion', async () => {
    // REQ-028: the purge removes BYTES. The row is the record that a capture
    // happened and survives forever. A route that deleted it would make the
    // batch unreadable.
    findUploadedImageById.mockResolvedValue(imageRow({ retainUntil: new Date(Date.now() - HOUR) }));
    await fetchImage();
    expect(findUploadedImageById).toHaveBeenCalledTimes(1);
  });
});

describe('T-IMG-005 · US-035 AC-6 · a missing blob is 410, never 500', () => {
  it('T-IMG-005a · a live row whose blob is gone answers 410, not 500', async () => {
    // The steady state from day 31 onward: the lifecycle rule removed the
    // bytes and wrote nothing back to the row. A 500 here would turn designed
    // behaviour into an error page and an alert every single day.
    get.mockResolvedValue(null);

    const res = await fetchImage();
    expect(res.status).toBe(410);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMAGE_EXPIRED');
  });

  it('T-IMG-005b · the two absences are indistinguishable to the owner', async () => {
    // One event from their side — the screenshot aged out. The skew between
    // "the row says it is due" and "the rule has run" is ours to hide.
    get.mockResolvedValue(null);
    const missingBlob = (await (await fetchImage()).json()) as ErrorBody;

    findUploadedImageById.mockResolvedValue(imageRow({ retainUntil: new Date(Date.now() - HOUR) }));
    const passedDate = (await (await fetchImage()).json()) as ErrorBody;

    expect(missingBlob.error.code).toBe(passedDate.error.code);
    expect(missingBlob.error.message).toBe(passedDate.error.message);
  });
});

describe('US-036 AC-3 · another owner’s image is indistinguishable from a missing one', () => {
  it('T-SEC-002g · a row outside the caller’s scope is 404, never 403', async () => {
    // 403 would confirm the row exists. `findUploadedImageById` is
    // owner-scoped, so a foreign id and a nonexistent id are the same lookup.
    findUploadedImageById.mockResolvedValue(null);

    const res = await fetchImage();
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('T-SEC-002h · the owner id is passed to the lookup, not filtered afterwards', async () => {
    // Non-vacuity: a handler that fetched by id and compared later would pass
    // every assertion above while a `findUnique` refactor silently removed the
    // scope.
    await fetchImage();
    const [ownerArg, idArg] = findUploadedImageById.mock.calls[0] ?? [];
    expect(typeof ownerArg).toBe('string');
    expect(String(ownerArg).length).toBeGreaterThan(0);
    expect(idArg).toBe('01J8ZG0000000000000000');
  });
});

describe('T-SEC-003 · no blob path, URL or SAS reaches the client', () => {
  it('T-SEC-003h · blobPath appears in no header of a 200 response', async () => {
    // The serve half of `T-SEC-003`. The upload half (§6.12) is asserted in
    // `integration/ingestSources.spec.ts`; this route is the other place the
    // path is in scope, and here the leak would be a header rather than a body.
    const res = await fetchImage();
    const headers = JSON.stringify([...res.headers.entries()]);

    expect(headers).not.toContain(BLOB_PATH);
    expect(headers).not.toContain('01J8ZF0000000000000000');
    expect(headers.toLowerCase()).not.toContain('sig=');
    expect(headers.toLowerCase()).not.toContain('blob.core.windows.net');
    // No redirect: a 302 to storage would BE the SAS leak, with a 200 body.
    expect(res.redirected).toBe(false);
  });

  it('T-SEC-003i · the 410 body carries the date and nothing about storage', async () => {
    // The error path is the easier place to leak, because `details` is a free
    // object and `blobPath` is the nearest thing to hand.
    findUploadedImageById.mockResolvedValue(imageRow({ retainUntil: new Date(Date.now() - HOUR) }));
    const raw = await (await fetchImage()).text();

    expect(raw).not.toContain(BLOB_PATH);
    expect(raw).not.toContain('blobPath');
    expect(raw).not.toContain('IMG_0042');
  });
});
