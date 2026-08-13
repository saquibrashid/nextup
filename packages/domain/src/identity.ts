// Canonical work identity — `specs/data-model.md` §2.

import { sha256 } from '@noble/hashes/sha2.js';

import { utf8 } from './runtime.js';

/**
 * A `workIdentity` is a single opaque string on `title` and the entire key of
 * `suppression`. Exactly two forms:
 *
 *     tmdb:movie:438631            matched film
 *     tmdb:tv:66732                matched series
 *     unmatched:9f2c1a7b4e0d5c83   sha256(normaliseTitleText(rawText))[0:16]
 *
 * Four consumers share this one string and treat it identically: dedup
 * (REQ-024), suppression (REQ-071), reappearance (REQ-065) and intra-batch
 * overlap collapse (SD-02). Nothing branches on the prefix except the UI,
 * which renders an "unidentified" marker for `unmatched:*`.
 */
export const WORK_IDENTITY_RE = /^(tmdb:(movie|tv):[1-9][0-9]{0,9}|unmatched:[0-9a-f]{16})$/;

/** Media types nextup can match against TMDB. */
export type WorkMediaType = 'movie' | 'tv';

/** Articles stripped at step 4. Exactly one leading article is removed. */
const LEADING_ARTICLES = new Set(['the', 'a', 'an']);

/**
 * The ONLY normalisation of extracted title text in nextup.
 *
 * Used by unmatched identity derivation, intra-batch pre-match collapse, and
 * TMDB match scoring. **There MUST be no second implementation.** A second one
 * drifts, and the moment it does, two subsystems disagree about whether two
 * strings name the same work - which surfaces as a duplicate row or a
 * bypassed suppression, never as an error.
 *
 * Steps, in this exact order (data-model.md 2.2):
 *
 *   1. NFKD normalise, then strip combining marks   Amelie -> amelie
 *   2. lowercase (en-US)                            DUNE   -> dune
 *   3. every character outside [a-z0-9 ] -> a space  a-b:c -> a b c
 *   4. strip ONE leading article {the, a, an}       the batman -> batman
 *   5. collapse whitespace runs, trim
 *   6. NO year is appended - see 2.3.2 / SD-05
 */
export function normaliseTitleText(raw: string): string {
  const folded = raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9 ]/g, ' ');

  const tokens = folded.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0]!)) {
    tokens.shift();
  }
  return tokens.join(' ');
}

/** `tmdb:movie:438631` - the identity of a work matched to TMDB. */
export function workIdentityForTmdb(mediaType: WorkMediaType, tmdbId: number): string {
  if (!Number.isInteger(tmdbId) || tmdbId < 1) {
    throw new RangeError(`TMDB id must be a positive integer, got: ${tmdbId}`);
  }
  return `tmdb:${mediaType}:${tmdbId}`;
}

/**
 * `unmatched:<sha256(normalised)[0:16]>` - the fallback identity for a work
 * TMDB could not identify.
 *
 * The extracted YEAR is deliberately absent from the hash (SD-05). A year
 * appears on some captures of a tile and not on others, so including it splits
 * one work into two identities on the exact axis this scheme exists to hold
 * together - and does so invisibly, as a silently bypassed suppression. The
 * year is kept on `extractionCandidate.extractedYear` and used only as a TMDB
 * match hint.
 */
export function workIdentityForUnmatched(rawText: string): string {
  const digest = sha256(utf8(normaliseTitleText(rawText)));
  let hex = '';
  for (let i = 0; i < 8; i += 1) {
    hex += digest[i]!.toString(16).padStart(2, '0');
  }
  return `unmatched:${hex}`;
}

/**
 * The id of the suppression document for a work (`specs/data-model.md` §3.5).
 *
 * ⚠ **A pure function of the WORK IDENTITY, and of nothing else** (REQ-071,
 * product invariant 1). No title id, no listing id, no service, no batch —
 * because a suppressed work that reappears in a later capture becomes a
 * BRAND-NEW title row (product invariant 7). Mix a row id into this key and
 * suppression appears to work, then silently stops on the next upload,
 * re-showing something the owner explicitly said they were not interested in.
 * That is a data-loss-shaped failure the owner would have to notice by hand.
 *
 * It is deterministic rather than generated for the same reason the store
 * relies on it as the primary key: "suppress this work" must resolve to the
 * same document however many times, and from however many rows, it is invoked
 * — which is what makes the route idempotent (US-027 AC-4) without a lookup.
 */
export function suppressionIdFor(workIdentity: string): string {
  if (!WORK_IDENTITY_RE.test(workIdentity)) {
    throw new TypeError(`Not a work identity: ${workIdentity}`);
  }
  return `supp:${workIdentity}`;
}
