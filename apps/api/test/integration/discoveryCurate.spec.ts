/**
 * TASK-186 — curating a discovery capture down to what the owner wants
 * (US-041, REQ-085, ADR-0010 D-5).
 *
 * `T-WAIT-006` (discard suppresses) and `T-WAIT-007` (a suppression failure
 * rolls the whole close back).
 *
 * ⚠ `T-WAIT-006b` IS THE POINT OF THE FILE, and US-041 AC-4 names it
 * explicitly: capture the same page twice with a discard in between and prove
 * the second review pass does not contain the discarded work AT ALL. Without
 * it, `T-WAIT-006a` passes against a build that writes a suppression nothing
 * ever reads — and a rotating editorial feed re-presents the same rejects on
 * every capture until the review pass is unusable.
 *
 * ⚠ `T-WAIT-006c` is the discriminating case. Every assertion here would pass
 * just as happily against a build that suppresses EVERY discard, including on
 * a Netflix saved list, where it would silently hide works the owner only
 * meant to skip once.
 *
 * Integration level throughout: the claims are about what the store holds
 * across two separate requests, which is exactly what a mocked store cannot
 * show.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/**
 * A fault injected INSIDE the close transaction (US-041 AC-6, `T-WAIT-007`).
 *
 * ⚠ There is no way to prove atomicity from the outside without one. The
 * suppression write is the LAST thing the discovery close does before the
 * batch transition, so by the time it throws every title and every intent has
 * already been inserted — and only a real rollback can remove them. An
 * implementation that wrote suppressions after the commit would pass every
 * other test in this file.
 */
let failSuppression = false;

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    createSuppression: async (...args: Parameters<typeof actual.createSuppression>) => {
      if (failSuppression) throw new Error('injected suppression failure');
      return actual.createSuppression(...args);
    },
  };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const ISSUER = 'https://sts.windows.net/tenant/';
const SUBJECT = 'oid-owner-curate';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: ISSUER },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

const DUNE = 'tmdb:movie:438631';
const HEAT = 'tmdb:movie:949';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

const authed = { [CLIENT_PRINCIPAL_HEADER]: principalHeader };

const closeBatchRequest = (batchId: string, body: unknown = {}): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authed },
    body: JSON.stringify(body),
  });

const reviewRequest = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/review`, { headers: authed });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;
let candidateSeq = 0;

async function makeBatch(kind: 'discovery' | 'netflix', mode = 'append-only'): Promise<string> {
  const id = `batch-cur-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: kind === 'netflix' ? 'netflix' : null,
      discoverySource: kind === 'discovery' ? 'fandango-at-home' : null,
      mode,
      status: 'in-review',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

async function makeCandidate(
  batchId: string,
  workIdentity: string,
  name: string,
  disposition = 'confirmed',
): Promise<string> {
  const id = `cand-cur-${++candidateSeq}`;
  await testPrisma().extractionCandidate.create({
    data: {
      id,
      ownerId,
      batchId,
      rawText: name,
      inferredTitle: name,
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: name.toLowerCase(),
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: workIdentity,
      reviewDisposition: disposition,
      collapsedIntoCandidateId: null,
      matchCandidates: JSON.stringify([
        {
          tmdbId: Number(workIdentity.split(':')[2]),
          mediaType: 'movie',
          name,
          releaseYear: 2021,
          posterPath: '/p.jpg',
          score: 1,
        },
      ]),
    },
  });
  return id;
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  failSuppression = false;
  batchSeq = 0;
  candidateSeq = 0;
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = '';
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await fetch(`${origin}/api/me`, { headers: authed });
  ownerId = ((await res.json()) as { ownerId: string }).ownerId;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe('T-WAIT-006 · US-041 AC-2/3/4/5 · discard suppresses, on a discovery capture only', () => {
  it('T-WAIT-006a · a discarded discovery candidate creates a Suppression on canonical work identity', async () => {
    const batch = await makeBatch('discovery');
    await makeCandidate(batch, DUNE, 'Dune', 'discarded');
    await makeCandidate(batch, HEAT, 'Heat', 'confirmed');

    const res = await closeBatchRequest(batch);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { discarded: number };
      discovery?: { suppressionsCreated: number; intentsCreated: number };
    };
    expect(body.summary.discarded).toBe(1);
    expect(body.discovery?.suppressionsCreated).toBe(1);
    // The confirmed one still became an intent — curation removes the reject,
    // it does not abandon the capture.
    expect(body.discovery?.intentsCreated).toBe(1);

    const suppressions = await testPrisma().suppression.findMany({ where: { ownerId } });
    expect(suppressions).toHaveLength(1);
    // ⚠ KEYED ON WORK IDENTITY, never on the candidate row id (REQ-071,
    // product invariant 1). A row-scoped key appears to work and then quietly
    // stops, because a reappearing title is a brand-new row.
    expect(suppressions[0]?.workIdentity).toBe(DUNE);
    expect(suppressions[0]?.active).toBe(true);
    // US-029 AC-1 — the suppressed view renders WITHOUT a title row, so the
    // description has to be frozen here. A discarded discovery candidate never
    // created a Title at all, so nothing else describes it.
    expect(suppressions[0]?.displayName).toBe('Dune');

    // ⚠ And no title and no intent for the discarded work. A discard that
    // suppressed but still recorded the intent would put the reject straight
    // into the waiting list.
    expect(await testPrisma().title.count({ where: { workIdentity: DUNE } })).toBe(0);
    expect(await testPrisma().watchIntent.count({ where: { workIdentity: DUNE } })).toBe(0);
  });

  it('T-WAIT-006b · THE LOAD-BEARING CASE — the same page captured again does not contain the discard at all', async () => {
    // US-041 AC-3/AC-4, US-028 AC-2. The check is BEFORE record creation: the
    // work is absent from the review pass, not merely present-and-greyed.
    const first = await makeBatch('discovery');
    await makeCandidate(first, DUNE, 'Dune', 'discarded');
    await makeCandidate(first, HEAT, 'Heat', 'confirmed');
    expect((await closeBatchRequest(first)).status).toBe(200);

    // Next week's capture of the same rotating storefront page. Both titles are
    // extracted again, exactly as the pipeline really would.
    const second = await makeBatch('discovery');
    await makeCandidate(second, DUNE, 'Dune', 'pending');
    await makeCandidate(second, HEAT, 'Heat', 'pending');

    const res = await reviewRequest(second);
    // ⚠ 200, not 500. Until TASK-186 this route asked `requireServiceOf` and
    // threw for a discovery batch, so the pass could not be opened at all.
    expect(res.status).toBe(200);
    const body = await res.text();

    // AT ALL — in any section, under any heading, in any field.
    expect(body).not.toContain(DUNE);
    expect(body).not.toContain('Dune');
    // …while the rest of the capture is untouched, so this is curation and not
    // a review pass that simply failed to load anything.
    expect(body).toContain(HEAT);
  });

  it('T-WAIT-006c · THE DISCRIMINATING CASE — discarding in a Netflix pass does NOT suppress', async () => {
    // US-041 AC-5. Discard-suppresses is scoped to discovery sources, because
    // a curated saved list does not re-present its rejects. Suppressing here
    // would hide a work from every FUTURE Netflix capture on the strength of
    // one skipped tile.
    const batch = await makeBatch('netflix');
    await makeCandidate(batch, DUNE, 'Dune', 'discarded');
    await makeCandidate(batch, HEAT, 'Heat', 'confirmed');

    const res = await closeBatchRequest(batch);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { discarded: number } };
    expect(body.summary.discarded).toBe(1);

    expect(await testPrisma().suppression.count({ where: { ownerId } })).toBe(0);
    // And the confirmed one really did land, so the close was a normal one and
    // not a no-op that trivially wrote no suppression.
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(1);
  });
});

describe('T-WAIT-007 · US-041 AC-6 · a suppression failure rolls the whole close back', () => {
  it('T-WAIT-007a · no partial curation is committed', async () => {
    const batch = await makeBatch('discovery');
    await makeCandidate(batch, HEAT, 'Heat', 'confirmed');
    await makeCandidate(batch, DUNE, 'Dune', 'discarded');

    failSuppression = true;
    const res = await closeBatchRequest(batch);
    expect(res.status).toBe(500);

    // ⚠ ALL FOUR, not just the suppression count. The title and the intent for
    // Heat were written BEFORE the suppression threw, so their absence is the
    // rollback itself — and the batch must still be closable once the fault
    // clears, which it cannot be if it already transitioned to `applied`.
    expect(await testPrisma().suppression.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().watchIntent.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(0);
    const after = await testPrisma().uploadBatch.findFirst({ where: { id: batch } });
    expect(after?.status).toBe('in-review');
  });

  it('T-WAIT-007b · the same batch closes cleanly once the fault clears', async () => {
    // The other half of "no partial curation": a rolled-back close must leave
    // a batch the owner can simply retry, not one wedged half-applied.
    const batch = await makeBatch('discovery');
    await makeCandidate(batch, HEAT, 'Heat', 'confirmed');
    await makeCandidate(batch, DUNE, 'Dune', 'discarded');

    failSuppression = true;
    expect((await closeBatchRequest(batch)).status).toBe(500);

    failSuppression = false;
    expect((await closeBatchRequest(batch)).status).toBe(200);
    expect(await testPrisma().suppression.count({ where: { ownerId, active: true } })).toBe(1);
    expect(await testPrisma().watchIntent.count({ where: { ownerId } })).toBe(1);
  });
});
