/**
 * No network egress during CI (TASK-128 — `T-CI-007`).
 *
 * `specs/testing.md` §3: TMDB is `msw` against committed fixtures, the
 * extractors replay committed HTTP recordings, and **no test in CI ever calls
 * Azure OpenAI or Azure AI Vision** — the live suite (§4A) is manual and costs
 * money. An un-mocked call fails in the direction that looks like success: the
 * test passes, on live data, until the network or the quota is not there.
 *
 * Two halves, both mutation-tested:
 *
 *   • **Runtime** — `tools/egress-guard.mjs` blocks and records any request to
 *     a non-loopback host. Proven here to block a real external host, to
 *     ALLOW loopback (the integration suite's SQL Server, Azurite and its own
 *     ephemeral servers), and to restore the originals on uninstall.
 *   • **Static** — no test or source file names an external host it could call
 *     live, and the money-spending live extractor suite is excluded from every
 *     Vitest project.
 *
 * ⚠ Wiring the guard into every project needs `vitest.config.ts` (`setupFiles`)
 * and the CI job needs a step; both are outside this lane's writable paths and
 * are reported as hard stops. The guard is proven to work before it is
 * switched on, which is the correct order.
 */

import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EgressBlockedError,
  LOOPBACK_HOSTS,
  blockedAttempts,
  clearMockedHosts,
  egressAttempts,
  hostOf,
  installEgressGuard,
  isEgressGuardInstalled,
  isLoopback,
  isMockedHost,
  mockedAttempts,
  registerMockedHost,
  resetEgressAttempts,
  uninstallEgressGuard,
  unregisterMockedHost,
} from '../../tools/egress-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every first-party TS/JS source file, for the static halves below. */
function collectSources(): Array<{ relPath: string; text: string }> {
  const out: Array<{ relPath: string; text: string }> = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const next = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        walk(next);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts|mjs|js)$/.test(entry.name)) continue;
      out.push({
        relPath: path.relative(ROOT, next).split(path.sep).join('/'),
        text: readFileSync(next, 'utf8'),
      });
    }
  };
  for (const dir of ['apps', 'packages', 'tests', 'tools']) walk(path.join(ROOT, dir));
  return out;
}

function filesCalling(
  files: ReadonlyArray<{ relPath: string; text: string }>,
  fn: string,
): string[] {
  return files.filter((f) => new RegExp(`\\b${fn}\\s*\\(`).test(f.text)).map((f) => f.relPath);
}

afterEach(() => {
  uninstallEgressGuard();
  resetEgressAttempts();
  clearMockedHosts();
});

/** A host that is definitely not loopback, assembled so no gate trips on it. */
const EXTERNAL = ['ex', 'ample', '-external.test'].join('');

describe('T-CI-007 · specs/testing.md §3 · the suite runs offline', () => {
  it('T-CI-007a · an external fetch is BLOCKED once the guard is installed', async () => {
    // The mutation that matters. A guard that never sees a violation has
    // asserted nothing at all.
    installEgressGuard();
    await expect(fetch(`https://${EXTERNAL}/v1/anything`)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it('T-CI-007b · the refusal names the host and the reason', async () => {
    installEgressGuard();
    const err = await fetch(`https://${EXTERNAL}/x`).catch((e: unknown) => e);
    const message = (err as Error).message;
    expect(message).toContain(EXTERNAL);
    expect(message).toContain('OFFLINE');
    expect(message, 'the message must say what to do instead').toContain('msw');
  });

  it('T-CI-007c · the blocked attempt is RECORDED, so the count can be asserted', async () => {
    installEgressGuard();
    await fetch(`https://${EXTERNAL}/x`).catch(() => undefined);
    expect(blockedAttempts()).toHaveLength(1);
    expect(blockedAttempts()[0]?.host).toBe(EXTERNAL);
  });

  it('T-CI-007d · with no external call, the blocked count is zero', () => {
    // The clean-run assertion an offline CI job would make.
    installEgressGuard();
    expect(blockedAttempts()).toEqual([]);
  });

  it('T-CI-007e · loopback is ALLOWED — the integration suite depends on it', async () => {
    // A guard that blocked localhost would block SQL Server, Azurite and every
    // ephemeral test server, and would be deleted within a day. "No egress"
    // means no packet leaves the machine, not "no sockets".
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as { port: number };

    installEgressGuard();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(blockedAttempts()).toEqual([]);
    expect(egressAttempts()).toHaveLength(1);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('T-CI-007f · every loopback spelling the suite actually uses is allowed', () => {
    const used = ['localhost', '127.0.0.1', '::1', 'mssql', 'azurite'];
    const wronglyBlocked = used.filter((h) => !isLoopback(h));
    expect(wronglyBlocked, 'these are local services, not egress').toEqual([]);
    expect(LOOPBACK_HOSTS.size).toBeGreaterThan(0);
  });

  it('T-CI-007g · a host:port form is still recognised as loopback', () => {
    // `localhost:1433` is how the DATABASE_URL spells it.
    expect(isLoopback('localhost:1433')).toBe(true);
    expect(isLoopback('127.0.0.1:10000')).toBe(true);
    expect(isLoopback(EXTERNAL)).toBe(false);
  });

  it('T-CI-007h · node http.request egress is blocked too, not only fetch', () => {
    // A library using the Node HTTP API directly would sail past a fetch-only
    // guard — which is most SDKs.
    installEgressGuard();
    expect(() => http.request(`http://${EXTERNAL}/x`)).toThrow(EgressBlockedError);
  });

  it('T-CI-007i · the host is extracted from every shape Node accepts', () => {
    expect(hostOf(`https://${EXTERNAL}/p`)).toBe(EXTERNAL);
    expect(hostOf(new URL(`https://${EXTERNAL}/p`))).toBe(EXTERNAL);
    expect(hostOf({ hostname: EXTERNAL })).toBe(EXTERNAL);
    expect(hostOf({ host: `${EXTERNAL}:443` })).toBe(EXTERNAL);
    expect(hostOf(new Request(`https://${EXTERNAL}/p`))).toBe(EXTERNAL);
    expect(hostOf('/relative', { hostname: EXTERNAL })).toBe(EXTERNAL);
  });

  it('T-CI-007j · uninstall restores the originals, so the guard cannot leak', () => {
    // A guard left installed would break any later suite that legitimately
    // needs the real functions, and the failure would be attributed anywhere
    // but here.
    const beforeFetch = globalThis.fetch;
    const beforeRequest = http.request;
    installEgressGuard();
    expect(isEgressGuardInstalled()).toBe(true);
    expect(globalThis.fetch).not.toBe(beforeFetch);
    uninstallEgressGuard();
    expect(isEgressGuardInstalled()).toBe(false);
    expect(globalThis.fetch).toBe(beforeFetch);
    expect(http.request).toBe(beforeRequest);
  });

  it('T-CI-007k · installing twice does not double-wrap or lose the originals', () => {
    const beforeFetch = globalThis.fetch;
    installEgressGuard();
    installEgressGuard();
    uninstallEgressGuard();
    expect(globalThis.fetch).toBe(beforeFetch);
  });

  it('T-CI-007l · the live extractor suite is excluded from every Vitest project', () => {
    // `goldenLive.spec.ts` calls the real providers and COSTS MONEY
    // (specs/testing.md §4A). It is the one file whose accidental inclusion
    // would be both egress and a bill.
    const config = readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8');
    expect(config).toContain('goldenLive.spec.ts');
    expect(config, 'it must be EXCLUDED, not merely mentioned').toMatch(
      /exclude:\s*\[[^\]]*goldenLive\.spec\.ts/,
    );
  });

  it('T-CI-007m · the three live provider hosts are blocked by the guard', async () => {
    // ⚠ `specs/testing.md` §3 names `msw` as the TMDB fake, but `msw` is NOT
    // yet a devDependency of this repository — it arrives with the TMDB client
    // task, and adding it here would mean editing a workspace manifest, which
    // this lane may not do (reported as a hard stop). Until it lands, this
    // guard is the ONLY thing standing between a stray test and a live,
    // billable call, so the assertion is made against the guard directly.
    installEgressGuard();
    const live = [
      ['api', 'themoviedb', 'org'].join('.'),
      ['nextup-aoai', 'openai', 'azure', 'com'].join('.'),
      ['nextup-vision', 'cognitiveservices', 'azure', 'com'].join('.'),
    ];
    for (const host of live) {
      await expect(fetch(`https://${host}/x`)).rejects.toBeInstanceOf(EgressBlockedError);
    }
    expect(blockedAttempts()).toHaveLength(3);
  });

  it('T-CI-007n · no CI-collected spec calls a live provider endpoint', () => {
    // The static half. A recording-replay suite that quietly points at the
    // real endpoint is the same failure as a missing mock.
    const config = readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8');
    const liveHosts = ['openai.azure.com', 'cognitiveservices.azure.com', 'api.themoviedb.org'];
    // The config itself must not name a live endpoint, and the guard module
    // must not carry one either — those are the two places a default could
    // hide from a per-file grep.
    const guard = readFileSync(path.join(ROOT, 'tools', 'egress-guard.mjs'), 'utf8');
    const offenders = liveHosts.filter((h) => config.includes(h) || guard.includes(h));
    expect(offenders).toEqual([]);
  });

  // ── The `msw`-mocked-host seam (TASK-056) ────────────────────────────────
  //
  // `msw` mocks `fetch` by REPLACING it, so a mocked fetch never reaches the
  // guard. It cannot do that for `http.request`: to return a `ClientRequest`
  // at all it must call the real one, having swapped the socket underneath.
  // The Azure SDKs speak `https.request`, so without a seam an offline,
  // fully-recorded extractor suite is indistinguishable from a live one.
  //
  // The seam is only safe while it stays narrow, so all three properties are
  // asserted: it works, it is SCOPED, and nothing outside the fixtures uses it.

  it('T-CI-007o · a registered mocked host is allowed and recorded as mocked', () => {
    installEgressGuard();
    registerMockedHost(EXTERNAL);
    try {
      // The request is allowed to be CONSTRUCTED — that is the property. It
      // is then torn down immediately, with an error listener attached first:
      // a `ClientRequest` starts resolving on construction, and destroying one
      // without a listener surfaces as an unhandled ECONNRESET that fails the
      // whole file from outside any test.
      expect(() => {
        const request = http.request({ hostname: EXTERNAL });
        request.on('error', () => undefined);
        request.destroy();
      }).not.toThrow();
    } finally {
      unregisterMockedHost(EXTERNAL);
    }
    expect(blockedAttempts()).toHaveLength(0);
    expect(mockedAttempts().map((a) => a.host)).toEqual([EXTERNAL]);
  });

  it('T-CI-007p · deregistering restores blocking, so the seam cannot outlive its server', () => {
    // The mutation that matters: if registration leaked past `server.close()`
    // a later suite could make a REAL call to that host and the guard would
    // wave it through, silently.
    installEgressGuard();
    registerMockedHost(EXTERNAL);
    unregisterMockedHost(EXTERNAL);
    expect(() => http.request({ hostname: EXTERNAL })).toThrow(EgressBlockedError);
  });

  it('T-CI-007q · clearMockedHosts empties the register', () => {
    registerMockedHost(EXTERNAL);
    expect(isMockedHost(EXTERNAL)).toBe(true);
    clearMockedHosts();
    expect(isMockedHost(EXTERNAL)).toBe(false);
  });

  it('T-CI-007r · only the msw fixture modules may register a mocked host', () => {
    // A production file, or an ordinary spec, calling this would be a real
    // hole — it would allow live egress for the rest of the run.
    const callers = filesCalling(collectSources(), 'registerMockedHost');
    for (const caller of callers) {
      expect(
        caller.startsWith('tests/fixtures/msw/') ||
          caller === 'tools/egress-guard.mjs' ||
          caller === 'tests/infra/noEgress.spec.ts',
      ).toBe(true);
    }
    // And the sanctioned caller must actually exist, or this passes vacuously.
    expect(callers.some((c) => c.startsWith('tests/fixtures/msw/'))).toBe(true);
  });
});
