import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitlePresentation } from '@nextup/domain';
import { asOwnerId, updateTitlePresentation } from '../../../src/repository/ownerData.js';
import { readTitlePresentation } from '../../../src/services/titlePresentation.js';
import { TmdbWorkNotFoundError } from '../../../src/clients/tmdbClient.js';

vi.mock('../../../src/repository/ownerData.js', async (original) => ({
  ...(await original<typeof import('../../../src/repository/ownerData.js')>()),
  updateTitlePresentation: vi.fn(),
}));

const now = new Date('2026-09-22T00:00:00.000Z');
const data: TitlePresentation = {
  tmdbId: 42,
  mediaType: 'movie',
  overview: 'An invented story.',
  cast: [],
  directors: ['Avery Example'],
  creators: [],
  trailer: null,
  fetchedAt: now.toISOString(),
};
const owner = asOwnerId('fixture-owner');
const row = {
  id: 'title-1',
  matchState: 'matched',
  tmdbId: 42,
  tmdbMediaType: 'movie',
  tmdbPresentation: null,
};
const write = vi.mocked(updateTitlePresentation);
const log = vi.fn();
const getPresentation = vi.fn(async () => data);
const deps = { now: () => now, log, client: { getPresentation } };

beforeEach(() => {
  vi.clearAllMocks();
  write.mockResolvedValue({ count: 1 });
  getPresentation.mockResolvedValue(data);
});

describe('T-DETAIL-002 presentation cache policy', () => {
  it('T-DETAIL-002a: first access validates and persists only presentation metadata for the owner', async () => {
    expect(await readTitlePresentation(owner, row, deps)).toEqual({ status: 'available', data });
    expect(write).toHaveBeenCalledWith(owner, row.id, data);
    expect(getPresentation).toHaveBeenCalledWith('movie', 42);
  });
  it('T-DETAIL-002b: fresh cached metadata makes no provider request or write', async () => {
    expect(
      await readTitlePresentation(owner, { ...row, tmdbPresentation: JSON.stringify(data) }, deps),
    ).toEqual({ status: 'available', data });
    expect(getPresentation).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it('T-DETAIL-002c: expired cache survives an outage and provider 404 with an explicit stale result', async () => {
    const old = { ...data, fetchedAt: '2025-01-01T00:00:00.000Z' };
    getPresentation.mockRejectedValue(new TmdbWorkNotFoundError('movie', 42));
    expect(
      await readTitlePresentation(owner, { ...row, tmdbPresentation: JSON.stringify(old) }, deps),
    ).toEqual({ status: 'stale', data: old });
    expect(write).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('tmdb.presentation_refresh_failed', { titleId: row.id });
  });
  it('T-DETAIL-002d: changed provider identity never exposes cached synopsis for the previous work', async () => {
    getPresentation.mockRejectedValue(new Error('offline'));
    expect(
      await readTitlePresentation(
        owner,
        { ...row, tmdbId: 99, tmdbPresentation: JSON.stringify(data) },
        deps,
      ),
    ).toEqual({ status: 'unavailable', data: null });
  });
  it.each(['bad JSON', '{"overview":true}'])(
    'T-DETAIL-002e: invalid stored data is disclosed and repaired on access',
    async (raw) => {
      expect(await readTitlePresentation(owner, { ...row, tmdbPresentation: raw }, deps)).toEqual({
        status: 'available',
        data,
      });
      expect(log).toHaveBeenCalledWith('tmdb.presentation_invalid_cache', { titleId: row.id });
    },
  );
  it.each([{ matchState: 'unmatched' }, { tmdbId: null }, { tmdbMediaType: null }])(
    'T-DETAIL-002f: unidentified works never call the provider',
    async (overrides) => {
      expect(await readTitlePresentation(owner, { ...row, ...overrides }, deps)).toEqual({
        status: 'unidentified',
        data: null,
      });
      expect(getPresentation).not.toHaveBeenCalled();
    },
  );
  it('T-DETAIL-002g: a concurrent identity correction cannot persist or return mismatched metadata', async () => {
    write.mockResolvedValue({ count: 0 });
    expect(await readTitlePresentation(owner, row, deps)).toEqual({
      status: 'unavailable',
      data: null,
    });
    expect(log).toHaveBeenCalledWith('tmdb.presentation_identity_changed', { titleId: row.id });
  });
  it('T-DETAIL-002h: write failures are visible and retain the prior cached copy', async () => {
    write.mockRejectedValue(new Error('database unavailable'));
    expect(await readTitlePresentation(owner, row, deps)).toEqual({
      status: 'unavailable',
      data: null,
    });
    expect(log).toHaveBeenCalled();
  });
  it('T-DETAIL-002i: unconfigured provider fails honestly without a network request', async () => {
    vi.stubEnv('TMDB_API_KEY', '');
    try {
      expect(await readTitlePresentation(owner, row, { now: () => now, log })).toEqual({
        status: 'unavailable',
        data: null,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('T-DETAIL-007 #391 cache upgrade', () => {
  it('T-DETAIL-007f: a fresh copy cached before #391 (no trailer key) is refetched once on access', async () => {
    const { trailer: _unused, ...legacy } = data;
    void _unused;
    expect(
      await readTitlePresentation(
        owner,
        { ...row, tmdbPresentation: JSON.stringify(legacy) },
        deps,
      ),
    ).toEqual({ status: 'available', data });
    expect(getPresentation).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(owner, row.id, data);
  });
  it('T-DETAIL-007g: a fresh copy that says "no trailer" (null) is reused without a request', async () => {
    await readTitlePresentation(owner, { ...row, tmdbPresentation: JSON.stringify(data) }, deps);
    expect(getPresentation).not.toHaveBeenCalled();
  });
});
