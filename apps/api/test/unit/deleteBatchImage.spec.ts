/**
 * `DELETE /api/batches/:batchId/images/:imageId` — the sanctioned I-7
 * hard-delete exemption (TASK-051, `specs/api.md` §6.13, US-004 AC-4).
 *
 * Driven over real HTTP with the repository and the blob store mocked, in the
 * shape `batchImagesRoute.spec.ts` established. Unit rather than integration
 * for the same reason recorded there: `npm run coverage` scores only the
 * `unit` and `web` projects, so a route proven only in integration scores ~0
 * against the `apps/api/src/**` floor.
 *
 * ⚠ THE POINT OF THIS ENDPOINT IS THE THING IT IS FORBIDDEN TO DO. REQ-028 is
 * soft-delete-forever; this is the ONE place owner data is hard-deleted, and
 * the whole justification is that a draft batch is not yet part of the record.
 * So the tests that matter most here are the negative ones: that the delete
 * does NOT happen once the batch leaves `draft`, and that it does not happen
 * across a batch boundary. `T-INV-012` in `tests/infra/hardDelete.spec.ts`
 * guards the other half - that no SECOND such call site appears.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUploadBatch = vi.fn();
const findUploadedImage = vi.fn();
const deleteUploadedImage = vi.fn();

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (...args: unknown[]) => findUploadBatch(...args) as unknown,
    findUploadedImage: (...args: unknown[]) => findUploadedImage(...args) as unknown,
    deleteUploadedImage: (...args: unknown[]) => deleteUploadedImage(...args) as unknown,
  };
});

const remove = vi.fn(() => Promise.resolve());
vi.mock('../../src/storage/blobStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/storage/blobStore.js')>();
  return {
    ...actual,
    azureImageBlobStore: {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(null),
      remove: (...args: unknown[]) => remove(...(args as [])) as unknown,
    },
  };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-image-delete';

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

let server: Server;
let app: Express;
let origin: string;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

function deleteImage(batchId = 'batch-1', imageId = 'img-1'): Promise<Response> {
  return fetch(`${origin}/api/batches/${batchId}/images/${imageId}`, {
    method: 'DELETE',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;

  findUploadBatch.mockResolvedValue({ id: 'batch-1', status: 'draft', service: 'netflix' });
  findUploadedImage.mockResolvedValue({
    id: 'img-1',
    batchId: 'batch-1',
    blobPath: 'owner/batch-1/img-1.png',
    fileName: 'IMG_0421.PNG',
  });
  deleteUploadedImage.mockResolvedValue(1);
  remove.mockImplementation(() => Promise.resolve());

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('T-IMG-006 - deleting a pre-submit draft image', () => {
  it('T-IMG-006g - 204, and both the blob and the row are gone', async () => {
    const res = await deleteImage();

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(remove).toHaveBeenCalledWith('owner/batch-1/img-1.png');
    expect(deleteUploadedImage).toHaveBeenCalledTimes(1);
  });

  it('T-IMG-006h - removes the BLOB before the ROW', async () => {
    // Order, not just occurrence. The reverse orphans bytes forever: once the
    // row is gone nothing names the `blobPath`, so a failed blob delete leaves
    // an unreferenced screenshot only the 30-day lifecycle purge will reach.
    const calls: string[] = [];
    remove.mockImplementation(() => {
      calls.push('blob');
      return Promise.resolve();
    });
    deleteUploadedImage.mockImplementation(() => {
      calls.push('row');
      return Promise.resolve(1);
    });

    await deleteImage();

    expect(calls).toEqual(['blob', 'row']);
  });

  it('T-IMG-006i - a failed blob delete leaves the row in place', async () => {
    // The consequence of that order, and the one that has to hold: a 5xx here
    // must leave something that still names the blob, so a retry can finish
    // the job. Deleting the row anyway would strand the bytes.
    remove.mockRejectedValue(new Error('blob service unavailable'));

    const res = await deleteImage();

    expect(res.status).toBe(500);
    expect(deleteUploadedImage).not.toHaveBeenCalled();
  });
});

describe('T-INV-012 - the exemption is scoped, and nothing else is deletable', () => {
  it.each([
    ['submitted', 'submitted'],
    ['extracting', 'extracting'],
    ['in-review', 'in-review'],
    ['applied', 'applied'],
    ['extraction-failed', 'extraction-failed'],
  ])('T-INV-012a - a %s batch refuses with 409 and deletes nothing', async (_label, status) => {
    // ⚠ THE LOAD-BEARING CASE. `draft` is the entire justification for the
    // exemption; every other status makes the image evidence for candidates
    // that were reviewed and changes that were applied.
    findUploadBatch.mockResolvedValue({ id: 'batch-1', status, service: 'netflix' });

    const res = await deleteImage();
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('BATCH_NOT_DRAFT');
    expect(remove).not.toHaveBeenCalled();
    expect(deleteUploadedImage).not.toHaveBeenCalled();
  });

  it('T-INV-012b - the draft check runs BEFORE the image lookup', async () => {
    // Otherwise a submitted batch answers 404 for an id that does not exist
    // and 409 for one that does, which tells a caller who may no longer touch
    // the batch exactly which image ids it holds.
    findUploadBatch.mockResolvedValue({ id: 'batch-1', status: 'applied', service: 'netflix' });

    const res = await deleteImage();

    expect(res.status).toBe(409);
    expect(findUploadedImage).not.toHaveBeenCalled();
  });

  it('T-INV-012c - an image in a DIFFERENT batch is a 404, not a delete', async () => {
    // `findUploadedImage` is scoped by `batchId` as well as `imageId`, so a
    // stale client page cannot delete out of a batch it is not looking at.
    findUploadedImage.mockResolvedValue(null);

    const res = await deleteImage('batch-1', 'img-from-another-batch');

    expect(res.status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
    expect(deleteUploadedImage).not.toHaveBeenCalled();
  });

  it('T-INV-012d - a missing batch is a 404 and never reaches the image', async () => {
    findUploadBatch.mockResolvedValue(null);

    const res = await deleteImage('no-such-batch');

    expect(res.status).toBe(404);
    expect(findUploadedImage).not.toHaveBeenCalled();
    expect(deleteUploadedImage).not.toHaveBeenCalled();
  });

  it('T-INV-012e - the batch id from the path is the one queried', async () => {
    // Non-vacuity for `c`: a handler that ignored `:batchId` entirely would
    // satisfy every case above, because the mock answers regardless.
    await deleteImage('batch-9', 'img-4');

    expect(findUploadBatch).toHaveBeenCalledWith(expect.anything(), 'batch-9');
    expect(findUploadedImage).toHaveBeenCalledWith(expect.anything(), 'batch-9', 'img-4');
  });
});
