/**
 * TASK-017 integration suite — the owner-scoped repository against a REAL
 * SQL Server 2022 (`specs/testing.md` §3.3a).
 *
 * These scenarios were first proven by direct execution during the schema
 * reconciliation (`docs/task-017-schema-findings.md` §1b) and are ported here
 * rather than rewritten, so the properties CI asserts are the ones that were
 * actually verified against the engine.
 *
 * EVERY constraint case is an ACCEPT/REJECT PAIR. A test that only proves a
 * duplicate is rejected also passes when the schema rejects everything, which
 * is a failure mode this project has already hit once. Proving the legitimate
 * row is accepted is what gives the rejection meaning.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  deactivateSuppression,
  findActiveSuppression,
  findServiceState,
  findTitle,
  findUploadBatch,
  isUniqueViolation,
  listActiveTitles,
  listCandidatesForBatch,
  recordBatchChange,
  softDeleteServiceListing,
  updateUploadBatchStatus,
  upsertServiceState,
} from '../../src/repository/ownerData.js';
import {
  OWNER_A,
  OWNER_B,
  batchInput,
  closeTestPrisma,
  id,
  listingInput,
  resetDatabase,
  suppressionInput,
  testPrisma,
  titleInput,
  workId,
} from './harness.js';

/** Run `fn` and return the error it threw, or `undefined`. */
async function thrown(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

beforeAll(() => {
  testPrisma();
});

afterAll(async () => {
  await closeTestPrisma();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('T-INV-001 one active title per work identity', () => {
  it('T-INV-001a: accepts a second title with a DIFFERENT work identity', async () => {
    await createTitle(OWNER_A, titleInput());
    await createTitle(OWNER_A, titleInput());
    expect(await listActiveTitles(OWNER_A)).toHaveLength(2);
  });

  it('T-INV-001b: the DATABASE rejects a second active title for the same work', async () => {
    const workIdentity = workId();
    await createTitle(OWNER_A, titleInput({ workIdentity }));

    const error = await thrown(() => createTitle(OWNER_A, titleInput({ workIdentity })));

    // Azure SQL raises 2601 (unique index) / 2627 (unique constraint).
    // NOT PostgreSQL's 23505, which appears in superseded spec revisions.
    expect(error, 'the second active title was ACCEPTED').toBeDefined();
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('T-INV-001c: a REMOVED title frees the identity, so the work can reappear', async () => {
    // Product invariant 7: reappearance is a brand-new row dated today. If the
    // unique index were unfiltered, a soft-deleted row would occupy the pair
    // forever and reappearance would be permanently impossible.
    const workIdentity = workId();
    const first = titleInput({ workIdentity });
    await createTitle(OWNER_A, first);
    await testPrisma().title.updateMany({
      where: { ownerId: OWNER_A, id: first.id },
      data: { state: 'removed' },
    });

    await expect(createTitle(OWNER_A, titleInput({ workIdentity }))).resolves.toBeDefined();
  });

  it('T-INV-001d: an ACKNOWLEDGED duplicate is accepted alongside the original', async () => {
    const workIdentity = workId();
    await createTitle(OWNER_A, titleInput({ workIdentity }));
    await expect(
      createTitle(OWNER_A, titleInput({ workIdentity, duplicateAckSeq: 'dup-1' })),
    ).resolves.toBeDefined();
  });

  it('T-INV-001e: two owners may hold the same work identity', async () => {
    const workIdentity = workId();
    await createTitle(OWNER_A, titleInput({ workIdentity }));
    await expect(createTitle(OWNER_B, titleInput({ workIdentity }))).resolves.toBeDefined();
  });
});

describe('T-INV-002 one active listing per (title, service)', () => {
  it('T-INV-002a: accepts the same title on two DIFFERENT services', async () => {
    const batch = await createUploadBatch(OWNER_A, batchInput());
    const title = await createTitle(OWNER_A, titleInput());
    await createServiceListing(OWNER_A, listingInput(title.id, batch.id, { service: 'netflix' }));
    await expect(
      createServiceListing(OWNER_A, listingInput(title.id, batch.id, { service: 'max' })),
    ).resolves.toBeDefined();
  });

  it('T-INV-002b: the DATABASE rejects a second active listing on the same service', async () => {
    const batch = await createUploadBatch(OWNER_A, batchInput());
    const title = await createTitle(OWNER_A, titleInput());
    await createServiceListing(OWNER_A, listingInput(title.id, batch.id));

    const error = await thrown(() =>
      createServiceListing(OWNER_A, listingInput(title.id, batch.id)),
    );

    expect(error, 'the second active listing was ACCEPTED').toBeDefined();
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('T-INV-002c: after soft delete the service can reappear', async () => {
    const batch = await createUploadBatch(OWNER_A, batchInput());
    const title = await createTitle(OWNER_A, titleInput());
    const listing = await createServiceListing(OWNER_A, listingInput(title.id, batch.id));

    await softDeleteServiceListing(OWNER_A, listing.listingId, {
      removedByBatchId: batch.id,
      removedAt: new Date(),
    });

    await expect(
      createServiceListing(OWNER_A, listingInput(title.id, batch.id)),
    ).resolves.toBeDefined();
  });
});

describe('T-INV-015 at most one active suppression per work identity', () => {
  it('T-INV-015a: accepts suppressions for two different works', async () => {
    await createSuppression(OWNER_A, suppressionInput(workId()));
    await createSuppression(OWNER_A, suppressionInput(workId()));
    expect(await testPrisma().suppression.count({ where: { ownerId: OWNER_A } })).toBe(2);
  });

  it('T-INV-015b: the DATABASE rejects a second ACTIVE suppression for one work', async () => {
    const workIdentity = workId();
    await createSuppression(OWNER_A, suppressionInput(workIdentity));

    const error = await thrown(() => createSuppression(OWNER_A, suppressionInput(workIdentity)));

    expect(error, 'the second active suppression was ACCEPTED').toBeDefined();
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('T-INV-015c: un-suppressing keeps the row and frees the identity', async () => {
    // REQ-028 / US-029 AC-2: the decision is never deleted, only deactivated.
    const workIdentity = workId();
    await createSuppression(OWNER_A, suppressionInput(workIdentity));
    await deactivateSuppression(OWNER_A, workIdentity, new Date());

    expect(await findActiveSuppression(OWNER_A, workIdentity)).toBeNull();
    expect(
      await testPrisma().suppression.count({ where: { ownerId: OWNER_A, workIdentity } }),
    ).toBe(1);
    await expect(createSuppression(OWNER_A, suppressionInput(workIdentity))).resolves.toBeDefined();
  });

  it('T-INV-015d: one suppression matches BOTH acknowledged duplicates of a work', async () => {
    // ⚠ Product invariant 1 / REQ-071: suppression is keyed on canonical work
    // identity, NOT on a row id. Two rows can share a work identity (an
    // acknowledged duplicate), and the single suppression must cover both — a
    // row-scoped flag would appear to work and then silently stop.
    const workIdentity = workId();
    await createTitle(OWNER_A, titleInput({ workIdentity }));
    await createTitle(OWNER_A, titleInput({ workIdentity, duplicateAckSeq: 'dup-1' }));
    await createSuppression(OWNER_A, suppressionInput(workIdentity));

    const rows = await testPrisma().title.findMany({ where: { ownerId: OWNER_A, workIdentity } });
    const suppression = await findActiveSuppression(OWNER_A, workIdentity);

    expect(rows).toHaveLength(2);
    expect(suppression).not.toBeNull();
    expect(rows.every((r) => r.workIdentity === suppression?.workIdentity)).toBe(true);
  });

  it('T-INV-015e: the suppressed view renders with NO title row at all', async () => {
    // US-029 AC-1 — the display snapshot is the whole point of the flattened
    // display_* columns.
    const suppression = await createSuppression(
      OWNER_A,
      suppressionInput(workId(), { displayName: 'Orphaned Work', displayReleaseYear: 1999 }),
    );
    expect(await testPrisma().title.count({ where: { ownerId: OWNER_A } })).toBe(0);
    expect(suppression.displayName).toBe('Orphaned Work');
  });
});

describe('T-SEC-021 owner scoping holds at runtime', () => {
  it("T-SEC-021m: a read for owner B cannot see owner A's title", async () => {
    const title = await createTitle(OWNER_A, titleInput());
    expect(await findTitle(OWNER_A, title.id)).not.toBeNull();
    // Must be indistinguishable from "does not exist" so the route can 404
    // rather than 403 (NFR-008).
    expect(await findTitle(OWNER_B, title.id)).toBeNull();
  });

  it("T-SEC-021n: a write for owner B cannot touch owner A's batch", async () => {
    const batch = await createUploadBatch(OWNER_A, batchInput());
    const result = await updateUploadBatchStatus(OWNER_B, batch.id, { status: 'complete' });

    expect(result.count).toBe(0);
    expect((await findUploadBatch(OWNER_A, batch.id))?.status).toBe('draft');
  });

  it("T-SEC-021o: listing for owner B excludes owner A's rows entirely", async () => {
    await createTitle(OWNER_A, titleInput());
    await createTitle(OWNER_A, titleInput());
    await createTitle(OWNER_B, titleInput());

    expect(await listActiveTitles(OWNER_A)).toHaveLength(2);
    expect(await listActiveTitles(OWNER_B)).toHaveLength(1);
  });
});

describe('T-INV-019 upload batch safety flags survive the round trip', () => {
  it('T-INV-019a: persists degradedExtraction, lowYield and crossCheck', async () => {
    // ⚠ Extraction and review are SEPARATE requests. These flags each force
    // `computeRemovals: false` (specs/ai.md §2.2/§8.2), so if they did not
    // survive storage, a failed extraction could be misread as a removal on
    // the next request — the single most important safety property here.
    const created = await createUploadBatch(
      OWNER_A,
      batchInput({ degradedExtraction: true, lowYield: true, crossCheck: 'ocr-unavailable' }),
    );

    const loaded = await findUploadBatch(OWNER_A, created.id);
    expect(loaded?.degradedExtraction).toBe(true);
    expect(loaded?.lowYield).toBe(true);
    expect(loaded?.crossCheck).toBe('ocr-unavailable');
  });

  it('T-INV-019b: defaults the flags to false rather than null', async () => {
    const created = await createUploadBatch(OWNER_A, batchInput());
    const loaded = await findUploadBatch(OWNER_A, created.id);
    expect(loaded?.degradedExtraction).toBe(false);
    expect(loaded?.lowYield).toBe(false);
    expect(loaded?.crossCheck).toBeNull();
  });
});

describe('T-INV-020 CHECK constraints are enforced by the database', () => {
  it('T-INV-020a: rejects a service the product does not support', async () => {
    // v1 is Netflix and Max. 'prime' must not reach storage.
    const error = await thrown(() => createUploadBatch(OWNER_A, batchInput({ service: 'prime' })));
    expect(error).toBeDefined();
  });

  it("T-INV-020b: rejects an unknown batch mode but accepts 'full-update'", async () => {
    expect(
      await thrown(() => createUploadBatch(OWNER_A, batchInput({ mode: 'full_update' }))),
    ).toBeDefined();
    await expect(
      createUploadBatch(OWNER_A, batchInput({ mode: 'full-update' })),
    ).resolves.toBeDefined();
  });

  it('T-INV-020c: accepts a JSON OBJECT in extractionStats, and rejects garbage', async () => {
    await expect(
      createUploadBatch(OWNER_A, batchInput({ extractionStats: '{"titles":4}' })),
    ).resolves.toBeDefined();
    expect(
      await thrown(() => createUploadBatch(OWNER_A, batchInput({ extractionStats: 'not json' }))),
    ).toBeDefined();
    // ⚠ A bare scalar is correctly REJECTED here. `ISJSON(x) = 1` returns 0 for
    // a JSON scalar (finding E-3), and extraction_stats holds an object, so the
    // plain form is right for this column. The columns that hold scalars are
    // batch_change.prev_value/next_value, and they use `ISJSON(x, VALUE) = 1`
    // instead -- see the batch_change case below. Conflating the two is exactly
    // the defect E-3 recorded: it rolled back every full-update batch close.
    expect(
      await thrown(() => createUploadBatch(OWNER_A, batchInput({ extractionStats: '123' }))),
    ).toBeDefined();
  });

  it('T-INV-020d: accepts a JSON SCALAR in batch_change.prev_value / next_value (E-3)', async () => {
    const batch = await createUploadBatch(OWNER_A, batchInput());
    // '"tmdb:tv:1"' is a JSON scalar. ISJSON(x) = 1 rejects it; the column
    // uses ISJSON(x, VALUE) = 1 so that provenance writes -- the commonest
    // write in a batch close -- are accepted.
    await expect(
      recordBatchChange(OWNER_A, {
        batchId: batch.id,
        kind: 'attr_modified',
        prevValue: '"tmdb:tv:1"',
        nextValue: '"tmdb:tv:2"',
      }),
    ).resolves.toBeDefined();

    expect(
      await thrown(() =>
        recordBatchChange(OWNER_A, {
          batchId: batch.id,
          kind: 'attr_modified',
          prevValue: 'not json',
        }),
      ),
    ).toBeDefined();
  });
});

describe('T-INV-021 upsertServiceState is UPDATE-then-INSERT, never MERGE', () => {
  it('T-INV-021a: inserts on first call and updates on the second', async () => {
    const batch = await createUploadBatch(OWNER_A, batchInput());
    const at = new Date('2026-02-01T00:00:00.000Z');

    await upsertServiceState(OWNER_A, 'netflix', {
      lastCompletedBatchId: null,
      lastCompletedBatchAt: null,
    });
    expect(await findServiceState(OWNER_A, 'netflix')).not.toBeNull();

    await upsertServiceState(OWNER_A, 'netflix', {
      lastCompletedBatchId: batch.id,
      lastCompletedBatchAt: at,
    });

    const state = await findServiceState(OWNER_A, 'netflix');
    expect(state?.lastCompletedBatchId).toBe(batch.id);
    expect(await testPrisma().serviceState.count({ where: { ownerId: OWNER_A } })).toBe(1);
  });

  it('T-INV-021b: keeps two owners independent under the same service', async () => {
    for (const owner of [OWNER_A, OWNER_B]) {
      await upsertServiceState(owner, 'netflix', {
        lastCompletedBatchId: null,
        lastCompletedBatchAt: null,
      });
    }
    expect(await testPrisma().serviceState.count()).toBe(2);
  });

  it('T-INV-021c: null lastCompletedBatchAt means NEVER UPDATED, and is preserved', async () => {
    // US-022 AC-3: "Max has never been updated" is a real, renderable state and
    // must stay distinguishable from "updated at the epoch".
    await upsertServiceState(OWNER_A, 'max', {
      lastCompletedBatchId: null,
      lastCompletedBatchAt: null,
    });
    expect((await findServiceState(OWNER_A, 'max'))?.lastCompletedBatchAt).toBeNull();
  });
});

describe('T-INV-022 full-update review shows ALL candidates', () => {
  it('T-INV-022a: returns discarded and pending candidates alike', async () => {
    // ⚠ Product invariant 2. A candidate that failed to extract or was
    // collapsed must still be visible, or a failed extraction could be read as
    // a removal. `listCandidatesForBatch` deliberately takes NO filter.
    const batch = await createUploadBatch(OWNER_A, batchInput());
    const common = {
      batchId: batch.id,
      rawText: 'Some Title',
      basis: 'text',
      ocrSupport: 'none',
      provider: 'llm',
      normalisedText: 'some title',
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
    };
    const survivor = await testPrisma().extractionCandidate.create({
      data: { ...common, id: id('cand'), ownerId: OWNER_A },
    });
    await testPrisma().extractionCandidate.create({
      data: {
        ...common,
        id: id('cand'),
        ownerId: OWNER_A,
        reviewDisposition: 'discarded',
        collapsedIntoCandidateId: survivor.id,
      },
    });

    const all = await listCandidatesForBatch(OWNER_A, batch.id);
    expect(all).toHaveLength(2);
    // SD-02: the loser is NOT deleted; it points at the survivor that
    // absorbed it, so REQ-012's "nothing is silently discarded" holds.
    expect(all.find((c) => c.reviewDisposition === 'discarded')?.collapsedIntoCandidateId).toBe(
      survivor.id,
    );
  });
});

describe('T-INV-018 the database is provisioned correctly', () => {
  it('T-INV-018a: the database default collation is Latin1_General_100_BIN2', async () => {
    // ⚠ NOT a style preference. Prisma's create() joins a
    // `DECLARE @generated_keys table([id] NVARCHAR(200))` variable back to the
    // inserted row; a table variable takes the DATABASE DEFAULT collation, so
    // on a CI_AS database that join hits the BIN2 [id] column and every insert
    // dies with Msg 468. Measured: 24 of 25 tests in this file failed that way.
    // Without this assertion the cause is a mystery; with it, it is a sentence.
    const rows = await testPrisma().$queryRawUnsafe<{ collation: string }[]>(
      "SELECT CONVERT(NVARCHAR(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS collation",
    );
    expect(rows[0]?.collation).toBe('Latin1_General_100_BIN2');
  });

  it('T-INV-018b: all three FILTERED unique indexes exist', async () => {
    // The three identity invariants are enforced by FILTERED unique indexes,
    // and a filtered index requires QUOTED_IDENTIFIER ON at CREATE time. If
    // the harness runs with it OFF the indexes are never created, and
    // T-INV-001/002/015 all pass while asserting nothing at all.
    const rows = await testPrisma().$queryRawUnsafe<
      { name: string; has_filter: boolean | number }[]
    >(
      `SELECT name, has_filter FROM sys.indexes
       WHERE name IN ('title_one_active_per_work','listing_one_per_service','suppression_one_active')`,
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      'listing_one_per_service',
      'suppression_one_active',
      'title_one_active_per_work',
    ]);
    expect(rows.every((r) => r.has_filter === true || r.has_filter === 1)).toBe(true);
  });
});
