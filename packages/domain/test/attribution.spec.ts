/**
 * TMDB attribution constants — `T-ATTR-001` (US-011 AC-2), domain half.
 *
 * `T-ATTR-001` spans three artefacts: the constant, the API value and the
 * rendered DOM text. This file asserts the CONSTANT. The API value is asserted
 * in `apps/api/test/unit/me.spec.ts`, and the rendered DOM in the web suite.
 * All three compare against the same literal spelled out here, so a reword in
 * any one place fails somewhere.
 *
 * ⚠ Suffixes are allocated across files by hand: the web suite owns
 * `T-ATTR-001a`–`g`, the API suite owns `h`–`j`, and this file owns `k`–`n`.
 * The lint rule detects duplicate ids only WITHIN a file, so nothing mechanical
 * catches a collision here.
 */

import { describe, expect, it } from 'vitest';

import { attributionPayload, TMDB_DISCLAIMER, TMDB_LOGO_PATH } from '../src/attribution.js';

/**
 * Spelled out rather than imported: importing the constant and comparing it to
 * itself is a tautology that passes no matter how the sentence is reworded.
 */
const REQUIRED_WORDING = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

describe('T-ATTR-001 TMDB attribution constants', () => {
  it('T-ATTR-001k · US-011 AC-2 · the constant is byte-equal to the required wording', () => {
    expect(TMDB_DISCLAIMER).toBe(REQUIRED_WORDING);
  });

  it('T-ATTR-001l · US-011 AC-2 · the wording is plain ASCII, with no smart punctuation', () => {
    // An editor or a copy-paste from a styled document silently substitutes a
    // curly apostrophe or a non-breaking space. Both compare unequal to the
    // required sentence while looking identical in a diff and in a terminal.
    const codePoints = [...TMDB_DISCLAIMER].map((c) => c.codePointAt(0) ?? 0);
    expect(Math.max(...codePoints)).toBeLessThan(0x80);
    expect(TMDB_DISCLAIMER).not.toMatch(/\s{2}|\u00a0|[\u2018\u2019\u201c\u201d]/u);
  });

  it('T-ATTR-001m · specs/api.md §6.1 · the payload carries both fields, byte-equal', () => {
    expect(attributionPayload()).toStrictEqual({
      tmdbDisclaimer: REQUIRED_WORDING,
      tmdbLogoPath: '/assets/tmdb-logo.svg',
    });
  });

  it('T-ATTR-001n · a caller cannot mutate the payload for every later response', () => {
    // A shared exported literal would let one caller's mutation change what
    // every subsequent response says — a licensing obligation edited at
    // runtime, from anywhere, with no diff to review.
    const first = attributionPayload() as { tmdbDisclaimer: string };
    first.tmdbDisclaimer = 'tampered';
    expect(attributionPayload().tmdbDisclaimer).toBe(REQUIRED_WORDING);
  });

  it('T-ATTR-001o · specs/ui.md §8 · the logo is a local path, never a remote URL', () => {
    // Hot-linking TMDB's asset would be an outbound request on every page
    // load, which the outbound host allow-list (`T-SEC-031`) forbids.
    expect(TMDB_LOGO_PATH.startsWith('/')).toBe(true);
    expect(TMDB_LOGO_PATH).not.toMatch(/^https?:/u);
  });
});
