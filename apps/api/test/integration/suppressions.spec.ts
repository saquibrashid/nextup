/**
 * TASK-101 — `POST /api/titles/:titleId/suppress` (`specs/api.md` §6.6, US-027).
 *
 * Run against a real SQL Server rather than a stubbed repository because every
 * property asserted here is a property of the STORE: that the key is derived
 * from the work identity, that a repeat press writes nothing, that nothing is
 * deleted. A mock would agree with whatever the handler did, which is
 * agreement rather than evidence.
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
  createTitle,
  createUploadBatch,
  deactivateSuppression,
  softDeleteServiceListing,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-suppress';
const OTHER_SUBJECT = 'oid-other-suppress';
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

interface SuppressBody {
  suppressionId: string;
  workIdentity: string;
  alreadySuppressed: boolean;
}

interface Item {
  titleId: string;
  workIdentity: string;
  badges: { service: string }[];
}

/** One row of `GET /api/suppressions` (`specs/api.md` §6.7). */
interface SuppressionItemBody {
  suppressionId: string;
  workIdentity: string;
  suppressedAt: string;
  identityStability: 'stable' | 'text-derived';
  displaySnapshot: {
    name: string;
    releaseYear: number | null;
    mediaType: string | null;
    posterPath: string | null;
  };
  unsuppressHref: string;
}

let server: Server;
let app: Express;
let origin: string;
/**
 * The owner id the auth chain derives for `SUBJECT` — read from `/api/me`,
 * never hard-coded. The derivation is a one-way function of the principal
 * (`ownerId.ts`), so a literal here is a guess that seeds rows under an owner
 * no request will ever be scoped to — and every assertion then fails as a 404
 * that looks like a routing bug.
 */
let owner: OwnerId;
let otherOwner: OwnerId;

const ownerIdFor = async (subject: string): Promise<OwnerId> => {
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });
  expect(res.status).toBe(200);
  return asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
};

const suppress = (titleId: string, subject = SUBJECT): Promise<Response> =>
  fetch(`${origin}/api/titles/${titleId}/suppress`, {
    method: 'POST',
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject),
      'content-type': 'application/json',
    },
    body: '{}',
  });

const listTitles = async (): Promise<Item[]> => {
  const res = await fetch(`${origin}/api/titles`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Item[] }).items;
};

let seq = 0;
/** A title with one active listing per requested service. */
async function seedTitle(options: {
  ownerId?: OwnerId;
  workIdentity?: string;
  name?: string;
  services?: string[];
  matchState?: string;
  rawExtractedText?: string | null;
  tmdbName?: string | null;
}) {
  seq += 1;
  const id = `s-${String(seq).padStart(4, '0')}`;
  const on = options.ownerId ?? owner;
  const services = options.services ?? ['netflix'];
  const primary = services[0] ?? 'netflix';

  const batch = await createUploadBatch(on, {
    id: `b-${id}`,
    service: primary,
    mode: 'append-only',
    status: 'applied',
  });
  const matched = (options.matchState ?? 'matched') === 'matched';
  const title = await createTitle(on, {
    id,
    workIdentity: options.workIdentity ?? `tmdb:movie:${String(2000 + seq)}`,
    state: 'active',
    matchState: options.matchState ?? 'matched',
    ...(matched
      ? {
          tmdbId: 2000 + seq,
          tmdbMediaType: 'movie',
          tmdbName: options.tmdbName ?? options.name ?? `Title ${String(seq)}`,
          tmdbReleaseYear: 1999,
          tmdbPosterPath: '/p.jpg',
        }
      : { rawExtractedText: options.rawExtractedText ?? 'Raw Text' }),
    tmdbGenres: JSON.stringify(['Drama']),
    sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
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
        dateAdded: new Date('2026-04-02T00:00:00.000Z'),
        createdByBatchId: batch.id,
      }),
    );
  }
  return { title, listings, batch };
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
  otherOwner = await ownerIdFor(OTHER_SUBJECT);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('POST /api/titles/:titleId/suppress', () => {
  it('T-SUP-001a · US-028 AC-1 · the key is `supp:` + the work identity', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:438631' });

    const res = await suppress(title.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuppressBody;

    // Spelled out independently, not imported. Comparing the response to the
    // constant that produced it is a tautology that survives any reword.
    expect(body.suppressionId).toBe('supp:tmdb:movie:438631');
    expect(body.workIdentity).toBe('tmdb:movie:438631');
  });

  it('T-SUP-001b · US-028 AC-1 · no row id appears anywhere in the stored key', async () => {
    const { title, listings } = await seedTitle({ workIdentity: 'tmdb:tv:1396' });
    await suppress(title.id);

    const row = await testPrisma().suppression.findFirstOrThrow({
      where: { ownerId: owner },
    });

    // The title id, the listing id and the batch id are all in scope at the
    // call site; none of them may leak into the key or the identity. This is
    // product invariant 1 stated as an assertion — a row-scoped key would be
    // bypassed the moment the work reappears as a new row.
    for (const rowId of [title.id, listings[0]?.listingId ?? '', `b-${title.id}`]) {
      expect(row.id).not.toContain(rowId);
      expect(row.workIdentity).not.toContain(rowId);
    }
    expect(row.id).toBe('supp:tmdb:tv:1396');
  });

  it('T-SUP-010a · US-027 AC-1 · a Suppression keyed on workIdentity is created', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:603', name: 'The Matrix' });

    const body = (await (await suppress(title.id)).json()) as SuppressBody;
    expect(body.alreadySuppressed).toBe(false);

    const row = await testPrisma().suppression.findUniqueOrThrow({
      where: { id: 'supp:tmdb:movie:603' },
    });
    expect(row.ownerId).toBe(owner);
    expect(row.workIdentity).toBe('tmdb:movie:603');
    expect(row.active).toBe(true);
    expect(row.unsuppressedAt).toBeNull();
  });

  it('T-SUP-010b · US-029 AC-1 · the display snapshot is frozen on the suppression', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:604', name: 'Frozen Name' });
    await suppress(title.id);

    const row = await testPrisma().suppression.findUniqueOrThrow({
      where: { id: 'supp:tmdb:movie:604' },
    });

    // Copied, not referenced. The suppressed view has to render after the
    // title is gone, so reading through to the title at display time would
    // show an empty row for a decision the owner definitely made.
    expect(row.displayName).toBe('Frozen Name');
    expect(row.displayReleaseYear).toBe(1999);
    expect(row.displayMediaType).toBe('movie');
    expect(row.displayPosterPath).toBe('/p.jpg');
  });

  it('T-SUP-010c · OQ-015 · an UNMATCHED title can be suppressed', async () => {
    const { title } = await seedTitle({
      workIdentity: 'unmatched:0123456789abcdef',
      matchState: 'unmatched',
      rawExtractedText: 'Sqwiggly OCR Text',
    });

    const res = await suppress(title.id);
    expect(res.status).toBe(200);

    const row = await testPrisma().suppression.findUniqueOrThrow({
      where: { id: 'supp:unmatched:0123456789abcdef' },
    });
    // Falls back to the raw text: an unmatched work has no TMDB name, and a
    // suppression the owner cannot recognise is barely better than none.
    expect(row.displayName).toBe('Sqwiggly OCR Text');
  });

  it('T-SUP-011a · US-027 AC-2 · the work leaves the combined list', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:605' });
    expect(await listTitles()).toHaveLength(1);

    await suppress(title.id);

    expect(await listTitles()).toHaveLength(0);
  });

  it('T-SUP-012a · US-027 AC-3 · nothing is deleted; listings keep their prior state', async () => {
    const { title, listings } = await seedTitle({
      workIdentity: 'tmdb:movie:606',
      services: ['netflix', 'max'],
    });
    await suppress(title.id);

    // REQ-028: soft delete forever. Suppression is a VISIBILITY decision, and
    // the anti-join in the list query is what enacts it. If suppression
    // deleted rows, un-suppression could not honestly report
    // `restoredAnything: false` — there would be something to restore.
    const stillThere = await testPrisma().title.findUniqueOrThrow({ where: { id: title.id } });
    expect(stillThere.state).toBe('active');

    for (const listing of listings) {
      const row = await testPrisma().serviceListing.findUniqueOrThrow({
        where: { listingId: listing.listingId },
      });
      expect(row.state).toBe('active');
      expect(row.removedAt).toBeNull();
    }
  });

  it('T-SUP-013a · US-027 AC-4 · re-suppressing is idempotent and 200', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:607' });

    const first = (await (await suppress(title.id)).json()) as SuppressBody;
    expect(first.alreadySuppressed).toBe(false);

    const res = await suppress(title.id);
    expect(res.status).toBe(200);
    const second = (await res.json()) as SuppressBody;
    expect(second.alreadySuppressed).toBe(true);
    expect(second.suppressionId).toBe(first.suppressionId);

    expect(await testPrisma().suppression.count({ where: { ownerId: owner } })).toBe(1);
  });

  it('T-SUP-013b · US-027 AC-4 · a repeat press does NOT rewrite suppressedAt', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:608' });
    await suppress(title.id);

    const before = await testPrisma().suppression.findUniqueOrThrow({
      where: { id: 'supp:tmdb:movie:608' },
    });

    // A plain upsert would pass every other assertion in this file while
    // silently moving the date the owner made the decision — which is the
    // field the suppressed view sorts and renders on.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await suppress(title.id);

    const after = await testPrisma().suppression.findUniqueOrThrow({
      where: { id: 'supp:tmdb:movie:608' },
    });
    expect(after.suppressedAt.toISOString()).toBe(before.suppressedAt.toISOString());
  });

  it('T-SUP-013c · re-suppressing a LIFTED suppression re-arms the same document', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:609' });
    await suppress(title.id);
    await deactivateSuppression(owner, 'tmdb:movie:609', new Date('2026-01-01T00:00:00.000Z'));

    const body = (await (await suppress(title.id)).json()) as SuppressBody;
    expect(body.alreadySuppressed).toBe(false);

    const rows = await testPrisma().suppression.findMany({ where: { ownerId: owner } });
    // ONE document, re-armed — never a second row. The id is a pure function
    // of the identity, so a second row is not representable, and `active`
    // toggling is what REQ-028 requires instead of a delete.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.active).toBe(true);
    expect(rows[0]?.unsuppressedAt).toBeNull();
  });

  it('T-SUP-014a · US-027 AC-5 · suppressing a two-badge title hides the WHOLE row', async () => {
    const { title } = await seedTitle({
      workIdentity: 'tmdb:movie:610',
      services: ['netflix', 'max'],
    });

    const before = await listTitles();
    expect(before[0]?.badges).toHaveLength(2);

    await suppress(title.id);

    // Per work, not per service. There is no per-service suppression to get
    // wrong because there is no per-service key — both services' listings
    // hang off one identity.
    expect(await listTitles()).toHaveLength(0);
    expect(await testPrisma().suppression.count({ where: { ownerId: owner } })).toBe(1);
  });

  it('T-SUP-014b · US-027 AC-5 · a DIFFERENT work on the same services is untouched', async () => {
    const { title } = await seedTitle({
      workIdentity: 'tmdb:movie:611',
      services: ['netflix', 'max'],
    });
    await seedTitle({ workIdentity: 'tmdb:movie:612', services: ['netflix', 'max'] });

    await suppress(title.id);

    // Guards the opposite failure: a suppression scoped to the SERVICE rather
    // than the work would empty the list entirely and still pass T-SUP-014a.
    const remaining = await listTitles();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.workIdentity).toBe('tmdb:movie:612');
  });

  it('T-SUP-001c · NFR-008 · a foreign title answers 404, not 403', async () => {
    const { title } = await seedTitle({ ownerId: otherOwner, workIdentity: 'tmdb:movie:613' });

    const res = await suppress(title.id);
    // 404, never 403: a 403 would confirm the row exists. `findTitle` is
    // owner-scoped, so foreign and missing are indistinguishable by design.
    expect(res.status).toBe(404);
    expect(await testPrisma().suppression.count()).toBe(0);
  });

  it('T-SUP-001d · an unknown title id answers 404 and writes nothing', async () => {
    const res = await suppress('no-such-title');
    expect(res.status).toBe(404);
    expect(await testPrisma().suppression.count()).toBe(0);
  });
});

describe('TASK-106 · `GET /api/suppressions` and `/unsuppress` against the real store', () => {
  const listSuppressions = async (subject = SUBJECT): Promise<SuppressionItemBody[]> => {
    const res = await fetch(`${origin}/api/suppressions`, {
      headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: SuppressionItemBody[] }).items;
  };

  const unsuppress = (suppressionId: string, subject = SUBJECT): Promise<Response> =>
    fetch(`${origin}/api/suppressions/${encodeURIComponent(suppressionId)}/unsuppress`, {
      method: 'POST',
      headers: {
        [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject),
        'content-type': 'application/json',
      },
      body: '{}',
    });

  it('T-SUP-020i · US-029 AC-1 · every active suppression is listed with a renderable snapshot', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:701', tmdbName: 'Heat' });
    await suppress(title.id);

    const items = await listSuppressions();
    expect(items).toHaveLength(1);
    expect(items[0]?.workIdentity).toBe('tmdb:movie:701');
    expect(items[0]?.displaySnapshot.name).toBe('Heat');
    expect(items[0]?.identityStability).toBe('stable');
  });

  it('T-SUP-020j · US-029 AC-1 · it renders after the TITLE ITSELF is gone', async () => {
    // The property a mock cannot hold and the reason `displaySnapshot` exists:
    // the suppressed view must not join back to `Title`. Deleting the row here
    // is a test fixture, not a sanctioned operation -- it stands in for a title
    // that was removed and reconciled away long after the decision was made.
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:702', tmdbName: 'Collateral' });
    await suppress(title.id);
    await testPrisma().serviceListing.deleteMany({ where: { titleId: title.id } });
    await testPrisma().title.deleteMany({ where: { id: title.id } });

    const items = await listSuppressions();
    expect(items).toHaveLength(1);
    expect(items[0]?.displaySnapshot.name).toBe('Collateral');
  });

  it('T-SUP-020k · an unmatched identity is reported text-derived', async () => {
    const { title } = await seedTitle({
      workIdentity: 'unmatched:9f2c1a7b4e0d5c83',
      matchState: 'unmatched',
      rawExtractedText: 'the mtrix',
    });
    await suppress(title.id);

    const items = await listSuppressions();
    expect(items[0]?.identityStability).toBe('text-derived');
    expect(items[0]?.displaySnapshot.name).toBe('the mtrix');
  });

  it('T-SUP-020l · NFR-008 · one owner never sees the other owner’s suppressions', async () => {
    const { title } = await seedTitle({ ownerId: otherOwner, workIdentity: 'tmdb:movie:703' });
    await suppress(title.id, OTHER_SUBJECT);

    expect(await listSuppressions(OTHER_SUBJECT)).toHaveLength(1);
    expect(await listSuppressions(SUBJECT)).toHaveLength(0);
  });

  it('T-SUP-021j · US-029 AC-2 · un-suppress deactivates and DELETES NOTHING', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:704' });
    await suppress(title.id);
    const [item] = await listSuppressions();

    const res = await unsuppress(item?.suppressionId ?? '');
    expect(res.status).toBe(200);
    expect((await res.json()) as { restoredAnything: boolean }).toMatchObject({
      active: false,
      restoredAnything: false,
    });

    // REQ-028, asserted against the STORE rather than against the handler’s
    // own claim: the row survives, keeps the date the decision was made, and
    // records when it was lifted.
    const row = await testPrisma().suppression.findFirst({ where: { ownerId: owner } });
    expect(row).not.toBeNull();
    expect(row?.active).toBe(false);
    expect(row?.unsuppressedAt).not.toBeNull();
    expect(await testPrisma().suppression.count({ where: { ownerId: owner } })).toBe(1);
  });

  it('T-SUP-021k · US-029 AC-4 · the filter lifts; the REMOVED LISTING stays removed', async () => {
    // Invariant 7. Un-suppression lifts a filter; it restores nothing. This is
    // the store-level half of `restoredAnything: false`, and no unit test can
    // hold it: it is a property of what un-suppress does NOT write.
    const { title, listings, batch } = await seedTitle({ workIdentity: 'tmdb:movie:705' });
    const listingId = listings[0]?.listingId ?? '';
    await suppress(title.id);

    await softDeleteServiceListing(owner, listingId, {
      removedAt: new Date(),
      removedByBatchId: batch.id,
    });

    const [item] = await listSuppressions();
    await unsuppress(item?.suppressionId ?? '');

    expect(await listSuppressions()).toHaveLength(0);
    // The assertion that matters, stated positively so it cannot pass
    // vacuously on an empty list: the listing is STILL removed afterwards.
    const listing = await testPrisma().serviceListing.findFirst({ where: { listingId } });
    expect(listing?.state).toBe('removed');
    expect(listing?.removedAt).not.toBeNull();
    // And the title is still not on the combined list, because nothing
    // restored its only listing.
    expect((await listTitles()).some((t) => t.titleId === title.id)).toBe(false);
  });

  it('T-SUP-021l · un-suppress then re-suppress reuses the SAME row', async () => {
    // Why deactivation rather than deletion matters at the store level: the
    // `suppression_one_active` filtered unique index frees the identity for a
    // future suppression, so re-suppressing must not raise a duplicate-key
    // error and must not create a second document.
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:706' });
    await suppress(title.id);
    const [item] = await listSuppressions();
    await unsuppress(item?.suppressionId ?? '');

    expect((await suppress(title.id)).status).toBe(200);
    expect(await testPrisma().suppression.count({ where: { ownerId: owner } })).toBe(1);
    expect((await listSuppressions())[0]?.suppressionId).toBe(item?.suppressionId);
  });

  it('T-SUP-021m · a second press is 200 and rewrites nothing', async () => {
    const { title } = await seedTitle({ workIdentity: 'tmdb:movie:707' });
    await suppress(title.id);
    const [item] = await listSuppressions();

    await unsuppress(item?.suppressionId ?? '');
    const first = await testPrisma().suppression.findFirst({ where: { ownerId: owner } });

    expect((await unsuppress(item?.suppressionId ?? '')).status).toBe(200);
    const second = await testPrisma().suppression.findFirst({ where: { ownerId: owner } });

    // `deactivateSuppression` matches only ACTIVE rows, so the moment the
    // owner actually changed their mind survives a repeat press.
    expect(second?.unsuppressedAt?.toISOString()).toBe(first?.unsuppressedAt?.toISOString());
  });

  it('T-SUP-021n · NFR-008 · a foreign suppression id answers 404 and writes nothing', async () => {
    const { title } = await seedTitle({ ownerId: otherOwner, workIdentity: 'tmdb:movie:708' });
    await suppress(title.id, OTHER_SUBJECT);
    const [item] = await listSuppressions(OTHER_SUBJECT);

    const res = await unsuppress(item?.suppressionId ?? '', SUBJECT);
    expect(res.status).toBe(404);

    const row = await testPrisma().suppression.findFirst({ where: { ownerId: otherOwner } });
    expect(row?.active).toBe(true);
  });
});
