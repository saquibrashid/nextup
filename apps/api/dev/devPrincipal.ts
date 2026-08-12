/**
 * TASK-021 — the local development principal shim (`specs/security.md` §2.3).
 *
 * ⚠ THIS FILE MUST NEVER REACH PRODUCTION. It fabricates an authenticated
 * identity from an environment variable. In production that is a total
 * authentication bypass.
 *
 * It exists because Easy Auth runs at the Container Apps edge and there is no
 * local equivalent: without a shim, nothing under `/api` can be exercised on a
 * developer machine at all.
 *
 * HOW IT IS EXCLUDED — and why this way.
 *
 * The mechanism is STRUCTURAL: this file lives outside `apps/api/src`, and the
 * production `tsconfig.json` compiles `src/**` only. There is no exclude list
 * to maintain and no build flag to get wrong; the compiler cannot emit this
 * file into `dist` because it never sees it. Nothing under `src` imports it —
 * `createApp` takes the principal reader as a parameter, so the shim is
 * injected from this side of the boundary rather than reached from that side.
 *
 * That is deliberately stronger than the two obvious alternatives:
 *
 *  - A RUNTIME flag (`if (process.env.NODE_ENV !== 'production')`) ships the
 *    bypass and leaves one environment variable between an attacker and any
 *    identity they care to name. A misconfigured or unset `NODE_ENV` — the
 *    default state of a bare `node dist/index.js` — takes the dev branch.
 *  - An EXCLUDE LIST in a separate build config is a denylist: it protects the
 *    files someone remembered to add to it, and silently fails to protect the
 *    next dev-only file added beside this one.
 *
 * `T-SEC-019` builds the production output and asserts the strings
 * `devPrincipal`, `NEXTUP_DEV_SUBJECT` and `readDevPrincipal` appear nowhere in
 * `apps/api/dist/**`. It blocks the merge. Moving this file under `src` — the
 * one change that would defeat the structural guarantee — makes it fail.
 *
 * The `NODE_ENV` check below is belt-and-braces, NOT the control. If it is ever
 * the only thing standing between this code and production, the real control
 * has already failed.
 */

import type { Principal } from '../src/auth/principal.js';

const DEV_SUBJECT_VAR = 'NEXTUP_DEV_SUBJECT';

/** A local-only issuer. Distinct from any real one, so ids cannot collide. */
export const DEV_ISSUER = 'https://localhost/dev';

/**
 * @returns a synthetic principal for local development, or `null` when
 * `NEXTUP_DEV_SUBJECT` is unset — so the default local experience is still
 * "signed out", not "signed in as someone".
 */
export function readDevPrincipal(): Principal | null {
  if (process.env['NODE_ENV'] === 'production') return null;

  const subject = process.env[DEV_SUBJECT_VAR];
  if (subject === undefined || subject.trim().length === 0) return null;

  return {
    issuer: DEV_ISSUER,
    subject: subject.trim(),
    email: `${subject.trim()}@localhost.dev`,
  };
}
