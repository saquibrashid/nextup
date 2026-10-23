/**
 * #454 (PRD `A64`, US-072 / REQ-138) — `POST /api/titles/:titleId/new-season-tracking`
 * and `…/stop`, with the repository and TMDB mocked.
 *
 * The properties that matter: tracking is an OWNER action, it never lists a
 * title, a show TMDB has no dated season for stays tracked rather than waiting,
 * and a TMDB failure is never an error page.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findTitle = vi.fn();
const findActiveSuppression = vi.fn();
const listListedWorkIdentities = vi.fn();
const listWaitingWorkIdentities = vi.fn();
const findTitleByWorkIdentity = vi.fn();
const createTitle = vi.fn();
const createWatchIntent = vi.fn();
const setSeasonTracking = vi.fn();
const recordSeasonFacts = vi.fn();
const getNextSeason = vi.fn();
const getWork = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  const fn =
    (mock: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      mock(...args);
  return {
    ...actual,
    findTitle: fn(findTitle),
    findActiveSuppression: fn(findActiveSuppression),
    listListedWorkIdentities: fn(listListedWorkIdentities),
    listWaitingWorkIdentities: fn(listWaitingWorkIdentities),
    findTitleByWorkIdentity: fn(findTitleByWorkIdentity),
    createTitle: fn(createTitle),
    createWatchIntent: fn(createWatchIntent),
    runInTransaction: async (work: (tx: unknown) => Promise<unknown>) => work(undefined),
  };
});

vi.mock('../../../src/repository/seasonTracking.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/seasonTracking.js')>();
  return {
    ...actual,
    setSeasonTracking: (...args: unknown[]) => setSeasonTracking(...args) as unknown,
    recordSeasonFacts: (...args: unknown[]) => recordSeasonFacts(...args) as unknown,
  };
});

vi.mock('../../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getNextSeason(...args: unknown[]) {
      return getNextSeason(...args) as Promise<{ seasonNumber: number; airsOn: string } | null>;
    }
    override getWork(...args: unknown[]) {
      return getWork(...args) as ReturnType<InstanceType<typeof actual.TmdbClient>['getWork']>;
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-new-season-unit';
const WORK = 'tmdb:tv:84773';

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

const TV_TITLE = {
  id: 't-tv',
  workIdentity: WORK,
  state: 'removed',
  tmdbId: 84_773,
  tmdbMediaType: 'tv',
};
const DETAIL = {
  tmdbId: 84_773,
  mediaType: 'tv',
  name: 'The Rings of Power',
  releaseYear: 2022,
  runtimeMinutes: null,
  genres: [],
  posterPath: null,
  imdbId: null,
};

let server: Server;
let app: Express;
let origin: string;

const post = (path: string): Promise<Response> =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    body: '{}',
  });
const track = (): Promise<Response> => post('/api/titles/t-tv/new-season-tracking');

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';
  findTitle.mockResolvedValue(TV_TITLE);
  findActiveSuppression.mockResolvedValue(null);
  listListedWorkIdentities.mockResolvedValue(new Set());
  listWaitingWorkIdentities.mockResolvedValue(new Set());
  findTitleByWorkIdentity.mockResolvedValue({ id: 't-tv', state: 'removed' });
  createWatchIntent.mockResolvedValue({});
  setSeasonTracking.mockResolvedValue(undefined);
  recordSeasonFacts.mockResolvedValue(undefined);
  getNextSeason.mockResolvedValue(null);
  getWork.mockResolvedValue(DETAIL);
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('T-SEAS-040 · POST /api/titles/:titleId/new-season-tracking — refusals', () => {
  it('T-SEAS-040a · an unknown title is a 404 and nothing is written', async () => {
    findTitle.mockResolvedValue(null);
    expect((await track()).status).toBe(404);
    expect(setSeasonTracking).not.toHaveBeenCalled();
  });

  it('T-SEAS-040b · a movie, or an unmatched show, is a 400', async () => {
    findTitle.mockResolvedValue({ ...TV_TITLE, tmdbMediaType: 'movie' });
    expect((await track()).status).toBe(400);
    findTitle.mockResolvedValue({ ...TV_TITLE, tmdbId: null });
    expect((await track()).status).toBe(400);
    expect(setSeasonTracking).not.toHaveBeenCalled();
  });

  it('T-SEAS-040c · a show that is in the Library is a 409 TITLE_NOT_ACTIVE', async () => {
    listListedWorkIdentities.mockResolvedValue(new Set([WORK]));
    const res = await track();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TITLE_NOT_ACTIVE');
  });

  it('T-SEAS-040d · a suppressed work is a 409 WORK_SUPPRESSED (invariant 1)', async () => {
    findActiveSuppression.mockResolvedValue({ id: 'sup-1' });
    const res = await track();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('WORK_SUPPRESSED');
    expect(setSeasonTracking).not.toHaveBeenCalled();
  });

  it('T-SEAS-040e · a show already waiting is answered "waiting" and changes nothing', async () => {
    listWaitingWorkIdentities.mockResolvedValue(new Set([WORK]));
    const res = await track();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'waiting' });
    expect(setSeasonTracking).not.toHaveBeenCalled();
    expect(createWatchIntent).not.toHaveBeenCalled();
  });
});

describe('T-SEAS-041 · POST /api/titles/:titleId/new-season-tracking — tracking', () => {
  it('T-SEAS-041a · no dated season: tracking is on, nothing is created, the show stays removed', async () => {
    const res = await track();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      titleId: 't-tv',
      status: 'tracking',
      season: null,
      lookupFailed: false,
    });
    expect(setSeasonTracking).toHaveBeenCalledWith(expect.any(String), WORK, true);
    expect(recordSeasonFacts).toHaveBeenCalledTimes(1);
    expect(createWatchIntent).not.toHaveBeenCalled();
    expect(createTitle).not.toHaveBeenCalled();
  });

  it('T-SEAS-041b · an announced season opens ONE waiting intent carrying it, then stops tracking', async () => {
    getNextSeason.mockResolvedValue({ seasonNumber: 3, airsOn: '2027-03-01' });

    const res = await track();

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      status: 'waiting',
      season: { seasonNumber: 3, airsOn: '2027-03-01' },
    });
    expect(createWatchIntent).toHaveBeenCalledTimes(1);
    const data = (createWatchIntent.mock.calls[0] as [unknown, Record<string, unknown>])[1];
    expect(data).toMatchObject({
      titleId: 't-tv',
      workIdentity: WORK,
      discoverySource: 'search',
      state: 'waiting',
      seasonNumber: 3,
    });
    expect((data['seasonAirOn'] as Date).toISOString()).toBe('2027-03-01T00:00:00.000Z');
    // The title already exists (it was removed), so none is created, and
    // nothing here lists it.
    expect(createTitle).not.toHaveBeenCalled();
    expect(setSeasonTracking).toHaveBeenLastCalledWith(expect.any(String), WORK, false);
  });

  it('T-SEAS-041c · a TMDB failure is a 200: tracking stays on and the next open of Waiting asks again', async () => {
    getNextSeason.mockRejectedValue(new Error('TMDB down'));

    const res = await track();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'tracking', lookupFailed: true });
    expect(setSeasonTracking).toHaveBeenCalledTimes(1);
    expect(recordSeasonFacts).not.toHaveBeenCalled();
    expect(createWatchIntent).not.toHaveBeenCalled();
  });
});

describe('T-SEAS-042 · POST /api/titles/:titleId/new-season-tracking/stop', () => {
  it('T-SEAS-042a · turns tracking off', async () => {
    const res = await post('/api/titles/t-tv/new-season-tracking/stop');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ titleId: 't-tv', status: 'stopped' });
    expect(setSeasonTracking).toHaveBeenCalledWith(expect.any(String), WORK, false);
  });

  it('T-SEAS-042b · an unknown title is a 404', async () => {
    findTitle.mockResolvedValue(null);
    expect((await post('/api/titles/nope/new-season-tracking/stop')).status).toBe(404);
    expect(setSeasonTracking).not.toHaveBeenCalled();
  });
});
