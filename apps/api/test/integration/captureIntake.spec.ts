import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, type CaptureIntakeStatus } from '@nextup/domain';
import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { asOwnerId, createUploadedImage, type OwnerId } from '../../src/repository/ownerData.js';
import {
  beginCaptureAttempt,
  finishCaptureAttempt,
  readCaptureIntake,
  resolveCaptureAttempt,
  withDraftCapture,
} from '../../src/services/captureIntake.js';
import { submitBatch } from '../../src/services/batchLifecycle.js';
import { reextractBatch } from '../../src/services/batchReextract.js';
import { imageBlobExists } from '../../src/storage/blobStore.js';
import {
  closeTestPrisma,
  resetDatabase,
  testPrisma,
  batchInput,
  titleInput,
  listingInput,
} from './harness.js';

const failure = vi.hoisted(() => ({
  onRefusal: 0,
  seen: 0,
  removeRow: false,
  beforeSubmit: async () => {},
}));
vi.mock('../../src/repository/ownerData.js', async (original) => {
  const actual = await original<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    createCaptureAttempt: async (...args: Parameters<typeof actual.createCaptureAttempt>) => {
      if (args[1].kind === 'local-refusal' && ++failure.seen === failure.onRefusal) {
        throw new Error('Injected intake write failure.');
      }
      return actual.createCaptureAttempt(...args);
    },
    deleteUploadedImage: async (...args: Parameters<typeof actual.deleteUploadedImage>) => {
      const result = await actual.deleteUploadedImage(...args);
      if (failure.removeRow) throw new Error('Injected failure after image-row deletion.');
      return result;
    },
    transitionUploadBatchStatus: async (
      ...args: Parameters<typeof actual.transitionUploadBatchStatus>
    ) => {
      if (args[3].status === 'submitted') await failure.beforeSubmit();
      return actual.transitionUploadBatchStatus(...args);
    },
  };
});

const SUBJECT = 'capture-intake-integration';
const principal = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: SUBJECT },
    ],
  }),
).toString('base64');
let server: Server;
let origin: string;
let owner: OwnerId;

async function request(path: string, method = 'GET', body?: unknown) {
  return fetch(`${origin}/api${path}`, {
    method,
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principal,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function capture(reports: unknown[] = [], tracked = true) {
  const response = await request('/batches', 'POST', {
    service: 'netflix',
    mode: 'full-update',
    ...(tracked ? { captureProtocol: 1 } : {}),
    selectionRefusals: reports,
  });
  expect(response.status).toBe(201);
  const body: { batchId: string } = await response.json();
  return body.batchId;
}

function png() {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, 1179);
  view.setUint32(20, 2556);
  return bytes.buffer;
}

async function upload(batchId: string, files: readonly { name: string; bytes: ArrayBuffer }[]) {
  const body = new FormData();
  for (const file of files) body.append('files', new Blob([file.bytes]), file.name);
  return fetch(`${origin}/api/batches/${batchId}/images`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principal },
    body,
  });
}

async function savedImage(batchId: string) {
  const response = await upload(batchId, [{ name: 'saved.png', bytes: png() }]);
  expect(response.status, await response.clone().text()).toBe(201);
  const body: { accepted: { imageId: string }[] } = await response.json();
  const id = body.accepted[0]?.imageId;
  if (!id) throw new Error('Upload did not return its image ID.');
  return id;
}

async function intake(batchId: string) {
  const response = await request(`/batches/${batchId}`);
  expect(response.status).toBe(200);
  const body: { intake: CaptureIntakeStatus } = await response.json();
  return body.intake;
}

beforeEach(async () => {
  failure.onRefusal = 0;
  failure.seen = 0;
  failure.removeRow = false;
  failure.beforeSubmit = async () => {};
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  resetAllowListWarning();
  await resetDatabase();
  server = createApp({ webRoot: 'nonexistent' }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await request('/me');
  const body: { ownerId: string } = await response.json();
  owner = asOwnerId(body.ownerId);
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});
afterAll(closeTestPrisma);

describe('Durable capture intake with SQL Server and Blob storage', () => {
  it('T-UX-164l: parser rejection and partial acceptance survive rereads and later successful input', async () => {
    const id = await capture();
    const oversized = await upload(id, [
      { name: 'large.png', bytes: new ArrayBuffer(MAX_IMAGE_BYTES + 32) },
    ]);
    expect(oversized.status).toBe(413);
    await oversized.json();
    let status = await intake(id);
    expect(status.complete).toBe(false);
    expect(status.attempts[0]?.state).toBe('incomplete');

    const partial = await upload(id, [
      { name: 'good.png', bytes: png() },
      { name: 'bad.png', bytes: new ArrayBuffer(4) },
    ]);
    expect(partial.status).toBe(201);
    const response: { accepted: { imageId: string }[]; rejected: unknown[] } = await partial.json();
    expect(response.accepted).toHaveLength(1);
    expect(response.rejected).toHaveLength(1);
    await savedImage(id);
    status = await intake(id);
    expect(status.unresolvedAttemptIds).toHaveLength(2);
    expect(
      status.attempts.find((attempt) =>
        attempt.acceptedImageIds.includes(response.accepted[0]?.imageId ?? ''),
      )?.state,
    ).toBe('incomplete');
    expect(await intake(id)).toEqual(status);
  });

  it('T-UX-164m: stable refusal reports are atomic and idempotent; explicit saved replacements survive expiry but not deletion', async () => {
    const report = { token: 'local-1', name: 'duplicate.gif', message: 'Unsupported format' };
    const id = await capture([report]);
    const replacement = await savedImage(id);
    expect(
      (await request(`/batches/${id}/intake-refusals`, 'POST', { refusals: [report] })).status,
    ).toBe(204);
    let status = await intake(id);
    expect(status.attempts.filter((attempt) => attempt.kind === 'local-refusal')).toHaveLength(1);
    const issue = status.unresolvedAttemptIds[0];
    if (!issue) throw new Error('Missing refusal.');
    const resolve = (ids: string[]) =>
      request(`/batches/${id}/intake/${issue}`, 'PATCH', { replacementImageIds: ids });
    expect((await resolve([replacement])).status).toBe(204);
    expect((await intake(id)).complete).toBe(true);
    await testPrisma().uploadedImage.update({
      where: { id: replacement },
      data: { retainUntil: new Date(0) },
    });
    expect((await intake(id)).complete).toBe(true);
    expect((await resolve([replacement])).status).toBe(400);
    expect((await request(`/batches/${id}/images/${replacement}`, 'DELETE')).status).toBe(204);
    status = await intake(id);
    expect(status.complete).toBe(false);
    expect(status.unresolvedAttemptIds).toContain(issue);
  });

  it('T-UX-164n: interrupted attempts can be explicitly superseded; late image rows and finalization roll back together', async () => {
    const id = await capture();
    const interrupted = await beginCaptureAttempt(owner, id);
    const replacement = await savedImage(id);
    await resolveCaptureAttempt(owner, id, interrupted.id, [replacement]);
    const original = await testPrisma().uploadedImage.findFirstOrThrow({
      where: { id: replacement },
    });
    await expect(
      withDraftCapture(owner, id, async (tx) => {
        await createUploadedImage(owner, { ...original, id: 'late-image' }, tx);
        await finishCaptureAttempt(owner, id, interrupted.id, ['late-image'], [], tx);
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await testPrisma().uploadedImage.findFirst({ where: { id: 'late-image' } })).toBeNull();
    expect((await intake(id)).complete).toBe(true);
    expect(
      (await testPrisma().captureIngestAttempt.findFirstOrThrow({ where: { id: interrupted.id } }))
        .state,
    ).toBe('resolved');
  });

  it('T-UX-164o: submitting seals input; a later upload cannot commit images or clear its uncertainty', async () => {
    const id = await capture();
    const existing = await savedImage(id);
    const interrupted = await beginCaptureAttempt(owner, id);
    await submitBatch(owner, id);
    const row = await testPrisma().uploadedImage.findFirstOrThrow({ where: { id: existing } });
    await expect(
      withDraftCapture(owner, id, async (tx) => {
        await createUploadedImage(owner, { ...row, id: 'late' }, tx);
        await finishCaptureAttempt(owner, id, interrupted.id, ['late'], [], tx);
      }),
    ).rejects.toMatchObject({ code: 'BATCH_NOT_DRAFT' });
    expect(await testPrisma().uploadedImage.count({ where: { batchId: id } })).toBe(1);
    expect((await intake(id)).complete).toBe(false);
    await expect(
      resolveCaptureAttempt(owner, id, interrupted.id, [existing]),
    ).rejects.toMatchObject({ code: 'BATCH_NOT_DRAFT' });
  });

  it('T-UX-164p: replacement and refusal operations cannot cross owner or batch boundaries', async () => {
    const id = await capture([{ token: 'scope', name: 'bad.gif', message: 'Unsupported' }]);
    const replacement = await savedImage(id);
    const issue = (await intake(id)).unresolvedAttemptIds[0];
    if (!issue) throw new Error('Missing issue.');
    await expect(
      resolveCaptureAttempt(asOwnerId('foreign'), id, issue, [replacement]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = await testPrisma().uploadBatch.create({
      data: { ...batchInput({ status: 'applied' }), ownerId: owner },
    });
    const original = await testPrisma().uploadedImage.findFirstOrThrow({
      where: { id: replacement },
    });
    await testPrisma().uploadedImage.create({
      data: { ...original, id: 'different-batch', batchId: other.id },
    });
    await expect(
      resolveCaptureAttempt(owner, id, issue, ['different-batch']),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(
      (
        await request(`/batches/${other.id}/intake/${issue}`, 'PATCH', {
          replacementImageIds: [replacement],
        })
      ).status,
    ).toBe(409);
    expect(
      (await request('/batches/foreign/intake-refusals', 'POST', { refusals: [] })).status,
    ).toBe(404);
    expect((await intake(id)).complete).toBe(false);
  });

  it('T-UX-164q: missing input withholds removals despite sufficient extraction; explicit resolution restores one-service removal eligibility', async () => {
    for (const resolved of [false, true]) {
      await resetDatabase();
      const baseline = await testPrisma().uploadBatch.create({
        data: { ...batchInput({ status: 'applied' }), ownerId: owner },
      });
      const title = await testPrisma().title.create({
        data: {
          ...titleInput(),
          ownerId: owner,
          createdByBatchId: baseline.id,
          tmdbName: 'Existing title',
        },
      });
      const netflix = await testPrisma().serviceListing.create({
        data: { ...listingInput(title.id, baseline.id), ownerId: owner },
      });
      await testPrisma().serviceListing.create({
        data: { ...listingInput(title.id, baseline.id, { service: 'max' }), ownerId: owner },
      });
      const id = await capture([
        { token: 'missing', name: 'missing.png', message: 'Upload failed' },
      ]);
      const sourceImage = await savedImage(id);
      if (resolved) {
        const issueId = (await intake(id)).unresolvedAttemptIds[0];
        if (!issueId) throw new Error('Missing refusal.');
        await resolveCaptureAttempt(owner, id, issueId, [sourceImage]);
      }
      for (let index = 0; index < 20; index += 1) {
        const candidateId = `capture-candidate-${index}`;
        await testPrisma().extractionCandidate.create({
          data: {
            id: candidateId,
            ownerId: owner,
            batchId: id,
            rawText: `Read title ${index}`,
            normalisedText: `read title ${index}`,
            basis: 'both',
            ocrSupport: 'exact',
            provider: 'llm',
            boxSource: 'llm',
            cleanupVerdict: 'title-candidate',
            resolvedWorkIdentity: `unmatched:read-${index}`,
            classification: 'new',
            reviewDisposition: 'confirmed',
          },
        });
        await testPrisma().candidateSourceImage.create({
          data: { ownerId: owner, candidateId, imageId: sourceImage, ordinal: 0 },
        });
      }
      await testPrisma().uploadedImage.update({
        where: { id: sourceImage },
        data: { candidateCount: 20 },
      });
      await testPrisma().uploadBatch.update({
        where: { id },
        data: { status: 'in-review', lowYield: false, crossCheck: 'ok' },
      });
      const review: {
        sections: { removals: { withheld: boolean; withheldReason: string; items: unknown[] } };
      } = await (await request(`/batches/${id}/review`)).json();
      expect(review.sections.removals.withheld).toBe(!resolved);
      expect(review.sections.removals.items).toHaveLength(resolved ? 1 : 0);
      if (!resolved) expect(review.sections.removals.withheldReason).toBe('incomplete-capture');
      expect(
        (
          await request(`/batches/${id}/removals`, 'PATCH', {
            tick: [netflix.listingId],
            untick: [],
          })
        ).status,
      ).toBe(resolved ? 200 : 400);
      const close = await request(`/batches/${id}/close`, 'POST', { confirmRemovals: true });
      expect(close.status).toBe(200);
      const outcome: {
        summary: {
          listingsCreated: number;
          listingsRemoved: number;
          removalGroupId: string | null;
        };
      } = await close.json();
      expect(outcome.summary).toMatchObject({
        listingsCreated: 20,
        listingsRemoved: resolved ? 1 : 0,
      });
      if (resolved) expect(outcome.summary.removalGroupId).not.toBeNull();
      else expect(outcome.summary.removalGroupId).toBeNull();
      expect(
        await testPrisma().serviceListing.count({
          where: { ownerId: owner, titleId: title.id, state: 'active' },
        }),
      ).toBe(resolved ? 1 : 2);
      expect(
        await testPrisma().serviceListing.count({
          where: { ownerId: owner, titleId: title.id, service: 'max', state: 'active' },
        }),
      ).toBe(1);
      expect(await testPrisma().removalGroup.count({ where: { batchId: id } })).toBe(
        resolved ? 1 : 0,
      );
    }
  });

  it('T-UX-164aa: interrupted blob-first deletion retains uncertainty after SQL rollback; retry and explicit replacement recover it', async () => {
    const id = await capture([{ token: 'missing', name: 'bad.png', message: 'Failed input' }]);
    const imageId = await savedImage(id);
    const issueId = (await intake(id)).unresolvedAttemptIds[0];
    if (!issueId) throw new Error('Missing refusal.');
    await resolveCaptureAttempt(owner, id, issueId, [imageId]);
    const image = await testPrisma().uploadedImage.findUniqueOrThrow({ where: { id: imageId } });
    failure.removeRow = true;
    const failed = await request(`/batches/${id}/images/${imageId}`, 'DELETE');
    expect(failed.status).toBe(500);
    await failed.json();
    expect(await imageBlobExists(image.blobPath)).toBe(false);
    expect(await testPrisma().uploadedImage.findUnique({ where: { id: imageId } })).not.toBeNull();
    expect((await intake(id)).complete).toBe(false);
    await expect(resolveCaptureAttempt(owner, id, issueId, [imageId])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    failure.removeRow = false;
    expect((await request(`/batches/${id}/images/${imageId}`, 'DELETE')).status).toBe(204);
    expect((await intake(id)).unresolvedAttemptIds).toEqual([issueId]);
    const replacement = await savedImage(id);
    expect((await intake(id)).complete).toBe(false);
    await resolveCaptureAttempt(owner, id, issueId, [replacement]);
    expect((await intake(id)).complete).toBe(true);
  });

  it('T-UX-164ab: a concurrent upload finalized before the submit seal is included in the sealed image snapshot', async () => {
    const id = await capture();
    const existing = await savedImage(id);
    const pending = await beginCaptureAttempt(owner, id);
    let reached!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    failure.beforeSubmit = async () => {
      reached();
      await resume;
    };
    const submitted = submitBatch(owner, id);
    try {
      await waiting;
      const image = await testPrisma().uploadedImage.findUniqueOrThrow({ where: { id: existing } });
      await withDraftCapture(owner, id, async (tx) => {
        await createUploadedImage(owner, { ...image, id: 'concurrent-image' }, tx);
        await finishCaptureAttempt(owner, id, pending.id, ['concurrent-image'], [], tx);
      });
    } finally {
      release();
    }
    expect((await submitted).imageCount).toBe(2);
    expect((await intake(id)).complete).toBe(true);
    await expect(beginCaptureAttempt(owner, id)).rejects.toMatchObject({ code: 'BATCH_NOT_DRAFT' });
  });

  it('T-UX-164r: legacy captures and incomplete derived captures retain uncertainty without mutating the source', async () => {
    for (const tracked of [false, true]) {
      await resetDatabase();
      const id = await capture(
        tracked ? [{ token: 'failed-source', name: 'bad.png', message: 'Failed input' }] : [],
        tracked,
      );
      await savedImage(id);
      const source = await testPrisma().uploadBatch.update({
        where: { id },
        data: { status: 'discarded' },
      });
      expect((await readCaptureIntake(owner, source)).complete).toBe(false);
      const derived = await reextractBatch(owner, id);
      const row = await testPrisma().uploadBatch.findFirstOrThrow({
        where: { id: derived.batchId },
      });
      expect(row.captureTracking).toBe('inherited-incomplete');
      expect((await readCaptureIntake(owner, row)).complete).toBe(false);
      expect(await testPrisma().uploadBatch.findFirstOrThrow({ where: { id } })).toEqual(source);
      const images = await testPrisma().uploadedImage.findMany({
        where: { batchId: { in: [id, derived.batchId] } },
      });
      expect(images).toHaveLength(2);
      expect(images[0]?.retainUntil).toEqual(images[1]?.retainUntil);
    }
  });

  it('T-UX-164s: SQL rejects malformed evidence and duplicate report tokens; failed creation rolls back its batch', async () => {
    const id = await capture();
    const row = await beginCaptureAttempt(owner, id);
    await expect(
      testPrisma().captureIngestAttempt.update({ where: { id: row.id }, data: { failures: '{}' } }),
    ).rejects.toThrow();
    await expect(
      testPrisma().captureIngestAttempt.update({
        where: { id: row.id },
        data: { state: 'ignored' },
      }),
    ).rejects.toThrow();
    await expect(
      testPrisma().captureIngestAttempt.create({ data: { ...row, id: 'duplicate' } }),
    ).rejects.toThrow();
    await testPrisma().uploadBatch.update({ where: { id }, data: { status: 'discarded' } });
    const invalid = await request('/batches', 'POST', {
      service: 'netflix',
      mode: 'full-update',
      captureProtocol: 1,
      selectionRefusals: [
        { token: 'same', name: 'a', message: 'b' },
        { token: 'same', name: 'a', message: 'b' },
      ],
    });
    expect(invalid.status).toBe(400);
    expect(await testPrisma().uploadBatch.count({ where: { ownerId: owner } })).toBe(1);
    failure.onRefusal = 2;
    const failed = await request('/batches', 'POST', {
      service: 'netflix',
      mode: 'full-update',
      captureProtocol: 1,
      selectionRefusals: [
        { token: 'first', name: 'first.gif', message: 'Unsupported' },
        { token: 'second', name: 'second.gif', message: 'Unsupported' },
      ],
    });
    expect(failed.status).toBe(500);
    await failed.json();
    expect(await testPrisma().uploadBatch.count({ where: { ownerId: owner } })).toBe(1);
    expect(await testPrisma().captureIngestAttempt.count()).toBe(1);
  });
});
