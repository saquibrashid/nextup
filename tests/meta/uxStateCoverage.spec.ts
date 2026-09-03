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
  // `T-A11Y-006` (`specs/ui.md` §9 focus order) removed at the 13 → 12 step:
  // `T-A11Y-006a`-`g` in `apps/web/test/dialogFocus.spec.tsx`.
  // ⚠ ALL THREE DIALOGS SHIPPED WITH `aria-modal="true"` AND NONE OF THE
  // BEHAVIOUR IT PROMISES — no trap, no restore, no `Escape`. That pairing is
  // worse than an unlabelled div: `aria-modal` tells assistive technology the
  // rest of the page is inert, so tabbing out lands the user in content their
  // software has been told does not exist. `useDialogFocus` now supplies all
  // three, and `T-A11Y-006e` reads the expected set OFF THE SOURCE — every
  // component asserting `aria-modal` must call the hook — so a fourth dialog
  // cannot ship untrapped past a green suite.
  // ⚠ PARTIAL, AND THE RATCHET FORCED THE RETIREMENT (`T-META-007f` fails if
  // an id is both asserted and declared a gap). `specs/ux-states.md` §1
  // *"Focus after a state change"* — on success focus moves to the
  // `role="status"` region, on error to `role="alert"` — is CARRIED BY THE
  // SAME ID AND IS STILL UNASSERTED. ⚠ Do NOT read this removal as "focus
  // management is done", and do NOT close that clause by focusing every live
  // region: there are 53 across 23 components and most are AMBIENT
  // (`OfflineBanner`, `FreshnessStrip`, `FilterBar`'s count, the load-more
  // busy message). Focusing those would yank focus on every poll, which is a
  // worse defect than the one being fixed. Which regions are action outcomes
  // is an owner-level design decision, not a mechanical sweep.
  // ⚠ `T-AUTH-001` and `T-SEC-008` were removed at the 8 → 6 step, and NOT by
  // writing tests for them — both were retired from `specs/ux-states.md` §10.1
  // as wrong, with the full record in `specs/testing.md` §18.4.
  // `T-SEC-008` carried `specs/api.md` §7's claim that an unauthenticated
  // `/api/*` returns "401 with a JSON envelope". §18.2 measured the live
  // system in August and found 401 with an EMPTY body; §7 was never updated.
  // ⚠ It is the dangerous direction to "fix": the only way `/api/*` can answer
  // with the application's envelope is for application code to run, and the
  // only way that happens unauthenticated is an Easy Auth `excludedPaths`
  // bypass — which serves the owner's whole list at the platform edge while
  // `T-SEC-010`, `T-SEC-014` and every other allow-list test still passes,
  // because the middleware they exercise is never reached. `T-SMOKE-001`
  // asserts the ABSENCE of a body for exactly that reason.
  // `T-AUTH-001` was a level mismatch: the state is asserted against a real
  // deployment by `T-SMOKE-001`/`002` and its configuration by `T-INFRA-008`,
  // which is the substitution `specs/testing.md` §18 already makes.
  // ⚠ `T-AUTH-002`/`003`/`004` STAY. Each needs a real interactive sign-in,
  // and automating one means storing a credential in a public repository.
  'T-AUTH-002',
  'T-AUTH-003',
  'T-AUTH-004',
  // `T-UX-001` (§1 *"Never an indefinite spinner"*) removed at the 12 → 11
  // step, together with `T-UX-010` below: `T-UX-001a`-`h` and `T-UX-010a`-`e`
  // in `apps/web/test/slowResponse.spec.tsx`, a new file. Both ids go in one
  // step because neither is testable alone — the hook without a screen proves
  // only that a timer fires, and the screen without the hook proves only that
  // grey boxes render.
  // ⚠ NOTHING EXISTED. `SlowResponseNotice` was not a component that needed
  // improving: TASK-143 renamed it IN THE SPEC (from `ColdStartNotice`,
  // because `minReplicas = 1` means there is no cold start to name as the
  // cause) while it had never been built at all. §1's central promise was
  // documented, justified, renamed for accuracy — and enforced by nothing. A
  // hung request showed *"Loading your list…"* for ever, with no way to learn
  // it had stalled and nothing to retry.
  // ⚠ THE 15 s STATE IS THE ID, NOT THE 1200 ms ONE. *"Still working…"* is
  // always true while a request is pending, so alone it is an indefinite
  // spinner that has learned to talk. `T-UX-001d`/`e` pin the exit: `role=
  // "alert"`, a Retry, and the words *"Nothing has been changed"* — §1's
  // ASM-029 defence, since a timeout is exactly when the owner cannot tell
  // whether the request half-applied.
  // ⚠ TWO WEAK TESTS WERE FOUND BY MUTATION, NOT BY REVIEW. (1) Every
  // threshold was written `advance(SLOW_AFTER_MS - 1)`, which MOVES WITH the
  // constant it exists to pin — setting the source to 0 made the test advance
  // -1 ms and still pass. The literals 1200/15000 are now written out and the
  // constants asserted against them. (2) The absence assertions checked only
  // `slow-response`, so a component rendering the STALLED block early — a
  // worse defect — slipped straight through; both ids are now checked.
  // ⚠ `T-UX-001h` EXISTS BECAUSE `T-UX-001f` LOOKED SUFFICIENT AND WAS NOT.
  // Deleting `clearTimeout(stalled)` from the hook's cleanup survived the
  // whole first battery: `f` lets the first attempt run the full 15 s, so the
  // leaked timer has already fired and there is nothing left to leak. The leak
  // only bites when the first attempt settles EARLY, which is the common case.
  // `T-UX-002` (§2 "no fetch rejection path ends without a rendered message")
  // removed at the 19 → 18 step: `T-UX-002a`-`d` in
  // `apps/web/test/failurePaths.spec.tsx`, a new file.
  // ⚠ IT LOOKED COVERED SIX TIMES OVER. Every screen already had a failure
  // test — `listRoute`, `removedRoute`, `suppressedRoute`, `batchesOffline`,
  // `reviewCloseError` — and each asserts its exact copy, more strongly than
  // anything the new file does. What none of them could assert is the word §2
  // actually uses: **no**. A per-screen test proves the screens that HAVE a
  // test; it is silent about the next screen added. The expected set is
  // therefore read off `ROUTES` (already exported as data for `T-ATTR-002` /
  // `T-A11Y-001`), and which routes read is DISCOVERED by observing `fetch`
  // rather than declared, so neither list can drift.
  // Mutation-verified three ways, each killing exactly one case and naming the
  // route in its assertion message: swallowing a failed read
  // (`loadFailed={false}`) killed `T-UX-002a`+`c`; putting `Failed to fetch`
  // in the copy killed `T-UX-002b` alone; hiding the retry control killed
  // `T-UX-002c` alone. `T-UX-002d` is the floor that stops the fetch-discovery
  // trick exempting everything — measured at 6 fetching routes today,
  // asserted at >= 4.
  // ⚠ THE BATTERY EARNED ITS KEEP HERE. A first draft looped nine routes
  // inside one test using the GLOBAL `screen` query; Testing Library unmounts
  // between tests, not between `render` calls, so each route was credited with
  // the alerts left by the routes before it. The suite was green and the
  // `loadFailed={false}` mutation SURVIVED. The helper now queries the render's
  // own container and calls `cleanup()` between visits.
  // `T-UX-010` (§2.1 *"Loading (initial)"*) removed at the 12 → 11 step with
  // `T-UX-001` above. The list rendered ONE sentence where §2.1 specifies a
  // freshness-strip skeleton, a filter-bar skeleton and six row skeletons.
  // ⚠ SIX IS LOAD-BEARING, AND `T-UX-010a` PINS IT. A skeleton's whole job is
  // to claim the SHAPE of what is coming; one grey bar promises a list of one,
  // which tells the owner the same damaging lie about a full library that the
  // empty state would.
  // ⚠ THE SKELETONS ARE `aria-hidden` (`T-UX-010b`). Announcing six empty rows
  // describes a list that does not exist; the single `role="status"` wrapper
  // carries the message, which is why `T-DATA-002c` had to move from
  // `getByText` to `getByLabelText` in the same commit — the sentence became
  // the wrapper's accessible NAME, not visible text.
  // ⚠ `T-UX-010d`/`e` ARE THE WIRING CASES AND THEY ARE NOT REDUNDANT WITH
  // `T-UX-001a`-`h`. Those drive a probe component, so every one of them still
  // passes with `ListPage` never calling `useSlowRequest` at all — which is
  // precisely the state this screen was in. Stubbing the phase to `'normal'`
  // in the page kills `T-UX-010d`+`e` and nothing else.
  // `T-UX-015` (§2.6 the count) removed at the 15 → 14 step: `T-UX-015a`-`e`
  // in `apps/web/test/listCount.spec.tsx`, and the sentinel half at
  // `T-UX-015f`-`r` in `apps/web/test/loadMore.spec.tsx`. §2.6 is now covered
  // whole: the count no longer fabricates a total, AND the rest of the list is
  // reachable.
  // ~~"⚠ PARTIAL, DELIBERATELY. §2.6 has two halves and only ONE ships here...
  // The load-more sentinel that `specs/ui.md` §2.1 item 4 mandates is NOT
  // BUILT. `ListRoute` still never advances the cursor, so titles past
  // `DEFAULT_PAGE_LIMIT = 50` remain unreachable in the UI... ⚠ Do NOT read
  // this removal as 'pagination is done'."~~ — true for one PR, and now
  // superseded. ~~"`T-UX-073` is still the same gap in the REMOVED view."~~ —
  // also superseded: the removed view is wired in the same PR (below).
  // `T-UX-073` (§7.4 Partial) removed at the 14 → 13 step: `T-UX-073a`-`f` in
  // `apps/web/test/removedLoadMore.spec.tsx`. `RemovedRoute` now accumulates
  // pages through the same `useCursorPages` hook and renders the same
  // `LoadMoreSentinel`. ⚠ Mutation-verified with four mutations, and the third
  // SURVIVED the file as first written: deleting the `!loading` guard changed
  // nothing observable, because through the route `hasMore` is false whenever
  // page 1 is in flight, so `T-UX-073e` passed on that coincidence rather than
  // on the guard. `T-UX-073f` drives `RemovedPage` directly with the
  // contradictory `loading` + `hasMore` pair the guard exists to refuse — the
  // state a REFETCH reaches, where "Load more" would page a cursor belonging
  // to the query the owner just left.
  // `T-UX-016` (§2.7 Populated) removed at the 20 → 19 step: `T-UX-016a`-`d` in
  // `apps/web/test/titleList.spec.tsx`, a file that did not exist before.
  // ⚠ NOTHING imported `TitleList` or queried `title-list` at all, while the
  // component's own header forbids sorting, grouping and deduping and explains
  // why. Mutation-verified with the three things it forbids: a client-side
  // `sort()` by `sortDateAdded` killed `T-UX-016a` ALONE across all 47 web spec
  // files; a dedupe by `name` killed `T-UX-016c`; one row per LISTING killed
  // `T-UX-016b`. The sort is the dangerous one — it is invisible on a single
  // screenful and only misorders against the API cursor at the page boundary.
  // `T-UX-017` (§2.8 Partial data — TMDB stale) removed at the 9 → 8 step:
  // `T-UX-017a`-`i` in `apps/web/test/metadataStale.spec.tsx`.
  // ⚠ THIS ONE LOOKED LIKE A DELETED FEATURE AND WAS NOT. A46 dropped the
  // freshness-strip staleness nudge whole, and `specs/ui.md` §2.1 item 1 lists
  // "the stale chip" among the things it dropped — but that sentence is about
  // how long ago the OWNER last uploaded. This chip is the other, still-
  // required sense of the word (product invariant 8): TMDB unreachable or over
  // the 5 s budget while serving one page (NFR-014, REQ-076, `api.md` §6.4).
  // ⚠ THE FLAG HAD BEEN ON THE WIRE THE WHOLE TIME. `routes/titles.ts` emits
  // `metadataStale` on every item and `apiClient` casts parsed JSON straight
  // through, so the value arrived in the browser and was dropped for want of a
  // field on `TitleListItem`. Nine mutations run, all killed by the named
  // cases, alongside a comment-only negative control that survived. Three are
  // worth naming: dimming the chip's condition to `!unmatched` killed `g`
  // alone (the two chips are independent states); hiding the genres when stale
  // killed `d` alone (§2.8 says rows RENDER from stored metadata — the flag is
  // not an error); and a `TitleList` that passed `metadataStale: false` down
  // killed `f` alone, which is the shape of the real defect this closed.
  // `T-UX-020` (§2.11, the 403 full page) removed at the 17 → 15 step. It was
  // never a missing test — it was a MAPPING defect. The state is fully
  // covered by `T-UX-025a`–`h` in `apps/web/test/states.spec.tsx`, including
  // `T-UX-025b`, "the refusal renders no list data, no nav and no partial
  // UI", which is §2.11's exact claim word for word. Writing a `T-UX-020`
  // would have duplicated `T-UX-025b` verbatim and left the repo with two
  // names for one property — the shape that produces a "fix" applied to only
  // one of them. §2.11 was re-pointed at `T-UX-025` instead.
  // `T-UX-021` (§2.13 **Submitting (row action)**) removed at the 10 → 9 step:
  // `T-UX-021a`-`h` in `apps/web/test/rowPending.spec.tsx`, a new file.
  // ⚠ THE STATE WAS MODELLED AND RENDERED NOWHERE. `SuppressDialog` has
  // reported `'pending'` since TASK-102 and `ListPage` has stored it in
  // `rowStates` ever since — it simply never reached the row, so a write in
  // flight looked identical to an idle list. `TitleRow` now dims, sets
  // `aria-busy`, renders a labelled `role="status"` spinner and disables its
  // OWN control.
  // ⚠ THE SECOND HALF OF §2.13 IS THE REQUIREMENT: *"the rest of the list
  // stays interactive"*. A list-wide `busy` flag satisfies "the affected row
  // dims" — it dims that row too — while doing exactly what the sentence
  // forbids, and a frozen-looking list invites a reload, the one action that
  // can lose the in-flight write. `T-UX-021c` is the only case that fails
  // under that implementation, which is why it asserts the OTHER row.
  // ⚠ `T-UX-021h` IS THE WIRING CASE AND IS NOT REDUNDANT. Every other case
  // hands `TitleList` a set the test built, so all of them still pass with
  // `ListPage` deriving `pendingTitleIds` from nothing and passing an empty
  // set for ever — precisely the state the screen was in. Filtering the
  // derivation to `false` kills `T-UX-021h` and nothing else.
  // ⚠ The battery carried a NEGATIVE CONTROL (a comment-only edit) that
  // correctly SURVIVED, so the seven kills are evidence the tests discriminate
  // rather than evidence the harness fails everything it touches.
  // `T-UX-036` (§3.7, fix-match success with a suppression migration) removed
  // at the 22 → 20 step: `T-UX-036a`/`b` in `apps/web/test/fixMatchDialog.spec.tsx`.
  // ⚠ `T-UI-020i` already asserted the notice APPEARS when the response reports
  // a migration, and that is why this looked covered. It was not: nothing
  // asserted the other direction, so making the notice unconditional passed all
  // 22 cases in that file while telling the owner their "not interested" mark
  // had been moved on every fix-match, including ones where they never made
  // one. Mutation-verified: `suppressionMigrated !== null` → `!== undefined`
  // killed `T-UX-036b` alone.
  // `T-UX-040` (§4.1, `/upload` initial) removed at the 17 → 15 step:
  // `T-UX-040a`–`d` in `apps/web/test/uploadInitial.spec.tsx`.
  // ⚠ It could not be implemented until the SPEC was fixed. §4.1 said the
  // attach area was disabled with a visible reason; §4.0a, one row above it,
  // says a paste arriving before selection is held client-side and not
  // discarded. A disabled attach area cannot hold anything. The code has
  // always implemented §4.0a — `ImageDropzone` contains no `disabled` at all
  // — so §4.1 was corrected in place with the old wording struck through.
  // Mutation-verified all four ways, including by re-implementing the
  // superseded wording, which `T-UX-040a` and `b` both caught.
  // `T-UX-044` (§4.6, ceiling breached) removed at the 22 → 20 step:
  // `T-UX-044a`/`b`/`c` in `apps/web/test/imageDropzone.spec.tsx`.
  // ⚠ `T-UX-042b`/`c` call `reviewFiles()` directly and assert the returned
  // string; §4.6 is a RENDERED state, and only the FORMAT rejection was ever
  // asserted as rendered. Two mutations invisible to the old suite:
  // a generic "That file is too big." reason (killed `T-UX-044a`), and
  // `reviewFiles(files, 0)` instead of `accepted.length`, which lets the owner
  // walk past the 40-image ceiling over successive attaches (killed
  // `T-UX-044c` ALONE — no pre-existing case could see it).
  'T-UX-060',
  // ⚠ `T-UX-068` (§6.17, offline mid-review) IS LISTED DELIBERATELY AND MUST
  // NOT BE IMPLEMENTED TO CLEAR IT. It is `T-STATUS-001p`'s worked example of
  // a live probe, and a test asserting it here would make that example false.
  // (This note was truncated to a single dangling clause — "only because the
  // state was still unasserted when this gate landed; the" — from the commit
  // that created this file, and read as if it applied to whichever id happened
  // to sit under it. Restored in full.)
  'T-UX-068',
  'T-UX-069',
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
