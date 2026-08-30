/**
 * `T-META-007` — every state in `specs/ux-states.md` is either asserted by a
 * test, or is on an explicit, shrinking list of known gaps.
 *
 * ⚠ WHY THIS GATE EXISTS. `specs/ux-states.md` gives all ~105 UI states a test
 * id. Nothing checked that those ids led anywhere, and **no existing gate
 * could**:
 *
 *   - `check-test-ids.mjs` walks `docs/backlog.md` → `specs/testing.md`. An id
 *     cited by no task is invisible to it.
 *   - `check-orphan-tests.mjs` starts from tests that exist, so an id with no
 *     test is, by construction, not something it can see.
 *   - `check-test-locations.mjs` only asks whether a spec FILE is collected.
 *
 * So an id could be written in `ux-states.md`, describe a `must` behaviour on a
 * shipped route, have no implementation and no assertion at all — and every
 * gate in the repository stayed green. That is not hypothetical: it is how
 * `T-UX-067` (§6.16, the 5xx-on-close error state) was found. The batch close
 * was shipped and its failure path was silent, because the rejection handler
 * was empty. `T-UX-060` is the same shape in reverse: `data-testid="review-
 * loading"` is in the shipped `ReviewPage`, and no assertion names it.
 *
 * ⚠ THIS IS A RATCHET, NOT A PASS/FAIL SNAPSHOT. `KNOWN_UNCOVERED` may only
 * ever get shorter. `T-META-007a` fails in BOTH directions on purpose:
 *   - a NEW uncovered id (a state added to the spec with no test) fails it, and
 *   - an id that is now covered but still listed fails it too.
 * The second half is the important one. A baseline that is allowed to go stale
 * stops describing reality and becomes a list nobody trusts or prunes; forcing
 * the deletion is what keeps the number honest and falling.
 *
 * ⚠ AND IT CARRIES A POSITIVE CONTROL (`T-META-007d`). A gate whose assertion
 * is "the list of problems matches expectations" passes perfectly if its
 * detector has been blinded and returns nothing. That exact hole was found in
 * this repo's own `tests/infra/specPaths.spec.ts` after it shipped: a mutant
 * that made the detector return an empty list left every case green. So the
 * detector here is a pure function driven over synthetic input, and it is
 * asserted both to FIRE on a known gap and to STAY QUIET on a covered id —
 * "reports everything" is as broken as "reports nothing".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UX_STATES_SPEC = join(REPO_ROOT, 'specs', 'ux-states.md');

/**
 * ⚠ THIS FILE EXCLUDES ITSELF FROM THE SUITE SCAN, AND THAT IS LOAD-BEARING.
 * `KNOWN_UNCOVERED` writes every gap id as a string literal. Without this
 * exclusion the scan would find each one *in this very file* and conclude it
 * was asserted — so the uncovered set would collapse to empty, `T-META-007a`
 * would pass, and the gate would be measuring nothing at all. The same trap is
 * documented in `tools/check-orphan-tests.mjs` (`T-META-006g`).
 * `T-META-007f` proves the exclusion is still in force.
 */
const SELF = 'tests/meta/uxStateCoverage.spec.ts';

/** Roots that actually contain collected spec files (see `specs/testing.md` §11). */
const TEST_ROOTS = ['apps', 'packages', 'tests'] as const;

const ID_PATTERN = /T-[A-Z0-9]+-\d+/g;

/**
 * The known gaps, as of this gate landing. Every entry is a state described in
 * `specs/ux-states.md` on an already-shipped route, with no assertion bearing
 * its id. DELETE an entry when you write its test — `T-META-007a` requires it.
 *
 * ⚠ Do NOT add to this list to make a build pass. A new uncovered state means a
 * UI state was specified and left unasserted; write the test instead.
 *
 * ⚠ THE LIST GREW ONCE, BY FIVE, AND ONLY BECAUSE THE DETECTOR GOT SHARPER.
 * When `assertedIds` stopped counting bare occurrences and started requiring
 * title position (see `TITLE_ID_PATTERN` above), five ids that had always been
 * unasserted stopped being able to hide: `T-AI-017`, `T-AUTH-001`,
 * `T-AUTH-002`, `T-UX-020` and `T-UX-068`. Coverage did not regress — the
 * measurement stopped lying. This is the ONLY circumstance in which an entry
 * may be added, it must be justified in the diff exactly like this, and the
 * ratchet is shrink-only again from here.
 */
const KNOWN_UNCOVERED: readonly string[] = [
  'T-A11Y-006',
  'T-AUTH-001',
  'T-AUTH-002',
  'T-AUTH-003',
  'T-AUTH-004',
  'T-SEC-008',
  'T-UX-001',
  'T-UX-002',
  'T-UX-003',
  'T-UX-010',
  'T-UX-015',
  'T-UX-016',
  'T-UX-017',
  'T-UX-020',
  'T-UX-021',
  'T-UX-031',
  'T-UX-032',
  'T-UX-036',
  'T-UX-040',
  'T-UX-044',
  'T-UX-050',
  'T-UX-051',
  'T-UX-052',
  'T-UX-053',
  'T-UX-054',
  'T-UX-055',
  'T-UX-056',
  'T-UX-057',
  'T-UX-058',
  'T-UX-060',
  'T-UX-062',
  'T-UX-064',
  // only because the state was still unasserted when this gate landed; the
  'T-UX-068',
  'T-UX-069',
  'T-UX-070',
  'T-UX-073',
  'T-UX-080',
  'T-UX-081',
  'T-UX-082',
  'T-UX-083',
  'T-UX-084',
  'T-UX-095',
  'T-UX-096',
  'T-UX-098',
];

function collectSpecFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.spec\.tsx?$/.test(entry))
        found.push(relative(REPO_ROOT, full).split(sep).join('/'));
    }
  };
  for (const root of TEST_ROOTS) walk(join(REPO_ROOT, root));
  return found.filter((f) => f !== SELF).sort();
}

/** Every test id named by `specs/ux-states.md`. */
export function specStateIds(text: string): string[] {
  return [...new Set(text.match(ID_PATTERN) ?? [])].sort();
}

/**
 * ⚠ AN ID IS "ASSERTED" ONLY WHEN IT NAMES A TEST — not when it merely appears
 * in the file. This predicate was originally `text.match(ID_PATTERN)`, which
 * counted ANY occurrence, including a mention in a comment or an id used as
 * DATA. That is this repository's second defect disguise — a name matched
 * instead of a call — reproduced inside the gate built to catch the sixth.
 *
 * It was not hypothetical. Under the loose predicate:
 *
 *   - `T-AUTH-001` counted as covered on the strength of a COMMENT in
 *     `tests/infra/easyAuth.spec.ts` explaining that TASK-027's "Done when"
 *     column names it. No test bears the id.
 *   - `T-UX-068` counted as covered because `tests/infra/status.spec.ts` names
 *     it as a PROBE — a deliberately unimplemented id, cited as data, to prove
 *     that a mention is not a delivery. The loose predicate read that proof as
 *     the very thing it disproves.
 *
 * `T-META-004` already requires every `it(...)` title to begin with a static
 * `T-` id, so title position is a predicate this suite is entitled to rely on.
 */
const TITLE_ID_PATTERN = /\b(?:it|test|describe)(?:\.\w+)*\(\s*['"`]\s*(T-[A-Z0-9]+-\d+)/g;

/** Every test id asserted anywhere in the collected suites. */
function assertedIds(files: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    for (const [, id] of text.matchAll(TITLE_ID_PATTERN)) ids.add(id);
  }
  return ids;
}

/**
 * THE DETECTOR — pure and injectable, so `T-META-007d` can drive it over input
 * it has never seen. If this only ever ran against the real corpus, a version
 * that returned `[]` unconditionally would be indistinguishable from a healthy
 * repository.
 */
export function uncoveredIds(specIds: readonly string[], asserted: ReadonlySet<string>): string[] {
  return specIds.filter((id) => !asserted.has(id)).sort();
}

const specText = readFileSync(UX_STATES_SPEC, 'utf8');
const specIds = specStateIds(specText);
const files = collectSpecFiles();
const asserted = assertedIds(files);

describe('T-META-007 every specified UI state is asserted, or is a declared gap', () => {
  it('T-META-007a · the uncovered set is EXACTLY the declared baseline', () => {
    const uncovered = uncoveredIds(specIds, asserted);
    const baseline = [...KNOWN_UNCOVERED].sort();

    const added = uncovered.filter((id) => !baseline.includes(id));
    const nowCovered = baseline.filter((id) => !uncovered.includes(id));

    expect(
      added,
      `These UI states are specified in specs/ux-states.md but NO test asserts them.\n` +
        `Write the test — do not add them to KNOWN_UNCOVERED:\n  ${added.join('\n  ')}`,
    ).toEqual([]);

    expect(
      nowCovered,
      `These are now covered — DELETE them from KNOWN_UNCOVERED so the number keeps falling:\n` +
        `  ${nowCovered.join('\n  ')}`,
    ).toEqual([]);
  });

  it('T-META-007b · the spec parser sees the whole state matrix', () => {
    // Guards against a regex that silently matched little or nothing, which
    // would make every other case here pass vacuously.
    expect(specIds.length).toBeGreaterThan(90);
    expect(specIds.every((id) => /^T-[A-Z0-9]+-\d+$/.test(id))).toBe(true);
  });

  it('T-META-007c · the suite scan sees a real corpus of collected specs', () => {
    // Same guard on the other input: if the walk returned nothing, EVERY spec
    // id would look uncovered and the baseline would balloon rather than fail
    // in a way anyone could read.
    expect(files.length).toBeGreaterThan(100);
    expect(asserted.size).toBeGreaterThan(300);
    expect(files.some((f) => f.startsWith('apps/web/test/'))).toBe(true);
    expect(files.some((f) => f.startsWith('tests/infra/'))).toBe(true);
  });

  it('T-META-007d · the detector fires on a gap AND stays quiet on a covered id', () => {
    // Positive control. "Reports nothing" and "reports everything" are both
    // broken detectors, so both directions are asserted here.
    const ids = ['T-UX-901', 'T-UX-902'];

    expect(uncoveredIds(ids, new Set(['T-UX-901']))).toEqual(['T-UX-902']);
    expect(uncoveredIds(ids, new Set(ids))).toEqual([]);
    expect(uncoveredIds(ids, new Set())).toEqual(ids);
  });

  it('T-META-007e · every baseline entry is real, unique and sorted', () => {
    // An entry that no longer appears in the spec is dead weight that hides
    // how large the real gap is.
    expect([...new Set(KNOWN_UNCOVERED)]).toHaveLength(KNOWN_UNCOVERED.length);
    expect([...KNOWN_UNCOVERED]).toEqual([...KNOWN_UNCOVERED].sort());

    const notInSpec = KNOWN_UNCOVERED.filter((id) => !specIds.includes(id));
    expect(notInSpec, `not named by specs/ux-states.md: ${notInSpec.join(', ')}`).toEqual([]);
  });

  it('T-META-007f · this file is excluded from the scan it feeds', () => {
    // Without the exclusion every KNOWN_UNCOVERED literal below would be found
    // HERE and counted as asserted, the uncovered set would collapse to empty,
    // and `a` would pass while measuring nothing. This is the single assertion
    // standing between this gate and being decoration.
    expect(files).not.toContain(SELF);

    // And prove it matters: a baseline id must NOT be reachable in the corpus
    // the scan actually reads. If this fails, either the exclusion broke or
    // somebody wrote a real test for the id and must delete it from the list.
    const firstGap = [...KNOWN_UNCOVERED].sort()[0];
    expect(firstGap).toBeDefined();
    expect(asserted.has(firstGap as string)).toBe(false);
  });
});
