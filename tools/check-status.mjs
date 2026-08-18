/**
 * Task status ledger: the gate and the report generator (TASK-167, `T-STATUS-001`).
 *
 * NOTE: no `#!` shebang. This module is imported by `tests/infra/status.spec.ts`,
 * and a shebang — which Node tolerates when executing a file directly — is a
 * syntax error to the transformer that loads it as a module. It is invoked as
 * `node tools/check-status.mjs`, so the shebang bought nothing anyway.
 *
 * `docs/backlog.md` is the work order, but it records no status, so "what is
 * done?" has until now been answerable only from memory or from `git log`.
 *
 * Git log cannot answer it. Measured on this repository, three separate
 * failure modes were observed:
 *
 *   1. A task named in a commit BODY was counted as delivered — 5 of 21, a 24%
 *      false-done rate.
 *   2. `c3febc3` — "Promote current Azure SQL design into TASK-017 and
 *      TASK-047 primary text" — names two tasks in its SUBJECT that it did not
 *      implement. Subject-only parsing does not fix this.
 *   3. `TASK-013/014/015: …` yields only TASK-013 to a `TASK-\d{3}` scan, and
 *      TASK-001 landed inside the initial commit with no id in the subject at
 *      all. Work that IS done goes unseen.
 *
 * Git history is therefore evidence, not truth. Status is recorded explicitly
 * in the ledger (`docs/backlog.md` §1.2) and this gate falsifies false claims:
 * a task cannot be marked done while the tests named in its own "Done when"
 * column are absent from the suite, or while a task it depends on is unfinished.
 *
 * The ledger is ONE table with ONE row per task. It is not a column on the
 * task rows themselves because 50 tasks appear in two or three different
 * backlog tables (59 duplicate rows); a per-row column would give a single
 * task several status cells free to disagree with one another.
 *
 * CLI:
 *   node tools/check-status.mjs           rewrite docs/status.md
 *   node tools/check-status.mjs --check   exit 1 on any violation or on drift
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const BACKLOG_FILE = path.join(ROOT, 'docs', 'backlog.md');
export const STATUS_FILE = path.join(ROOT, 'docs', 'status.md');

/** The closed set of statuses. Anything else is a typo, and a typo must fail. */
export const STATUSES = Object.freeze(['todo', 'doing', 'done', 'owner', 'deferred']);

export const LEDGER_HEADING = '### 1.2 Task status ledger';
const LEDGER_START = '<!-- STATUS-LEDGER:START -->';
const LEDGER_END = '<!-- STATUS-LEDGER:END -->';

// Suffixed splits (`TASK-056b`, `056c`, `059b`, `079b`) are SEPARATE task
// units — §1 of the backlog says so explicitly and counts them separately.
// Without the `[a-z]?` this regex silently folded each split into its numeric
// parent, so `TASK-056`'s "Done when" set became the UNION of 056, 056b and
// 056c. The visible symptom is the wrong one: finishing 056 honestly is
// reported as a false claim, naming tests that belong to work nobody has
// started. The invisible symptom is worse — marking 056b done would have
// silently satisfied part of 056's gate.
const TASK_RE = /TASK-\d{3}[a-z]?/;
const TEST_ID_RE = /T-[A-Z0-9]+-\d+[a-z]?/g;

const norm = (s) => s.replace(/\r\n/g, '\n');

/**
 * Remove `~~struck-through~~` spans.
 *
 * Non-greedy and single-line by construction: a table row is one line, and a
 * greedy match would swallow everything between the FIRST and LAST `~~` on the
 * row, deleting the live correction that sits between two superseded ones.
 */
export const stripStruckThrough = (s) => s.replace(/~~.*?~~/g, '');

/**
 * Split a markdown table row into cells.
 *
 * ⚠ `\|` is an ESCAPED pipe, not a column separator. Splitting on it silently
 * widens the row, which made `shaped` false, which discarded the row's Size
 * and Depends-on cells — and a task with no recorded dependencies is reported
 * READY. That is fail-open in the one direction that matters: `docs/status.md`
 * is what tells an agent which work is unblocked, and TASK-166 (which depends
 * on two unfinished tasks and wires a route that does not exist yet) was being
 * advertised as ready to start because its description contains
 * `` `desc`/newest-first default \| `asc` ``.
 */
const cells = (line) =>
  line
    // A negative lookbehind, so an escaped `\|` is not a separator. (The
    // earlier version substituted a sentinel character, which tripped
    // `no-control-regex`; this needs no sentinel and no round trip.)
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim());

/**
 * Parse every task table in the backlog.
 *
 * Two robustness rules, both driven by what the file actually contains:
 *
 *  - Nine rows carry MORE cells than their header because a description
 *    embeds an unescaped `|` inside a code span. The first cell (Task) and the
 *    last cell ("Done when") are still correct in those rows, because the
 *    corruption is in the middle — so those two are read positionally from the
 *    ends, and Size/Depends are trusted only when the row shape matches.
 *  - A task appearing in several tables is MERGED rather than treated as a
 *    conflict: the union of its test ids, and dependencies from whichever row
 *    is well formed. Otherwise the summary tables, which omit "Depends on",
 *    would erase the dependency graph recorded in the epic tables.
 */
export function parseBacklog(markdown) {
  const lines = norm(markdown).split('\n');
  const tasks = new Map();
  let header = null;
  let section = '(unfiled)';
  let inLedger = false;

  for (const line of lines) {
    if (line.includes(LEDGER_START)) inLedger = true;
    if (line.includes(LEDGER_END)) inLedger = false;
    if (inLedger) continue;

    if (/^#{2,3}\s/.test(line)) {
      section = line.replace(/^#+\s*/, '').trim();
      header = null;
      continue;
    }
    if (/^\|\s*Task\s*\|/i.test(line)) {
      header = cells(line).map((c) => c.toLowerCase());
      continue;
    }
    if (!/^\|\s*\*?\*?TASK-\d{3}/.test(line)) continue;

    const row = cells(line);
    const id = (row[0].match(TASK_RE) || [])[0];
    if (!id) continue;

    const shaped = header !== null && row.length === header.length;
    const at = (name) => {
      if (!shaped) return '';
      const i = header.findIndex((h) => h.startsWith(name));
      return i === -1 ? '' : row[i];
    };

    const existing = tasks.get(id) ?? {
      id,
      section,
      size: '',
      deps: [],
      depsKnown: false,
      testIds: [],
      rows: 0,
    };
    existing.rows += 1;
    if (!existing.size && at('size'))
      existing.size = at('size').replace(/\*/g, '').split('(')[0].trim();
    if (!existing.depsKnown && at('depends')) {
      existing.deps = [...at('depends').matchAll(/(\d{3})/g)].map((m) => `TASK-${m[1]}`);
      existing.depsKnown = true;
    }
    // Test ids are collected from the WHOLE row, not just the "Done when"
    // column. The backlog names them in whichever column reads best —
    // TASK-144 states `T-MIG-001` in its description and leaves "Done when" as
    // prose — so reading one column only would leave a third of the tasks with
    // nothing to verify. Scanning the row cannot produce a false failure: a row
    // that mentions a test for contrast still mentions a test that must exist,
    // and a reference to a test id that exists nowhere in the suite is itself
    // the defect (it is how `T-UI-023` and `T-LICENSE-001` were both found
    // undefined).
    //
    // ⚠ EXCEPT inside `~~strikethrough~~`. This project's editing convention
    // is that an instruction is corrected IN PLACE with the superseded version
    // retained below it, struck through, and that struck-through text is DEAD
    // (see `.github/copilot-instructions.md` §5). Reading ids out of it makes
    // the gate demand a test that the correction just finished explaining does
    // not and should not exist — so recording the correction honestly would be
    // punished, and the only way to a green gate would be to delete the
    // history. Stripping it here is what makes the two rules agree.
    for (const m of stripStruckThrough(line).matchAll(TEST_ID_RE)) {
      if (!existing.testIds.includes(m[0])) existing.testIds.push(m[0]);
    }
    tasks.set(id, existing);
  }

  for (const task of tasks.values()) {
    task.deps = task.deps.filter((d) => d !== task.id && tasks.has(d));
    task.testIds.sort();
  }
  return tasks;
}

/** Parse the ledger rows between the two marker comments. */
export function parseLedger(markdown) {
  const text = norm(markdown);
  const start = text.indexOf(LEDGER_START);
  const end = text.indexOf(LEDGER_END);
  if (start === -1 || end === -1) return null;

  const entries = new Map();
  for (const line of text.slice(start, end).split('\n')) {
    if (!/^\|\s*`?TASK-\d{3}/.test(line)) continue;
    const row = cells(line);
    const id = (row[0].match(TASK_RE) || [])[0];
    if (!id) continue;
    entries.set(id, {
      id,
      status: (row[1] ?? '').replace(/`/g, '').trim().toLowerCase(),
      evidence: (row[2] ?? '').trim(),
    });
  }
  return entries;
}

/**
 * Every test id that is actually DECLARED by a test case in the suite.
 *
 * Scanning whole files for the id pattern is not good enough, and this was
 * caught by mutation rather than by reading: marking `TASK-017` done sailed
 * through, because both ids it names — `T-INV-001` and `T-SEC-021` — appear in
 * the repository without either being a test. `T-SEC-021` occurs in a comment;
 * `T-INV-001` occurs inside a STRING LITERAL in `tools/eslint-rules/
 * test-id-naming.spec.ts`, which holds sample test declarations as fixtures for
 * the naming rule. A gate that counts a mention in a comment as a delivered
 * test is the precise thing this gate exists to prevent.
 *
 * So ids are read only from test declarations, identified by the declaration
 * starting its own line. That distinction is exactly right for this repository:
 * a real test is written at the start of a (possibly indented) line, while every
 * fixture is embedded inside a quoted string and is therefore preceded on its
 * line by the opening quote. It also keeps `it.each(CASES)('T-DM-001 · …')` and
 * modifiers such as `it.skip` / `it.concurrent`, which the naming rule
 * (`T-META-004`) explicitly supports.
 *
 * `describe` counts as well as `it`. `T-META-004` itself is the reason: its
 * cases are generated at runtime by ESLint's `RuleTester`, so the id can only
 * live on the enclosing `describe`. Excluding `describe` reported the naming
 * rule — a delivered, passing test — as missing.
 */
/**
 * Every test id MENTIONED anywhere in a spec file, including in comments and
 * inside string literals.
 *
 * This is the deliberate opposite of `collectDefinedTestIds`, and it exists so
 * that T-STATUS-001p can prove its probe ids are genuinely *mentioned but not
 * declared*. Without it, that case could silently degenerate into asserting
 * that two ids nobody has ever written down are absent — which is true of any
 * random string and therefore proves nothing.
 */
export function mentionedTestIds(root = ROOT) {
  const ids = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (
        [
          'node_modules',
          '.git',
          'dist',
          'build',
          'coverage',
          'playwright-report',
          'test-results',
        ].includes(entry)
      ) {
        continue;
      }
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(spec|test)\.[cm]?[tj]sx?$/.test(entry)) {
        for (const m of readFileSync(full, 'utf8').matchAll(/T-[A-Z0-9]+-\d+[a-z]?/g))
          ids.add(m[0]);
      }
    }
  };
  walk(root);
  return ids;
}

export function collectDefinedTestIds(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (
        [
          'node_modules',
          '.git',
          'dist',
          'build',
          'coverage',
          'playwright-report',
          'test-results',
        ].includes(entry)
      ) {
        continue;
      }
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(spec|test)\.[cm]?[tj]sx?$/.test(entry)) files.push(full);
    }
  };
  walk(root);

  const ids = new Set();
  for (const file of files) {
    for (const line of norm(readFileSync(file, 'utf8')).split('\n')) {
      if (!/^[ \t]*(?:it|test|describe)\b/.test(line)) continue;
      const found = line.match(/T-[A-Z0-9]+-\d+[a-z]?/);
      if (found) ids.add(found[0]);
    }
  }
  return ids;
}

/**
 * Is a test id named by the backlog present in the suite?
 *
 * The backlog names an acceptance criterion, `T-UI-023`; the suite is allowed to
 * split it into lettered cases, `T-UI-023a` … `T-UI-023g`. The naming rule
 * (`T-META-004`, `tools/eslint-rules/test-id-naming.js`) states this directly:
 * "a lowercase suffix distinguishes several cases for ONE acceptance criterion
 * … suffixed variants are distinct ids". Nine of this repository's fifteen
 * delivered tasks name a base id and implement it as lettered cases, so an
 * exact-match rule would report all nine as unfinished.
 *
 * The leniency runs one way only. A base id is satisfied by any of its
 * variants, but an id the backlog states WITH a suffix must be present exactly:
 * when the spec pins down a specific case, a different case is not it.
 */
export function isTestIdPresent(testId, definedTestIds) {
  if (definedTestIds.has(testId)) return true;
  if (/[a-z]$/.test(testId)) return false;
  for (const defined of definedTestIds) {
    // The extra character must be a LETTER. Checking length alone made
    // `T-UI-023` look like a variant of `T-UI-02`, so an id whose trailing
    // digit was mistyped would silently resolve to a different criterion.
    if (
      defined.length === testId.length + 1 &&
      defined.startsWith(testId) &&
      /[a-z]$/.test(defined)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validate the ledger against the backlog and the test suite.
 * Returns a list of human-readable findings; empty means clean.
 */
export function checkStatus(tasks, ledger, definedTestIds) {
  const findings = [];
  if (ledger === null) {
    return [
      `The status ledger markers are missing from docs/backlog.md. Expected ${LEDGER_START}.`,
    ];
  }

  for (const id of tasks.keys()) {
    if (!ledger.has(id))
      findings.push(`${id} is in the backlog but has no row in the status ledger.`);
  }
  for (const id of ledger.keys()) {
    if (!tasks.has(id))
      findings.push(`${id} is in the status ledger but no such task exists in the backlog.`);
  }

  // An unreadable row is a defect in the backlog, not something to route
  // around. It silently strips the task's dependencies, and a task with no
  // recorded dependencies is reported ready to start — so this must be loud.
  // The usual cause is an unescaped `|` inside a code span; write `\|`.
  for (const id of unparsedDependencyTasks(tasks)) {
    findings.push(
      `${id}: its table row could not be parsed, so its dependencies are unknown. ` +
        'This is almost always an unescaped `|` inside a code span — write `\\|`.',
    );
  }

  for (const entry of ledger.values()) {
    const task = tasks.get(entry.id);
    if (!task) continue;

    if (!STATUSES.includes(entry.status)) {
      findings.push(
        `${entry.id} has status "${entry.status}", which is not one of: ${STATUSES.join(', ')}.`,
      );
      continue;
    }
    if (entry.status !== 'done') continue;

    if (!entry.evidence) {
      findings.push(
        `${entry.id} is marked done with no evidence. Record the commit that delivered it.`,
      );
    }

    // The anti-TASK-017 rule: the backlog states the tests that define done for
    // this task, so done is not claimable while they are absent from the suite.
    const missing = task.testIds.filter((testId) => !isTestIdPresent(testId, definedTestIds));
    if (missing.length > 0) {
      findings.push(
        `${entry.id} is marked done but its "Done when" test${missing.length > 1 ? 's are' : ' is'} ` +
          `not in the suite: ${missing.join(', ')}.`,
      );
    }

    // A task cannot have been completed before something it is built on top of.
    //
    // The one legitimate exception is work deliberately delivered ahead of a
    // dependency, which happened at TASK-153: the licence gate was built and
    // proven against synthetic fixtures before TASK-147 installs the codec it
    // governs. The escape hatch is deliberately narrow — the evidence cell must
    // name the exact task being jumped, as `ahead-of:TASK-147`. A blanket
    // "ignore ordering" flag would be used to paper over real sequencing
    // mistakes; naming the task keeps each exception auditable and greppable,
    // and a stale one fails as soon as the named task is finished.
    const acknowledged = new Set(
      [...entry.evidence.matchAll(/ahead-of:\s*(TASK-\d{3})/g)].map((m) => m[1]),
    );
    const unfinished = task.deps.filter(
      (dep) => ledger.get(dep)?.status !== 'done' && !acknowledged.has(dep),
    );
    if (unfinished.length > 0) {
      findings.push(
        `${entry.id} is marked done but depends on unfinished ${unfinished.join(', ')}. ` +
          `If that is deliberate, record it as "ahead-of:${unfinished[0]}" in the evidence cell.`,
      );
    }
    for (const dep of acknowledged) {
      if (!task.deps.includes(dep)) {
        findings.push(
          `${entry.id} declares ahead-of:${dep}, but ${dep} is not one of its dependencies.`,
        );
      } else if (ledger.get(dep)?.status === 'done') {
        findings.push(
          `${entry.id} still declares ahead-of:${dep}, but ${dep} is now done. Remove it.`,
        );
      }
    }
  }

  return findings;
}

/** Tasks that are not done and whose dependencies are all done. */
export function readyTasks(tasks, ledger) {
  return (
    [...tasks.values()]
      .filter((task) => {
        const status = ledger.get(task.id)?.status;
        return status === 'todo' || status === 'doing';
      })
      // ⚠ Fail CLOSED on an unparsed dependency cell. A task whose row shape the
      // parser could not read has UNKNOWN dependencies, not zero of them, and
      // `.every()` over an empty list is vacuously true — so the two are
      // indistinguishable here and the task is advertised as ready to start.
      // That is the wrong direction for this report: `docs/status.md` is what
      // tells an agent what is unblocked. Measured, before the `\|` escape fix:
      // TASK-149 (blocked on the unfinished TASK-148) and TASK-166 (blocked on
      // two unfinished tasks, wiring a route that does not exist) were both
      // listed as ready.
      .filter((task) => task.depsKnown)
      .filter((task) => task.deps.every((dep) => ledger.get(dep)?.status === 'done'))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

/** Tasks whose dependency cell could not be read. Never silently empty. */
export function unparsedDependencyTasks(tasks) {
  return [...tasks.values()]
    .filter((task) => !task.depsKnown)
    .map((task) => task.id)
    .sort();
}

const BADGE = {
  done: '✅ done',
  doing: '🚧 doing',
  todo: '⬜ todo',
  owner: '🙋 owner',
  deferred: '💤 deferred',
};

export function renderLedger(tasks, ledger) {
  const rows = [...tasks.keys()].sort().map((id) => {
    const entry = ledger?.get(id) ?? { status: 'todo', evidence: '' };
    return `| \`${id}\` | \`${entry.status}\` | ${entry.evidence || '—'} |`;
  });
  return ['| Task | Status | Evidence |', '|---|---|---|', ...rows].join('\n');
}

/** The generated report. Deterministic: no dates, no counts of anything unsorted. */
export function renderStatus(tasks, ledger) {
  const all = [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id));
  const by = (status) => all.filter((t) => ledger.get(t.id)?.status === status);
  const ready = readyTasks(tasks, ledger);
  const readySet = new Set(ready.map((t) => t.id));

  const out = [];
  out.push('# Task status');
  out.push('');
  out.push('**Generated by `npm run status` from `docs/backlog.md` §1.2. Do not edit by hand.**');
  out.push('');
  out.push('Status is recorded in the ledger and verified by `npm run check:status`, which');
  out.push('fails the build if a task is marked `done` while the tests named in its own');
  out.push('"Done when" column are absent from the suite, or while a task it depends on is');
  out.push('unfinished. See `specs/testing.md` §9A (`T-STATUS-001`).');
  out.push('');
  out.push('## Totals');
  out.push('');
  out.push('| Status | Count |');
  out.push('|---|---|');
  for (const status of STATUSES) out.push(`| ${BADGE[status]} | ${by(status).length} |`);
  out.push(`| **total** | **${all.length}** |`);
  out.push('');
  out.push('## Ready to start');
  out.push('');
  out.push('Not done, and every task they depend on is done.');
  out.push('');
  if (ready.length === 0) {
    out.push('_Nothing is ready: every unfinished task is waiting on a dependency._');
  } else {
    out.push('| Task | Size | Section |');
    out.push('|---|---|---|');
    for (const task of ready)
      out.push(`| \`${task.id}\` | ${task.size || '—'} | ${task.section} |`);
  }
  out.push('');
  out.push('## Waiting on the owner');
  out.push('');
  const owner = by('owner');
  if (owner.length === 0) {
    out.push('_Nothing is waiting on a decision._');
  } else {
    out.push('| Task | Section | Note |');
    out.push('|---|---|---|');
    for (const task of owner) {
      out.push(`| \`${task.id}\` | ${task.section} | ${ledger.get(task.id)?.evidence || '—'} |`);
    }
  }
  out.push('');
  out.push('## Blocked by a dependency');
  out.push('');
  const blocked = all.filter(
    (t) => ['todo', 'doing'].includes(ledger.get(t.id)?.status) && !readySet.has(t.id),
  );
  out.push(`${blocked.length} task${blocked.length === 1 ? '' : 's'} cannot start yet.`);
  out.push('');
  if (blocked.length > 0) {
    out.push('| Task | Waiting on |');
    out.push('|---|---|');
    for (const task of blocked) {
      const on = task.deps.filter((d) => ledger.get(d)?.status !== 'done');
      out.push(`| \`${task.id}\` | ${on.map((d) => `\`${d}\``).join(', ') || '—'} |`);
    }
  }
  out.push('');
  out.push('## Done');
  out.push('');
  const done = by('done');
  out.push('| Task | Evidence | Verified by |');
  out.push('|---|---|---|');
  for (const task of done) {
    const ids =
      task.testIds.length > 0
        ? task.testIds.map((i) => `\`${i}\``).join(', ')
        : '_no test id declared_';
    out.push(`| \`${task.id}\` | ${ledger.get(task.id)?.evidence || '—'} | ${ids} |`);
  }
  out.push('');
  return out.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const backlog = readFileSync(BACKLOG_FILE, 'utf8');
  const tasks = parseBacklog(backlog);
  const ledger = parseLedger(backlog);
  const findings = checkStatus(tasks, ledger, collectDefinedTestIds());

  if (findings.length > 0) {
    console.error('Task status check failed:\n');
    for (const finding of findings) console.error(`  - ${finding}`);
    console.error('\nFix docs/backlog.md §1.2, or finish the work it claims is finished.');
    process.exit(1);
  }

  const expected = renderStatus(tasks, ledger);
  if (!check) {
    writeFileSync(STATUS_FILE, expected);
    console.error(`Wrote docs/status.md (${tasks.size} tasks).`);
    return;
  }

  let committed;
  try {
    committed = readFileSync(STATUS_FILE, 'utf8');
  } catch {
    // A missing report is drift, not a crash: `npm run status` creates it.
    committed = '';
  }
  if (norm(committed) !== norm(expected)) {
    console.error('Task status check failed:\n');
    console.error('  - docs/status.md is out of date. Run `npm run status` and commit the result.');
    process.exit(1);
  }
  console.error(`Task status check passed: ${tasks.size} tasks, ledger consistent.`);
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  main();
}
