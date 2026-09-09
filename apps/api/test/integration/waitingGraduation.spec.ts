/**
 * TASK-189 — **graduation**: a work the owner was waiting for is captured on
 * one of their services, and the intent stops waiting (US-043 AC-3/AC-5).
 *
 * `T-WAIT-008a` (capture graduates the intent and the work enters the combined
 * list by the ORDINARY path) and `T-WAIT-008b` (the satisfied intent is
 * **retained for ever**, never hard-deleted — REQ-028).
 *
 * ⚠ **GRADUATION IS A CONSEQUENCE OF CAPTURE, NOT OF AVAILABILITY.** Nothing
 * in the availability refresh may satisfy an intent (`T-AVAIL-004a` asserts
 * the negative). The only thing that ends a wait is the owner actually adding
 * the work to a saved list and photographing it. That makes the close
 * transaction the one place this can happen, which is why this is an
 * integration test: the claim is that one committed transaction moved both
 * the listing and the intent, and a mocked store cannot show that.
 *
 * ⚠ **`T-WAIT-008b` IS THE INVARIANT-4 GUARD.** "It left the waiting view" is
 * satisfied just as well by a `DELETE`, and a delete is invisible in every
 * other assertion here — the row is simply gone and every count still adds up.
 * Soft state changes only, for ever.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const ISSUER = 'https://sts.windows.net/tenant/';
const SUBJECT = 'oid-owner-graduate';

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

interface WaitingBody {
  count: number;
  items: { intentId: string; workIdentity: string }[];
}

const waitingRequest = async (): Promise<WaitingBody> => {
  const res = await fetch(`${origin}/api/waiting`, { headers: authed });
  return (await res.json()) as WaitingBody;
};

const titlesRequest = async (): Promise<{
  items: { workIdentity: string; badges: { service: string }[] }[];
}> => {
  const res = await fetch(`${origin}/api/titles`, { headers: authed });
  return (await res.json()) as { items: { workIdentity: string; badges: { service: string }[] }[] };
};

/* ── fixtures ─────────────────────────────────────────────────────────── */

let seq = 0;

/**
 * A waiting intent, exactly as the discovery close leaves one: a `removed`
 * Title with a NULL `sortDateAdded` (so it is invisible to `/api/titles`) plus
 * a `waiting` WatchIntent pointing at it, sourced from an applied discovery
 * batch.
 */
async function seedWaiting(workIdentity: string, name: string): Promise<string> {
  const n = ++seq;
  const sourceBatch = `batch-grad-src-${n}`;
  await testPrisma().uploadBatch.create({
    data: {
      id: sourceBatch,
      ownerId,
      service: null,
      discoverySource: 'fandango-at-home',
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });

  await testPrisma().title.create({
    data: {
      id: `title-grad-${n}`,
      ownerId,
      workIdentity,
      // ⚠ THERE IS NO `waiting` TITLE STATE — `ck_title_state` permits only
      // `active` and `removed`. A waiting work is stored the way the discovery
      // close stores one (`presenceFields` in `services/batchClose.ts`):
      // `removed` with a NULL `sortDateAdded`, so it is invisible to
      // `listActiveTitles` and carries no list date it never earned.
      // ~~Superseded: `state: 'waiting'` — rejected by the CHECK constraint,
      // which Prisma reports as a *foreign key* violation.~~
      state: 'removed',
      sortDateAdded: null,
      matchState: 'matched',
      tmdbId: Number(workIdentity.split(':')[2]),
      tmdbMediaType: 'movie',
      tmdbName: name,
      tmdbReleaseYear: 2021,
      tmdbPosterPath: '/p.jpg',
    },
  });

  const intentId = `wi-grad-${n}`;
  await testPrisma().watchIntent.create({
    data: {
      id: intentId,
      ownerId,
      titleId: `title-grad-${n}`,
      workIdentity,
      state: 'waiting',
      satisfiedAt: null,
      sourceBatchId: sourceBatch,
      discoverySource: 'fandango-at-home',
      discoveredAt: new Date(Date.UTC(2026, 0, n)),
      availabilityRegion: 'US',
      availabilityCheckedAt: null,
      availableOn: null,
    },
  });
  return intentId;
}

/** An in-review Netflix capture with one confirmed candidate per work. */
async function seedCapture(workIdentities: string[]): Promise<string> {
  const batchId = `batch-grad-cap-${++seq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id: batchId,
      ownerId,
      service: 'netflix',
      discoverySource: null,
      mode: 'append-only',
      status: 'in-review',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });

  for (const workIdentity of workIdentities) {
    const tmdbId = Number(workIdentity.split(':')[2]);
    await testPrisma().extractionCandidate.create({
      data: {
        id: `cand-grad-${++seq}`,
        ownerId,
        batchId,
        rawText: workIdentity,
        inferredTitle: workIdentity,
        basis: 'both',
        ocrSupport: 'exact',
        provider: 'llm',
        normalisedText: workIdentity,
        boxSource: 'llm',
        cleanupVerdict: 'title-candidate',
        resolvedWorkIdentity: workIdentity,
        reviewDisposition: 'confirmed',
        collapsedIntoCandidateId: null,
        matchCandidates: JSON.stringify([
          {
            tmdbId,
            mediaType: 'movie',
            name: `Work ${tmdbId}`,
            releaseYear: 2021,
            posterPath: '/p.jpg',
            score: 1,
          },
        ]),
      },
    });
  }
  return batchId;
}

const closeBatch = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authed },
    body: JSON.stringify({}),
  });

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  seq = 0;
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
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

describe('T-WAIT-008 · US-043 AC-3/AC-5 · graduation', () => {
  it('T-WAIT-008a · capturing a waiting work on Netflix ends the wait and enters the list', async () => {
    const duneIntent = await seedWaiting(DUNE, 'Dune');
    const heatIntent = await seedWaiting(HEAT, 'Heat');

    // Before: both are waiting, neither is in the combined list.
    expect((await waitingRequest()).count).toBe(2);
    expect((await titlesRequest()).items).toHaveLength(0);

    const batchId = await seedCapture([DUNE]);
    const res = await closeBatch(batchId);
    expect(res.status).toBe(200);

    // The work entered the combined list by the ORDINARY path — a real
    // ServiceListing created by a real capture, badged with the service the
    // screenshot came from. Nothing about this row is special.
    const titles = await titlesRequest();
    const row = titles.items.find((t) => t.workIdentity === DUNE);
    expect(row).toBeDefined();
    expect(row?.badges.map((b) => b.service)).toEqual(['netflix']);

    // …and the wait is over, for that work only.
    const waiting = await waitingRequest();
    expect(waiting.items.map((i) => i.workIdentity)).toEqual([HEAT]);

    const dune = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: duneIntent } });
    expect(dune.state).toBe('satisfied');
    expect(dune.satisfiedAt).not.toBeNull();

    // ⚠ THE DISCRIMINATING HALF. Without it, `008a` passes against a build
    // that satisfies EVERY waiting intent whenever any batch closes.
    const heat = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: heatIntent } });
    expect(heat.state).toBe('waiting');
    expect(heat.satisfiedAt).toBeNull();
  });

  it('T-WAIT-008b · the satisfied intent is RETAINED — nothing is hard-deleted', async () => {
    const duneIntent = await seedWaiting(DUNE, 'Dune');
    const intentsBefore = await testPrisma().watchIntent.count({ where: { ownerId } });
    const titlesBefore = await testPrisma().title.count({ where: { ownerId } });

    await closeBatch(await seedCapture([DUNE]));

    // The intent row still exists, with its discovery provenance intact: the
    // owner can still see WHERE and WHEN they first found this work, years
    // later. Leaving the waiting view is a state change, never a deletion.
    const stored = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: duneIntent } });
    expect(stored.state).toBe('satisfied');
    expect(stored.discoverySource).toBe('fandango-at-home');
    expect(stored.discoveredAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');

    expect(await testPrisma().watchIntent.count({ where: { ownerId } })).toBe(intentsBefore);

    // The `waiting` Title it pointed at is retained too — the close creates a
    // NEW active title rather than promoting it (product invariant 7), so the
    // count grows; what must never happen is it shrinking.
    expect(await testPrisma().title.count({ where: { ownerId } })).toBeGreaterThanOrEqual(
      titlesBefore,
    );
  });

  it('T-WAIT-008c · a capture of a work the owner never discovered graduates nothing', async () => {
    // The empty-set path: `satisfyWaitingIntents` is called on every service
    // close, so the ordinary case — a capture with no waiting work in it —
    // must be a no-op rather than an error or a blanket update.
    const heatIntent = await seedWaiting(HEAT, 'Heat');

    const res = await closeBatch(await seedCapture([DUNE]));
    expect(res.status).toBe(200);

    const heat = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: heatIntent } });
    expect(heat.state).toBe('waiting');
    expect((await waitingRequest()).count).toBe(1);
  });
});
