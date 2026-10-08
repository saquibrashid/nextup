/**
 * #396 (US-066, PRD `A57`, ADR-0010 Rev 6) — the auto-detect source at the API
 * boundary, and the review-time lookup's pure rules.
 *
 * `T-AUTO-010` mirrors `T-WAIT-001b/c`: the full-update refusal is by SOURCE
 * TYPE at `POST /api/batches`, never by a client flag. As there, the refusal
 * runs before the store, so a clean 400 against a project with no database is
 * itself the evidence it precedes the store.
 *
 * `T-AUTO-011` pins the lookup's outcome rules: `found` comes from `flatrate`
 * ALONE (a rent/buy offer never pre-selects a service), every matching
 * service of the owner's is proposed, a failure is a stored `failed` rather
 * than an exception, and the per-request cap holds.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_DETECT_FULL_UPDATE_REFUSAL } from '@nextup/domain';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  REVIEW_SERVICE_LOOKUP_PER_REQUEST,
  lookupOutcome,
  needsServiceLookup,
  runServiceLookups,
  storedLookupOutcome,
  tmdbRefFor,
  type LookupCandidateRow,
} from '../../src/services/autoDetectLookup.js';
import type { WatchProviderSource } from '../../src/services/watchAvailability.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-auto';

const principalHeader = (): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: OID, val: SUBJECT },
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let app: Express;
let origin: string;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const post = (body: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader() },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
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

describe('T-AUTO-010 · US-066 AC-2 · auto-detect + full update is refused at the boundary', () => {
  it('T-AUTO-010a: an explicit full update is refused with an explanation, not coerced', async () => {
    const res = await post({ source: 'auto', mode: 'full-update' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('FULL_UPDATE_NOT_AVAILABLE_FOR_SOURCE');
    expect(body.error.message).toBe(AUTO_DETECT_FULL_UPDATE_REFUSAL);
    expect(body.error.details['permittedModes']).toEqual(['append-only']);

    // The same source in the permitted mode gets past validation and fails
    // later, on the store this project does not have.
    const ok = await post({ source: 'auto', mode: 'append-only' });
    expect(ok.status).not.toBe(400);
    // ⚠ DISCRIMINATING: a named service may still run a full update.
    const named = await post({ service: 'netflix', mode: 'full-update' });
    expect(named.status).not.toBe(400);
  });

  it('T-AUTO-010b: the refusal is by source type, never by a client-supplied flag', async () => {
    const forgeries = [
      { source: 'auto', mode: 'full-update', autoDetect: false },
      { source: 'auto', mode: 'full-update', allowFullUpdate: true },
      { source: 'auto', mode: 'full-update', sourceType: 'service' },
      { service: 'auto', mode: 'full-update' },
    ];
    for (const body of forgeries) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe(
        'FULL_UPDATE_NOT_AVAILABLE_FOR_SOURCE',
      );
    }
  });
});

const row = (overrides: Partial<LookupCandidateRow> = {}): LookupCandidateRow => ({
  id: 'cand-1',
  resolvedWorkIdentity: 'tmdb:movie:438631',
  reviewDisposition: 'pending',
  collapsedIntoCandidateId: null,
  serviceLookupStatus: null,
  serviceLookupIdentity: null,
  ...overrides,
});

describe('T-AUTO-011 · US-066 AC-3/AC-4/AC-5 · the review-time lookup outcome', () => {
  it('T-AUTO-011a: one match, several matches, none, and no provider data', () => {
    expect(lookupOutcome({ flatrate: ['Netflix'], rentOrBuy: [] }, ['netflix', 'max'])).toEqual({
      status: 'found',
      services: ['netflix'],
    });
    // Every matching service of the owner's, in SERVICES order (AC-4).
    expect(
      lookupOutcome({ flatrate: ['Max', 'Netflix Standard with Ads'], rentOrBuy: [] }, [
        'netflix',
        'max',
      ]),
    ).toEqual({ status: 'found', services: ['netflix', 'max'] });
    // Streaming, but on none of the owner's services → `none` (AC-5).
    expect(lookupOutcome({ flatrate: ['Peacock'], rentOrBuy: [] }, ['netflix'])).toEqual({
      status: 'none',
      services: [],
    });
    // ⚠ A rent/buy offer never pre-selects a service.
    expect(lookupOutcome({ flatrate: [], rentOrBuy: ['Netflix'] }, ['netflix'])).toEqual({
      status: 'none',
      services: [],
    });
    // TMDB has no provider data at all: not known, so nothing proposed.
    expect(lookupOutcome(null, ['netflix'])).toEqual({ status: 'unknown', services: [] });
  });

  it('T-AUTO-011b: what needs a lookup — never, stale identity, and an explicit retry', () => {
    expect(needsServiceLookup(row(), 'missing')).toBe(true);
    const done = { serviceLookupStatus: 'found', serviceLookupIdentity: 'tmdb:movie:438631' };
    expect(needsServiceLookup(row(done), 'missing')).toBe(false);
    // The owner corrected the match since: the old answer is stale.
    expect(
      needsServiceLookup(row({ ...done, resolvedWorkIdentity: 'tmdb:movie:949' }), 'missing'),
    ).toBe(true);
    const failed = { ...done, serviceLookupStatus: 'failed' };
    expect(needsServiceLookup(row(failed), 'missing')).toBe(false);
    expect(needsServiceLookup(row(failed), 'retry')).toBe(true);
    expect(needsServiceLookup(row(done), 'retry')).toBe(false);
    // Discarded, collapsed and unmatched rows are never looked up.
    expect(needsServiceLookup(row({ reviewDisposition: 'discarded' }), 'retry')).toBe(false);
    expect(needsServiceLookup(row({ collapsedIntoCandidateId: 'c0' }), 'retry')).toBe(false);
    expect(needsServiceLookup(row({ resolvedWorkIdentity: null }), 'retry')).toBe(false);
    expect(tmdbRefFor('tmdb:tv:1399')).toEqual({ mediaType: 'tv', tmdbId: 1399 });
    expect(tmdbRefFor('manual:abc')).toBeNull();
  });

  it('T-AUTO-011c: a thrown lookup is a stored failure, never an exception; the cap holds', async () => {
    const calls: number[] = [];
    const source: WatchProviderSource = {
      getWatchOffers: (_mediaType: 'movie' | 'tv', tmdbId: number) => {
        calls.push(tmdbId);
        if (tmdbId === 2) return Promise.reject(new Error('timeout'));
        return Promise.resolve({ flatrate: ['Netflix'], rentOrBuy: ['Apple TV'] });
      },
    } as WatchProviderSource;
    const now = new Date('2026-10-01T00:00:00Z');
    const rows = Array.from({ length: REVIEW_SERVICE_LOOKUP_PER_REQUEST + 5 }, (_, index) =>
      row({ id: `c${String(index + 1)}`, resolvedWorkIdentity: `tmdb:movie:${String(index + 1)}` }),
    );
    const writes = await runServiceLookups(rows, source, ['netflix'], now);
    expect(calls).toHaveLength(REVIEW_SERVICE_LOOKUP_PER_REQUEST);
    expect(writes).toHaveLength(REVIEW_SERVICE_LOOKUP_PER_REQUEST);
    expect(writes[0]).toEqual({
      id: 'c1',
      serviceLookupStatus: 'found',
      serviceLookupIdentity: 'tmdb:movie:1',
      serviceLookupAt: now,
      lookedUpAvailableOn: '["Netflix"]',
      lookedUpRentOn: '["Apple TV"]',
    });
    expect(writes[1]).toMatchObject({
      id: 'c2',
      serviceLookupStatus: 'failed',
      lookedUpAvailableOn: null,
      lookedUpRentOn: null,
    });
  });

  it('T-AUTO-011d: a stored answer is re-read against the owner CURRENT services', () => {
    const stored = { serviceLookupStatus: 'found', lookedUpAvailableOn: '["Netflix","Max"]' };
    expect(storedLookupOutcome(stored, ['netflix'])).toEqual({
      status: 'found',
      services: ['netflix'],
    });
    expect(storedLookupOutcome(stored, ['netflix', 'max'])?.services).toEqual(['netflix', 'max']);
    expect(storedLookupOutcome(stored, ['peacock'])).toEqual({ status: 'none', services: [] });
    expect(
      storedLookupOutcome({ serviceLookupStatus: 'failed', lookedUpAvailableOn: null }, []),
    ).toEqual({ status: 'failed', services: [] });
    expect(
      storedLookupOutcome({ serviceLookupStatus: null, lookedUpAvailableOn: null }, []),
    ).toBeNull();
  });
});
