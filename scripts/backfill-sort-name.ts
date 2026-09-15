/**
 * `scripts/backfill-sort-name.ts` — populate `title.sort_name` for rows that
 * predate migration `0010` (TASK-219, `T-INV-019`).
 *
 * WHY THIS IS A SCRIPT AND NOT AN `UPDATE` IN THE MIGRATION
 * --------------------------------------------------------
 * `specs/data-model.md` §16 I-4 fixes the rule: a derived value is computed by
 * ONE TypeScript function, because a second implementation in T-SQL drifts
 * from the first in silence. `sort_name` is derived — the leading-article rule
 * and the whitespace normalisation are real logic, not a `COALESCE` — so
 * writing it in the migration would mean maintaining that logic twice, in a
 * dialect that cannot be unit-tested, with no gate comparing the two.
 *
 * This calls `deriveSortName`, the same function every write path calls.
 * There is exactly one implementation of the rule.
 *
 * ⚠ A FRESH DATABASE NEEDS NOTHING. CI and any new environment start with no
 * titles, so there is nothing to backfill and the migration alone is complete.
 * This is for the one long-lived database that already holds the owner's list.
 *
 * ⚠ FORGETTING TO RUN IT FAILS LOUDLY, BY DESIGN. Un-backfilled rows keep
 * `sort_name = NULL`, which sorts them to the END of an A–Z list — a silent,
 * plausible-looking wrong answer. `T-INV-019` asserts that every row's stored
 * key equals `deriveSortName`, so an environment where this was never run is
 * caught by the invariant suite rather than by the owner noticing their list
 * is in the wrong order.
 *
 * ⚠ IT IS RUN BY A HUMAN, ALWAYS — the same rule `export-owner-data.ts`
 * states. There is no timer, no cron, no queue trigger and no Agent job here,
 * and adding one would be a REQ-041 violation that `T-CI-005` fails the build
 * over. It is a one-shot operator tool, invoked once after deploying `0010`.
 *
 * ⚠ IT NEVER DELETES AND NEVER TOUCHES LIST MEMBERSHIP. The only column it
 * writes is `sort_name`, which no user-visible state depends on other than the
 * order of a list the owner explicitly asked to sort by name. REQ-028 is
 * untouched.
 *
 * ⚠ THE PLAIN PRISMA CLIENT, NOT THE APPLICATION'S DRIVER ADAPTER — the same
 * reasoning as `export-owner-data.ts`: this is an operator-invoked tool
 * holding an operator's credential, it never runs inside the container, and
 * the running app therefore still holds no database credential.
 */

import { PrismaClient } from '@prisma/client';

import { deriveSortName } from '@nextup/domain';

/**
 * How many rows to read at a time.
 *
 * The container this normally runs beside has 0.5 GiB (REQ-079), and while
 * this script runs outside it, a `findMany()` over an unbounded table is the
 * habit that eventually meets a table big enough to matter. Paging by `id`
 * keeps memory flat regardless of library size.
 */
const PAGE_SIZE = 500;

export interface BackfillResult {
  scanned: number;
  updated: number;
  unchanged: number;
}

/**
 * Recompute `sortName` for every title and write back only where it differs.
 *
 * ⚠ **IDEMPOTENT, AND IT MUST STAY SO.** The operator may reasonably run this
 * twice — after a failed deploy, or because they are unsure whether it already
 * ran. Writing unconditionally would be harmless for the data but would report
 * every row as "updated" on the second run, which makes the output useless as
 * evidence that the first run worked.
 *
 * ⚠ **IT RECOMPUTES EVERY ROW, NOT ONLY THE `NULL` ONES.** Filtering to
 * `sortName: null` is the obvious optimisation and is wrong: it would make the
 * script unable to repair rows written by an earlier, buggy version of
 * `deriveSortName`, which is precisely the situation in which someone reaches
 * for it. The `null` rows are simply the common case, not the definition.
 *
 * ⚠ **`updateMany` SCOPED BY `id` ALONE IS DELIBERATE HERE AND IS NOT A
 * TENANCY HOLE.** This is a single-owner product and the tool is operator-
 * invoked over the whole table; it has no `ownerId` to scope to, and scoping
 * to one would silently skip rows if the owner id ever changed (an Entra
 * `oid` is stable, but a re-provisioned tenant is not). It lives in
 * `scripts/**`, outside the `repository/**` tree `T-SEC-021` polices, for the
 * same reason `export-owner-data.ts` does.
 */
export async function backfillSortName(
  prisma: Pick<PrismaClient, 'title'>,
  pageSize: number = PAGE_SIZE,
): Promise<BackfillResult> {
  const result: BackfillResult = { scanned: 0, updated: 0, unchanged: 0 };
  let after: string | undefined;

  for (;;) {
    const rows = await prisma.title.findMany({
      where: after === undefined ? {} : { id: { gt: after } },
      select: { id: true, tmdbName: true, rawExtractedText: true, sortName: true },
      orderBy: { id: 'asc' },
      take: pageSize,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      result.scanned += 1;
      const next = deriveSortName(row);
      if (next === row.sortName) {
        result.unchanged += 1;
        continue;
      }
      await prisma.title.updateMany({ where: { id: row.id }, data: { sortName: next } });
      result.updated += 1;
    }

    after = rows[rows.length - 1]?.id;
    if (after === undefined) break;
  }

  return result;
}

export async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await backfillSortName(prisma);
    process.stdout.write(
      `sort_name backfill complete\n` +
        `  scanned:   ${String(result.scanned)}\n` +
        `  updated:   ${String(result.updated)}\n` +
        `  unchanged: ${String(result.unchanged)}\n`,
    );
    if (result.scanned === 0) {
      // Not an error: a fresh database is the expected case in CI and in a new
      // environment. Saying so explicitly stops it reading as a silent no-op.
      process.stdout.write('  (no titles in this database — nothing to backfill)\n');
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Only when invoked directly, so the integration suite can import this module
// without it trying to open a connection.
if (import.meta.url.endsWith('backfill-sort-name.js')) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
