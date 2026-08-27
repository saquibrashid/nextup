/**
 * TASK-089 — `T-INV-012`, the BEHAVIOURAL half (REQ-028, US-023 AC-5,
 * `specs/data-model.md` I-7 and §8.3).
 *
 * ⚠ WHY A SECOND FILE. `tests/infra/hardDelete.spec.ts` is the STATIC half: it
 * scans shipping source for a Prisma delete and refuses any that is not on the
 * allow-list. That is a strong gate and it is also entirely syntactic — it
 * cannot tell whether the code that does NOT contain a delete nonetheless
 * loses rows, and it cannot tell whether the two sanctioned deletes still
 * work. Both halves are named in TASK-089's own "done when", and each one
 * passes cleanly while the other's failure mode is live:
 *
 *  - A route that soft-deletes by OVERWRITING a row's identifying columns
 *    instead of flagging it contains no `delete(` at all. The static scan is
 *    silent; the row is gone in every way the owner can perceive.
 *  - An allow-list entry whose call site was quietly turned into a no-op keeps
 *    the static gate green forever — `T-INV-012h` only proves the delete is
 *    still WRITTEN, not that it still runs.
 *
 * So this file drives the real routes against a real engine and counts rows.
 * Every case asserts a row is STILL THERE afterwards, except the two that
 * assert the sanctioned exemptions genuinely remove one.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-no-hard-delete';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
    ],
  }),
  'utf8',
).toString('base64');

const authed = {
  'content-type': 'application/json',
  [CLIENT_PRINCIPAL_HEADER]: principalHeader,
};

const DUNE = 'tmdb:movie:438631';
const ANDOR = 'tmdb:tv:83867';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

/* ── fixtures ─────────────────────────────────────────────────────────── */

let seq = 0;

async function seedBatch(id: string, service: string, status: string, mode = 'append-only') {
  await testPrisma().uploadBatch.upsert({
    where: { id },
    update: {},
    create: {
      id,
      ownerId,
      service,
      mode,
      status,
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

async function makeActiveTitle(
  workIdentity: string,
  service: string,
  name: string,
): Promise<{ titleId: string; listingId: string }> {
  const n = ++seq;
  const titleId = `nhd-title-${n}`;
  const listingId = `nhd-listing-${n}`;
  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity,
      state: 'active',
      matchState: 'matched',
      normalisedText: name.toLowerCase(),
      tmdbId: Number(workIdentity.split(':')[2]),
      tmdbMediaType: workIdentity.split(':')[1] ?? null,
      tmdbName: name,
      tmdbReleaseYear: 1995,
      sortDateAdded: new Date('2026-01-04'),
    },
  });
  await seedBatch(`nhd-seed-${service}`, service, 'applied');
  await testPrisma().serviceListing.create({
    data: {
      listingId,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded: new Date('2026-01-04'),
      createdByBatchId: `nhd-seed-${service}`,
    },
  });
  return { titleId, listingId };
}

async function makeCandidate(batchId: string, workIdentity: string, rawText: string) {
  await testPrisma().extractionCandidate.create({
    data: {
      id: `nhd-cand-${++seq}`,
      ownerId,
      batchId,
      rawText,
      inferredTitle: rawText,
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: rawText.toLowerCase(),
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: workIdentity,
      classification: 'already-present-for-this-service',
      reviewDisposition: 'confirmed',
      collapsedIntoCandidateId: null,
    },
  });
}

async function makeImage(batchId: string): Promise<string> {
  const id = `nhd-img-${++seq}`;
  await testPrisma().uploadedImage.create({
    data: {
      id,
      ownerId,
      batchId,
      blobPath: `${ownerId}/${id}.png`,
      fileName: `${id}.png`,
      uploadedFormat: 'png',
      format: 'png',
      byteSize: 1024,
      uploadedByteSize: BigInt(1024),
      retainUntil: new Date('2099-01-01'),
    },
  });
  return id;
}

/** Every owner-visible record, counted. */
async function census(): Promise<Record<string, number>> {
  const where = { where: { ownerId } };
  return {
    titles: await testPrisma().title.count(where),
    listings: await testPrisma().serviceListing.count(where),
    suppressions: await testPrisma().suppression.count(where),
    candidates: await testPrisma().extractionCandidate.count(where),
    images: await testPrisma().uploadedImage.count(where),
    changes: await testPrisma().batchChange.count(where),
  };
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  // ⚠ `T-INV-012o` deletes a draft image, and the shipped route removes the
  // BLOB before the row. Without a store the route answers 500 and the case
  // fails for a reason that has nothing to do with hard delete — which is
  // exactly how it failed once. Same default `imageServe.spec.ts` sets.
  process.env['AZURE_STORAGE_CONNECTION_STRING'] ??= 'UseDevelopmentStorage=true';
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
    headers: authed,
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  const body = (await created.json()) as { batchId: string };
  const row = await testPrisma().uploadBatch.findFirst({ where: { id: body.batchId } });
  ownerId = row?.ownerId ?? '';
  await resetDatabase();
  seq = 0;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── the behavioural half ─────────────────────────────────────────────── */

describe('T-INV-012 · behaviour · every route keeps the row', () => {
  it('T-INV-012l: a confirmed removal FLAGS the listing, it does not delete it', async () => {
    const dune = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    const andor = await makeActiveTitle(ANDOR, 'netflix', 'Andor');
    const batchId = await seedBatch('nhd-fu-1', 'netflix', 'in-review', 'full-update');
    // Only Dune is on screen, so Andor is proposed for removal.
    await makeCandidate(batchId, DUNE, 'Dune');

    const before = await census();
    const res = await fetch(`${origin}/api/batches/${batchId}/close`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ confirmRemovals: true }),
    });
    expect(res.status).toBe(200);

    const after = await census();
    // ⚠ COUNTS, not just the one row. A removal that deleted the listing and
    // wrote a replacement would leave the flagged row present and still be a
    // hard delete of the original.
    expect(after.listings).toBe(before.listings);
    expect(after.titles).toBe(before.titles);

    const removed = await testPrisma().serviceListing.findFirstOrThrow({
      where: { ownerId, listingId: andor.listingId },
    });
    expect(removed.state).toBe('removed');
    expect(removed.removedAt).not.toBeNull();
    // The listing keeps its ORIGINAL identity and date — this is the same row,
    // not a tombstone standing in for it.
    expect(removed.titleId).toBe(andor.titleId);
    expect(removed.dateAdded.toISOString().slice(0, 10)).toBe('2026-01-04');

    const kept = await testPrisma().serviceListing.findFirstOrThrow({
      where: { ownerId, listingId: dune.listingId },
    });
    expect(kept.state).toBe('active');
  });

  it('T-INV-012m: suppressing a title deletes NOTHING — the row and its listings stay', async () => {
    // REQ-071 keys suppression on work identity precisely so the row may go on
    // existing. A suppress that deleted the title would make un-suppress
    // unimplementable and would lose the listing history with it.
    const { titleId } = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    const before = await census();

    const res = await fetch(`${origin}/api/titles/${titleId}/suppress`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    const after = await census();
    expect(after.titles).toBe(before.titles);
    expect(after.listings).toBe(before.listings);
    expect(after.suppressions).toBe(before.suppressions + 1);

    expect(await testPrisma().title.count({ where: { ownerId, id: titleId } })).toBe(1);
  });

  it('T-INV-012n: un-suppressing FLAGS the suppression, it does not delete it', async () => {
    const { titleId } = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    expect(
      (
        await fetch(`${origin}/api/titles/${titleId}/suppress`, {
          method: 'POST',
          headers: authed,
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(200);

    const suppression = await testPrisma().suppression.findFirstOrThrow({ where: { ownerId } });
    const before = await census();

    const res = await fetch(`${origin}/api/suppressions/${suppression.id}/unsuppress`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    expect((await census()).suppressions).toBe(before.suppressions);
    const after = await testPrisma().suppression.findFirstOrThrow({
      where: { ownerId, id: suppression.id },
    });
    expect(after.active).toBe(false);
    expect(after.unsuppressedAt).not.toBeNull();
    // The display snapshot survives, which is what lets the suppressed view
    // render without a Title row (US-029 AC-1).
    expect(after.displayName).not.toBe('');
  });

  it('T-INV-012o: the draft-image exemption is LIVE — the row really goes', async () => {
    // The mirror image of every other case here, and it needs asserting for
    // the same reason: an allow-listed delete that had been turned into a
    // no-op would keep the static gate green forever.
    const batchId = await seedBatch('nhd-draft-1', 'netflix', 'draft');
    const imageId = await makeImage(batchId);
    const before = await census();

    const res = await fetch(`${origin}/api/batches/${batchId}/images/${imageId}`, {
      method: 'DELETE',
      headers: authed,
    });
    expect(res.status).toBeLessThan(300);

    expect((await census()).images).toBe(before.images - 1);
  });

  it('T-INV-012p: past draft, the SAME delete is refused and the row survives', async () => {
    // I-7 exempts a PRE-SUBMIT DRAFT image, not "an image". Once the batch has
    // been reviewed the bytes are evidence for a reconciliation the owner has
    // already seen, and REQ-028 applies again.
    const batchId = await seedBatch('nhd-review-1', 'netflix', 'in-review');
    const imageId = await makeImage(batchId);
    const before = await census();

    const res = await fetch(`${origin}/api/batches/${batchId}/images/${imageId}`, {
      method: 'DELETE',
      headers: authed,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BATCH_NOT_DRAFT');

    expect((await census()).images).toBe(before.images);
  });

  it('T-INV-012q: a refused undo writes nothing — no half-applied hard delete', async () => {
    // SD-03 is the other exemption. Its guard is the creates-only test, and a
    // guard that ran AFTER the discard would leave the owner with rows gone
    // and a 409 saying it did not happen. There is no soft-deleted copy behind
    // SD-03, so this failure mode is unrecoverable.
    const dune = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    const batchId = await seedBatch('nhd-applied-1', 'netflix', 'applied');
    await testPrisma().batchChange.create({
      data: { ownerId, batchId, kind: 'title_created', titleId: dune.titleId },
    });
    await testPrisma().batchChange.create({
      data: {
        ownerId,
        batchId,
        kind: 'attr_modified',
        titleId: dune.titleId,
        attr: 'tmdbName',
        prevValue: '"Doon"',
        nextValue: '"Dune"',
      },
    });

    const before = await census();
    const res = await fetch(`${origin}/api/batches/${batchId}/undo`, {
      method: 'POST',
      headers: authed,
    });
    expect(res.status).toBe(409);

    expect(await census()).toEqual(before);
  });
});
