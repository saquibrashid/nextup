/**
 * The chrome vocabulary — `specs/ai.md` §3.2 step 3, TASK-057.
 *
 * ⚠ PATH NOTE. §3.2 names `apps/api/src/extraction/chromeTerms.ts`;
 * `docs/backlog.md` TASK-057 names `packages/domain/src/extraction/`. The
 * backlog is the work order, and it is also the correct home: §3 opens with
 * "pure functions, no I/O, no inference", which is exactly what
 * `packages/domain` is, and `cleanup()` is called from `crossCheck()`'s side
 * of the pipeline. Same resolution as `thresholds.ts` (TASK-056c).
 *
 * ⚠ EXACT MATCHES ONLY, AND THIS IS THE POINT OF THE RULE. "Play" as a whole
 * line is a button; *The Play* is a title. A substring test here would delete
 * every work whose name contains a UI word — silently, and only for the owner
 * who happened to save one.
 *
 * ⚠ MATCHED AGAINST CASE-FOLDED RAW TEXT, NEVER `normalisedText`.
 * `normaliseTitleText` maps every character outside `[a-z0-9 ]` to a space, so
 * "new & popular" normalises to "new popular" and would never match the entry
 * below. Fold case and collapse whitespace only.
 *
 * ⚠ APPLIED TO `provider: 'ocr-only'` ITEMS ONLY (§3.2). The primary reader is
 * instructed not to report chrome as a tile, so applying a fixed vocabulary to
 * its output would suppress a genuine title named after a UI word — `Max`,
 * `Home`, `Profile` and `Search` are all real works.
 */

/** Verbatim from `specs/ai.md` §3.2 step 3. Do not add terms without the spec. */
export const CHROME_TERMS: ReadonlySet<string> = new Set([
  'my list',
  'continue watching',
  'watchlist',
  'saved',
  'downloads',
  'search',
  'home',
  'browse',
  'settings',
  'profile',
  'new & popular',
  'coming soon',
  'top 10',
  'trending now',
  'for you',
  'series',
  'movies',
  'sign out',
  'remove from my list',
  'play',
  'more info',
  'resume',
  'episodes',
  'hbo max',
  'max',
  'netflix',
]);

/**
 * Fold a line for chrome comparison: lowercase, collapse whitespace, trim.
 *
 * Deliberately NOT `normaliseTitleText` — see the header. Punctuation is
 * preserved so `new & popular` can match.
 */
export function foldForChrome(raw: string): string {
  return raw.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

export function isChromeTerm(raw: string): boolean {
  return CHROME_TERMS.has(foldForChrome(raw));
}
