/**
 * Global test setup — the network egress guard (TASK-128, `T-CI-007`).
 *
 * ⚠ Installed here, ONCE PER TEST FILE VIA `setupFiles`, rather than inside
 * individual suites. A guard each suite opts into only proves the guard
 * works; it proves nothing about the suites that FORGOT to opt in — and those
 * are precisely the ones that would reach the network. `specs/testing.md` §3
 * requires CI to make zero outbound requests, which is a property of the whole
 * run, so it has to be switched on from the run's configuration.
 *
 * Loopback stays allowed: the API suites drive a real listening server on an
 * ephemeral port and the integration suites talk to mssql and Azurite on
 * localhost. Blocking those would break the tests without improving the
 * property under test — none of them leaves the machine. (mssql speaks TDS
 * over a raw socket and never reaches `http.request` at all.)
 *
 * This does not replace `msw`. `msw` supplies the recorded TMDB bodies a test
 * asserts on; the guard is the backstop that turns a MISSING fake into a loud
 * failure instead of a silent live request.
 */

import { afterAll, beforeAll, expect } from 'vitest';

import {
  installEgressGuard,
  isEgressGuardInstalled,
  uninstallEgressGuard,
} from './tools/egress-guard.mjs';

/**
 * The guard's own suite installs and uninstalls it deliberately and asserts on
 * `isEgressGuardInstalled()` in both states. Pre-installing underneath it
 * would make its "not installed yet" assertions fail — switching the guard on
 * would break the test that PROVES the guard works, which is the worst
 * possible trade. Every other file is guarded.
 */
const SELF_TEST = 'noEgress.spec.ts';

let installedHere = false;

beforeAll(() => {
  const testPath = expect.getState().testPath ?? '';
  if (testPath.includes(SELF_TEST)) return;
  if (isEgressGuardInstalled()) return;
  installEgressGuard();
  installedHere = true;
});

afterAll(() => {
  if (installedHere) uninstallEgressGuard();
  installedHere = false;
});
