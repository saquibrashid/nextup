/**
 * `T-META-002` — every invariant in the non-negotiable core resolves to a test
 * that actually exists.
 *
 * ⚠ WHY THIS GATE EXISTS. `specs/testing.md` §6 lists the properties "whose
 * failure is **silent**" — the ones that "fail the build on their own". They
 * are the product's load-bearing guarantees: an allow-listed-out identity gets
 * no data; a full-update review shows ALL extracted titles; suppression is
 * keyed on work identity; no mechanism exists that could schedule deletion of
 * list data; the pixel guard refuses BEFORE a decode buffer is allocated.
 *
 * `specs/testing.md` §9 (US-039 AC-2) has always promised that `T-META-002`
 * checks each of them "resolves to an existing, passing test". It did not
 * exist. So the table of properties that fail silently was itself free to
 * fail silently — a row could name a test nobody had written, and the only
 * signal would be the absence of a failure.
 *
 * It found one on the first run: **§6 row 10** — *"the mixed-undo refusal
 * enumerates **everything**, never truncated"* (US-033 AC-5) — cites
 * `T-UNDO-006`, and no test of that name exists anywhere. A truncated refusal
 * is the definition of a silent failure: the owner is shown a partial list of
 * what undo would touch, acts on it, and the difference is invisible.
 *
 * ⚠ THE SCOPE IN §9 WAS STALE, AND TAKING IT LITERALLY WOULD HAVE BUILT THE
 * WRONG GATE. US-039 AC-2 describes "the **nine** PRD-mandated invariants
 * (§6 rows 1–5 plus US-016 AC-6, US-021 AC-6, US-026 AC-6, US-038 AC-5)".
 * §6 has not had five rows for a long time — it now has **sixteen**, and its
 * own heading carries an in-place correction for exactly this drift ("the
 * heading said 'eleven' while the table already held thirteen rows"). Rows
 * 6–16 include `T-INV-013` (no deletion mechanism), `T-IMG-017` (the
 * pre-decode pixel guard) and `T-AI-036` (a degraded full-update proposes no
 * removals) — precisely the invariants added because the owner accepted a
 * residual risk *on condition that they exist*. A gate honouring the literal
 * "rows 1–5" would have ignored all eleven. This gate reads the table, so it
 * cannot go stale again as rows are added.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TESTING_SPEC = join(REPO_ROOT, 'specs', 'testing.md');

/** The four invariant criteria §9 names outside the §6 table. */
const MANDATED_CRITERIA: Readonly<Record<string, string>> = {
  'US-016': 'AC-6',
  'US-021': 'AC-6',
  'US-026': 'AC-6',
  'US-038': 'AC-5',
};

const TEST_ROOTS = ['apps', 'packages', 'tests'] as const;

/**
 * ⚠ TITLE POSITION, NOT MERE OCCURRENCE — the same predicate `T-META-001` and
 * `T-META-007` use, and for the same reason: an id in a comment or used as
 * data is not a test. `T-META-004` guarantees every real id sits in an
 * `it(...)` title as a static string.
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

function implementedInTitles(files: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    for (const [, id] of text.matchAll(TITLE_ID_PATTERN)) ids.add(id);
  }
  return ids;
}

/**
 * `T-ATTR-001/002/003` is one cell naming three tests. Expanding the shorthand
 * matters: a naive `T-[A-Z]+-\d+` match reads that as `T-ATTR-001` alone and
 * silently drops two thirds of the invariant's coverage.
 */
export function expandIdShorthand(cell: string): string[] {
  const ids: string[] = [];
  for (const raw of cell.replace(/~~[^~]*~~/g, '').match(/T-[A-Z0-9]+-\d+(?:\/\d+)*/g) ?? []) {
    const parsed = /^(T-[A-Z0-9]+)-(\d+)((?:\/\d+)*)$/.exec(raw);
    if (!parsed) continue;
    const [, family, first, rest] = parsed;
    ids.push(`${family}-${first}`);
    for (const suffix of rest.match(/\d+/g) ?? []) ids.push(`${family}-${suffix}`);
  }
  return ids;
}

export interface Invariant {
  readonly where: string;
  readonly property: string;
  readonly ids: readonly string[];
}

/** Every numbered row of the §6 non-negotiable-core table. */
export function coreInvariants(markdown: string): Invariant[] {
  const rows: Invariant[] = [];
  let inSection = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^## 6\. /.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^## /.test(line)) break;
    if (!inSection) continue;

    const numbered = /^\|\s*(\d+)\s*\|/.exec(line);
    if (!numbered) continue;

    const cells = line.split('|').map((cell) => cell.trim());
    rows.push({
      where: `§6 row ${numbered[1]}`,
      property: (cells[2] ?? '').slice(0, 60),
      ids: expandIdShorthand(cells[4] ?? ''),
    });
  }

  return rows;
}

/** The four invariant criteria named in §9 rather than the §6 table. */
export function mandatedCriterionInvariants(markdown: string): Invariant[] {
  const rows: Invariant[] = [];
  let story: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{2,6}\s.*?\bUS-(\d{3})\b/.exec(line);
    if (heading) {
      story = `US-${heading[1]}`;
      continue;
    }
    const criterion = /^\|\s*\*{0,2}\s*(AC-\d+)/.exec(line);
    if (!story || !criterion) continue;
    if (MANDATED_CRITERIA[story] !== criterion[1]) continue;

    const cells = line.split('|').map((cell) => cell.trim());
    rows.push({
      where: `${story} ${criterion[1]}`,
      property: (cells[4] ?? '').slice(0, 60),
      ids: expandIdShorthand(line),
    });
  }

  return rows;
}

/** THE DETECTOR — pure and injectable, so `d` can drive it over input it has never seen. */
export function unbackedInvariants(
  invariants: readonly Invariant[],
  implemented: ReadonlySet<string>,
): string[] {
  const missing: string[] = [];
  for (const invariant of invariants) {
    for (const id of invariant.ids) {
      if (!implemented.has(id)) missing.push(`${invariant.where}: ${id}`);
    }
  }
  return missing.sort();
}

/**
 * Invariants whose named test does not exist yet. ⚠ Shrink-only, and `a` fails
 * in BOTH directions, so writing the test forces its line out.
 *
 * ⚠ Do NOT add to this list. Every entry is a property `specs/testing.md` §6
 * calls non-negotiable *because its failure is silent*. An unwritten test here
 * is not a documentation gap — it is an invariant nobody is checking.
 */
const KNOWN_UNBACKED: readonly string[] = [
  // §6 row 10 — "the mixed-undo refusal enumerates EVERYTHING, never
  // truncated" (US-033 AC-5). A truncated refusal shows the owner a partial
  // list of what undo would touch; they act on it and the difference is
  // invisible. Also carried by T-META-001's phantom baseline.
  '§6 row 10: T-UNDO-006',
];

/**
 * Non-vacuity floors. §6 holds 16 rows today and its heading has already been
 * corrected twice for drift ("eleven" vs 13), so this is pinned below the real
 * figure but far above the "rows 1–5" the stale §9 text describes — a parser
 * that silently found only the first few rows must fail, not pass.
 */
const MIN_CORE_ROWS = 12;

const markdown = readFileSync(TESTING_SPEC, 'utf8');
const specFiles = collectSpecFiles();
const implemented = implementedInTitles(specFiles);
const core = coreInvariants(markdown);
const mandated = mandatedCriterionInvariants(markdown);
const allInvariants = [...core, ...mandated];

describe('T-META-002 — every non-negotiable invariant resolves to a real test', () => {
  it('T-META-002a · every invariant names a test that exists, and the baseline is exact', () => {
    expect(unbackedInvariants(allInvariants, implemented)).toEqual([...KNOWN_UNBACKED].sort());
  });

  it('T-META-002b · the §6 table parser finds the whole table, not its first rows', () => {
    expect(core.length).toBeGreaterThanOrEqual(MIN_CORE_ROWS);

    // Spot checks at BOTH ends. The stale §9 text says "rows 1-5", so a parser
    // that stopped early would still clear a bare count floor if the table
    // grew; naming a late row is what makes truncation fail here.
    const properties = core.map((row) => row.where);
    expect(properties).toContain('§6 row 1');
    expect(properties).toContain('§6 row 16');
    expect(core.every((row) => row.ids.length > 0)).toBe(true);
  });

  it('T-META-002c · the four invariant criteria named outside §6 are all found', () => {
    expect(mandated.map((row) => row.where).sort()).toEqual([
      'US-016 AC-6',
      'US-021 AC-6',
      'US-026 AC-6',
      'US-038 AC-5',
    ]);
    expect(mandated.every((row) => row.ids.length > 0)).toBe(true);
  });

  it('T-META-002d · the detector fires on a missing test, stays quiet on a present one', () => {
    const invariant: Invariant[] = [{ where: '§6 row 1', property: 'x', ids: ['T-FAKE-001'] }];

    expect(unbackedInvariants(invariant, new Set())).toEqual(['§6 row 1: T-FAKE-001']);
    expect(unbackedInvariants(invariant, new Set(['T-FAKE-001']))).toEqual([]);

    // Wiring half — the REAL corpus, not only the synthetic one. Without this
    // the case passes with `implementedInTitles` blinded to an empty set.
    expect(implemented.size).toBeGreaterThan(100);
    expect(specFiles.length).toBeGreaterThan(20);
  });

  it('T-META-002e · the slash shorthand expands, so a multi-test invariant is fully checked', () => {
    // `T-ATTR-001/002/003` is one cell naming three tests. A naive id regex
    // reads only the first and silently drops two thirds of the coverage of
    // §6 row 5 (TMDB attribution on every surface).
    expect(expandIdShorthand('`T-ATTR-001/002/003`')).toEqual([
      'T-ATTR-001',
      'T-ATTR-002',
      'T-ATTR-003',
    ]);

    // And it really is exercised by the live table, not just this example.
    const row5 = core.find((row) => row.where === '§6 row 5');
    expect(row5?.ids).toEqual(['T-ATTR-001', 'T-ATTR-002', 'T-ATTR-003']);
  });

  it('T-META-002f · a baselined invariant is still genuinely unbacked', () => {
    // If somebody writes the test but leaves the line, `a` already fails. This
    // adds the reverse reading: the baseline entry must still name a real row
    // of the table, so a renumbered or deleted row cannot leave a dead excuse
    // sitting in the list.
    const known = new Set(allInvariants.map((row) => row.where));
    for (const entry of KNOWN_UNBACKED) {
      const [where, id] = entry.split(': ');
      expect(known.has(where)).toBe(true);
      expect(implemented.has(id)).toBe(false);
    }
  });
});
