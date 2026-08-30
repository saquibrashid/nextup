/**
 * `T-META-001` — every acceptance criterion in `docs/PRD.md` is mapped to a
 * test in `specs/testing.md`, and every test id that mapping cites is real.
 *
 * ⚠ WHY THIS GATE EXISTS. `specs/testing.md` has claimed, in prose, since the
 * document was written, that this gate is running:
 *
 *   §1  "**The AC mapping in §9 is the real gate**: `T-META-001` parses
 *        `docs/PRD.md`, extracts every `US-nnn AC-n`, and fails if any is
 *        absent from the mapping table in this file **or** if any test id in
 *        the table does not exist in the suite. A new AC without a test cannot
 *        merge."
 *   §3  lists a CI job as "`meta` — `T-META-001` AC↔test mapping completeness".
 *   §10 calls it "what enforces the mapping" and leans on it three more times.
 *
 * It did not exist. Not as a test, not as a script, not as a CI step. The one
 * gate the testing strategy names as *the real gate* — the thing that makes
 * NFR-003's "every AC maps to a named test" true rather than aspirational —
 * was itself the sixth disguise of this repository's dominant defect class: an
 * id that lives only in a spec.
 *
 * That is not a theoretical loss. On the first run it found **43 unmapped
 * criteria**, and the two shapes it found are exactly the two the prose
 * promised to prevent:
 *
 *   - **A whole epic with no mapping section.** US-040…US-046 (the rental
 *     storefront and IMDb ratings epics) were specced into the PRD, 42
 *     criteria in total, and `specs/testing.md` §9 was never extended to
 *     cover them. Every other gate was green: `check:test-ids` walks
 *     backlog → catalogue and never reads the PRD, and `check:orphans` walks
 *     outward from tests that exist, so criteria with no tests are invisible
 *     to it by construction.
 *
 *   - **A single criterion silently dropped from a story that otherwise looks
 *     complete** — the more dangerous shape, because nothing looks wrong.
 *     US-028 AC-7 (a suppression MIGRATES when fix-match re-points a work;
 *     "without this, correcting a match would silently resurrect a work the
 *     owner had dismissed") names its test, `T-FIX-005`. `T-FIX-005` was in
 *     the catalogue. It was listed under US-030 with `—` in the AC column,
 *     i.e. explicitly attached to no criterion. Both halves of the mapping
 *     existed and had never been joined, on an invariant the PRD calls out as
 *     load-bearing.
 *
 * ⚠ THIS IS A RATCHET, NOT A SNAPSHOT. `KNOWN_UNMAPPED` may only ever get
 * shorter. `T-META-001a` fails in BOTH directions on purpose: a newly unmapped
 * AC fails it, and an AC that is now mapped but still baselined fails it too.
 * The second half is the one that matters — a baseline nobody is forced to
 * prune stops describing reality and becomes a list nobody trusts.
 *
 * ⚠ AND ITS POSITIVE CONTROL ASSERTS THE REAL INPUTS, NOT ONLY A FAKE
 * (`T-META-001d`). A positive control that feeds the detector its own
 * synthetic input proves the pure function works and proves *nothing about the
 * wiring*. That precise hole shipped in this repo's `T-INFRA-015c`: it
 * injected its own `exists()` while the real predicate was blinded to
 * `() => true`, and passed three assertions while measuring nothing. So `d`
 * drives the detector over synthetic input in both directions AND asserts the
 * real parsers, on the real files, return non-empty and disagree with each
 * other in the way the baseline records.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BASELINE_ORPHANS } from '../../tools/check-orphan-tests.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PRD = join(REPO_ROOT, 'docs', 'PRD.md');
const TESTING_SPEC = join(REPO_ROOT, 'specs', 'testing.md');

/**
 * ⚠ THIS FILE IS DELIBERATELY *NOT* EXCLUDED FROM THE SCAN, AND THAT IS THE
 * POINT. `KNOWN_PHANTOM_CITATIONS` writes every phantom id as a string
 * literal, and under a naive "does the id appear in the file" predicate each
 * one would be found HERE and counted as implemented — the phantom set would
 * collapse to empty and `T-META-001e` would pass while measuring nothing. That
 * is exactly what happened on this gate's first run.
 *
 * The fix is the PREDICATE, not an exclusion list: an id counts only in test
 * TITLE position (see `TITLE_ID_PATTERN`), which an array literal never
 * reaches. Excluding the file instead would have been strictly worse — it
 * blinds the gate to its own tests, and it did: with `SELF` filtered out,
 * `T-META-001` reported *itself* as a phantom.
 *
 * `T-META-001g` keeps this honest by proving the literals in this very file
 * are not counted, with this file genuinely in the corpus.
 */
const SELF = 'tests/meta/acCoverage.spec.ts';

/** Roots that actually contain collected spec files (see `specs/testing.md` §11). */
const TEST_ROOTS = ['apps', 'packages', 'tests'] as const;

/**
 * ⚠ TITLE POSITION, NOT MERE OCCURRENCE. An id in a comment, or used as data,
 * does not mean a test asserts it — see the long note in
 * `tests/meta/uxStateCoverage.spec.ts`. `T-META-004` guarantees every `it(...)`
 * title starts with a static `T-` id, so this predicate is safe to rely on.
 */
const TITLE_ID_PATTERN = /\b(?:it|test|describe)(?:\.\w+)*\(\s*['"`]\s*(T-[A-Z0-9]+-\d+)/g;

function collectSpecFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.spec\.tsx?$/.test(entry))
        found.push(relative(REPO_ROOT, full).split(sep).join('/'));
    }
  };
  for (const root of TEST_ROOTS) walk(join(REPO_ROOT, root));
  return found.sort();
}

/** Every test id that actually names a test in the collected suites. */
function implementedInTitles(files: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    for (const [, id] of text.matchAll(TITLE_ID_PATTERN)) ids.add(id);
  }
  return ids;
}

/**
 * A criterion key, `US-nnn AC-n`. Both documents organise criteria the same
 * way — a `#### US-nnn — title` heading followed by a table whose rows begin
 * `| AC-n`. The PRD decorates some with `(edge)`, `(failure)` or a `′` prime
 * (`AC-6′` supersedes `AC-6`); the leading number is the identity, so the
 * parser takes that and ignores the decoration.
 */
const US_HEADING_RE = /^#{2,6}\s.*?\bUS-(\d{3})\b/;
const AC_ROW_RE = /^\|\s*\*{0,2}\s*AC-(\d+)/;

export function criteriaIn(markdown: string): Set<string> {
  const found = new Set<string>();
  let story: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = US_HEADING_RE.exec(line);
    if (heading) {
      story = `US-${heading[1]}`;
      continue;
    }
    const row = AC_ROW_RE.exec(line);
    if (row && story) found.add(`${story} AC-${row[1]}`);
  }

  return found;
}

/** Pure detector: which criteria of `prd` have no row in `mapping`. */
export function unmappedCriteria(prd: Set<string>, mapping: Set<string>): string[] {
  return [...prd].filter((ac) => !mapping.has(ac));
}

/**
 * The known gaps as of this gate landing: two whole epics specced into the PRD
 * whose §9 mapping sections were never written. DELETE an entry when you map
 * its criterion — `T-META-001a` requires it.
 *
 * ⚠ Do NOT add to this list to make a build pass. A new unmapped AC means a
 * criterion was written with no definition of done. Write the mapping row.
 */
const KNOWN_UNMAPPED: readonly string[] = [
  // US-040 — Capture a rental storefront's new-release page
  'US-040 AC-1',
  'US-040 AC-2',
  'US-040 AC-3',
  'US-040 AC-4',
  'US-040 AC-5',
  'US-040 AC-6',
  // US-041 — Curate the rental page down to what I actually want
  'US-041 AC-1',
  'US-041 AC-2',
  'US-041 AC-3',
  'US-041 AC-4',
  'US-041 AC-5',
  'US-041 AC-6',
  // US-042 — Be told when a waiting title starts streaming
  'US-042 AC-1',
  'US-042 AC-2',
  'US-042 AC-3',
  'US-042 AC-4',
  'US-042 AC-5',
  'US-042 AC-6',
  'US-042 AC-7',
  'US-042 AC-8',
  'US-042 AC-9',
  'US-042 AC-10',
  // US-043 — Browse and clear the waiting list
  'US-043 AC-1',
  'US-043 AC-2',
  'US-043 AC-3',
  'US-043 AC-4',
  'US-043 AC-5',
  'US-043 AC-6',
  // US-044 — See the IMDb rating on my list
  'US-044 AC-1',
  'US-044 AC-2',
  'US-044 AC-3',
  'US-044 AC-4',
  'US-044 AC-5',
  'US-044 AC-6',
  // US-045 — Look up a rating for something I haven't saved
  'US-045 AC-1',
  'US-045 AC-2',
  'US-045 AC-3',
  'US-045 AC-4',
  'US-045 AC-5',
  // US-046 — Trust that a rating belongs to the right film
  'US-046 AC-1',
  'US-046 AC-2',
  'US-046 AC-3',
];

/**
 * Test ids the §9 mapping cites for which no test of that name exists, and
 * which `check-orphan-tests.mjs` does not already excuse. `check:orphans`
 * cannot see these: it asks whether an id `docs/backlog.md` cites is DEFINED
 * in the catalogue, which is strictly weaker than "a test bearing this id
 * runs". An AC whose only named test does not exist has no definition of done.
 *
 * ⚠ Shrink-only, like `KNOWN_UNMAPPED`. `T-META-001e` fails in both
 * directions, so landing any one of these forces its line out. It has already
 * happened twice: lane V's a11y work removed three, and building
 * `T-META-002` removed its own line.
 */
const KNOWN_PHANTOM_CITATIONS: readonly string[] = [
  // ⚠ THIS LIST AND `BASELINE_ORPHANS` ARE COUPLED, AND THE COUPLING IS EASY TO
  // MISREAD AS A LIST SHRINKING ON ITS OWN. `T-META-001e` subtracts
  // `BASELINE_ORPHANS` before comparing, because an id that no task cites AND
  // no test implements is already tracked, by name, over there. So moving an id
  // INTO the orphan baseline removes it from here. That is not a gap closing —
  // it is the same gap changing which gate reports it, and it is only safe
  // because both lists are pinned EXACTLY (`T-META-006e` and this assertion),
  // so neither can absorb an entry quietly.
  //
  // Four ids left this list that way when `implementedTestIds` was sharpened to
  // title position: `T-AI-014`, `T-AUTH-001`, `T-AUTH-002` and `T-UX-099`. The
  // note that used to sit on `T-UX-099` here — claiming a task cites it, so it
  // could never be an orphan — was WRONG, and wrong in the house pattern: the
  // only thing making it look cited was its own string literal on this line,
  // read by a gate that matched bare occurrence.
  'T-UNDO-004',
  'T-UX-097',
];

/**
 * Non-vacuity floors. Deliberately well below today's real figures (283 PRD
 * criteria across 46 stories, 241 mapped) so ordinary spec work never trips
 * them, but far enough above zero that a parser broken by a heading- or
 * table-format change fails loudly instead of reporting a clean sweep.
 */
const MIN_PRD_CRITERIA = 250;
const MIN_MAPPED_CRITERIA = 200;
const MIN_PRD_STORIES = 40;

const prdMarkdown = readFileSync(PRD, 'utf8');
const testingMarkdown = readFileSync(TESTING_SPEC, 'utf8');
const specFiles = collectSpecFiles();

describe('T-META-001 — every PRD acceptance criterion maps to a test', () => {
  it('T-META-001a · every AC in the PRD is mapped in specs/testing.md, and the baseline is exact', () => {
    const unmapped = unmappedCriteria(criteriaIn(prdMarkdown), criteriaIn(testingMarkdown));

    // Sorting both sides makes a failure readable: the diff names the exact
    // criteria, so the fix is "write this mapping row" or "delete this line".
    expect([...unmapped].sort()).toEqual([...KNOWN_UNMAPPED].sort());
  });

  it('T-META-001b · the PRD parser finds the criteria that are really there', () => {
    const criteria = criteriaIn(prdMarkdown);
    const stories = new Set([...criteria].map((ac) => ac.split(' ')[0]));

    expect(criteria.size).toBeGreaterThanOrEqual(MIN_PRD_CRITERIA);
    expect(stories.size).toBeGreaterThanOrEqual(MIN_PRD_STORIES);
    // A spot check on a criterion that exists and is load-bearing (REQ-071),
    // so a parser that returns a large set of the WRONG shape still fails.
    expect(criteria.has('US-028 AC-1')).toBe(true);
  });

  it('T-META-001c · the mapping parser finds the rows that are really there', () => {
    const mapped = criteriaIn(testingMarkdown);

    expect(mapped.size).toBeGreaterThanOrEqual(MIN_MAPPED_CRITERIA);
    expect(mapped.has('US-028 AC-1')).toBe(true);
  });

  it('T-META-001d · the detector fires on a gap, stays quiet on a mapping, and is wired to the real files', () => {
    // Synthetic half — the pure function, both directions. "Reports nothing"
    // and "reports everything" are equally broken.
    const prd = new Set(['US-001 AC-1', 'US-001 AC-2']);
    expect(unmappedCriteria(prd, new Set(['US-001 AC-1']))).toEqual(['US-001 AC-2']);
    expect(unmappedCriteria(prd, new Set(['US-001 AC-1', 'US-001 AC-2']))).toEqual([]);

    // Wiring half — the REAL parsers over the REAL documents. Without this the
    // case would pass with `criteriaIn` blinded to `() => new Set()`, which is
    // exactly how T-INFRA-015c shipped broken.
    const realPrd = criteriaIn(prdMarkdown);
    const realMapping = criteriaIn(testingMarkdown);
    expect(realPrd.size).toBeGreaterThan(0);
    expect(realMapping.size).toBeGreaterThan(0);
    expect(unmappedCriteria(realPrd, realMapping).length).toBe(KNOWN_UNMAPPED.length);
  });

  it('T-META-001e · every test id the mapping cites exists in the suite or is a declared gap', () => {
    const implemented = implementedInTitles(specFiles);
    const cited = new Set<string>();

    let story: string | null = null;
    for (const line of testingMarkdown.split(/\r?\n/)) {
      const heading = US_HEADING_RE.exec(line);
      if (heading) {
        story = `US-${heading[1]}`;
        continue;
      }
      if (!story || !AC_ROW_RE.test(line)) continue;
      // Struck-through ids are superseded in place and deliberately ignored,
      // the same convention check-test-ids.mjs uses.
      const live = line.replace(/~~[^~]*~~/g, '');
      for (const id of live.match(/T-[A-Z0-9]+-\d+/g) ?? []) cited.add(id);
    }

    expect(cited.size).toBeGreaterThan(0);

    const phantom = [...cited]
      .filter((id) => !implemented.has(id) && !BASELINE_ORPHANS.has(id))
      .sort();

    expect(phantom).toEqual([...KNOWN_PHANTOM_CITATIONS].sort());
  });

  it('T-META-001f · no baselined criterion has vanished from the PRD', () => {
    const criteria = criteriaIn(prdMarkdown);
    const stale = KNOWN_UNMAPPED.filter((ac) => !criteria.has(ac));

    // A baseline entry naming an AC the PRD no longer has is dead weight that
    // hides a real regression: the ratchet in `a` would keep passing while the
    // criterion it excused was renamed or deleted.
    expect(stale).toEqual([]);
  });

  it('T-META-001g · a baselined id written as a literal in this file is not mistaken for a test', () => {
    // This file IS in the corpus — that is the whole point. If the predicate
    // ever loosens back to "the id appears somewhere", these assertions fail
    // here rather than silently emptying the phantom set in `e`.
    expect(specFiles).toContain(SELF);
    expect(specFiles.length).toBeGreaterThan(20);

    const implemented = implementedInTitles(specFiles);
    for (const id of KNOWN_PHANTOM_CITATIONS) expect(implemented.has(id)).toBe(false);

    // And the corpus really is being read: this gate's own cases are found.
    expect(implemented.has('T-META-001')).toBe(true);
  });
});
