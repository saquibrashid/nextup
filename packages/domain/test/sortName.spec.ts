/**
 * `deriveSortName` — the `sort=name` ordering key (TASK-219, `T-API-029`).
 *
 * ⚠ **THE FIXTURES HERE ARE ADVERSARIAL ON PURPOSE.** The whole reason this
 * feature was split out of TASK-216 is that the obvious fixture cannot detect
 * the defect: under the BIN2 database default an unqualified `ORDER BY` sorts
 * `apple` after `Zebra`, and on a title-cased list — `The Matrix`, `Zodiac`,
 * `Arrival` — that still looks alphabetical. Every case below that uses
 * lower-case or accented text is load-bearing for that reason, not decoration.
 */

import { describe, expect, it } from 'vitest';

import { SORT_NAME_MAX_LENGTH, deriveSortName } from '../src/sortName.js';

/** A title as the deriver sees it. */
function title(tmdbName: string | null, rawExtractedText: string | null = null) {
  return { tmdbName, rawExtractedText };
}

describe('deriveSortName', () => {
  it('T-API-029a: strips a leading English article', () => {
    expect(deriveSortName(title('The Matrix'))).toBe('Matrix');
    expect(deriveSortName(title('A Quiet Place'))).toBe('Quiet Place');
    expect(deriveSortName(title('An Education'))).toBe('Education');
  });

  it('T-API-029b: strips the article case-insensitively', () => {
    // OCR of a screenshot routinely yields all-caps. If the strip were
    // case-sensitive, `THE FLY` would file under T while `The Fly` filed under
    // F — the same work in two places depending on how it was captured.
    expect(deriveSortName(title('THE FLY'))).toBe('FLY');
    expect(deriveSortName(title('the fly'))).toBe('fly');
  });

  it('T-API-029c: does NOT strip foreign articles', () => {
    // ⚠ OWNER DECISION, 2026-09-15. In an English-market Netflix/Max list a
    // foreign article reads as part of the title: the owner looks for
    // `Les Misérables` under L. Netflix and Max file them the same way.
    //
    // ⚠ THIS TEST IS THE GUARD AGAINST "COMPLETING" THE ARTICLE LIST. Adding
    // le/la/les/el/los/der/die/das looks like an improvement and would
    // silently refile four of these rows.
    expect(deriveSortName(title('Les Misérables'))).toBe('Les Misérables');
    expect(deriveSortName(title('El Camino'))).toBe('El Camino');
    expect(deriveSortName(title('La La Land'))).toBe('La La Land');
    expect(deriveSortName(title('Das Boot'))).toBe('Das Boot');
    expect(deriveSortName(title('Le Mans'))).toBe('Le Mans');
  });

  it('T-API-029d: leaves `Die Hard` under D', () => {
    // The specific collision that killed multi-language stripping: `die` is a
    // German article AND a common English verb, and there is no
    // `original_language` column to disambiguate with.
    expect(deriveSortName(title('Die Hard'))).toBe('Die Hard');
  });

  it('T-API-029e: strips at most ONE article', () => {
    // `The A Team` files under A, not under Team. Repeated stripping keeps
    // eating real words.
    expect(deriveSortName(title('The A Team'))).toBe('A Team');
  });

  it('T-API-029g: never strips down to nothing', () => {
    // Films called `A`, `Us` and `Them` exist, and a screenshot line can read
    // just `The`. Stripping unconditionally collapses them into one
    // indistinguishable block at the top of the list.
    expect(deriveSortName(title('The'))).toBe('The');
    expect(deriveSortName(title('A'))).toBe('A');
    expect(deriveSortName(title('The '))).toBe('The');
  });

  it('T-API-029h: requires a following word, not merely a following space', () => {
    // `Theodore` must not become `odore`: the prefix check is on the word, not
    // on the characters.
    expect(deriveSortName(title('Theodore Rex'))).toBe('Theodore Rex');
    expect(deriveSortName(title('Analyze This'))).toBe('Analyze This');
    expect(deriveSortName(title('Apollo 13'))).toBe('Apollo 13');
  });

  it('T-API-029i: falls back to the extracted text when unmatched', () => {
    // ⚠ OWNER DECISION: the key is the DISPLAYED name. An unmatched title has
    // no `tmdbName` and the UI shows `rawExtractedText`, so ordering by
    // `tmdbName` alone would file a chunk of the list under letters their
    // visible titles do not start with.
    expect(deriveSortName(title(null, 'The Bear'))).toBe('Bear');
    expect(deriveSortName(title(null, 'severance'))).toBe('severance');
  });

  it('T-API-029j: prefers tmdbName when both are present', () => {
    expect(deriveSortName(title('Arrival', 'arivall'))).toBe('Arrival');
  });

  it('T-API-029k: is null when there is no usable name', () => {
    // `null` sorts LAST in both directions — an absence of data must never be
    // presented as a claim about the work.
    expect(deriveSortName(title(null, null))).toBeNull();
    expect(deriveSortName(title('', null))).toBeNull();
    expect(deriveSortName(title('   ', null))).toBeNull();
    expect(deriveSortName(title(null, '\n\t '))).toBeNull();
  });

  it('T-API-029l: normalises whitespace', () => {
    // ⚠ NOT COSMETIC. `rawExtractedText` comes from OCR and carries newlines
    // and runs of spaces; a leading space sorts BEFORE every letter under any
    // collation, so one stray character would pin a title to the top of the
    // list for a reason nothing on screen could explain.
    expect(deriveSortName(title(null, '  The   Bear \n'))).toBe('Bear');
    expect(deriveSortName(title('Blade\nRunner'))).toBe('Blade Runner');
  });

  it('T-API-029m: preserves accents in the stored key', () => {
    // ⚠ FOLDING ACCENTS HERE WOULD BE THE WRONG LAYER. Accent-insensitivity is
    // the COLUMN's job — `sort_name` is declared `COLLATE
    // Latin1_General_100_CI_AI` in migration `0010`. Folding them here as well
    // would destroy the value the API returns for the cursor and would make
    // the stored key disagree with the displayed title for no gain.
    expect(deriveSortName(title('Amélie'))).toBe('Amélie');
    expect(deriveSortName(title('Léon'))).toBe('Léon');
  });

  it('T-API-029n: caps the key at the column width', () => {
    const long = `The ${'x'.repeat(SORT_NAME_MAX_LENGTH + 50)}`;
    const derived = deriveSortName(title(long));

    expect(derived).toHaveLength(SORT_NAME_MAX_LENGTH);
    // Truncation happens AFTER the article is stripped, so the stored
    // characters are characters of the part that actually orders the row.
    expect(derived?.startsWith('x')).toBe(true);
  });

  it('T-API-029o: is idempotent', () => {
    // The backfill may be run twice, and a second pass must not keep eating
    // words off the front of the same title.
    const once = deriveSortName(title('The Matrix'));
    const twice = deriveSortName(title(once));
    expect(twice).toBe(once);
  });
});
