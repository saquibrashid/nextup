import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditionLabel, ReviewCandidate } from '@nextup/domain';
import { TmdbClient, TmdbUnavailableError } from '../../src/clients/tmdbClient.js';
import type { Db, OwnerId } from '../../src/repository/ownerData.js';
import {
  addTitleEdition,
  applyConfirmedEditions,
  verifyEditionSelection,
} from '../../src/services/titleEditions.js';

const repo = vi.hoisted(() => ({
  findActiveSuppression: vi.fn(),
  findTitle: vi.fn(),
  findTitleByWorkIdentity: vi.fn(),
  lockTitleForWatchPreferences: vi.fn(),
  recordBatchChange: vi.fn(),
  updateTitle: vi.fn(),
}));
vi.mock('../../src/repository/ownerData.js', () => repo);
const owner = 'fixture-owner' as OwnerId;
const tx = {} as Db;
const edition: EditionLabel = { name: 'Film Extended', kind: 'extended' };
const candidate: ReviewCandidate = {
  candidateId: 'candidate',
  rawText: edition.name,
  inferredTitle: 'Film',
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'llm',
  verdict: 'title-candidate',
  ocrConfidence: 1,
  resolvedWorkIdentity: 'tmdb:movie:1',
  match: {
    tmdbId: 1,
    mediaType: 'movie',
    name: 'Film',
    releaseYear: 2008,
    posterPath: null,
    score: 1,
    uncertain: false,
    ambiguous: false,
    edition,
  },
  alternatives: [],
  sourceImageIds: [],
  tileCrop: null,
  disposition: 'confirmed',
  collapsedIntoCandidateId: null,
  classification: 'new',
};
beforeEach(() => {
  vi.clearAllMocks();
  repo.findTitle.mockResolvedValue({
    id: 'title',
    workIdentity: 'tmdb:movie:1',
    editionLabels: '[]',
    createdByBatchId: 'older',
  });
  repo.findTitleByWorkIdentity.mockResolvedValue({ id: 'title' });
  repo.findActiveSuppression.mockResolvedValue(null);
});

describe('T-EDITION-005 edition writes are explicit, owner scoped and independent of metadata', () => {
  it('validates manual choices against catalogue metadata and keeps upstream failure visible', async () => {
    const client = new TmdbClient({ apiKey: 'fixture-key' });
    const read = vi.spyOn(client, 'getEditionLabels').mockResolvedValue([edition]);
    expect(await verifyEditionSelection(client, 'movie', 1, undefined)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(await verifyEditionSelection(client, 'movie', 1, edition)).toEqual(edition);
    await expect(verifyEditionSelection(client, 'tv', 1, edition)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    read.mockResolvedValue([]);
    await expect(verifyEditionSelection(client, 'movie', 1, edition)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    read.mockRejectedValue(new TmdbUnavailableError('unavailable', 503, true));
    await expect(verifyEditionSelection(client, 'movie', 1, edition)).rejects.toMatchObject({
      code: 'TMDB_UNAVAILABLE',
    });
  });

  it('merges without duplication and records before/after values inside the same transaction', async () => {
    await addTitleEdition(owner, 'title', edition, tx, 'batch');
    expect(repo.lockTitleForWatchPreferences).toHaveBeenCalledWith(owner, 'title', tx);
    expect(repo.findTitle).toHaveBeenCalledWith(owner, 'title', tx);
    expect(repo.updateTitle).toHaveBeenCalledWith(
      owner,
      'title',
      { editionLabels: JSON.stringify([edition]) },
      tx,
    );
    expect(repo.recordBatchChange).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        attr: 'editionLabels',
        prevValue: '[]',
        nextValue: JSON.stringify([edition]),
      }),
      tx,
    );
    repo.findTitle.mockResolvedValue({ editionLabels: JSON.stringify([edition]) });
    await addTitleEdition(owner, 'title', edition, tx);
    expect(repo.updateTitle).toHaveBeenCalledTimes(1);
    repo.findTitle.mockResolvedValue(null);
    await expect(addTitleEdition(owner, 'title', edition, tx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('does not create modification provenance for a newly created title or a standalone add', async () => {
    repo.findTitle.mockResolvedValue({ editionLabels: '[]', createdByBatchId: 'batch' });
    await addTitleEdition(owner, 'title', edition, tx, 'batch');
    await addTitleEdition(owner, 'title', edition, tx);
    expect(repo.recordBatchChange).not.toHaveBeenCalled();
  });

  it('applies only reviewed, uncollapsed, unsuppressed editions of the selected work', async () => {
    await applyConfirmedEditions(
      owner,
      'batch',
      [
        { ...candidate, collapsedIntoCandidateId: 'other' },
        { ...candidate, disposition: 'pending' },
        { ...candidate, match: null },
        { ...candidate, resolvedWorkIdentity: 'tmdb:movie:2' },
        candidate,
      ],
      tx,
    );
    expect(repo.updateTitle).toHaveBeenCalledTimes(1);
    repo.findActiveSuppression.mockResolvedValue({ active: true });
    await applyConfirmedEditions(owner, 'batch', [candidate], tx);
    expect(repo.updateTitle).toHaveBeenCalledTimes(1);
    repo.findActiveSuppression.mockResolvedValue(null);
    repo.findTitleByWorkIdentity.mockResolvedValue(null);
    await expect(applyConfirmedEditions(owner, 'batch', [candidate], tx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an intervening fix-match rather than labelling a different film', async () => {
    await expect(
      addTitleEdition(owner, 'title', edition, tx, 'batch', 'tmdb:movie:2'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repo.updateTitle).not.toHaveBeenCalled();
  });
});
