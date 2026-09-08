// Batch source rules — ADR-0010 D-1/D-2, REQ-082/REQ-083.
//
// A batch originates EITHER from a service whose saved list the owner curated
// (`netflix`, `max`) OR from a rental storefront they browsed
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
  isDiscoverySource,
  type BatchMode,
  type BatchSource,
  type DiscoverySource,
  type Service,
} from './enums.js';

/**
 * The mode a batch from this source is allowed to have.
 *
 * A discovery capture is **structurally** append-only (D-2): absence of a
 * title from a later capture of the same page means only that it is no longer
 * new, never that the owner removed it.
 */
export function forcedModeFor(source: BatchSource): BatchMode | null {
  return isDiscoverySource(source) ? 'append-only' : null;
}

/**
 * Why an explicitly-requested mode is refused for this source, or `null` when
 * it is permitted.
 *
 * The sentence explains the *reason*, not merely the fact: the owner (or the
 * developer reading it) has to understand that this is a property of the
 * source, not a temporary limitation they can retry past.
 */
export function modeRefusalFor(source: BatchSource, mode: BatchMode): string | null {
  if (!isDiscoverySource(source)) return null;
  if (mode === 'append-only') return null;
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
  { service: Service; discoverySource: null } | { service: null; discoverySource: DiscoverySource };

/**
 * ⚠ Exactly one is non-null. A discovery batch has NO truthful service and
 * must never borrow one: `service` is what the combined list, the REQ-025
 * badge count and full-update reconciliation all filter on.
 */
export function splitBatchSource(source: BatchSource): SplitBatchSource {
  return isDiscoverySource(source)
    ? { service: null, discoverySource: source }
    : { service: source as Service, discoverySource: null };
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
}): Service {
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

/** Display names, mirroring `SERVICE_LABELS` in `copy.ts`. */
export const DISCOVERY_SOURCE_LABELS: Readonly<Record<DiscoverySource, string>> = {
  'fandango-at-home': 'Fandango at Home',
};

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
