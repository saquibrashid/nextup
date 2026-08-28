/**
 * TASK-119 — the 30-day purge preserves every record (US-035 AC-2/AC-3/AC-5).
 * The path `specs/testing.md` §11 names for an API integration suite.
 *
 * `T-RET-011` (after purge, `uploadedImage`, candidates, batch, titles and
 * listings all still exist), `T-RET-012` (purge changes no list state; no
 * application code participates) and `T-RET-013` (an open batch whose images
 * reach 30 days: purge proceeds; the batch reports `IMAGES_PURGED` rather than
 * erroring).
 *
 * ⚠ THE PURGE IS SIMULATED BY REMOVING THE BLOB, AND THAT IS THE FAITHFUL
 * REPRODUCTION, NOT A SHORTCUT. Azurite implements no lifecycle rules at all
 * (`specs/testing.md` §3.4), and the real rule's entire effect on this system
 * is that the bytes stop being there — it writes nothing back, it calls
 * nothing, and the application is never told. `T-IMG-005c` reproduces it the
 * same way for the same reason. The half that cannot be reproduced here — that
 * the rule exists, is enabled, is filtered to the screenshot containers and
 * fires at exactly 30 days — is asserted against the compiled ARM by
 * `T-INFRA-004`, and neither half is worth anything without the other.
 *
 * ⚠ WHY THIS SUITE IS WORTH WRITING AT ALL, GIVEN THE PURGE TOUCHES NO CODE.
 * Precisely because it touches no code, nothing else in the system would
 * notice if a read path started depending on the bytes. Every screenshot in
 * this product is gone by day 31 while the records it produced are kept
 * forever (REQ-028), so the steady state of a year-old account is: every row
 * present, every blob absent. A join, a lazy `store.get`, or an availability
 * check added to a list or batch read would work perfectly for thirty days in
 * development and then quietly break the owner's history — and it would break
 * it for the OLDEST captures first, the ones least likely to be looked at
 * before the damage was normal. These tests put the system into that steady
 * state deliberately and read it back through the real routes.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TitleExtractor } from '@nextup/domain';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { deriveOwnerId } from '../../src/auth/ownerId.js';
import { beginExtraction, extractionSettled } from '../../src/jobs/startExtraction.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { azureImageBlobStore, resetBlobStoreForTests } from '../../src/storage/blobStore.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-retention-purge-int';
const ISSUER = 'https://sts.windows.net/tenant/';
const OWNER = deriveOwnerId({ subject: SUBJECT, issuer: ISSUER, email: null });

const principalHeader = (): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: SUBJECT },
        { typ: 'preferred_username', val: 'owner@example.com' },
      ],
    }),
    'utf8',
  ).toString('base64');

/** A real PNG header — signature then `IHDR`. The sniff reads only this. */
function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 1179);
  view.setUint32(20, 2556);
  return bytes;
}

let server: Server;
let app: Express;
let origin: string;

const auth = { [CLIENT_PRINCIPAL_HEADER]: principalHeader() };

async function openBatch(): Promise<string> {
  const res = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { batchId: string }).batchId;
}

async function uploadImage(batchId: string): Promise<string> {
  const form = new FormData();
  form.append(
    'files',
    new Blob([pngBytes() as unknown as BlobPart], { type: 'application/octet-stream' }),
    'IMG_0042.PNG',
  );
  const res = await fetch(`${origin}/api/batches/${batchId}/images`, {
    method: 'POST',
    headers: auth,
    body: form,
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { accepted: { imageId: string }[]; rejected: unknown[] };
  expect(body.rejected).toHaveLength(0);
  return body.accepted[0]?.imageId ?? '';
}

/**
 * Do to the account exactly what the lifecycle rule does on day 31: remove the
 * bytes and tell nobody. Returns the `blobPath` so a caller can prove the row
 * still names it afterwards.
 */
async function purgeBlobsOf(imageId: string): Promise<string> {
  const row = await testPrisma().uploadedImage.findFirst({ where: { id: imageId } });
  const blobPath = row?.blobPath ?? '';
  expect(blobPath.length).toBeGreaterThan(0);
  // Non-vacuity: if the bytes were already absent, "the purge preserved
  // everything" would be a statement about nothing having happened.
  expect(await azureImageBlobStore.get(blobPath)).not.toBeNull();
  await azureImageBlobStore.remove(blobPath);
  expect(await azureImageBlobStore.get(blobPath)).toBeNull();
  return blobPath;
}

/**
 * Build the graph a real capture leaves behind: a batch, an image, an
 * extraction candidate that cites that image, and the title and listing the
 * candidate became. Seeded through the store rather than driven through close,
 * because what is under test is what SURVIVES, not how it got there.
 */
async function seedAppliedCapture(batchId: string, imageId: string): Promise<void> {
  const db = testPrisma();
  const candidateId = `cand-${imageId}`;
  const titleId = `title-${imageId}`;

  await db.extractionCandidate.create({
    data: {
      id: candidateId,
      ownerId: OWNER,
      batchId,
      rawText: 'The Bear',
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: 'the bear',
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: 'tmdb:tv:136315',
      reviewDisposition: 'confirmed',
    },
  });
  await db.candidateSourceImage.create({
    data: { ownerId: OWNER, candidateId, imageId, ordinal: 0 },
  });
  await db.title.create({
    data: {
      id: titleId,
      ownerId: OWNER,
      workIdentity: 'tmdb:tv:136315',
      state: 'active',
      matchState: 'matched',
      tmdbId: 136315,
      tmdbMediaType: 'tv',
      tmdbName: 'The Bear',
    },
  });
  await db.serviceListing.create({
    data: {
      listingId: `listing-${imageId}`,
      ownerId: OWNER,
      titleId,
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-01-15'),
      createdByBatchId: batchId,
    },
  });
}

/** Everything the owner can see, as the store holds it. */
async function listState() {
  const db = testPrisma();
  return {
    titles: await db.title.findMany({ where: { ownerId: OWNER }, orderBy: { id: 'asc' } }),
    listings: await db.serviceListing.findMany({
      where: { ownerId: OWNER },
      orderBy: { listingId: 'asc' },
    }),
    batches: await db.uploadBatch.findMany({ where: { ownerId: OWNER }, orderBy: { id: 'asc' } }),
    images: await db.uploadedImage.findMany({ where: { ownerId: OWNER }, orderBy: { id: 'asc' } }),
    candidates: await db.extractionCandidate.findMany({
      where: { ownerId: OWNER },
      orderBy: { id: 'asc' },
    }),
    sourceImages: await db.candidateSourceImage.findMany({
      where: { ownerId: OWNER },
      orderBy: { candidateId: 'asc' },
    }),
  };
}

beforeEach(async () => {
  resetAllowListWarning();
  resetBlobStoreForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['AZURE_STORAGE_CONNECTION_STRING'] ??= 'UseDevelopmentStorage=true';
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-RET-011 · US-035 AC-2 · purging the bytes preserves every record', () => {
  it('T-RET-011a: every row of a captured batch survives the purge, with every column intact', async () => {
    const batchId = await openBatch();
    const imageId = await uploadImage(batchId);
    await seedAppliedCapture(batchId, imageId);

    const before = await listState();
    const blobPath = await purgeBlobsOf(imageId);
    const after = await listState();

    // Asserted column-by-column rather than by counting rows: a purge handler
    // that "tidied up" by nulling `blobPath`, zeroing `byteSize` or stamping a
    // `purgedAt` would keep every count identical while destroying the record
    // of what was captured. REQ-028 keeps the RECORD, not merely the row.
    expect(after).toEqual(before);

    // And the record still names the blob it had. The path is how a restored
    // database is reconciled against a storage account; a row that forgot it
    // is a row that can never be explained.
    expect(after.images[0]?.blobPath).toBe(blobPath);
    expect(after.images).toHaveLength(1);
    expect(after.candidates).toHaveLength(1);
    expect(after.sourceImages).toHaveLength(1);
    expect(after.titles).toHaveLength(1);
    expect(after.listings).toHaveLength(1);
  });

  it('T-RET-011b: the batch and its titles are still READABLE through the API afterwards', async () => {
    // The failure this exists for: a read path that lazily touches the bytes
    // works perfectly for thirty days and then breaks the owner's oldest
    // history first. Every batch older than a month is in this state
    // permanently, so these two reads are the steady state, not an edge case.
    const batchId = await openBatch();
    const imageId = await uploadImage(batchId);
    await seedAppliedCapture(batchId, imageId);
    await purgeBlobsOf(imageId);

    const batchRes = await fetch(`${origin}/api/batches/${batchId}`, { headers: auth });
    expect(batchRes.status).toBe(200);
    expect(((await batchRes.json()) as { batchId: string }).batchId).toBe(batchId);

    const titlesRes = await fetch(`${origin}/api/titles`, { headers: auth });
    expect(titlesRes.status).toBe(200);
    const titles = (await titlesRes.json()) as { items: { name: string }[] };
    expect(titles.items.map((t) => t.name)).toContain('The Bear');
  });

  it('T-RET-011c: only the BYTES are gone — the image route says so, 410 not 404', async () => {
    // The distinction the owner is owed: 404 means "there was never such an
    // image", 410 means "this happened and the screenshot has expired". If a
    // purge ever made the row unfindable this would be a 404, and the batch
    // would have lost its own history.
    const batchId = await openBatch();
    const imageId = await uploadImage(batchId);
    await purgeBlobsOf(imageId);

    const res = await fetch(`${origin}/api/images/${imageId}`, { headers: auth });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('IMAGE_EXPIRED');
  });
});

describe('T-RET-012 · US-035 AC-3 · the purge changes no list state, and no app code runs', () => {
  it('T-RET-012a: the list the owner sees is byte-for-byte identical across the purge', async () => {
    const batchId = await openBatch();
    const imageId = await uploadImage(batchId);
    await seedAppliedCapture(batchId, imageId);

    const before = await fetch(`${origin}/api/titles`, { headers: auth });
    const beforeBody = await before.text();

    await purgeBlobsOf(imageId);

    const after = await fetch(`${origin}/api/titles`, { headers: auth });
    expect(after.status).toBe(200);
    // Compared as raw text, not as parsed objects: membership, ordering AND
    // service badges are all user-visible list state (invariant 5), and a
    // structural comparison can miss an ordering change.
    expect(await after.text()).toBe(beforeBody);
    // Non-vacuity: two identical empty lists would satisfy the line above.
    expect(beforeBody).toContain('The Bear');
  });

  it('T-RET-012b: retention is not implemented in application code at all', async () => {
    // ⚠ THE ONE PLACE `apps/api/src/**` MAY DELETE A BLOB is the owner
    // removing an image from a batch they have not submitted yet
    // (`batchImages.ts`, §6.13) — an explicit user action. Retention is
    // Azure's `T-INFRA-004` rule and nothing else.
    //
    // This is a SOURCE assertion because the behaviour it forbids does not
    // exist yet, so there is no running code to observe. An "expire old
    // images" sweep is the natural thing to add when someone notices the
    // application knows `retainUntil` and wonders who acts on it — and it
    // would be a background process that changes stored state, which
    // invariant 5 forbids outright. `T-CI-005` catches the SCHEDULER; this
    // catches the deletion even if it were hung off a request instead.
    const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
    const entries = await readdir(srcDir, { recursive: true, withFileTypes: true });

    const callSites: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const full = `${entry.parentPath}/${entry.name}`.replace(/\\/g, '/');
      // The store itself declares and implements `remove`; that is the port,
      // not a call into it.
      if (full.endsWith('src/storage/blobStore.ts')) continue;
      for (const [index, line] of readFileSync(full, 'utf8').split(/\r?\n/).entries()) {
        if (/\.remove\(/.test(line)) callSites.push(`${entry.name}:${String(index + 1)}`);
      }
    }

    expect(callSites.map((site) => site.split(':')[0])).toEqual(['batchImages.ts']);
  });

  it('T-RET-012c: nothing stamps the row when the bytes go — retainUntil is untouched', async () => {
    // `retainUntil` is what the API serves its 410 from. If a purge path ever
    // rewrote it, the 410 would start reporting the day the sweep ran rather
    // than the day retention actually expired, and the owner would be told a
    // false date about their own data.
    const batchId = await openBatch();
    const imageId = await uploadImage(batchId);

    const before = await testPrisma().uploadedImage.findFirst({ where: { id: imageId } });
    await purgeBlobsOf(imageId);

    // ⚠ THE ROUTE IS EXERCISED DELIBERATELY, TWICE. Without this the assertion
    // is only about code that does not exist, and no mutation of the shipped
    // system could fail it. `GET /api/images/:id` is where a "tidy up the row
    // while we are here" would plausibly be written, because it is the one
    // place that discovers a blob is gone — so the row must be read back
    // AFTER something has looked at it and found nothing.
    expect((await fetch(`${origin}/api/images/${imageId}`, { headers: auth })).status).toBe(410);
    expect((await fetch(`${origin}/api/images/${imageId}`, { headers: auth })).status).toBe(410);

    const after = await testPrisma().uploadedImage.findFirst({ where: { id: imageId } });

    expect(before?.retainUntil).toBeInstanceOf(Date);
    expect(after?.retainUntil.toISOString()).toBe(before?.retainUntil.toISOString());
    expect(after).toEqual(before);
  });
});

describe('T-RET-013 · US-035 AC-5 · an OPEN batch whose images reach 30 days', () => {
  /**
   * Never reached: the bytes are gone, so `loadImageBytes` throws before the
   * reader is consulted. Rejecting rather than returning an empty result is
   * the non-vacuity guard — if the purge had not taken effect this WOULD be
   * called, and the batch would land on `EXTRACTOR_ERROR`, not
   * `IMAGES_PURGED`.
   */
  const unreachableExtractor: TitleExtractor = {
    name: 'stub',
    extract: () => Promise.reject(new Error('the extractor must not be reached after a purge')),
  };

  it('T-RET-013a: the purge proceeds — an open batch does not pin its screenshots', async () => {
    // There is deliberately no hold, lease or reference count keeping an
    // unsubmitted batch's bytes alive. Azure's rule is filtered on the
    // container and the modification date and knows nothing about batch
    // status, so any application-side expectation that a draft is protected
    // would be a belief the infrastructure never agreed to.
    const batchId = await openBatch();
    const imageId = await uploadImage(batchId);

    expect((await testPrisma().uploadBatch.findFirst({ where: { id: batchId } }))?.status).toBe(
      'draft',
    );

    await purgeBlobsOf(imageId);

    // Still open, still owns its image row, still the owner's to act on.
    const after = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(after?.status).toBe('draft');
    expect(await testPrisma().uploadedImage.count({ where: { batchId } })).toBe(1);
  });

  it('T-RET-013b: extracting it lands on IMAGES_PURGED, not a generic failure', async () => {
    const batchId = await openBatch();
    const imageId = await uploadImage(batchId);
    await purgeBlobsOf(imageId);

    // Moved to `submitted` first, because the `submitted -> extracting`
    // transition is the concurrency control: a batch left in `draft` is
    // refused before any image is read, which would pass this test for
    // entirely the wrong reason.
    await testPrisma().uploadBatch.updateMany({
      where: { id: batchId },
      data: { status: 'submitted', submittedAt: new Date() },
    });

    beginExtraction(OWNER, batchId, { extractor: unreachableExtractor });
    await extractionSettled(batchId);

    const after = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(after?.status).toBe('extraction-failed');
    expect(after?.extractionErrorCode).toBe('IMAGES_PURGED');
    // ⚠ The MESSAGE is the part that matters to the owner. A batch that failed
    // because its screenshots aged out is not a fault they can retry their way
    // out of, and telling them "something went wrong, try again" sends them
    // round a loop that can never succeed. It must name retention and ask for
    // new screenshots.
    expect(after?.extractionErrorMessage).toMatch(/30-day retention/);
    expect(after?.extractionErrorMessage).toMatch(/[Uu]pload them again/);
  });

  it('T-RET-013c: it FAILS the batch rather than throwing — the record survives', async () => {
    // "Rather than erroring" in AC-5 means the process stays up and the batch
    // is left in a state the owner can see. An unhandled rejection here would
    // take the whole single-process container down because one screenshot aged
    // out exactly on schedule.
    const batchId = await openBatch();
    const imageId = await uploadImage(batchId);
    await seedAppliedCapture(batchId, imageId);
    await purgeBlobsOf(imageId);
    await testPrisma().uploadBatch.updateMany({
      where: { id: batchId },
      data: { status: 'submitted', submittedAt: new Date() },
    });

    const before = await listState();
    beginExtraction(OWNER, batchId, { extractor: unreachableExtractor });
    await extractionSettled(batchId);

    // Nothing was deleted on the way to the failure: the image row, the
    // candidates it produced and the list it fed are all still there.
    const after = await listState();
    expect(after.images).toEqual(before.images);
    expect(after.titles).toEqual(before.titles);
    expect(after.listings).toEqual(before.listings);
    expect(after.sourceImages).toEqual(before.sourceImages);
    expect(after.candidates).toEqual(before.candidates);
  });

  it('T-RET-013d: a batch whose bytes are still present does NOT report IMAGES_PURGED', async () => {
    // Non-vacuity for the three above. If `loadImageBytes` threw
    // `IMAGES_PURGED` unconditionally — or if the store answered null for
    // everything — every assertion above would pass while the code was wrong
    // for every image ever uploaded.
    const batchId = await openBatch();
    await uploadImage(batchId);
    await testPrisma().uploadBatch.updateMany({
      where: { id: batchId },
      data: { status: 'submitted', submittedAt: new Date() },
    });

    beginExtraction(OWNER, batchId, { extractor: unreachableExtractor });
    await extractionSettled(batchId);

    const after = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(after?.status).toBe('extraction-failed');
    expect(after?.extractionErrorCode).not.toBe('IMAGES_PURGED');
  });
});
