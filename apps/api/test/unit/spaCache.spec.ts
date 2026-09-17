/**
 * `T-API-031` — the SPA shell revalidates, the hashed bundles do not.
 *
 * ⚠ **THIS EXISTS BECAUSE A SUCCESSFUL DEPLOY LOOKED LIKE A FAILED ONE.** On
 * 2026-09-17 the owner reported a merged, deployed CSS fix as "not landed" on
 * two devices. The image on the running revision provably contained the new
 * stylesheet: `express.static`'s default gave `index.html` the same
 * `Cache-Control: public, max-age=0` as everything else, and a shell answered
 * from cache names the PREVIOUS build's content-hashed bundle — so the browser
 * asks for the old CSS by URL and the server correctly serves it. The failure
 * is invisible from both ends and has no expiry.
 *
 * ⚠ **DRIVEN OVER REAL HTTP, NOT BY CALLING `cacheControlFor`.** The header
 * has to survive `express.static`'s own header writing, which sets
 * `Cache-Control` itself and would overwrite a value set earlier in the
 * request. A unit assertion on the helper passes with `setHeaders` never
 * wired up at all.
 *
 * ⚠ There is deliberately no 304 assertion here: this Express/`send` pair
 * answers a conditional request with 200 whatever this file does, so a 304
 * expectation would be testing the framework rather than the policy.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HASHED_ASSET_CACHE_CONTROL,
  SHELL_CACHE_CONTROL,
  cacheControlFor,
  createApp,
} from '../../src/app.js';

let server: Server;
let app: Express;
let origin: string;
let webRoot: string;

beforeEach(async () => {
  webRoot = mkdtempSync(path.join(tmpdir(), 'nextup-web-root-'));
  mkdirSync(path.join(webRoot, 'assets'));
  writeFileSync(
    path.join(webRoot, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-abc123.css"></head><body></body></html>',
  );
  writeFileSync(path.join(webRoot, 'assets', 'index-abc123.css'), ':root{--x:1}');
  writeFileSync(path.join(webRoot, 'robots.txt'), 'User-agent: *\n');
  await new Promise<void>((resolve) => {
    app = createApp({ webRoot });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('T-API-031 the SPA shell is never served stale', () => {
  it('T-API-031a: the shell carries no-cache on a hard navigation', async () => {
    const response = await fetch(`${origin}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(SHELL_CACHE_CONTROL);
  });

  it('T-API-031b: a client-side route falls back to the shell with the same policy', async () => {
    const response = await fetch(`${origin}/batches/some-id`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(SHELL_CACHE_CONTROL);
  });

  it('T-API-031c: a content-hashed bundle is cacheable for a year and immutable', async () => {
    const response = await fetch(`${origin}/assets/index-abc123.css`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(HASHED_ASSET_CACHE_CONTROL);
  });

  /*
   * ⚠ A stable-named file in `public/` is NOT hashed, so the immutable year
   * would make it unreplaceable until the browser's cache was cleared.
   */
  it('T-API-031d: an unhashed static file does not claim to be immutable', async () => {
    const response = await fetch(`${origin}/robots.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(SHELL_CACHE_CONTROL);
  });

  /*
   * ⚠ `no-cache` IS NOT `no-store`. The shell must still be storable and must
   * still carry a validator, so a revisit is a conditional request rather than
   * a fresh download of the whole shell — `no-store` would be a different
   * defect, not a safer one.
   */
  it('T-API-031e: the shell still carries a validator rather than refusing to be stored', async () => {
    const response = await fetch(`${origin}/`);
    expect(response.headers.get('etag')).not.toBeNull();
    expect(response.headers.get('last-modified')).not.toBeNull();
    expect(response.headers.get('cache-control')).not.toContain('no-store');
  });

  it('T-API-031f: the rule discriminates by directory, not by extension', () => {
    expect(cacheControlFor('/app/apps/web/dist/assets/index-abc123.css')).toBe(
      HASHED_ASSET_CACHE_CONTROL,
    );
    expect(cacheControlFor('/app/apps/web/dist/index.html')).toBe(SHELL_CACHE_CONTROL);
    expect(cacheControlFor('/app/apps/web/dist/tmdb-logo.svg')).toBe(SHELL_CACHE_CONTROL);
  });
});
