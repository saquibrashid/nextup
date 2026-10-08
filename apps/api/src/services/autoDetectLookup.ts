/**
 * Auto-detect import — the review-time service lookup (#396, PRD `A57`,
 * US-066, ADR-0010 Rev 6, `specs/api.md` §6.17a/§6.49).
 *
 * For an auto-detect batch, each matched title's service is LOOKED UP from
 * TMDB watch providers while the owner reviews, and only PROPOSED: nothing
 * lands until the owner closes the batch. The provider mapping is the one
 * Waiting to stream and Library availability already use
 * (`flaggedProvidersFor`, `yourServicesFrom`) — there is no second one.
 *
 * ⚠ **OWNER-TRIGGERED, NEVER SCHEDULED (invariant 5).** Lookups run only
 * inside the owner's own review request (loading the review, or the explicit
 * "Look up again" tap) and write only the candidate's lookup columns. They
 * change no list state, so PRD §7.4's background-process list is unchanged
 * and `T-CI-005g` still counts four.
 *
 * ⚠ **CAPPED AND SERIAL.** `REVIEW_SERVICE_LOOKUP_PER_REQUEST` bounds one
 * request; the rest are looked up on the next load. It is a SEPARATE constant
 * from `AVAILABILITY_REFRESH_PER_REQUEST` and `AVAILABILITY_CHECK_BATCH`, so
 * tuning one can never silently widen another (the `T-INV-008` rule).
 *
 * ⚠ **A FAILURE NEVER BLOCKS REVIEW.** A thrown lookup is recorded as
 * `failed`: the row says "Couldn't look up", the owner picks a service by
 * hand or retries. TMDB having no provider data is `unknown` (ADR-0010
 * Trap 4) and proposes nothing either.
 */

import {
  mediaTypeForWorkIdentity,
  orderedServices,
  type Service,
  type ServiceLookupStatus,
} from '@nextup/domain';

import { parseProviderList } from './libraryAvailability.js';
import { DEFAULT_AVAILABILITY_REGION, flaggedProvidersFor } from './watchAvailability.js';
import type { WatchProviderSource } from './watchAvailability.js';

/**
 * The most candidates one review request may look up.
 *
 * ⚠ A ceiling per owner request, not a sweep. A typical capture is a screen
 * or two of titles; twenty serial lookups keep the review load short on a
 * 0.25 vCPU replica, and the owner's next load (or "Look up again") picks up
 * any remainder. Never derive it from, or feed it into, the availability caps.
 */
export const REVIEW_SERVICE_LOOKUP_PER_REQUEST = 20;

/** The slice of a stored candidate the lookup reads. */
export interface LookupCandidateRow {
  id: string;
  resolvedWorkIdentity: string | null;
  reviewDisposition: string;
  collapsedIntoCandidateId: string | null;
  serviceLookupStatus: string | null;
  serviceLookupIdentity: string | null;
}

/** What one lookup writes onto its candidate. */
export interface ServiceLookupWrite {
  id: string;
  serviceLookupStatus: ServiceLookupStatus;
  serviceLookupIdentity: string;
  serviceLookupAt: Date;
  lookedUpAvailableOn: string | null;
  lookedUpRentOn: string | null;
}

/** `tmdb:movie:438631` → `{ mediaType: 'movie', tmdbId: 438631 }`, else `null`. */
export function tmdbRefFor(
  workIdentity: string | null,
): { mediaType: 'movie' | 'tv'; tmdbId: number } | null {
  const mediaType = mediaTypeForWorkIdentity(workIdentity);
  if (mediaType === null || workIdentity === null) return null;
  const tmdbId = Number(workIdentity.split(':')[2]);
  return Number.isSafeInteger(tmdbId) && tmdbId > 0 ? { mediaType, tmdbId } : null;
}

/**
 * Does this candidate need a lookup now?
 *
 * - `missing`: never looked up, or looked up for a DIFFERENT work (the owner
 *   corrected the match since — the old answer is stale, not wrong).
 * - `retry`: also re-asks `failed` and `unknown` — the owner's explicit tap.
 *
 * ⚠ Discarded and collapsed rows are never looked up: they write nothing on
 * close, so asking TMDB about them spends the budget on nothing.
 */
export function needsServiceLookup(row: LookupCandidateRow, mode: 'missing' | 'retry'): boolean {
  if (tmdbRefFor(row.resolvedWorkIdentity) === null) return false;
  if (row.collapsedIntoCandidateId !== null || row.reviewDisposition === 'discarded') return false;
  if (row.serviceLookupStatus === null || row.serviceLookupIdentity !== row.resolvedWorkIdentity) {
    return true;
  }
  return (
    mode === 'retry' &&
    (row.serviceLookupStatus === 'failed' || row.serviceLookupStatus === 'unknown')
  );
}

/**
 * One TMDB answer → the stored outcome.
 *
 * ⚠ `found` is decided by `flatrate` ALONE (US-042 AC-5): a rent/buy offer is
 * not streaming on a service, and never pre-selects one.
 */
export function lookupOutcome(
  offers: { flatrate: string[]; rentOrBuy: string[] } | null,
  yourServices: readonly Service[],
): { status: ServiceLookupStatus; services: Service[] } {
  const flagged = flaggedProvidersFor(offers === null ? null : offers.flatrate);
  if (flagged === null) return { status: 'unknown', services: [] };
  const services = orderedServices(flagged.filter((service) => yourServices.includes(service)));
  return services.length > 0 ? { status: 'found', services } : { status: 'none', services: [] };
}

/**
 * Look up the given candidates, serially, up to `limit`, and return what to
 * write. A thrown lookup is a `failed` write, never an exception.
 */
export async function runServiceLookups(
  rows: readonly LookupCandidateRow[],
  source: WatchProviderSource,
  yourServices: readonly Service[],
  now: Date,
  limit: number = REVIEW_SERVICE_LOOKUP_PER_REQUEST,
): Promise<ServiceLookupWrite[]> {
  const writes: ServiceLookupWrite[] = [];
  for (const row of rows.slice(0, limit)) {
    const ref = tmdbRefFor(row.resolvedWorkIdentity);
    if (ref === null || row.resolvedWorkIdentity === null) continue;
    let offers: { flatrate: string[]; rentOrBuy: string[] } | null;
    let failed = false;
    try {
      // ⚠ The region is the one every availability answer uses (`A49`),
      // passed explicitly (`T-AVAIL-010`).
      offers = await source.getWatchOffers(ref.mediaType, ref.tmdbId, DEFAULT_AVAILABILITY_REGION);
    } catch {
      offers = null;
      failed = true;
    }
    writes.push({
      id: row.id,
      serviceLookupStatus: failed ? 'failed' : lookupOutcome(offers, yourServices).status,
      serviceLookupIdentity: row.resolvedWorkIdentity,
      serviceLookupAt: now,
      lookedUpAvailableOn: failed || offers === null ? null : JSON.stringify(offers.flatrate),
      lookedUpRentOn: failed || offers === null ? null : JSON.stringify(offers.rentOrBuy),
    });
  }
  return writes;
}

/**
 * A stored lookup, as the review serves it. The services are re-derived from
 * the stored providers against the owner's CURRENT services, so a service the
 * owner started using since the lookup is pre-selected without asking TMDB
 * again. `failed` and `unknown` are served as stored.
 */
export function storedLookupOutcome(
  row: { serviceLookupStatus: string | null; lookedUpAvailableOn: string | null },
  yourServices: readonly Service[],
): { status: ServiceLookupStatus; services: Service[] } | null {
  const status = row.serviceLookupStatus;
  if (status === null) return null;
  if (status === 'failed' || status === 'unknown') return { status, services: [] };
  return lookupOutcome(
    { flatrate: parseProviderList(row.lookedUpAvailableOn) ?? [], rentOrBuy: [] },
    yourServices,
  );
}
