/**
 * TASK-064 — classification: new vs already present, PER SERVICE.
 *
 * `specs/ai.md` §6.1 (REQ-010), stage 5 of the pipeline:
 *
 * ```
 * classification = existsActiveListing(workIdentity, batch.service)
 *   ? 'already-present-for-this-service'
 *   : 'new'
 * ```
 *
 * Three properties in that one line are load-bearing, and each has its own
 * named test because each fails SILENTLY if implemented loosely:
 *
 * 1. **ACTIVE listings only** (`T-CLS-010`). A `removed` listing must not
 *    suppress the `new` classification.
 * 2. **The BATCH'S service only** (`T-CLS-011`). A work active on the *other*
 *    service is `new` here. Netflix and Max lists are independent; a title on
 *    Max is genuinely a new Netflix listing.
 * 3. **A `removed` listing for THIS service is `new`** (`T-CLS-012`). This is
 *    invariant L1/A33: a reappearance is a brand-new row dated today, never a
 *    revival of the old one. Treating it as `already-present` would skip
 *    creating the row and the title would silently never come back.
 *
 * ⚠ **Classification is not a suppression check.** `specs/ai.md` §5 gates
 * suppressed works out BEFORE this stage (`T-SUP-002`), keyed on work identity.
 * This module deliberately knows nothing about suppression: folding the two
 * together is the highest-risk silent defect in the product (PRD R-5), because
 * a suppression evaluated here would be scoped to the batch's service, while
 * suppression is service-independent by definition.
 *
 * ⚠ **A candidate that failed to match is never classified** (`T-CLS-013`).
 * `classifyCandidate` returns `null` for a null work identity rather than
 * guessing `new`, so an extraction failure surfaces in the unmatched section
 * instead of masquerading as an addition.
 *
 * Pure: no I/O, no clock, no database. The caller supplies the active-listing
 * snapshot it has already loaded.
 */

import type { CandidateClassification, ListingState, Service } from './enums.js';

/**
 * The minimum a caller must supply per listing. Deliberately structural rather
 * than the full `ServiceListing`: the API layer reads only these three columns
 * for classification, and widening it would invite passing whole `Title`
 * documents through the domain.
 */
export interface ListingSnapshot {
  workIdentity: string;
  service: Service;
  state: ListingState;
}

/**
 * A prepared lookup over the owner's listings. Built once per batch — an
 * `existsActiveListing` implemented as a linear scan is O(candidates ×
 * listings), which on a few thousand titles is measurable on 0.25 vCPU.
 */
export interface ActiveListingIndex {
  /** `true` iff an ACTIVE listing exists for this work on this service. */
  has(workIdentity: string, service: Service): boolean;
  /** Number of distinct (work, service) pairs held. Diagnostics only. */
  readonly size: number;
}

/** Key separator. `|` cannot appear in a service name, and `WORK_IDENTITY_RE` forbids it. */
const KEY_SEP = '|';

function keyFor(workIdentity: string, service: Service): string {
  return `${workIdentity}${KEY_SEP}${service}`;
}

/**
 * Build the lookup. **Removed listings are dropped here**, so a caller cannot
 * accidentally classify against them even if it passes its full listing set —
 * which is the ordinary case, because the review query loads all listings for
 * the title cards anyway.
 */
export function buildActiveListingIndex(listings: readonly ListingSnapshot[]): ActiveListingIndex {
  const keys = new Set<string>();
  for (const listing of listings) {
    if (listing.state !== 'active') continue;
    if (listing.workIdentity === '') continue;
    keys.add(keyFor(listing.workIdentity, listing.service));
  }
  return {
    has(workIdentity: string, service: Service): boolean {
      if (workIdentity === '') return false;
      return keys.has(keyFor(workIdentity, service));
    },
    get size(): number {
      return keys.size;
    },
  };
}

/**
 * Classify one resolved work identity against the batch's service.
 *
 * Returns `null` when `workIdentity` is `null` — an unmatched candidate has no
 * classification at all (`T-CLS-013`). `null` is NOT a third classification
 * value; it is the absence of one, and the persisted column is nullable for
 * exactly this reason (`specs/data-model.md` §3.7).
 */
export function classifyWorkIdentity(
  workIdentity: string | null,
  service: Service,
  index: ActiveListingIndex,
): CandidateClassification | null {
  if (workIdentity === null || workIdentity === '') return null;
  return index.has(workIdentity, service) ? 'already-present-for-this-service' : 'new';
}

/** The subset of an extraction candidate classification needs. */
export interface ClassifiableCandidate {
  candidateId: string;
  resolvedWorkIdentity: string | null;
}

export interface ClassifiedCandidate extends ClassifiableCandidate {
  classification: CandidateClassification | null;
}

/**
 * Classify a whole batch's candidates against ONE service — the batch's.
 *
 * The service is a single parameter, not a per-candidate field, because a batch
 * is scoped to exactly one service (invariant 3) and per-candidate services
 * would make a cross-service classification expressible.
 */
export function classifyCandidates<T extends ClassifiableCandidate>(
  candidates: readonly T[],
  service: Service,
  index: ActiveListingIndex,
): (T & { classification: CandidateClassification | null })[] {
  return candidates.map((candidate) => ({
    ...candidate,
    classification: classifyWorkIdentity(candidate.resolvedWorkIdentity, service, index),
  }));
}
