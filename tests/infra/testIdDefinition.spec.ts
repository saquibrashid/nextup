/**
 * T-META-009 — a test that RUNS must be a test that was SPECIFIED.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `tools/check-orphan-tests.mjs` guards one direction and states it plainly:
 *
 *   Defined ids that no task cites AND no suite implements.
 *
 * That is `defined ∧ ¬cited ∧ ¬implemented` — an acceptance criterion written
 * down and then never built. It is a real failure mode and `T-META-006` is a
 * good gate for it.
 *
 * ⚠ **The INVERSE direction was guarded by nothing.** A test that runs in CI,
 * gates every merge, and is defined in no spec at all passes every gate in
 * this repo. `check:test-ids` verifies that ids the BACKLOG cites are defined;
 * `T-META-001` verifies that every AC has a test; `T-META-004` verifies the id
 * is in title position. None of them ever asks the opposite question: does
 * this id that CI is enforcing correspond to a written requirement?
 *
 * Thirty-five did. Ten of those appeared in no `specs/**` or `docs/**` file
 * anywhere — not as a definition, not as a citation, not in prose.
 *
 * The clearest was `T-META-007`. It is a six-case ratchet over the whole
 * `specs/ux-states.md` matrix, complete with its own positive control and its
 * own exclusion proof; `tools/check-orphan-tests.mjs` cites it by name as
 * precedent for its own design; `apps/web/test/batchStatusPage.spec.tsx`
 * records a bug it caught. And `specs/testing.md` — the document NFR-003 makes
 * the definition of done — had never heard of it. Delete it and no gate
 * noticed. Read the spec to learn which gates exist and you would not find it.
 *
 * It is defined now, in the same change that added this gate, which is why the
 * baselines below read 34 and 9 rather than 35 and 10. That was not tidying:
 * the §12 row for THIS gate names `T-META-007` while explaining the finding,
 * which by itself would have moved it out of the ghost set on a technicality.
 * Describing a hole is not the same as filling it, and quietly letting the
 * prose satisfy the predicate would have been gaming the ratchet, so the row
 * was written properly instead.
 *
 * This is the fourth instance of one pattern in this repo, after `T-INFRA-016`
 * (e2e typechecked by nothing), `T-CI-008` (spec files collected by no runner)
 * and `T-META-008` (cross-file id uniqueness owned by a gate that never
 * checked it). The generalisation: **a property everyone assumes some other
 * gate covers is exactly the property nothing covers.**
 *
 * ── What "defined" means here, and why it is strict ─────────────────────────
 *
 * `definedTestIds()` counts an id only when it appears in a table cell that
 * contains nothing but ids. A passing MENTION in prose does not define a test.
 * That strictness is the point: 25 of the 35 ARE mentioned somewhere — in
 * `specs/ux-states.md`, `specs/ai.md`, `specs/data-model.md`, even in
 * `specs/testing.md`'s own prose — while having no row in the AC→test mapping
 * that NFR-003 requires. "Mentioned in a sentence" and "specified" are not the
 * same claim, and collapsing them would let the debt hide.
 *
 * `T-META-009f` therefore splits the baseline rather than averaging it: the
 * ten GHOSTS, which appear in no document at all, are tracked separately from
 * the twenty-five that are merely in the wrong place. They are different
 * repairs — one needs a row written, the other needs a row moved.
 *
 * ── The `T-FAKE-` namespace is not tests ────────────────────────────────────
 *
 * This gate's own first draft baselined `T-FAKE-006` as a ghost. It is not a
 * test: it is a synthetic id inside a STRING LITERAL in `orphanTests.spec.ts`,
 * planted into a scratch directory to prove that scanner distinguishes a real
 * `it()` title from an id in a comment or an array. The scan reads it as a
 * title because, in the file it is quoted in, it lexically is one.
 *
 * `T-FAKE-\d+` is an established convention here for exactly that — synthetic
 * ids in gate self-tests, used across `orphanTests.spec.ts`, `status.spec.ts`,
 * `invariantCoverage.spec.ts` and this file. So it is EXCLUDED rather than
 * baselined. Baselining it would have been worse than noise: a ratchet entry
 * that can never legitimately be paid down invites someone to write a spec row
 * for a test that does not exist, which is the mis-citation class again.
 * `T-META-009a` proves the exclusion is both in force and doing work.
 *
 * ── The baselines are ratchets, not permissions ─────────────────────────────
 *
 * Neither list asserts its entries are acceptable. Writing 35 spec rows means
 * deciding, 35 times, which acceptance criterion each test belongs to — and a
 * guess is precisely the mis-citation class that produced this state. So the
 * lists are recorded, may only SHRINK, and are pinned EXACTLY in both
 * directions so that documenting one forces the list to be corrected in the
 * same change. Adding an entry is never the correct fix for a failure here:
 * write the spec row instead.
 *
 * ⚠ `T-META-009a` is a positive control and it is load-bearing, not ceremony.
 * `b`, `d` and `f` are all set DIFFERENCES against a scanned corpus, so if the
 * scan returns nothing they pass vacuously and report success on an empty
 * suite. That failure mode has already been demonstrated against `T-META-008`.
 *
 * ── Paid down: 33 → 0, and the ghost class with it ─────────────────────────
 *
 * The nine `T-DM-*` entries (`T-DM-002` and `T-DM-020`-`027`) were written up
 * in `specs/testing.md` §12.1, which already exists for this exact class
 * (implemented, never listed). The remaining 24 — `T-AI-019`, `T-CI-006`,
 * `T-CI-008`, `T-INFRA-003`, `T-SEC-006`, `T-UNDO-005` and the `T-UX-0xx`
 * block — were §12.3's class and are imported in **§12.5**: most were fully
 * specified in `specs/ux-states.md`, with wording, controls and the state's
 * number, and had simply never reached the document NFR-003 makes the
 * definition of done.
 *
 * Nothing was invented for either group; each row states what the suite
 * already asserts. Several turned out to be guarding named product invariants
 * (`T-DM-021` is the schema-level enforcement of REQ-071, `T-DM-002g` pins the
 * digest that every stored unmatched identity and every suppression depends
 * on, `T-CI-008` is invariant 21's own gate). ⚠ That is the argument for this
 * gate rather than against it: the tests protecting several of the most
 * load-bearing invariants in the system were the ones no document mentioned.
 *
 * With both lists empty, `b` is a flat rule and `a` is what keeps it honest.
 *
 * ⚠ **A SHORTHAND RANGE CELL DEFINES NOTHING.** `T-DM-025` stayed in the
 * undefined list while §29.1 carried a row reading `` `T-DM-025e`-`f` ``,
 * because `f` alone is not an id and so survives as residue — the cell is
 * prose by `definedTestIds`' rule. The abbreviation is used widely in the
 * per-task sections (`` `T-IMG-013a`-`d` `` and friends) and reads perfectly
 * to a human, which is precisely why it is worth knowing that it contributes
 * NO definition. Those ids are defined only because some other cell names them
 * in full. Write the ids out, or slash-separate them.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { definedTestIds } from '../../tools/check-test-ids.mjs';
import { implementedTestIds } from '../../tools/check-orphan-tests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Ids the suite runs that have NO defining row in `specs/testing.md`.
 *
 * ⚠ **EMPTY — THE DEBT IS PAID, AND THE GATE IS NOW ABSOLUTE.** All 33 entries
 * were written up rather than tolerated (see the header). `T-META-009b` is
 * consequently a flat rule with no exceptions: **a test id that runs in CI has
 * a defining row, or the build fails.**
 *
 * ⚠ MAY ONLY SHRINK — which, at zero, means it may not grow. `T-META-009c`
 * pins the size exactly, in both directions, so re-introducing an exception is
 * a two-line change a reviewer cannot miss rather than one quiet line in a
 * list. The fix for a failure is a row in `specs/testing.md` §12, never an
 * edit here.
 */
const BASELINE_UNDEFINED = new Set<string>([]);

/**
 * The subset of `BASELINE_UNDEFINED` that appears in NO `specs/**` or
 * `docs/**` markdown at all — not defined, not cited, not mentioned in prose.
 *
 * These were strictly worse than the rest of the baseline: the others were
 * documented in the wrong place and could be moved, while for these the only
 * surviving description of what the test protected was the test itself. The
 * eight were the whole `packages/domain/test/**` schema and identity suite,
 * covering the suppression invariant, the match-state triple, the two size
 * ceilings and the pinned `'Dune'` digest.
 *
 * ⚠ **BOTH LISTS ARE NOW EMPTY, WHICH MAKES `f` THE VACUITY RISK IT WAS
 * WRITTEN TO CATCH IN OTHERS.** Every set operation in `f` iterates
 * `BASELINE_UNDEFINED`, so at zero they all pass over nothing — the earlier
 * mutation (pointing `documentationCorpus()` at a directory that does not
 * exist) failed `f` only while the list was non-empty, and would not now. `f`
 * therefore asserts the corpus is real before it asserts anything about it,
 * exactly as `a` does for the scan. Without that it would be a green test over
 * an empty read, which is the failure mode this whole file exists to report.
 *
 * ⚠ MAY ONLY SHRINK. `T-META-009f` pins the size exactly, in both directions.
 */
const BASELINE_GHOSTS = new Set<string>([]);

/** Every `.md` under `specs/` and `docs/`, concatenated. */
function documentationCorpus(root = ROOT): string {
  let corpus = '';
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) corpus += readFileSync(full, 'utf8');
    }
  };
  walk(path.join(root, 'specs'));
  walk(path.join(root, 'docs'));
  return corpus;
}

/**
 * Ids reserved for synthetic fixtures in gate self-tests. Never real tests.
 * See the header: these are quoted inside string literals that the title scan
 * legitimately reads as titles.
 */
const SYNTHETIC_ID_RE = /^T-FAKE-\d+$/;

/**
 * The two scanned inputs, read through ONE function.
 *
 * ⚠ THE SHARING IS DELIBERATE AND WAS FORCED BY A MUTATION. `T-META-009a` was
 * first written to re-derive these itself. Blinding the scan that `b` consumes
 * then left `a` GREEN — the control was verifying a different read of the disk
 * from the one under test, which is not a control at all. `a` and `b` now see
 * the same bytes, so a blinded scan fails the control that exists to catch it.
 */
function scanned(): { implemented: Set<string>; defined: Set<string> } {
  const implemented = new Set(
    [...implementedTestIds(ROOT)].filter((id) => !SYNTHETIC_ID_RE.test(id)),
  );
  return {
    implemented,
    defined: definedTestIds(readFileSync(path.join(ROOT, 'specs', 'testing.md'), 'utf8')),
  };
}

function undefinedImplementedIds(): string[] {
  const { implemented, defined } = scanned();
  return [...implemented].filter((id) => !defined.has(id)).sort();
}

describe('T-META-009 every test id the suite runs is defined in specs/testing.md', () => {
  it('T-META-009a · the scan sees a real corpus of specs AND a real spec document', () => {
    const { implemented, defined } = scanned();

    // Without these, b/d/f are differences against an empty set and pass while
    // asserting nothing. This is the mutation that left `T-META-008b` green.
    expect(implemented.size).toBeGreaterThan(300);
    expect(defined.size).toBeGreaterThan(300);
    expect(implemented.has('T-META-009')).toBe(true);
    expect(defined.has('T-META-009')).toBe(true);

    // The synthetic-id exclusion is IN FORCE and is DOING WORK. If the raw scan
    // ever stops seeing a `T-FAKE-` id the exclusion has become decorative and
    // the next fixture id will be baselined as debt, which is how `T-FAKE-006`
    // reached this file's first draft.
    expect([...implementedTestIds(ROOT)].some((id) => SYNTHETIC_ID_RE.test(id))).toBe(true);
    expect([...implemented].some((id) => SYNTHETIC_ID_RE.test(id))).toBe(false);
    expect([...defined].some((id) => SYNTHETIC_ID_RE.test(id))).toBe(false);
  });

  it('T-META-009b · no NEW test id runs without a defining row in the spec', () => {
    const offenders = undefinedImplementedIds().filter((id) => !BASELINE_UNDEFINED.has(id));

    expect(
      offenders,
      `These ids run in CI but are defined by no row in specs/testing.md, so they gate ` +
        `every merge while protecting no written requirement. Add a row to §12 — do NOT ` +
        `add them to BASELINE_UNDEFINED, which may only shrink.`,
    ).toEqual([]);
  });

  it('T-META-009c · the undefined baseline is pinned exactly, in both directions', () => {
    expect(BASELINE_UNDEFINED.size).toBe(0);
  });

  it('T-META-009d · every baselined id is still implemented and still undefined', () => {
    const stillUndefined = new Set(undefinedImplementedIds());
    const resolved = [...BASELINE_UNDEFINED].filter((id) => !stillUndefined.has(id)).sort();

    expect(
      resolved,
      `These are recorded as undefined but are no longer: either a spec row was written ` +
        `or the test was deleted. Remove them from BASELINE_UNDEFINED (and BASELINE_GHOSTS) ` +
        `and update the size pins, so the list cannot become a museum of fixed bugs.`,
    ).toEqual([]);
  });

  it('T-META-009e · "defined" means a defining row, not a passing mention', () => {
    // The distinction the whole gate rests on: 25 of the 35 are mentioned in
    // some document. If a mention counted, the debt would read as paid.
    expect(definedTestIds('| `T-FAKE-999` | S | asserts a thing |').has('T-FAKE-999')).toBe(true);
    expect(definedTestIds('See `T-FAKE-999` for the rationale.').has('T-FAKE-999')).toBe(false);
    expect(definedTestIds('| covered by `T-FAKE-999` today |').has('T-FAKE-999')).toBe(false);
  });

  it('T-META-009f · the ghost subset is a subset, is real, and is pinned exactly', () => {
    const corpus = documentationCorpus();
    const stillUndefined = new Set(undefinedImplementedIds());

    // ⚠ VACUITY GUARD. Every check below iterates BASELINE_UNDEFINED, which is
    // now empty, so all of them pass over nothing and a blinded corpus would
    // go unnoticed. Assert the read is real first — the same lesson `a`
    // records for the suite scan.
    expect(corpus.length).toBeGreaterThan(100_000);
    expect(corpus.includes('T-META-009')).toBe(true);

    for (const id of BASELINE_GHOSTS) {
      expect(BASELINE_UNDEFINED.has(id), `${id} is a ghost but not in BASELINE_UNDEFINED`).toBe(
        true,
      );
      expect(stillUndefined.has(id), `${id} is recorded as a ghost but is now defined`).toBe(true);
      expect(
        corpus.includes(id),
        `${id} is recorded as a ghost but now appears in a document`,
      ).toBe(false);
    }

    const newGhosts = [...BASELINE_UNDEFINED].filter(
      (id) => !corpus.includes(id) && !BASELINE_GHOSTS.has(id),
    );
    expect(
      newGhosts,
      `These run in CI and are described in no document anywhere. The only surviving ` +
        `statement of what they protect is the test body. Write the spec row.`,
    ).toEqual([]);

    expect(BASELINE_GHOSTS.size).toBe(0);
  });
});
