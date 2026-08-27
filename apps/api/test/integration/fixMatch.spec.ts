/**
 * TASK-109 / TASK-110 — `POST /api/titles/:titleId/fix-match`
 * (`specs/api.md` §6.5, `specs/data-model.md` §6.3, US-030).
 *
 * ⚠ **WHAT THIS FILE IS REALLY GUARDING IS DATA THE OWNER CANNOT GET BACK.**
 * The obvious way to re-point a title at a different work — delete the wrong
 * row, insert a right one — passes an "is it matched now?" test and silently
 * destroys the dates the work was saved on each service, and with them its
 * position in the default sort (REQ-038, product invariant 6). Every date on
 * this list came off a screenshot the owner may no longer have. So `T-FIX-002`
 * compares the STORED bytes before and after rather than the response, and
 * `T-FIX-003` compares the rendered ordering.
 *
 * ⚠ **AND A SUPPRESSION THAT DOES NOT MOVE IS A SILENT RE-ADMISSION.**
 * Suppression is keyed on work identity (REQ-071, product invariant 1) and
 * fix-match REPLACES that identity. Leave the suppression behind and the work
 * the owner rejected becomes visible again on the next render, with nothing
 * anywhere to say why. `T-FIX-005` is SD-06, and `T-FIX-006` is the same hole
 * approached from the other side.
 *
 * Run against a real SQL Server and the real Express app, with TMDB served
 * from the committed recordings through `msw` (`specs/testing.md` §3.2).
 * Nothing reaches the internet.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetTmdbRateLimiterForTests } from '../../src/clients/tmdbClient.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { tmdbMswServer, type ReplayOptions } from '../../../../tests/fixtures/msw/tmdb/index.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-fix-match';
const OTHER_SUBJECT = 'oid-other-fix-match';
const ISSUER = 'https://sts.windows.net/tenant/';

/** The one work the recordings cover: `movie/438631` — Dune. */
const DUNE_TMDB_ID = 438631;
const DUNE_IDENTITY = `tmdb:movie:${String(DUNE_TMDB_ID)}`;
/** Any other id 404s from the fixture server, which is the TMDB-miss path. */
const UNRECORDED_TMDB_ID = 999_111;

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

interface FixMatchBody {
  titleId: string;
  workIdentity: string;
  preserved: {
    listingIds: string[];
    dateAdded: Record<string, string>;
    sortDateAdded: string | null;
  };
  suppressionMigrated: { from: string; to: string } | null;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

interface Item {
  titleId: string;
  workIdentity: string;
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;
let otherOwner: OwnerId;
let msw: ReturnType<typeof tmdbMswServer> | undefined;
let calls: string[];

function startTmdb(options: ReplayOptions = {}): void {
  msw?.close();
  msw = tmdbMswServer({ ...options, calls });
  msw.listen({
    // Loopback has to pass through: this suite drives a REAL listening API on
    // an ephemeral port, so every `fetch` to it is an unhandled msw request.
    // Anything that is not loopback is a genuine escape and stays loud — and
    // the global egress guard (`T-CI-007`) is the backstop underneath.
    onUnhandledRequest: (request, print) => {
      const { hostname } = new URL(request.url);
      if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return;
      print.error();
    },
  });
}

const ownerIdFor = async (subject: string): Promise<OwnerId> => {
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });
  expect(res.status).toBe(200);
  return asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
};

const fixMatch = (titleId: string, body: unknown, subject = SUBJECT): Promise<Response> =>
  fetch(`${origin}/api/titles/${titleId}/fix-match`, {
    method: 'POST',
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

const listTitles = async (): Promise<Item[]> => {
  const res = await fetch(`${origin}/api/titles`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Item[] }).items;
};

let seq = 0;
async function seedTitle(options: {
  ownerId?: OwnerId;
  workIdentity?: string;
  matchState?: string;
  services?: string[];
  dateAdded?: string;
  rawExtractedText?: string | null;
  tmdbId?: number | null;
}) {
  seq += 1;
  const id = `fx-${String(seq).padStart(4, '0')}`;
  const on = options.ownerId ?? owner;
  const services = options.services ?? ['netflix'];
  const primary = services[0] ?? 'netflix';
  const dateAdded = new Date(`${options.dateAdded ?? '2026-04-02'}T00:00:00.000Z`);

  const batch = await createUploadBatch(on, {
    id: `b-${id}`,
    service: primary,
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(on, {
    id,
    workIdentity: options.workIdentity ?? `unmatched:${String(seq).padStart(16, '0')}`,
    state: 'active',
    matchState: options.matchState ?? 'unmatched',
    // `title_match_coherent` is a CHECK, not a convention: a matched row must
    // carry a tmdb id and NO extracted text, and an unmatched row the reverse.
    ...((options.matchState ?? 'unmatched') === 'matched'
      ? {
          tmdbId: options.tmdbId ?? DUNE_TMDB_ID,
          tmdbMediaType: 'movie',
          tmdbName: 'Already On Your List',
          tmdbReleaseYear: 2021,
        }
      : {
          rawExtractedText: options.rawExtractedText ?? 'Dune',
          normalisedText: 'dune',
        }),
    tmdbGenres: '[]',
    sortDateAdded: dateAdded,
    createdByBatchId: batch.id,
  });

  const listings = [];
  for (const service of services) {
    listings.push(
      await createServiceListing(on, {
        listingId: `l-${id}-${service}`,
        titleId: title.id,
        service,
        state: 'active',
        dateAdded,
        createdByBatchId: batch.id,
      }),
    );
  }
  return { title, listings, batch };
}

/** Every column of a title's listings, as the store holds them. */
const storedListings = async (titleId: string) =>
  (
    await testPrisma().serviceListing.findMany({
      where: { titleId },
      orderBy: [{ listingId: 'asc' }],
    })
  ).map((row) => ({
    listingId: row.listingId,
    service: row.service,
    state: row.state,
    dateAdded: row.dateAdded.toISOString(),
    createdByBatchId: row.createdByBatchId,
  }));

beforeEach(async () => {
  resetAllowListWarning();
  resetTmdbRateLimiterForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},${OTHER_SUBJECT}`;
  // A key must be present or the client refuses before any request is made,
  // which would make every case below vacuous.
  process.env['TMDB_API_KEY'] = 'test-key';
  calls = [];
  testPrisma();
  await resetDatabase();
  startTmdb();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
  owner = await ownerIdFor(SUBJECT);
  otherOwner = await ownerIdFor(OTHER_SUBJECT);
});

afterEach(async () => {
  msw?.close();
  msw = undefined;
  delete process.env['TMDB_API_KEY'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('POST /api/titles/:titleId/fix-match', () => {
  it('T-FIX-010 · US-030 AC-1 · re-points the title at the chosen work', async () => {
    const { title } = await seedTitle({ rawExtractedText: 'Dnue' });

    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FixMatchBody;
    expect(body.titleId).toBe(title.id);
    expect(body.workIdentity).toBe(DUNE_IDENTITY);

    const stored = await testPrisma().title.findFirstOrThrow({ where: { id: title.id } });
    expect(stored.workIdentity).toBe(DUNE_IDENTITY);
    expect(stored.matchState).toBe('matched');
    expect(stored.tmdbId).toBe(DUNE_TMDB_ID);
    expect(stored.tmdbMediaType).toBe('movie');
    expect(stored.tmdbName).toBe('Dune');
    // §6.3 step 4 — the extracted text was evidence for a match that is now
    // settled. Left in place, a later reader could mistake it for the basis of
    // the identity the row now carries.
    expect(stored.rawExtractedText).toBeNull();
    expect(stored.normalisedText).toBeNull();
  });

  it('T-FIX-010h · the re-match is visible on the combined list immediately', async () => {
    const { title } = await seedTitle({});
    await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });

    const items = await listTitles();
    expect(items.find((item) => item.titleId === title.id)?.workIdentity).toBe(DUNE_IDENTITY);
  });

  it('T-FIX-002 · US-030 AC-2 · every listing survives byte-identical', async () => {
    const { title } = await seedTitle({ services: ['netflix', 'max'], dateAdded: '2025-11-30' });
    const before = await storedListings(title.id);
    expect(before).toHaveLength(2);

    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(200);

    // ⚠ Compared against the STORE, not against the response: a handler that
    // deleted and re-created the listings could still echo the ids it was
    // given, and the whole point of AC-2 is that the rows themselves are the
    // same rows.
    expect(await storedListings(title.id)).toEqual(before);

    const body = (await res.json()) as FixMatchBody;
    expect(body.preserved.listingIds.slice().sort()).toEqual(before.map((l) => l.listingId));
    expect(body.preserved.dateAdded).toEqual({
      [`l-${title.id}-netflix`]: '2025-11-30',
      [`l-${title.id}-max`]: '2025-11-30',
    });
    // The title row itself is the same row: same id, same creation time.
    const stored = await testPrisma().title.findFirstOrThrow({ where: { id: title.id } });
    expect(stored.createdAt.toISOString()).toBe(title.createdAt.toISOString());
  });

  it('T-FIX-003 · US-030 AC-3 · the sort position does not move', async () => {
    // Three titles with distinct dates. The middle one is re-matched; if
    // `sortDateAdded` were recomputed, re-derived from `Date.now()`, or lost,
    // the row would jump to one end and the owner would have to hunt for it.
    const oldest = await seedTitle({ dateAdded: '2024-01-05' });
    const middle = await seedTitle({ dateAdded: '2025-06-15' });
    const newest = await seedTitle({ dateAdded: '2026-04-02' });

    const before = (await listTitles()).map((item) => item.titleId);
    expect(before).toEqual([newest.title.id, middle.title.id, oldest.title.id]);

    const res = await fixMatch(middle.title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as FixMatchBody).preserved.sortDateAdded).toBe('2025-06-15');

    expect((await listTitles()).map((item) => item.titleId)).toEqual(before);
    const stored = await testPrisma().title.findFirstOrThrow({ where: { id: middle.title.id } });
    expect(stored.sortDateAdded?.toISOString()).toBe('2025-06-15T00:00:00.000Z');
  });

  it('T-FIX-004 · US-030 AC-4 · refuses when an active title already holds the work', async () => {
    const existing = await seedTitle({ workIdentity: DUNE_IDENTITY, matchState: 'matched' });
    const { title } = await seedTitle({});

    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(body.error.details['existingTitleId']).toBe(existing.title.id);

    // Nothing was written: refusing has to leave the row exactly as it was, or
    // the owner's next attempt starts from a state they never asked for.
    const stored = await testPrisma().title.findFirstOrThrow({ where: { id: title.id } });
    expect(stored.workIdentity).toBe(title.workIdentity);
    expect(stored.matchState).toBe('unmatched');
  });

  it('T-FIX-004c · confirmDuplicate applies the re-match anyway', async () => {
    await seedTitle({ workIdentity: DUNE_IDENTITY, matchState: 'matched' });
    const { title } = await seedTitle({});

    const res = await fixMatch(title.id, {
      tmdbId: DUNE_TMDB_ID,
      mediaType: 'movie',
      confirmDuplicate: true,
    });
    expect(res.status).toBe(200);

    const stored = await testPrisma().title.findFirstOrThrow({ where: { id: title.id } });
    expect(stored.workIdentity).toBe(DUNE_IDENTITY);
    // ⚠ The acknowledgement has to be WRITTEN. `title_one_active_per_work` is
    // unique on (owner, work_identity, duplicate_ack_seq), so a second active
    // row is only legal once this differs from `''` — and `''` is what "not an
    // acknowledged duplicate" means.
    expect(stored.duplicateAckSeq).not.toBe('');
    expect(
      await testPrisma().title.count({ where: { ownerId: owner, workIdentity: DUNE_IDENTITY } }),
    ).toBe(2);
  });

  it('T-FIX-006 · US-030 AC-5 · refuses a target the owner marked not interested', async () => {
    await createSuppression(owner, {
      id: `supp:${DUNE_IDENTITY}`,
      workIdentity: DUNE_IDENTITY,
      active: true,
      suppressedAt: new Date('2026-01-01T00:00:00.000Z'),
      displayName: 'Dune',
      displayReleaseYear: 2021,
      displayMediaType: 'movie',
      displayPosterPath: null,
    });
    const { title } = await seedTitle({});

    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('TARGET_WORK_SUPPRESSED');
    // The owner is offered the way out rather than left to find it: the same
    // href the suppressed view renders.
    expect(body.error.details['suppressionId']).toBe(`supp:${DUNE_IDENTITY}`);
    expect(body.error.details['unsuppressHref']).toBe(
      `/api/suppressions/${encodeURIComponent(`supp:${DUNE_IDENTITY}`)}/unsuppress`,
    );

    const stored = await testPrisma().title.findFirstOrThrow({ where: { id: title.id } });
    expect(stored.workIdentity).toBe(title.workIdentity);
  });

  it('T-FIX-006b · the suppression gate is checked BEFORE the duplicate gate', async () => {
    // Both conditions hold at once. An owner fix-matching onto a suppressed
    // work must be told THAT, not that it is a duplicate — true, but not the
    // reason they cannot do it, and it points them at the wrong remedy.
    await seedTitle({ workIdentity: DUNE_IDENTITY, matchState: 'matched' });
    await createSuppression(owner, {
      id: `supp:${DUNE_IDENTITY}`,
      workIdentity: DUNE_IDENTITY,
      active: true,
      suppressedAt: new Date('2026-01-01T00:00:00.000Z'),
      displayName: 'Dune',
      displayReleaseYear: 2021,
      displayMediaType: 'movie',
      displayPosterPath: null,
    });
    const { title } = await seedTitle({});

    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('TARGET_WORK_SUPPRESSED');
  });

  it('T-FIX-005 · SD-06 · an active suppression follows the work to its new identity', async () => {
    const { title } = await seedTitle({});
    const previousIdentity = title.workIdentity;
    await createSuppression(owner, {
      id: `supp:${previousIdentity}`,
      workIdentity: previousIdentity,
      active: true,
      suppressedAt: new Date('2026-01-01T00:00:00.000Z'),
      displayName: 'Dnue',
      displayReleaseYear: null,
      displayMediaType: null,
      displayPosterPath: null,
    });

    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(200);
    // Reported, not silent: `ui.md` §9.4 states plainly that the suppression
    // moved, and it can only do so if the API says it did.
    expect(((await res.json()) as FixMatchBody).suppressionMigrated).toEqual({
      from: previousIdentity,
      to: DUNE_IDENTITY,
    });

    const moved = await testPrisma().suppression.findFirstOrThrow({
      where: { ownerId: owner, workIdentity: DUNE_IDENTITY },
    });
    expect(moved.active).toBe(true);
    // The breadcrumb back to the decision. The title table carries no
    // `previousWorkIdentity` column, so this is the only record of the link.
    expect(moved.migratedFrom).toBe(previousIdentity);

    // Nothing is deleted (REQ-028): the old row survives, deactivated.
    const old = await testPrisma().suppression.findFirstOrThrow({
      where: { ownerId: owner, workIdentity: previousIdentity },
    });
    expect(old.active).toBe(false);

    // And the work stays hidden. A suppression that moved but stopped applying
    // would be the REQ-071 hole with extra steps.
    expect((await listTitles()).some((item) => item.titleId === title.id)).toBe(false);
  });

  it('T-FIX-005c · reports `null` when there was no suppression to move', async () => {
    const { title } = await seedTitle({});
    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as FixMatchBody).suppressionMigrated).toBeNull();
    expect(await testPrisma().suppression.count({ where: { ownerId: owner } })).toBe(0);
  });

  it('T-FIX-005d · re-arms a previously lifted suppression on the target', async () => {
    // The target has an INACTIVE suppression, so its `supp:<identity>` row
    // already exists. A bare create would collide on the primary key and fail
    // the whole fix-match for a case that is entirely normal.
    const { title } = await seedTitle({});
    const previousIdentity = title.workIdentity;
    await createSuppression(owner, {
      id: `supp:${DUNE_IDENTITY}`,
      workIdentity: DUNE_IDENTITY,
      active: false,
      suppressedAt: new Date('2025-01-01T00:00:00.000Z'),
      unsuppressedAt: new Date('2025-02-01T00:00:00.000Z'),
      displayName: 'Dune',
      displayReleaseYear: 2021,
      displayMediaType: 'movie',
      displayPosterPath: null,
    });
    await createSuppression(owner, {
      id: `supp:${previousIdentity}`,
      workIdentity: previousIdentity,
      active: true,
      suppressedAt: new Date('2026-01-01T00:00:00.000Z'),
      displayName: 'Dnue',
      displayReleaseYear: null,
      displayMediaType: null,
      displayPosterPath: null,
    });

    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(200);

    const moved = await testPrisma().suppression.findFirstOrThrow({
      where: { id: `supp:${DUNE_IDENTITY}` },
    });
    expect(moved.active).toBe(true);
    expect(moved.unsuppressedAt).toBeNull();
    expect(moved.migratedFrom).toBe(previousIdentity);
  });

  it('T-FIX-010i · 404 when TMDB has no such work', async () => {
    const { title } = await seedTitle({});
    const res = await fixMatch(title.id, { tmdbId: UNRECORDED_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('TMDB_WORK_NOT_FOUND');

    // ⚠ Nothing was written. The identity is composed before the lookup, so a
    // handler that wrote first and asked afterwards would leave the row
    // pointing at a work that does not exist.
    const stored = await testPrisma().title.findFirstOrThrow({ where: { id: title.id } });
    expect(stored.workIdentity).toBe(title.workIdentity);
    expect(stored.matchState).toBe('unmatched');
  });

  it('T-SEC-002d · answers 404 for another owner’s title, never 403', async () => {
    const { title } = await seedTitle({ ownerId: otherOwner });
    const res = await fixMatch(title.id, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
    // Existence is decided BEFORE the body: a malformed body for a foreign id
    // must not answer 400, which is a different answer from the one a missing
    // id gets and so is a disclosure.
    const malformed = await fixMatch(title.id, { tmdbId: 'nope' });
    expect(malformed.status).toBe(404);
  });

  it('T-FIX-010j · rejects a malformed body without touching the row', async () => {
    const { title } = await seedTitle({});
    for (const body of [
      {},
      { tmdbId: 0, mediaType: 'movie' },
      { tmdbId: 1.5, mediaType: 'movie' },
      { tmdbId: DUNE_TMDB_ID, mediaType: 'film' },
      { tmdbId: DUNE_TMDB_ID, mediaType: 'movie', confirmDuplicate: 'true' },
    ]) {
      const res = await fixMatch(title.id, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
    const stored = await testPrisma().title.findFirstOrThrow({ where: { id: title.id } });
    expect(stored.workIdentity).toBe(title.workIdentity);
    expect(calls).toHaveLength(0);
  });
});
