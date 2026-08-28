/**
 * `T-API-010` — every `/api/...` path the SPA client calls is a route the API
 * actually registers (TASK-076).
 *
 * ⚠ **THIS EXISTS BECAUSE THE PRODUCT SHIPPED A POLL AGAINST A 404.**
 * `apiClient.getBatch` and `containers/BatchStatusRoute.tsx` called
 * `GET /api/batches/:batchId` — the whole of US-006 AC-1 — for the entire life
 * of TASK-059 while no router registered it. Neither suite could see it: the
 * web tests stub the client, so the request never leaves the process, and the
 * API tests assert routes that exist, so an ABSENT route is asserted by
 * nobody. Two green suites, one dead feature.
 *
 * The pairing is therefore checked mechanically, from BOTH real artefacts —
 * the client's own source and the live Express router — rather than from a
 * hand-kept list. A list would have to be updated by the same person who
 * forgot to add the route, which is the failure this is aimed at.
 *
 * ⚠ **DIRECTION MATTERS, AND ONLY ONE DIRECTION IS ASSERTED.** Client → server
 * is a defect: the SPA cannot work. Server → client is NOT: `GET
 * /api/images/:imageId` is reached from an `href` in an `<img>` tag and never
 * through the client, and `/api/imdb/lookup` is called from a component. A
 * bidirectional assertion would fail on correct code and be silenced.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createApiRouter } from '../../apps/api/src/routes/index.js';
import { normalisePath } from '../../tools/check-mutating-routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT = path.join(ROOT, 'apps', 'web', 'src', 'lib', 'apiClient.ts');

/**
 * Every `/api/...` path literal in a source file, as a route pattern.
 *
 * ⚠ A `${...}` interpolation becomes `:param`, so
 * `` `/api/titles/${encodeURIComponent(id)}/suppress` `` normalises to
 * `/api/titles/:param/suppress` — exactly what {@link normalisePath} produces
 * from the Express registration `'/titles/:titleId/suppress'`. Both sides go
 * through the same normaliser so the comparison cannot drift.
 *
 * A trailing query-string interpolation (`/api/titles${query ? ... : ''}`) is
 * dropped rather than turned into a segment: `?sort=name` is not a path.
 */
export function clientApiPaths(source: string): string[] {
  // ⚠ Interpolations are collapsed INNERMOST-FIRST, before any path matching.
  // Matching quoted literals first cannot work: `` `/api/titles${query ?
  // `?${query}` : ''}` `` contains a nested backtick, so a "stop at the
  // closing quote" regex stops inside the interpolation and yields the
  // half-path `/api/titles${query ` — verified, it is what the first version
  // of this did.
  const MARK = '\uFFFD';
  // ⚠ COMMENTS ARE STRIPPED FIRST. This file's doc comments cite `/api/...`
  // paths in prose and cite repository paths like `apps/api/src/...`; both
  // match a naive scan and both are noise. Stripping them is what keeps the
  // signal — "code that issues a request" — honest.
  let flattened = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
  for (let pass = 0; pass < 10; pass += 1) {
    const next = flattened.replace(/\$\{[^{}]*\}/g, MARK);
    if (next === flattened) break;
    flattened = next;
  }

  const found = new Set<string>();
  // The lookbehind rejects `apps/api/src/...`: a path segment glued to the
  // left is a file reference, not a request.
  for (const match of flattened.matchAll(/(?<![A-Za-z0-9_.-])\/api\/[A-Za-z0-9_./\uFFFD-]*/g)) {
    const raw = match[0];
    // A marker that does NOT start its own segment is a query string or a
    // suffix, not a path parameter — `/api/titles${query…}` is `/api/titles`.
    const suffix = raw.search(/[^/]\uFFFD/);
    const pathOnly = suffix === -1 ? raw : raw.slice(0, suffix + 1);
    const asPattern = pathOnly.replaceAll(MARK, ':param').replace(/\/+$/, '');
    if (asPattern === '' || asPattern === '/api') continue;
    found.add(normalisePath(asPattern));
  }
  return [...found].sort();
}

/** Registered API route patterns, mount prefix included. */
function registeredApiPaths(): Set<string> {
  const router = createApiRouter() as unknown as { stack?: unknown[] };
  const out = new Set<string>();
  for (const layer of router.stack ?? []) {
    const route = (layer as { route?: { path?: unknown } }).route;
    if (route === undefined || typeof route.path !== 'string') continue;
    out.add(normalisePath(`/api${route.path}`));
  }
  return out;
}

describe('T-API-010 the SPA client and the API agree on what exists', () => {
  it('T-API-010a: every path the client calls is registered by the API', () => {
    const called = clientApiPaths(readFileSync(CLIENT, 'utf8'));
    const registered = registeredApiPaths();

    // ⚠ NON-VACUITY, BOTH SIDES. If either extraction silently returned
    // nothing — a refactor of the client, an Express internals change — the
    // comparison below would pass while checking nothing at all, which is the
    // precise failure mode this test was written to end.
    expect(called.length, 'no /api paths were extracted from the client').toBeGreaterThan(5);
    expect(registered.size, 'no routes were enumerated from the API router').toBeGreaterThan(5);

    const missing = called.filter((route) => !registered.has(route));
    expect(missing, 'the SPA calls these paths and the API registers none of them').toEqual([]);
  });

  it('T-API-010b: the extractor normalises interpolation the way Express does', () => {
    // The negative control for the parser. If `${...}` were left verbatim,
    // every parameterised path would be "missing" and somebody would delete
    // the assertion above rather than the bug.
    const source = `
      request('/api/me');
      request(\`/api/titles/\${encodeURIComponent(id)}\`);
      request(\`/api/titles/\${encodeURIComponent(id)}/suppress\`);
      request(\`/api/titles\${query ? \`?\${query}\` : ''}\`);
    `;
    expect(clientApiPaths(source)).toEqual([
      '/api/me',
      '/api/titles',
      '/api/titles/:param',
      '/api/titles/:param/suppress',
    ]);
  });

  it('T-API-010c: the check fails when a called path is not registered', () => {
    // The mutation, run in-process: a client that calls something the API does
    // not serve must be reported. Without this, T-API-010a could be passing
    // because the comparison is a no-op.
    const called = clientApiPaths(`request('/api/batches/\${id}/does-not-exist');`);
    const registered = registeredApiPaths();
    expect(called.filter((route) => !registered.has(route))).toEqual([
      '/api/batches/:param/does-not-exist',
    ]);
  });

  it('T-API-010d: the batch the status page polls is registered', () => {
    // Named explicitly as well as caught by the sweep, because this is the
    // route that was missing and the sweep is only as good as its extractor.
    expect(registeredApiPaths().has('/api/batches/:param')).toBe(true);
    expect(registeredApiPaths().has('/api/batches')).toBe(true);
  });
});
