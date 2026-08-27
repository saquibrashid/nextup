/**
 * `T-UNDO-009` — TASK-112 — an injected failure mid-undo leaves the batch
 * `applied` and NOTHING partially reversed (US-032 AC-6, `specs/api.md`
 * §6.25).
 *
 * ⚠ SEPARATE FILE, DELIBERATELY. Proving rollback needs `upsertServiceState`
 * to throw, and `vi.mock` is hoisted for a whole module graph — arming it
 * inside `test/integration/batchUndo.spec.ts` would put a throwing stub under
 * all fifteen of its cases. It is armed here by a flag that is off during the
 * close, so every write except the injected one is the real thing.
 *
 * ⚠ AND IT MUST BE AN INTEGRATION TEST. The claim is that the DATABASE rolled
 * back. An inline `runInTransaction` stub — which is what the unit twin uses —
 * would report the throw and leave every fake write applied, so the assertions
 * would pass against a service with no transaction at all. Only a real engine
 * can distinguish those.
 *
 * This is the one property whose failure mode is unrecoverable: SD-03 is a
 * HARD delete, so a half-applied undo destroys list rows and leaves the batch
 * looking un-undone, with no soft-deleted copy to restore from.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/** Armed only for the undo, so the close that sets the fixture up is real. */
const injected = { failServiceState: false };

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    upsertServiceState: (...args: Parameters<typeof actual.upsertServiceState>) => {
      if (injected.failServiceState) throw new Error('injected mid-undo failure');
      return actual.upsertServiceState(...args);
    },
  };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-undo-rollback';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
    ],
  }),
  'utf8',
).toString('base64');

const authed = {
  'content-type': 'application/json',
  [CLIENT_PRINCIPAL_HEADER]: principalHeader,
};

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

beforeEach(async () => {
  injected.failServiceState = false;
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  testPrisma();
  await resetDatabase();

  const { createApp } = await import('../../src/app.js');
  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const created = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: authed,
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  const body = (await created.json()) as { batchId: string };
  const row = await testPrisma().uploadBatch.findFirst({ where: { id: body.batchId } });
  ownerId = row?.ownerId ?? '';
  await resetDatabase();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-UNDO-009 · a failure mid-undo reverses nothing', () => {
  it('T-UNDO-009a: the batch stays applied and every created row survives', async () => {
    await testPrisma().uploadBatch.create({
      data: {
        id: 'batch-rb-1',
        ownerId,
        service: 'netflix',
        mode: 'append-only',
        status: 'in-review',
        lowYield: false,
        degradedExtraction: false,
        crossCheck: 'ok',
      },
    });
    await testPrisma().extractionCandidate.create({
      data: {
        id: 'rbcand-1',
        ownerId,
        batchId: 'batch-rb-1',
        rawText: 'Dune',
        inferredTitle: 'Dune',
        basis: 'both',
        ocrSupport: 'exact',
        provider: 'llm',
        normalisedText: 'dune',
        boxSource: 'llm',
        cleanupVerdict: 'title-candidate',
        resolvedWorkIdentity: 'tmdb:movie:438631',
        classification: 'new',
        reviewDisposition: 'confirmed',
        collapsedIntoCandidateId: null,
      },
    });

    const closed = await fetch(`${origin}/api/batches/batch-rb-1/close`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({}),
    });
    expect(closed.status).toBe(200);

    const titlesBefore = await testPrisma().title.count({ where: { ownerId } });
    const listingsBefore = await testPrisma().serviceListing.count({ where: { ownerId } });
    expect(titlesBefore).toBe(1);
    expect(listingsBefore).toBe(1);

    injected.failServiceState = true;
    const res = await fetch(`${origin}/api/batches/batch-rb-1/undo`, {
      method: 'POST',
      headers: authed,
    });
    expect(res.status).toBe(500);

    // ⚠ ALL THREE, not just the row count. A rollback that restored the rows
    // but left the batch `undone` would present the owner with an undone batch
    // whose titles are all still there and no way to undo it again.
    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(titlesBefore);
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(listingsBefore);

    const batch = await testPrisma().uploadBatch.findFirst({ where: { id: 'batch-rb-1' } });
    expect(batch?.status).toBe('applied');
    expect(batch?.undoneAt).toBeNull();
  });
});
