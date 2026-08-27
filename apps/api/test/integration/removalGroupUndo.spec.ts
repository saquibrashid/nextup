/**
 * TASK-090 — `POST /api/removal-groups/:groupId/undo` (`specs/api.md` §6.26,
 * US-017, REQ-056).
 *
 * ⚠ **UNDO IS WHAT MAKES CONFIRMING A REMOVAL SAFE TO PRESS**, so the failure
 * this file exists to catch is not "undo did not work" — that is visible the
 * moment the owner looks at their list — but "undo reported success and part
 * of the group did not come back". `T-GRP-014` is that assertion; `T-GRP-012`
 * is the same shape from the other side, where a held-back item MUST be named
 * rather than silently skipped.
 *
 * ⚠ **AND THAT THE DATES SURVIVE IT.** A restore that stamped today's date
 * would return every title to the list at the top of the default sort, which
 * is a silent edit of data that came off a screenshot the owner may no longer
 * have. `T-GRP-010` compares the stored `dateAdded` across the call.
 *
 * Run against a real SQL Server and the real Express app (`specs/testing.md`
 * §3.2). Nothing reaches the internet.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createRemovalGroup,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-group-undo';
const OTHER_SUBJECT = 'oid-other-group-undo';
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

interface UndoBody {
  groupId: string;
  restoredListingIds: string[];
  heldBack: { listingId: string; reason: string; name: string; unsuppressHref: string }[];
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;
let otherOwner: OwnerId;

const ownerIdFor = async (subject: string): Promise<OwnerId> => {
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });
  expect(res.status).toBe(200);
  return asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
};

const undo = (groupId: string, subject = SUBJECT): Promise<Response> =>
  fetch(`${origin}/api/removal-groups/${groupId}/undo`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });

const listTitleIds = async (): Promise<string[]> => {
  const res = await fetch(`${origin}/api/titles`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { titleId: string }[] }).items.map((i) => i.titleId);
};

let seq = 0;

/**
 * Seed one removal group holding N removed listings, exactly as a full-update
 * close leaves them: one group, one batch, one shared removal instant.
 */
async function seedGroup(
  members: {
    workIdentity?: string;
    name?: string | null;
    extractedText?: string;
    service?: string;
    dateAdded?: string;
    /** Leave this member ACTIVE to model a concurrent restore (AC-6). */
    alreadyActive?: boolean;
  }[],
  options: { ownerId?: OwnerId; undoneAt?: Date } = {},
) {
  seq += 1;
  const on = options.ownerId ?? owner;
  const groupId = `g-${String(seq).padStart(4, '0')}`;
  const removedAt = new Date('2026-07-14T09:31:02.117Z');

  const batch = await createUploadBatch(on, {
    id: `b-${groupId}`,
    service: members[0]?.service ?? 'netflix',
    mode: 'full-update',
    status: 'applied',
  });
  await createRemovalGroup(on, {
    id: groupId,
    batchId: batch.id,
    ...(options.undoneAt === undefined ? {} : { undoneAt: options.undoneAt }),
  });

  const seeded = [];
  for (const [index, member] of members.entries()) {
    const id = `${groupId}-${String(index)}`;
    const matched = member.name != null;
    const dateAdded = new Date(`${member.dateAdded ?? '2026-04-02'}T00:00:00.000Z`);
    const title = await createTitle(on, {
      id: `t-${id}`,
      workIdentity:
        member.workIdentity ??
        (matched
          ? `tmdb:movie:${String(500_000 + seq * 10 + index)}`
          : `unmatched:${String(seq * 100 + index).padStart(16, '0')}`),
      // The title is `removed` exactly when every one of its listings is
      // (invariant I-3); each member here has a single listing.
      state: member.alreadyActive === true ? 'active' : 'removed',
      matchState: matched ? 'matched' : 'unmatched',
      ...(matched
        ? {
            tmdbId: 500_000 + seq * 10 + index,
            tmdbMediaType: 'movie',
            tmdbName: member.name ?? '',
            tmdbReleaseYear: 2021,
          }
        : {
            rawExtractedText: member.extractedText ?? 'Unreadable Thing',
            normalisedText: (member.extractedText ?? 'Unreadable Thing').toLowerCase(),
          }),
      tmdbGenres: '[]',
      sortDateAdded: member.alreadyActive === true ? dateAdded : null,
      createdByBatchId: batch.id,
    });
    const listing = await createServiceListing(on, {
      listingId: `l-${id}`,
      titleId: title.id,
      service: member.service ?? 'netflix',
      state: member.alreadyActive === true ? 'active' : 'removed',
      dateAdded,
      ...(member.alreadyActive === true ? {} : { removedAt, removedByBatchId: batch.id }),
      // ⚠ Group membership is recorded even on the already-active member: that
      // is precisely the state a concurrent §6.10 restore leaves behind, and
      // the undo has to see it rather than skip it.
      removedByGroupId: groupId,
      createdByBatchId: batch.id,
    });
    seeded.push({ title, listing });
  }

  return { groupId, batch, members: seeded };
}

const storedListing = (listingId: string) =>
  testPrisma().serviceListing.findFirstOrThrow({ where: { listingId } });

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},${OTHER_SUBJECT}`;
  if (server === undefined) {
    app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }
  owner = await ownerIdFor(SUBJECT);
  otherOwner = await ownerIdFor(OTHER_SUBJECT);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeTestPrisma();
});

describe('POST /api/removal-groups/:groupId/undo', () => {
  it('T-GRP-010: returns every listing to active with its ORIGINAL dateAdded', async () => {
    const { groupId, members } = await seedGroup([
      { name: 'Dune', dateAdded: '2026-04-02' },
      { name: 'Heat', dateAdded: '2025-11-20' },
    ]);
    const before = await Promise.all(members.map((m) => storedListing(m.listing.listingId)));

    const res = await undo(groupId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as UndoBody;
    expect(body.restoredListingIds).toEqual(members.map((m) => m.listing.listingId));
    expect(body.heldBack).toEqual([]);

    const after = await Promise.all(members.map((m) => storedListing(m.listing.listingId)));
    expect(after.map((l) => l.state)).toEqual(['active', 'active']);
    // The dates are compared as STORED bytes, not echoed from the response: a
    // handler that re-created the listings could still return the right ids.
    expect(after.map((l) => l.dateAdded.toISOString())).toEqual(
      before.map((l) => l.dateAdded.toISOString()),
    );
    expect(after.every((l) => l.removedAt === null)).toBe(true);
  });

  it('T-GRP-010b: the affected titles return to the combined list', async () => {
    // The listing coming back is not enough: `state` and `sortDateAdded` are
    // DERIVED, and a title left `removed` beside an active listing is back on
    // the service and still missing from the list.
    const { groupId, members } = await seedGroup([{ name: 'Dune', dateAdded: '2026-04-02' }]);
    expect(await listTitleIds()).toEqual([]);

    expect((await undo(groupId)).status).toBe(200);

    expect(await listTitleIds()).toEqual([members[0]?.title.id]);
  });

  it('T-GRP-010c: the restored title takes its sort position from the ORIGINAL date', async () => {
    const { groupId, members } = await seedGroup([{ name: 'Dune', dateAdded: '2026-04-02' }]);

    expect((await undo(groupId)).status).toBe(200);

    const title = await testPrisma().title.findFirstOrThrow({
      where: { id: members[0]?.title.id ?? '' },
    });
    expect(title.state).toBe('active');
    expect(title.sortDateAdded?.toISOString()).toBe('2026-04-02T00:00:00.000Z');
  });

  it('T-GRP-011: the group is still undoable later; undo is not time-limited', async () => {
    // No expiry exists anywhere in this path, and the assertion is that a group
    // created long ago behaves identically. `createdAt` is database-generated,
    // so this drives the same route against a group whose batch is closed and
    // whose listings have been removed for months of wall-clock difference.
    const { groupId, members } = await seedGroup([{ name: 'Dune', dateAdded: '2024-01-05' }]);
    await testPrisma().removalGroup.update({
      where: { id: groupId },
      data: { createdAt: new Date('2024-02-01T00:00:00.000Z') },
    });

    const res = await undo(groupId);

    expect(res.status).toBe(200);
    expect((await storedListing(members[0]?.listing.listingId ?? '')).state).toBe('active');
  });

  it('T-GRP-012: a since-suppressed work is held back, named, with an un-suppress link', async () => {
    const work = 'tmdb:movie:949';
    const { groupId, members } = await seedGroup([
      { name: 'Dune' },
      { workIdentity: work, name: 'Heat' },
    ]);
    await createSuppression(owner, {
      id: `supp:${work}`,
      workIdentity: work,
      active: true,
      displayName: 'Heat',
    });

    const res = await undo(groupId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as UndoBody;
    // Suppression is the NEWER decision; returning the work would reverse a
    // choice the owner never asked to reverse.
    expect(body.restoredListingIds).toEqual([members[0]?.listing.listingId]);
    expect(body.heldBack).toEqual([
      {
        listingId: members[1]?.listing.listingId,
        reason: 'work-suppressed',
        name: 'Heat',
        unsuppressHref: `/api/suppressions/${encodeURIComponent(`supp:${work}`)}/unsuppress`,
      },
    ]);
    expect((await storedListing(members[1]?.listing.listingId ?? '')).state).toBe('removed');
  });

  it('T-GRP-012b: the held-back work does NOT reappear in the combined list', async () => {
    const work = 'tmdb:movie:949';
    const { groupId, members } = await seedGroup([
      { name: 'Dune' },
      { workIdentity: work, name: 'Heat' },
    ]);
    await createSuppression(owner, {
      id: `supp:${work}`,
      workIdentity: work,
      active: true,
      displayName: 'Heat',
    });

    expect((await undo(groupId)).status).toBe(200);

    expect(await listTitleIds()).toEqual([members[0]?.title.id]);
  });

  it('T-GRP-012c: a LIFTED suppression holds nothing back', async () => {
    const work = 'tmdb:movie:949';
    const { groupId } = await seedGroup([{ workIdentity: work, name: 'Heat' }]);
    await createSuppression(owner, {
      id: `supp:${work}`,
      workIdentity: work,
      active: false,
      displayName: 'Heat',
    });

    const body = (await (await undo(groupId)).json()) as UndoBody;

    expect(body.heldBack).toEqual([]);
    expect(body.restoredListingIds).toHaveLength(1);
  });

  it('T-GRP-012d: an unmatched held-back item is named by its extracted text', async () => {
    // ⚠ 16 hex characters: `WORK_IDENTITY_RE` is strict and `suppressionIdFor`
    // throws on anything else, so a made-up identity would fail here for a
    // reason that has nothing to do with what is under test.
    const work = 'unmatched:00000000deadbeef';
    const { groupId } = await seedGroup([
      { workIdentity: work, extractedText: 'Bladerunner 2049' },
    ]);
    await createSuppression(owner, {
      id: `supp:${work}`,
      workIdentity: work,
      active: true,
      displayName: 'Bladerunner 2049',
    });

    const body = (await (await undo(groupId)).json()) as UndoBody;

    // A held-back item the owner cannot identify tells them nothing.
    expect(body.heldBack[0]?.name).toBe('Bladerunner 2049');
  });

  it('T-GRP-013: a second undo is refused with GROUP_ALREADY_REVERSED', async () => {
    const { groupId } = await seedGroup([{ name: 'Dune' }]);

    expect((await undo(groupId)).status).toBe(200);
    const second = await undo(groupId);

    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBody).error.code).toBe('GROUP_ALREADY_REVERSED');
  });

  it('T-GRP-013b: a group held back in full is still marked reversed', async () => {
    // AC-5 is unconditional. A group that stayed offerable would invite the
    // same press to produce the same refusal for ever; the escape hatch after
    // un-suppressing is the per-listing restore in §6.10.
    const work = 'tmdb:movie:949';
    const { groupId } = await seedGroup([{ workIdentity: work, name: 'Heat' }]);
    await createSuppression(owner, {
      id: `supp:${work}`,
      workIdentity: work,
      active: true,
      displayName: 'Heat',
    });

    const first = (await (await undo(groupId)).json()) as UndoBody;
    expect(first.restoredListingIds).toEqual([]);

    expect((await undo(groupId)).status).toBe(409);
  });

  it('T-GRP-014: a member that is no longer removed aborts the WHOLE undo', async () => {
    // Models a per-listing restore (§6.10) landing between the read and the
    // write. A half-reversed group cannot be reversed again as a group, and
    // the owner has no way to see which half landed.
    const { groupId } = await seedGroup([
      { name: 'Dune' },
      { name: 'Heat', alreadyActive: true },
    ]);

    const res = await undo(groupId);

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('PARTIAL_FAILURE_PREVENTED');
    expect(body.error.details['applied']).toBe(false);
  });

  it('T-GRP-014b: after the abort NOTHING changed, and the group is still undoable', async () => {
    const { groupId, members } = await seedGroup([
      { name: 'Dune' },
      { name: 'Heat', alreadyActive: true },
    ]);

    expect((await undo(groupId)).status).toBe(500);

    // The first member is the one that WOULD have been restored. It must not
    // be: "wholly reversed or wholly unreversed" (AC-6).
    expect((await storedListing(members[0]?.listing.listingId ?? '')).state).toBe('removed');
    const group = await testPrisma().removalGroup.findFirstOrThrow({ where: { id: groupId } });
    expect(group.undoneAt).toBeNull();
  });

  it('T-GRP-010d: a zero-member group undoes cleanly and reports nothing', async () => {
    // Unticking every proposed removal is valid and yields a group with no
    // members (US-015 AC-5), so its undo has nothing to undo — and must not
    // fail on that account.
    const { groupId } = await seedGroup([]);

    const res = await undo(groupId);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ restoredListingIds: [], heldBack: [] });
  });

  it('T-SEC-002g: another owner\u2019s group answers 404, never 403', async () => {
    const { groupId } = await seedGroup([{ name: 'Not Yours' }], { ownerId: otherOwner });

    const res = await undo(groupId);

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('T-SEC-002h: an unknown group id answers the same 404 as a foreign one', async () => {
    const res = await undo('g-does-not-exist');
    expect(res.status).toBe(404);
  });
});
