/**
 * TASK-057 — stage-2 deterministic clean-up (`specs/ai.md` §3).
 *
 * Test ids: `T-AI-004` (every verdict represented, nothing dropped),
 * `T-AI-032` (unsupported primary-reader inferences are visibly flagged),
 * `T-AI-043` (a truncated caption resolves to the complete work while
 * `rawText` keeps the ellipsis).
 *
 * ⚠ `T-AI-030` is NOT asserted here and deliberately so. It is a CORPUS
 * metric — title recall ≥ 0.95, false-title rate ≤ 0.10, chrome rejection
 * ≥ 0.80 (`specs/testing.md` §14) — measured by the golden suite against
 * recorded provider responses. Those recordings do not exist yet
 * (same blocker as `T-AI-039`/`T-AI-032`), and a unit file cannot produce a
 * recall figure from fixtures it wrote itself: it would be measuring its own
 * opinion of what a title looks like. Recorded as an outstanding criterion on
 * the backlog row rather than quietly satisfied by a proxy.
 *
 * ⚠ `T-AI-004` is typed `I` in §9 and asserts reachability through the REVIEW
 * RESPONSE, which does not exist yet (TASK-059). What is proved here is the
 * half that is decidable now and that the integration test depends on: the
 * classifier produces every verdict, and drops nothing. The response half
 * stays with TASK-059.
 *
 * ⚠ ALL BOXES ARE NORMALISED 0..1, not pixels — a pixel fixture type-checks
 * and then silently fails every geometry assertion.
 */

import { describe, expect, it } from 'vitest';

import { CLEANUP_VERDICTS, type CleanupVerdict } from '../src/enums.js';
import {
  DIGIT_SYMBOL_RATIO_CEILING,
  EXTRACT_CONFIDENCE_FLOOR,
  cleanup,
  digitSymbolRatio,
  extractYear,
  groupReadingOrder,
  isChromeTerm,
} from '../src/extraction/index.js';
import type { ExtractedTextItem, NormalisedBox } from '../src/extraction/TitleExtractor.js';

const NOW = new Date('2026-08-19T00:00:00Z');

const box = (x: number, y: number, w = 0.2, h = 0.05): NormalisedBox => ({ x, y, w, h });

function llm(over: Partial<ExtractedTextItem> = {}): ExtractedTextItem {
  return {
    rawText: 'Arcane',
    inferredTitle: 'Arcane',
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    boundingBox: box(0.1, 0.1),
    boxSource: 'ocr',
    confidence: 0.9,
    ...over,
  };
}

function ocr(over: Partial<ExtractedTextItem> = {}): ExtractedTextItem {
  return llm({
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'not-checked',
    provider: 'ocr-only',
    boxSource: 'ocr',
    ...over,
  });
}

const verdicts = (items: readonly ExtractedTextItem[]): CleanupVerdict[] =>
  cleanup(items, { now: NOW }).map((c) => c.cleanupVerdict);

describe('cleanup — classify and surface, never drop (T-AI-004)', () => {
  it('T-AI-004a returns a verdict for every item and never returns fewer', () => {
    const items = [
      llm(),
      llm({ rawText: 'Dune', inferredTitle: 'Dune', confidence: 0.2 }),
      ocr({ rawText: 'My List', boundingBox: box(0.1, 0.5) }),
      ocr({ rawText: 'S2:E4', boundingBox: box(0.1, 0.7) }),
      llm({ rawText: '', inferredTitle: null, basis: 'unknown' }),
    ];

    const out = cleanup(items, { now: NOW });

    expect(out).toHaveLength(items.length);
    for (const candidate of out) {
      expect(CLEANUP_VERDICTS).toContain(candidate.cleanupVerdict);
    }
  });

  it('T-AI-004b produces a fixture containing one item of every verdict', () => {
    // The precondition `T-AI-004`'s integration half needs: a batch in which
    // all five verdicts are genuinely reachable.
    const produced = new Set(
      verdicts([
        llm(),
        llm({ confidence: 0.4 }),
        llm({ ocrSupport: 'none' }),
        llm({ rawText: '', inferredTitle: null, basis: 'unknown' }),
        ocr({ rawText: 'Continue Watching', boundingBox: box(0.1, 0.9) }),
      ]),
    );

    expect([...produced].sort()).toEqual([...CLEANUP_VERDICTS].sort());
  });

  it('T-AI-004c never drops a candidate whose text is pure chrome', () => {
    const out = cleanup([ocr({ rawText: 'Downloads' })], { now: NOW });

    // Classified, not deleted. `chrome-suspected` is a collapsed group with a
    // count and a one-click "this is a title", never an omission.
    expect(out).toHaveLength(1);
    expect(out[0]?.cleanupVerdict).toBe('chrome-suspected');
    expect(out[0]?.item.rawText).toBe('Downloads');
  });

  it('T-AI-004d shows an unreadable tile in the main list, not the chrome group', () => {
    // FINDING 1. Read in §3.2's literal step order the length gate fires first
    // and stamps this `chrome-suspected`, which contradicts step 7b and §3.3.
    const out = cleanup([llm({ rawText: '', inferredTitle: null, basis: 'unknown' })], {
      now: NOW,
    });

    expect(out[0]?.cleanupVerdict).toBe('unreadable-tile');
  });

  it('T-AI-004e flags an unsupported model title above a low-confidence caution', () => {
    // §3.2 numbers step 7 before 7a, but `inferred-unverified` is the RSK-028
    // fabrication mitigation and drives a MANDATORY thumbnail beside the
    // title; `low-confidence` drives a sentence. Losing the former is
    // unrecoverable.
    expect(verdicts([llm({ ocrSupport: 'none', confidence: 0.1 })])).toEqual([
      'inferred-unverified',
    ]);
  });

  it('T-AI-004f applies the chrome vocabulary to OCR orphans only', () => {
    // `Max` is both a streaming service and a real work. Applying a fixed
    // vocabulary to the primary reader would suppress the film.
    expect(verdicts([llm({ rawText: 'Max', inferredTitle: 'Max' })])).toEqual(['title-candidate']);
    expect(verdicts([ocr({ rawText: 'Max' })])).toEqual(['chrome-suspected']);
  });

  it('T-AI-004g matches chrome exactly, never as a substring', () => {
    expect(isChromeTerm('play')).toBe(true);
    expect(isChromeTerm('  PLAY  ')).toBe(true);
    // The 2005 film. A substring test would delete it.
    expect(isChromeTerm('The Play')).toBe(false);
    expect(isChromeTerm('Home Alone')).toBe(false);
  });

  it('T-AI-004h matches a chrome term containing punctuation', () => {
    // `normaliseTitleText` maps `&` to a space, so a normalised comparison
    // would never match this entry.
    expect(isChromeTerm('New & Popular')).toBe(true);
  });

  it('T-AI-004i flags a below-floor confidence and leaves the boundary alone', () => {
    expect(verdicts([llm({ confidence: EXTRACT_CONFIDENCE_FLOOR - 0.01 })])).toEqual([
      'low-confidence',
    ]);
    expect(verdicts([llm({ confidence: EXTRACT_CONFIDENCE_FLOOR })])).toEqual(['title-candidate']);
  });

  it('T-AI-004j catches the digit-ratio rule\u2019s own two examples', () => {
    // FINDING 2. Both of §3.2's named examples compute to EXACTLY 0.60, so the
    // spec's strict `>` catches neither.
    expect(digitSymbolRatio('1h 52m')).toBeCloseTo(DIGIT_SYMBOL_RATIO_CEILING, 10);
    expect(digitSymbolRatio('S2:E4')).toBeCloseTo(DIGIT_SYMBOL_RATIO_CEILING, 10);
    expect(verdicts([ocr({ rawText: '1h 52m' })])).toEqual(['chrome-suspected']);
    expect(verdicts([ocr({ rawText: 'S2:E4' })])).toEqual(['chrome-suspected']);
  });

  it('T-AI-004k leaves an ordinary OCR title below the digit ceiling alone', () => {
    expect(verdicts([ocr({ rawText: "Ocean's 11" })])).toEqual(['title-candidate']);
  });

  it('T-AI-004l is pure — the same input classifies identically twice', () => {
    const items = [llm(), ocr({ rawText: 'Top 10', boundingBox: box(0.5, 0.5) })];
    expect(cleanup(items, { now: NOW })).toEqual(cleanup(items, { now: NOW }));
  });
});

describe('unsupported inferences (T-AI-032)', () => {
  it('T-AI-032a flags every LLM item with no OCR support as inferred-unverified', () => {
    const out = cleanup(
      [
        llm({ rawText: '', inferredTitle: 'The Last of Us', basis: 'artwork', ocrSupport: 'none' }),
        llm({ rawText: 'Visible text', inferredTitle: 'Invented Work', ocrSupport: 'none' }),
      ],
      { now: NOW },
    );

    expect(out.map((candidate) => candidate.cleanupVerdict)).toEqual([
      'inferred-unverified',
      'inferred-unverified',
    ]);
  });

  it('T-AI-032b does not flag unchecked or corroborated primary-reader items as fabricated', () => {
    expect(
      verdicts([
        llm({ ocrSupport: 'not-checked' }),
        llm({ rawText: 'The Crwon', inferredTitle: 'The Crown', ocrSupport: 'partial' }),
        llm({ ocrSupport: 'exact' }),
      ]),
    ).toEqual(['title-candidate', 'title-candidate', 'title-candidate']);
  });
});

describe('cleanup — year extraction (T-AI-004)', () => {
  it('T-AI-004m lifts a parenthesised year out of the matching text', () => {
    const out = cleanup([llm({ rawText: 'Dune (2021)', inferredTitle: 'Dune (2021)' })], {
      now: NOW,
    });

    expect(out[0]?.matchText).toBe('Dune');
    expect(out[0]?.extractedYear).toBe(2021);
    // Verbatim, always (§3.1a).
    expect(out[0]?.item.rawText).toBe('Dune (2021)');
  });

  it('T-AI-004n lifts a trailing year', () => {
    const out = cleanup([llm({ rawText: 'Dune 2021', inferredTitle: 'Dune 2021' })], { now: NOW });
    expect(out[0]?.matchText).toBe('Dune');
    expect(out[0]?.extractedYear).toBe(2021);
  });

  it('T-AI-004o keeps a title that IS a year', () => {
    // Stripping it empties `matchText`, which step 8 then stamps
    // `chrome-suspected` — the film disappears into the collapsed group — and
    // records a year the §4.2 matcher penalises against the real 2019.
    const out = cleanup([llm({ rawText: '1917', inferredTitle: '1917' })], { now: NOW });

    expect(out[0]?.matchText).toBe('1917');
    expect(out[0]?.extractedYear).toBeNull();
    expect(out[0]?.cleanupVerdict).toBe('title-candidate');
  });

  it('T-AI-004u keeps a year that is the whole text on BOTH lift paths', () => {
    // ⚠ `'1917'` alone matches NEITHER regex, so the case above proves the
    // outcome without ever reaching the "would this empty the text?" guard —
    // it survived a mutation that deleted the guard. These two DO reach it:
    // a parenthesised-only caption, and a trailing year behind OCR's leading
    // whitespace.
    expect(extractYear('(2012)', NOW)).toEqual({ text: '(2012)', year: null });
    expect(extractYear(' 2012', NOW)).toEqual({ text: ' 2012', year: null });
  });

  it('T-AI-004p ignores an implausible year', () => {
    expect(extractYear('Blade Runner 2049', NOW).year).toBeNull();
    expect(extractYear('Something 1492', NOW).year).toBeNull();
    expect(extractYear('Movie 2031', NOW).year).toBe(2031);
    expect(extractYear('Movie 2032', NOW).year).toBeNull();
  });
});

describe('cleanup — reading-order grouping (T-AI-004)', () => {
  it('T-AI-004q merges OCR fragments on one line and keeps both texts', () => {
    const out = groupReadingOrder([
      ocr({ rawText: 'Breaking', boundingBox: box(0.1, 0.2, 0.15, 0.04) }),
      ocr({ rawText: 'Bad', boundingBox: box(0.26, 0.2, 0.08, 0.04) }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]?.rawText).toBe('Breaking Bad');
  });

  it('T-AI-004r never merges primary-reader tiles', () => {
    // They are already one-per-tile; merging would fuse two distinct works.
    const out = groupReadingOrder([
      llm({ rawText: 'Arcane', boundingBox: box(0.1, 0.2, 0.15, 0.04) }),
      llm({ rawText: 'Dune', boundingBox: box(0.26, 0.2, 0.08, 0.04) }),
    ]);

    expect(out).toHaveLength(2);
  });

  it('T-AI-004s does not merge across a wide horizontal gap', () => {
    const out = groupReadingOrder([
      ocr({ rawText: 'Arcane', boundingBox: box(0.1, 0.2, 0.15, 0.04) }),
      ocr({ rawText: 'Dune', boundingBox: box(0.6, 0.2, 0.08, 0.04) }),
    ]);

    expect(out).toHaveLength(2);
  });

  it('T-AI-004t takes the worst confidence of a merged group', () => {
    // A merged caption is only as trustworthy as its least trustworthy
    // fragment; averaging would carry a doubtful fragment over the floor.
    const out = groupReadingOrder([
      ocr({ rawText: 'Breaking', boundingBox: box(0.1, 0.2, 0.15, 0.04), confidence: 0.9 }),
      ocr({ rawText: 'Bad', boundingBox: box(0.26, 0.2, 0.08, 0.04), confidence: 0.3 }),
    ]);

    expect(out[0]?.confidence).toBe(0.3);
  });

  it('T-AI-004ai never merges a chrome label into its neighbour', () => {
    // ⚠ THE BUG THIS EXISTS FOR (TASK-195, TASK-079 finding 2). Step 1 runs
    // BEFORE step 3, and a navigation bar is a row of labels well inside
    // `OCR_MERGE_GAP` of each other. Merged, they become `NETFLIX Home Shows
    // Movies` — a string the UI never rendered, which the exact-match
    // vocabulary can never match however many terms it gains. The whole
    // navigation bar then reached the owner as title candidates.
    const out = groupReadingOrder([
      ocr({ rawText: 'NETFLIX', boundingBox: box(0.02, 0.02, 0.08, 0.02) }),
      ocr({ rawText: 'Home', boundingBox: box(0.11, 0.02, 0.05, 0.02) }),
      ocr({ rawText: 'Shows', boundingBox: box(0.17, 0.02, 0.05, 0.02) }),
    ]);

    expect(out.map((i) => i.rawText)).toEqual(['NETFLIX', 'Home', 'Shows']);
  });

  it('T-AI-004aj still merges genuine caption fragments beside a chrome label', () => {
    // The limit on `v`, and the reason it is scoped to the label itself rather
    // than to the row: refusing every merge on a row that happens to contain
    // chrome would split two-line captions back apart and undo `q`.
    const out = groupReadingOrder([
      ocr({ rawText: 'Search', boundingBox: box(0.02, 0.02, 0.06, 0.02) }),
      ocr({ rawText: 'Breaking', boundingBox: box(0.1, 0.2, 0.15, 0.04) }),
      ocr({ rawText: 'Bad', boundingBox: box(0.26, 0.2, 0.08, 0.04) }),
    ]);

    expect(out.map((i) => i.rawText)).toEqual(['Search', 'Breaking Bad']);
  });

  it('T-AI-004ak classifies a row header whose tail is the owner\u2019s profile name', () => {
    // `Continue Watching for <profile name>` carries arbitrary owner-chosen
    // text, so no exact term can ever cover it. The rule is a PREFIX anchored
    // at the start of the line — never a substring, which would delete a work
    // whose title merely mentions one.
    const out = cleanup([ocr({ rawText: "Continue Watching for Let's Go!" })], { now: NOW });

    expect(out[0]?.cleanupVerdict).toBe('chrome-suspected');
  });

  it('T-AI-004al leaves a title that merely CONTAINS a chrome phrase alone', () => {
    // The discriminating twin of `x`. A prefix rule that had been written as a
    // substring test would take this one too.
    const out = cleanup([ocr({ rawText: 'A Man for All Seasons' })], { now: NOW });

    expect(out[0]?.cleanupVerdict).toBe('title-candidate');
  });

  /* ---------------------------------------------------------------- *
   * TASK-199 — the tile-painted badge vocabulary.
   *
   * These read like part of the artwork rather than like navigation, which
   * is why the first pass of the vocabulary missed them entirely.
   * ---------------------------------------------------------------- */

  it('T-AI-004am classifies the tile-painted badges as chrome', () => {
    const out = cleanup(
      [ocr({ rawText: 'New' }), ocr({ rawText: 'HBO ORIGINAL' }), ocr({ rawText: 'HBO' })],
      { now: NOW },
    );

    expect(out.map((c) => c.cleanupVerdict)).toEqual([
      'chrome-suspected',
      'chrome-suspected',
      'chrome-suspected',
    ]);
  });

  it('T-AI-004an NEVER applies the badge vocabulary to the primary reader', () => {
    // ⚠ THE SAFETY TWIN, AND THE REASON `new` IS TOLERABLE AS A TERM AT ALL.
    // It is three generic letters. Step 3 is `ocr-only`-scoped precisely so a
    // work the MODEL named can never be deleted by a UI word, and if that
    // scoping is ever relaxed this entry is the one that starts eating titles.
    const out = cleanup([llm({ rawText: 'New', inferredTitle: 'New' })], { now: NOW });

    expect(out[0]?.cleanupVerdict).toBe('title-candidate');
  });

  it('T-AI-004ao does not take a title that merely STARTS with a badge word', () => {
    // Exact-line matching, restated for the shortest and most dangerous term.
    // A substring or prefix test would delete this real series.
    const out = cleanup([ocr({ rawText: 'New Amsterdam' })], { now: NOW });

    expect(out[0]?.cleanupVerdict).toBe('title-candidate');
  });

  it('T-AI-004ap treats both halves of the HBO max wordmark alike', () => {
    // The two words are separate OCR lines at the top-left of the desktop
    // capture. `max` was already a term; `hbo` was not, so half a logo was
    // reaching the owner as a title to confirm.
    const out = cleanup([ocr({ rawText: 'HBO' }), ocr({ rawText: 'max' })], { now: NOW });

    expect(out.map((c) => c.cleanupVerdict)).toEqual(['chrome-suspected', 'chrome-suspected']);
  });
});

describe('truncated captions (T-AI-043)', () => {
  it('T-AI-043a resolves to the complete work while rawText keeps the ellipsis', () => {
    // The whole reason §3.1a prefers `inferredTitle`: the visible caption was
    // cut off by the tile, and only the reader's identification is matchable.
    const out = cleanup(
      [
        llm({
          rawText: 'The Lord of the Ri\u2026',
          inferredTitle: 'The Lord of the Rings: The Fellowship of the Ring',
        }),
      ],
      { now: NOW },
    );

    expect(out[0]?.matchText).toBe('The Lord of the Rings: The Fellowship of the Ring');
    expect(out[0]?.normalisedText).toBe('lord of the rings the fellowship of the ring');
    // Verbatim, ellipsis intact, shown beside the match (US-007 AC-3).
    expect(out[0]?.item.rawText).toBe('The Lord of the Ri\u2026');
    expect(out[0]?.cleanupVerdict).toBe('title-candidate');
  });

  it('T-AI-043b falls back to rawText when the reader declined to identify', () => {
    // §3.2 step 7b: `basis: 'unknown'` with text carries on as a normal
    // candidate on `rawText`, rather than becoming an unreadable tile.
    const out = cleanup([llm({ rawText: 'Some Show', inferredTitle: null, basis: 'unknown' })], {
      now: NOW,
    });

    expect(out[0]?.matchText).toBe('Some Show');
    expect(out[0]?.cleanupVerdict).toBe('title-candidate');
  });

  // ── §3.1a R2 — invention vs de-truncation (TASK-198) ──────────────────────
  //
  // ⚠ THESE FOUR ARE ONE TEST IN FOUR PARTS AND MUST BE READ TOGETHER. `c` is
  // the defect; `d`, `e` and `f` are the twins that stop the fix from being
  // "distrust `inferredTitle` whenever it differs from the caption", which
  // would take `T-AI-043a` with it — the case R1 exists for.
  it('T-AI-043c prefers the CAPTION when the inference invents rather than completes', () => {
    // The golden corpus, exactly: a tile captioned `RAW`, read as `RAW` by the
    // model's own visibleText AND independently by OCR, reported as `WWE Raw`.
    // TMDB titles that work `Raw` (tmdb:tv:4656), so the expansion searched
    // for a string the provider does not use — three images, three losses.
    const out = cleanup([llm({ rawText: 'RAW', inferredTitle: 'WWE Raw' })], { now: NOW });

    expect(out[0]?.matchText).toBe('RAW');
    expect(out[0]?.normalisedText).toBe('raw');
    // The inference is not destroyed, only demoted — US-007 AC-3 shows both.
    expect(out[0]?.item.inferredTitle).toBe('WWE Raw');
  });

  it('T-AI-043d keeps the inference when it EXTENDS the caption, with no ellipsis', () => {
    // ⚠ THE TWIN THAT KILLS THE NAIVE FIX. Netflix does not always render an
    // ellipsis, so "differs from the caption" and "has no truncation marker"
    // are both true of a genuine de-truncation. Only the prefix test
    // separates them: a completion extends what was printed, an invention
    // replaces it.
    const out = cleanup(
      [
        llm({
          rawText: 'The Lord of the Rings',
          inferredTitle: 'The Lord of the Rings: The Two Towers',
        }),
      ],
      { now: NOW },
    );

    expect(out[0]?.matchText).toBe('The Lord of the Rings: The Two Towers');
  });

  it('T-AI-043e keeps the inference when OCR PARTIALLY corroborates the caption', () => {
    // ~~Only an exact independent reading is strong enough to overrule the
    // model. `partial` is what a truncated caption scores against the full
    // OCR line it came from, so anything weaker must keep R1's behaviour.~~
    // ⚠ NARROWED AT R3 (TASK-206): the second sentence was right and the first
    // was wrong. `partial` really is the signature of a caption truncated on
    // screen, so it still keeps R1's behaviour — but `none` is SILENCE, and
    // treating silence as evidence for the model is what let `wicked part one`
    // through. See `T-AI-043g`.
    const out = cleanup(
      [llm({ rawText: 'RAW', inferredTitle: 'WWE Raw', ocrSupport: 'partial' })],
      {
        now: NOW,
      },
    );

    expect(out[0]?.matchText).toBe('WWE Raw');
  });

  it('T-AI-043f does not mistake a caption that is a SUFFIX of the inference for a completion', () => {
    // `raw` is inside `wwe raw` — a substring test, or a bare `includes`,
    // would call this a de-truncation and reinstate the whole defect. The
    // rule is anchored at the START for exactly this reason.
    const out = cleanup([llm({ rawText: 'Raw', inferredTitle: 'WWE Raw' })], { now: NOW });

    expect(out[0]?.matchText).toBe('Raw');
  });

  // ── §3.1a R3 — silence is not corroboration (TASK-206) ────────────────────
  //
  // ⚠ THESE FOUR ARE ALSO ONE TEST IN FOUR PARTS. `g` is the defect; `h`, `i`
  // and `j` are the twins that stop the narrowing from becoming "distrust the
  // inference whenever OCR is silent", which would break de-truncation on
  // every tile OCR could not read — the commonest tile in the corpus.
  it('T-AI-043g prefers the CAPTION over an invention even when OCR is SILENT', () => {
    // The golden corpus, exactly: `netflix-mylist-desktop-01` carries a tile
    // whose caption reads WICKED FOR GOOD in full, with no ellipsis, reported
    // as `Wicked: Part One` — A DIFFERENT FILM. It scored `ocrSupport: 'none'`,
    // so R2's `=== 'exact'` gate skipped it and the invention won unopposed. It
    // was logged as a READER misidentification for four tasks while the correct
    // string sat in the record.
    const out = cleanup(
      [llm({ rawText: 'WICKED FOR GOOD', inferredTitle: 'Wicked: Part One', ocrSupport: 'none' })],
      { now: NOW },
    );

    expect(out[0]?.matchText).toBe('WICKED FOR GOOD');
    expect(out[0]?.normalisedText).toBe('wicked for good');
    // Demoted, not destroyed — US-007 AC-3 still shows the owner both.
    expect(out[0]?.item.inferredTitle).toBe('Wicked: Part One');
  });

  it('T-AI-043h still de-truncates an ELLIPSIS caption OCR could not read', () => {
    // ⚠ THE TWIN THAT MATTERS MOST. `in the hand of dante` is in the corpus as
    // `In the sh...of Dante`: the screen itself was cut off, so the inference
    // is the only matchable string there is. If R3 took this case too, every
    // truncated caption on an OCR-silent tile would become unmatchable.
    const out = cleanup(
      [
        llm({
          rawText: 'The Lord of the Ri...',
          inferredTitle: 'The Lord of the Rings',
          ocrSupport: 'none',
        }),
      ],
      { now: NOW },
    );

    expect(out[0]?.matchText).toBe('The Lord of the Rings');
  });

  it('T-AI-043i still de-truncates a PREFIX caption OCR could not read', () => {
    // The no-ellipsis half of `h`. The prefix test, not the marker, is what
    // carries de-truncation — and it needs no corroboration to work, which is
    // the whole reason `none` can safely fall through to it.
    const out = cleanup(
      [
        llm({
          rawText: 'The Lord of the Rings',
          inferredTitle: 'The Lord of the Rings: The Two Towers',
          ocrSupport: 'none',
        }),
      ],
      { now: NOW },
    );

    expect(out[0]?.matchText).toBe('The Lord of the Rings: The Two Towers');
  });

  it('T-AI-043j keeps an inference CONTAINED IN a merged caption', () => {
    // ⚠ THE REGRESSION R3 CAUSED BEFORE THE RULE WAS MADE TWO-SIDED, CAUGHT BY
    // THE GOLDEN CORPUS: when step 1/1b merges two lines the printed text is
    // the LONGER string and the model titles only the first, so
    // `true detective night country true detective` was printed and
    // `True Detective: Night Country` inferred. One-sided, R3 handed back the
    // doubled string and invented a false title where there had been none.
    // Containment in EITHER direction is a selection, not an invention.
    const out = cleanup(
      [
        llm({
          rawText: 'True Detective Night Country True Detective',
          inferredTitle: 'True Detective: Night Country',
          ocrSupport: 'none',
        }),
      ],
      { now: NOW },
    );

    expect(out[0]?.matchText).toBe('True Detective: Night Country');
  });
});
