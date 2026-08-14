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

const TEST_ID_RE = /T-[A-Z0-9]+-\d+[a-z]?/g;

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
  'T-AI-014',
  'T-ATTR-005',
  'T-AUTH-003',
  'T-CLS-013',
  'T-DATE-010',
  'T-DATE-011',
  'T-DATE-012',
  'T-DATE-013',
  'T-FIX-004',
  'T-FIX-006',
  'T-GRP-010',
  'T-GRP-011',
  'T-GRP-012',
  'T-GRP-013',
  'T-GRP-014',
  'T-IMG-011',
  'T-IMG-018',
  'T-IMG-019',
  'T-IMG-020',
  'T-IMG-022',
  'T-INFRA-006',
  'T-INV-014',
  'T-INV-016',
  'T-MIG-002',
  'T-RES-010',
  'T-RES-011',
  'T-RES-012',
  'T-RES-015',
  'T-RET-010',
  'T-REV-014',
  'T-REV-015',
  'T-REV-016',
  'T-REX-010',
  'T-REX-011',
  'T-REX-012',
  'T-REX-013',
  'T-REX-014',
  'T-SUP-002',
  'T-SUP-015',
  'T-SUP-017',
  'T-SUP-022',
  'T-SUP-023',
  'T-TMDB-011',
  'T-TMDB-012',
  'T-TMDB-014',
  'T-TMDB-015',
  'T-UNDO-008',
  'T-UNDO-009',
  'T-UNDO-010',
  'T-UNDO-011',
  'T-UNDO-012',
  'T-UNM-010',
  'T-UNM-011',
  'T-UX-053',
  'T-UX-054',
  'T-UX-062',
  'T-UX-064',
  'T-UX-071',
  'T-UX-072',
]);

/** Every base id named by any `*.spec.*` / `*.test.*` file under `root`. */
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
        for (const id of text.match(TEST_ID_RE) ?? []) found.add(baseId(id));
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
            resolved.join(', ')
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
