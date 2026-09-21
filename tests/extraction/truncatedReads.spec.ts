/**
 * T-AI-059 — declared truncated reads, and the condition that governs them.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The 2026-09-18 live report (`docs/evaluation/golden-2026-09-18.md`) showed
 * the L5 false-title ceiling of 0.10 breached on two of three runs, and two of
 * the named false titles were plainly truncations of titles the corpus
 * expects:
 *
 *   `truncated-titles-01` · `dr strangelove or how i lear`   — 3 of 3 runs
 *   `truncated-titles-01` · `hitchhiker s guide to the`      — 3 of 3 runs
 *
 * The obvious reading is that each is ONE defect charged to TWO gates: the
 * full title goes missing (charged to recall) and a truncated stump appears in
 * its place (charged to false titles). That is the same double count the
 * chrome exclusion in `goldenScorer.ts` already exists to prevent, and
 * excusing it was the approved plan.
 *
 * ⚠ THE REPORT SAYS OTHERWISE, AND THE DIFFERENCE IS THE WHOLE POINT OF THIS
 * FILE. `truncated-titles-01` scored recall **1.000 in all three runs** — every
 * full title WAS found. The stumps appear ALONGSIDE the titles they truncate,
 * not instead of them. Nothing is charged twice; the stump is a genuine extra
 * junk row, the "one title split across several rows" recognition defect. It
 * must go on counting against L5, and the ceiling breach it contributes to is
 * real.
 *
 * So the machinery below is deliberately built to NOT fire here. Its headline
 * case (`T-AI-059a`) asserts that a declared truncation whose full title was
 * found is still counted as a false title. That is the assertion that stops a
 * future reader of the same report from drawing the obvious-but-wrong
 * conclusion and quietly deleting two real defects from the metric.
 *
 * ── WHY THE TRUNCATIONS ARE DECLARED, NOT DETECTED ─────────────────────────
 *
 * `ExpectedDoc.expectedTruncations` is hand-annotated ground truth. The
 * tempting alternative — "a candidate that is a prefix of an expected title is
 * a truncation" — cannot be made safe, and each guard one might reach for
 * fails on this very corpus:
 *
 *   - word-boundary test: rejects `dr strangelove or how i lear`, which cuts
 *     mid-word. It rejects the exact case it was written for.
 *   - length-ratio test: also rejects it (28 of 66 characters).
 *   - neither guard: excuses `true detective`, a prefix of `true detective
 *     night country` and a DIFFERENT REAL WORK the corpus expects on two
 *     images.
 *
 * Every heuristic either misses the defect or silently deletes a real false
 * title. Declaring them keeps the decision in the diff where the owner can see
 * it, and `T-AI-059b` stops a typo declaring something unrelated.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_RECORDING_MODEL_ID } from '../../apps/api/src/extraction/recordings.js';

import { aggregate, excusedTruncations, expectedFor, manifest, scoreAll } from './goldenScorer.js';

describe('T-AI-059 — declared truncated reads', () => {
  it('T-AI-059a — a declared truncation is STILL a false title when its full title was found', () => {
    const doc = expectedFor('truncated-titles-01');
    const declared = doc.expectedTruncations;
    expect(declared.length).toBeGreaterThan(0);

    // ⚠ THIS CASE IS DRIVEN FROM THE LIVE REPORT, NOT FROM `scoreAll`, AND THE
    // REASON IS THAT `scoreAll` CANNOT SEE THE DEFECT. Offline the recorded
    // reader expands every truncated caption into a full `identifiedTitle`, so
    // no stump is ever a candidate and an assertion over the replayed corpus
    // is true whatever the rule does — it would pass with the rule deleted.
    // (Found while mutation-proving: M1 removed the governing condition and
    // this case, in its first form, stayed green.)
    //
    // The stumps below are the exact strings `docs/evaluation/golden-2026-09-18.md`
    // records `gpt-4.1` emitting on this image in 3 of 3 LIVE runs, and the
    // found-set is that report's measured recall of 1.000 — every expected
    // title present. That is the shape the rule must refuse to excuse.
    const liveStumps = ['dr strangelove or how i lear', 'hitchhiker s guide to the'];
    for (const stump of liveStumps) {
      expect(
        declared.some((t) => t.truncated === stump),
        `${stump} must be declared by the answer key`,
      ).toBe(true);
    }
    const foundEverything = new Set(doc.expectedCandidates.map((c) => c.normalisedText));

    expect(excusedTruncations(liveStumps, declared, foundEverything)).toEqual([]);

    // Non-vacuity: the same call DOES excuse them once the titles go missing,
    // so the empty result above is the condition working, not the rule being
    // unreachable.
    expect(excusedTruncations(liveStumps, declared, new Set())).toEqual(liveStumps);
  });

  it('T-AI-059b — every declared truncation is a strict prefix of the title it names', () => {
    for (const image of manifest.images) {
      for (const t of expectedFor(image.id).expectedTruncations) {
        expect(
          t.of.startsWith(t.truncated) && t.truncated.length < t.of.length,
          `${image.id}: "${t.truncated}" must be a strict prefix of "${t.of}"`,
        ).toBe(true);
      }
    }
  });

  it('T-AI-059c — the rule turns on whether the full title was found, and nothing else', () => {
    const truncations = [
      { truncated: 'dr strangelove or how i lear', of: 'dr strangelove or how i learned' },
    ];
    const stump = ['dr strangelove or how i lear'];

    // Full title MISSING — one defect, two gates. Excused.
    expect(excusedTruncations(stump, truncations, new Set())).toEqual(stump);

    // Full title FOUND — the stump is an extra junk row on top of a correct
    // read. NOT excused. This is the live shape on `truncated-titles-01`.
    expect(
      excusedTruncations(stump, truncations, new Set(['dr strangelove or how i learned'])),
    ).toEqual([]);

    // An undeclared string is never excused, however prefix-like it looks.
    expect(excusedTruncations(['true detective'], truncations, new Set())).toEqual([]);
  });

  it('T-AI-059d — the aggregate NAMES every excused read rather than hiding it', async () => {
    const scored = await scoreAll(DEFAULT_RECORDING_MODEL_ID);
    const agg = aggregate(scored);
    // Offline nothing is excused, so the list is empty — but it must EXIST, so
    // that a report rendering it cannot silently omit the field.
    expect(Array.isArray(agg.truncatedReads)).toBe(true);
    expect(agg.truncatedReads).toEqual(
      scored.flatMap((s) => s.truncatedReads.map((t) => `${s.image.id}: ${t}`)),
    );
  });

  it('T-AI-059e — an answer key that declares no truncations reads as an empty list, never undefined', () => {
    const doc = expectedFor('blank-no-content-01');
    expect(doc.expectedTruncations).toEqual([]);
  });
});
