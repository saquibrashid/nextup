/**
 * Every test id the backlog cites must be DEFINED in `specs/testing.md`.
 *
 * ── Why this gate exists ────────────────────────────────────────────────────
 *
 * `specs/testing.md` carries the AC → named-test mapping, and that mapping is
 * the definition of done (NFR-003). `docs/backlog.md` is the work order, and
 * each row's "Done when" column names the tests that finish it. If a row cites
 * an id that the spec never defines, that row has NO definition of done — and
 * the failure is silent, because an implementer reads a plausible-looking id,
 * writes a test with that name, and every gate goes green against a test that
 * asserts whatever the implementer decided it should.
 *
 * That is not hypothetical. When this gate was written, **89 of the 276 ids
 * the backlog cited (32%) were defined nowhere in `specs/testing.md`.** The
 * pattern was systematic, not random: the spec's tables had been renumbered
 * (`T-LIST-001`/`002` → `T-LIST-010`…`027`, `T-REM-001`…`005` →
 * `T-REM-006`/`010`…`022`) and the backlog was never reconciled. Three tasks
 * had already been implemented against ids invented at the keyboard:
 * `T-BATCH-001`, `T-BATCH-002` and `T-API-003` were each cited by the backlog,
 * one of them ALSO advertised in a source comment as a guard that existed, and
 * all three were implemented nowhere.
 *
 * ── What it does NOT check ──────────────────────────────────────────────────
 *
 * That a cited test is IMPLEMENTED is `check-status.mjs`'s job, and only for
 * tasks marked done. This gate is upstream of that: it asks whether the id is
 * real at all, which matters for every task including the ones not started.
 *
 * ── Strikethrough ───────────────────────────────────────────────────────────
 *
 * `~~struck-through~~` ids are ignored, matching the project's convention that
 * a superseded instruction is corrected in place with the old text retained,
 * struck through, and dead (`.github/copilot-instructions.md` §5). Without
 * that, recording a correction honestly would fail this gate — so the only
 * green path would be deleting the evidence, which is the opposite of what the
 * convention is for.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const BACKLOG = path.join(ROOT, 'docs', 'backlog.md');
export const TESTING_SPEC = path.join(ROOT, 'specs', 'testing.md');

const TEST_ID_RE = /T-[A-Z0-9]+-\d+[a-z]{0,2}/g;
const TASK_RE = /TASK-\d{3}/;

/** Drop `~~struck-through~~` spans. Non-greedy: see `check-status.mjs`. */
export const stripStruckThrough = (s) => s.replace(/~~.*?~~/g, '');

/**
 * `T-LIST-010a` → `T-LIST-010`. The spec names criteria; suites split cases.
 *
 * ⚠ `{1,2}`, matching `TEST_ID_RE`'s own `[a-z]{0,2}` bound. Stripping a
 * SINGLE letter silently mis-resolves every double-letter sub-id — `T-AI-041aa`
 * became `T-AI-041a`, which the spec does not define, so a correctly-cited
 * case was reported as a phantom citation while its single-letter siblings
 * passed. The two bounds must move together.
 */
export const baseId = (id) => id.replace(/[a-z]{1,2}$/, '');

/**
 * Every test id DEFINED by the testing spec, as base ids.
 *
 * ⚠ A definition is a table cell that names the test, not any mention of the
 * id. Counting mentions makes this gate self-defeating: the §11.2 entry
 * documenting that `T-BATCH-001`, `T-BATCH-002` and `T-API-004` were invented
 * ids that exist nowhere itself contains those ids, so writing down that a
 * phantom is a phantom silently promoted it to "defined" and removed it from
 * this report. Measured: three ids disappeared from the offender list the
 * moment the finding was recorded.
 *
 * A definition cell holds only ids and their markup — backticks, bold, `/`
 * separators, parenthesised notes like `(new, TASK-017)`. An Assertion cell or
 * a prose paragraph that happens to name an id is prose, and does not define
 * it.
 */
export function definedTestIds(specMarkdown) {
  const defined = new Set();
  for (const line of specMarkdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    for (const cell of line.split('|')) {
      if (!TEST_ID_RE.test(cell)) {
        TEST_ID_RE.lastIndex = 0;
        continue;
      }
      TEST_ID_RE.lastIndex = 0;
      const ids = cell.match(TEST_ID_RE) ?? [];
      const residue = cell
        .replace(TEST_ID_RE, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/[`*/,\s—-]/g, '');
      if (residue === '') for (const id of ids) defined.add(baseId(id));
    }
  }
  return defined;
}

/**
 * Every test id the backlog cites, mapped to the tasks citing it.
 *
 * Scans the whole row rather than the last column, for the reason given in
 * `check-status.mjs`: the backlog names ids in whichever column reads best.
 */
export function citedTestIds(backlogMarkdown) {
  const cited = new Map();
  for (const line of backlogMarkdown.split('\n')) {
    const task = line.match(TASK_RE);
    if (!task) continue;
    for (const id of stripStruckThrough(line).match(TEST_ID_RE) ?? []) {
      if (!cited.has(id)) cited.set(id, new Set());
      cited.get(id).add(task[0]);
    }
  }
  return cited;
}

/** @returns `[{ id, tasks }]` for every cited id the spec does not define. */
export function undefinedCitations(backlogMarkdown, specMarkdown) {
  const defined = definedTestIds(specMarkdown);
  return [...citedTestIds(backlogMarkdown)]
    .filter(([id]) => !defined.has(baseId(id)))
    .map(([id, tasks]) => ({ id, tasks: [...tasks].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
  const backlog = readFileSync(BACKLOG, 'utf8');
  const spec = readFileSync(TESTING_SPEC, 'utf8');
  const offenders = undefinedCitations(backlog, spec);

  if (offenders.length === 0) {
    const total = citedTestIds(backlog).size;
    console.log(
      `Backlog test-id check passed: all ${total} cited ids are defined in specs/testing.md.`,
    );
    return;
  }

  console.error('Backlog test-id check failed.\n');
  console.error(
    `${offenders.length} test id${offenders.length > 1 ? 's are' : ' is'} cited by ` +
      'docs/backlog.md but defined nowhere in specs/testing.md.\n' +
      'A task whose "Done when" names a test that does not exist has no\n' +
      'definition of done: the implementer will invent one and every gate\n' +
      'will pass against it (NFR-003).\n',
  );
  for (const { id, tasks } of offenders) {
    console.error(`  - ${id.padEnd(16)} cited by ${tasks.join(', ')}`);
  }
  console.error(
    '\nFix docs/backlog.md by naming the test that specs/testing.md §9 really\n' +
      'defines for that acceptance criterion. Correct the row IN PLACE and\n' +
      'leave the superseded id struck through — struck-through ids are ignored.\n' +
      'If the behaviour genuinely has no test yet, add it to specs/testing.md\n' +
      'first: the spec is the definition of done, not the backlog.',
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith('check-test-ids.mjs')) {
  main();
}
