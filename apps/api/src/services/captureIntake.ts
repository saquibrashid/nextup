import {
  assessCaptureIntake,
  ulid,
  type CaptureAttemptEvidence,
  type CaptureTrackingOrigin,
  type CaptureSelectionRefusal,
} from '@nextup/domain';
import type { CaptureIngestAttempt } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { imageBlobExists } from '../storage/blobStore.js';
import {
  createCaptureAttempt,
  findUploadBatch,
  findUploadedImage,
  listCaptureAttempts,
  listImagesForBatch,
  lockDraftUploadBatch,
  runInTransaction,
  updateCaptureAttempt,
  type Db,
  type OwnerId,
} from '../repository/ownerData.js';

export interface CaptureFailure {
  name: string;
  message: string;
  code?: string;
}

export type SelectionRefusal = CaptureSelectionRefusal;

function invalidEvidence(): never {
  throw new Error('Saved capture intake evidence is invalid.');
}

function stringIds(json: string): string[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || !value.every((id: unknown) => typeof id === 'string' && id !== '')) {
    return invalidEvidence();
  }
  return value;
}

function failures(json: string): CaptureFailure[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return invalidEvidence();
  return value.map((item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !('message' in item) ||
      typeof item.message !== 'string' ||
      ('code' in item && typeof item.code !== 'string')
    )
      return invalidEvidence();
    return {
      name: item.name,
      message: item.message,
      ...('code' in item && typeof item.code === 'string' ? { code: item.code } : {}),
    };
  });
}

function trackingOrigin(value: string): CaptureTrackingOrigin {
  if (value === 'tracked' || value === 'unverified' || value === 'inherited-incomplete')
    return value;
  return invalidEvidence();
}

function evidence(row: CaptureIngestAttempt): CaptureAttemptEvidence {
  const state = row.state;
  if (state === 'resolved') {
    return { id: row.id, state, replacementImageIds: stringIds(row.replacementImageIds) };
  }
  if (state === 'receiving' || state === 'complete' || state === 'incomplete') {
    return { id: row.id, state };
  }
  return invalidEvidence();
}

export async function readCaptureIntake(
  ownerId: OwnerId,
  batch: { id: string; captureTracking: string },
  tx?: Db,
) {
  const [attempts, images] = await Promise.all([
    listCaptureAttempts(ownerId, batch.id, tx),
    listImagesForBatch(ownerId, batch.id, tx),
  ]);
  const origin = trackingOrigin(batch.captureTracking);
  const assessment = assessCaptureIntake(
    origin,
    attempts.map(evidence),
    new Set(images.map((i) => i.id)),
  );
  return {
    ...assessment,
    origin,
    attempts: attempts.map((row) => ({
      id: row.id,
      token: row.clientToken,
      kind: row.kind,
      state: row.state,
      failures: failures(row.failures),
      acceptedImageIds: stringIds(row.acceptedImageIds),
      replacementImageIds: stringIds(row.replacementImageIds),
    })),
  };
}

export async function withDraftCapture<T>(
  ownerId: OwnerId,
  batchId: string,
  work: (tx: Db) => Promise<T>,
): Promise<T> {
  return runInTransaction(async (tx) => {
    const locked = await lockDraftUploadBatch(ownerId, batchId, tx);
    if (locked.count === 0) {
      const batch = await findUploadBatch(ownerId, batchId, tx);
      if (batch === null) throw new AppError('NOT_FOUND', 404, 'No such batch.');
      throw new AppError('BATCH_NOT_DRAFT', 409, 'This batch is no longer a draft.', {
        status: batch.status,
      });
    }
    return work(tx);
  });
}

export async function beginCaptureAttempt(ownerId: OwnerId, batchId: string) {
  return withDraftCapture(ownerId, batchId, (tx) => {
    const id = ulid();
    return createCaptureAttempt(
      ownerId,
      {
        id,
        batchId,
        clientToken: id,
        kind: 'upload',
        state: 'receiving',
        failures: '[]',
        acceptedImageIds: '[]',
        replacementImageIds: '[]',
      },
      tx,
    );
  });
}

export async function finishCaptureAttempt(
  ownerId: OwnerId,
  batchId: string,
  id: string,
  acceptedImageIds: string[],
  rejected: CaptureFailure[],
  tx: Db,
) {
  const changed = await updateCaptureAttempt(
    ownerId,
    batchId,
    id,
    ['receiving'],
    {
      state: rejected.length === 0 ? 'complete' : 'incomplete',
      failures: JSON.stringify(rejected),
      acceptedImageIds: JSON.stringify(acceptedImageIds),
      completedAt: new Date(),
    },
    tx,
  );
  if (changed.count !== 1) {
    throw new AppError(
      'VALIDATION_FAILED',
      409,
      'This upload was already resolved. Check the saved screenshots before retrying.',
    );
  }
}

export async function failCaptureAttempt(
  ownerId: OwnerId,
  batchId: string,
  id: string,
  error: unknown,
) {
  await updateCaptureAttempt(ownerId, batchId, id, ['receiving'], {
    state: 'incomplete',
    failures: JSON.stringify([
      {
        name: 'Screenshot operation',
        ...(error instanceof AppError ? { code: error.code } : {}),
        message:
          error instanceof AppError
            ? error.message
            : 'The upload did not finish. Check the saved screenshots.',
      },
    ]),
    completedAt: new Date(),
  });
}

export async function beginImageRemoval(ownerId: OwnerId, batchId: string, imageId: string) {
  return withDraftCapture(ownerId, batchId, async (tx) => {
    const image = await findUploadedImage(ownerId, batchId, imageId, tx);
    if (!image) throw new AppError('NOT_FOUND', 404, 'No such screenshot.');
    const id = ulid();
    return createCaptureAttempt(
      ownerId,
      {
        id,
        batchId,
        clientToken: id,
        kind: 'image-removal',
        state: 'receiving',
        failures: JSON.stringify([
          { name: image.fileName, message: 'Screenshot removal has not finished.' },
        ]),
        acceptedImageIds: JSON.stringify([imageId]),
        replacementImageIds: '[]',
      },
      tx,
    );
  });
}

export async function finishImageRemovals(
  ownerId: OwnerId,
  batchId: string,
  imageId: string,
  tx: Db,
) {
  const attempts = await listCaptureAttempts(ownerId, batchId, tx);
  for (const attempt of attempts) {
    if (attempt.kind === 'image-removal' && stringIds(attempt.acceptedImageIds).includes(imageId)) {
      await updateCaptureAttempt(
        ownerId,
        batchId,
        attempt.id,
        ['receiving', 'incomplete'],
        {
          state: 'complete',
          completedAt: new Date(),
        },
        tx,
      );
    }
  }
}

export function parseSelectionRefusals(value: unknown): SelectionRefusal[] {
  if (value === undefined) return [];
  const bad = (): never => {
    throw new AppError(
      'VALIDATION_FAILED',
      400,
      'Selection refusals must include a unique token, filename and reason.',
    );
  };
  if (!Array.isArray(value) || value.length > 100) return bad();
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('token' in item) ||
      typeof item.token !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(item.token) ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      item.name.length > 255 ||
      !('message' in item) ||
      typeof item.message !== 'string' ||
      item.message.length > 2000 ||
      seen.has(item.token)
    )
      return bad();
    seen.add(item.token);
    return { token: item.token, name: item.name, message: item.message };
  });
}

export async function saveSelectionRefusals(
  ownerId: OwnerId,
  batchId: string,
  reports: SelectionRefusal[],
  tx: Db,
) {
  const existing = await listCaptureAttempts(ownerId, batchId, tx);
  for (const report of reports) {
    const prior = existing.find((row) => row.clientToken === report.token);
    const content = JSON.stringify([{ name: report.name, message: report.message }]);
    if (prior) {
      if (prior.kind !== 'local-refusal' || prior.failures !== content) {
        throw new AppError(
          'VALIDATION_FAILED',
          409,
          'That refusal token already describes different input.',
        );
      }
      continue;
    }
    await createCaptureAttempt(
      ownerId,
      {
        id: ulid(),
        batchId,
        clientToken: report.token,
        kind: 'local-refusal',
        state: 'incomplete',
        failures: content,
        acceptedImageIds: '[]',
        replacementImageIds: '[]',
        completedAt: new Date(),
      },
      tx,
    );
  }
}

export async function resolveCaptureAttempt(
  ownerId: OwnerId,
  batchId: string,
  attemptId: string,
  selected: unknown,
  now = new Date(),
) {
  return withDraftCapture(ownerId, batchId, async (tx) => {
    const attempts = await listCaptureAttempts(ownerId, batchId, tx);
    const attempt = attempts.find((row) => row.id === attemptId);
    if (!attempt) throw new AppError('NOT_FOUND', 404, 'No such input issue.');
    if (attempt.kind === 'image-removal') {
      throw new AppError(
        'VALIDATION_FAILED',
        400,
        'Finish removing that screenshot before resolving other input.',
      );
    }
    if (
      !Array.isArray(selected) ||
      selected.length === 0 ||
      selected.length > 40 ||
      !selected.every((id: unknown) => typeof id === 'string') ||
      new Set(selected).size !== selected.length
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        400,
        'Choose at least one saved replacement screenshot.',
      );
    }
    const images = await listImagesForBatch(ownerId, batchId, tx);
    const removing = new Set(
      attempts
        .filter((row) => row.kind === 'image-removal' && row.state !== 'complete')
        .flatMap((row) => stringIds(row.acceptedImageIds)),
    );
    const available = new Set(
      images
        .filter((image) => image.retainUntil > now && !removing.has(image.id))
        .map((image) => image.id),
    );
    if (!selected.every((id: string) => available.has(id))) {
      throw new AppError(
        'VALIDATION_FAILED',
        400,
        'Every replacement must be an available screenshot saved in this batch.',
      );
    }
    for (const image of images.filter((item) => selected.includes(item.id))) {
      if (!(await imageBlobExists(image.blobPath))) {
        throw new AppError(
          'VALIDATION_FAILED',
          400,
          'A selected screenshot is no longer available. Choose another replacement.',
        );
      }
    }
    const updated = await updateCaptureAttempt(
      ownerId,
      batchId,
      attemptId,
      ['receiving', 'incomplete', 'resolved'],
      {
        state: 'resolved',
        replacementImageIds: JSON.stringify(selected),
        resolvedAt: now,
      },
      tx,
    );
    if (updated.count !== 1)
      throw new AppError('VALIDATION_FAILED', 409, 'That input has no failure to resolve.');
  });
}
