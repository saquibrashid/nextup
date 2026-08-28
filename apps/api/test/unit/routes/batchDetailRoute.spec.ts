/**
 * TASK-076 — the batch history and batch detail HANDLERS, driven through the
 * real Express app with the repository mocked.
 *
 * ⚠ **`T-BATCH-017` IS THE POINT OF THIS FILE.** `GET /api/batches/:batchId`
 * did not exist while `apps/web/src/lib/apiClient.ts` was already calling it
 * and `BatchStatusRoute` was polling it every two seconds. The SPA's tests
 * stub the client, so they passed; the API's tests only assert routes that
 * exist, so they passed too. **A missing route is asserted by nobody unless
 * something asserts it on purpose** — `T-BATCH-017` is that assertion for this
 * route, and `tests/infra/clientRouteParity.spec.ts` (`T-API-010`) is the
 * general gate that catches the next one by comparing the client's own source
 * against the live router.
 *
 * T-BATCH-016: the history list is owner-scoped and newest-first.
 * T-BATCH-017: every batch route the SPA client calls is registered.
 * T-BATCH-018: a card's counts and the detail's arrays agree.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listBatchHistory = vi.fn();
const countBatchChangeKinds = vi.fn();
const findUploadBatch = vi.fn();
const listImagesForBatch = vi.fn();
const listBatchChanges = vi.fn();
const listTitleNames = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    listBatchHistory: (...args: unknown[]) => listBatchHistory(...args) as unknown,
    countBatchChangeKinds: (...args: unknown[]) => countBatchChangeKinds(...args) as unknown,
    findUploadBatch: (...args: unknown[]) => findUploadBatch(...args) as unknown,
    listImagesForBatch: (...args: unknown[]) => listImagesForBatch(...args) as unknown,
    listBatchChanges: (...args: unknown[]) => listBatchChanges(...args) as unknown,
    listTitleNames: (...args: unknown[]) => listTitleNames(...args) as unknown,
  };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');
const { readProgress, changedNothing, provenanceTitleIds, IN_FLIGHT_STATUSES } =
  await import('../../../src/routes/batchDetail.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-batch-detail-unit';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

const BATCH_ID = 'b-001';
const TITLE_ID = 't-001';

const batchRow = (over: Record<string, unknown> = {}) => ({
  id: BATCH_ID,
  ownerId: 'owner-x',
  service: 'netflix',
  mode: 'full-update',
  status: 'applied',
  derivedFromBatchId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  submittedAt: new Date('2026-01-01T00:01:00.000Z'),
  completedAt: new Date('2026-01-01T00:05:00.000Z'),
  undoneAt: null,
  extractionStartedAt: null,
  extractionStats: null,
  extractionErrorCode: null,
  extractionErrorMessage: null,
  extractionErrorAt: null,
  degradedExtraction: false,
  lowYield: false,
  crossCheck: null,
  ...over,
});

const imageRow = (over: Record<string, unknown> = {}) => ({
  id: 'img-1',
  fileName: 'IMG_0421.PNG',
  ingestSource: 'upload',
  retainUntil: new Date('2099-01-01T00:00:00.000Z'),
  candidateCount: 14,
  blobPath: 'owner/batch/img-1.png',
  ...over,
});

let server: Server;
let app: Express;
let origin: string;

const get = (path: string): Promise<Response> =>
  fetch(`${origin}${path}`, { headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader } });

beforeEach(async () => {
  vi.resetAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  listTitleNames.mockResolvedValue([]);
  listImagesForBatch.mockResolvedValue([]);
  listBatchChanges.mockResolvedValue([]);
  countBatchChangeKinds.mockResolvedValue([]);
  if (server === undefined) {
    app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('GET /api/batches — history (T-BATCH-016)', () => {
  it('T-BATCH-016: returns the owner batches newest-first with their change counts', async () => {
    listBatchHistory.mockResolvedValue([
      batchRow({ id: 'b-new', createdAt: new Date('2026-02-01T00:00:00.000Z') }),
      batchRow({ id: 'b-old', service: 'max', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    ]);
    countBatchChangeKinds.mockResolvedValue([
      { batchId: 'b-new', kind: 'listing_added', _count: { _all: 6 } },
      { batchId: 'b-new', kind: 'title_created', _count: { _all: 6 } },
      { batchId: 'b-new', kind: 'listing_removed', _count: { _all: 3 } },
    ]);

    const res = await get('/api/batches');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      batches: { batchId: string; service: string; counts: Record<string, number> }[];
    };

    // Newest first, and BOTH services in one chronological history — the
    // difference between this and `listUploadBatches`.
    expect(body.batches.map((batch) => batch.batchId)).toEqual(['b-new', 'b-old']);
    expect(body.batches.map((batch) => batch.service)).toEqual(['netflix', 'max']);

    // ⚠ `created` is 6, not 12. A `title_created` row and its `listing_added`
    // sibling are ONE creation (§3.7); adding the two kinds would double every
    // new title on the card while the detail page listed six.
    expect(body.batches[0]?.counts).toEqual({ created: 6, modified: 0, removed: 3 });
    expect(body.batches[1]?.counts).toEqual({ created: 0, modified: 0, removed: 0 });
  });

  it('T-BATCH-016a: counts are fetched in ONE query for the whole page', async () => {
    listBatchHistory.mockResolvedValue([
      batchRow({ id: 'b-1' }),
      batchRow({ id: 'b-2' }),
      batchRow({ id: 'b-3' }),
    ]);

    await get('/api/batches');

    // Not once per card. On a 5-DTU Basic database a per-card query is 50
    // round trips a page view, and a three-batch fixture makes that look fine.
    expect(countBatchChangeKinds).toHaveBeenCalledTimes(1);
    expect(countBatchChangeKinds).toHaveBeenCalledWith(expect.anything(), ['b-1', 'b-2', 'b-3']);
  });
});

describe('GET /api/batches/:batchId — detail (§6.15)', () => {
  it('T-BATCH-017: the route the SPA polls is registered and answers 200', async () => {
    findUploadBatch.mockResolvedValue(batchRow());

    const res = await get(`/api/batches/${BATCH_ID}`);
    // The regression this file exists for: this was a 404 for the whole of
    // TASK-059's life, and the extraction poll could never complete.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { batchId: string; service: string };
    expect(body.batchId).toBe(BATCH_ID);
    expect(body.service).toBe('netflix');
  });

  it('T-BATCH-017a: an unknown batch is a 404, not a 500', async () => {
    findUploadBatch.mockResolvedValue(null);

    const res = await get('/api/batches/nope');
    expect(res.status).toBe(404);
  });

  it('T-BATCH-017b: images carry an API href and a derived availability', async () => {
    findUploadBatch.mockResolvedValue(batchRow());
    listImagesForBatch.mockResolvedValue([
      imageRow(),
      imageRow({ id: 'img-2', retainUntil: new Date('2000-01-01T00:00:00.000Z') }),
    ]);

    const res = await get(`/api/batches/${BATCH_ID}`);
    const body = (await res.json()) as {
      images: { imageId: string; href: string; available: boolean }[];
    };

    expect(body.images[0]?.href).toBe('/api/images/img-1');
    expect(body.images[0]?.available).toBe(true);
    // Past its retention horizon: derived, never stored (ADR-0006).
    expect(body.images[1]?.available).toBe(false);
    // `blobPath` must never reach a client (`T-SEC-003`).
    expect(JSON.stringify(body)).not.toContain('owner/batch/img-1.png');
  });

  it('T-BATCH-017c: progress is present in flight and absent once applied', async () => {
    const stats = JSON.stringify({ progress: { imagesDone: 3, imagesTotal: 7 } });

    findUploadBatch.mockResolvedValue(batchRow({ status: 'extracting', extractionStats: stats }));
    const running = (await (await get(`/api/batches/${BATCH_ID}`)).json()) as {
      progress?: { imagesDone: number };
    };
    expect(running.progress).toEqual({ imagesDone: 3, imagesTotal: 7 });

    // Same stored stats, terminal status: US-006 AC-1 scopes `progress` to a
    // batch still being read, so a finished batch must not report one.
    findUploadBatch.mockResolvedValue(batchRow({ status: 'applied', extractionStats: stats }));
    const done = (await (await get(`/api/batches/${BATCH_ID}`)).json()) as {
      progress?: unknown;
    };
    expect(done.progress).toBeUndefined();
  });

  it('T-BATCH-017d: the extraction error CODE is returned, never the message', async () => {
    findUploadBatch.mockResolvedValue(
      batchRow({
        status: 'extraction-failed',
        extractionErrorCode: 'EXTRACTION_TIMEOUT',
        extractionErrorMessage: 'the server sentence nobody should render',
      }),
    );

    const body = (await (await get(`/api/batches/${BATCH_ID}`)).json()) as {
      extractionError: string | null;
    };
    expect(body.extractionError).toBe('EXTRACTION_TIMEOUT');
    // The SPA owns every code's wording (`ux-states.md` §5.5-§5.7); shipping
    // the server's sentence too would give one failure two voices.
    expect(JSON.stringify(body)).not.toContain('the server sentence nobody should render');
  });

  it('T-BATCH-017e: degradedExtraction and crossCheck are carried (the T-UX-008 gap)', async () => {
    findUploadBatch.mockResolvedValue(
      batchRow({ degradedExtraction: true, crossCheck: 'ocr-unavailable' }),
    );

    const body = (await (await get(`/api/batches/${BATCH_ID}`)).json()) as {
      degradedExtraction: boolean;
      crossCheck: string | null;
    };
    // Without these the status page cannot render the degraded banner at all,
    // and `T-UX-008` asserts that it does.
    expect(body.degradedExtraction).toBe(true);
    expect(body.crossCheck).toBe('ocr-unavailable');
  });

  it('T-UX-093: the detail view is given created, modified and removed in full', async () => {
    findUploadBatch.mockResolvedValue(batchRow());
    listBatchChanges.mockResolvedValue([
      {
        kind: 'title_created',
        titleId: TITLE_ID,
        listingId: null,
        attr: null,
        prevValue: null,
        nextValue: null,
      },
      {
        kind: 'listing_added',
        titleId: TITLE_ID,
        listingId: 'l-1',
        attr: null,
        prevValue: null,
        nextValue: null,
      },
      {
        kind: 'attr_modified',
        titleId: 't-002',
        listingId: null,
        attr: 'workIdentity',
        prevValue: '"a"',
        nextValue: '"b"',
      },
      {
        kind: 'listing_removed',
        titleId: 't-003',
        listingId: 'l-9',
        attr: null,
        prevValue: null,
        nextValue: '"g-1"',
      },
    ]);
    listTitleNames.mockResolvedValue([
      {
        id: TITLE_ID,
        tmdbName: 'Arrival',
        rawExtractedText: null,
        tmdbReleaseYear: 2016,
        state: 'active',
      },
      {
        id: 't-002',
        tmdbName: null,
        rawExtractedText: 'raw two',
        tmdbReleaseYear: null,
        state: 'active',
      },
      {
        id: 't-003',
        tmdbName: 'Gone',
        rawExtractedText: null,
        tmdbReleaseYear: 2011,
        state: 'removed',
      },
    ]);

    const body = (await (await get(`/api/batches/${BATCH_ID}`)).json()) as {
      provenance: { created: unknown[]; modified: unknown[]; removed: unknown[] };
      changedNothing: boolean;
      titles: { titleId: string; name: string; state: string }[];
    };

    // In FULL — nothing summarised away (US-031 AC-4).
    expect(body.provenance.created).toHaveLength(1);
    expect(body.provenance.modified).toHaveLength(1);
    expect(body.provenance.removed).toHaveLength(1);
    expect(body.changedNothing).toBe(false);

    // §9.4 requires each entry to LINK TO THE TITLE, and a ULID is not a name.
    expect(body.titles.map((title) => title.name)).toEqual(['Arrival', 'raw two', 'Gone']);
    // US-033 AC-6's state chip needs the current state, not the state then.
    expect(body.titles[2]?.state).toBe('removed');
  });

  it('T-UX-094: a batch that changed nothing says so explicitly', async () => {
    findUploadBatch.mockResolvedValue(batchRow());

    const body = (await (await get(`/api/batches/${BATCH_ID}`)).json()) as {
      changedNothing: boolean;
      provenance: { created: unknown[] };
    };
    // A flag, not three empty arrays for the client to interpret. §9.5 is a
    // SENTENCE — "This upload didn't change anything" — and deriving it in the
    // SPA would put the rule in a second place.
    expect(body.changedNothing).toBe(true);
    expect(body.provenance.created).toEqual([]);
  });
});

describe('batch detail — exported predicates', () => {
  it('T-BATCH-018: readProgress returns null rather than a zeroed pair', () => {
    // The distinction the status page renders: `null` shows nothing, `{0,0}`
    // would claim "0 of 0 screenshots read".
    expect(readProgress(null)).toBeNull();
    expect(readProgress('{}')).toBeNull();
    expect(readProgress('{"progress":null}')).toBeNull();
    expect(readProgress('not json at all')).toBeNull();
    expect(readProgress('{"progress":{"imagesDone":"3","imagesTotal":7}}')).toBeNull();
    expect(readProgress('{"progress":{"imagesDone":0,"imagesTotal":7}}')).toEqual({
      imagesDone: 0,
      imagesTotal: 7,
    });
  });

  it('T-BATCH-018a: changedNothing is false when ONLY a modification happened', () => {
    expect(changedNothing({ created: [], modified: [], removed: [] })).toBe(true);
    // The trap: a batch that only corrected a match changed something, and
    // telling the owner it changed nothing would be false.
    expect(
      changedNothing({
        created: [],
        modified: [{ titleId: 't', attr: 'workIdentity', before: 'a', after: 'b' }],
        removed: [],
      }),
    ).toBe(false);
    expect(
      changedNothing({
        created: [],
        modified: [],
        removed: [{ titleId: 't', listingId: 'l', beforeState: 'active', groupId: 'g' }],
      }),
    ).toBe(false);
  });

  it('T-BATCH-018b: provenanceTitleIds de-duplicates across all three arrays', () => {
    // A title can be created and modified by the same batch; asking the store
    // for it twice is a wasted round trip and a duplicated card.
    expect(
      provenanceTitleIds({
        created: [{ titleId: 't-1', listingId: 'l', titleWasCreated: true }],
        modified: [{ titleId: 't-1', attr: 'workIdentity', before: null, after: 'x' }],
        removed: [{ titleId: 't-2', listingId: 'l2', beforeState: 'active', groupId: 'g' }],
      }),
    ).toEqual(['t-1', 't-2']);
  });

  it('T-BATCH-018c: only submitted and extracting are in flight', () => {
    // `in-review` is NOT in flight: the read has finished and the owner is
    // being asked to confirm it, so a progress bar there would be a lie.
    expect([...IN_FLIGHT_STATUSES].sort()).toEqual(['extracting', 'submitted']);
  });
});
