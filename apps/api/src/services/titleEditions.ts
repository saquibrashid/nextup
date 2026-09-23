import {
  mergeEditionLabels,
  normaliseTitleText,
  parseEditionLabels,
  workIdentityForTmdb,
  type EditionLabel,
  type MediaType,
  type ReviewCandidate,
} from '@nextup/domain';
import type { TmdbClient } from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';
import {
  findActiveSuppression,
  findTitle,
  findTitleByWorkIdentity,
  lockTitleForWatchPreferences,
  recordBatchChange,
  updateTitle,
  type Db,
  type OwnerId,
} from '../repository/ownerData.js';
import { tmdbUnavailableAppError } from '../routes/tmdb.js';

export async function verifyEditionSelection(
  client: TmdbClient,
  mediaType: MediaType,
  tmdbId: number,
  requested: EditionLabel | undefined,
): Promise<EditionLabel | undefined> {
  if (requested === undefined) return undefined;
  try {
    const labels = mediaType === 'movie' ? await client.getEditionLabels(tmdbId) : [];
    const selected = labels.find(
      (label) =>
        label.kind === requested.kind &&
        normaliseTitleText(label.name) === normaliseTitleText(requested.name),
    );
    if (selected === undefined) {
      throw new AppError(
        'VALIDATION_FAILED',
        400,
        'TMDB no longer lists that edition for this film. Search again before saving.',
        { field: 'edition' },
      );
    }
    return selected;
  } catch (error) {
    throw tmdbUnavailableAppError(error) ?? error;
  }
}

export async function addTitleEdition(
  ownerId: OwnerId,
  titleId: string,
  edition: EditionLabel,
  tx: Db,
  batchId?: string,
  expectedWorkIdentity?: string,
): Promise<void> {
  await lockTitleForWatchPreferences(ownerId, titleId, tx);
  const title = await findTitle(ownerId, titleId, tx);
  if (title === null) throw new AppError('NOT_FOUND', 404, 'No such title.');
  if (expectedWorkIdentity !== undefined && title.workIdentity !== expectedWorkIdentity) {
    throw new AppError(
      'VALIDATION_FAILED',
      409,
      'This match changed. Reload before saving the edition.',
    );
  }
  const before = parseEditionLabels(title.editionLabels);
  const after = mergeEditionLabels(before, [edition]);
  if (after.length === before.length) return;
  await updateTitle(ownerId, titleId, { editionLabels: JSON.stringify(after) }, tx);
  if (batchId !== undefined && title.createdByBatchId !== batchId) {
    await recordBatchChange(
      ownerId,
      {
        batchId,
        kind: 'attr_modified',
        titleId,
        attr: 'editionLabels',
        prevValue: JSON.stringify(before),
        nextValue: JSON.stringify(after),
      },
      tx,
    );
  }
}

export async function applyConfirmedEditions(
  ownerId: OwnerId,
  batchId: string,
  candidates: readonly ReviewCandidate[],
  tx: Db,
): Promise<void> {
  for (const candidate of candidates) {
    const match = candidate.match;
    if (
      candidate.collapsedIntoCandidateId !== null ||
      !['confirmed', 'corrected'].includes(candidate.disposition) ||
      match?.edition === undefined ||
      candidate.resolvedWorkIdentity !== workIdentityForTmdb(match.mediaType, match.tmdbId)
    )
      continue;
    if (await findActiveSuppression(ownerId, candidate.resolvedWorkIdentity, tx)) continue;
    const title = await findTitleByWorkIdentity(ownerId, candidate.resolvedWorkIdentity, tx);
    if (title === null)
      throw new AppError('NOT_FOUND', 404, 'No title was created for this edition.');
    await addTitleEdition(
      ownerId,
      title.id,
      match.edition,
      tx,
      batchId,
      candidate.resolvedWorkIdentity,
    );
  }
}
