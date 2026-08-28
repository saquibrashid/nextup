/**
 * TASK-098 — `POST /api/listings/:listingId/restore` (`specs/api.md` §6.10,
 * US-025).
 *
 * T-RES-013: Restore of a suppressed work → 409 WORK_SUPPRESSED with the
 *             unsuppress href in the details.
 * T-RES-014: Restore where another active title has the same workIdentity →
 *             409 DUPLICATE_WORK_IDENTITY; retry with `confirmDuplicate:true`
 *             → 200 and the listing moves to the existing title.
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
async function seedActive(opts: { workIdentity: string; name: string; service?: string }) {
  seq += 1;
  const id = `ra-${String(seq).padStart(4, '0')}`;
  const service = opts.service ?? 'max';
  const dateAdded = new Date('2026-01-01T00:00:00.000Z');

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
});
