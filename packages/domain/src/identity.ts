// Canonical work identity — `specs/data-model.md` §2.
//
// SCOPE (TASK-012). Only the regex lives here for now. `normaliseTitleText`,
// `workIdentityForTmdb` and `workIdentityForUnmatched` are TASK-015 and land in
// this same file — deliberately, because §2.2 requires exactly ONE
// normalisation implementation and splitting it across files invites a second.

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
