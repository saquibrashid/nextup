/**
 * Every test id `specs/testing.md` DEFINES must be owned — by a task in
 * `docs/backlog.md`, or by a suite that already implements it.
 *
 * ── Why this gate exists ────────────────────────────────────────────────────
 *
 * `check-test-ids.mjs` walks from the backlog to the spec: *are the ids the
 * work order cites real?* This gate walks the other way: *does every id the
 * spec defines have someone who will build it?*
 *
 * The two failures are not symmetric, and this one is worse. A mis-citation is
 * loud in the end: the task cannot close, because the test it names does not
 * exist. An ORPHAN is silent in every direction — the id is real, the
 * acceptance criterion is written down, every gate passes, the ledger reaches
 * 100%, and the criterion is simply never implemented, because no task ever
 * asked anyone to implement it.
 *
 * That is not hypothetical either. TASK-037's `genre` filter was **parsed,
 * validated and then never passed to the query**: `?genre=Comedy` returned 200
 * and listed every title. There was no test for it because `T-LIST-022` — the
 * id that would have owned one — was defined in §9 and cited by no task at
 * all. The feature was missing for as long as the orphan was. See
 * `specs/testing.md` §21.1.
 *
 * ── What counts as "owned" ──────────────────────────────────────────────────
 *
 * Either a backlog task cites the id, or a collected suite already implements
 * it. The second arm matters: an implementer who adds a supplementary case
 * (`T-LIST-033`, `T-LIST-034`) has demonstrably built it, and failing that is
 * bookkeeping noise. **An id that is neither cited nor implemented is the
 * dangerous set — nobody is going to write it.**
 *
 * ⚠ The second arm is deliberately GENEROUS: any mention of an id anywhere in
 * a `*.spec.*` file counts, not only a `describe`/`it` title. Anchoring to the
 * title form was measured and rejected — it drops 21 ids that are genuinely
 * implemented under an older naming convention, and reporting those as
 * unowned would make the real list unreadable. The cost is that naming a real
 * id in a test COMMENT credits it; the compensating rule is that this file's
 * own tests never write a baseline id as a literal (`T-META-006g`).
 *
 * ── The baseline ────────────────────────────────────────────────────────────
 *
 * When this gate was written it found **63 defined ids that were neither cited
 * nor implemented, out of 347 defined (18%)** — including US-018 AC-3/AC-4/
 * AC-6 and every one of US-021's date-added criteria. They cannot all be
 * assigned in one change without guessing which task owns each, and a guess
 * here reproduces the mis-citation class this project has already hit seven
 * times.
 *
 * They are therefore listed explicitly in `BASELINE_ORPHANS`, and the gate
 * fails on anything NEW. ⚠ **The baseline is a ratchet, not a permission.** It
 * may only ever shrink: `T-META-006e` fails if an id is added to it, so the
 * list cannot quietly absorb tomorrow's orphan. Removing an id from it is the
 * work of assigning that criterion to a task.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { baseId, citedTestIds, definedTestIds } from './check-test-ids.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A test id in `it`/`test`/`describe` TITLE position — the one place a test id
 * means "a test bearing this id runs". See `implementedTestIds` for why bare
 * occurrence was wrong.
 */
const TITLE_TEST_ID_RE =
  /\b(?:it|test|describe)(?:\.\w+)*\(\s*['"`]\s*(T-[A-Z0-9]+-\d+[a-z]{0,2})/g;

/** Directories that never hold a first-party suite. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-dev', 'coverage', '.turbo']);

const SPEC_FILE_RE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/**
 * Ids that were already orphaned when this gate was introduced (2026 audit).
 *
 * ⚠ MAY ONLY SHRINK. Adding to it is a way of not doing the work, and
 * `T-META-006e` fails if the list grows. Each entry is an acceptance criterion
 * with a written test id that no task will build — see `specs/testing.md` §22.
 */
export const BASELINE_ORPHANS = new Set([
  'T-A11Y-014',
  'T-ATTR-005',
  // 'T-AUTH-003' removed — the gate reports it as owned.
  // 'T-DATE-010'..'T-DATE-013' removed (US-021 dates) — implemented in
  // `apps/api/test/integration/dateAdded.spec.ts`. They were the entries with
  // the clearest cost: `specs/testing.md` §19.2 asserted the re-observation
  // path was "covered behaviourally by T-DATE-011" while T-DATE-011 did not
  // exist, so a written-down guarantee was owned by nothing at all.
  'T-IMG-011',
  'T-INFRA-006',
  'T-INV-014',
  'T-INV-016',
  'T-MIG-002',
  'T-RES-011',
  'T-RES-012',
  'T-RES-015',
  'T-RET-010',
  'T-REV-015',
  'T-SUP-015',
  'T-SUP-022',
  'T-SUP-023',
  // ⚠ `T-UNDO-011`, `T-UNDO-012`, `T-UX-053`, `T-UX-054` and `T-UX-062` were
  // REMOVED from this baseline — the gate reported all five as owned, and each
  // is now implemented in TITLE position, which is this file's own strict
  // definition of "a test bearing this id runs":
  //   `T-UNDO-011`/`T-UNDO-012` → `apps/api/test/integration/batchUndo.spec.ts`
  //   `T-UX-053`/`T-UX-054`     → `apps/web/test/batchStatusPage.spec.tsx`
  //   `T-UX-062`                → `apps/web/test/reviewPage.spec.tsx` (a–e)
  // That is the baseline working as a ratchet: the gap was recorded, the work
  // was done, and the record shrinks to match.
  //
  // ⚠ THE SIX BELOW ARE NOT NEW GAPS. They were always unimplemented; they
  // became VISIBLE when `implementedTestIds` was sharpened from "the id
  // appears anywhere in a spec file" to "the id is in a test title". Under the
  // old predicate an id recorded in another gate's known-gap baseline counted
  // as its own implementation, so the act of writing down that a test was
  // missing is what hid it.
  //
  // ~~"`T-AUTH-003`, `T-UX-053`, `T-UX-054` and `T-UX-062` appear in exactly
  // one place in the entire suite — as literals in `uxStateCoverage.spec.ts`'s
  // `KNOWN_UNCOVERED`."~~ — superseded and corrected in place, because it is a
  // factual claim a reader would otherwise act on. Real tests have since been
  // written for the three `T-UX-*` ids, and none of them appears in
  // `uxStateCoverage.spec.ts` any more.
  //
  // A sharpened detector is the ONLY legitimate reason this list may grow, and
  // this comment is the required justification. Do not append to it for any
  // other reason: `T-META-006e` pins the size exactly and the correct fix for
  // a new orphan is to cite the id in `docs/backlog.md`.
  //
  // `T-AUTH-001/002/003` are level `E` — a real browser against a real IdP —
  // and are deferred by §10, not merely unwritten.
  'T-AUTH-001',
  'T-AUTH-002',
  'T-AUTH-003',
  'T-UX-069',
  'T-UX-099',
  // ⚠ `T-UX-099` IS baselined here, and the note that used to sit on this line
  // claiming the opposite was itself an instance of the bug. It read: ~~"not
  // baselined here: it is cited by a task, so it was never an orphan in this
  // gate's sense"~~. It is cited by no task. The only thing that kept it out of
  // this report was its own string literal in `acCoverage.spec.ts`'s
  // `KNOWN_PHANTOM_CITATIONS`, which the old bare-occurrence predicate read as
  // an implementation.
  //
  // The distinction the note was reaching for is real and still worth keeping:
  // "owned" here means an id a task cites, which is strictly weaker than "a
  // test bearing this id runs". Filing a gap in the list that cannot see it
  // hides it. What is NOT true is that either list can be reasoned about from
  // the comments alone — check which gate actually reports the id.
]);

/**
 * Every base id named by any `*.spec.*` / `*.test.*` file under `root`, counted
 * only where the id appears in an `it`/`test`/`describe` TITLE.
 *
 * ⚠ THIS USED TO MATCH ANY OCCURRENCE, AND THAT MADE IT REPORT THE OPPOSITE OF
 * THE TRUTH. Several gates keep their known-gap baselines as arrays of id
 * string literals inside a `.spec.ts` file — `uxStateCoverage.spec.ts`'s
 * `KNOWN_UNCOVERED` is one. Under a bare-occurrence scan, an id sitting in
 * such a list was read as its own implementation, so **the very act of
 * recording that an id has no test made it look implemented.**
 *
 * That was not hypothetical. `T-AUTH-003`, `T-UX-053`, `T-UX-054` and
 * `T-UX-062` appear in exactly one place in the whole suite — as literals in
 * `KNOWN_UNCOVERED` — and this function reported all four as implemented, so
 * `resolvedBaselineIds` advised removing them from `BASELINE_ORPHANS` as
 * "now owned". Acting on that advice is what surfaced them.
 *
 * The predicate is title position, which an array literal never reaches. It is
 * safe because `T-META-004` requires every `it()` title to begin with a static
 * `T-` id, and it is the same predicate `T-META-001`, `T-META-002` and
 * `T-META-007` use — `acCoverage.spec.ts` previously had to avoid this helper
 * for precisely this reason, and no longer does.
 */
export function implementedTestIds(root = ROOT) {
  const found = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A directory that vanished mid-walk is not a finding: suites plant and
      // remove scratch trees while this runs.
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SPEC_FILE_RE.test(entry.name)) {
        let text;
        try {
          text = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        for (const [, id] of text.matchAll(TITLE_TEST_ID_RE)) found.add(baseId(id));
      }
    }
  };
  walk(root);
  return found;
}

/**
 * Defined ids that no task cites AND no suite implements.
 *
 * @returns `string[]` of base ids, sorted, EXCLUDING the baseline.
 */
export function orphanedTestIds(backlogMarkdown, specMarkdown, root = ROOT) {
  const defined = definedTestIds(specMarkdown);
  const cited = new Set([...citedTestIds(backlogMarkdown).keys()].map(baseId));
  const implemented = implementedTestIds(root);

  return [...defined]
    .filter((id) => !cited.has(id) && !implemented.has(id) && !BASELINE_ORPHANS.has(id))
    .sort();
}

/** Baseline entries that are now owned, i.e. the ratchet is ready to tighten. */
export function resolvedBaselineIds(backlogMarkdown, specMarkdown, root = ROOT) {
  const cited = new Set([...citedTestIds(backlogMarkdown).keys()].map(baseId));
  const implemented = implementedTestIds(root);
  return [...BASELINE_ORPHANS].filter((id) => cited.has(id) || implemented.has(id)).sort();
}

function main() {
  const backlog = readFileSync(path.join(ROOT, 'docs', 'backlog.md'), 'utf8');
  const spec = readFileSync(path.join(ROOT, 'specs', 'testing.md'), 'utf8');
  const offenders = orphanedTestIds(backlog, spec);
  const resolved = resolvedBaselineIds(backlog, spec);

  if (offenders.length === 0) {
    console.log(
      `Orphan-test check passed: no NEW unowned test id. ` +
        `${String(BASELINE_ORPHANS.size)} remain in the baseline` +
        (resolved.length > 0
          ? `, of which ${String(resolved.length)} are now owned and can be removed from it: ` +
            resolved.join(', ') +
            `\n⚠ "Owned" here is satisfied by a BACKLOG CITATION alone, which does not mean a ` +
            `test bearing the id runs. Removing such an id from the baseline may surface it in ` +
            `T-META-001e as a phantom citation — that is the gate working, not a regression.`
          : '.'),
    );
    return;
  }

  console.error('Orphan-test check failed.\n');
  console.error(
    `${offenders.length} test id${offenders.length > 1 ? 's are' : ' is'} DEFINED in ` +
      'specs/testing.md but cited by no task in docs/backlog.md and\n' +
      'implemented by no suite. An acceptance criterion in that state is never\n' +
      'built: every gate passes, the ledger reaches 100%, and the behaviour is\n' +
      'simply missing (specs/testing.md §21.1).\n',
  );
  for (const id of offenders) console.error(`  - ${id}`);
  console.error(
    '\nFix docs/backlog.md by citing the id in the "Done when" of the task that\n' +
      'owns that acceptance criterion. Do NOT add it to BASELINE_ORPHANS — that\n' +
      'list may only shrink, and T-META-006e fails if it grows.',
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith('check-orphan-tests.mjs')) {
  main();
}
