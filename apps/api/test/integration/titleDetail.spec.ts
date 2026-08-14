/**
 * TASK-034 — `GET /api/titles/:titleId` (`specs/api.md` §6.3), `T-LIST-028`.
 *
 * Level **I**, and it has to be: every property asserted here is a property of
 * an owner-scoped QUERY, not of a shaping function. A mocked repository would
 * return whatever the test told it to and would therefore agree that the
 * handler is owner-scoped no matter what the `where` clause actually says —
 * agreement rather than evidence.
 *
 * The security property is the load-bearing one. An unknown id and ANOTHER
 * OWNER'S id must be indistinguishable in the response: a 403 on the second
 * confirms that id exists, which turns id guessing into a membership oracle on
 * the owner's private list. `T-LIST-028f` is the case that fails if anybody
 * ever "improves" the error to be more informative.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  softDeleteServiceListing,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-detail';
const OTHER_SUBJECT = 'oid-other-detail';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (subject: string): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: subject },
        { typ: 'preferred_username', val: `${subject}@example.com` },
      ],
    }),
    'utf8',
  ).toString('base64');

interface Badge {
  service: string;
  listingId: string;
  dateAdded: string;
}

interface RemovedListing {
  listingId: string;
  service: string;
  state: string;
  dateAdded: string;
  removedAt: string | null;
}

interface DetailBody {
  titleId: string;
  workIdentity: string;
  matchState: string;
  name: string;
  mediaType: string | null;
  releaseYear: number | null;
  genres: string[];
  runtimeMinutes: number | null;
  posterPath: string | null;
  badges: Badge[];
  sortDateAdded: string | null;
  dateAddedLabel: string | null;
  removedListings: RemovedListing[];
  createdByBatchId: string | null;
  createdAt: string;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;
/** Derived through the real auth chain, never hard-coded. */
let owner: OwnerId;
let other: OwnerId;

const get = (titleId: string, subject = SUBJECT): Promise<Response> =>
  fetch(`${origin}/api/titles/${encodeURIComponent(titleId)}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });

const detail = async (titleId: string): Promise<DetailBody> => {
  const res = await get(titleId);
  expect(res.status).toBe(200);
  return (await res.json()) as DetailBody;
};

const ownerIdFor = async (subject: string): Promise<OwnerId> => {
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });
  return asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
};

let seq = 0;
async function seedTitle(options: {
  ownerId?: OwnerId;
  id?: string;
  workIdentity?: string;
  name?: string;
  dateAdded?: string;
  service?: string;
  mediaType?: string;
  releaseYear?: number;
  runtimeMinutes?: number;
  posterPath?: string;
  genres?: string[];
  matchState?: string;
  rawExtractedText?: string;
}) {
  seq += 1;
  const id = options.id ?? `d-${String(seq).padStart(4, '0')}`;
  const on = options.ownerId ?? owner;
  const dateAdded = new Date(`${options.dateAdded ?? '2026-04-02'}T00:00:00.000Z`);
  const batch = await createUploadBatch(on, {
    id: `b-${id}`,
    service: options.service ?? 'netflix',
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(on, {
    id,
    workIdentity: options.workIdentity ?? `tmdb:movie:${String(2000 + seq)}`,
    state: 'active',
    matchState: options.matchState ?? 'matched',
    rawExtractedText: options.rawExtractedText ?? null,
    tmdbId: 2000 + seq,
    tmdbMediaType: options.mediaType ?? 'movie',
    tmdbName: options.name ?? `Title ${String(seq)}`,
    tmdbReleaseYear: options.releaseYear ?? 2021,
    tmdbRuntimeMinutes: options.runtimeMinutes ?? 155,
    tmdbGenres: JSON.stringify(options.genres ?? ['Drama', 'Sci-Fi']),
    tmdbPosterPath: options.posterPath ?? '/poster.jpg',
    sortDateAdded: dateAdded,
    createdByBatchId: batch.id,
  });
  const listing = await createServiceListing(on, {
    listingId: `l-${id}`,
    titleId: title.id,
    service: options.service ?? 'netflix',
    state: 'active',
    dateAdded,
    createdByBatchId: batch.id,
  });
  return { title, listing, batch };
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},${OTHER_SUBJECT}`;
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });

  owner = await ownerIdFor(SUBJECT);
  other = await ownerIdFor(OTHER_SUBJECT);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-LIST-028 GET /api/titles/:titleId', () => {
  it('T-LIST-028a: returns the single canonical work with its display fields', async () => {
    const { title } = await seedTitle({
      name: 'Dune',
      releaseYear: 2021,
      runtimeMinutes: 155,
      posterPath: '/dune.jpg',
      mediaType: 'movie',
      genres: ['Sci-Fi'],
      dateAdded: '2026-04-02',
    });

    const body = await detail(title.id);

    expect(body.titleId).toBe(title.id);
    expect(body.workIdentity).toBe(title.workIdentity);
    expect(body.name).toBe('Dune');
    expect(body.mediaType).toBe('movie');
    expect(body.releaseYear).toBe(2021);
    expect(body.runtimeMinutes).toBe(155);
    expect(body.posterPath).toBe('/dune.jpg');
    expect(body.genres).toEqual(['Sci-Fi']);
    expect(body.sortDateAdded).toBe('2026-04-02');
    // Rendered server-side so REQ-061's wording has exactly one implementation.
    expect(body.dateAddedLabel).not.toBeNull();
    expect(body.createdByBatchId).toBe(`b-${title.id}`);
    expect(typeof body.createdAt).toBe('string');
  });

  it('T-LIST-028b: one work on two services is ONE row with two badges', async () => {
    // The detail view must not re-split a deduplicated work any more than the
    // list does (US-018, product invariant: one row per work).
    const { title, batch } = await seedTitle({ name: 'Dune', service: 'netflix' });
    await createServiceListing(owner, {
      listingId: 'l-dune-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-06-11T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });

    const body = await detail(title.id);

    expect(body.badges.map((b) => b.service).sort()).toEqual(['max', 'netflix']);
    expect(body.badges.find((b) => b.service === 'max')?.dateAdded).toBe('2026-06-11');
    expect(body.removedListings).toEqual([]);
  });

  it('T-LIST-028c: a removed listing leaves badges and appears in removedListings', async () => {
    // ⚠ The discriminating case for the active/removed split. If the handler
    // fed ALL listings to `toListItem`, the badge for a service that no longer
    // holds the title would reappear — in the one view that shows the removal
    // right beside it.
    const { title, batch } = await seedTitle({ name: 'Dune', service: 'netflix' });
    await createServiceListing(owner, {
      listingId: 'l-dune-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-06-11T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });
    await softDeleteServiceListing(owner, 'l-dune-max', {
      removedByBatchId: batch.id,
      removedAt: new Date('2026-07-01T10:30:00.000Z'),
    });

    const body = await detail(title.id);

    expect(body.badges.map((b) => b.service)).toEqual(['netflix']);
    expect(body.removedListings).toHaveLength(1);
    const removed = body.removedListings[0];
    expect(removed?.listingId).toBe('l-dune-max');
    expect(removed?.service).toBe('max');
    expect(removed?.state).toBe('removed');
    // A timestamp, not a date: the removed view is an ordered log and two
    // removals on one day must stay distinguishable.
    expect(removed?.removedAt).toBe('2026-07-01T10:30:00.000Z');
    // Write-once, and carried through unchanged by the removal (REQ-030).
    expect(removed?.dateAdded).toBe('2026-06-11');
  });

  it('T-LIST-028d: an unmatched title falls back to its raw extracted text', async () => {
    seq += 1;
    const batch = await createUploadBatch(owner, {
      id: 'b-unmatched',
      service: 'netflix',
      mode: 'append-only',
      status: 'applied',
    });
    const title = await createTitle(owner, {
      id: 'd-unmatched',
      workIdentity: 'unmatched:9f2c1a7b4e0d5c83',
      state: 'active',
      matchState: 'unmatched',
      rawExtractedText: 'DUNE PRT TWO',
      tmdbGenres: '[]',
      sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });

    const body = await detail(title.id);

    // Never a placeholder: inventing one hides from the owner that the title
    // never matched, which is the state the fix-match flow exists to resolve.
    expect(body.name).toBe('DUNE PRT TWO');
    expect(body.matchState).toBe('unmatched');
    expect(body.genres).toEqual([]);
  });

  it('T-LIST-028e: an unknown id is 404 with the error envelope', async () => {
    const res = await get('no-such-title');

    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it("T-LIST-028f: ANOTHER OWNER's id is 404, never 403, and is byte-identical to the unknown-id refusal", async () => {
    // The membership-oracle guard. If these two responses ever differ — in
    // status, code or message — id guessing tells an unauthorised caller which
    // titles the owner has, without them reading a single one.
    const foreign = await seedTitle({ ownerId: other, id: 'd-foreign', name: 'Their Film' });

    const foreignRes = await get(foreign.title.id);
    const unknownRes = await get('no-such-title');

    expect(foreignRes.status).toBe(404);
    expect(foreignRes.status).not.toBe(403);
    expect(await foreignRes.text()).toBe(await unknownRes.text());
  });

  it('T-LIST-028g: the other owner CAN read their own row (the refusal is scoping, not a blanket 404)', async () => {
    // Non-vacuity for 028f. Without this, a handler that answered 404 for
    // every id whatsoever would pass the security case perfectly.
    const foreign = await seedTitle({ ownerId: other, id: 'd-theirs', name: 'Their Film' });

    const res = await get(foreign.title.id, OTHER_SUBJECT);

    expect(res.status).toBe(200);
    expect(((await res.json()) as DetailBody).name).toBe('Their Film');
  });

  it('T-LIST-028h: a suppressed work is still readable here, though the list hides it', async () => {
    // REQ-024 removes a suppressed work from the LIST; "not interested" is not
    // deletion. US-033's undo path has to be able to read the work back, so
    // borrowing the list's suppression anti-join here would make the escape
    // hatch unreachable.
    const { title } = await seedTitle({ name: 'Not Interested' });
    await createSuppression(owner, {
      id: 'supp-detail',
      workIdentity: title.workIdentity,
      displayName: 'Not Interested',
    });

    const body = await detail(title.id);

    expect(body.titleId).toBe(title.id);
  });
});
