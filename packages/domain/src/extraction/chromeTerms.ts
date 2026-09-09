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
 *
 * ⚠ AND IT IS ALSO CONSULTED BY §3.2 STEP 1 (`mergeable()` in `cleanup.ts`),
 * WHICH IS NOT AN ABUSE OF THE VOCABULARY BUT THE ONLY THING THAT MAKES IT
 * WORK. Grouping runs before classification, so without that call a nav bar is
 * merged into one candidate and no term can ever match it (TASK-195). Changing
 * this set therefore changes grouping too — measure the golden corpus, do not
 * reason about it.
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
  // ── Added by TASK-195 (`specs/ai.md` §3.2 step 3, second list). Every one of
  // these appears as its own OCR line in the golden corpus, is chrome by the
  // answer key, and was reaching the owner as a title candidate.
  'shows',
  'tv shows',
  'tv shows & movies',
  'games',
  'clips',
  'browse by languages',
  'my netflix',
  'my stuff',
  'my purchases',
  'recommended for you',
  'sort by',
  'top matches',
  "haven't started",
  'started',
  'new & hot',
  "you haven't added anything yet.",
  'titles you add to your list will appear here.',
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

/**
 * Row headers that carry a variable tail and therefore cannot be a term.
 *
 * ⚠ PREFIXES, NOT SUBSTRINGS. Netflix renders `Continue Watching for <profile
 * name>`, so the profile name — arbitrary owner-chosen text — is part of the
 * line. No exact vocabulary can ever cover it, which is why the rule is
 * anchored at the START of the line and requires the whole prefix. A
 * substring test would delete a work whose title merely mentions one.
 */
const CHROME_LINE_PREFIXES: readonly string[] = ['continue watching for '];

/** `isChromeTerm`, plus the variable-tail row headers above. */
export function isChromeLine(raw: string): boolean {
  const folded = foldForChrome(raw);
  if (CHROME_TERMS.has(folded)) return true;
  return CHROME_LINE_PREFIXES.some((p) => folded.startsWith(p) && folded.length > p.length);
}
