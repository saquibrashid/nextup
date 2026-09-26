import { describe, expect, it } from 'vitest';
import {
  parseStoredTmdbMetadata,
  pickTrailer,
  titlePresentationSchema,
  trailerUrl,
} from '@nextup/domain';
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
  tagline: 'A light in the dark.',
  popularity: 12.5,
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
      tagline: 'A light in the dark.',
      writers: [],
      releaseDate: null,
      status: null,
      certification: null,
      seasons: null,
      episodes: null,
      trailer: null,
    });
    expect(urls[0]?.pathname).toBe('/3/movie/42');
    expect(urls[0]?.searchParams.get('append_to_response')).toBe('credits,videos,release_dates');
    const stored = { ...value, fetchedAt: '2026-09-22T00:00:00.000Z' };
    expect(titlePresentationSchema.parse(stored)).toEqual(stored);
    expect(titlePresentationSchema.safeParse({ ...stored, popularity: 12.5 }).success).toBe(false);
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
    expect(urls[0]?.searchParams.get('append_to_response')).toBe('credits,videos,content_ratings');
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

describe('T-DETAIL-007 #391 every available detail, and the most current trailer', () => {
  const video = (overrides: Record<string, unknown>) => ({
    site: 'YouTube',
    type: 'Trailer',
    official: true,
    key: 'abcDEF12345',
    name: 'Official Trailer',
    published_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('T-DETAIL-007a: a movie keeps writers, release date, status, US certification and its trailer', async () => {
    const { api } = client({
      ...body,
      credits: {
        ...body.credits,
        crew: [
          ...body.credits.crew,
          { name: 'Riley Example', job: 'Screenplay' },
          { name: 'Riley Example', job: 'Story' },
          { name: 'Jo Example', job: 'Producer' },
        ],
      },
      release_date: '2026-03-14',
      status: 'Released',
      release_dates: {
        results: [
          { iso_3166_1: 'GB', release_dates: [{ type: 3, certification: '15' }] },
          {
            iso_3166_1: 'US',
            release_dates: [
              { type: 1, certification: '' },
              { type: 4, certification: 'R' },
              { type: 3, certification: 'PG-13' },
            ],
          },
        ],
      },
      videos: { results: [video({})] },
    });
    expect(await api.getPresentation('movie', 42)).toMatchObject({
      writers: ['Riley Example'],
      releaseDate: '2026-03-14',
      status: 'Released',
      certification: 'PG-13',
      seasons: null,
      episodes: null,
      trailer: {
        key: 'abcDEF12345',
        name: 'Official Trailer',
        kind: 'Trailer',
        publishedAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('T-DETAIL-007b: a series keeps first-air date, seasons, episodes and its US content rating', async () => {
    const { api } = client({
      ...body,
      first_air_date: '2024-05-02',
      status: 'Returning Series',
      number_of_seasons: 3,
      number_of_episodes: 24,
      content_ratings: {
        results: [
          { iso_3166_1: 'DE', rating: '16' },
          { iso_3166_1: 'US', rating: 'TV-MA' },
        ],
      },
    });
    expect(await api.getPresentation('tv', 42)).toMatchObject({
      releaseDate: '2024-05-02',
      status: 'Returning Series',
      seasons: 3,
      episodes: 24,
      certification: 'TV-MA',
      writers: [],
      trailer: null,
    });
  });

  it('T-DETAIL-007c: the trailer is YouTube-only, Trailer before Teaser, official first, then latest published', () => {
    expect(
      pickTrailer([
        video({ key: 'vimeoKey01', site: 'Vimeo' }),
        video({ key: 'featurette1', type: 'Featurette' }),
        video({ key: 'teaserNew01', type: 'Teaser', published_at: '2026-06-01T00:00:00Z' }),
        video({ key: 'fanTrailer1', official: false, published_at: '2026-05-01T00:00:00Z' }),
        video({ key: 'oldOfficial', published_at: '2025-01-01T00:00:00Z' }),
        video({ key: 'newOfficial', published_at: '2026-02-01T00:00:00Z' }),
      ])?.key,
    ).toBe('newOfficial');
    expect(
      pickTrailer([
        video({ key: 'teaserOld01', type: 'Teaser', published_at: '2025-01-01T00:00:00Z' }),
        video({ key: 'teaserNew01', type: 'Teaser', published_at: '2026-01-01T00:00:00Z' }),
      ]),
    ).toMatchObject({ key: 'teaserNew01', kind: 'Teaser' });
    expect(pickTrailer([video({ site: 'Vimeo' })])).toBeNull();
    expect(pickTrailer(undefined)).toBeNull();
  });

  it("T-DETAIL-007d: a key outside YouTube's alphabet is never kept, so a link cannot carry a path or query", () => {
    expect(
      pickTrailer([
        video({ key: 'abc/../x?y=1' }),
        video({ key: '"><script>' }),
        video({ key: 12345678 }),
        null,
        'junk',
      ]),
    ).toBeNull();
    expect(trailerUrl({ key: 'abcDEF12345' })).toBe('https://www.youtube.com/watch?v=abcDEF12345');
  });

  it('T-DETAIL-007e: malformed extra details lose only themselves, never the synopsis and cast', async () => {
    const { api } = client({
      ...body,
      tagline: 7,
      release_date: 'soon',
      status: '',
      release_dates: 'nope',
      videos: { results: 'nope' },
      number_of_seasons: -1,
    });
    expect(await api.getPresentation('movie', 42)).toMatchObject({
      overview: body.overview,
      cast: [{ name: 'Avery Example' }],
      tagline: null,
      releaseDate: null,
      status: null,
      certification: null,
      trailer: null,
    });
  });
});
