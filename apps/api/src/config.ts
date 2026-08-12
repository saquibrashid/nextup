// Runtime configuration constants for the API.
//
// TASK-014 · US-035 AC-7 · `T-INV-008`.

/**
 * How long an uploaded screenshot is retained before the Azure Blob Storage
 * lifecycle rule purges it (NFR-019, ADR-0006, REQ-078). Drives
 * `uploadedImage.retainUntil`, and nothing else.
 *
 * ⚠ **This is NOT the same 30-ish-day number as
 * {@link TMDB_METADATA_MAX_AGE_DAYS}, and the two must never be unified,
 * aliased, or derived from one another.** They are numerically similar today
 * and semantically unrelated: this one is a privacy commitment the owner is
 * told about in `/about`; that one is a cache-freshness threshold nobody sees.
 * Merging them means a future change to a caching policy silently rewrites a
 * stated retention promise — the kind of defect that is invisible in review
 * because the diff looks like a constant being tidied up. `T-INV-008` asserts
 * they are two separate exported declarations sharing no call site.
 */
export const IMAGE_RETENTION_DAYS = 30;

/**
 * How stale cached TMDB metadata may be before the next *access* refreshes it
 * lazily (NFR-014). Six months. Refresh happens on read, in-request — it is
 * **not** a scheduled job, because REQ-041 permits exactly two non-owner
 * processes and a scheduler is not one of them.
 *
 * ⚠ See the warning on {@link IMAGE_RETENTION_DAYS}: separate constant,
 * separate call site, permanently.
 *
 * ⚠ "Stale" is overloaded in this codebase. This is the **metadata** staleness
 * threshold and it is required. The *list*-staleness threshold
 * (`LIST_STALENESS_DAYS`, REQ-040, ASM-038) was **retired outright at A46**
 * together with the staleness nudge: there is no list-staleness constant, no
 * derived `stale` state and no nag, and none may be added. What survives is
 * the factual per-service last-updated date (REQ-039) — show the fact, never
 * nag about it.
 */
export const TMDB_METADATA_MAX_AGE_DAYS = 183;
