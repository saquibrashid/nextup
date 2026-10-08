// Batch source rules — ADR-0010 D-1/D-2, REQ-082/REQ-083.
//
// A batch originates EITHER from a service whose saved list the owner curated
// (a SERVICES member) OR from a rental storefront they browsed
// (`fandango-at-home`). The two are not interchangeable, and this module is
// where that distinction is decided once rather than re-derived per route.
//
// ⚠ **THE REFUSAL IS BY SOURCE TYPE, NEVER BY A CLIENT-SUPPLIED FLAG.** The
// SPA can hide the full-update control all it likes; a caller posting the
// request directly must still be refused, which is exactly what `T-WAIT-001c`
// exists to catch and what a UI-only guard fails.
//
// Pure: no I/O, no Express, no Prisma. The API boundary turns `refusal` into
// an `AppError`; nothing here knows what an HTTP status is.

import {
  DISCOVERY_SOURCES,
  SERVICES,
  isAutoDetectSource,
  isDiscoverySource,
  type BatchMode,
  type CaptureSource,
  type DiscoverySource,
  type Service,
} from './enums.js';
import { SERVICE_LABELS } from './copy.js';

/**
 * The mode a batch from this source is allowed to have.
 *
 * A discovery capture is **structurally** append-only (D-2): absence of a
 * title from a later capture of the same page means only that it is no longer
 * new, never that the owner removed it.
 */
export function forcedModeFor(source: CaptureSource): BatchMode | null {
  return isDiscoverySource(source) || isAutoDetectSource(source) ? 'append-only' : null;
}

/**
 * Why an explicitly-requested mode is refused for this source, or `null` when
 * it is permitted.
 *
 * The sentence explains the *reason*, not merely the fact: the owner (or the
 * developer reading it) has to understand that this is a property of the
 * source, not a temporary limitation they can retry past.
 */
export function modeRefusalFor(source: CaptureSource, mode: BatchMode): string | null {
  if (mode === 'append-only') return null;
  // #396 (`A57`, ADR-0010 Rev 6). Refused by SOURCE TYPE exactly as a
  // storefront is: a full update reconciles ONE service's saved list, and an
  // auto-detect capture has no single service whose list it could be.
  if (isAutoDetectSource(source)) return AUTO_DETECT_FULL_UPDATE_REFUSAL;
  if (!isDiscoverySource(source)) return null;
  return (
    `A ${DISCOVERY_SOURCE_LABELS[source]} capture is always append-only. ` +
    'Its new-release page is an editorial feed, not a list you curated, so a ' +
    'title disappearing from it means only that it is no longer new — never ' +
    'that you removed it. Reconciling it as a full update would propose ' +
    'removing everything you are waiting for.'
  );
}

/**
 * Splits a validated batch source into the two mutually-exclusive columns the
 * store keeps (`ck_batch_source_exclusive`).
 *
 * ⚠ A DISCRIMINATED UNION, not a pair of independent nullables. It is what
 * lets a caller narrow one field by testing the other, so the exclusivity is
 * carried by the type rather than re-asserted with a cast at each use — and a
 * cast is exactly how the two columns would eventually both get written.
 */
export type SplitBatchSource =
  | { service: Service; discoverySource: null; autoDetect: false }
  | { service: null; discoverySource: DiscoverySource; autoDetect: false }
  | { service: null; discoverySource: null; autoDetect: true };

/**
 * ⚠ At most one is non-null, and NEITHER is exactly the auto-detect shape
 * (#396, `ck_batch_source_kind`). A discovery batch has NO truthful service
 * and must never borrow one: `service` is what the combined list, the REQ-025
 * badge count and full-update reconciliation all filter on. An auto-detect
 * batch has neither, and must not borrow either.
 */
export function splitBatchSource(source: CaptureSource): SplitBatchSource {
  if (isAutoDetectSource(source)) return { service: null, discoverySource: null, autoDetect: true };
  return isDiscoverySource(source)
    ? { service: null, discoverySource: source, autoDetect: false }
    : { service: source as Service, discoverySource: null, autoDetect: false };
}

/**
 * Is this stored batch an auto-detect capture (#396)?
 *
 * ⚠ Reads the stored FLAG, not "both columns null": the store makes the two
 * equivalent (`ck_batch_source_kind`), but a caller handed a partial row must
 * not be able to manufacture an auto-detect batch by omitting a field.
 */
export function isAutoDetectBatch(batch: { autoDetect?: boolean | null }): boolean {
  return batch.autoDetect === true;
}

/**
 * The service a batch is for, for paths that genuinely require one.
 *
 * ⚠ Throwing is the point. Reconciliation, removal computation, badge counting
 * and service state are all meaningless for a discovery batch, and this makes
 * the compiler name every such call site instead of letting a discovery batch
 * drift silently into a service-scoped query.
 *
 * ⚠ Takes `string | null` rather than `Service | null` DELIBERATELY. Store
 * rows widen to `string` through Prisma, so a narrower signature would be
 * satisfied by a cast at every call site — and a cast is precisely the thing
 * that would let an unrecognised stored value through. This VALIDATES instead.
 */
export function requireServiceOf(batch: {
  id: string;
  service: string | null;
  discoverySource: string | null;
  autoDetect?: boolean | null;
}): Service {
  if (batch.service === null && isAutoDetectBatch(batch)) {
    throw new Error(
      `Batch ${batch.id} is an auto-detect batch and has no single service. This code path is ` +
        'service-scoped and must not run for an auto-detect batch (ADR-0010 Rev 6, #396).',
    );
  }
  if (batch.service === null) {
    throw new Error(
      `Batch ${batch.id} is a discovery batch (${String(batch.discoverySource)}) and has no ` +
        'service. This code path is service-scoped and must not run for a discovery batch ' +
        '(ADR-0010 D-1).',
    );
  }
  if (!(SERVICES as readonly string[]).includes(batch.service)) {
    throw new Error(
      `Batch ${batch.id} has service "${batch.service}", which is not a SERVICES member.`,
    );
  }
  return batch.service as Service;
}

/**
 * The discovery source a batch was captured from, or `null` when it is an
 * ordinary service batch.
 *
 * ⚠ The mirror image of `requireServiceOf`, and it VALIDATES for the same
 * reason: `discovery_source` widens to `string | null` through Prisma, so a
 * cast would let an unrecognised stored value reach the intent-writing path
 * and be persisted onto every `WatchIntent` it created.
 *
 * ⚠ Returns `null` rather than throwing, because unlike `requireServiceOf`
 * this is the DISCRIMINATOR — callers ask it in order to choose a path, and a
 * throw would make "this is an ordinary Netflix batch" an exception.
 */
export function discoverySourceOf(batch: {
  id: string;
  discoverySource: string | null;
}): DiscoverySource | null {
  if (batch.discoverySource === null) return null;
  if (!(DISCOVERY_SOURCES as readonly string[]).includes(batch.discoverySource)) {
    throw new Error(
      `Batch ${batch.id} has discovery source "${batch.discoverySource}", which is not a ` +
        'DISCOVERY_SOURCES member.',
    );
  }
  return batch.discoverySource as DiscoverySource;
}

/**
 * Display names, mirroring `SERVICE_LABELS` in `copy.ts`.
 *
 * ⚠ **EVERY LABEL CARRIES "(rent/buy)"** (#378, owner decision 4). These are
 * rental storefronts, and at least one brand is ALSO a subscription the owner
 * may hold: "Prime Video" is the `prime-video` service, "Prime Video
 * (rent/buy)" is this storefront. The marker is part of the label rather than
 * something each surface remembers to append, so no surface that names a
 * source — the picker, the Review page, a waiting row, a refusal message —
 * can present a storefront as a streaming subscription.
 */
export const DISCOVERY_SOURCE_LABELS: Readonly<Record<DiscoverySource, string>> = {
  'fandango-at-home': 'Fandango at Home (rent/buy)',
  'apple-tv-store': 'Apple TV (rent/buy)',
  'prime-video-store': 'Prime Video (rent/buy)',
  'google-tv-store': 'Google TV (rent/buy)',
};

/** What a waiting row says about where it came from (#378). */
export const SEARCH_INTENT_LABEL = 'Added by search';

/**
 * The label for any `WatchIntent.discoverySource` as stored.
 *
 * ⚠ Total over strings, never throwing: this renders a list, and one
 * unexpected stored value must not take the page down. An unknown slug is
 * shown as-is rather than guessed at.
 */
export function intentSourceLabel(source: string): string {
  if (source === 'search') return SEARCH_INTENT_LABEL;
  return (DISCOVERY_SOURCES as readonly string[]).includes(source)
    ? DISCOVERY_SOURCE_LABELS[source as DiscoverySource]
    : source;
}

/**
 * The label for a batch's source, whichever of the two columns carries it
 * (#378).
 *
 * ⚠ Replaces a `SERVICE_LABELS[batch.service] ?? 'Discovery'` fallback that
 * several surfaces carried. With four storefronts, "Discovery" no longer says
 * where a capture came from, and it never said that the place was a rental
 * storefront rather than a subscription.
 */
export function batchSourceLabel(batch: {
  service: string | null;
  discoverySource?: string | null;
  autoDetect?: boolean | null;
}): string {
  if (isAutoDetectBatch(batch)) return AUTO_DETECT_LABEL;
  if (batch.service !== null) {
    return (SERVICES as readonly string[]).includes(batch.service)
      ? SERVICE_LABELS[batch.service as Service]
      : batch.service;
  }
  const source = batch.discoverySource ?? null;
  return source === null ? 'Rental storefront (rent/buy)' : intentSourceLabel(source);
}

/**
 * The `modeExplanation` a discovery batch answers with (US-003 AC-2/AC-3).
 *
 * `modeExplanation` in `copy.ts` is service-shaped and its append-only
 * sentence — *"Only adds what's in these screenshots"* — is true but misses
 * the point here: what the owner needs told is that nothing they are waiting
 * for can be removed by this capture, because that is the fear a rotating feed
 * creates.
 */
export function discoveryModeExplanation(source: DiscoverySource): string {
  return (
    `Only adds what's in these screenshots. Nothing you're waiting for will be ` +
    `removed, and this capture never changes your combined list — ` +
    `${DISCOVERY_SOURCE_LABELS[source]} is a place to browse, not a list you saved.`
  );
}

/** What the source picker and every batch surface call an auto-detect capture (#396). */
export const AUTO_DETECT_LABEL = 'Auto-detect';

/**
 * Why `full-update` is refused for an auto-detect capture (#396, `A57`).
 *
 * The reason, not just the fact: removals are proposed against ONE service's
 * saved list, so a capture that names no service has no list to compare with.
 */
export const AUTO_DETECT_FULL_UPDATE_REFUSAL =
  'An auto-detect capture is always add-only. A full update removes titles that are no ' +
  "longer on one service's saved list, so it needs you to name that service. Pick the " +
  'service to run a full update.';

/**
 * The `modeExplanation` an auto-detect batch answers with (#396, US-066).
 *
 * ⚠ Says that the service is LOOKED UP and that the owner confirms it, because
 * that is the difference from a named-service capture the owner must hear
 * before uploading: nothing lands on a service they did not see proposed.
 */
export function autoDetectModeExplanation(): string {
  return (
    "Only adds what's in these screenshots. Nothing will be removed. We'll look up " +
    'which of your services streams each title, and you confirm or change it before ' +
    'anything is added. Titles on none of your services are offered for Waiting to stream.'
  );
}

/**
 * Vacuity guard for the tests, and a live assertion that D-1 still holds.
 *
 * ⚠ If a discovery source is ever added to `SERVICES`, every guarantee in this
 * module evaporates silently: `isDiscoverySource` would still answer `true`,
 * the refusal would still fire, and the batch would ALSO be a service batch
 * with a badge and a reconciliation path. Cheap to assert, catastrophic to
 * miss.
 */
export function discoverySourcesAreNotServices(): boolean {
  const services: readonly string[] = SERVICES;
  return DISCOVERY_SOURCES.every((s) => !services.includes(s));
}
