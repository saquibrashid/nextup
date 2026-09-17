import { describe, expect, it } from 'vitest';

import {
  BATCH_SOURCES,
  DISCOVERY_SOURCES,
  SERVICES,
  SERVICE_LABELS,
  isService,
  modeExplanation,
  removalsLabel,
  requireServiceOf,
  serviceFreshnessLabel,
  serviceListingSchema,
  serviceSchema,
  splitBatchSource,
  titleSchema,
  type ServiceListing,
  type Title,
} from '../src/index.js';

describe('T-SVC-001 expanded subscription services', () => {
  it('T-SVC-001a pins all eight canonical tokens and labels without absorbing discovery', () => {
    expect(SERVICES).toEqual([
      'netflix',
      'max',
      'prime-video',
      'disney-plus',
      'apple-tv-plus',
      'paramount-plus',
      'starz',
      'peacock',
    ]);
    expect(SERVICES.map((service) => SERVICE_LABELS[service])).toEqual([
      'Netflix',
      'Max',
      'Prime Video',
      'Disney+',
      'Apple TV+',
      'Paramount+',
      'Starz',
      'Peacock',
    ]);
    expect(DISCOVERY_SOURCES).toEqual(['fandango-at-home']);
    expect(BATCH_SOURCES).toEqual([...SERVICES, ...DISCOVERY_SOURCES]);
    for (const service of SERVICES) {
      expect(isService(service)).toBe(true);
      expect(serviceSchema.parse(service)).toBe(service);
      expect(splitBatchSource(service)).toEqual({ service, discoverySource: null });
      expect(requireServiceOf({ id: 'batch', service, discoverySource: null })).toBe(service);
    }
    for (const value of [
      'unsupported-service',
      'hulu',
      'amazon-video',
      'fandango-at-home',
      'Disney+',
      ' netflix',
      '',
      null,
      undefined,
      1,
      {},
      ['netflix'],
    ]) {
      expect(isService(value)).toBe(false);
      expect(serviceSchema.safeParse(value).success).toBe(false);
    }
  });

  it('T-SVC-001b scopes copy and factual freshness labels to every selected service', () => {
    for (const service of SERVICES) {
      const label = SERVICE_LABELS[service];
      expect(removalsLabel(service)).toBe(`No longer on ${label}`);
      expect(modeExplanation('full-update', service)).toBe(
        `Full update: anything on ${label} that isn't in these screenshots will be offered for removal.`,
      );
      expect(serviceFreshnessLabel(service, null)).toBe(`${label} has never been updated`);
      expect(serviceFreshnessLabel(service, 0)).toBe(`${label} updated today`);
      expect(serviceFreshnessLabel(service, 47)).toBe(`${label} updated 47 days ago`);
    }
  });

  it('T-SVC-001c accepts eight listings but still refuses duplicate services and a ninth listing', () => {
    const listings: ServiceListing[] = SERVICES.map((service, index) => ({
      listingId: `listing-${index}`,
      service,
      state: 'active',
      dateAdded: '2026-01-01',
      dateAddedEdited: false,
      removedAt: null,
      removedByBatchId: null,
      removedByGroupId: null,
      createdByBatchId: `batch-${index}`,
    }));
    const title: Title = {
      id: 'title',
      type: 'title',
      ownerId: 'owner',
      workIdentity: 'unmatched:0123456789abcdef',
      state: 'active',
      matchState: 'unmatched',
      rawExtractedText: 'Example',
      normalisedText: 'example',
      createdByBatchId: 'batch-0',
      visible: true,
      listings,
      tmdb: null,
      sortDateAdded: '2026-01-01',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    for (const listing of listings) expect(serviceListingSchema.parse(listing)).toEqual(listing);
    expect(titleSchema.parse(title)).toEqual(title);
    const repeated = { ...listings[0], listingId: 'extra' };
    expect(titleSchema.safeParse({ ...title, listings: [...listings, repeated] }).success).toBe(
      false,
    );
    expect(titleSchema.safeParse({ ...title, listings: [listings[0], repeated] }).success).toBe(
      false,
    );
  });
});
