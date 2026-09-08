/**
 * TASK-183 — a discovery source is structurally append-only (ADR-0010 D-2,
 * REQ-083, US-040 AC-1/AC-6). `T-WAIT-001` a–c.
 *
 * Unit rather than integration for the same reason `batchesValidation.spec.ts`
 * is: the refusal runs BEFORE the open-batch lookup, so every case here is
 * reachable with no database at all. That is also why a clean 400 is itself
 * evidence the refusal precedes the store — this project is configured with no
 * store, so reaching one would surface as a connection error, not a 400.
 *
 * ⚠ WHY THIS EXISTS AT ALL. The Fandango at Home new-release page is an
 * editorial feed, identical for every visitor and rotating continuously. A
 * title's absence from a later capture means only that it is no longer new.
 * Reconciled as a `full-update`, the second capture would propose the owner's
 * ENTIRE waiting list for removal — every time.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISCOVERY_SOURCES,
  SERVICES,
  discoverySourcesAreNotServices,
  forcedModeFor,
  isDiscoverySource,
  modeRefusalFor,
  requireServiceOf,
  splitBatchSource,
} from '@nextup/domain';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-discovery';

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

describe('T-WAIT-001 a discovery batch is forced append-only', () => {
  it('T-WAIT-001a: the mode a discovery source is allowed is append-only, and only that', () => {
    for (const source of DISCOVERY_SOURCES) {
      expect(forcedModeFor(source)).toBe('append-only');
      expect(modeRefusalFor(source, 'append-only')).toBeNull();
      expect(modeRefusalFor(source, 'full-update')).not.toBeNull();
    }

    // ⚠ VACUITY GUARD. Every assertion above passes trivially if
    // `DISCOVERY_SOURCES` is empty, and an empty tuple is exactly what a
    // "tidy-up" of an unused enum would leave behind.
    expect(DISCOVERY_SOURCES.length).toBeGreaterThan(0);

    // ⚠ THE DISCRIMINATING HALF. Without this, everything above passes against
    // a build that forces EVERY batch append-only — which would silently
    // disable full-update reconciliation for Netflix and Max, the product's
    // entire removal mechanism.
    for (const service of SERVICES) {
      expect(forcedModeFor(service)).toBeNull();
      expect(modeRefusalFor(service, 'full-update')).toBeNull();
      expect(modeRefusalFor(service, 'append-only')).toBeNull();
    }
  });

  it('T-WAIT-001b: an explicit full-update is refused at the API boundary, with an explanation', async () => {
    const res = await post({ service: 'fandango-at-home', mode: 'full-update' });

    // Refused, not silently coerced. Quietly "fixing" the mode would tell the
    // owner their full update succeeded while it did something else.
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('FULL_UPDATE_NOT_AVAILABLE_FOR_SOURCE');

    // ⚠ EXPLANATORY, not merely a rejection (US-040 AC-6). The owner has to
    // learn this is a property of the source, not a transient failure they can
    // retry past — so the message must say WHY, and name the consequence.
    expect(body.error.message).toMatch(/append-only/i);
    expect(body.error.message).toMatch(/editorial feed|not a list you curated/i);
    expect(body.error.message).toMatch(/removing everything you are waiting for/i);
    expect(body.error.details['permittedModes']).toEqual(['append-only']);

    // And the same source in the permitted mode is NOT refused here: it gets
    // past validation and fails later, on the store this project does not have.
    const ok = await post({ service: 'fandango-at-home', mode: 'append-only' });
    expect(ok.status).not.toBe(400);
  });

  it('T-WAIT-001c: the refusal is by source type, never by a client-supplied flag', async () => {
    // ⚠ THIS IS THE CASE A UI-ONLY GUARD FAILS, and the reason the check lives
    // at the boundary rather than in the SPA's mode picker. A caller crafting
    // the request directly gets no picker to be constrained by.
    //
    // Each body below asserts, in a different way, that the batch is really a
    // permitted full update. None of them may be believed.
    const forgeries = [
      { service: 'fandango-at-home', mode: 'full-update', discovery: false },
      { service: 'fandango-at-home', mode: 'full-update', isDiscoverySource: false },
      { service: 'fandango-at-home', mode: 'full-update', allowFullUpdate: true },
      { service: 'fandango-at-home', mode: 'full-update', sourceType: 'service' },
      { source: 'fandango-at-home', mode: 'full-update', service: 'netflix' },
    ];

    for (const body of forgeries) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe(
        'FULL_UPDATE_NOT_AVAILABLE_FOR_SOURCE',
      );
    }
  });

  it('T-WAIT-001d: a discovery source is not a service, and splits into the exclusive columns', () => {
    // ⚠ D-1 ASSERTED LIVE. If a discovery source were ever added to `SERVICES`,
    // every guarantee in this file evaporates silently: `isDiscoverySource`
    // still answers true, the refusal still fires, and the batch is ALSO a
    // service batch with a badge and a reconciliation path.
    expect(discoverySourcesAreNotServices()).toBe(true);
    expect(SERVICES).toEqual(['netflix', 'max']);

    for (const source of DISCOVERY_SOURCES) {
      expect(isDiscoverySource(source)).toBe(true);
      const split = splitBatchSource(source);
      expect(split.service).toBeNull();
      expect(split.discoverySource).toBe(source);

      // ⚠ Service-scoped paths must REFUSE a discovery batch, loudly. Silently
      // returning some service here is how a discovery batch would end up
      // reconciled against Netflix's saved list.
      expect(() =>
        requireServiceOf({
          id: 'b1',
          service: split.service,
          discoverySource: split.discoverySource,
        }),
      ).toThrow(/discovery batch/i);
    }

    for (const service of SERVICES) {
      expect(isDiscoverySource(service)).toBe(false);
      const split = splitBatchSource(service);
      expect(split.service).toBe(service);
      expect(split.discoverySource).toBeNull();
      expect(
        requireServiceOf({
          id: 'b2',
          service: split.service,
          discoverySource: split.discoverySource,
        }),
      ).toBe(service);
    }
  });
});
