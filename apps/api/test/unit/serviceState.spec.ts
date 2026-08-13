/**
 * `GET /api/service-state` — the §6.28 payload (US-022, REQ-039, TASK-041).
 *
 * Driven over real HTTP with the repository mocked. The property that matters
 * most here is a property of the RESPONSE ARRAY rather than of the store:
 * every service appears, always, whatever the store holds. A handler test that
 * only checked the rows it was given could not see a missing service at all.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toServiceStateItems } from '../../src/routes/serviceState.js';

const listServiceStates = vi.fn();

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return { ...actual, listServiceStates: (...a: unknown[]) => listServiceStates(...a) as unknown };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-service-state';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

interface Item {
  service: string;
  lastCompletedBatchAt: string | null;
  lastCompletedBatchId: string | null;
  ageDays: number | null;
  label: string;
}

let server: Server;
let app: Express;
let origin: string;

const get = async (): Promise<Item[]> => {
  const res = await fetch(`${origin}/api/service-state`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { services: Item[] }).services;
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  listServiceStates.mockResolvedValue([]);

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/service-state', () => {
  it('T-FRESH-012c · US-022 AC-3 · an empty store still returns EVERY service', async () => {
    const services = await get();

    // ⚠ The SPA renders one chip per array entry. Omitting a never-captured
    // service makes its chip vanish, and a missing chip reads as "nothing to
    // report" rather than "never updated" — the precise misreading AC-3
    // exists to prevent.
    expect(services.map((s) => s.service)).toEqual(['netflix', 'max']);
    for (const item of services) {
      expect(item.lastCompletedBatchAt).toBeNull();
      expect(item.ageDays).toBeNull();
      expect(item.label).toContain('has never been updated');
    }
  });

  it('T-FRESH-010g · US-022 AC-1 · a captured service reports its date and id', async () => {
    listServiceStates.mockResolvedValue([
      {
        service: 'netflix',
        lastCompletedBatchAt: new Date('2026-08-10T20:19:44.007Z'),
        lastCompletedBatchId: 'b-001',
      },
    ]);

    const services = await get();
    const netflix = services.find((s) => s.service === 'netflix');
    expect(netflix?.lastCompletedBatchAt).toBe('2026-08-10T20:19:44.007Z');
    expect(netflix?.lastCompletedBatchId).toBe('b-001');
    expect(typeof netflix?.ageDays).toBe('number');
  });

  it('T-FRESH-012d · one captured service does not mask the other', async () => {
    listServiceStates.mockResolvedValue([
      {
        service: 'netflix',
        lastCompletedBatchAt: new Date('2026-08-13T00:00:00.000Z'),
        lastCompletedBatchId: 'b-001',
      },
    ]);

    const services = await get();
    // The mixed state is the realistic one and the easiest to get wrong: a
    // handler mapping over the STORE rows rather than the service enumeration
    // returns one entry and passes every single-service assertion.
    expect(services).toHaveLength(2);
    expect(services.find((s) => s.service === 'max')?.label).toBe('Max has never been updated');
  });

  it('T-FRESH-015c · A46 · the payload carries NO staleness field of any kind', async () => {
    listServiceStates.mockResolvedValue([
      {
        service: 'netflix',
        lastCompletedBatchAt: new Date('2020-01-01T00:00:00.000Z'),
        lastCompletedBatchId: 'b-old',
      },
    ]);

    const services = await get();
    // A five-year-old date is the case a reintroduced nudge would light up.
    // REQ-040 and ASM-038 are retired; `stalenessThresholdDays` and a derived
    // `stale` flag must not reappear, and asserting the exact key set is what
    // makes an addition fail rather than pass unnoticed.
    for (const item of services) {
      expect(Object.keys(item).sort()).toEqual([
        'ageDays',
        'label',
        'lastCompletedBatchAt',
        'lastCompletedBatchId',
        'service',
      ]);
    }
  });
});

describe('toServiceStateItems', () => {
  it('T-FRESH-012f · it reports only what the store holds, inventing no date', async () => {
    // Abandoned and failed batches never write `serviceState` — that is the
    // batch-close path's job, asserted there. This function must not invent a
    // date from anything else in scope, so an empty store yields nulls.
    expect(toServiceStateItems([], new Date('2026-08-13T00:00:00.000Z'))).toEqual([
      {
        service: 'netflix',
        lastCompletedBatchAt: null,
        lastCompletedBatchId: null,
        ageDays: null,
        label: 'Netflix has never been updated',
      },
      {
        service: 'max',
        lastCompletedBatchAt: null,
        lastCompletedBatchId: null,
        ageDays: null,
        label: 'Max has never been updated',
      },
    ]);
  });

  it('T-FRESH-010h · `now` is injected, so ageDays is deterministic', () => {
    const items = toServiceStateItems(
      [
        {
          service: 'max',
          lastCompletedBatchAt: new Date('2026-06-27T12:00:00.000Z'),
          lastCompletedBatchId: 'b-2',
        },
      ],
      new Date('2026-08-13T12:00:00.000Z'),
    );

    const max = items.find((i) => i.service === 'max');
    expect(max?.ageDays).toBe(47);
    expect(max?.label).toBe('Max updated 47 days ago');
  });

  it('T-FRESH-012e · an unknown service in the store is ignored', () => {
    // Defensive against a service being retired from `SERVICES` while rows
    // survive: the strip must keep rendering the services that exist rather
    // than growing a chip for one the product no longer has.
    const items = toServiceStateItems(
      [
        {
          service: 'hulu',
          lastCompletedBatchAt: new Date('2026-08-13T00:00:00.000Z'),
          lastCompletedBatchId: 'b-3',
        },
      ],
      new Date('2026-08-13T00:00:00.000Z'),
    );

    expect(items.map((i) => i.service)).toEqual(['netflix', 'max']);
  });
});
