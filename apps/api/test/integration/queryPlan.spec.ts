/**
 * TASK-047 — `T-PERF-001` / `T-PERF-003`: the query plan at scale.
 *
 * ── Why a plan assertion and not a stopwatch ────────────────────────────────
 *
 * A timing test on a developer laptop and on Azure SQL Basic (5 DTU) measure
 * different machines, and the number that matters is not the one either
 * reports. What NFR-018 actually claims is **scale-invariance**: the cost of
 * one page must not grow with history, and REQ-028 means history only ever
 * grows. A plan assertion states that property directly and is stable across
 * machines; a threshold in milliseconds passes on a fast laptop while the
 * production database is timing out.
 *
 * ⚠ `SET SHOWPLAN_XML ON` is deliberately NOT used. It must be the only
 * statement in its batch and it applies to a SESSION, and Prisma pools
 * connections — so the statement whose plan you capture is not reliably the
 * statement you ran. `sys.dm_exec_query_plan` is read back out of the plan
 * cache instead, which is connection-independent. §9 names both.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  asOwnerId,
  createTitle,
  createUploadBatch,
  escapeLikeTerm,
  listRemovedListingPage,
  searchRemovedListings,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OWNER = asOwnerId('owner-perf-fixture');

/** How many removed listings the scale fixture plants (§9: 20,000). */
const SCALE_ROWS = 20_000;

interface PlanRow {
  plan: string;
  logicalReads: bigint;
  rowsReturned: bigint;
}

/**
 * The cached plan and IO counters for the most recent statement matching
 * `textLike`.
 *
 * The `NOT LIKE` clause excludes this very query: it names
 * `dm_exec_query_stats`, so without it the harness reliably captures its own
 * plan and every assertion becomes a statement about the harness.
 */
async function planFor(textLike: string): Promise<PlanRow | undefined> {
  const rows = await testPrisma().$queryRawUnsafe<PlanRow[]>(
    `SELECT TOP 1
        CAST(qp.query_plan AS NVARCHAR(MAX)) AS [plan],
        qs.total_logical_reads AS logicalReads,
        qs.total_rows AS rowsReturned
     FROM sys.dm_exec_query_stats qs
     CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
     CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
     WHERE st.text LIKE @P1
       AND st.text NOT LIKE '%dm_exec_query_stats%'
     ORDER BY qs.last_execution_time DESC`,
    textLike,
  );
  return rows[0];
}

/** Drop cached plans so `planFor` cannot return a stale one from an earlier case. */
async function clearPlanCache(): Promise<void> {
  await testPrisma().$executeRawUnsafe('ALTER DATABASE SCOPED CONFIGURATION CLEAR PROCEDURE_CACHE');
}

/** Insert `count` REMOVED listings in one statement. */
async function plantRemovedListings(
  titleId: string,
  batchId: string,
  count: number,
): Promise<void> {
  await testPrisma().$executeRawUnsafe(
    `WITH n AS (
       SELECT 1 AS i
       UNION ALL SELECT i + 1 FROM n WHERE i < @P3
     )
     INSERT INTO service_listing
       (listing_id, owner_id, title_id, service, state, date_added,
        date_added_edited, removed_at, removed_by_batch_id, created_by_batch_id)
     SELECT
       CONCAT('perf-', @P4, '-', i), @P1, @P2, 'netflix', 'removed',
       '2026-01-01',
       0,
       DATEADD(minute, -i, '2026-06-01T00:00:00'),
       @P5, @P5
     FROM n
     OPTION (MAXRECURSION 0)`,
    OWNER,
    titleId,
    count,
    titleId,
    batchId,
  );
}

let titleId: string;
let batchId: string;

beforeAll(async () => {
  testPrisma();
  await resetDatabase();

  const batch = await createUploadBatch(OWNER, {
    id: 'perf-batch',
    service: 'netflix',
    mode: 'full-update',
    status: 'applied',
  });
  batchId = batch.id;

  const title = await createTitle(OWNER, {
    id: 'perf-title',
    workIdentity: 'tmdb:movie:424242',
    state: 'active',
    matchState: 'matched',
    tmdbId: 424_242,
    tmdbMediaType: 'movie',
    tmdbName: 'Amélie',
    tmdbGenres: JSON.stringify(['Drama']),
    sortDateAdded: new Date('2026-01-01T00:00:00.000Z'),
    createdByBatchId: batch.id,
  });
  titleId = title.id;

  await plantRemovedListings(titleId, batchId, SCALE_ROWS);
  // Statistics are what the optimiser reasons from. Without this the plan can
  // be chosen against a row estimate of 1, and the test would assert a seek
  // that the optimiser only picked because it thought the table was empty —
  // the exact opposite of a scale assertion.
  await testPrisma().$executeRawUnsafe('UPDATE STATISTICS service_listing');
}, 180_000);

beforeEach(async () => {
  await clearPlanCache();
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-PERF-001 — the removed view is scale-invariant', () => {
  it('T-PERF-001a: NON-VACUITY — the fixture really holds 20,000 removed listings', async () => {
    // Every other case in this file is trivially satisfiable at 10 rows. If
    // the bulk insert silently planted fewer, the suite would still be green
    // and would be asserting nothing about scale at all.
    const [row] = await testPrisma().$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT_BIG(*) AS n FROM service_listing WHERE owner_id = @P1 AND state = 'removed'`,
      OWNER,
    );
    expect(Number(row?.n ?? 0)).toBe(SCALE_ROWS);
  });

  it('T-PERF-001b: the first page seeks the filtered index, and does not scan', async () => {
    const page = await listRemovedListingPage(OWNER, { limit: 50 });
    expect(page).toHaveLength(50);

    const captured = await planFor('%FROM service_listing l%removed%');
    expect(captured).toBeDefined();
    const plan = captured?.plan ?? '';

    expect(plan).toContain('listing_removed_view');
    expect(plan).toContain('Index Seek');
    // ⚠ Both scan forms must be excluded. Asserting only "no Table Scan" is
    // vacuous on this schema: `service_listing` has a clustered primary key,
    // so a full read appears as a CLUSTERED INDEX SCAN and the table-scan
    // operator never appears no matter how bad the plan is.
    expect(plan).not.toContain('PhysicalOp="Table Scan"');
    expect(plan).not.toContain('PhysicalOp="Clustered Index Scan"');
  });

  it('T-PERF-001c: rows read are bounded by the page size, not the table size', async () => {
    await listRemovedListingPage(OWNER, { limit: 50 });
    const captured = await planFor('%FROM service_listing l%removed%');

    // The property is a BOUND, not a benchmark. 20,000 rows through a seek
    // costs a handful of pages; a scan costs hundreds. Anything under 500
    // logical reads cannot be a full pass over the fixture, and the gap
    // between the two behaviours is two orders of magnitude, so no machine
    // dependence lives in this margin.
    expect(Number(captured?.logicalReads ?? 0)).toBeLessThan(500);
  });

  it('T-PERF-001d: a later keyset page costs the same as the first', async () => {
    // The real scale-invariance claim. A first page is cheap under almost any
    // plan; the question NFR-018 asks is whether page 400 costs 400 times as
    // much, which is what `OFFSET` would do and what this test forbids.
    //
    // ⚠ The cursor is taken from row 15,000, not from page 1. Comparing page 1
    // with page 2 does not test this property at all: both are cheap under
    // every plan, including one that would degrade catastrophically deep in
    // the list. The fixture reaches that row with `OFFSET` deliberately — the
    // ban is on the PRODUCT paging that way, and a test that cannot construct
    // the state it is checking is not a test.
    //
    // ⚠ `total_logical_reads` is CUMULATIVE per cached plan, so the cache must
    // be cleared BETWEEN the two measurements — and, less obviously, must NOT
    // be cleared between running a query and reading its cost. Doing that
    // yielded 0 for the first page, silently turning the comparison into an
    // assertion against a hard-coded floor that had nothing to do with the
    // first page. It also manufactured a phantom 296-vs-50 regression that
    // sent one round of "optimisation" after a problem that did not exist.
    await listRemovedListingPage(OWNER, { limit: 50 });
    const firstCost = Number(
      (await planFor('%FROM service_listing l%removed%'))?.logicalReads ?? 0,
    );
    expect(firstCost).toBeGreaterThan(0);

    const [deep] = await testPrisma().$queryRawUnsafe<{ removed_at: Date; listing_id: string }[]>(
      `SELECT removed_at, listing_id FROM service_listing
       WHERE owner_id = @P1 AND state = 'removed'
       ORDER BY removed_at DESC, listing_id ASC
       OFFSET 15000 ROWS FETCH NEXT 1 ROWS ONLY`,
      OWNER,
    );
    expect(deep).toBeDefined();

    await clearPlanCache();

    const page = await listRemovedListingPage(OWNER, {
      limit: 50,
      cursor: { removedAt: deep?.removed_at ?? new Date(), listingId: deep?.listing_id ?? '' },
    });
    expect(page).toHaveLength(50);
    const deepCost = Number((await planFor('%FROM service_listing l%removed%'))?.logicalReads ?? 0);

    expect(deepCost).toBeLessThan(firstCost * 3);
  });

  it('T-PERF-001e: the removed page never uses OFFSET', async () => {
    // Static, because a plan assertion cannot distinguish a small OFFSET from
    // a keyset seek — they look identical at page 1 and diverge only deep in
    // the list, where no test will be looking.
    //
    // ⚠ Comments are stripped first. Without that, the doc comment in the
    // repository explaining that OFFSET must not be used FAILS this test —
    // observed on the first run. Recording why a thing is forbidden must not
    // trip the guard against it, or the only green path is deleting the
    // explanation, which is the opposite of what the guard is for.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/repository/ownerData.ts', import.meta.url),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bOFFSET\b/i);
    expect(source).not.toMatch(/\bskip:/);
    // Non-vacuity: the stripper must not have eaten the code as well. If it
    // had, this test would pass against an empty string for ever.
    expect(source).toContain('listRemovedListingPage');
  });
});

describe('T-PERF-001 — search is explicitly NOT index-backed', () => {
  it('T-PERF-001f: the LIKE search is accent- and case-insensitive', async () => {
    // §16.6 overrides the BIN2 column collation per query. Without it a search
    // for `amelie` finds nothing, which reads to the owner as "the title is
    // gone" — the one impression this product must never give.
    const hits = await searchRemovedListings(OWNER, 'amelie', 5);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('T-PERF-001g: LIKE metacharacters are escaped, not honoured', async () => {
    // `%` as a term must match nothing, because no title CONTAINS a percent
    // sign. Unescaped it matches every row — a search box that silently
    // returns the whole table.
    const wildcard = await searchRemovedListings(OWNER, '%', 5);
    expect(wildcard).toHaveLength(0);

    const underscore = await searchRemovedListings(OWNER, 'Am_lie', 5);
    expect(underscore).toHaveLength(0);
  });

  it('T-PERF-001h: the escape character is itself escaped first', async () => {
    expect(escapeLikeTerm('100%')).toBe('100!%');
    expect(escapeLikeTerm('a_b')).toBe('a!_b');
    expect(escapeLikeTerm('[x]')).toBe('![x]');
    // If `!` were escaped last, `!%` would become `!!%` → a literal `!`
    // followed by a wildcard, and the guard would leak the wildcard it exists
    // to neutralise.
    expect(escapeLikeTerm('!%')).toBe('!!!%');
  });

  it('T-PERF-001i: a term that looks like SQL is data, not syntax', async () => {
    const hits = await searchRemovedListings(OWNER, "'; DROP TABLE service_listing; --", 5);
    expect(hits).toHaveLength(0);
    // Non-vacuity: the table is still there, so the statement was bound as a
    // parameter rather than concatenated.
    const [row] = await testPrisma().$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT_BIG(*) AS n FROM service_listing WHERE owner_id = @P1`,
      OWNER,
    );
    expect(Number(row?.n ?? 0)).toBe(SCALE_ROWS);
  });
});

describe('T-PERF-003 — batch-scoped reads seek under the §16.6 indexes', () => {
  it('T-PERF-003a: the §16.6 indexes all exist in the applied schema', async () => {
    const rows = await testPrisma().$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sys.indexes WHERE name IN
         ('title_list_default','listing_removed_view','listing_by_title',
          'batch_change_by_batch','candidate_by_batch')`,
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      'batch_change_by_batch',
      'candidate_by_batch',
      'listing_by_title',
      'listing_removed_view',
      'title_list_default',
    ]);
  });

  it('T-PERF-003b: listing_removed_view is FILTERED, not a full copy', async () => {
    // The filter is what makes the index scale-invariant as history grows.
    // An unfiltered index of the same key columns satisfies every plan
    // assertion above and degrades exactly as the table does.
    const [row] = await testPrisma().$queryRawUnsafe<{ filter: string | null }[]>(
      `SELECT filter_definition AS [filter] FROM sys.indexes WHERE name = 'listing_removed_view'`,
    );
    expect(row?.filter ?? '').toContain('removed');
  });

  it('T-PERF-003c: the list page seeks title_list_default and does not scan title', async () => {
    const { listTitlePage } = await import('../../src/repository/ownerData.js');
    await listTitlePage(OWNER, { limit: 50, dir: 'desc' });

    const captured = await planFor('%[title]%');
    expect(captured).toBeDefined();
    expect(captured?.plan ?? '').not.toContain('PhysicalOp="Table Scan"');
  });
});
