/**
 * TASK-098 — `POST /api/listings/:listingId/restore` (`specs/api.md` §6.10,
 * US-025).
 *
 * T-RES-013: Restore of a suppressed work → 409 WORK_SUPPRESSED with the
 *             unsuppress href in the details.
 * T-RES-014: Restore where another active title has the same workIdentity →
 *             409 DUPLICATE_WORK_IDENTITY; retry with `confirmDuplicate:true`
 *             → 200 and the listing moves to the existing title.
 * T-RES-011: The restored listing keeps its ORIGINAL dateAdded (US-025 AC-2).
 * T-RES-012: The restored title sorts by that date, not by the restore
 *             instant (AC-3).
 * T-RES-015: A refused restore changes nothing, and says so (AC-6).
 *
 * RESTORE IS AN EXPLICIT OWNER ACTION, NEVER AUTOMATIC (product invariant 7).
 * A brand-new removed listing for the same work is never de-duplicated during
 * restore — it is a distinct event in the log and stays one.
 *
 * Run against a real SQL Server and the real Express app.
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
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  findServiceListing,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-restore';
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

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;

const ownerIdFor = async (subject: string): Promise<OwnerId> => {
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });
  expect(res.status).toBe(200);
  return asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
};

const postRestore = (
  listingId: string,
  body: { confirmDuplicate?: boolean } = {},
  subject = SUBJECT,
): Promise<Response> =>
  fetch(`${origin}/api/listings/${encodeURIComponent(listingId)}/restore`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject),
    },
  });

let seq = 0;

/**
 * Seed one REMOVED listing. Returns title + listing + batch.
 * Each invocation gets distinct IDs.
 */
async function seedRemoved(opts: {
  workIdentity: string;
  name: string;
  service?: string;
  dateAdded?: string;
  removedAt?: string;
}) {
  seq += 1;
  const id = `rs-${String(seq).padStart(4, '0')}`;
  const service = opts.service ?? 'netflix';
  const dateAdded = new Date(`${opts.dateAdded ?? '2026-04-01'}T00:00:00.000Z`);

  const batch = await createUploadBatch(owner, {
    id: `b-${id}`,
    service,
    mode: 'full-update',
    status: 'applied',
  });
  const title = await createTitle(owner, {
    id,
    workIdentity: opts.workIdentity,
    state: 'removed',
    matchState: 'matched',
    tmdbId: 500_000 + seq,
    tmdbMediaType: 'movie',
    tmdbName: opts.name,
    tmdbReleaseYear: 2020,
    tmdbPosterPath: null,
    tmdbGenres: '[]',
    sortDateAdded: dateAdded,
    createdByBatchId: batch.id,
  });
  const listing = await createServiceListing(owner, {
    listingId: `l-${id}`,
    titleId: title.id,
    service,
    state: 'removed',
    dateAdded,
    removedAt: new Date(opts.removedAt ?? '2026-07-01T00:00:00.000Z'),
    removedByBatchId: batch.id,
    createdByBatchId: batch.id,
  });

  return { title, listing, batch };
}

/**
 * Seed an ACTIVE title + listing for a given workIdentity — used to produce
 * the duplicate condition T-RES-014 requires.
 */
async function seedActive(opts: { workIdentity: string; name: string; service?: string; dateAdded?: string }) {
  seq += 1;
  const id = `ra-${String(seq).padStart(4, '0')}`;
  const service = opts.service ?? 'max';
  const dateAdded = new Date(`${opts.dateAdded ?? '2026-01-01'}T00:00:00.000Z`);

  const batch = await createUploadBatch(owner, {
    id: `b-${id}`,
    service,
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(owner, {
    id,
    workIdentity: opts.workIdentity,
    state: 'active',
    matchState: 'matched',
    tmdbId: 600_000 + seq,
    tmdbMediaType: 'movie',
    tmdbName: opts.name,
    tmdbReleaseYear: 2020,
    tmdbPosterPath: null,
    tmdbGenres: '[]',
    sortDateAdded: dateAdded,
    createdByBatchId: batch.id,
  });
  const listing = await createServiceListing(owner, {
    listingId: `la-${id}`,
    titleId: title.id,
    service,
    state: 'active',
    dateAdded,
    createdByBatchId: batch.id,
  });

  return { title, listing, batch };
}

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  seq = 0;
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  if (server === undefined) {
    app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }
  owner = await ownerIdFor(SUBJECT);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeTestPrisma();
});

describe('POST /api/listings/:listingId/restore', () => {
  it('T-RES-013: restore of a suppressed work returns 409 WORK_SUPPRESSED with unsuppressHref', async () => {
    const WORK = 'tmdb:movie:99001';
    const { listing } = await seedRemoved({ workIdentity: WORK, name: 'Suppressed Film' });

    // Add a suppression for that workIdentity.
    const suppId = `supp:${WORK}`;
    await createSuppression(owner, {
      id: suppId,
      workIdentity: WORK,
      active: true,
      displayName: 'Suppressed Film',
    });

    const res = await postRestore(listing.listingId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('WORK_SUPPRESSED');
    expect(typeof body.error.details['unsuppressHref']).toBe('string');
    expect(body.error.details['unsuppressHref'] as string).toContain(
      `/api/suppressions/${encodeURIComponent(suppId)}/unsuppress`,
    );
  });

  it('T-RES-014: restore when duplicate active title exists returns 409 DUPLICATE_WORK_IDENTITY; confirmDuplicate:true succeeds', async () => {
    const WORK = 'tmdb:movie:99002';
    const { listing: removedListing } = await seedRemoved({
      workIdentity: WORK,
      name: 'Duplicate Film',
      service: 'netflix',
    });
    // Seed an ACTIVE title with the same workIdentity.
    const { title: activeTitle } = await seedActive({
      workIdentity: WORK,
      name: 'Duplicate Film',
      service: 'max',
    });

    // Without confirmDuplicate → 409.
    const res1 = await postRestore(removedListing.listingId, { confirmDuplicate: false });
    expect(res1.status).toBe(409);
    const body1 = (await res1.json()) as ErrorBody;
    expect(body1.error.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(body1.error.details['existingTitleId']).toBe(activeTitle.id);

    // With confirmDuplicate:true → 200, listing stays in its original title.
    const res2 = await postRestore(removedListing.listingId, { confirmDuplicate: true });
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as {
      listingId: string;
      titleId: string;
      state: string;
    };
    expect(data2.listingId).toBe(removedListing.listingId);
    // Listing stays on its original title (now active alongside the other title).
    expect(data2.titleId).toBe(removedListing.titleId);
    expect(data2.state).toBe('active');
  });

  /* ── US-025 AC-2/AC-3/AC-6 (T-RES-011/012/015) ────────────────────────
   *
   * ⚠ These three criteria had written test ids and no tests: they sat in
   * `BASELINE_ORPHANS` while `T-RES-010`, `013` and `014` were built around
   * them. The gap matters because AC-2 and AC-3 are the criteria a plausible
   * implementation gets WRONG — "restore" reads as "add it back", and adding
   * something back today is exactly what must not happen. AC-6 is the one an
   * implementation gets wrong under failure, which is where nobody looks.
   */

  it('T-RES-011: the restored listing keeps its ORIGINAL dateAdded, not today', async () => {
    const WORK = 'tmdb:movie:99003';
    const { listing } = await seedRemoved({
      workIdentity: WORK,
      name: 'Original Date Film',
      dateAdded: '2026-04-01',
    });

    const res = await postRestore(listing.listingId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dateAdded: string; state: string };
    expect(body.state).toBe('active');
    // The response the UI renders...
    expect(body.dateAdded).toBe('2026-04-01');

    // ...AND the stored value, because a route that formatted the old date
    // while writing a new one would satisfy the line above on its own.
    const stored = await findServiceListing(owner, listing.listingId);
    expect(stored?.state).toBe('active');
    expect(stored?.dateAdded.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(stored?.dateAdded.toISOString().slice(0, 10)).not.toBe(
      new Date().toISOString().slice(0, 10),
    );
  });

  it('T-RES-012: the restored title sorts by the restored date, not by the restore instant', async () => {
    // Three works with three dates. The restored one is deliberately in the
    // MIDDLE: a restore that stamped today would move it to the top of the
    // default newest-first list, and a test with only one row could not tell
    // the difference between "correct" and "top".
    const { listing } = await seedRemoved({
      workIdentity: 'tmdb:movie:99004',
      name: 'Middle Film',
      dateAdded: '2026-04-01',
    });
    const { title: newer } = await seedActive({
      workIdentity: 'tmdb:movie:99005',
      name: 'Newer Film',
      dateAdded: '2026-05-01',
    });
    const { title: older } = await seedActive({
      workIdentity: 'tmdb:movie:99006',
      name: 'Older Film',
      dateAdded: '2026-03-01',
    });

    expect((await postRestore(listing.listingId)).status).toBe(200);

    const res = await fetch(`${origin}/api/titles`, {
      headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
    });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as {
      items: { titleId: string; sortDateAdded: string | null }[];
    };

    const order = items.map((item) => item.titleId);
    expect(order).toEqual([newer.id, listing.titleId, older.id]);
    expect(items[1]?.sortDateAdded).toBe('2026-04-01');
  });

  it('T-RES-015a: a refused restore leaves the removed row exactly as it was', async () => {
    const WORK = 'tmdb:movie:99007';
    const { listing } = await seedRemoved({
      workIdentity: WORK,
      name: 'Refused Film',
      dateAdded: '2026-04-01',
      removedAt: '2026-07-01T00:00:00.000Z',
    });
    await createSuppression(owner, {
      id: `supp:${WORK}`,
      workIdentity: WORK,
      active: true,
      displayName: 'Refused Film',
    });

    const before = await findServiceListing(owner, listing.listingId);
    expect((await postRestore(listing.listingId)).status).toBe(409);

    // ⚠ THE HALF `T-RES-013` CANNOT SEE. It asserts the refusal; this asserts
    // that the refusal wrote nothing. A route that restored the row and THEN
    // discovered the suppression would return the same 409 body and leave the
    // work back on the list — visible only in the store, and only later.
    const after = await findServiceListing(owner, listing.listingId);
    expect(after?.state).toBe('removed');
    expect(after?.removedAt?.toISOString()).toBe(before?.removedAt?.toISOString());
    expect(after?.dateAdded.toISOString()).toBe(before?.dateAdded.toISOString());
    expect(after?.removedByBatchId).toBe(before?.removedByBatchId);

    // And the title stayed off the list with it.
    const listed = await fetch(`${origin}/api/titles`, {
      headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
    });
    const { items } = (await listed.json()) as { items: { titleId: string }[] };
    expect(items.map((item) => item.titleId)).not.toContain(listing.titleId);
  });

  it('T-RES-015b: restoring an already-active listing is refused and SAYS nothing changed', async () => {
    const { listing } = await seedActive({
      workIdentity: 'tmdb:movie:99008',
      name: 'Already Active Film',
    });

    const res = await postRestore(listing.listingId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LISTING_NOT_REMOVED');
    // AC-6 asks for the reassurance in the COPY, not only in the store. An
    // owner who clicks restore twice must be told the second click was a
    // no-op rather than left wondering what it did.
    expect(body.error.message.toLowerCase()).toContain('nothing was changed');

    const after = await findServiceListing(owner, listing.listingId);
    expect(after?.state).toBe('active');
    expect(after?.removedAt).toBeNull();
  });
});
