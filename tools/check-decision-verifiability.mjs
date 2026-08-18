/**
 * `T-META-003` — every decision `specs/testing.md` claims is verifiable
 * resolves to a test id the file DEFINES, and every decision it does not
 * claim is verifiable is named in §10.
 *
 * ── Why this gate exists, and why it is not `T-META-005` ────────────────────
 *
 * `T-META-005` (`tools/check-test-ids.mjs`) asks whether `docs/backlog.md`
 * cites ids the testing spec defines. It looks INWARD from the work order.
 * This gate looks at the spec's own mapping: NFR-003 makes the AC → named-test
 * table the definition of done, so the table is only load-bearing if
 *
 *   1. every id it names is real, and
 *   2. every acceptance criterion it leaves WITHOUT a test is one the project
 *      has consciously declared unverifiable, in §10, with a compensating
 *      check beside it.
 *
 * Point 2 is the one that matters and the one nothing else covers. An AC whose
 * Test cell is an em dash is indistinguishable, to every other gate in this
 * repository, from an AC nobody has got to yet: `T-META-001` counts the row as
 * mapped, `T-META-005` sees no id to resolve, and `T-STATUS-001` only inspects
 * tasks already claimed done. A criterion can therefore be silently dropped
 * from the definition of done by deleting an id — the diff that does it is one
 * character wide.
 *
 * ── And the reverse direction ───────────────────────────────────────────────
 *
 * §10 is an escape hatch, so it is checked in the other direction too: an
 * entry naming an acceptance criterion that appears in no mapping table is an
 * excuse for a criterion nobody is tracking, and it survives every other gate.
 *
 * ⚠ What is deliberately NOT asserted: that a §10 criterion has no test in the
 * mapping. Every one of the twelve DOES have one, and correctly so — §10's
 * third column is the *compensating check*, and the mapping row points at that
 * same partial test. `US-001 AC-5` is exempt because an unreachable IdP cannot
 * be induced in CI, and its row still names `T-UX-019` for the client-side
 * half. Reading that pairing as a stale exemption reports all twelve as
 * defects, which is how a gate teaches its readers to ignore it.
 *
 * ⚠ §10 legitimately holds entries that are not `US-nnn AC-n` rows at all —
 * the `(R2)`, `(R5)` and `(A45)` rows name whole themes rather than criteria.
 * Those are left alone: only entries shaped like an AC reference are held to
 * the mapping, because only those make a checkable claim about one.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { baseId, definedTestIds, stripStruckThrough } from './check-test-ids.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TESTING_SPEC = path.join(ROOT, 'specs', 'testing.md');

const TEST_ID_RE = /T-[A-Z0-9]+-\d+[a-z]{0,2}/g;
const US_HEADING_RE = /^#{2,4}\s+(US-\d{3})\b/;
const SECTION_10_RE = /^##\s+10\.\s/;
const NEXT_H2_RE = /^##\s+(?!10\.)/;

/** A mapping row: `| AC-3 | E | `T-A11Y-013` | … |` under a `### US-nnn` heading. */
const AC_ROW_RE = /^\|\s*(?:\*\*)?(AC-\d+)(?:['′])?(?:\*\*)?\s*\|/;

/** A table header row, used to locate the "Test" column by NAME. */
const HEADER_RE = /^\|\s*AC\s*\|/i;

/**
 * Index of the `Test` cell in a header row.
 *
 * ⚠ Column ORDER is not fixed in this file and must never be assumed: §9's
 * tables are `| AC | L | Test | Assertion |` but the A45 table added for
 * US-004 `AC-12`…`AC-17` is `| AC | Test | L | Assertion |`. Hard-coding index
 * 3 reads the `L` column there, finds no test id in `C`/`I`/`E2E`, and reports
 * fourteen fully-mapped criteria as unmapped. Read the header.
 */
function testColumnIndex(headerLine) {
  const cells = headerLine.split('|');
  const found = cells.findIndex((c) => c.trim().toLowerCase() === 'test');
  return found === -1 ? null : found;
}

/**
 * Every acceptance criterion the §9 mapping tables carry.
 *
 * @returns {{ ac: string, story: string, line: number, testCell: string, ids: string[] }[]}
 */
export function mappedCriteria(specMarkdown) {
  const rows = [];
  let story = null;
  let testColumn = null;
  let inSection10 = false;

  const lines = specMarkdown.split('\n');
  for (const [index, line] of lines.entries()) {
    if (SECTION_10_RE.test(line)) inSection10 = true;
    else if (NEXT_H2_RE.test(line)) inSection10 = false;
    if (inSection10) continue;

    const heading = line.match(US_HEADING_RE);
    if (heading) {
      story = heading[1];
      testColumn = null;
      continue;
    }

    if (HEADER_RE.test(line)) {
      testColumn = testColumnIndex(line);
      continue;
    }

    const row = line.match(AC_ROW_RE);
    if (!row || !story || testColumn === null) continue;

    // Split on the raw line so an em dash in the Assertion prose cannot be
    // mistaken for one in the Test cell.
    const cells = line.split('|');
    const testCell = cells[testColumn] ?? '';
    const ids = [...new Set((stripStruckThrough(testCell).match(TEST_ID_RE) ?? []).map(baseId))];

    rows.push({ ac: row[1], story, line: index + 1, testCell: testCell.trim(), ids });
  }
  return rows;
}

/** Every `US-nnn AC-n` reference §10 names as not fully machine-verifiable. */
export function section10Exemptions(specMarkdown) {
  const exempt = new Set();
  let inSection10 = false;

  for (const line of specMarkdown.split('\n')) {
    if (SECTION_10_RE.test(line)) {
      inSection10 = true;
      continue;
    }
    if (inSection10 && NEXT_H2_RE.test(line)) break;
    if (!inSection10 || !line.trimStart().startsWith('|')) continue;

    // Only the first cell states which criterion the exemption is FOR; a
    // compensating-check cell naming another AC is not an exemption for it.
    const first = line.split('|')[1] ?? '';
    for (const m of first.matchAll(/(US-\d{3})\s+(AC-\d+)/g)) exempt.add(`${m[1]} ${m[2]}`);
  }
  return exempt;
}

/** @returns {string[]} findings */
export function checkDecisionVerifiability(specMarkdown) {
  const findings = [];
  const defined = definedTestIds(specMarkdown);
  const criteria = mappedCriteria(specMarkdown);
  const exempt = section10Exemptions(specMarkdown);
  const mappedKeys = new Map(criteria.map((c) => [`${c.story} ${c.ac}`, c]));

  for (const c of criteria) {
    const key = `${c.story} ${c.ac}`;

    if (c.ids.length === 0) {
      if (!exempt.has(key)) {
        findings.push(
          `${key} (specs/testing.md:${c.line}) names no test and is absent from §10. ` +
            'An acceptance criterion with no test is either unfinished or a decision ' +
            'that it cannot be automated — §10 is where the second is declared, with ' +
            'a compensating check beside it (NFR-003, T-META-003).',
        );
      }
      continue;
    }

    for (const id of c.ids) {
      if (!defined.has(id)) {
        findings.push(
          `${key} (specs/testing.md:${c.line}) cites "${id}", which this file defines ` +
            'nowhere. The row claims a definition of done it does not have (T-META-003).',
        );
      }
    }
  }

  for (const key of exempt) {
    if (!mappedKeys.has(key)) {
      findings.push(
        `§10 exempts ${key}, which appears in no §9 mapping table. ` +
          'An excuse for a criterion nobody tracks (T-META-003).',
      );
    }
  }

  return findings;
}

function main() {
  const spec = readFileSync(TESTING_SPEC, 'utf8');
  const findings = checkDecisionVerifiability(spec);
  const total = mappedCriteria(spec).length;

  if (findings.length === 0) {
    console.log(
      `Decision-verifiability check passed: all ${total} mapped acceptance criteria ` +
        'resolve to a defined test or to a §10 exemption.',
    );
    return;
  }

  console.error('Decision-verifiability check failed.\n');
  for (const f of findings) console.error(`  ✗ ${f}`);
  console.error(
    '\nEither name the test that verifies the criterion, or declare it in §10 ' +
      'with the compensating check that covers what the test cannot.',
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith('check-decision-verifiability.mjs')) {
  main();
}
