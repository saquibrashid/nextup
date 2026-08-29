// Runtime configuration constants for the API.
//
// TASK-014 · US-035 AC-7 · `T-INV-008`.

import {
  DEFAULT_MAX_DECODE_PIXELS,
  EXTRACT_CONFIDENCE_FLOOR,
  OCR_BOX_OVERLAP_MIN,
  OCR_SUPPORT_EXACT,
  OCR_SUPPORT_PARTIAL,
} from '@nextup/domain';

// ── The OCR cross-check thresholds (`specs/ai.md` §5, §7) ───────────────────
//
// RE-EXPORTED, not redeclared. §7 requires every tuning threshold to be
// readable in one place, and this file is that place — but the values must
// LIVE in `packages/domain` because `crossCheck()` does, and domain is pure
// TypeScript that cannot import from `apps/api` (ADR-0004).
//
// ⚠ Never turn these into local `const` declarations here. A second copy
// would drift from the one the merge actually reads, and the symptom would be
// a corroboration rate that disagrees with the documented threshold — with
// both numbers looking correct in isolation. `T-AI-019` asserts the merge
// contains no inlined numeric literals; nothing asserts that a duplicate here
// stays in sync, because it cannot.
export { EXTRACT_CONFIDENCE_FLOOR, OCR_BOX_OVERLAP_MIN, OCR_SUPPORT_EXACT, OCR_SUPPORT_PARTIAL };

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

/**
 * How stale a cached IMDb rating may be before the next *access* refreshes it
 * lazily (REQ-090, ADR-0011). Fourteen days.
 *
 * ⚠ **THIRD MEMBER OF THE NEVER-UNIFY FAMILY.** {@link IMAGE_RETENTION_DAYS},
 * {@link TMDB_METADATA_MAX_AGE_DAYS} and this constant are three separate
 * declarations with three separate call sites, permanently. `T-INV-008`
 * asserts it. The warning on `IMAGE_RETENTION_DAYS` applies here unchanged.
 *
 * `14` is deliberately **not** another "30-ish" number, so a future reader
 * cannot mistake it for the retention constant at a glance.
 *
 * Why so much shorter than metadata's 183 days: a film's title, year and
 * poster are effectively immutable, whereas a rating moves — fastest in the
 * weeks after release, which is exactly the window a watch decision cares
 * about.
 *
 * ⚠ "Stale" is overloaded here too. This is rating staleness. It is NOT
 * `metadataStale` (TMDB, 183 days), and the two must not be collapsed because
 * they share a word.
 */
export const IMDB_RATING_MAX_AGE_DAYS = 14;

// ── The pre-decode pixel budget (`specs/api.md` §5.0.2, REQ-079) ────────────

/**
 * `NEXTUP_MAX_DECODE_PIXELS` — the pixel budget the pre-decode guard enforces.
 *
 * ⚠ READ AT REQUEST TIME, NEVER CAPTURED IN A MODULE-LEVEL CONSTANT. This is a
 * function and not a `const` on purpose: a revision that changes the env var
 * must take effect without a code change, and the runbook that up-sizes the
 * container sets this in the same command. `T-IMG-022` asserts the request-time
 * read, and it fails if this is ever "simplified" into a constant evaluated at
 * import — which would silently pin the value to whatever the environment held
 * when the module was first loaded.
 *
 * ⚠ THIS VALUE AND THE CONTAINER MEMORY ARE ONE SETTING IN TWO PLACES
 * (REQ-079). The only permitted pairs are `(0.25 vCPU, 0.5 GiB, 25000000)` and
 * `(0.5 vCPU, 1.0 GiB, 50000000)`; `T-INFRA-005` fails CI on anything else.
 * Raising this alone removes the crash protection and adds no capacity.
 *
 * An unset, empty, non-numeric, zero, negative or non-integer value falls back
 * to {@link DEFAULT_MAX_DECODE_PIXELS}. Falling back is deliberate: a
 * mistyped env var must not silently disable the guard, and it must not take
 * the process down at startup either — the safe default is the one the
 * container is actually sized for.
 */
export function maxDecodePixels(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['NEXTUP_MAX_DECODE_PIXELS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_DECODE_PIXELS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_DECODE_PIXELS;
  return parsed;
}

/**
 * The two permitted compute sizings (REQ-079, invariant 14). Mirrors
 * `tools/check-infra.mjs`'s `PERMITTED_PAIRS` and `infra/aca.bicep`'s comment
 * block; `T-INFRA-005` fails CI on any deployment that is not one of these.
 *
 * ⚠ THE MEMORY FIGURE IS DERIVED FROM THE PIXEL BUDGET, NOT CONFIGURED
 * SEPARATELY, and that is the whole point. REQ-079 says memory and the decode
 * guard are ONE setting in two places. A separate `NEXTUP_CONTAINER_MEMORY`
 * env var would be a third place, and the first time someone up-sized the
 * container without updating it the diagnostic message would confidently tell
 * the owner they are on 0.5 GiB while running on 1.0 GiB — a wrong diagnosis
 * printed with total authority, which is worse than no diagnosis at all and is
 * exactly the `RSK-016` failure mode `A43-M3` exists to close.
 */
export const COMPUTE_TIERS = [
  { cpu: '0.25', memoryGiB: 0.5, maxDecodePixels: 25_000_000 },
  { cpu: '0.5', memoryGiB: 1.0, maxDecodePixels: 50_000_000 },
] as const;

/**
 * The container memory, in GiB, implied by the live pixel budget.
 *
 * An unrecognised budget (only reachable from a test that sets an arbitrary
 * `NEXTUP_MAX_DECODE_PIXELS`, since CI rejects any other deployed pair) falls
 * back to the largest tier at or below it, and to the smallest tier otherwise.
 * Never throws: a diagnostic message must not be the thing that fails.
 */
export function containerMemoryGiB(env: NodeJS.ProcessEnv = process.env): number {
  const pixels = maxDecodePixels(env);
  let memoryGiB: number = COMPUTE_TIERS[0].memoryGiB;
  for (const tier of COMPUTE_TIERS) {
    if (tier.maxDecodePixels <= pixels) memoryGiB = tier.memoryGiB;
  }
  return memoryGiB;
}

/**
 * The remedy offered by the memory messages (`api.md` §5.2.4, ADR-0008 R2.3),
 * verbatim. Always the LARGER tier: the small tier is the only one an owner
 * can be refused on in practice, and there is deliberately no third size to
 * escalate to (`docs/runbooks/scale-up-memory.md`).
 */
export const UPSIZE_REMEDY = '0.5 vCPU / 1.0 GiB (+~$4/month)';

/**
 * The runbook path cited by both memory messages.
 *
 * ⚠ SPEC CONFLICT, RESOLVED IN FAVOUR OF THE WORK ORDER AND REPORTED, NOT
 * EDITED. `api.md` §5.2.4 and ADR-0008 R2.3 write the shorthand
 * `runbooks/scale-up-memory.md`; the TASK-155 backlog row requires the message
 * to cite `docs/runbooks/scale-up-memory.md`. The backlog is the work order,
 * and the repo-rooted path is the one that actually resolves, so the longer
 * form wins — it contains the shorter as a substring, so `T-IMG-020`'s
 * assertion holds either way.
 */
export const MEMORY_RUNBOOK_PATH = 'docs/runbooks/scale-up-memory.md';
