/**
 * Stage 2 — deterministic clean-up (`specs/ai.md` §3, TASK-057).
 *
 * ⚠ THE GOVERNING RULE (§3.1, REQ-012): **CLASSIFY AND SURFACE, NEVER DROP
 * AND HIDE.** Nothing in this file may delete a candidate. Every input item
 * comes out the other side carrying a `cleanupVerdict`; filtering is a
 * *presentation* decision made in the review pass, where every group is
 * visible with a count. A heuristic that is wrong about a real title must
 * cost the owner a click, never the title.
 *
 * The one input-count change is step 1, which MERGES `ocr-only` fragments of
 * one caption into a single candidate. That is grouping, not dropping: every
 * fragment's text is retained verbatim in the merged `rawText`.
 *
 * ⚠ PATH NOTE. §3 names `apps/api/src/extraction/cleanup.ts`;
 * `docs/backlog.md` TASK-057 names `packages/domain/src/extraction/`. The
 * backlog is the work order and is also right on the merits — §3 opens
 * "pure functions, no I/O, no inference", which is what `packages/domain` is.
 * Same resolution as `thresholds.ts` and `chromeTerms.ts`.
 *
 * ⚠ OUT OF SCOPE, DELIBERATELY: §3.2 step 9 ("Pass A collapse") is TASK-063
 * (`packages/domain/src/overlap.ts`, `T-AI-007`), not this task. Implementing
 * it here would put the two-pass SD-02 collapse in two places.
 *
 * ────────────────────────────────────────────────────────────────────────
 * TWO SPEC DEFECTS IN §3.2, RESOLVED IN PLACE RATHER THAN GUESSED
 * ────────────────────────────────────────────────────────────────────────
 *
 * ⚠ FINDING 1 — THE STEP ORDER DELETES EVERY UNREADABLE TILE FROM REVIEW.
 * §3.2 runs the length gate (step 2) before "model declined" (step 7b). An
 * unreadable tile has `rawText: ''` and `inferredTitle: null`, so its
 * `matchText` is `''`, so step 2 fires first and stamps it
 * `chrome-suspected`. §3.3 then puts it in the collapsed "Probably not
 * titles" group and excludes it from matching — whereas 7b and §3.3 both say
 * an `unreadable-tile` is shown IN THE MAIN LIST as a thumbnail with a
 * "search for this" action, and is "**Never dropped**". Read in step order the
 * rule silently contradicts its own two other statements, and the loss is
 * invisible: the tile is technically still on screen, in the group the owner
 * is least likely to open. **`unreadable-tile` is therefore decided FIRST
 * here.** `T-AI-004d`.
 *
 * ⚠ FINDING 2 — THE DIGIT RATIO CATCHES NEITHER OF ITS OWN EXAMPLES. §3.2
 * step 4 says "> 60 %" and names `1h 52m` and `S2:E4`. Both compute to
 * EXACTLY 0.60 (3 of 5 non-space characters), so a strict `>` catches
 * neither, and the rule as written does nothing for the two cases it was
 * written for. The examples are the intent and the operator is the typo, so
 * the comparison here is `>=`. The blast radius of that choice is small and
 * one-directional: it applies to `ocr-only` orphans only, and its worst
 * outcome is a visible collapsed group with a one-click "this is a title".
 * `T-AI-004j`.
 *
 * ⚠ VERDICT PRECEDENCE IS EXPLICIT, because §3.2 assigns several verdicts to
 * one column and never says which wins. Order:
 * `unreadable-tile` > `chrome-suspected` > `inferred-unverified` >
 * `low-confidence` > `title-candidate`. The rule behind it: each verdict to
 * the left carries a stronger obligation TO THE OWNER — a thumbnail beside
 * the proposed title (RSK-028), or exclusion from matching — and losing that
 * obligation is unrecoverable, whereas losing a softer caution only costs a
 * hint. In particular `inferred-unverified` beats `low-confidence`, against
 * the numeric order of steps 7 and 7a: 7a is the fabrication mitigation and
 * drives a mandatory UI element (`T-AI-041`), and 7 drives a sentence.
 */

import { CLEANUP_VERDICTS, type CleanupVerdict } from '../enums.js';
import { normaliseTitleText } from '../identity.js';
import { isChromeTerm } from './chromeTerms.js';
import { EXTRACT_CONFIDENCE_FLOOR } from './thresholds.js';
import type { ExtractedTextItem, NormalisedBox } from './TitleExtractor.js';

/* ------------------------------------------------------------------ *
 * Rule constants (`specs/ai.md` §3.2)
 * ------------------------------------------------------------------ */

/** Step 2. `matchText` shorter than this → `chrome-suspected`. */
export const TITLE_MIN_LENGTH = 2;
/** Step 2. `matchText` longer than this → `chrome-suspected`. */
export const TITLE_MAX_LENGTH = 200;

/** Step 4. Digits + punctuation at or above this share → `chrome-suspected`. */
export const DIGIT_SYMBOL_RATIO_CEILING = 0.6;

/** Step 5. The earliest year a caption may plausibly carry. */
export const EARLIEST_PLAUSIBLE_YEAR = 1880;
/** Step 5. How far past "now" a year may sit and still be a release year. */
export const YEAR_FUTURE_ALLOWANCE = 5;

/**
 * Step 1 grouping constants.
 *
 * ⚠ ALL THREE ARE UNCALIBRATED — `specs/ai.md` §3.2 says so itself — and this
 * is now a SECONDARY path only: the primary reader groups tiles natively
 * (ADR-0001 R2.3a), so these govern `ocr-only` orphans and nothing else.
 * Treat a change here as a change to orphan recovery, not to extraction.
 */
export const OCR_ROW_BUCKETS = 40;
/** Vertical centres closer than this fraction of the taller box may merge. */
export const OCR_MERGE_CENTRE_RATIO = 0.4;
/** Horizontal gap below this fraction of image width may merge. */
export const OCR_MERGE_GAP = 0.03;

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

export interface CleanedCandidate {
  /** The item as it will be stored. Merged, for a step-1 group. */
  readonly item: ExtractedTextItem;
  /**
   * §3.1a — `inferredTitle ?? rawText`, with any extracted year removed.
   *
   * ⚠ `item.rawText` is ALWAYS retained verbatim alongside this and is always
   * shown in the review card (US-007 AC-3). Never overwrite one with the
   * other: the owner has to be able to see what was on screen versus what the
   * reader concluded.
   */
  readonly matchText: string;
  readonly normalisedText: string;
  /** MATCH HINT ONLY — never enters identity (SD-05). */
  readonly extractedYear: number | null;
  readonly cleanupVerdict: CleanupVerdict;
}

export interface CleanupOptions {
  /** Injected so year plausibility is deterministic in tests. */
  readonly now?: Date;
}

/* ------------------------------------------------------------------ *
 * Step 1 — reading-order grouping (`ocr-only` items only)
 * ------------------------------------------------------------------ */

function centreY(box: NormalisedBox): number {
  return box.y + box.h / 2;
}

function union(a: NormalisedBox, b: NormalisedBox): NormalisedBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function mergeable(prev: ExtractedTextItem, next: ExtractedTextItem): boolean {
  const taller = Math.max(prev.boundingBox.h, next.boundingBox.h);
  const sameLine =
    Math.abs(centreY(prev.boundingBox) - centreY(next.boundingBox)) <
    OCR_MERGE_CENTRE_RATIO * taller;
  const gap = next.boundingBox.x - (prev.boundingBox.x + prev.boundingBox.w);
  return sameLine && gap < OCR_MERGE_GAP;
}

function mergeTwo(prev: ExtractedTextItem, next: ExtractedTextItem): ExtractedTextItem {
  // Both texts are kept, in reading order. This is the whole reason merging is
  // not dropping.
  const rawText = [prev.rawText, next.rawText].filter((t) => t !== '').join(' ');
  const confidences = [prev.confidence, next.confidence].filter((c): c is number => c !== null);
  return {
    ...prev,
    rawText,
    boundingBox: union(prev.boundingBox, next.boundingBox),
    // Worst-of, not mean. A merged caption is only as trustworthy as its least
    // trustworthy fragment, and averaging would let one confident fragment
    // carry a doubtful one over the low-confidence floor.
    confidence: confidences.length > 0 ? Math.min(...confidences) : null,
  };
}

/**
 * Merge `ocr-only` fragments that sit on one line.
 *
 * `provider: 'llm'` items are returned untouched and IN THEIR ORIGINAL ORDER —
 * they are already one-per-tile (§3.2 step 1) and merging them would fuse two
 * distinct works into one candidate.
 */
export function groupReadingOrder(items: readonly ExtractedTextItem[]): ExtractedTextItem[] {
  const llm = items.filter((item) => item.provider !== 'ocr-only');
  const ocr = [...items.filter((item) => item.provider === 'ocr-only')].sort((a, b) => {
    const rowA = Math.round(a.boundingBox.y * OCR_ROW_BUCKETS);
    const rowB = Math.round(b.boundingBox.y * OCR_ROW_BUCKETS);
    return rowA !== rowB ? rowA - rowB : a.boundingBox.x - b.boundingBox.x;
  });

  const merged: ExtractedTextItem[] = [];
  for (const item of ocr) {
    const open = merged[merged.length - 1];
    if (open !== undefined && mergeable(open, item)) {
      merged[merged.length - 1] = mergeTwo(open, item);
    } else {
      merged.push(item);
    }
  }
  return [...llm, ...merged];
}

/* ------------------------------------------------------------------ *
 * Step 5 — year extraction
 * ------------------------------------------------------------------ */

interface YearSplit {
  text: string;
  year: number | null;
}

/**
 * Lift a parenthesised or trailing 4-digit year out of the matching text.
 *
 * ⚠ THE YEAR IS NEVER LIFTED IF NOTHING WOULD REMAIN. *1917*, *2012* and
 * *1984* are real films whose entire title is a plausible year. Stripping it
 * would leave an empty `matchText`, which step 8 then stamps
 * `chrome-suspected` — the title disappears into the collapsed group — and
 * would additionally record an `extractedYear` that the §4.2 matcher scores
 * against the work's ACTUAL release year, subtracting 0.15 for a mismatch it
 * invented. Both failures are silent. The year stays part of the title.
 */
export function extractYear(text: string, now: Date): YearSplit {
  const ceiling = now.getUTCFullYear() + YEAR_FUTURE_ALLOWANCE;

  const plausible = (raw: string | undefined): number | null => {
    if (raw === undefined) return null;
    const value = Number.parseInt(raw, 10);
    return value >= EARLIEST_PLAUSIBLE_YEAR && value <= ceiling ? value : null;
  };

  const parenthesised = /\((\d{4})\)/.exec(text);
  const parenYear = plausible(parenthesised?.[1]);
  if (parenthesised !== null && parenYear !== null) {
    const stripped = text.replace(parenthesised[0], ' ').replace(/\s+/g, ' ').trim();
    if (stripped !== '') return { text: stripped, year: parenYear };
    return { text, year: null };
  }

  const trailing = /\s(\d{4})\s*$/.exec(text);
  const trailingYear = plausible(trailing?.[1]);
  if (trailing !== null && trailingYear !== null) {
    const stripped = text.slice(0, trailing.index).trim();
    if (stripped !== '') return { text: stripped, year: trailingYear };
  }

  return { text, year: null };
}

/* ------------------------------------------------------------------ *
 * Step 4 — digit / symbol ratio
 * ------------------------------------------------------------------ */

export function digitSymbolRatio(text: string): number {
  const chars = [...text].filter((c) => !/\s/u.test(c));
  if (chars.length === 0) return 0;
  const noisy = chars.filter((c) => !/\p{L}/u.test(c)).length;
  return noisy / chars.length;
}

/* ------------------------------------------------------------------ *
 * The classifier
 * ------------------------------------------------------------------ */

function classify(
  item: ExtractedTextItem,
  matchText: string,
  normalisedText: string,
): CleanupVerdict {
  const isOcrOnly = item.provider === 'ocr-only';

  // Step 7b, hoisted above the length gate — see FINDING 1 in the header.
  if (item.basis === 'unknown' && item.rawText === '' && item.inferredTitle === null) {
    return 'unreadable-tile';
  }

  // Step 2. Applies to BOTH providers: §3.2 restricts steps 1/3/4 to
  // `ocr-only` and pointedly does not restrict this one.
  if (matchText.length < TITLE_MIN_LENGTH || matchText.length > TITLE_MAX_LENGTH) {
    return 'chrome-suspected';
  }

  // Steps 3 and 4 — `ocr-only` only. Applying either to the primary reader
  // would suppress a genuine work called `Max`, `Home` or `1917`.
  if (isOcrOnly && isChromeTerm(matchText)) {
    return 'chrome-suspected';
  }
  if (isOcrOnly && digitSymbolRatio(matchText) >= DIGIT_SYMBOL_RATIO_CEILING) {
    return 'chrome-suspected';
  }

  // Step 8. There is no thumbnail pipeline yet, so the "no thumbnail
  // available" qualifier cannot be evaluated; an item reaching here with
  // empty normalised text has already survived the length gate, meaning its
  // text was all punctuation.
  if (normalisedText === '') {
    return 'chrome-suspected';
  }

  // Step 7a before step 7 — see the precedence note in the header.
  if (item.provider === 'llm' && item.ocrSupport === 'none') {
    return 'inferred-unverified';
  }
  if (item.confidence !== null && item.confidence < EXTRACT_CONFIDENCE_FLOOR) {
    return 'low-confidence';
  }

  return 'title-candidate';
}

/**
 * Stage 2, end to end. Pure: same input, same output, no clock of its own.
 *
 * ⚠ THE OUTPUT LENGTH IS NEVER SHORTER THAN THE INPUT EXCEPT BY STEP-1
 * MERGING, and a merge concatenates both texts. There is no path that returns
 * fewer candidates than the information it was given. `T-AI-004a`.
 */
export function cleanup(
  items: readonly ExtractedTextItem[],
  options: CleanupOptions = {},
): CleanedCandidate[] {
  const now = options.now ?? new Date();

  return groupReadingOrder(items).map((item) => {
    // §3.1a. `inferredTitle` is the identified work, which is what the matcher
    // needs and what makes a truncated tile caption matchable at all.
    const source = item.inferredTitle ?? item.rawText;
    const { text: matchText, year } = extractYear(source, now);
    const normalisedText = normaliseTitleText(matchText);

    return {
      item,
      matchText,
      normalisedText,
      extractedYear: year,
      cleanupVerdict: classify(item, matchText, normalisedText),
    };
  });
}

/** Every verdict this stage can produce. Used by `T-AI-004` for coverage. */
export const CLEANUP_VERDICTS_PRODUCED: readonly CleanupVerdict[] = CLEANUP_VERDICTS;
