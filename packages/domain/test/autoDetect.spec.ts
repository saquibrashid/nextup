/**
 * #396 — auto-detect import, the pure half (PRD `A57`, US-066, ADR-0010 Rev 6).
 *
 * `T-AUTO-001` — the source rules: auto-detect is append-only BY SOURCE TYPE
 * and a full update is refused, exactly as a storefront's is.
 * `T-AUTO-002` — what a review-time lookup proposes, and what it must NOT.
 * `T-AUTO-003` — which confirmed titles still have no destination.
 * `T-AUTO-004` — the destination PATCH body grammar.
 * `T-AUTO-005` — the batch parser refuses the shapes the store refuses.
 */

import { describe, expect, it } from 'vitest';

import {
  AUTO_DETECT_FULL_UPDATE_REFUSAL,
  AUTO_DETECT_LABEL,
  AUTO_DETECT_SOURCE,
  BATCH_SOURCES,
  CAPTURE_SOURCES,
  SERVICES,
  autoDetectModeExplanation,
  batchSourceLabel,
  effectiveDestinationFor,
  forcedModeFor,
  isAutoDetectBatch,
  isAutoDetectSource,
  isDiscoverySource,
  missingDestinationIds,
  modeRefusalFor,
  parseAutoDestination,
  proposedDestinationFor,
  requireServiceOf,
  sectionForCandidate,
  splitBatchSource,
  storedDestination,
  uploadBatchSchema,
  type CandidateServiceLookup,
  type ReviewCandidate,
} from '../src/index.js';

const DUNE = 'tmdb:movie:438631';

function candidate(over: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: over.candidateId ?? 'c1',
    rawText: 'Dune',
    inferredTitle: 'Dune',
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.97,
    resolvedWorkIdentity: DUNE,
    match: null,
    alternatives: [],
    sourceImageIds: ['img1'],
    disposition: 'confirmed',
    collapsedIntoCandidateId: null,
    classification: 'new',
    tileCrop: null,
    ...over,
  };
}

function lookup(over: Partial<CandidateServiceLookup> = {}): CandidateServiceLookup {
  return {
    status: 'found',
    services: ['netflix'],
    checkedAt: '2026-09-20T10:00:00.000Z',
    stale: false,
    ...over,
  };
}

describe('T-AUTO-001 — auto-detect is append-only by source type', () => {
  it('T-AUTO-001a — forced append-only, and a full update is refused with the reason', () => {
    expect(isAutoDetectSource(AUTO_DETECT_SOURCE)).toBe(true);
    expect(forcedModeFor('auto')).toBe('append-only');
    expect(modeRefusalFor('auto', 'append-only')).toBeNull();
    expect(modeRefusalFor('auto', 'full-update')).toBe(AUTO_DETECT_FULL_UPDATE_REFUSAL);
    // The reason, not just the fact: removals need ONE named service.
    expect(AUTO_DETECT_FULL_UPDATE_REFUSAL).toMatch(/name that service/);
  });

  it('T-AUTO-001b — named services are unchanged: not forced, full update permitted', () => {
    for (const service of SERVICES) {
      expect(isAutoDetectSource(service)).toBe(false);
      expect(forcedModeFor(service), service).toBeNull();
      expect(modeRefusalFor(service, 'full-update'), service).toBeNull();
    }
  });

  it('T-AUTO-001c — not a column value: outside BATCH_SOURCES, inside CAPTURE_SOURCES', () => {
    expect((BATCH_SOURCES as readonly string[]).includes('auto')).toBe(false);
    expect(CAPTURE_SOURCES).toEqual([...BATCH_SOURCES, 'auto']);
    expect(isDiscoverySource('auto')).toBe(false);
  });

  it('T-AUTO-001d — splits to NEITHER column, and service-scoped paths refuse it loudly', () => {
    const split = splitBatchSource('auto');
    expect(split).toEqual({ service: null, discoverySource: null, autoDetect: true });
    expect(isAutoDetectBatch(split)).toBe(true);
    expect(() => requireServiceOf({ id: 'b1', ...split })).toThrow(/auto-detect batch/);
    // The discriminating half: a partial row cannot manufacture auto-detect.
    expect(isAutoDetectBatch({})).toBe(false);
    expect(() => requireServiceOf({ id: 'b2', service: null, discoverySource: null })).toThrow(
      /discovery batch/,
    );
  });

  it('T-AUTO-001e — labelled "Auto-detect", and the explanation says it is looked up', () => {
    expect(batchSourceLabel({ service: null, discoverySource: null, autoDetect: true })).toBe(
      AUTO_DETECT_LABEL,
    );
    expect(autoDetectModeExplanation()).toMatch(/look up/);
    expect(autoDetectModeExplanation()).toMatch(/Nothing will be removed/);
  });
});

describe('T-AUTO-002 — what a lookup proposes', () => {
  it('T-AUTO-002a — found pre-selects EVERY matching service, in SERVICES order', () => {
    expect(proposedDestinationFor(lookup({ services: ['max', 'netflix'] }))).toEqual({
      kind: 'services',
      services: ['netflix', 'max'],
    });
  });

  it('T-AUTO-002b — none proposes Waiting to stream', () => {
    expect(proposedDestinationFor(lookup({ status: 'none', services: [] }))).toEqual({
      kind: 'waiting',
    });
  });

  it('T-AUTO-002c — unknown, failed, stale and never-looked-up propose NOTHING', () => {
    // ⚠ unknown is NOT KNOWN (ADR-0010 Trap 4): proposing Waiting would claim
    // "on none of your services", which the data cannot support.
    expect(proposedDestinationFor(lookup({ status: 'unknown', services: [] }))).toBeNull();
    expect(proposedDestinationFor(lookup({ status: 'failed', services: [] }))).toBeNull();
    expect(proposedDestinationFor(lookup({ stale: true }))).toBeNull();
    expect(proposedDestinationFor(null)).toBeNull();
    expect(proposedDestinationFor(undefined)).toBeNull();
  });

  it("T-AUTO-002d — the owner's choice wins over the proposal", () => {
    expect(
      effectiveDestinationFor({ serviceLookup: lookup(), destination: { kind: 'waiting' } }),
    ).toEqual({ kind: 'waiting' });
    expect(effectiveDestinationFor({ serviceLookup: lookup(), destination: null })).toEqual({
      kind: 'services',
      services: ['netflix'],
    });
  });
});

describe('T-AUTO-003 — a confirmed title with no destination blocks the close', () => {
  it('T-AUTO-003a — reports confirmed titles with neither a proposal nor a choice', () => {
    const rows = [
      candidate({ candidateId: 'found', serviceLookup: lookup() }),
      candidate({ candidateId: 'failed', serviceLookup: lookup({ status: 'failed' }) }),
      candidate({
        candidateId: 'picked',
        serviceLookup: lookup({ status: 'failed' }),
        destination: { kind: 'services', services: ['max'] },
      }),
      candidate({ candidateId: 'none', serviceLookup: lookup({ status: 'none', services: [] }) }),
      candidate({ candidateId: 'never', serviceLookup: null }),
    ];
    expect(missingDestinationIds(rows)).toEqual(['failed', 'never']);
  });

  it('T-AUTO-003b — pending, discarded, collapsed and non-decidable rows do not block', () => {
    const rows = [
      candidate({ candidateId: 'pending', disposition: 'pending' }),
      candidate({ candidateId: 'discarded', disposition: 'discarded' }),
      candidate({ candidateId: 'collapsed', collapsedIntoCandidateId: 'x' }),
      candidate({ candidateId: 'chrome', verdict: 'chrome-suspected' }),
    ];
    expect(sectionForCandidate(rows[3] as ReviewCandidate)).toBe('probablyNotTitles');
    expect(missingDestinationIds(rows)).toEqual([]);
    // The discriminating half: the same confirmed row DOES block.
    expect(missingDestinationIds([candidate({ candidateId: 'c' })])).toEqual(['c']);
  });
});

describe('T-AUTO-004 — the destination PATCH body', () => {
  it('T-AUTO-004a — accepts services, waiting and a reset', () => {
    expect(parseAutoDestination({ kind: 'services', services: ['max', 'netflix'] })).toEqual({
      ok: true,
      destination: { kind: 'services', services: ['netflix', 'max'] },
    });
    expect(parseAutoDestination({ kind: 'waiting' })).toEqual({
      ok: true,
      destination: { kind: 'waiting' },
    });
    expect(parseAutoDestination({ kind: null })).toEqual({ ok: true, destination: null });
  });

  it('T-AUTO-004b — refuses an empty list, an unknown service and an unknown kind', () => {
    expect(parseAutoDestination({ kind: 'services', services: [] }).ok).toBe(false);
    expect(parseAutoDestination({ kind: 'services', services: ['hulu'] }).ok).toBe(false);
    expect(parseAutoDestination({ kind: 'services' }).ok).toBe(false);
    expect(parseAutoDestination({ kind: 'library' }).ok).toBe(false);
    expect(parseAutoDestination(null).ok).toBe(false);
  });

  it('T-AUTO-004c — stored pairs read back; anything malformed reads as no choice', () => {
    expect(storedDestination('services', '["max","netflix"]')).toEqual({
      kind: 'services',
      services: ['netflix', 'max'],
    });
    expect(storedDestination('waiting', null)).toEqual({ kind: 'waiting' });
    expect(storedDestination(null, null)).toBeNull();
    expect(storedDestination('services', '[]')).toBeNull();
    expect(storedDestination('services', 'not json')).toBeNull();
    expect(storedDestination('services', '{"a":1}')).toBeNull();
    expect(storedDestination('services', null)).toBeNull();
  });
});

describe('T-AUTO-005 — the batch parser mirrors the store constraints', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'uploadBatch' as const,
    ownerId: 'owner',
    service: null,
    discoverySource: null,
    autoDetect: true,
    mode: 'append-only' as const,
    status: 'draft' as const,
    derivedFromBatchId: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    submittedAt: null,
    extractionStartedAt: null,
    extractionError: null,
    completedAt: null,
    undoneAt: null,
    extractionStats: null,
    degradedExtraction: false,
    lowYield: false,
    crossCheck: null,
    removalGroups: [],
    provenance: { created: [], modified: [], removed: [] },
  };

  it('T-AUTO-005a — an auto-detect batch with neither column parses', () => {
    const parsed = uploadBatchSchema.safeParse(base);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('T-AUTO-005b — refuses a service on an auto batch, and a full-update auto batch', () => {
    expect(uploadBatchSchema.safeParse({ ...base, service: 'netflix' }).success).toBe(false);
    expect(uploadBatchSchema.safeParse({ ...base, mode: 'full-update' }).success).toBe(false);
    // The discriminating half: neither column WITHOUT the flag is still refused.
    expect(uploadBatchSchema.safeParse({ ...base, autoDetect: false }).success).toBe(false);
  });
});
