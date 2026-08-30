/**
 * `T-META-006` — the orphan gate (`tools/check-orphan-tests.mjs`).
 *
 * The gate walks `specs/testing.md` → `docs/backlog.md`, the opposite
 * direction to `check-test-ids.mjs`. It asks whether every id the spec DEFINES
 * has someone who will build it, and the failure it catches is silent in every
 * other direction: an unowned acceptance criterion never fails a gate, never
 * blocks a task, and simply never gets implemented.
 *
 * These cases prove the gate discriminates, in both directions. A gate that
 * reported every id would "catch" the orphans and be useless; a gate that
 * reported none would be worse than useless, because the report is what the
 * ledger is trusted against.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BASELINE_ORPHANS,
  implementedTestIds,
  orphanedTestIds,
  resolvedBaselineIds,
} from '../../tools/check-orphan-tests.mjs';

const ROOT = path.resolve(__dirname, '..', '..');

/** A §9-shaped table defining one id against one acceptance criterion. */
const specDefining = (id: string): string =>
  [
    '| AC | L | Test | Assertion |',
    '| --- | --- | --- | --- |',
    `| AC-1 | I | \`${id}\` | it holds |`,
  ].join('\n');

/** A backlog-shaped row citing whatever ids it is given. */
const backlogCiting = (cited: string): string => `| TASK-900 | Something | S | — | ${cited} |`;

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'nextup-orphan-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Write a collected-looking suite naming `id`, so the gate sees it built. */
function plantSuite(id: string): void {
  const dir = path.join(scratch, 'test');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'planted.spec.ts'),
    `it('${id}a: planted', () => { expect(1).toBe(1); });\n`,
    'utf8',
  );
}

describe('T-META-006 — every defined test id is owned', () => {
  it('T-META-006a: the repository has no NEW unowned test id', () => {
    const backlog = readFileSync(path.join(ROOT, 'docs', 'backlog.md'), 'utf8');
    const spec = readFileSync(path.join(ROOT, 'specs', 'testing.md'), 'utf8');
    expect(orphanedTestIds(backlog, spec, ROOT)).toEqual([]);
  });

  it('T-META-006b: an id defined by the spec and cited by nobody is reported', () => {
    expect(
      orphanedTestIds(backlogCiting('`T-OTHER-001`'), specDefining('T-FAKE-001'), scratch),
    ).toEqual(['T-FAKE-001']);
  });

  it('T-META-006c: the same id is NOT reported once a task cites it', () => {
    // `006b` alone is satisfied by a gate that reports every defined id. This
    // is the discriminating half.
    expect(
      orphanedTestIds(backlogCiting('`T-FAKE-001`'), specDefining('T-FAKE-001'), scratch),
    ).toEqual([]);
  });

  it('T-META-006d: the same id is NOT reported once a suite implements it', () => {
    // The second arm of ownership. An implementer who adds a supplementary
    // case has demonstrably built it; failing that would be bookkeeping noise
    // loud enough to make the real report ignored.
    plantSuite('T-FAKE-001');
    expect(
      orphanedTestIds(backlogCiting('`T-OTHER-001`'), specDefining('T-FAKE-001'), scratch),
    ).toEqual([]);
  });

  it('T-META-006e: BASELINE_ORPHANS may only shrink', () => {
    // ⚠ The whole gate collapses if the baseline can absorb tomorrow's orphan:
    // "add it to the list" is always the cheapest way to make a failing gate
    // pass, and it reinstates exactly the silence the gate exists to break.
    //
    // ⚠ THIS ASSERTION IS EXACT, AND IT IS EXACT BECAUSE THE INEQUALITY FAILED
    // IN PRODUCTION. It used to read `toBeLessThanOrEqual(60)` — "60 is the
    // count measured when the gate was introduced". The baseline was then
    // worked down to 26 and the ceiling never followed it, leaving THIRTY-FOUR
    // free slots. A test named "may only shrink" permitted growth for as long
    // as that headroom lasted, and it was used: PR #134 added `T-UX-099` and
    // CI stayed green. A high-water mark is not a ratchet.
    //
    // So: pin it. Lowering this number is the work of assigning a criterion to
    // a task and is always welcome; raising it is never correct. An exact
    // match also fails when the set SHRINKS without this constant being
    // updated, which is deliberate — it is the same both-directions discipline
    // `KNOWN_UNMAPPED` and `KNOWN_PHANTOM_CITATIONS` use, and it is what stops
    // the bound drifting away from reality a second time.
    //
    // 21 → 30 in the same change that sharpened `implementedTestIds` to title
    // position. That is the ONE legitimate growth reason — a detector that got
    // stricter surfaces gaps that were always there — and the nine ids carry
    // their own justification at the point they are listed. Growth for any
    // other reason is the failure mode described above.
    expect(BASELINE_ORPHANS.size).toBe(30);
  });

  it('T-META-006f: a citation that is struck through does not count as ownership', () => {
    // The project corrects a superseded instruction in place and leaves the
    // old text struck through (copilot-instructions §5). A struck-through id
    // is DEAD — treating it as an owner would let a task disown a criterion
    // and still suppress the report.
    expect(
      orphanedTestIds(backlogCiting('~~`T-FAKE-001`~~'), specDefining('T-FAKE-001'), scratch),
    ).toEqual(['T-FAKE-001']);
  });

  it('T-META-006g: baseline ids that have become owned are reported as removable', () => {
    // The ratchet needs a way to tighten, and nobody will re-derive this by
    // hand. `resolvedBaselineIds` is what tells the next implementer which
    // entries are now dead weight.
    //
    // ⚠ The id is read from the set rather than written as a literal. This
    // began as a hard requirement: the walker used to credit ANY mention of an
    // id in a spec FILE, so naming a real baseline entry here would mark it
    // implemented — by this very test — and the live gate would report it as
    // removable when nothing had built it. Observed with a hard-coded undo
    // criterion; and then observed a SECOND time, because the comment
    // recording the first observation still named the id.
    //
    // The walker now counts only title position (`T-META-006i`), so a literal
    // here would no longer promote anything. The indirection stays anyway: it
    // costs nothing, it survives the predicate being loosened again, and the
    // failure it prevents is silent.
    const victim = [...BASELINE_ORPHANS][0] as string;
    plantSuite(victim);
    expect(
      resolvedBaselineIds(backlogCiting('`T-OTHER-001`'), specDefining('T-X-001'), scratch),
    ).toContain(victim);
  });

  it('T-META-006h: the suite walker only reads spec files', () => {
    // Non-vacuity for `006d`: if the walker read every file it would find ids
    // in the spec and the backlog themselves, and every orphan would look
    // implemented — the gate would report nothing, for ever, silently.
    const dir = path.join(scratch, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'notes.md'), 'T-FAKE-002 is mentioned here', 'utf8');
    writeFileSync(path.join(dir, 'impl.ts'), '// T-FAKE-003 in a source comment', 'utf8');
    expect(implementedTestIds(scratch).size).toBe(0);
  });

  it('T-META-006i: an id that only appears as a literal in a spec file is not credited', () => {
    // ⚠ THE DISCRIMINATING CASE FOR THE WHOLE OWNERSHIP NOTION, AND THE ONE
    // THAT WAS MISSING WHILE THE GATE REPORTED THE OPPOSITE OF THE TRUTH.
    //
    // Gates in this repo record their known gaps as arrays of id literals
    // inside `.spec.ts` files. Under a bare-occurrence walk, such a literal was
    // read as an implementation — so writing down "this id has no test" was
    // itself what made the id look tested, and four real gaps sat invisible
    // behind their own baseline entries.
    //
    // `006d` cannot catch this: it plants a genuine `it()` and both predicates
    // credit it. Only the negative half discriminates.
    const dir = path.join(scratch, 'test');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'baseline.spec.ts'),
      [
        "const KNOWN_GAPS = ['T-FAKE-001', 'T-FAKE-004'];",
        '// T-FAKE-005 is discussed in a comment, which is also not a test.',
        "it('T-FAKE-006: a real one', () => { expect(KNOWN_GAPS).toBeTruthy(); });",
      ].join('\n'),
      'utf8',
    );

    const implemented = implementedTestIds(scratch);
    expect([...implemented].sort()).toEqual(['T-FAKE-006']);

    // And the consequence that matters: a defined id recorded only as such a
    // literal is still reported as an orphan.
    expect(
      orphanedTestIds(backlogCiting('`T-OTHER-001`'), specDefining('T-FAKE-001'), scratch),
    ).toEqual(['T-FAKE-001']);
  });
});
