import { describe, expect, it } from 'vitest';
import {
  catalogueEdition,
  editionForText,
  editionLabelText,
  mergeEditionLabels,
  parseEditionLabel,
  parseEditionLabels,
  releaseYearText,
  type EditionLabel,
} from '../src/editions.js';
import { matchCandidate } from '../src/matching/tmdbMatcher.js';
import { normaliseTitleText } from '../src/identity.js';
import { parseCandidatePatch, parseManualEntry } from '../src/candidatePatch.js';

const name = 'The X-Files: I Want to Believe';
const edition: EditionLabel = { name: `${name} Vrach Frankenshteyn`, kind: 'directors-cut' };

describe('T-EDITION-001 catalogue editions preserve canonical identity', () => {
  it('recognizes typed catalogue aliases, not arbitrary alternative titles', () => {
    expect(catalogueEdition(edition.name, "director's cut")).toEqual(edition);
    expect(catalogueEdition(edition.name, '')).toBeNull();
    expect(catalogueEdition(edition.name, null)).toBeNull();
    expect(catalogueEdition(null, "director's cut")).toBeNull();
    expect(catalogueEdition('x'.repeat(501), 'uncut')).toBeNull();
    expect(catalogueEdition('Example extended', 'extended edition')?.kind).toBe('extended');
  });

  it('requires distinguishing evidence, including the suffix in manual search', () => {
    expect(
      editionForText('THE X FILES I WANT TO BELIEVE VRACH FRANKENSHTEYN', name, [edition]),
    ).toEqual(edition);
    expect(editionForText('Vrach Frankenshteyn', name, [edition])).toEqual(edition);
    for (const text of ['', name, 'I Want to Believe', 'Frankenshteyn', 'Unrelated movie']) {
      expect(editionForText(text, name, [edition])).toBeUndefined();
    }
    expect(editionForText(edition.name, name, [])).toBeUndefined();
  });

  it('keeps the same work ID and original film year, with ordinary scoring safeguards', () => {
    const result = {
      tmdbId: 8836,
      mediaType: 'movie' as const,
      name,
      releaseYear: 2008,
      posterPath: null,
      edition,
    };
    const outcome = matchCandidate(
      { normalisedText: normaliseTitleText(edition.name), extractedYear: null },
      [result],
    );
    expect(outcome.resolvedWorkIdentity).toBe('tmdb:movie:8836');
    expect(outcome.matchCandidates[0]).toMatchObject({ edition, releaseYear: 2008, score: 1 });
    expect(
      matchCandidate({ normalisedText: normaliseTitleText(name), extractedYear: null }, [result])
        .resolvedWorkIdentity,
    ).toBe(outcome.resolvedWorkIdentity);
    expect(
      matchCandidate({ normalisedText: normaliseTitleText(edition.name), extractedYear: 2026 }, [
        result,
      ]).uncertain,
    ).toBe(true);
  });

  it('merges labels without losing earlier cuts; malformed persisted data is not hidden', () => {
    const other: EditionLabel = { name: 'Another cut', kind: 'extended' };
    expect(
      mergeEditionLabels([edition], [{ ...edition, name: edition.name.toUpperCase() }, other]),
    ).toEqual([edition, other]);
    expect(parseEditionLabels(JSON.stringify([edition]))).toEqual([edition]);
    expect(parseEditionLabel(JSON.stringify(edition))).toEqual(edition);
    expect(parseEditionLabel(null)).toBeUndefined();
    expect(parseEditionLabels(undefined)).toEqual([]);
    expect(() => parseEditionLabels('broken')).toThrow();
    expect(() => parseEditionLabel('{"name":"wrong"}')).toThrow();
    expect(releaseYearText(2008, true)).toBe('Original film: 2008');
    expect(releaseYearText(2008, false)).toBe('2008');
    expect(releaseYearText(null, true)).toBeNull();
    expect(editionLabelText(edition)).toContain("Director's cut");
  });

  it('validates edition selections without putting them into identity', () => {
    expect(parseManualEntry({ tmdbId: 8836, mediaType: 'movie', edition })).toMatchObject({
      ok: true,
      value: { edition },
    });
    expect(parseManualEntry({ tmdbId: 8836, mediaType: 'movie', edition: {} }).ok).toBe(false);
    const patch = {
      disposition: 'corrected',
      tmdbId: 8836,
      mediaType: 'movie',
      correctedName: name,
      correctedEdition: edition,
    };
    expect(parseCandidatePatch(patch)).toMatchObject({ ok: true, value: { display: { edition } } });
    expect(parseCandidatePatch({ ...patch, correctedEdition: {} }).ok).toBe(false);
    expect(parseCandidatePatch({ ...patch, correctedName: undefined }).ok).toBe(false);
  });
});
