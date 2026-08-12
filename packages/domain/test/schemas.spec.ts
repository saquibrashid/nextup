import { describe, expect, it } from 'vitest';

import {
  INGEST_SOURCES,
  TITLE_STATES,
  extractionCandidateSchema,
  ownerDocumentSchema,
  serviceStateSchema,
  suppressionSchema,
  titleSchema,
  uploadBatchSchema,
  uploadedImageSchema,
} from '../src/index.js';
import type {
  ExtractionCandidate,
  ServiceState,
  Suppression,
  Title,
  UploadBatch,
  UploadedImage,
} from '../src/index.js';

// TASK-012 — schema round-trip tests (specs/data-model.md §3).
//
// A schema that only accepts good input proves half of nothing: the value of
// these schemas is what they REFUSE. Every case below therefore pairs a
// round-trip with a rejection of the specific bad shape that rule exists for.

const NOW = '2026-08-11T21:04:33.000Z';

function aTitle(overrides: Partial<Title> = {}): Title {
  return {
    id: '01J9ZQ0000000000000000TTL1',
    type: 'title',
    ownerId: 'o_9f2c1a7b',
    workIdentity: 'tmdb:movie:438631',
    state: 'active',
    matchState: 'matched',
    rawExtractedText: null,
    normalisedText: null,
    createdByBatchId: '01J9ZQ0000000000000000BAT1',
    visible: true,
    listings: [
      {
        listingId: '01J9ZQ0000000000000000LST1',
        service: 'netflix',
        state: 'active',
        dateAdded: '2026-08-11',
        dateAddedEdited: false,
        removedAt: null,
        removedByBatchId: null,
        removedByGroupId: null,
        createdByBatchId: '01J9ZQ0000000000000000BAT1',
      },
    ],
    tmdb: {
      tmdbId: 438631,
      mediaType: 'movie',
      name: 'Dune',
      releaseYear: 2021,
      runtimeMinutes: 155,
      genres: ['Science Fiction'],
      posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
      fetchedAt: NOW,
    },
    sortDateAdded: '2026-08-11',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function anImage(overrides: Partial<UploadedImage> = {}): UploadedImage {
  return {
    id: '01J9ZQ0000000000000000IMG1',
    type: 'uploadedImage',
    ownerId: 'o_9f2c1a7b',
    batchId: '01J9ZQ0000000000000000BAT1',
    blobPath: 'o_9f2c1a7b/01J9ZQ0000000000000000BAT1/01J9ZQ0000000000000000IMG1.png',
    fileName: 'pasted-20260811-210433-01.png',
    ingestSource: 'paste',
    uploadedFormat: 'png',
    format: 'png',
    byteSize: 1024,
    width: 1170,
    height: 2532,
    uploadedAt: NOW,
    retainUntil: '2026-09-10T21:04:33.000Z',
    candidateCount: null,
    ...overrides,
  };
}

function aBatch(overrides: Partial<UploadBatch> = {}): UploadBatch {
  return {
    id: '01J9ZQ0000000000000000BAT1',
    type: 'uploadBatch',
    ownerId: 'o_9f2c1a7b',
    service: 'netflix',
    mode: 'append-only',
    status: 'draft',
    derivedFromBatchId: null,
    createdAt: NOW,
    submittedAt: null,
    extractionStartedAt: null,
    extractionError: null,
    completedAt: null,
    undoneAt: null,
    extractionStats: null,
    removalGroups: [],
    provenance: { created: [], modified: [], removed: [] },
    ...overrides,
  };
}

function aSuppression(overrides: Partial<Suppression> = {}): Suppression {
  return {
    id: 'supp:tmdb:movie:438631',
    type: 'suppression',
    ownerId: 'o_9f2c1a7b',
    workIdentity: 'tmdb:movie:438631',
    active: true,
    suppressedAt: NOW,
    unsuppressedAt: null,
    migratedFrom: null,
    displaySnapshot: {
      name: 'Dune',
      releaseYear: 2021,
      mediaType: 'movie',
      posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
    },
    ...overrides,
  };
}

function aCandidate(overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  return {
    id: 'cand:01J9ZQ0000000000000000BAT1:01J9ZQ0000000000000000IMG1:1',
    type: 'extractionCandidate',
    ownerId: 'o_9f2c1a7b',
    batchId: '01J9ZQ0000000000000000BAT1',
    sourceImageIds: ['01J9ZQ0000000000000000IMG1'],
    rawText: 'Dune',
    inferredTitle: 'Dune',
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    normalisedText: 'dune',
    extractedYear: 2021,
    boundingBoxes: [],
    boxSource: 'ocr',
    ocrConfidence: 0.98,
    cleanupVerdict: 'title-candidate',
    resolvedWorkIdentity: 'tmdb:movie:438631',
    matchCandidates: [],
    classification: 'new',
    reviewDisposition: 'pending',
    correctedToTmdbId: null,
    createdAt: NOW,
    ...overrides,
  };
}

const aServiceState: ServiceState = {
  id: 'svcstate:netflix',
  type: 'serviceState',
  ownerId: 'o_9f2c1a7b',
  service: 'netflix',
  lastCompletedBatchAt: NOW,
  lastCompletedBatchId: '01J9ZQ0000000000000000BAT1',
};

describe('T-DM-020 domain schema round-trips', () => {
  it('T-DM-020a: every document type round-trips through its schema unchanged', () => {
    expect(titleSchema.parse(aTitle())).toEqual(aTitle());
    expect(uploadBatchSchema.parse(aBatch())).toEqual(aBatch());
    expect(uploadedImageSchema.parse(anImage())).toEqual(anImage());
    expect(suppressionSchema.parse(aSuppression())).toEqual(aSuppression());
    expect(extractionCandidateSchema.parse(aCandidate())).toEqual(aCandidate());
    expect(serviceStateSchema.parse(aServiceState)).toEqual(aServiceState);
  });

  it('T-DM-020b: the discriminated union accepts every document type', () => {
    for (const doc of [
      aTitle(),
      aBatch(),
      anImage(),
      aSuppression(),
      aCandidate(),
      aServiceState,
    ]) {
      expect(ownerDocumentSchema.safeParse(doc).success).toBe(true);
    }
  });

  it('T-DM-020c: an unexpected key is an error, not silently stripped', () => {
    // Stripping would hide a producer/consumer mismatch until it mattered.
    const withExtra = { ...aTitle(), sneaky: 'value' };
    expect(titleSchema.safeParse(withExtra).success).toBe(false);
  });
});

describe('T-DM-021 suppression is never a title state', () => {
  it("T-DM-021a: TITLE_STATES does not contain 'suppressed'", () => {
    // REQ-071 / PRD R-5: suppression is the existence of a Suppression row
    // evaluated against the WORK. A row-scoped flag is silently bypassed the
    // moment a title reappears as a new row.
    expect(TITLE_STATES).toEqual(['active', 'removed']);
  });

  it("T-DM-021b: the title schema rejects state 'suppressed'", () => {
    const result = titleSchema.safeParse({ ...aTitle(), state: 'suppressed' });
    expect(result.success).toBe(false);
  });
});

describe('T-DM-022 match state, identity and metadata are one fact', () => {
  it('T-DM-022a: matched requires a tmdb: workIdentity', () => {
    const bad = aTitle({ workIdentity: 'unmatched:9f2c1a7b4e0d5c83' });
    expect(titleSchema.safeParse(bad).success).toBe(false);
  });

  it('T-DM-022b: matched requires tmdb metadata', () => {
    expect(titleSchema.safeParse(aTitle({ tmdb: null })).success).toBe(false);
  });

  it('T-DM-022c: an unmatched title round-trips with its raw and normalised text', () => {
    const unmatched = aTitle({
      workIdentity: 'unmatched:9f2c1a7b4e0d5c83',
      matchState: 'unmatched',
      tmdb: null,
      rawExtractedText: 'Sprder-Man: No Way Home',
      normalisedText: 'sprder man no way home',
    });
    expect(titleSchema.parse(unmatched)).toEqual(unmatched);
  });

  it('T-DM-022d: an unmatched title without its source text is rejected', () => {
    const bad = aTitle({
      workIdentity: 'unmatched:9f2c1a7b4e0d5c83',
      matchState: 'unmatched',
      tmdb: null,
      rawExtractedText: null,
      normalisedText: null,
    });
    expect(titleSchema.safeParse(bad).success).toBe(false);
  });

  it('T-DM-022e: a malformed workIdentity is rejected', () => {
    for (const bad of [
      'tmdb:movie:0', // ids start at 1
      'tmdb:film:438631', // media type is movie|tv
      'unmatched:9F2C1A7B4E0D5C83', // hex is lowercase
      'unmatched:9f2c1a7b', // 16 hex chars exactly
      'tmdb:movie:438631 ', // no trailing whitespace
      '',
    ]) {
      expect(titleSchema.safeParse(aTitle({ workIdentity: bad })).success).toBe(false);
    }
  });
});

describe('T-DM-023 listings', () => {
  it('T-DM-023a: at most one listing per service', () => {
    const listing = aTitle().listings[0]!;
    const bad = aTitle({
      listings: [listing, { ...listing, listingId: '01J9ZQ0000000000000000LST2' }],
    });
    expect(titleSchema.safeParse(bad).success).toBe(false);
  });

  it('T-DM-023b: a title with one listing per service round-trips', () => {
    const listing = aTitle().listings[0]!;
    const two = aTitle({
      listings: [listing, { ...listing, listingId: '01J9ZQ0000000000000000LST2', service: 'max' }],
    });
    expect(titleSchema.parse(two)).toEqual(two);
  });

  it('T-DM-023c: a title with no listings is rejected', () => {
    expect(titleSchema.safeParse(aTitle({ listings: [] })).success).toBe(false);
  });
});

describe('T-DM-024 TMDB metadata', () => {
  it('T-DM-024a: an empty genre array is valid and means "TMDB carries no genre"', () => {
    // US-019 AC-6: never defaulted, never filled in.
    const t = aTitle();
    const noGenres = aTitle({ tmdb: { ...t.tmdb!, genres: [] } });
    expect(titleSchema.parse(noGenres).tmdb?.genres).toEqual([]);
  });

  it('T-DM-024b: posterPath must be a TMDB path, not a URL', () => {
    const t = aTitle();
    const asUrl = aTitle({
      tmdb: { ...t.tmdb!, posterPath: 'https://image.tmdb.org/t/p/w342/d5NXS.jpg' },
    });
    expect(titleSchema.safeParse(asUrl).success).toBe(false);
  });
});

describe('T-DM-025 uploaded image — ingest source and file name (R7, A45)', () => {
  it('T-DM-025a: all three ingest sources round-trip', () => {
    expect(INGEST_SOURCES).toEqual(['paste', 'upload', 'drop']);
    for (const ingestSource of INGEST_SOURCES) {
      const image = anImage({ ingestSource });
      expect(uploadedImageSchema.parse(image)).toEqual(image);
    }
  });

  it('T-DM-025b: a fourth ingest source is rejected', () => {
    const bad = { ...anImage(), ingestSource: 'airdrop' };
    expect(uploadedImageSchema.safeParse(bad).success).toBe(false);
  });

  it('T-DM-025c: fileName round-trips and is never blank', () => {
    expect(uploadedImageSchema.parse(anImage()).fileName).toBe('pasted-20260811-210433-01.png');
    for (const fileName of ['', '   ', 'x'.repeat(256)]) {
      expect(uploadedImageSchema.safeParse(anImage({ fileName })).success).toBe(false);
    }
  });

  it('T-DM-025d: uploadedFormat accepts HEIC while the stored format does not', () => {
    // The device may deliver HEIC; what is PERSISTED is always png|jpeg,
    // because HEIC is transcoded to lossless PNG on ingest.
    const heic = anImage({ uploadedFormat: 'heic', format: 'png', fileName: 'IMG_0042.heic' });
    expect(uploadedImageSchema.parse(heic)).toEqual(heic);

    const stored = { ...anImage(), format: 'heic' };
    expect(uploadedImageSchema.safeParse(stored).success).toBe(false);
  });

  it('T-DM-025e: an image over 10 MiB is rejected', () => {
    expect(uploadedImageSchema.safeParse(anImage({ byteSize: 10 * 1024 * 1024 + 1 })).success).toBe(
      false,
    );
  });
});

describe('T-DM-026 batch', () => {
  it('T-DM-026a: completedAt is set if and only if the batch is applied', () => {
    expect(
      uploadBatchSchema.safeParse(aBatch({ status: 'applied', completedAt: null })).success,
    ).toBe(false);
    expect(uploadBatchSchema.safeParse(aBatch({ status: 'draft', completedAt: NOW })).success).toBe(
      false,
    );
    const applied = aBatch({ status: 'applied', completedAt: NOW, submittedAt: NOW });
    expect(uploadBatchSchema.parse(applied)).toEqual(applied);
  });

  it('T-DM-026b: provenance records the pre-batch value of a modified attribute', () => {
    // REQ-068 / US-031 AC-6 — REQ-075's refusal enumeration reads straight out
    // of these arrays, so `before` must survive the round trip untouched.
    const batch = aBatch({
      provenance: {
        created: [
          { titleId: '01J9ZQ0000000000000000TTL1', listingId: null, titleWasCreated: true },
        ],
        modified: [
          {
            titleId: '01J9ZQ0000000000000000TTL1',
            attr: 'listings[0].state',
            before: 'active',
            after: 'removed',
          },
        ],
        removed: [
          {
            titleId: '01J9ZQ0000000000000000TTL1',
            listingId: '01J9ZQ0000000000000000LST1',
            beforeState: 'active',
            groupId: '01J9ZQ0000000000000000GRP1',
          },
        ],
      },
    });
    expect(uploadBatchSchema.parse(batch)).toEqual(batch);
  });
});

describe('T-DM-027 extraction candidate', () => {
  it('T-DM-027a: empty rawText is allowed only for an unreadable tile', () => {
    // REQ-012: no candidate is ever dropped, so an unnameable tile still
    // becomes a candidate — but nothing else may arrive with no text.
    const unreadable = aCandidate({
      rawText: '',
      inferredTitle: null,
      cleanupVerdict: 'unreadable-tile',
      normalisedText: '',
      resolvedWorkIdentity: null,
      classification: null,
    });
    expect(extractionCandidateSchema.parse(unreadable)).toEqual(unreadable);

    expect(extractionCandidateSchema.safeParse(aCandidate({ rawText: '' })).success).toBe(false);
  });

  it('T-DM-027b: a candidate may cite more than one source image after overlap collapse', () => {
    const collapsed = aCandidate({
      sourceImageIds: ['01J9ZQ0000000000000000IMG1', '01J9ZQ0000000000000000IMG2'],
    });
    expect(extractionCandidateSchema.parse(collapsed)).toEqual(collapsed);
  });

  it('T-DM-027c: a candidate with no source image is rejected', () => {
    expect(extractionCandidateSchema.safeParse(aCandidate({ sourceImageIds: [] })).success).toBe(
      false,
    );
  });
});
