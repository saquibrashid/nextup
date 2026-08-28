/**
 * TASK-100 — US-026: a reappearing work becomes a BRAND-NEW title dated today
 * (`specs/data-model.md` §11, REQ-071 neighbourhood, product invariant 7).
 *
 * `T-REAP-010` (a new Title/listing dated today), `T-REAP-011` (the old removed
 * row is byte-identical afterwards), `T-REAP-012` (owner edits on the old row
 * do not carry over), `T-REAP-013` (the removed view holds the old row while
 * the combined list holds the new one) and `T-REAP-014` (no code path restores
 * automatically — `restoreServiceListing` has exactly two call sites).
 *
 * ⚠ WHY THIS IS THE SHAPE OF THE FEATURE, AND NOT AN IMPLEMENTATION ACCIDENT.
 * The obvious behaviour — "the title is back, flip it to active" — is wrong
 * here, and wrong in a way that destroys information rather than merely
 * looking different. The removed view is a HISTORICAL LOG, not a recycle bin:
 * it is meant to answer "when did this leave, and how many times has this
 * happened", and it will legitimately hold several rows for one work over
 * time. Reviving the old row answers none of those questions, because the
 * evidence is the row itself. Product invariant 7 states the rule; this file
 * is what makes it true of the running system.
 *
 * ⚠ INTEGRATION, NOT UNIT, AND NOT NEGOTIABLE. Every property here is a
 * statement about what is IN THE STORE after a close — that a SECOND row now
 * exists, that the first one was not touched, that a filtered unique index
 * tolerated both. A stubbed store agrees with whatever the code asked it to
 * do, so it would report a revive-in-place as a pass. `title_one_active_per_work`
 * is real here, and it is doing real work: it is the reason a revive-in-place
 * bug and a create-a-second-active bug have different symptoms.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-reappearance';
const ISSUER = 'https://sts.windows.net/tenant/';

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

/** The day the old row left. Deliberately far from today so a carried-over
 * date is unmistakable rather than off-by-one. */
const LONG_AGO = '2026-01-04';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

interface CloseBody {
  summary: {
    titlesCreated: number;
    listingsCreated: number;
    listingsRemoved: number;
    discarded: number;
    removalGroupId: string | null;
  };
}

interface RemovedItem {
  listingId: string;
  titleId: string;
  workIdentity: string;
  name: string;
  dateAdded: string;
  removalOrdinal: number;
  removalTotalForWork: number;
}

interface Badge {
  service: string;
  listingId: string;
  dateAdded: string;
}

interface Item {
  titleId: string;
  workIdentity: string;
  name: string;
  badges: Badge[];
  sortDateAdded: string | null;
}

const authed = { [CLIENT_PRINCIPAL_HEADER]: principalHeader };

const close = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authed },
    body: JSON.stringify({}),
  });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let seq = 0;

async function seedBatch(id: string, mode: string, status: string): Promise<void> {
  await testPrisma().uploadBatch.upsert({
    where: { id },
    update: {},
    create: {
      id,
      ownerId,
      service: 'netflix',
      mode,
      status,
      lowYield: false,
      degradedExtraction: false,
    },
  });
}

/**
 * The work as it was BEFORE it reappeared: a removed title with a removed
 * listing, carrying an owner-corrected name so `T-REAP-012` has something
 * specific to look for.
 */
async function seedRemovedTitle(over: { name?: string } = {}): Promise<{
  titleId: string;
  listingId: string;
}> {
  const titleId = `reap-title-${++seq}`;
  const listingId = `reap-listing-${seq}`;
  await seedBatch('reap-seed-batch', 'append-only', 'applied');
  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity: DUNE,
      state: 'removed',
      matchState: 'matched',
      rawExtractedText: null,
      normalisedText: 'dune',
      tmdbId: 438631,
      tmdbMediaType: 'movie',
      tmdbName: over.name ?? 'Dune',
      tmdbReleaseYear: 2021,
      sortDateAdded: new Date(LONG_AGO),
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId,
      ownerId,
      titleId,
      service: 'netflix',
      state: 'removed',
      dateAdded: new Date(LONG_AGO),
      removedAt: new Date('2026-02-01T10:00:00Z'),
      createdByBatchId: 'reap-seed-batch',
    },
  });
  return { titleId, listingId };
}

/** A reviewed, confirmed batch that says the work IS listed again. */
async function seedReappearanceBatch(): Promise<string> {
  const batchId = `reap-batch-${++seq}`;
  await seedBatch(batchId, 'append-only', 'in-review');
  await testPrisma().extractionCandidate.create({
    data: {
      id: `reap-cand-${seq}`,
      ownerId,
      batchId,
      rawText: 'Dune',
      inferredTitle: 'Dune',
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: 'dune',
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: DUNE,
      classification: 'new',
      reviewDisposition: 'confirmed',
      collapsedIntoCandidateId: null,
      // The new row's TMDB fields are built from THIS capture's own match
      // evidence. Seeding a real alternative is what makes T-REAP-012 a
      // genuine assertion: without it the new row's tmdbName is null and
      // "the owner's correction did not carry over" would hold vacuously,
      // because every candidate name would be absent rather than fresh.
      matchCandidates: JSON.stringify([
        {
          tmdbId: 438631,
          mediaType: 'movie',
          name: 'Dune',
          releaseYear: 2021,
          posterPath: '/dune.jpg',
          score: 1,
        },
      ]),
    },
  });
  return batchId;
}

const titlesForWork = () =>
  testPrisma().title.findMany({ where: { ownerId, workIdentity: DUNE }, orderBy: { id: 'asc' } });

const listingsForTitle = (titleId: string) =>
  testPrisma().serviceListing.findMany({ where: { ownerId, titleId } });

const today = (): string => new Date().toISOString().slice(0, 10);

/* ── lifecycle ────────────────────────────────────────────────────────── */

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

  const created = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authed },
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  const body = (await created.json()) as { batchId: string };
  const row = await testPrisma().uploadBatch.findFirst({ where: { id: body.batchId } });
  ownerId = row?.ownerId ?? '';
  await resetDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe('US-026 — a reappearing work becomes a brand-new title', () => {
  it('T-REAP-010 · AC-1 · reappearance creates a NEW title and listing dated today', async () => {
    const old = await seedRemovedTitle();
    const batchId = await seedReappearanceBatch();

    const res = await close(batchId);
    expect(res.status).toBe(200);
    const { summary } = (await res.json()) as CloseBody;

    // A revive-in-place would report zero created and still leave the product
    // looking correct on screen. The counter is the cheapest place to catch it.
    expect(summary.titlesCreated).toBe(1);
    expect(summary.listingsCreated).toBe(1);

    const rows = await titlesForWork();
    expect(rows).toHaveLength(2);

    const fresh = rows.find((r) => r.id !== old.titleId);
    expect(fresh).toBeDefined();
    expect(fresh?.state).toBe('active');
    // ⚠ TODAY, NOT THE ORIGINAL DATE. This is the whole point of AC-1: the
    // work is new to the list as far as the list is concerned, and sorting by
    // "date added" must put it at the top rather than back where it was in
    // January. Inheriting `sortDateAdded` is the single most likely wrong
    // implementation, and it is invisible until the owner sorts.
    expect(fresh?.sortDateAdded?.toISOString().slice(0, 10)).toBe(today());

    const freshListings = await listingsForTitle(fresh?.id ?? '');
    expect(freshListings).toHaveLength(1);
    expect(freshListings[0]?.state).toBe('active');
    expect(freshListings[0]?.dateAdded?.toISOString().slice(0, 10)).toBe(today());
    // A NEW listing id, not the old one re-pointed.
    expect(freshListings[0]?.listingId).not.toBe(old.listingId);
  });

  it('T-REAP-011 · AC-2 · the old removed row is untouched — every field byte-identical', async () => {
    const old = await seedRemovedTitle();
    const batchId = await seedReappearanceBatch();

    // ⚠ SNAPSHOT EVERY COLUMN, not a chosen few. The failure this guards
    // against is a well-meaning "tidy up the old row while we are here" —
    // restamping `removedAt`, clearing `removedByBatchId`, or re-pointing
    // `titleId`. Naming the fields to compare would mean only the fields
    // somebody already thought of are protected, and the log's value is that
    // it is evidence: a field quietly rewritten is evidence destroyed.
    const titleBefore = await testPrisma().title.findFirstOrThrow({ where: { id: old.titleId } });
    const listingBefore = await testPrisma().serviceListing.findFirstOrThrow({
      where: { ownerId, listingId: old.listingId },
    });

    expect((await close(batchId)).status).toBe(200);

    const titleAfter = await testPrisma().title.findFirstOrThrow({ where: { id: old.titleId } });
    const listingAfter = await testPrisma().serviceListing.findFirstOrThrow({
      where: { ownerId, listingId: old.listingId },
    });

    expect(titleAfter).toEqual(titleBefore);
    expect(listingAfter).toEqual(listingBefore);
  });

  it('T-REAP-012 · AC-3 · owner edits on the old row do NOT carry over to the new one', async () => {
    // The owner corrected the match on the old row before it was removed.
    const old = await seedRemovedTitle({ name: 'Dune (owner-corrected)' });
    const batchId = await seedReappearanceBatch();

    expect((await close(batchId)).status).toBe(200);

    const rows = await titlesForWork();
    const fresh = rows.find((r) => r.id !== old.titleId);

    // ⚠ THE NEW ROW IS BUILT FROM THIS CAPTURE, NOT FROM HISTORY. Carrying the
    // correction forward is superficially friendly and actually a data-integrity
    // problem: it silently re-asserts a months-old owner decision over fresh
    // evidence, and the owner is never asked. Product invariant 7 makes the
    // reappearance a new event; a new event carries no prior edits.
    expect(fresh?.tmdbName).toBe('Dune');
    expect(fresh?.tmdbName).not.toBe('Dune (owner-corrected)');

    // And the correction is still on the old row, where it belongs.
    const stale = rows.find((r) => r.id === old.titleId);
    expect(stale?.tmdbName).toBe('Dune (owner-corrected)');
  });

  it('T-REAP-013 · AC-4 · the removed view holds the old row; the combined list holds the new one', async () => {
    const old = await seedRemovedTitle();
    const batchId = await seedReappearanceBatch();
    expect((await close(batchId)).status).toBe(200);

    const removed = (await (
      await fetch(`${origin}/api/removed`, { headers: authed })
    ).json()) as { items: RemovedItem[] };

    // Exactly one removal in the log — the reappearance did not add a second
    // removal, and did not clear the first.
    expect(removed.items).toHaveLength(1);
    expect(removed.items[0]?.listingId).toBe(old.listingId);
    expect(removed.items[0]?.titleId).toBe(old.titleId);
    expect(removed.items[0]?.dateAdded).toBe(LONG_AGO);

    const list = (await (
      await fetch(`${origin}/api/titles`, { headers: authed })
    ).json()) as { items: Item[] };

    // ⚠ ONE ROW PER TITLE, and it is the NEW one. Both halves matter: the
    // combined list showing the removed row would be a resurrection bug, and
    // it showing BOTH would be the deduplication failure the whole product
    // exists to prevent — the owner would see "Dune" twice.
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.workIdentity).toBe(DUNE);
    expect(list.items[0]?.titleId).not.toBe(old.titleId);
    expect(list.items[0]?.sortDateAdded).toBe(today());
    expect(list.items[0]?.badges).toHaveLength(1);
    expect(list.items[0]?.badges[0]?.service).toBe('netflix');
  });

  it('T-REAP-014 · AC-6 · no code path restores the old row automatically', async () => {
    const old = await seedRemovedTitle();
    const batchId = await seedReappearanceBatch();
    expect((await close(batchId)).status).toBe(200);

    // The behavioural half: after a close that saw the work again, the old
    // listing is still removed.
    const stale = await testPrisma().serviceListing.findFirstOrThrow({
      where: { ownerId, listingId: old.listingId },
    });
    expect(stale.state).toBe('removed');

    /*
     * The structural half. ⚠ A BEHAVIOURAL ASSERTION ALONE IS NOT ENOUGH HERE,
     * because it only proves that the ONE path exercised above does not
     * restore. AC-6 is a claim about every path, and the honest way to make
     * that claim is to enumerate the callers: restore is reachable from the
     * explicit owner action (`POST /api/listings/:id/restore`, §6.10) and from
     * undoing a removal group (§6.24) — both of which are the owner pressing a
     * button — and from nowhere else. A third call site appearing is the
     * automatic-restore bug arriving, whatever it is named.
     */
    const callSites = sourceFiles(join(process.cwd(), 'apps/api/src'))
      .map((file) => ({
        file: file.replace(/\\/g, '/').split('apps/api/src/')[1] ?? file,
        hits: (readFileSync(file, 'utf8').match(/\brestoreServiceListing\s*\(/g) ?? []).length,
      }))
      .filter((entry) => entry.hits > 0 && !entry.file.startsWith('repository/'));

    expect(callSites).toEqual([
      { file: 'routes/listings.ts', hits: 1 },
      { file: 'services/removalGroupUndo.ts', hits: 1 },
    ]);
  });
});

/** Every `.ts` under a directory, sorted, so the assertion above is stable. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}
