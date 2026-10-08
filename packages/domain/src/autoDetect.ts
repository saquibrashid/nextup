// Auto-detect import — the pure half (#396, PRD `A57`, US-066, ADR-0010 Rev 6).
//
// An auto-detect batch names no service up front. Each extracted title's
// service is LOOKED UP during review (TMDB watch providers, the same mapping
// Waiting to stream and Library availability use), PROPOSED to the owner,
// and applied only after the owner has reviewed it. This module decides what
// is proposed and what a close may write; it does no I/O.
//
// ⚠ **NOTHING HERE ADDS ANYTHING ON ITS OWN.** A lookup only proposes. The
// close writes a listing for a service only when the candidate was confirmed
// AND its destination is the owner's choice or the proposal the owner was
// shown and did not change. A title whose lookup failed, or whose answer is
// NOT KNOWN (ADR-0010 Trap 4), has NO destination until the owner picks one,
// and the close refuses while any confirmed title has none.

import {
  AUTO_DESTINATION_KINDS,
  SERVICES,
  type AutoDestinationKind,
  type Service,
  type ServiceLookupStatus,
} from './enums.js';
import { applicableCandidates } from './close.js';
import type { ReviewCandidate } from './review.js';

/** Where an auto-detect title goes on close. */
export type AutoDestination = { kind: 'services'; services: Service[] } | { kind: 'waiting' };

/**
 * One candidate's stored lookup, as the review serves it.
 *
 * `services` is the owner's services TMDB says stream the title, in `SERVICES`
 * order — what is pre-selected (owner decision 3: every match, one badge
 * each). `stale` means the owner has since corrected the match, so the answer
 * was about a different work and proposes nothing.
 */
export interface CandidateServiceLookup {
  status: ServiceLookupStatus;
  services: Service[];
  checkedAt: string;
  stale: boolean;
}

/** The label every surface shows next to a looked-up service (owner decision 2). */
export const LOOKED_UP_LABEL = 'Looked up';

/** What a title whose lookup failed or was not known says. */
export const LOOKUP_FAILED_LABEL = "Couldn't look up";

/** In `SERVICES` order, deduplicated. The one ordering every surface uses. */
export function orderedServices(services: readonly string[]): Service[] {
  return SERVICES.filter((service) => services.includes(service));
}

/**
 * The destination a lookup PROPOSES, or `null` when it proposes none.
 *
 * - `found` → every matching owner service (owner decision 3);
 * - `none`  → Waiting to stream (owner decision 4);
 * - `unknown`, `failed`, stale or never looked up → nothing. The owner picks.
 *
 * ⚠ `unknown` proposes NOTHING, not Waiting. TMDB having no provider data is
 * NOT KNOWN (ADR-0010 Trap 4) — proposing Waiting would assert "on none of
 * your services", a claim the data cannot support.
 */
export function proposedDestinationFor(
  lookup: CandidateServiceLookup | null | undefined,
): AutoDestination | null {
  if (lookup === null || lookup === undefined || lookup.stale) return null;
  if (lookup.status === 'found' && lookup.services.length > 0) {
    return { kind: 'services', services: orderedServices(lookup.services) };
  }
  if (lookup.status === 'none') return { kind: 'waiting' };
  return null;
}

/** The owner's choice when there is one, otherwise the proposal. */
export function effectiveDestinationFor(candidate: {
  destination?: AutoDestination | null;
  serviceLookup?: CandidateServiceLookup | null;
}): AutoDestination | null {
  return candidate.destination ?? proposedDestinationFor(candidate.serviceLookup);
}

/**
 * Applied auto-detect candidates with no destination — the ids that refuse
 * the close with 409 `AUTO_DESTINATION_REQUIRED` (#396).
 *
 * ⚠ Only candidates the close WOULD write: decidable, not collapsed, and
 * confirmed or corrected. A pending one is `PENDING_ADDITIONS`' job, and a
 * discarded one writes nothing, so neither needs a destination.
 */
export function missingDestinationIds(candidates: readonly ReviewCandidate[]): string[] {
  return applicableCandidates(candidates)
    .filter(({ candidate }) => effectiveDestinationFor(candidate) === null)
    .map(({ candidate }) => candidate.candidateId);
}

export type AutoDestinationParse =
  | { ok: true; destination: AutoDestination | null }
  | { ok: false; message: string; details: Record<string, unknown> };

/**
 * The body of `PATCH /api/batches/:batchId/candidates/:candidateId/destination`.
 *
 * `{ kind: 'services', services: [...] }`, `{ kind: 'waiting' }`, or
 * `{ kind: null }` to go back to the looked-up proposal.
 *
 * ⚠ `services` must be NON-EMPTY: unticking every service is not "no
 * destination", it is a decision the owner has not finished. The UI offers
 * Waiting or a service; an empty list is refused rather than read as either.
 */
export function parseAutoDestination(body: unknown): AutoDestinationParse {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const kind = record['kind'];
  if (kind === null) return { ok: true, destination: null };
  if (typeof kind !== 'string' || !(AUTO_DESTINATION_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      message: '"kind" must be "services", "waiting" or null.',
      details: { field: 'kind', permitted: [...AUTO_DESTINATION_KINDS, null] },
    };
  }
  if ((kind as AutoDestinationKind) === 'waiting') {
    return { ok: true, destination: { kind: 'waiting' } };
  }
  const raw = record['services'];
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every(
      (service): service is string =>
        typeof service === 'string' && (SERVICES as readonly string[]).includes(service),
    )
  ) {
    return {
      ok: false,
      message: '"services" must list at least one supported service.',
      details: { field: 'services', permitted: [...SERVICES] },
    };
  }
  return { ok: true, destination: { kind: 'services', services: orderedServices(raw) } };
}

/** The stored pair → a destination. Anything malformed reads as "no choice". */
export function storedDestination(
  kind: string | null,
  servicesJson: string | null,
): AutoDestination | null {
  if (kind === 'waiting') return { kind: 'waiting' };
  if (kind !== 'services' || servicesJson === null) return null;
  try {
    const parsed: unknown = JSON.parse(servicesJson);
    if (!Array.isArray(parsed)) return null;
    const services = orderedServices(
      parsed.filter((entry): entry is string => typeof entry === 'string'),
    );
    return services.length === 0 ? null : { kind: 'services', services };
  } catch {
    return null;
  }
}
