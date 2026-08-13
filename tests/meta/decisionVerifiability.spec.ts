/**
 * `T-META-003` — TASK-032.
 *
 * "Any decision claimed as verifiable resolves to a test id present in this
 * file; unverifiable ones must appear in §10" (`specs/testing.md` §9A,
 * US-039 AC-6).
 *
 * Every case below feeds the checker a spec it has never seen. Running it only
 * against the committed `specs/testing.md` would assert that the file is
 * currently tidy, not that the gate can tell tidy from broken — and a gate
 * that has only ever seen clean input has asserted nothing.
 *
 * ⚠ The fixtures are deliberately TINY hand-written markdown, not slices of
 * the real spec. A fixture cut from the real file drifts the moment the file
 * is edited, and then the mutation stops reproducing the defect it was written
 * to reproduce — silently, because the test still passes.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  TESTING_SPEC,
  checkDecisionVerifiability,
  mappedCriteria,
  section10Exemptions,
} from '../../tools/check-decision-verifiability.mjs';

const spec = readFileSync(TESTING_SPEC, 'utf8');

/** A minimal spec: one story table plus a §10 whose rows are supplied. */
function fixture(rows: string, section10 = '', header = '| AC | L | Test | Assertion |') {
  return [
    '### US-900 — a story',
    header,
    '|---|---|---|---|',
    rows,
    '',
    '## 10. Acceptance criteria that are NOT fully machine-verifiable',
    '| AC | Why not | Compensating check |',
    '|---|---|---|',
    section10,
    '',
    '## 11. Something else',
  ].join('\n');
}

describe('T-META-003 every verifiable decision resolves to a defined test', () => {
  it('T-META-003a · the committed testing spec passes', () => {
    expect(checkDecisionVerifiability(spec)).toEqual([]);
  });

  it('T-META-003b · every acceptance criterion in the spec is seen by the gate', () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every other case here pass vacuously.
    const criteria = mappedCriteria(spec);
    expect(criteria.length).toBeGreaterThan(200);
    expect(criteria.every((c) => /^US-\d{3}$/.test(c.story))).toBe(true);
  });

  it('T-META-003c · a criterion citing an id the spec never defines is CAUGHT', () => {
    // ⚠ The decoration matters. `definedTestIds` treats a cell holding ONLY an
    // id and markup as that id's definition, so `| … | `T-GHOST-001` | … |`
    // defines the phantom it cites and this mutation would prove nothing. The
    // shape that can go wrong for real is the prose-decorated cell — the live
    // `T-INFRA-005` row is `` `T-INFRA-005` **(REWRITTEN R3, RE-PINNED R4)** ``
    // — which is a citation, not a definition, and must resolve elsewhere.
    const findings = checkDecisionVerifiability(
      fixture('| AC-1 | S | `T-GHOST-001` **REWRITTEN R3** | cites a test defined nowhere |'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('T-GHOST-001');
  });

  it('T-META-003m · a bare-id cell defines the id it names, and is not a finding', () => {
    // The other half of the rule above, asserted so the asymmetry is a stated
    // decision rather than something a reader discovers by being confused.
    expect(checkDecisionVerifiability(fixture('| AC-1 | S | `T-ONLY-001` | fine |'))).toEqual([]);
  });

  it('T-META-003d · a criterion with NO test and no §10 entry is CAUGHT', () => {
    const findings = checkDecisionVerifiability(
      fixture('| AC-1 | M | — | nothing verifies this |'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('US-900 AC-1');
    expect(findings[0], 'the message must name the escape hatch').toContain('§10');
  });

  it('T-META-003e · the same criterion PASSES once §10 declares it', () => {
    const findings = checkDecisionVerifiability(
      fixture(
        '| AC-1 | M/§10 | — | nothing verifies this |',
        '| US-900 AC-1 | it is a stance, not a behaviour | `T-REAL-001` covers the half that is |',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('T-META-003f · §10 exempting a criterion that exists nowhere is CAUGHT', () => {
    const findings = checkDecisionVerifiability(
      fixture(
        '| AC-1 | S | `T-REAL-001` | fine |',
        '| US-900 AC-9 | invented | `T-REAL-001` |\n| `T-REAL-001` | — | — |',
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('US-900 AC-9');
  });

  it('T-META-003g · a §10 entry beside a mapped, tested criterion is NOT a finding', () => {
    // The twelve real exemptions all have a test for the verifiable half —
    // §10's third column IS that test. Flagging the pairing would report all
    // twelve as defects and train every reader to ignore this gate.
    const findings = checkDecisionVerifiability(
      fixture(
        '| AC-1 | M/§10 | `T-REAL-001` | the client-side half only |',
        '| US-900 AC-1 | the platform condition cannot be induced in CI | `T-REAL-001` |',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('T-META-003h · the Test column is found by NAME, not by position', () => {
    // ⚠ Regression guard. The A45 table for US-004 AC-12…AC-17 is
    // `| AC | Test | L | Assertion |` while §9's are `| AC | L | Test |`.
    // Reading a fixed index there finds `C`/`I`/`E2E` where the ids are and
    // reports fourteen fully-mapped criteria as having no test at all.
    const swapped = fixture(
      '| **AC-12** | **`T-REAL-001`** | C | mapped, in the other column order |',
      '',
      '| AC | Test | L | Assertion |',
    );
    expect(mappedCriteria(swapped)[0]?.ids).toEqual(['T-REAL-001']);
    expect(checkDecisionVerifiability(swapped)).toEqual([]);
  });

  it('T-META-003i · both real column orders are present in the spec and both parse', () => {
    // The guard above is only meaningful while the file really does use two
    // orders; if it is ever normalised, this fails and says so rather than
    // leaving a test defending a condition that no longer exists.
    const orders = new Set(
      spec
        .split('\n')
        .filter((l) => /^\|\s*AC\s*\|/i.test(l))
        .map((l) =>
          l
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
            .join(','),
        ),
    );
    expect([...orders]).toContain('AC,L,Test,Assertion');
    expect([...orders]).toContain('AC,Test,L,Assertion');
    const a45 = mappedCriteria(spec).filter((c) => c.story === 'US-004' && c.ac === 'AC-12');
    expect(a45.length, 'the A45 rows must still be parsed').toBeGreaterThan(0);
    expect(a45.every((c) => c.ids.length > 0)).toBe(true);
  });

  it('T-META-003j · a struck-through id does not satisfy a criterion', () => {
    // The convention is to correct in place and leave the old id struck
    // through (copilot-instructions §5). A dead id must not count as a live
    // definition of done, or a supersession silently unmaps the criterion.
    const findings = checkDecisionVerifiability(fixture('| AC-1 | S | ~~`T-REAL-001`~~ | dead |'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('US-900 AC-1');
  });

  it('T-META-003k · §10 reads exemptions from the first cell only', () => {
    // A compensating check naming another AC must not exempt that one too.
    const exemptions = section10Exemptions(
      fixture(
        '| AC-1 | S | `T-REAL-001` | fine |',
        '| US-900 AC-1 | reason | covered indirectly by the US-901 AC-4 suite |',
      ),
    );
    expect([...exemptions]).toEqual(['US-900 AC-1']);
  });

  it('T-META-003l · §10 parsing stops at the next section', () => {
    const exemptions = section10Exemptions(spec);
    expect(exemptions.size).toBeGreaterThan(0);
    // §12's mapping tables sit after §10 and name hundreds of criteria; if the
    // scan ran on past the heading it would swallow them and exempt the file
    // from itself.
    expect(exemptions.size).toBeLessThan(30);
  });
});
