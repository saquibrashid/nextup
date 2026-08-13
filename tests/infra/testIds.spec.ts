/**
 * `T-META-005` — the backlog cites only test ids that `specs/testing.md`
 * actually defines.
 *
 * The gate this covers exists because the failure it catches is invisible:
 * a task whose "Done when" names a nonexistent test still looks complete.
 * The implementer reads a plausible id, writes a test under that name, and
 * every other gate goes green against an assertion nobody specified.
 *
 * Both directions matter here, so both are asserted: a phantom id must FAIL
 * (`T-META-005c`) and a real one must PASS (`T-META-005b`). A gate that only
 * ever returns "no offenders" is indistinguishable from one that works.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BACKLOG,
  TESTING_SPEC,
  baseId,
  citedTestIds,
  definedTestIds,
  stripStruckThrough,
  undefinedCitations,
} from '../../tools/check-test-ids.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const read = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8');

describe('T-META-005 every test id the backlog cites is defined in the testing spec', () => {
  it('T-META-005a: the real backlog cites no undefined test id', () => {
    const offenders = undefinedCitations(read('docs/backlog.md'), read('specs/testing.md'));
    expect(offenders.map((o) => `${o.id} (${o.tasks.join(', ')})`)).toEqual([]);
  });

  it('T-META-005b: a backlog citing only defined ids passes', () => {
    const backlog = '| TASK-001 | does a thing | S | — | `T-LIST-010` |';
    const spec = '| AC-1 | I | `T-LIST-010` | Exactly one row per canonical work |';
    expect(undefinedCitations(backlog, spec)).toEqual([]);
  });

  it('T-META-005c: a phantom id is reported with the tasks that cite it', () => {
    // The negative control. Without it, a scan that silently matched nothing
    // — a changed id format, a moved file — would report a clean backlog
    // forever while checking nothing.
    const backlog =
      '| TASK-033 | GET /api/titles | M | 023 | `T-LIST-001` |\n' +
      '| TASK-034 | GET /api/titles/:id | XS | 033 | `T-LIST-001` |';
    const spec = '| AC-1 | I | `T-LIST-010` | Exactly one row per canonical work |';
    expect(undefinedCitations(backlog, spec)).toEqual([
      { id: 'T-LIST-001', tasks: ['TASK-033', 'TASK-034'] },
    ]);
  });

  it('T-META-005d: a lettered case counts as its base criterion', () => {
    // The spec names an acceptance criterion; a suite may split it into
    // `T-LIST-010a`…`c`. Requiring an exact match would report every such
    // split as undefined, which would train everyone to ignore the gate.
    expect(baseId('T-LIST-010a')).toBe('T-LIST-010');
    expect(
      undefinedCitations(
        '| TASK-001 | x | S | — | `T-LIST-010a` |',
        '| AC-1 | I | `T-LIST-010` | one row per work |',
      ),
    ).toEqual([]);
  });

  it('T-META-005e: a struck-through id is dead and is not required', () => {
    // Correcting a row in place leaves the superseded id struck through
    // (`.github/copilot-instructions.md` §5). If the gate read those, an
    // honest correction would fail CI and the only green path would be
    // deleting the evidence that the id was ever wrong.
    const backlog = '| TASK-048 | x | S | — | `T-BATCH-010` ~~`T-BATCH-001`~~ |';
    const spec = '| AC-1 | I | `T-BATCH-010` | one open batch per owner |';
    expect(undefinedCitations(backlog, spec)).toEqual([]);
  });

  it('T-META-005f: stripping strikethrough does not swallow live ids', () => {
    // Non-greedy control: `~~.*~~` would delete everything between the first
    // and last marker, taking the live id in the middle with it.
    expect(stripStruckThrough('~~`T-OLD-001`~~ `T-LIVE-010` ~~`T-OLD-002`~~')).toContain(
      'T-LIVE-010',
    );
    expect(stripStruckThrough('~~`T-OLD-001`~~ `T-LIVE-010` ~~`T-OLD-002`~~')).not.toContain(
      'T-OLD-002',
    );
  });

  it('T-META-005g: only lines naming a task are scanned', () => {
    // Prose elsewhere in the backlog — risk tables, milestone notes — may
    // mention an id for contrast. Attributing those to a task would invent
    // work orders that do not exist.
    expect(citedTestIds('A paragraph mentioning `T-GHOST-001` with no task.').size).toBe(0);
    expect([...citedTestIds('| TASK-001 | x | S | — | `T-REAL-010` |').keys()]).toEqual([
      'T-REAL-010',
    ]);
  });

  it('T-META-005i: a prose mention of an id does not define it', () => {
    // The self-defeating case, and the reason `definedTestIds` reads cells
    // rather than occurrences. §11.2 records that `T-BATCH-001` and
    // `T-API-004` are invented ids that exist nowhere — and that sentence
    // contains them. Counting mentions meant writing down that a phantom was
    // a phantom PROMOTED it to defined and deleted it from the report:
    // measured, twelve ids disappeared the moment the finding was recorded.
    const prose = 'The ids `T-BATCH-001` and `T-API-004` were invented and exist nowhere.';
    expect(definedTestIds(prose).size).toBe(0);
    expect(undefinedCitations('| TASK-048 | x | S | — | `T-BATCH-001` |', prose)).toEqual([
      { id: 'T-BATCH-001', tasks: ['TASK-048'] },
    ]);
  });

  it('T-META-005j: an assertion cell naming an id does not define it', () => {
    // The subtler half: a §9 Assertion cell often cross-references another
    // test ("tie-breaker unchanged (`T-LIST-026`)"). Those cells sit inside a
    // table row, so a row-level scan would still count them. Only the cell
    // that NAMES the test defines it.
    const row = '| AC-6 | C | `T-LIST-027` | Reversing re-orders; tie-break per `T-LIST-026` |';
    const defined = definedTestIds(row);
    expect(defined.has('T-LIST-027')).toBe(true);
    expect(defined.has('T-LIST-026')).toBe(false);
  });

  it('T-META-005h: the spec scan finds ids and the paths resolve', () => {
    // Proves the fixture-free halves are wired to the real files, so a
    // renamed spec cannot make this suite pass vacuously.
    const defined = definedTestIds(read('specs/testing.md'));
    expect(defined.size).toBeGreaterThan(100);
    expect(defined.has('T-LIST-010')).toBe(true);
    expect(BACKLOG.endsWith(path.join('docs', 'backlog.md'))).toBe(true);
    expect(TESTING_SPEC.endsWith(path.join('specs', 'testing.md'))).toBe(true);
  });
});
