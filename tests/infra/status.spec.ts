/**
 * The task status ledger and its gate (TASK-167, `T-STATUS-001`).
 *
 * Defined in `specs/testing.md` §9A. As with `T-SEC-009` and `T-LICENSE-001`,
 * these assert **the gate works**, not merely that the ledger is currently
 * consistent — a checker that returns "no findings" unconditionally passes a
 * clean repository, and this one exists precisely to catch a claim that is not
 * true yet.
 *
 * The rules are therefore driven through constructed backlogs and ledgers, so
 * each one is proven to FAIL on the input it is meant to reject. A ledger that
 * cannot be caught lying is a comment.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BACKLOG_FILE,
  STATUSES,
  checkStatus,
  collectDefinedTestIds,
  mentionedTestIds,
  isTestIdPresent,
  parseBacklog,
  parseLedger,
  readyTasks,
  renderStatus,
  stripStruckThrough,
  unparsedDependencyTasks,
} from '../../tools/check-status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** A minimal backlog: TASK-900 depends on nothing, TASK-901 depends on TASK-900. */
const BACKLOG = [
  '## Epic Z — synthetic',
  '',
  '| Task | Description | Size | Depends on | Done when |',
  '|---|---|---|---|---|',
  '| TASK-900 | first | S | — | `T-FAKE-001` |',
  '| TASK-901 | second | S | 900 | `T-FAKE-002` |',
  '',
].join('\n');

const ledgerOf = (rows: string[]) =>
  parseLedger(
    [
      '<!-- STATUS-LEDGER:START -->',
      '| Task | Status | Evidence |',
      '|---|---|---|',
      ...rows,
      '<!-- STATUS-LEDGER:END -->',
    ].join('\n'),
  );

const BOTH_TESTS = new Set(['T-FAKE-001', 'T-FAKE-002']);

describe('T-STATUS-001 · the task status ledger and its gate', () => {
  it('T-STATUS-001a · the real backlog parses into tasks with a dependency graph', () => {
    const tasks = parseBacklog(read('docs/backlog.md'));
    expect(tasks.size).toBeGreaterThan(100);
    expect([...tasks.values()].some((t) => t.deps.length > 0)).toBe(true);
    // 50 tasks are listed in more than one table; they must merge to one entry.
    expect([...tasks.values()].some((t) => t.rows > 1)).toBe(true);
  });

  it('T-STATUS-001b · the committed ledger and backlog agree, and every done claim holds', () => {
    const backlog = read('docs/backlog.md');
    const findings = checkStatus(
      parseBacklog(backlog),
      parseLedger(backlog),
      collectDefinedTestIds(),
    );
    expect(findings).toEqual([]);
  });

  it('T-STATUS-001c · a backlog task missing from the ledger is caught', () => {
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf(['| `TASK-900` | `done` | `abc1234` |']),
      BOTH_TESTS,
    );
    expect(findings.join('\n')).toContain('TASK-901');
    expect(findings.join('\n')).toContain('no row in the status ledger');
  });

  it('T-STATUS-001d · a ledger row for a task that does not exist is caught', () => {
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf([
        '| `TASK-900` | `todo` | — |',
        '| `TASK-901` | `todo` | — |',
        '| `TASK-999` | `done` | `abc1234` |',
      ]),
      BOTH_TESTS,
    );
    expect(findings.join('\n')).toContain('TASK-999');
  });

  it('T-STATUS-001e · a status outside the closed set is caught', () => {
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf(['| `TASK-900` | `finished` | `abc1234` |', '| `TASK-901` | `todo` | — |']),
      BOTH_TESTS,
    );
    expect(findings.join('\n')).toContain('not one of');
    expect(STATUSES).not.toContain('finished');
  });

  it('T-STATUS-001f · done is REFUSED when the task\u2019s named test is absent from the suite', () => {
    // The anti-TASK-017 rule, and the whole point of the gate. `c3febc3` named
    // TASK-017 in its subject while only editing spec text; nothing but the
    // absence of `T-SEC-021` distinguishes that from delivery.
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf(['| `TASK-900` | `done` | `abc1234` |', '| `TASK-901` | `todo` | — |']),
      new Set<string>(),
    );
    expect(findings.join('\n')).toContain('T-FAKE-001');
    expect(findings.join('\n')).toContain('not in the suite');
  });

  it('T-STATUS-001g · done is ACCEPTED when the named test exists', () => {
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf(['| `TASK-900` | `done` | `abc1234` |', '| `TASK-901` | `todo` | — |']),
      BOTH_TESTS,
    );
    expect(findings).toEqual([]);
  });

  it('T-STATUS-001h · done with no evidence is caught', () => {
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf(['| `TASK-900` | `done` |  |', '| `TASK-901` | `todo` | — |']),
      BOTH_TESTS,
    );
    expect(findings.join('\n')).toContain('no evidence');
  });

  it('T-STATUS-001i · a task done before its dependency is caught', () => {
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf(['| `TASK-900` | `todo` | — |', '| `TASK-901` | `done` | `abc1234` |']),
      BOTH_TESTS,
    );
    expect(findings.join('\n')).toContain('depends on unfinished TASK-900');
  });

  it('T-STATUS-001j · an explicit ahead-of token clears that one dependency', () => {
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf([
        '| `TASK-900` | `todo` | — |',
        '| `TASK-901` | `done` | `abc1234` ahead-of:TASK-900 |',
      ]),
      BOTH_TESTS,
    );
    expect(findings).toEqual([]);
  });

  it('T-STATUS-001k · an ahead-of token naming a non-dependency is caught', () => {
    // Otherwise the token degenerates into a blanket "ignore ordering" flag.
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf([
        '| `TASK-900` | `done` | `abc1234` ahead-of:TASK-901 |',
        '| `TASK-901` | `todo` | — |',
      ]),
      BOTH_TESTS,
    );
    expect(findings.join('\n')).toContain('not one of its dependencies');
  });

  it('T-STATUS-001l · a stale ahead-of token is caught once the dependency lands', () => {
    // An exception must not outlive its reason, or it silently disables the
    // ordering rule for that task forever.
    const findings = checkStatus(
      parseBacklog(BACKLOG),
      ledgerOf([
        '| `TASK-900` | `done` | `abc1234` |',
        '| `TASK-901` | `done` | `def5678` ahead-of:TASK-900 |',
      ]),
      BOTH_TESTS,
    );
    expect(findings.join('\n')).toContain('is now done. Remove it.');
  });

  it('T-STATUS-001m · ready excludes tasks whose dependencies are unfinished', () => {
    const tasks = parseBacklog(BACKLOG);
    const blocked = readyTasks(
      tasks,
      ledgerOf(['| `TASK-900` | `todo` | — |', '| `TASK-901` | `todo` | — |'])!,
    );
    expect(blocked.map((t) => t.id)).toEqual(['TASK-900']);

    const unblocked = readyTasks(
      tasks,
      ledgerOf(['| `TASK-900` | `done` | `abc1234` |', '| `TASK-901` | `todo` | — |'])!,
    );
    expect(unblocked.map((t) => t.id)).toEqual(['TASK-901']);
  });

  it('T-STATUS-001r · an escaped pipe in a description does not destroy the dependency graph', () => {
    // The real defect this caught. `\|` is an escaped pipe, not a column
    // separator; splitting on it widened the row, which discarded the Size and
    // Depends-on cells, which left the task with NO recorded dependencies —
    // and a task with no dependencies is reported ready to start. TASK-166
    // (blocked on two unfinished tasks) and TASK-149 (blocked on TASK-148)
    // were both advertised as ready in the committed `docs/status.md`.
    const escaped = [
      '## Epic Z — synthetic',
      '',
      '| Task | Description | Size | Depends on | Done when |',
      '|---|---|---|---|---|',
      '| TASK-900 | first | S | — | `T-FAKE-001` |',
      '| TASK-902 | wires `desc`/newest-first \\| `asc`/oldest-first | S | 900 | `T-FAKE-003` |',
      '',
    ].join('\n');

    const tasks = parseBacklog(escaped);
    expect(tasks.get('TASK-902')?.deps).toEqual(['TASK-900']);
    expect(tasks.get('TASK-902')?.size).toBe('S');

    const ready = readyTasks(
      tasks,
      ledgerOf(['| `TASK-900` | `todo` | — |', '| `TASK-902` | `todo` | — |'])!,
    );
    expect(ready.map((t) => t.id)).toEqual(['TASK-900']);
  });

  it('T-STATUS-001s · an unreadable row is reported, never treated as dependency-free', () => {
    // Fail closed. An unparsed row has UNKNOWN dependencies, not zero of them,
    // and `.every()` over an empty list is vacuously true — so without this the
    // two are indistinguishable and the task is advertised as ready.
    const broken = [
      '## Epic Z — synthetic',
      '',
      '| Task | Description | Size | Depends on | Done when |',
      '|---|---|---|---|---|',
      '| TASK-900 | first | S | — | `T-FAKE-001` |',
      '| TASK-903 | uses `a || b` unescaped | S | 900 | `T-FAKE-004` |',
      '',
    ].join('\n');

    const tasks = parseBacklog(broken);
    expect(unparsedDependencyTasks(tasks)).toEqual(['TASK-903']);

    const ledger = ledgerOf(['| `TASK-900` | `todo` | — |', '| `TASK-903` | `todo` | — |'])!;
    expect(readyTasks(tasks, ledger).map((t) => t.id)).toEqual(['TASK-900']);

    const findings = checkStatus(tasks, ledger, new Set(['T-FAKE-001', 'T-FAKE-004']));
    expect(findings.join('\n')).toContain('TASK-903');
  });

  it('T-STATUS-001t · the committed backlog has no unreadable rows', () => {
    expect(unparsedDependencyTasks(parseBacklog(read('docs/backlog.md')))).toEqual([]);
  });

  it('T-STATUS-001n · the report is deterministic and matches the committed file', () => {
    // The drift check compares bytes, so an embedded date or an unstable sort
    // would make CI fail at random and get switched off.
    const backlog = read('docs/backlog.md');
    const tasks = parseBacklog(backlog);
    const ledger = parseLedger(backlog)!;
    const once = renderStatus(tasks, ledger);
    expect(renderStatus(tasks, ledger)).toBe(once);
    expect(read('docs/status.md').replace(/\r\n/g, '\n')).toBe(once.replace(/\r\n/g, '\n'));
  });

  it('T-STATUS-001p · a test id mentioned in a comment or a fixture does NOT count as delivered', () => {
    // Found by mutation, not by reading. The first version of this gate scanned
    // whole files for the id pattern, so marking TASK-017 done sailed straight
    // through on ids that appeared only inside a comment or inside a STRING
    // LITERAL in tools/eslint-rules/test-id-naming.spec.ts, where sample test
    // declarations are fixtures for the naming rule. Counting either as a
    // delivered test turns this gate into decoration.
    //
    // ⚠ The probe ids below MUST be ones that are mentioned but NOT yet
    // implemented. They were originally `T-SEC-021` and `T-INV-001`; TASK-017
    // then genuinely delivered both, and this case failed — correctly, because
    // the ids stopped being examples of the thing under test. `T-REV-006`
    // replaced one of them and was in turn delivered by TASK-065, so it has
    // been moved on again, to `T-PASTE-010` (TASK-164, unbuilt). If it fails
    // that way again, the fix is to move the probe to another undelivered id,
    // NEVER to relax the assertion.
    const defined = collectDefinedTestIds();

    // Both appear as fixtures in tools/eslint-rules/test-id-naming.spec.ts.
    for (const probe of ['T-SUP-003', 'T-PASTE-010']) {
      expect(
        mentionedTestIds().has(probe),
        `${probe} is no longer mentioned anywhere, so it cannot probe anything`,
      ).toBe(true);
      expect(defined.has(probe), `${probe} is now implemented; pick another probe id`).toBe(false);
    }

    // …while genuinely declared tests, including this one, are found.
    expect(defined.has('T-STATUS-001p')).toBe(true);
    expect(defined.has('T-UI-023a')).toBe(true);
    // `T-META-004` sits on a describe() because ESLint's RuleTester generates
    // its cases at runtime; excluding describe reported it as missing.
    expect(defined.has('T-META-004')).toBe(true);
  });

  it('T-STATUS-001q · a base id is satisfied by its lettered variants, but not the reverse', () => {
    // The backlog names an acceptance criterion (`T-UI-023`); the suite may
    // split it into cases (`T-UI-023a`…`g`), which `T-META-004` expressly
    // allows. Nine of the fifteen delivered tasks are shaped this way, so exact
    // matching would report all nine as unfinished. The leniency is one-way: an
    // id the backlog pins to a specific case must be present as that case.
    const defined = new Set(['T-UI-023a', 'T-UI-023b']);
    expect(isTestIdPresent('T-UI-023', defined)).toBe(true);
    expect(isTestIdPresent('T-UI-023c', defined)).toBe(false);
    expect(isTestIdPresent('T-UI-024', defined)).toBe(false);
    // A longer id that merely starts with the same text is not a variant.
    expect(isTestIdPresent('T-UI-02', new Set(['T-UI-023']))).toBe(false);
  });

  it('T-STATUS-001o · the ledger covers every task and the backlog file is the source', () => {
    const backlog = read('docs/backlog.md');
    const tasks = parseBacklog(backlog);
    const ledger = parseLedger(backlog);
    expect(ledger).not.toBeNull();
    expect([...ledger!.keys()].sort()).toEqual([...tasks.keys()].sort());
    expect(BACKLOG_FILE.endsWith(path.join('docs', 'backlog.md'))).toBe(true);
  });

  it('T-STATUS-001u · a struck-through test id is dead and is not required', () => {
    // The project's editing convention corrects an instruction IN PLACE and
    // retains the superseded version below it, struck through, where it is
    // DEAD (`.github/copilot-instructions.md` §5). Before this, the gate read
    // ids out of struck-through text and demanded a test that the correction
    // had just finished explaining does not exist — so recording a correction
    // honestly failed CI, and the only green path was deleting the history.
    const row =
      '| TASK-999 | does a thing | S | 001 | `T-REAL-010` ' +
      'corrected in place ~~`T-PHANTOM-001`~~ |';
    const tasks = parseBacklog(`## Tasks\n\n${row}\n`);

    expect(tasks.get('TASK-999')?.testIds).toEqual(['T-REAL-010']);
  });

  it('T-STATUS-001v · stripping strikethrough does not swallow live text', () => {
    // The negative control for the non-greedy match. A greedy `~~.*~~` would
    // delete everything between the FIRST and LAST marker on the row, taking
    // the live id in the middle with it — a gate that quietly stops checking.
    expect(stripStruckThrough('~~`T-OLD-001`~~ `T-LIVE-010` ~~`T-OLD-002`~~').trim()).toBe(
      '`T-LIVE-010`',
    );
    expect(stripStruckThrough('`T-LIVE-011`')).toBe('`T-LIVE-011`');
  });
});
