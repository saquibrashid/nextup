import { describe, expect, it } from 'vitest';
import { titlePresentationSchema, parseStoredTmdbMetadata } from '@nextup/domain';
import {
  TmdbClient,
  TmdbUnavailableError,
  TmdbWorkNotFoundError,
} from '../../../src/clients/tmdbClient.js';

function client(body: unknown, status = 200) {
  const urls: URL[] = [];
  return {
    urls,
    api: new TmdbClient({
      apiKey: 'fixture-key',
      sleep: async () => undefined,
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        return new Response(JSON.stringify(body), { status });
      },
    }),
  };
}

const body = {
  overview: 'An invented story about a lighthouse.',
  credits: {
    cast: [{ name: 'Avery Example', character: 'The Keeper', profile_path: '/unused.jpg' }],
    crew: [
      { name: 'Morgan Example', job: 'Director' },
      { name: 'Sam Example', job: 'Editor' },
    ],
  },
  created_by: [{ name: 'Taylor Example', id: 123 }],
  tagline: 'Not stored',
};

describe('T-DETAIL-001 display-only metadata projection', () => {
  it('T-DETAIL-001a: movies retain synopsis, cast and directors but no raw provider fields', async () => {
    const { api, urls } = client(body);
    const value = await api.getPresentation('movie', 42);
    expect(value).toEqual({
      tmdbId: 42,
      mediaType: 'movie',
      overview: body.overview,
      cast: [{ name: 'Avery Example', character: 'The Keeper' }],
      directors: ['Morgan Example'],
      creators: [],
    });
    expect(urls[0]?.pathname).toBe('/3/movie/42');
    expect(urls[0]?.searchParams.get('append_to_response')).toBe('credits');
    const stored = { ...value, fetchedAt: '2026-09-22T00:00:00.000Z' };
    expect(titlePresentationSchema.parse(stored)).toEqual(stored);
    expect(titlePresentationSchema.safeParse({ ...stored, tagline: 'extra' }).success).toBe(false);
    expect(() => parseStoredTmdbMetadata(stored)).toThrow();
  });

  it('T-DETAIL-001b: series use creators and series cast, never an invented series director', async () => {
    const { api, urls } = client(body);
    expect(await api.getPresentation('tv', 42)).toMatchObject({
      creators: ['Taylor Example'],
      directors: [],
      cast: [{ character: 'The Keeper' }],
    });
    expect(urls[0]?.pathname).toBe('/3/tv/42');
  });

  it('T-DETAIL-001c: absent synopsis and empty credits are real missing-data states', async () => {
    const { api } = client({
      overview: '',
      credits: { cast: [{ name: 'Avery', character: '' }], crew: [] },
      created_by: [],
    });
    expect(await api.getPresentation('tv', 42)).toMatchObject({
      overview: null,
      cast: [{ name: 'Avery', character: null }],
      creators: [],
    });
  });

  it.each([
    null,
    {},
    { credits: {} },
    { ...body, overview: 7 },
    { ...body, credits: { cast: [null], crew: [] } },
  ])(
    'T-DETAIL-001d: malformed provider information is not cached as empty success',
    async (value) => {
      await expect(client(value).api.getPresentation('tv', 42)).rejects.toBeInstanceOf(
        TmdbUnavailableError,
      );
    },
  );

  it('T-DETAIL-001e: provider 404 and outages remain distinct transport failures', async () => {
    await expect(client({}, 404).api.getPresentation('movie', 42)).rejects.toBeInstanceOf(
      TmdbWorkNotFoundError,
    );
    const unavailable = client({}, 503);
    await expect(unavailable.api.getPresentation('movie', 42)).rejects.toBeInstanceOf(
      TmdbUnavailableError,
    );
    expect(unavailable.urls).toHaveLength(3);
  });
});
