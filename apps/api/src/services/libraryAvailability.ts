/**
 * Library availability moves (#397, #410, PRD `A54`, US-063, ADR-0010 Rev 4).
 *
 * PURE. Given what TMDB last said about a Library title and which services
 * the owner holds it on, decide what — if anything — the owner should be
 * TOLD. It never decides anything on the owner's behalf: every move this
 * module describes is carried out only by an owner-initiated one-tap action
 * (PRD §7.4 items 13–17), never by the refresh that produced the facts
 * (invariant 5).
 *
 * ⚠ **SHOW THE FACT, NEVER NAG (invariant 8a).** There is no threshold, no
 * reminder and no derived "you should" state here — only the factual
 * difference between the badges and the provider set, with its as-of date.
 *
 * ⚠ **NOT KNOWN IS NOT A CHANGE (ADR-0010 Trap 4).** A title never checked,
 * or one TMDB had no provider data for, yields no change at all. Only a known
 * answer can say a service no longer carries it.
 *
 * ⚠ **RENT-ONLY IS NOT STREAMING (US-042 AC-5).** A rent/buy offer never
 * keeps a service badge "current" and never counts as "now also on".
 */

import { SERVICES, type Service } from '@nextup/domain';

import { accessStateFor, flaggedProvidersFor, type AccessState } from './watchAvailability.js';

/** What the API serves for one Library title's availability. */
export interface LibraryAvailability {
  accessState: AccessState;
  /** When the answer was computed, ISO timestamp, or `null` for never. */
  checkedAt: string | null;
  region: string;
  /** Every supported service TMDB says streams it, or `null` if not known. */
  streamingOn: Service[] | null;
  /** Rent/buy storefronts as TMDB names them, or `null` if not known. */
  rentOn: string[] | null;
  /** Services the title is badged on that no longer stream it. */
  left: Service[];
  /** The owner's services that now stream it and carry no badge yet. */
  joined: Service[];
  /** The change, as a stable string, or `null` when there is none. */
  signature: string | null;
  /** `true` when the owner already chose Keep for exactly this change. */
  kept: boolean;
  /** No owner service streams it any more, so Waiting is a fair offer. */
  canMoveToWaiting: boolean;
}

/**
 * The services a streaming offer counts as "yours" on (#378, owner decision 3).
 *
 * ⚠ An owner who has imported nothing yet has no services to tell apart, and
 * treating every offer as "not yours" would hide the one invitation the
 * waiting view exists to make. Until the first import, every supported
 * service is treated as the owner's.
 */
export function yourServicesFrom(used: readonly string[]): Service[] {
  const known = SERVICES.filter((service) => used.includes(service));
  return known.length > 0 ? known : [...SERVICES];
}

/** ⚠ Defensive: anything that is not an array of strings is NOT KNOWN. */
export function parseProviderList(raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return null;
  }
}

/**
 * The change signature: `left=a,b;joined=c`, each side in `SERVICES` order.
 * `null` when nothing left and nothing joined. A Keep stores this string, and
 * the marker comes back only when the signature differs (US-063 AC-6).
 */
export function availabilitySignature(
  left: readonly Service[],
  joined: readonly Service[],
): string | null {
  if (left.length === 0 && joined.length === 0) return null;
  const order = (list: readonly Service[]): string =>
    SERVICES.filter((service) => list.includes(service)).join(',');
  return `left=${order(left)};joined=${order(joined)}`;
}

/** A signature the API accepts from a Keep request. Closed vocabulary. */
export function isAvailabilitySignature(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 400) return false;
  const match = /^left=([a-z,-]*);joined=([a-z,-]*)$/.exec(value);
  if (match === null) return false;
  const sides = [match[1] ?? '', match[2] ?? ''];
  if (sides.every((side) => side === '')) return false;
  return sides.every(
    (side) =>
      side === '' ||
      side.split(',').every((service) => (SERVICES as readonly string[]).includes(service)),
  );
}

export function libraryAvailabilityFor(input: {
  listedServices: readonly string[];
  availableOn: readonly string[] | null;
  rentOn: readonly string[] | null;
  checkedAt: Date | null;
  region: string;
  yourServices: readonly Service[];
  keptSignature: string | null;
}): LibraryAvailability {
  const accessState = accessStateFor(input.availableOn, input.rentOn, input.checkedAt);
  const streamingOn = flaggedProvidersFor(input.availableOn);
  // Not checked, or checked with no provider data: NOT KNOWN, so no change.
  const known = input.checkedAt === null ? null : streamingOn;

  const listed = SERVICES.filter((service) => input.listedServices.includes(service));
  const left = known === null ? [] : listed.filter((service) => !known.includes(service));
  const joined =
    known === null
      ? []
      : known.filter(
          (service) => input.yourServices.includes(service) && !listed.includes(service),
        );
  const signature = availabilitySignature(left, joined);
  const yoursStreaming =
    known === null ? [] : known.filter((service) => input.yourServices.includes(service));

  return {
    accessState,
    checkedAt: input.checkedAt === null ? null : input.checkedAt.toISOString(),
    region: input.region,
    streamingOn,
    rentOn: input.rentOn === null ? null : [...input.rentOn],
    left,
    joined,
    signature,
    kept: signature !== null && signature === input.keptSignature,
    canMoveToWaiting: known !== null && listed.length > 0 && yoursStreaming.length === 0,
  };
}
