/**
 * `GET /api/me` — the §6.1 payload, over real HTTP: `T-ATTR-001` (API half).
 *
 * Driven through a listening server for the same reason as `authChain.spec.ts`:
 * the property under test is what reaches the WIRE. A disclaimer asserted on a
 * handler's argument object proves nothing about what JSON serialisation,
 * middleware or a later route rewrite actually sends.
 *
 * ⚠ Suffix allocation for `T-ATTR-001` is manual and shared across three
 * files — the web suite owns `a`–`g`, this file owns `h`–`j`, and
 * `packages/domain/test/attribution.spec.ts` owns `k`–`o`. The lint rule finds
 * duplicate ids only within a single file.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-me';

/**
 * Spelled out, not imported. Comparing the response to the constant it was
 * built from is a tautology; this is the independent copy that makes a reword
 * fail.
 */
const REQUIRED_WORDING = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

const principalHeader = (subject: string): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: OID, val: subject },
        { typ: 'preferred_username', val: 'owner@example.com' },
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let app: Express;
let origin: string;

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  delete process.env['NEXTUP_BOOTSTRAP_ALLOW_FIRST'];
  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

const getMe = async (): Promise<Record<string, unknown>> => {
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
};

describe('T-ATTR-001 GET /api/me serves the attribution payload', () => {
  it('T-ATTR-001h · US-011 AC-2 · the API value is byte-equal to the required wording', async () => {
    const body = await getMe();
    expect(body['attribution']).toStrictEqual({
      tmdbDisclaimer: REQUIRED_WORDING,
      tmdbLogoPath: '/assets/tmdb-logo.svg',
    });
  });

  it('T-ATTR-001i · specs/api.md §6.1 · the response carries every documented field', async () => {
    // The SPA reads all four. A field silently dropped by a later edit would
    // surface as an undefined in the shell rather than as a failure here.
    const body = await getMe();
    expect(Object.keys(body).sort()).toStrictEqual([
      'attribution',
      'displayName',
      'ownerId',
      'signOutUrl',
    ]);
    expect(body['ownerId']).toMatch(/^o_[0-9a-f]{16}$/);
    expect(body['signOutUrl']).toBe('/.auth/logout');
    expect(body['displayName']).toBe('owner@example.com');
  });

  it('T-ATTR-001j · US-011 AC-2 · the disclaimer survives JSON transport unaltered', async () => {
    // Asserted on the RAW body, before parsing: the risk this covers is an
    // encoding or escaping change on the wire, which `JSON.parse` would undo
    // before any deep-equality check could see it.
    const res = await fetch(`${origin}/api/me`, {
      headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
    });
    expect(await res.text()).toContain(JSON.stringify(REQUIRED_WORDING).slice(1, -1));
  });
});
