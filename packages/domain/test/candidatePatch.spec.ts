/**
 * TASK-066 — `packages/domain/src/candidatePatch.ts` (`specs/api.md` §6.18,
 * §6.19). `T-REV-011`.
 */

import { describe, expect, it } from 'vitest';

import {
  CONFIRMABLE_SECTIONS,
  isConfirmable,
  parseCandidatePatch,
  parseConfirmAllSection,
  parseManualEntry,
  SETTABLE_DISPOSITIONS,
} from '../src/candidatePatch.js';

describe('T-REV-011 · parseCandidatePatch · the three simple dispositions', () => {
  it('T-REV-011a: accepts every settable disposition', () => {
    // Looped INSIDE the test, not with a computed title: a template-literal
    // title hides the T- id from the CI gate that maps ids to acceptance
    // criteria (T-META-004).
    for (const disposition of SETTABLE_DISPOSITIONS) {
      const result = parseCandidatePatch({ disposition });
      expect(result, disposition).toEqual({
        ok: true,
        value: { kind: 'disposition', disposition },
      });
    }
  });

  it('T-REV-011b: refuses a disposition outside the permitted set', () => {
    const result = parseCandidatePatch({ disposition: 'applied' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details['permitted']).toEqual([...SETTABLE_DISPOSITIONS, 'corrected']);
  });

  it('T-REV-011c: refuses a bare corrected with no target — there is nothing to correct TO', () => {
    const result = parseCandidatePatch({ disposition: 'corrected' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details['field']).toBe('tmdbId');
  });

  it('T-REV-011d: refuses a correction payload carried on a NON-corrected disposition', () => {
    // Silently confirming the ORIGINAL match here adds the wrong work to the
    // owner's list, with a 200 saying it worked.
    const result = parseCandidatePatch({ disposition: 'confirmed', tmdbId: 41733 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('corrected');
  });
});

describe('T-REV-011 · parseCandidatePatch · correction', () => {
  it('T-REV-011e: accepts a well-formed correction', () => {
    const result = parseCandidatePatch({
      disposition: 'corrected',
      tmdbId: 41733,
      mediaType: 'movie',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'corrected',
        tmdbId: 41733,
        mediaType: 'movie',
        // REQ-109 — absent display fields are `null`, never an error: a client
        // correcting without a search result in hand is still entitled to.
        display: null,
      },
    });
  });

  it('T-REV-011f: an older client sending confirmDuplicate is neither obeyed nor refused', () => {
    /*
     * ⚠ This case is INVERTED from what it used to assert, and the inversion
     * is the point.
     *
     * `confirmDuplicate` existed only to escape a duplicate gate in
     * `applyCorrection` that contradicted US-012 AC-5 — see `T-REV-014`. With
     * the gate gone the flag confirms nothing, so it is dropped from the
     * parsed value entirely.
     *
     * It is deliberately IGNORED rather than refused. Refusing would 400 a
     * correction an older client is entitled to make, over a field whose
     * presence or absence no longer changes a single byte of the outcome —
     * turning a harmless stale parameter into a hard failure on the exact
     * screen this whole fix exists to unblock. Obeying it would be worse: it
     * would imply the server still makes a decision it does not.
     */
    const result = parseCandidatePatch({
      disposition: 'corrected',
      tmdbId: 41733,
      mediaType: 'tv',
      confirmDuplicate: true,
    });
    expect(result.ok && result.value).toEqual({
      kind: 'corrected',
      tmdbId: 41733,
      mediaType: 'tv',
      display: null,
    });
  });

  /*
   * REQ-109 — the display fields that let the review card show what the owner
   * corrected TO. `T-REV-011ba`–`bf`.
   *
   * ⚠ **These are accepted here while `parseManualEntry` REFUSES a `name`,
   * and that asymmetry is deliberate.** The manual-entry route fetches the
   * work from TMDB anyway, so refusing costs nothing; `applyCorrection` is
   * network-free by an explicit recorded decision ("a TMDB outage must not
   * stop the owner fixing a wrong match"), so refusing here would cost the
   * requirement entirely. Identity is still `tmdbId` + `mediaType`; these
   * values never reach it.
   */
  it('T-REV-011ba: accepts the corrected display fields and carries them through', () => {
    const result = parseCandidatePatch({
      disposition: 'corrected',
      tmdbId: 66732,
      mediaType: 'tv',
      correctedName: 'The Haunting of Bly Manor',
      correctedReleaseYear: 2020,
      correctedPosterPath: '/bly.jpg',
    });
    expect(result.ok && result.value).toEqual({
      kind: 'corrected',
      tmdbId: 66732,
      mediaType: 'tv',
      display: {
        name: 'The Haunting of Bly Manor',
        releaseYear: 2020,
        posterPath: '/bly.jpg',
      },
    });
  });

  it('T-REV-011bb: accepts a null year and poster — not every work has either', () => {
    const result = parseCandidatePatch({
      disposition: 'corrected',
      tmdbId: 66732,
      mediaType: 'tv',
      correctedName: 'Some Unreleased Thing',
      correctedReleaseYear: null,
      correctedPosterPath: null,
    });
    expect(result.ok && result.value).toMatchObject({
      display: { name: 'Some Unreleased Thing', releaseYear: null, posterPath: null },
    });
  });

  it('T-REV-011bc: refuses a PARTIAL display payload rather than half-storing it', () => {
    // ⚠ A poster with no name renders the corrected artwork under the rejected
    // title — two facts disagreeing on one card, which is the exact failure
    // REQ-109 exists to end.
    const result = parseCandidatePatch({
      disposition: 'corrected',
      tmdbId: 66732,
      mediaType: 'tv',
      correctedPosterPath: '/bly.jpg',
    });
    expect(result.ok).toBe(false);
  });

  it('T-REV-011bd: refuses an empty or blank corrected name', () => {
    for (const correctedName of ['', '   ']) {
      const result = parseCandidatePatch({
        disposition: 'corrected',
        tmdbId: 66732,
        mediaType: 'tv',
        correctedName,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('T-REV-011be: refuses a non-integer corrected year rather than coercing it', () => {
    const result = parseCandidatePatch({
      disposition: 'corrected',
      tmdbId: 66732,
      mediaType: 'tv',
      correctedName: 'Bly Manor',
      correctedReleaseYear: '2020',
    });
    expect(result.ok).toBe(false);
  });

  it('T-REV-011bf: refuses display fields carried on a NON-corrected disposition', () => {
    // ⚠ Refused, NOT ignored. Silently dropping them would store a candidate
    // whose card then shows the rejected identity — the defect itself — while
    // the request reported success.
    const result = parseCandidatePatch({
      disposition: 'confirmed',
      correctedName: 'Bly Manor',
    });
    expect(result.ok).toBe(false);
  });

  it('T-REV-011g: refuses a non-integer, zero or negative tmdbId', () => {
    for (const tmdbId of [0, -1, 1.5, '41733', null]) {
      const result = parseCandidatePatch({ disposition: 'corrected', tmdbId, mediaType: 'movie' });
      expect(result.ok, `tmdbId=${String(tmdbId)}`).toBe(false);
    }
  });

  it('T-REV-011h: refuses a mediaType outside movie|tv', () => {
    const result = parseCandidatePatch({
      disposition: 'corrected',
      tmdbId: 41733,
      mediaType: 'person',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details['permitted']).toEqual(['movie', 'tv']);
  });

  it('T-REV-011i: an ill-typed confirmDuplicate is ignored like any other unknown key', () => {
    // Previously refused with `field: 'confirmDuplicate'`. The flag no longer
    // reaches a decision, so validating its type would be the parser refusing
    // a request over a value it does not read — and `'false'` being truthy,
    // the original hazard, cannot matter where nothing consumes it.
    const result = parseCandidatePatch({
      disposition: 'corrected',
      tmdbId: 41733,
      mediaType: 'movie',
      confirmDuplicate: 'false',
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({
      kind: 'corrected',
      tmdbId: 41733,
      mediaType: 'movie',
      display: null,
    });
  });
});

describe('T-REV-011 · parseCandidatePatch · reclassifyAsTitle', () => {
  it('T-REV-011j: accepts { reclassifyAsTitle: true }', () => {
    expect(parseCandidatePatch({ reclassifyAsTitle: true })).toEqual({
      ok: true,
      value: { kind: 'reclassify' },
    });
  });

  it('T-REV-011k: refuses reclassifyAsTitle: false rather than answering 200 to a no-op', () => {
    const result = parseCandidatePatch({ reclassifyAsTitle: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details['field']).toBe('reclassifyAsTitle');
  });

  it('T-REV-011l: refuses a truthy non-true value', () => {
    expect(parseCandidatePatch({ reclassifyAsTitle: 1 }).ok).toBe(false);
    expect(parseCandidatePatch({ reclassifyAsTitle: 'true' }).ok).toBe(false);
  });
});

describe('T-REV-011 · parseCandidatePatch · exactly one form', () => {
  it('T-REV-011m: refuses a body carrying BOTH forms instead of picking a winner', () => {
    const result = parseCandidatePatch({ disposition: 'confirmed', reclassifyAsTitle: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details['fields']).toEqual(['disposition', 'reclassifyAsTitle']);
  });

  it('T-REV-011n: the mixture is reported as ambiguous even when one form is ALSO malformed', () => {
    // Reversed, the client is told its disposition is bad and left to guess
    // why fixing it still changes nothing.
    const result = parseCandidatePatch({ disposition: 'nonsense', reclassifyAsTitle: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details['fields']).toEqual(['disposition', 'reclassifyAsTitle']);
  });

  it('T-REV-011o: refuses an empty body', () => {
    expect(parseCandidatePatch({}).ok).toBe(false);
  });

  it('T-REV-011p: refuses a non-object body', () => {
    for (const body of [null, undefined, 'confirmed', 7, [{ disposition: 'confirmed' }]]) {
      expect(parseCandidatePatch(body).ok, JSON.stringify(body ?? null)).toBe(false);
    }
  });
});

describe('T-REV-011 · parseConfirmAllSection', () => {
  it('T-REV-011q: accepts every confirmable section', () => {
    for (const section of CONFIRMABLE_SECTIONS) {
      expect(parseConfirmAllSection({ section }), section).toEqual({ ok: true, value: section });
    }
  });

  it('T-REV-011r: refuses the collapsed-by-default sections — the owner may never have seen them', () => {
    for (const section of ['probablyNotTitles', 'unreadableTiles', 'removals']) {
      const result = parseConfirmAllSection({ section });
      expect(result.ok, section).toBe(false);
    }
  });

  it('T-REV-011s: refuses a missing or non-string section', () => {
    expect(parseConfirmAllSection({}).ok).toBe(false);
    expect(parseConfirmAllSection({ section: 3 }).ok).toBe(false);
    expect(parseConfirmAllSection(null).ok).toBe(false);
  });
});

describe('T-REV-011 · isConfirmable', () => {
  it('T-REV-011t: only pending items move', () => {
    expect(isConfirmable('pending')).toBe(true);
    for (const disposition of ['confirmed', 'corrected', 'discarded']) {
      expect(isConfirmable(disposition), disposition).toBe(false);
    }
  });
});

describe('T-REV-018 · parseManualEntry · the §6.20 body', () => {
  it('T-REV-018a: accepts a well-formed manual entry for either media type', () => {
    for (const mediaType of ['movie', 'tv'] as const) {
      expect(parseManualEntry({ tmdbId: 66732, mediaType }), mediaType).toEqual({
        ok: true,
        value: { tmdbId: 66732, mediaType },
      });
    }
  });

  it('T-REV-018b: refuses a tmdbId that is not a positive integer', () => {
    for (const tmdbId of [0, -1, 1.5, '66732', null, undefined]) {
      const result = parseManualEntry({ tmdbId, mediaType: 'tv' });
      expect(result.ok, String(tmdbId)).toBe(false);
    }
  });

  it('T-REV-018c: refuses a mediaType outside the permitted set', () => {
    // `person` is the one that matters: TMDB's multi-search returns people,
    // and a client that passed one straight through would add a human being
    // to the owner's watchlist as though it were a work.
    const result = parseManualEntry({ tmdbId: 66732, mediaType: 'person' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details['field']).toBe('mediaType');
  });

  it('T-REV-018d: refuses a client-supplied disposition rather than honouring it', () => {
    // A manual entry is confirmed by definition (§6.20). Accepting
    // `discarded` here would write a row the owner cannot act on and then
    // report it back to them as a decision they made.
    const result = parseManualEntry({ tmdbId: 66732, mediaType: 'tv', disposition: 'discarded' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details['field']).toBe('disposition');
  });

  it('T-REV-018e: refuses a client-supplied name (SD-05 — the name is read from TMDB)', () => {
    const result = parseManualEntry({ tmdbId: 66732, mediaType: 'tv', name: 'Not This' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details['field']).toBe('name');
  });

  it('T-REV-018f: refuses a body that is not an object', () => {
    for (const body of [null, [], 'tv', 7]) {
      expect(parseManualEntry(body).ok, JSON.stringify(body)).toBe(false);
    }
  });
});
