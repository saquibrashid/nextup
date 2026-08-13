/**
 * TASK-048 — `POST /api/batches` (`specs/api.md` §6.11).
 *
 * Integration, not unit: the 409 is enforced by a query against real batch
 * rows, and the property under test is "exactly one open batch per owner".
 * A stubbed repository would return whatever the stub was told to, which is
 * agreement rather than evidence.
 *
 * The requests go through the REAL app — auth chain, body parser and error
 * envelope included — because two of the assertions here (no default mode,
 * and the 409 body) are about what reaches the owner's browser, not about
 * what a handler returns in isolation.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { modeExplanation } from '@nextup/domain';
import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { asOwnerId } from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-batches';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (subject: string): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: subject },
        { typ: 'preferred_username', val: 'owner@example.com' },
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

interface BatchBody {
  batchId: string;
  service: string;
  mode: string;
  status: string;
  createdAt: string;
  modeExplanation: string;
}

/** POST with a valid principal and a JSON body, unless `raw` overrides it. */
const post = (body: unknown, raw?: string): Promise<Response> =>
  fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT),
    },
    body: raw ?? JSON.stringify(body),
  });

/** The owner id the auth chain will derive for `SUBJECT`. */
let ownerId: string;

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  // Derived once from a real 201 so the test never hard-codes the hash.
  const created = (await (await post({ service: 'netflix', mode: 'append-only' })).json()) as
    BatchBody | ErrorBody;
  const row = await testPrisma().uploadBatch.findFirst({
    where: { id: (created as BatchBody).batchId },
  });
  ownerId = row?.ownerId ?? '';
  await resetDatabase();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-BATCH-010 starting a batch requires an explicit service and mode', () => {
  it('T-BATCH-010a: a service and mode create a draft batch', async () => {
    const res = await post({ service: 'netflix', mode: 'full-update' });
    expect(res.status).toBe(201);

    const body = (await res.json()) as BatchBody;
    expect(body.service).toBe('netflix');
    expect(body.mode).toBe('full-update');
    expect(body.status).toBe('draft');
    expect(body.batchId).not.toBe('');
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
  });

  it('T-BATCH-010b: the response carries the mode consequence in words', async () => {
    const res = await post({ service: 'max', mode: 'full-update' });
    const body = (await res.json()) as BatchBody;

    // Sourced from the shared copy module so the sentence has ONE wording;
    // the assertion below is what stops the SPA re-typing it (US-003 AC-2).
    expect(body.modeExplanation).toBe(modeExplanation('full-update', 'max'));
    expect(body.modeExplanation).toContain('Max');
  });

  it('T-BATCH-010c: an omitted mode is a 400, NOT an implied append-only', async () => {
    // The safety property, not a validation nicety: the modes differ in
    // whether titles get REMOVED, so a default would pick a destructive or
    // non-destructive outcome on the owner's behalf without being asked.
    const res = await post({ service: 'netflix' });
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details['field']).toBe('mode');

    const batches = await testPrisma().uploadBatch.findMany({ where: { ownerId } });
    expect(batches).toHaveLength(0);
  });

  it('T-BATCH-010d: an omitted service is a 400', async () => {
    const res = await post({ mode: 'append-only' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.details['field']).toBe('service');
  });

  it('T-BATCH-010e: an unrecognised service or mode is a 400', async () => {
    const service = await post({ service: 'hulu', mode: 'append-only' });
    expect(service.status).toBe(400);

    const mode = await post({ service: 'netflix', mode: 'append' });
    expect(mode.status).toBe(400);

    const batches = await testPrisma().uploadBatch.findMany({ where: { ownerId } });
    expect(batches).toHaveLength(0);
  });

  it('T-BATCH-010f: the 400 does not echo the submitted value back', async () => {
    const res = await post({ service: '<img src=x onerror=alert(1)>', mode: 'append-only' });
    const raw = await res.text();
    expect(raw).not.toContain('onerror');
  });

  it('T-BATCH-010g: a malformed body is a 400, not a 500', async () => {
    // `express.json()` throws a bare `Error` on a truncated body, which the
    // envelope would otherwise classify as INTERNAL_ERROR and report as 500.
    const res = await post(undefined, '{"service":"netflix",');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('T-BATCH-015 only one batch may be open at a time', () => {
  /** Closes the open batch into `status` and asserts a new batch is allowed. */
  const expectClosedStatusAllowsNewBatch = async (status: string): Promise<void> => {
    const first = (await (
      await post({ service: 'netflix', mode: 'append-only' })
    ).json()) as BatchBody;
    await testPrisma().uploadBatch.updateMany({ where: { id: first.batchId }, data: { status } });

    const res = await post({ service: 'max', mode: 'full-update' });
    expect(res.status).toBe(201);
  };

  it('T-BATCH-015a: a second batch is refused while one is open', async () => {
    const first = (await (
      await post({ service: 'netflix', mode: 'append-only' })
    ).json()) as BatchBody;

    const res = await post({ service: 'max', mode: 'full-update' });
    expect(res.status).toBe(409);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('OPEN_BATCH_EXISTS');
    // The client needs the id to offer resume-or-discard rather than a dead
    // end, so the id is part of the contract, not diagnostic decoration.
    expect(body.error.details['batchId']).toBe(first.batchId);
    expect(body.error.details['service']).toBe('netflix');
    expect(body.error.details['mode']).toBe('append-only');

    const batches = await testPrisma().uploadBatch.findMany({ where: { ownerId } });
    expect(batches).toHaveLength(1);
  });

  it('T-BATCH-015b: a batch left in extraction-failed still counts as open', async () => {
    // US-006 AC-4: a failed extraction retains its images and offers a retry,
    // so the batch is still the owner's in-flight work. Treating it as closed
    // would strand those images behind a batch nobody can reach.
    const first = (await (
      await post({ service: 'netflix', mode: 'append-only' })
    ).json()) as BatchBody;
    await testPrisma().uploadBatch.updateMany({
      where: { id: first.batchId },
      data: { status: 'extraction-failed' },
    });

    const res = await post({ service: 'netflix', mode: 'append-only' });
    expect(res.status).toBe(409);
  });

  it('T-BATCH-015c: an applied batch does not block a new one', async () => {
    await expectClosedStatusAllowsNewBatch('applied');
  });

  it('T-BATCH-015d: an undone batch does not block a new one', async () => {
    await expectClosedStatusAllowsNewBatch('undone');
  });

  it('T-BATCH-015e: a discarded batch does not block a new one', async () => {
    await expectClosedStatusAllowsNewBatch('discarded');
  });

  it('T-BATCH-015f: another owner\u2019s open batch does not block this one', async () => {
    // The 409 must be scoped to the caller. An unscoped query would refuse a
    // legitimate batch, and would also disclose that another owner exists.
    await testPrisma().uploadBatch.create({
      data: {
        id: 'batch-other-owner',
        ownerId: asOwnerId('someone-else'),
        service: 'netflix',
        mode: 'append-only',
        status: 'draft',
      },
    });

    const res = await post({ service: 'netflix', mode: 'append-only' });
    expect(res.status).toBe(201);
  });

  it('T-BATCH-015g: the refused request creates nothing', async () => {
    await post({ service: 'netflix', mode: 'append-only' });
    await post({ service: 'max', mode: 'full-update' });

    const batches = await testPrisma().uploadBatch.findMany({ where: { ownerId } });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.service).toBe('netflix');
  });
});
