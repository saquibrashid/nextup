/**
 * T-META-008 — a SUFFIXED test id means one thing, in one place.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `tools/eslint-rules/test-id-naming.js` states its own scope precisely, and
 * then makes a claim about who covers the rest:
 *
 *   SCOPE — this rule sees one file at a time, so it enforces:
 *     1. the id prefix on every test title, and
 *     2. uniqueness WITHIN a file.
 *   Cross-file uniqueness and the AC->test mapping are enforced by
 *   `T-META-001` (TASK-126), which parses the whole suite.
 *
 * ⚠ **The first half of that sentence was true and the second was not.**
 * `T-META-001` maps ACs to test ids and fails on an AC with no test or a test
 * id absent from the suite. It has never checked that a suffixed id is used
 * only once. So cross-file uniqueness was documented as guaranteed, assigned
 * to a named owner, and enforced by nothing — which is `T-INFRA-016` restated
 * for a third time in this repo: a rule no test asserts is a comment.
 *
 * Sixty-five collisions accumulated behind that false guarantee.
 *
 * ── What is and is not a collision ──────────────────────────────────────────
 *
 * A BARE base id in several files is legitimate and intended. `T-AI-036` is
 * typed `I` in `specs/testing.md` and is deliberately asserted at three
 * levels — the extractor unit, the runner unit, and the integration close —
 * so `describe('T-AI-036 …')` appearing three times is the suite working.
 *
 * A SUFFIXED id is different. The suffix exists to name one CASE, so the same
 * suffix in two files means two different cases answer to one name:
 *
 *   T-AI-036b  hybridExtractor.spec.ts  "issues both legs in PARALLEL"
 *   T-AI-036b  runExtraction.spec.ts    "a missing OCR leg is NOT degraded"
 *
 * Those are unrelated properties. The costs are concrete: a CI failure naming
 * `T-AI-036b` no longer names one thing, which is the entire justification for
 * the id-in-the-title convention; the AC→test mapping resolves ambiguously;
 * and deleting either file leaves the id still "present", so the gates cannot
 * see that coverage was lost.
 *
 * The authors of `batchCloseRemovals.spec.ts` hit this and worked around it
 * by hand — its `T-AI-036` block deliberately starts at `j` to clear the two
 * unit files, and its comment names the `T-AI-036b` clash outright. A
 * convention that only holds when an author happens to notice is the one this
 * gate replaces.
 *
 * ── The baseline is a ratchet, not a permission ─────────────────────────────
 *
 * The 65 are NOT asserted to be harmless. They are recorded because renaming
 * them is 65 separate judgement calls about which file owns which letter, and
 * a guess reproduces the mis-citation class this project has already hit
 * repeatedly. The same reasoning `BASELINE_ORPHANS` gives for its own list.
 *
 * So: no NEW collision may appear, and the count is pinned EXACTLY in both
 * directions, so resolving one forces this list to be updated in the same
 * change rather than drifting away from reality. Adding to it is never the
 * correct fix for a failure here — pick a free suffix instead.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * A SUFFIXED test id in `it`/`test`/`describe` TITLE position.
 *
 * ⚠ The suffix is one or TWO letters, matching `test-id-naming.js`. A `[a-z]?`
 * pattern silently collapses `T-AI-033aa` onto `T-AI-033a` and manufactures a
 * phantom collision — the exact bug that rule's header warns about, and the
 * reason this regex is not simplified.
 *
 * ⚠ `{1,2}` not `{0,2}`: a bare base id in several files is legitimate (see
 * the header). Matching it here would report the suite's intended multi-level
 * assertions as defects and make the real report unreadable.
 */
const SUFFIXED_ID_RE =
  /\b(?:it|test|describe)(?:\.\w+)*\s*\(\s*[`'"]\s*(T-[A-Z0-9]+-\d+[a-z]{1,2})\b/g;

/**
 * Suffixed ids that already answer to more than one test, recorded at the
 * moment this gate was written. MAY ONLY SHRINK.
 */
const BASELINE_COLLISIONS = new Set([
  'T-AI-009g',
  'T-AI-009h',
  'T-AI-036a',
  'T-AI-036b',
  'T-AI-036c',
  'T-AI-036d',
  'T-AI-036e',
  'T-AI-036f',
  'T-AI-036g',
  'T-AI-036h',
  'T-API-017b',
  'T-API-017c',
  'T-API-017d',
  'T-API-017e',
  'T-API-017f',
  'T-API-017g',
  'T-ATTR-001h',
  'T-BATCH-017a',
  'T-BATCH-017b',
  'T-BATCH-017c',
  'T-BATCH-017d',
  'T-BATCH-017e',
  'T-BATCH-018a',
  'T-BATCH-018b',
  'T-BATCH-018c',
  'T-BATCH-019e',
  'T-DATA-002j',
  'T-DATA-002k',
  'T-DATA-002z',
  'T-PASTE-006a',
  'T-PASTE-007a',
  'T-PASTE-007d',
  'T-PROV-010c',
  'T-SEC-002d',
  'T-SEC-002e',
  'T-SEC-002f',
  'T-SEC-002g',
  'T-SEC-002h',
  'T-SEC-002i',
  'T-SEC-003h',
  'T-SEC-003i',
  'T-SEC-003j',
  'T-SEC-009a',
  'T-SUP-004b',
  'T-TMDB-010a',
  'T-TMDB-010b',
  'T-TMDB-010c',
  'T-TMDB-010d',
  'T-TMDB-010e',
  'T-TMDB-010f',
  'T-TMDB-010g',
  'T-TMDB-010h',
  'T-TMDB-010i',
  'T-TMDB-010j',
  'T-TMDB-010k',
  'T-TMDB-010l',
  'T-TMDB-010m',
  'T-TMDB-010n',
  'T-TMDB-010o',
  'T-UI-022a',
  'T-UI-022b',
  'T-UI-022c',
  'T-UI-022d',
  'T-UI-022e',
]);

const specFilesUnder = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(node_modules|dist|\.git|coverage|playwright-report)$/.test(entry.name)) {
        out.push(...specFilesUnder(full));
      }
    } else if (/\.(spec|test)\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

/** id -> the set of files whose test TITLES use it. */
const collectSuffixedIds = (): Map<string, Set<string>> => {
  const seen = new Map<string, Set<string>>();
  for (const file of specFilesUnder(ROOT)) {
    const source = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const match of source.matchAll(SUFFIXED_ID_RE)) {
      const id = match[1];
      if (id === undefined) continue;
      const files = seen.get(id) ?? new Set<string>();
      files.add(rel);
      seen.set(id, files);
    }
  }
  return seen;
};

describe('T-META-008 — a suffixed test id names exactly one test', () => {
  const seen = collectSuffixedIds();
  const collisions = [...seen.entries()]
    .filter(([, files]) => files.size > 1)
    .map(([id]) => id)
    .sort();

  it('T-META-008a: the scanner actually reads the suite', () => {
    // ⚠ THE POSITIVE CONTROL. Every other assertion here is satisfied by an
    // EMPTY scan: if the walk misses the suite, or the regex stops matching
    // after a formatting change, `collisions` is [] and this file reports a
    // clean bill of health forever. That is the `T-CI-008` failure mode — a
    // check that passes by never running.
    expect(seen.size).toBeGreaterThan(200);
    expect(seen.has('T-AI-036b')).toBe(true);
  });

  it('T-META-008b: no NEW suffixed id answers to two different tests', () => {
    const novel = collisions.filter((id) => !BASELINE_COLLISIONS.has(id));
    expect(
      novel,
      `These suffixed test ids are each used by tests in more than one file:\n` +
        novel.map((id) => `  ${id} -> ${[...(seen.get(id) ?? [])].join(', ')}`).join('\n') +
        `\n\nA suffix names one CASE, so the same suffix in two files means a CI ` +
        `failure no longer names one thing. Pick a free suffix — do NOT add the id ` +
        `to BASELINE_COLLISIONS, which may only shrink.`,
    ).toEqual([]);
  });

  it('T-META-008c: BASELINE_COLLISIONS may only shrink', () => {
    // Exact, and exact in BOTH directions — the discipline `T-META-006e` had
    // to learn the hard way when a `toBeLessThanOrEqual` high-water mark left
    // thirty-four free slots and was quietly used. Resolving a collision must
    // update this number in the same change.
    expect(BASELINE_COLLISIONS.size).toBe(64);
  });

  it('T-META-008d: every baselined id is still a real collision', () => {
    // Stops the baseline outliving the problem. If a rename resolves one, this
    // fails until the entry is removed, so the list cannot silently become a
    // museum of fixed bugs that future readers mistake for live debt.
    const stale = [...BASELINE_COLLISIONS].filter((id) => !collisions.includes(id)).sort();
    expect(
      stale,
      `These ids are baselined as collisions but no longer collide. Remove them ` +
        `from BASELINE_COLLISIONS and lower the count in T-META-008c.`,
    ).toEqual([]);
  });

  it('T-META-008e: a bare base id in several files is NOT reported', () => {
    // The distinction the gate is built on, asserted rather than assumed.
    // `T-AI-036` is typed `I` and is deliberately asserted at three levels; if
    // the regex ever widened to `{0,2}` this suite would start reporting the
    // suite's intended multi-level coverage as a defect.
    expect(seen.has('T-AI-036')).toBe(false);
    expect(collisions).not.toContain('T-AI-036');
  });
});
