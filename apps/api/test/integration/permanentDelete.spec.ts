/**
 * US-067 / REQ-133 / TASK-276 + TASK-277 — owner-initiated permanent delete of
 * REMOVED listings (`specs/api.md` §6.54 / §6.55, `specs/data-model.md` §8.5,
 * ADR-0015).
 *
 * T-PURGE-001: a removed listing is deleted; an active or foreign one is
 *              refused and nothing is deleted.
 * T-PURGE-002: *Delete all history for this work* deletes every removed row;
 *              any active row refuses whole.
 * T-PURGE-003: producing candidates go; the batch survives and its undo is
 *              refused for that work.
 * T-PURGE-004: the Title goes only when nothing references it.
 * T-PURGE-005: `Suppression` is untouched.
 * T-PURGE-006: a deleted work leaves no tombstone — it is a brand-new title.
 *
 * The rollback proof (`T-PURGE-007`) is in `permanentDeleteRollback.spec.ts`.
 * Run against a real SQL Server and the real Express app.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  recordBatchChange,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-purge';

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

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let origin: string;
let owner: OwnerId;
let seq = 0;

const headers = { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: '' };
const authed = (): Record<string, string> => ({
  ...headers,
  [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT),
});

const deleteListing = (listingId: string): Promise<Response> =>
  fetch(`${origin}/api/listings/${encodeURIComponent(listingId)}/permanent`, {
    method: 'DELETE',
    headers: authed(),
  });

const deleteWork = (workIdentity: string): Promise<Response> =>
  fetch(`${origin}/api/works/${encodeURIComponent(workIdentity)}/history`, {
    method: 'DELETE',
    headers: authed(),
  });

interface Seeded {
  batchId: string;
  titleId: string;
  listingId: string;
  candidateId: string;
}

/** One batch that created one title with one listing, plus the candidate behind it. */
async function seed(opts: {
  workIdentity: string;
  state?: 'active' | 'removed';
  service?: string;
  ownerId?: OwnerId;
  titleId?: string;
}): Promise<Seeded> {
  seq += 1;
  const who = opts.ownerId ?? owner;
  const state = opts.state ?? 'removed';
  const service = opts.service ?? 'netflix';
  const key = `pg-${String(seq).padStart(3, '0')}`;
  const dateAdded = new Date('2026-04-01T00:00:00.000Z');

  const batch = await createUploadBatch(who, {
    id: `b-${key}`,
    service,
    mode: 'append-only',
    status: 'applied',
  });
  const titleId = opts.titleId ?? `t-${key}`;
  if (opts.titleId === undefined) {
    await createTitle(who, {
      id: titleId,
      workIdentity: opts.workIdentity,
      state,
      matchState: 'matched',
      tmdbId: 700_000 + seq,
      tmdbMediaType: 'movie',
      tmdbName: `Film ${key}`,
      tmdbReleaseYear: 2020,
      tmdbPosterPath: null,
      tmdbGenres: '[]',
      sortDateAdded: dateAdded,
      createdByBatchId: batch.id,
    });
  }
  const listingId = `l-${key}`;
  await createServiceListing(who, {
    listingId,
    titleId,
    service,
    state,
    dateAdded,
    ...(state === 'removed'
      ? { removedAt: new Date('2026-07-01T00:00:00.000Z'), removedByBatchId: batch.id }
      : {}),
    createdByBatchId: batch.id,
  });
  if (opts.titleId === undefined) {
    await recordBatchChange(who, { batchId: batch.id, kind: 'title_created', titleId });
  }
  await recordBatchChange(who, { batchId: batch.id, kind: 'listing_added', titleId, listingId });

  const candidateId = `c-${key}`;
  await testPrisma().extractionCandidate.create({
    data: {
      id: candidateId,
      ownerId: who,
      batchId: batch.id,
      rawText: 'Film',
      inferredTitle: 'Film',
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: 'film',
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: opts.workIdentity,
      resolvedTitleId: titleId,
      reviewDisposition: 'confirmed',
    },
  });
  return { batchId: batch.id, titleId, listingId, candidateId };
}

const counts = async () => {
  const db = testPrisma();
  return {
    listings: await db.serviceListing.count(),
    titles: await db.title.count(),
    candidates: await db.extractionCandidate.count(),
    batches: await db.uploadBatch.count(),
    changes: await db.batchChange.count(),
  };
};

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  seq = 0;
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  if (server === undefined) {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const res = await fetch(`${origin}/api/me`, { headers: authed() });
  owner = asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await closeTestPrisma();
});

describe('T-PURGE-001 · a removed listing is deleted; anything else is refused', () => {
  it('T-PURGE-001a: deletes the listing, its candidate and the now-unreferenced title', async () => {
    const s = await seed({ workIdentity: 'tmdb:movie:1' });
    const res = await deleteListing(s.listingId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      listingsDeleted: 1,
      candidatesDeleted: 1,
      titlesDeleted: 1,
    });
    const db = testPrisma();
    expect(await db.serviceListing.count({ where: { listingId: s.listingId } })).toBe(0);
    expect(await db.extractionCandidate.count({ where: { id: s.candidateId } })).toBe(0);
    expect(await db.title.count({ where: { id: s.titleId } })).toBe(0);
  });

  it('T-PURGE-001b: an ACTIVE listing is refused with LISTING_NOT_REMOVED and nothing is deleted', async () => {
    const s = await seed({ workIdentity: 'tmdb:movie:2', state: 'active' });
    const before = await counts();
    const res = await deleteListing(s.listingId);

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LISTING_NOT_REMOVED');
    expect(await counts()).toEqual(before);
  });

  it("T-PURGE-001c: another owner's listing is a byte-identical 404 and nothing is deleted", async () => {
    const foreign = await seed({ workIdentity: 'tmdb:movie:3', ownerId: asOwnerId('other-owner') });
    const before = await counts();

    const res = await deleteListing(foreign.listingId);
    const unknown = await deleteListing('l-does-not-exist');

    expect(res.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await res.text()).toBe(await unknown.text());
    expect(await counts()).toEqual(before);
  });

  it("T-PURGE-001d: another owner's work is a 404 and nothing is deleted", async () => {
    await seed({ workIdentity: 'tmdb:movie:4', ownerId: asOwnerId('other-owner') });
    const before = await counts();

    const res = await deleteWork('tmdb:movie:4');

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
    expect(await counts()).toEqual(before);
  });
});

describe('T-PURGE-002 · delete all history for a work', () => {
  it('T-PURGE-002a: deletes every removed listing of the work in one request', async () => {
    const a = await seed({ workIdentity: 'tmdb:movie:10', service: 'netflix' });
    const b = await seed({ workIdentity: 'tmdb:movie:10', service: 'max' });
    const other = await seed({ workIdentity: 'tmdb:movie:11' });

    const res = await deleteWork('tmdb:movie:10');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      listingsDeleted: 2,
      candidatesDeleted: 2,
      titlesDeleted: 2,
    });
    const db = testPrisma();
    expect(
      await db.serviceListing.count({ where: { listingId: { in: [a.listingId, b.listingId] } } }),
    ).toBe(0);
    expect(await db.serviceListing.count({ where: { listingId: other.listingId } })).toBe(1);
  });

  it('T-PURGE-002b: any ACTIVE listing of the work refuses the WHOLE request', async () => {
    await seed({ workIdentity: 'tmdb:movie:12', service: 'netflix' });
    await seed({ workIdentity: 'tmdb:movie:12', service: 'max', state: 'active' });
    const before = await counts();

    const res = await deleteWork('tmdb:movie:12');

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('WORK_HAS_ACTIVE_LISTING');
    expect(await counts()).toEqual(before);
  });
});

describe('T-PURGE-003 · candidates go; the batch survives and is no longer undoable', () => {
  it('T-PURGE-003a: the batch row and its other evidence survive', async () => {
    const s = await seed({ workIdentity: 'tmdb:movie:20' });
    await deleteListing(s.listingId);

    const db = testPrisma();
    expect(await db.uploadBatch.count({ where: { id: s.batchId } })).toBe(1);
    expect(await db.extractionCandidate.count({ where: { id: s.candidateId } })).toBe(0);
    expect(await db.batchChange.count({ where: { batchId: s.batchId } })).toBe(2);
  });

  it('T-PURGE-003b: undo of that batch is refused through the US-033 enumeration', async () => {
    const s = await seed({ workIdentity: 'tmdb:movie:21' });
    await deleteListing(s.listingId);

    const res = await fetch(`${origin}/api/batches/${s.batchId}/undo`, {
      method: 'POST',
      headers: authed(),
      body: '{}',
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_NOT_CREATES_ONLY');
    expect(body.error.details['reason']).toBe('provenance-unavailable');
    expect((await testPrisma().uploadBatch.findFirst({ where: { id: s.batchId } }))?.status).toBe(
      'applied',
    );

    const detail = await fetch(`${origin}/api/batches/${s.batchId}`, { headers: authed() });
    const detailBody = (await detail.json()) as { application: { undoable: boolean } };
    expect(detailBody.application.undoable).toBe(false);
  });

  it('T-PURGE-003c: a candidate from another batch is not touched', async () => {
    const s = await seed({ workIdentity: 'tmdb:movie:22' });
    const later = await createUploadBatch(owner, {
      id: 'b-later',
      service: 'netflix',
      mode: 'append-only',
      status: 'applied',
    });
    await testPrisma().extractionCandidate.create({
      data: {
        id: 'c-later',
        ownerId: owner,
        batchId: later.id,
        rawText: 'Film',
        basis: 'both',
        ocrSupport: 'exact',
        provider: 'llm',
        normalisedText: 'film',
        boxSource: 'llm',
        cleanupVerdict: 'title-candidate',
        resolvedWorkIdentity: 'tmdb:movie:22',
        resolvedTitleId: s.titleId,
      },
    });

    const res = await deleteListing(s.listingId);

    expect(await res.json()).toEqual({
      listingsDeleted: 1,
      candidatesDeleted: 1,
      titlesDeleted: 0,
    });
    expect(await testPrisma().extractionCandidate.count({ where: { id: 'c-later' } })).toBe(1);
    expect(await testPrisma().title.count({ where: { id: s.titleId } })).toBe(1);
  });
});

describe('T-PURGE-004 · the title goes only when nothing references it', () => {
  it('T-PURGE-004a: a title with another listing (any state) is kept', async () => {
    const s = await seed({ workIdentity: 'tmdb:movie:30', service: 'netflix' });
    await seed({ workIdentity: 'tmdb:movie:30', service: 'max', titleId: s.titleId });

    const res = await deleteListing(s.listingId);

    expect(await res.json()).toEqual({
      listingsDeleted: 1,
      candidatesDeleted: 1,
      titlesDeleted: 0,
    });
    expect(await testPrisma().title.count({ where: { id: s.titleId } })).toBe(1);
    expect(await testPrisma().serviceListing.count({ where: { titleId: s.titleId } })).toBe(1);
  });

  it('T-PURGE-004b: a title a watch intent references is kept', async () => {
    const s = await seed({ workIdentity: 'tmdb:movie:31' });
    await testPrisma().watchIntent.create({
      data: {
        id: 'wi-1',
        ownerId: owner,
        titleId: s.titleId,
        workIdentity: 'tmdb:movie:31',
        sourceBatchId: s.batchId,
        discoverySource: 'fandango-at-home',
        state: 'waiting',
      },
    });

    const res = await deleteListing(s.listingId);

    expect(res.status).toBe(200);
    expect(await testPrisma().title.count({ where: { id: s.titleId } })).toBe(1);
    expect(await testPrisma().watchIntent.count({ where: { id: 'wi-1' } })).toBe(1);
  });
});

describe('T-PURGE-005 · suppression is never deleted', () => {
  it('T-PURGE-005a: the suppression row survives a single delete and a work-wide delete', async () => {
    await createSuppression(owner, {
      id: 'supp-1',
      workIdentity: 'tmdb:movie:40',
      active: true,
      displayName: 'Suppressed Film',
    });
    const s = await seed({ workIdentity: 'tmdb:movie:40' });
    await seed({ workIdentity: 'tmdb:movie:40', service: 'max' });

    await deleteListing(s.listingId);
    await deleteWork('tmdb:movie:40');

    const rows = await testPrisma().suppression.findMany({
      where: { workIdentity: 'tmdb:movie:40' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.active).toBe(true);
  });
});

describe('T-PURGE-006 · no tombstone: a deleted work is a brand-new title later', () => {
  it('T-PURGE-006a: nothing of the work remains, and the same work is created afresh', async () => {
    const s = await seed({ workIdentity: 'tmdb:movie:50' });
    await deleteListing(s.listingId);

    expect(await testPrisma().title.count({ where: { workIdentity: 'tmdb:movie:50' } })).toBe(0);

    const fresh = await seed({ workIdentity: 'tmdb:movie:50', state: 'active' });
    expect(fresh.titleId).not.toBe(s.titleId);
    expect(await testPrisma().title.count({ where: { workIdentity: 'tmdb:movie:50' } })).toBe(1);
  });
});
