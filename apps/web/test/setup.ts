/**
 * Component-test setup (TASK-002). Adds jest-dom matchers and clears the DOM
 * between tests so state cannot leak from one screen state to the next.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
  ⚠ THIS RAISES A TIMEOUT, IT DOES NOT WEAKEN AN ASSERTION.

  Testing Library's default `asyncUtilTimeout` is 1000 ms, which is a budget
  for a *loaded CI runner* rather than for the code under test. `T-UX-015r`
  failed in CI at 1101 ms and passed on re-run, twice, having never failed
  locally — the element it waits for does appear, just after a GitHub-hosted
  runner has finished scheduling twelve parallel jobs.

  A `waitFor` that times out too early produces the most expensive kind of
  red build: it names a real test and a real element, so it reads exactly
  like a genuine regression, and the only way to tell the difference is to
  re-run and see it pass. Every `waitFor` still fails if its condition never
  becomes true; they simply get enough headroom that a slow runner is not
  reported as a broken app.
*/
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
