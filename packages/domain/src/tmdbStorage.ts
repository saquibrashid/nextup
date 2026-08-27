/**
 * TASK-061 — TMDB metadata storage validation (US-007 AC-2/AC-6, REQ-029).
 *
 * `tmdbMetadataSchema` in `schemas.ts` already describes the shape. What this
 * module adds is the **policy**: an unlisted field is an ERROR, and the error
 * names it.
 *
 * ⚠ REJECT, DO NOT STRIP — and the distinction is the entire point of the
 * task. Zod's default behaviour for an object schema is to silently drop keys
 * it does not know, which produces exactly the outcome the acceptance
 * criterion is worded to forbid: TMDB adds a field, we store nothing extra,
 * and nobody ever finds out that the response we are parsing has changed
 * shape. Rejecting turns a TMDB API change into a loud, dated, testable
 * failure at the one boundary that can see it.
 *
 * ⚠ AND IT IS A RULE A DEFENCE (`specs/ai.md` §4.4, RSK-022). The fields TMDB
 * would most plausibly add — `overview`, `tagline`, `keywords` — are precisely
 * the prose that must never reach an inference service. A stripping parser
 * makes storing them a one-line change nobody reviews; a rejecting parser
 * makes it a schema edit, which is reviewable. `T-AI-013` guards the wire;
 * this guards the store.
 *
 * Pure, and deliberately in `packages/domain`: it is the same rule wherever
 * metadata is written, and putting it beside the schema keeps the allow-list
 * and its enforcement from drifting apart.
 */

import { tmdbMetadataSchema } from './schemas.js';
import type { TmdbMetadata } from './types.js';

/**
 * The stored allow-list, stated once as data.
 *
 * ⚠ Derived from the schema, never re-typed. A hand-maintained copy would
 * agree with `tmdbMetadataSchema` on the day it was written and silently
 * diverge afterwards, which is the failure this constant exists to prevent.
 */
export const TMDB_STORED_FIELDS: readonly string[] = Object.freeze(
  Object.keys(tmdbMetadataSchema.shape).sort(),
);

/** An unlisted field reached the storage boundary. */
export class TmdbFieldNotAllowedError extends Error {
  /** Every offending key, sorted — not just the first one Zod happened to hit. */
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(
      `TMDB metadata carries ${String(fields.length)} field(s) outside the stored ` +
        `allow-list: ${fields.join(', ')}. Add it to tmdbMetadataSchema deliberately, ` +
        'or drop it at the client. It must not be stored by accident.',
    );
    this.name = 'TmdbFieldNotAllowedError';
    this.fields = fields;
  }
}

/**
 * Parse metadata on its way into the store.
 *
 * Throws {@link TmdbFieldNotAllowedError} when the value carries a key outside
 * the allow-list, and a plain `ZodError` when a listed field is the wrong
 * shape. The two are separate because they mean different things: an unlisted
 * field is a change in TMDB (or in our client) that a human must look at, and
 * a bad value is ordinary corruption.
 */
export function parseStoredTmdbMetadata(value: unknown): TmdbMetadata {
  const result = tmdbMetadataSchema.safeParse(value);
  if (result.success) return result.data;

  // ⚠ Read the unrecognised keys off the ISSUES, not by diffing the input
  // against `TMDB_STORED_FIELDS`. A diff would report a key that a nested
  // schema legitimately accepted, and would miss the case where `.strict()` is
  // later removed — at which point the diff still "works" while the schema no
  // longer rejects anything.
  const unlisted = new Set<string>();
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) unlisted.add(key);
    }
  }

  if (unlisted.size > 0) throw new TmdbFieldNotAllowedError([...unlisted].sort());
  throw result.error;
}
