/**
 * #378 — `T-WAIT-013`: the rental storefronts that feed Waiting to stream.
 *
 * Owner decision 4 widened `DISCOVERY_SOURCES` beyond Fandango at Home, and
 * required every one of them to read as RENTAL wherever it is named. The
 * load-bearing case is Prime Video, which is both a storefront the owner
 * browses and a subscription (`prime-video`) the owner may hold.
 */

import { describe, expect, it } from 'vitest';

import {
  BATCH_SOURCES,
  DISCOVERY_SOURCES,
  DISCOVERY_SOURCE_LABELS,
  INTENT_SOURCES,
  SEARCH_INTENT_LABEL,
  SERVICES,
  SERVICE_LABELS,
  discoveryModeExplanation,
  discoverySourcesAreNotServices,
  forcedModeFor,
  intentSourceLabel,
  modeRefusalFor,
  splitBatchSource,
} from '../src/index.js';

describe('T-WAIT-013 — rental storefronts are discovery sources, and say so', () => {
  it('T-WAIT-013a — every storefront is forced append-only and refuses a full update', () => {
    expect(DISCOVERY_SOURCES.length).toBeGreaterThan(1);
    for (const source of DISCOVERY_SOURCES) {
      expect(forcedModeFor(source), source).toBe('append-only');
      expect(modeRefusalFor(source, 'append-only'), source).toBeNull();
      expect(modeRefusalFor(source, 'full-update'), source).toContain('always append-only');
      expect(splitBatchSource(source)).toEqual({ service: null, discoverySource: source });
    }
    // The discriminating half: a subscription service is not forced.
    expect(forcedModeFor('prime-video')).toBeNull();
    expect(modeRefusalFor('prime-video', 'full-update')).toBeNull();
  });

  it('T-WAIT-013b — every storefront label is marked rental and differs from every service label', () => {
    const serviceLabels = new Set(SERVICES.map((service) => SERVICE_LABELS[service]));
    for (const source of DISCOVERY_SOURCES) {
      const label = DISCOVERY_SOURCE_LABELS[source];
      expect(label, source).toMatch(/\(rent\/buy\)$/);
      expect(serviceLabels.has(label), source).toBe(false);
      expect(discoveryModeExplanation(source)).toContain(label);
      expect(modeRefusalFor(source, 'full-update')).toContain(label);
    }
    // Prime Video: the subscription and the storefront must never read alike.
    expect(SERVICE_LABELS['prime-video']).toBe('Prime Video');
    expect(DISCOVERY_SOURCE_LABELS['prime-video-store']).toBe('Prime Video (rent/buy)');
  });

  it('T-WAIT-013c — no storefront slug is a SERVICES member (ADR-0010 D-1)', () => {
    expect(discoverySourcesAreNotServices()).toBe(true);
    for (const source of DISCOVERY_SOURCES) {
      expect((SERVICES as readonly string[]).includes(source), source).toBe(false);
    }
    expect(BATCH_SOURCES).toEqual([...SERVICES, ...DISCOVERY_SOURCES]);
  });

  it('T-WAIT-013d — search is an intent source, never a batch source', () => {
    expect(INTENT_SOURCES).toEqual([...DISCOVERY_SOURCES, 'search']);
    expect((BATCH_SOURCES as readonly string[]).includes('search')).toBe(false);
  });

  it('T-WAIT-013e — intentSourceLabel names every stored source and never throws', () => {
    for (const source of DISCOVERY_SOURCES) {
      expect(intentSourceLabel(source)).toBe(DISCOVERY_SOURCE_LABELS[source]);
    }
    expect(intentSourceLabel('search')).toBe(SEARCH_INTENT_LABEL);
    expect(intentSourceLabel('some-future-slug')).toBe('some-future-slug');
  });
});
