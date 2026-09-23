import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TmdbClient,
  TmdbUnavailableError,
  resetTmdbRateLimiterForTests,
} from '../../../src/clients/tmdbClient.js';

const name = 'The X-Files: I Want to Believe';
const editionName = `${name} Vrach Frankenshteyn`;
afterEach(resetTmdbRateLimiterForTests);

function clientFor(
  aliasBody: unknown = { titles: [{ title: editionName, type: "director's cut" }] },
  status = 200,
) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/search/multi')) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 8836,
              media_type: 'movie',
              title: name,
              release_date: '2008-07-24',
              poster_path: null,
            },
          ],
        }),
      );
    }
    expect(url.pathname).toBe('/3/movie/8836/alternative_titles');
    expect(url.searchParams.get('api_key')).toBe('fixture-key');
    return new Response(JSON.stringify(aliasBody), { status });
  });
  return {
    client: new TmdbClient({ apiKey: 'fixture-key', fetch: fetcher, sleep: async () => undefined }),
    fetcher,
  };
}

describe('T-EDITION-002 live-catalogue-shaped edition lookup', () => {
  it('T-EDITION-002a finds the reported cut under 8836 without inventing an ID or release year', async () => {
    const { client, fetcher } = clientFor();
    const items = await client.searchMulti(editionName.toUpperCase());
    expect(items[0]).toMatchObject({
      tmdbId: 8836,
      releaseYear: 2008,
      name,
      edition: { name: editionName, kind: 'directors-cut' },
    });
    expect(await client.searchMulti('Vrach Frankenshteyn')).toEqual(items);
    expect(await client.searchMulti('Vrach Frankenshteyn')).toEqual(items);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('T-EDITION-002b uses the source reading when the inferred search title omitted the suffix', async () => {
    const { client } = clientFor();
    expect((await client.searchMulti(name, { evidenceText: editionName }))[0]?.edition?.name).toBe(
      editionName,
    );
    expect((await client.searchMulti(name))[0]?.edition).toBeUndefined();
  });

  it('T-EDITION-002c does not turn ordinary aliases, unknown types or malformed rows into edition claims', async () => {
    const { client } = clientFor({
      titles: [
        null,
        { title: editionName, type: '' },
        { title: editionName, type: 'working title' },
      ],
    });
    expect((await client.searchMulti(editionName))[0]?.edition).toBeUndefined();
  });

  it('T-EDITION-002d distinguishes catalogue misses from outages and unreadable metadata', async () => {
    const absent = clientFor({}, 404);
    expect(await absent.client.getEditionLabels(8836)).toEqual([]);
    expect(await absent.client.getEditionLabels(8836)).toEqual([]);
    expect(absent.fetcher).toHaveBeenCalledTimes(1);
    await expect(clientFor({}, 503).client.searchMulti(editionName)).rejects.toBeInstanceOf(
      TmdbUnavailableError,
    );
    await expect(
      clientFor({ titles: 'bad' }).client.searchMulti(editionName),
    ).rejects.toBeInstanceOf(TmdbUnavailableError);
  });
});
