import type { CaptureIngestAttempt, UploadedImage } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwnerId } from '../../src/repository/ownerData.js';
import { AppError } from '../../src/errors/AppError.js';

const store = vi.hoisted(() => {
  const attempts: CaptureIngestAttempt[] = [];
  const images: UploadedImage[] = [];
  return {
    attempts,
    images,
    present: true,
    status: 'draft',
    tx: { testTransaction: true },
    writes: [] as unknown[],
  };
});

vi.mock('../../src/repository/ownerData.js', async (original) => ({
  ...(await original<typeof import('../../src/repository/ownerData.js')>()),
  runInTransaction: async <T>(work: (tx: typeof store.tx) => Promise<T>) => work(store.tx),
  lockDraftUploadBatch: async (owner: string, id: string) => ({
    count: owner === 'owner' && id === 'batch' && store.present && store.status === 'draft' ? 1 : 0,
  }),
  findUploadBatch: async (owner: string, id: string) =>
    owner === 'owner' && id === 'batch' && store.present
      ? { id, status: store.status, captureTracking: 'tracked' }
      : null,
  findUploadedImage: async (owner: string, batch: string, id: string) =>
    store.images.find(
      (image) => image.ownerId === owner && image.batchId === batch && image.id === id,
    ) ?? null,
  listImagesForBatch: async (owner: string, batch: string) =>
    store.images.filter((image) => image.ownerId === owner && image.batchId === batch),
  listCaptureAttempts: async (owner: string, batch: string) =>
    store.attempts.filter((attempt) => attempt.ownerId === owner && attempt.batchId === batch),
  createCaptureAttempt: async (
    ownerId: string,
    data: {
      id: string;
      batchId: string;
      clientToken: string;
      kind: string;
      state: string;
      failures: string;
      acceptedImageIds: string;
      replacementImageIds: string;
      completedAt?: Date;
    },
    tx: unknown,
  ) => {
    store.writes.push(tx);
    const row: CaptureIngestAttempt = {
      ...data,
      ownerId,
      startedAt: new Date(),
      completedAt: data.completedAt ?? null,
      resolvedAt: null,
    };
    store.attempts.push(row);
    return row;
  },
  updateCaptureAttempt: async (
    owner: string,
    batch: string,
    id: string,
    states: string[],
    data: Partial<CaptureIngestAttempt>,
    tx: unknown,
  ) => {
    store.writes.push(tx);
    const row = store.attempts.find(
      (attempt) =>
        attempt.ownerId === owner &&
        attempt.batchId === batch &&
        attempt.id === id &&
        states.includes(attempt.state),
    );
    if (!row) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  },
}));

const exists = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../src/storage/blobStore.js', () => ({ imageBlobExists: exists }));

const {
  beginCaptureAttempt,
  beginImageRemoval,
  failCaptureAttempt,
  finishCaptureAttempt,
  finishImageRemovals,
  parseSelectionRefusals,
  readCaptureIntake,
  resolveCaptureAttempt,
  saveSelectionRefusals,
  withDraftCapture,
} = await import('../../src/services/captureIntake.js');

const OWNER = asOwnerId('owner');
const batch = { id: 'batch', captureTracking: 'tracked' };
const NOW = new Date('2026-09-20T12:00:00Z');

function image(id = 'saved', overrides: Partial<UploadedImage> = {}): UploadedImage {
  return {
    id,
    ownerId: OWNER,
    batchId: 'batch',
    blobPath: `owner/batch/${id}.png`,
    fileName: `${id}.png`,
    ingestSource: 'upload',
    uploadedFormat: 'png',
    format: 'png',
    byteSize: 1n,
    uploadedByteSize: 1n,
    width: 1,
    height: 1,
    candidateCount: null,
    uploadedAt: new Date('2026-09-01'),
    retainUntil: new Date('2099-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  store.attempts.length = 0;
  store.images.length = 0;
  store.writes.length = 0;
  store.present = true;
  store.status = 'draft';
  exists.mockReset().mockResolvedValue(true);
});

describe('Persisted capture intake service', () => {
  it('T-UX-164h: admission, completion and failure preserve evidence without downgrading resolved outcomes', async () => {
    const first = await beginCaptureAttempt(OWNER, 'batch');
    expect(first.state).toBe('receiving');
    expect((await readCaptureIntake(OWNER, batch)).complete).toBe(false);
    await withDraftCapture(OWNER, 'batch', (tx) =>
      finishCaptureAttempt(OWNER, 'batch', first.id, ['saved'], [], tx),
    );
    expect(first.state).toBe('complete');
    await failCaptureAttempt(OWNER, 'batch', first.id, new Error('response lost'));
    expect(first.state).toBe('complete');
    expect((await readCaptureIntake(OWNER, batch)).complete).toBe(true);

    const failed = await beginCaptureAttempt(OWNER, 'batch');
    await failCaptureAttempt(
      OWNER,
      'batch',
      failed.id,
      new AppError('IMAGE_DECODE_OOM', 503, 'Memory limit reached.'),
    );
    expect(failed.failures).toContain('Memory limit');
    const interrupted = await beginCaptureAttempt(OWNER, 'batch');
    await failCaptureAttempt(OWNER, 'batch', interrupted.id, new Error('private diagnostic'));
    expect(interrupted.failures).not.toContain('private diagnostic');
    expect((await readCaptureIntake(OWNER, batch)).unresolvedAttemptIds).toEqual([
      failed.id,
      interrupted.id,
    ]);

    const partial = await beginCaptureAttempt(OWNER, 'batch');
    await withDraftCapture(OWNER, 'batch', (tx) =>
      finishCaptureAttempt(
        OWNER,
        'batch',
        partial.id,
        ['saved'],
        [{ name: 'bad.png', message: 'Unreadable' }],
        tx,
      ),
    );
    expect(partial.state).toBe('incomplete');
    expect(partial.acceptedImageIds).toBe('["saved"]');
    store.images.push(image());
    await resolveCaptureAttempt(OWNER, 'batch', partial.id, ['saved'], NOW);
    expect(partial.failures).toContain('bad.png');
    await expect(
      withDraftCapture(OWNER, 'batch', (tx) =>
        finishCaptureAttempt(OWNER, 'batch', partial.id, ['late'], [], tx),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await failCaptureAttempt(OWNER, 'batch', partial.id, new Error('late response'));
    expect(partial.state).toBe('resolved');
    expect(store.writes.some((tx) => tx === store.tx)).toBe(true);
  });

  it('T-UX-164i: replacements require draft ownership and available same-batch images; deletion remains unresolved until finished', async () => {
    const attempt = await beginCaptureAttempt(OWNER, 'batch');
    await expect(
      resolveCaptureAttempt(asOwnerId('other'), 'batch', attempt.id, ['saved'], NOW),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      resolveCaptureAttempt(OWNER, 'other-batch', attempt.id, ['saved'], NOW),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      resolveCaptureAttempt(OWNER, 'batch', 'missing', ['saved'], NOW),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const invalid of [
      null,
      [],
      ['x', 'x'],
      [1],
      Array.from({ length: 41 }, (_, i) => `i-${i}`),
    ]) {
      await expect(
        resolveCaptureAttempt(OWNER, 'batch', attempt.id, invalid, NOW),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    store.images.push(
      image(),
      image('expired', { retainUntil: NOW }),
      image('foreign', { ownerId: 'other' }),
      image('other-batch', { batchId: 'other' }),
    );
    for (const id of ['absent', 'expired', 'foreign', 'other-batch']) {
      await expect(
        resolveCaptureAttempt(OWNER, 'batch', attempt.id, [id], NOW),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    exists.mockResolvedValueOnce(false);
    await expect(
      resolveCaptureAttempt(OWNER, 'batch', attempt.id, ['saved'], NOW),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const removing = await beginImageRemoval(OWNER, 'batch', 'saved');
    await expect(
      resolveCaptureAttempt(OWNER, 'batch', removing.id, ['saved'], NOW),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      resolveCaptureAttempt(OWNER, 'batch', attempt.id, ['saved'], NOW),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(beginImageRemoval(OWNER, 'batch', 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await withDraftCapture(OWNER, 'batch', (tx) =>
      finishImageRemovals(OWNER, 'batch', 'saved', tx),
    );
    expect(removing.state).toBe('complete');
    await resolveCaptureAttempt(OWNER, 'batch', attempt.id, ['saved'], NOW);
    expect((await readCaptureIntake(OWNER, batch)).complete).toBe(true);
    store.images.splice(0, 1);
    expect((await readCaptureIntake(OWNER, batch)).complete).toBe(false);

    const completed = await beginCaptureAttempt(OWNER, 'batch');
    await withDraftCapture(OWNER, 'batch', (tx) =>
      finishCaptureAttempt(OWNER, 'batch', completed.id, ['new'], [], tx),
    );
    store.images.push(image('new'));
    await expect(
      resolveCaptureAttempt(OWNER, 'batch', completed.id, ['new'], NOW),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    store.status = 'submitted';
    await expect(beginCaptureAttempt(OWNER, 'batch')).rejects.toMatchObject({
      code: 'BATCH_NOT_DRAFT',
    });
    store.present = false;
    await expect(beginCaptureAttempt(OWNER, 'batch')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('T-UX-164j: refusal reports validate and deduplicate stable tokens without erasing their original meaning', async () => {
    expect(parseSelectionRefusals(undefined)).toEqual([]);
    for (const invalid of [
      null,
      {},
      Array(101).fill({}),
      [null],
      [{}],
      [{ token: '!', name: 'a', message: 'bad' }],
      [{ token: 'a', name: 3, message: 'bad' }],
      [{ token: 'a', name: 'a', message: 3 }],
      [{ token: 'a', name: 'a'.repeat(256), message: 'bad' }],
      [{ token: 'a', name: 'a', message: 'b'.repeat(2001) }],
      [
        { token: 'a', name: 'a', message: 'bad' },
        { token: 'a', name: 'a', message: 'bad' },
      ],
    ]) {
      expect(() => parseSelectionRefusals(invalid)).toThrow();
    }
    const reports = parseSelectionRefusals([
      { token: 'client-1', name: 'bad.gif', message: 'Unsupported format' },
    ]);
    await withDraftCapture(OWNER, 'batch', (tx) =>
      saveSelectionRefusals(OWNER, 'batch', reports, tx),
    );
    await withDraftCapture(OWNER, 'batch', (tx) =>
      saveSelectionRefusals(OWNER, 'batch', reports, tx),
    );
    expect(store.attempts).toHaveLength(1);
    await expect(
      withDraftCapture(OWNER, 'batch', (tx) =>
        saveSelectionRefusals(
          OWNER,
          'batch',
          [{ token: 'client-1', name: 'other', message: 'bad' }],
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const upload = await beginCaptureAttempt(OWNER, 'batch');
    await expect(
      withDraftCapture(OWNER, 'batch', (tx) =>
        saveSelectionRefusals(
          OWNER,
          'batch',
          [{ token: upload.clientToken, name: 'other', message: 'bad' }],
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('T-UX-164k: malformed persisted evidence fails explicitly and legacy/derived origins never become complete', async () => {
    for (const origin of ['unverified', 'inherited-incomplete']) {
      expect((await readCaptureIntake(OWNER, { ...batch, captureTracking: origin })).complete).toBe(
        false,
      );
    }
    await expect(readCaptureIntake(OWNER, { ...batch, captureTracking: 'bad' })).rejects.toThrow(
      'evidence is invalid',
    );
    const attempt = await beginCaptureAttempt(OWNER, 'batch');
    attempt.state = 'bad';
    await expect(readCaptureIntake(OWNER, batch)).rejects.toThrow('evidence is invalid');
    attempt.state = 'resolved';
    for (const invalid of ['{', '{}', '[1]', '[""]']) {
      attempt.replacementImageIds = invalid;
      await expect(readCaptureIntake(OWNER, batch)).rejects.toThrow();
    }
    attempt.replacementImageIds = '[]';
    for (const invalid of [
      '{}',
      '[null]',
      '[{}]',
      '[{"name":1,"message":"bad"}]',
      '[{"name":"a","message":1}]',
    ]) {
      attempt.failures = invalid;
      await expect(readCaptureIntake(OWNER, batch)).rejects.toThrow('evidence is invalid');
    }
    attempt.failures = '[]';
    attempt.acceptedImageIds = '{}';
    await expect(readCaptureIntake(OWNER, batch)).rejects.toThrow('evidence is invalid');
  });
});
