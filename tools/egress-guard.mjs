/**
 * Network-egress guard for the test suite (TASK-128 — `T-CI-007`).
 *
 * `specs/testing.md` §3 is unambiguous: **no network egress in CI.** TMDB is
 * `msw` against committed fixtures, the extractors replay committed HTTP
 * recordings, and *"no test in CI ever calls Azure OpenAI or Azure AI Vision"*
 * — the live suite (§4A) is manual and **costs money**.
 *
 * That is a property of the whole suite, and a property nobody can hold in
 * their head. One `fetch` left un-mocked in one test turns a deterministic
 * offline run into a flaky, billable one — and it fails in the direction that
 * looks like success: the test passes, on live data, until the day the network
 * or the quota is not there.
 *
 * This guard makes the property enforceable at runtime. It replaces `fetch`
 * and the two Node HTTP request functions with wrappers that permit loopback
 * (the integration suite's own SQL Server, Azurite and ephemeral test servers)
 * and refuse everything else, recording every attempt so a test can assert
 * that the count is zero.
 *
 * ⚠ **Loopback is allowed and must stay allowed.** The integration suite talks
 * to `localhost:1433` and starts real listening servers on `127.0.0.1`. A
 * guard that blocked those would be removed within a day. "No egress" means no
 * packet leaves the machine, not "no sockets".
 *
 * ⚠ **This module is inert until `installEgressGuard()` is called.** Wiring it
 * into every Vitest project needs `vitest.config.ts` (`setupFiles`), which is
 * outside this lane's writable paths — see the lane report. Everything below
 * is asserted by `tests/infra/noEgress.spec.ts` regardless, so the guard is
 * proven to work before it is switched on.
 */

import http from 'node:http';
import https from 'node:https';

/**
 * Hosts that never leave the machine. Loopback in all its spellings, plus the
 * docker-compose service names the CI store and blob emulator resolve to.
 */
export const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'mssql',
  'azurite',
  'host.docker.internal',
]);

/** Every attempt seen since the guard was installed. */
const attempts = [];

/**
 * Hosts an `msw` interceptor is currently serving from committed recordings.
 *
 * ⚠ WHY THIS EXISTS, AND WHY IT IS NOT A HOLE.
 *
 * `msw` intercepts `fetch` by REPLACING it, so a mocked `fetch` never reaches
 * this guard at all — which is why the TMDB suite needs nothing here. It
 * cannot do the same for `http.request`: to hand back a `ClientRequest`
 * object at all it must call the real `http.request`, having first swapped
 * the socket for a mock. The bytes never leave the machine, but this guard
 * sees a request to a public hostname and cannot tell the two apart.
 *
 * That matters for the extractor suites (`T-AI-033`): the Azure SDKs use
 * `@azure/core-rest-pipeline`, which speaks `https.request`, not `fetch`.
 * Without this seam an offline, fully-recorded suite is indistinguishable
 * from a live one.
 *
 * ⚠ THE SEAM IS NARROW BY CONSTRUCTION. A registered host is recorded as
 * `mocked`, never as `blocked` — because no packet leaves — but it is still
 * recorded, so `egressAttempts()` remains a complete log. The only sanctioned
 * callers are the `msw` fixture modules under `tests/fixtures/msw/**`, and
 * `T-CI-007a` fails if anything else calls it. Registering a host without an
 * `msw` server listening on `onUnhandledRequest: 'error'` would let a REAL
 * request through — which is precisely why registration lives next to the
 * server that guarantees it.
 */
const mockedHosts = new Set();

/** @param {string} host */
export function registerMockedHost(host) {
  mockedHosts.add(String(host).toLowerCase());
}

/** @param {string} host */
export function unregisterMockedHost(host) {
  mockedHosts.delete(String(host).toLowerCase());
}

export function clearMockedHosts() {
  mockedHosts.clear();
}

export function isMockedHost(host) {
  if (host === undefined || host === null || host === '') return false;
  return mockedHosts.has(String(host).toLowerCase());
}

let installed = false;
let originalFetch;
let originalHttpRequest;
let originalHttpsRequest;

export function isLoopback(host) {
  if (host === undefined || host === null || host === '') return false;
  const bare = String(host)
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split(':')[0];
  return LOOPBACK_HOSTS.has(bare) || LOOPBACK_HOSTS.has(String(host).toLowerCase());
}

/** Best-effort host extraction from the many shapes Node accepts. */
export function hostOf(target, options) {
  if (typeof target === 'string') {
    try {
      return new URL(target).hostname;
    } catch {
      // A relative path carries no host — the host is in `options`, which is
      // exactly how `http.request('/path', { hostname })` is called. Returning
      // the path here would report "/v1/x" as a hostname and let the real
      // destination through unrecorded.
      const fromOptions = hostFromOptions(options);
      return fromOptions ?? target;
    }
  }
  if (target instanceof URL) return target.hostname;
  if (target && typeof target === 'object') {
    const o = target;
    if (typeof o.url === 'string') {
      try {
        return new URL(o.url).hostname;
      } catch {
        return o.url;
      }
    }
    if (o.hostname) return String(o.hostname);
    if (o.host) return String(o.host).split(':')[0];
  }
  return hostFromOptions(options);
}

function hostFromOptions(options) {
  if (options && typeof options === 'object') {
    if (options.hostname) return String(options.hostname);
    if (options.host) return String(options.host).split(':')[0];
  }
  return undefined;
}

export class EgressBlockedError extends Error {
  constructor(host) {
    super(
      `Network egress to "${host}" was blocked. The test suite runs OFFLINE ` +
        `(specs/testing.md §3): TMDB is msw against committed fixtures, the ` +
        `extractors replay committed recordings, and no CI test ever calls ` +
        `Azure OpenAI or Azure AI Vision — the live suite is manual and costs ` +
        `money. Mock this call, or move the test to the manual §4A suite ` +
        `(T-CI-007).`,
    );
    this.name = 'EgressBlockedError';
    this.host = host;
  }
}

/** @returns {{host: string, blocked: boolean, via: string}[]} */
export function egressAttempts() {
  return attempts.slice();
}

/** Attempts that were NOT loopback and NOT served from a recording — the ones
 * `T-CI-007` requires to be zero. */
export function blockedAttempts() {
  return attempts.filter((a) => a.blocked);
}

/** Attempts an `msw` interceptor served from a committed recording. */
export function mockedAttempts() {
  return attempts.filter((a) => a.mocked);
}

export function resetEgressAttempts() {
  attempts.length = 0;
}

function record(host, via) {
  const mocked = isMockedHost(host);
  const blocked = !mocked && !isLoopback(host);
  attempts.push({ host: host ?? '<unknown>', blocked, mocked, via });
  return blocked;
}

/**
 * Install the guard. Idempotent.
 *
 * @param {{throwOnEgress?: boolean}} [options] when `throwOnEgress` is false
 *   the attempt is recorded but allowed through — used only to prove the
 *   recorder itself works without making a real request.
 */
export function installEgressGuard(options = {}) {
  const throwOnEgress = options.throwOnEgress !== false;
  if (installed) return;
  installed = true;

  originalFetch = globalThis.fetch;
  originalHttpRequest = http.request;
  originalHttpsRequest = https.request;

  globalThis.fetch = function guardedFetch(input, init) {
    const host = hostOf(input, init);
    if (record(host, 'fetch') && throwOnEgress) {
      return Promise.reject(new EgressBlockedError(host));
    }
    return originalFetch.call(this, input, init);
  };

  const guard = (original, via) =>
    function guardedRequest(target, optionsOrCb, maybeCb) {
      const opts = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
      const host = hostOf(target, opts);
      if (record(host, via) && throwOnEgress) {
        throw new EgressBlockedError(host);
      }
      return original.call(this, target, optionsOrCb, maybeCb);
    };

  http.request = guard(originalHttpRequest, 'http.request');
  https.request = guard(originalHttpsRequest, 'https.request');
}

export function uninstallEgressGuard() {
  if (!installed) return;
  installed = false;
  globalThis.fetch = originalFetch;
  http.request = originalHttpRequest;
  https.request = originalHttpsRequest;
}

export function isEgressGuardInstalled() {
  return installed;
}
