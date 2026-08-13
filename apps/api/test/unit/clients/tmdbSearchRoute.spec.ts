/**
 * `T-TMDB-010p`…`u` — `GET /api/tmdb/search` (`specs/api.md` §6.29).
 * TASK-045, US-007 AC-5 / US-030.
 *
 * ⚠ These are lettered cases of `T-TMDB-010`, TASK-045's own id, and they are
 * deliberately NOT `T-AI-017`. The backlog names both for this task, but
 * `specs/testing.md` defines `T-AI-017` at INTEGRATION level as "TMDB 503 →
 * all candidates unmatched, batch still reaches `in-review`, banner shown, no
 * failure". None of that exists yet: it needs the extraction and matching
 * stages (TASK-056/057/060). Naming these cases `T-AI-017` would make
 * `check-status` see the id in the suite and let an unbuilt pipeline report as
 * verified — the precise failure `tools/check-test-ids.mjs` was written to
 * stop. `T-AI-017` stays unimplemented, and TASK-045 stays `doing`.
 *
 * The route is driven through a real Express router mounted behind the real
 * `errorEnvelope`, because the properties under test are the STATUS CODE and
 * the ENVELOPE — both of which are invisible when you assert on a mocked
 * response object.
 *
 * ⚠ These tests mount the router themselves. That is a test harness, NOT the
 * production registration: the router is registered by
 * `apps/api/src/routes/index.ts` (coordinator-owned), inside the auth chain,
 * and `T-SEC-029` asserts every registered route refuses an unauthenticated
 * caller. Nothing here may be read as a licence to mount it elsewhere.
 */

import express, { Router } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { TmdbClient } from '../../../src/clients/tmdbClient.js';
import { errorEnvelope } from '../../../src/middleware/errorEnvelope.js';
import {
  parseTmdbSearchQuery,
  registerTmdbRoutes,
  TMDB_UNAVAILABLE_MESSAGE,
} from '../../../src/routes/tmdb.js';
import {
  tmdbReplayFetch,
  TMDB_UNAVAILABLE_TOKEN,
} from '../../../../../tests/fixtures/msw/tmdb/index.js';

const API_KEY = 'fixture-key-not-a-real-secret';

let server: Server | null = null;

async function start(): Promise<string> {
  const app = express();
  const router = Router();
  registerTmdbRoutes(
    router,
    () =>
      new TmdbClient({
        apiKey: API_KEY,
        fetch: tmdbReplayFetch(),
        sleep: () => Promise.resolve(),
      }),
  );
  app.use('/api', router);
  app.use('/api', errorEnvelope);

  server = app.listen(0);
  await new Promise((resolve) => server?.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server?.close(resolve));
    server = null;
  }
});

describe('T-TMDB-010 GET /api/tmdb/search', () => {
  it('T-TMDB-010p · US-030 · returns the recorded matches in the documented shape', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/tmdb/search?q=Dune`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          tmdbId: 438631,
          mediaType: 'movie',
          name: 'Dune',
          releaseYear: 2021,
          posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
        },
        {
          tmdbId: 41733,
          mediaType: 'movie',
          name: 'Dune',
          releaseYear: 1984,
          posterPath: '/aRSuC2fS5Q3q2ZK7Bg5aQZKvVSk.jpg',
        },
        {
          tmdbId: 66732,
          mediaType: 'tv',
          name: 'Dune: Prophecy',
          releaseYear: 2024,
          posterPath: '/gZ4dNYIBIbBRuBGRUcXvHMYaFmm.jpg',
        },
      ],
    });
  });

  it('T-TMDB-010q · US-007 AC-5 · an unreachable TMDB is 502 TMDB_UNAVAILABLE', async () => {
    const base = await start();
    const response = await fetch(
      `${base}/api/tmdb/search?q=${encodeURIComponent(`Dune ${TMDB_UNAVAILABLE_TOKEN}`)}`,
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as {
      error: { code: string; message: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe('TMDB_UNAVAILABLE');
    expect(body.error.message).toBe(TMDB_UNAVAILABLE_MESSAGE);
    // A 5xx carries a correlation id: the message is deliberately uninformative,
    // so the id is what makes it diagnosable from a log.
    expect(typeof body.error.details['correlationId']).toBe('string');
  });

  it('T-TMDB-010r · the API key never appears in any response', async () => {
    // specs/security.md §6: the key is server-side only; the client uses this
    // route precisely so it never has to hold one.
    const base = await start();

    for (const path of [
      '/api/tmdb/search?q=Dune',
      `/api/tmdb/search?q=${encodeURIComponent(TMDB_UNAVAILABLE_TOKEN)}`,
      '/api/tmdb/search?q=',
    ]) {
      const text = await fetch(`${base}${path}`).then((r) => r.text());
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain('api_key');
      expect(text).not.toContain('api.themoviedb.org');
    }
  });

  it('T-TMDB-010s · an unrecorded query is an empty list, not an error', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/tmdb/search?q=nothing-recorded-here`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it('T-TMDB-010t · query validation follows specs/api.md §6.29 exactly', () => {
    expect(parseTmdbSearchQuery({ q: 'Dune' })).toEqual({ q: 'Dune', limit: 10 });
    expect(parseTmdbSearchQuery({ q: 'Dune', type: 'tv', limit: '5' })).toEqual({
      q: 'Dune',
      type: 'tv',
      limit: 5,
    });

    // A missing or over-long term, an unknown type and an out-of-range limit
    // are REFUSED rather than clamped: a silently-clamped limit answers a
    // question the caller did not ask.
    expect(() => parseTmdbSearchQuery({})).toThrow(/search term is required/);
    expect(() => parseTmdbSearchQuery({ q: '   ' })).toThrow(/search term is required/);
    expect(() => parseTmdbSearchQuery({ q: 'x'.repeat(101) })).toThrow(/at most 100/);
    expect(() => parseTmdbSearchQuery({ q: 'Dune', type: 'person' })).toThrow(/movie/);
    expect(() => parseTmdbSearchQuery({ q: 'Dune', limit: '21' })).toThrow(/between 1 and 20/);
    expect(() => parseTmdbSearchQuery({ q: 'Dune', limit: '0' })).toThrow(/between 1 and 20/);
    expect(() => parseTmdbSearchQuery({ q: 'Dune', limit: '1.5' })).toThrow(/between 1 and 20/);
  });

  it('T-TMDB-010u · a malformed query is 400 VALIDATION_FAILED through the envelope', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/tmdb/search`);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ field: 'q' });
  });
});
