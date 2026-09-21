import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  SERVICES,
  SERVICE_LABELS,
  type BatchMode,
  type Service,
  type TitleExtractor,
} from '@nextup/domain';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadIngestFixture } from '../../../../tests/fixtures/golden/ingest/index.js';
import { tmdbMswServer } from '../../../../tests/fixtures/msw/tmdb/index.js';
import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { TmdbClient, resetTmdbRateLimiterForTests } from '../../src/clients/tmdbClient.js';
import { startExtraction } from '../../src/jobs/startExtraction.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  findWatchPreference,
  listTitleRatingRows,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { azureImageBlobStore, resetBlobStoreForTests } from '../../src/storage/blobStore.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

// Submit remains real; its job is explicitly awaited below with the same service-blind reader.
vi.mock('../../src/jobs/startExtraction.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/jobs/startExtraction.js')>()),
  beginExtraction: vi.fn(),
}));

const SUBJECT = 'expanded-services-owner';
const OTHER = 'expanded-services-other';
const DUNE = 'tmdb:movie:438631';
const principal = (subject: string) =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: subject },
      ],
    }),
  ).toString('base64');

let server: Server;
let origin: string;
let owner: OwnerId;
let other: OwnerId;
let msw: ReturnType<typeof tmdbMswServer>;

interface ListItem {
  titleId: string;
  workIdentity: string;
  watching: boolean;
  priority: string;
  sortDateAdded: string;
  badges: { service: Service }[];
}
interface ListBody {
  items: ListItem[];
  nextCursor: string | null;
  runtimeUnknownHidden: number | null;
}

function request(path: string, method = 'GET', body?: unknown, subject = SUBJECT) {
  return fetch(`${origin}/api${path}`, {
    method,
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principal(subject),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function succeeds(response: Response, status = 200) {
  expect(response.status, await response.clone().text()).toBe(status);
  return response;
}

async function list(query = ''): Promise<ListBody> {
  return (await succeeds(await request(`/titles${query}`))).json() as Promise<ListBody>;
}

async function capture(service: Service, name = 'Dune', mode: BatchMode = 'append-only') {
  const created = await succeeds(
    await request('/batches', 'POST', { source: service, mode, captureProtocol: 1 }),
    201,
  );
  const { batchId } = (await created.json()) as { batchId: string };
  const form = new FormData();
  form.append(
    'files',
    new Blob([Uint8Array.from(loadIngestFixture('controlPng'))], {
      type: 'application/octet-stream',
    }),
    'screenshot.png',
  );
  const uploaded = await succeeds(
    await fetch(`${origin}/api/batches/${batchId}/images`, {
      method: 'POST',
      headers: { [CLIENT_PRINCIPAL_HEADER]: principal(SUBJECT) },
      body: form,
    }),
    201,
  );
  expect(await uploaded.json()).toMatchObject({
    accepted: [expect.objectContaining({ format: 'png' })],
    rejected: [],
  });
  await succeeds(await request(`/batches/${batchId}/submit`, 'POST', {}), 202);
  const extract = vi.fn<TitleExtractor['extract']>(async () => ({
    items: [
      {
        rawText: name,
        inferredTitle: name,
        basis: 'text',
        ocrSupport: 'exact',
        provider: 'llm',
        boundingBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
        boxSource: 'ocr',
        confidence: 0.99,
      },
    ],
    crossCheck: 'ok',
    providerMeta: {},
  }));
  await startExtraction(owner, batchId, {
    blobStore: azureImageBlobStore,
    extractor: { name: 'hybrid', extract },
    tmdbClient: new TmdbClient({ apiKey: 'test-key' }),
  });
  expect(extract.mock.calls).toHaveLength(1);
  expect(extract.mock.calls[0]).toEqual([expect.any(Uint8Array), 'image/png']);
  const candidates = await testPrisma().extractionCandidate.findMany({
    where: { ownerId: owner, batchId },
    include: { sourceImages: true },
  });
  expect(candidates).toHaveLength(1);
  const candidate = candidates[0]!;
  expect(candidate.sourceImages).toHaveLength(1);
  await succeeds(await request(`/batches/${batchId}/review`));
  await succeeds(
    await request(`/batches/${batchId}/candidates/${candidate.id}`, 'PATCH', {
      disposition: 'corrected',
      tmdbId: name === 'Dune' ? 438631 : 949,
      mediaType: 'movie',
      correctedName: name,
      correctedReleaseYear: name === 'Dune' ? 2021 : 1995,
      correctedPosterPath: null,
    }),
  );
  return batchId;
}

beforeEach(async () => {
  resetAllowListWarning();
  resetBlobStoreForTests();
  resetTmdbRateLimiterForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubEnv('NEXTUP_ALLOWED_SUBJECTS', `${SUBJECT},${OTHER}`);
  vi.stubEnv('TMDB_API_KEY', 'test-key');
  vi.stubEnv(
    'AZURE_STORAGE_CONNECTION_STRING',
    process.env['AZURE_STORAGE_CONNECTION_STRING'] ?? 'UseDevelopmentStorage=true',
  );
  testPrisma();
  await resetDatabase();
  msw = tmdbMswServer();
  msw.listen({
    onUnhandledRequest: (req, print) => {
      if (['127.0.0.1', 'localhost', '::1'].includes(new URL(req.url).hostname)) return;
      print.error();
    },
  });
  await new Promise<void>((resolve) => {
    server = createApp({ webRoot: 'C:\\nonexistent-web-root' }).listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  owner = asOwnerId(((await (await request('/me')).json()) as { ownerId: string }).ownerId);
  other = asOwnerId(
    ((await (await request('/me', 'GET', undefined, OTHER)).json()) as { ownerId: string }).ownerId,
  );
});

afterEach(async () => {
  for (const image of await testPrisma().uploadedImage.findMany({ where: { ownerId: owner } })) {
    await azureImageBlobStore.remove(image.blobPath);
  }
  msw.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(closeTestPrisma);

describe('T-SVC-001 eight services on real SQL', () => {
  it('T-SVC-001i keeps service CHECKs trusted, rejects unsupported SQL values and permits discovery NULL', async () => {
    const db = testPrisma();
    const checks = await db.$queryRaw<
      { name: string; tableName: string; disabled: number; untrusted: number }[]
    >`
      SELECT [name], OBJECT_NAME([parent_object_id]) AS [tableName],
        CAST([is_disabled] AS int) AS [disabled], CAST([is_not_trusted] AS int) AS [untrusted]
      FROM sys.check_constraints
      WHERE [name] IN ('ck_batch_service', 'ck_listing_service', 'ck_state_service')
      ORDER BY [name]
    `;
    expect(checks).toEqual([
      { name: 'ck_batch_service', tableName: 'upload_batch', disabled: 0, untrusted: 0 },
      { name: 'ck_listing_service', tableName: 'service_listing', disabled: 0, untrusted: 0 },
      { name: 'ck_state_service', tableName: 'service_state', disabled: 0, untrusted: 0 },
    ]);
    await createUploadBatch(owner, {
      id: 'svc-check-batch',
      service: 'netflix',
      mode: 'append-only',
      status: 'applied',
    });
    await createTitle(owner, {
      id: 'svc-check-title',
      workIdentity: DUNE,
      state: 'active',
      matchState: 'matched',
      tmdbId: 438631,
      tmdbMediaType: 'movie',
    });
    await createServiceListing(owner, {
      listingId: 'svc-check-listing',
      titleId: 'svc-check-title',
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-01-01'),
      createdByBatchId: 'svc-check-batch',
    });
    await db.serviceState.create({ data: { ownerId: owner, service: 'netflix' } });
    for (const invalid of ['unsupported', 'hulu', 'amazon-video', 'apple-tv', 'disney-plus-x']) {
      await expect(db.$executeRaw`
        UPDATE dbo.upload_batch SET service = ${invalid} WHERE id = 'svc-check-batch'
      `).rejects.toThrow(/ck_batch_service/);
      await expect(db.$executeRaw`
        UPDATE dbo.service_listing SET service = ${invalid} WHERE listing_id = 'svc-check-listing'
      `).rejects.toThrow(/ck_listing_service/);
      await expect(db.$executeRaw`
        UPDATE dbo.service_state SET service = ${invalid} WHERE owner_id = ${owner}
      `).rejects.toThrow(/ck_state_service/);
    }
    expect(await db.uploadBatch.findUnique({ where: { id: 'svc-check-batch' } })).toMatchObject({
      service: 'netflix',
    });
    expect(
      await db.serviceListing.findUnique({ where: { listingId: 'svc-check-listing' } }),
    ).toMatchObject({ service: 'netflix' });
    expect(await db.serviceState.findMany({ where: { ownerId: owner } })).toMatchObject([
      { service: 'netflix' },
    ]);
    const discovery = await createUploadBatch(owner, {
      id: 'svc-check-discovery',
      service: null,
      discoverySource: 'fandango-at-home',
      mode: 'append-only',
      status: 'draft',
    });
    expect(discovery).toMatchObject({ service: null, discoverySource: 'fandango-at-home' });
  });

  it('T-SVC-001g uploads, extracts, reviews and closes all eight; each full update preserves the other seven', async () => {
    const batches: string[] = [];
    for (const service of SERVICES) {
      const batchId = await capture(service);
      batches.push(batchId);
      await succeeds(await request(`/batches/${batchId}/close`, 'POST', {}));
      if (service === 'netflix') {
        const first = await testPrisma().serviceListing.findFirstOrThrow({
          where: { ownerId: owner, service },
        });
        await testPrisma().$transaction([
          testPrisma().serviceListing.update({
            where: { listingId: first.listingId },
            data: { dateAdded: new Date('2020-01-02') },
          }),
          testPrisma().title.update({
            where: { id: first.titleId },
            data: { sortDateAdded: new Date('2020-01-02') },
          }),
        ]);
      }
    }
    let body = await list();
    expect(body.items).toHaveLength(1);
    const dune = body.items[0]!;
    expect(dune.workIdentity).toBe(DUNE);
    expect(new Set(dune.badges.map(({ service }) => service))).toEqual(new Set(SERVICES));
    expect(
      await testPrisma().batchChange.count({
        where: { ownerId: owner, titleId: dune.titleId, kind: 'listing_added' },
      }),
    ).toBe(8);
    await succeeds(
      await request(`/titles/${dune.titleId}/watch-preferences`, 'PATCH', {
        watching: true,
        priority: 'someday',
      }),
    );
    expect((await list()).items[0]?.sortDateAdded).toBe('2020-01-02');
    const states = (await (await succeeds(await request('/service-state'))).json()) as {
      services: { service: Service; lastCompletedBatchId: string; label: string }[];
    };
    expect(states.services.map(({ service }) => service)).toEqual(SERVICES);
    expect(states.services.map(({ lastCompletedBatchId }) => lastCompletedBatchId)).toEqual(
      batches,
    );
    for (const state of states.services)
      expect(state.label).toBe(`${SERVICE_LABELS[state.service]} updated today`);
    expect((await list(`?${SERVICES.map((s) => `service=${s}`).join('&')}`)).items).toHaveLength(1);
    expect(await (await request('/titles', 'GET', undefined, OTHER)).json()).toMatchObject({
      items: [],
    });

    for (const service of SERVICES) {
      const othersBefore = await testPrisma().serviceListing.findMany({
        where: { ownerId: owner, service: { not: service } },
        orderBy: { listingId: 'asc' },
      });
      const stateBefore = await testPrisma().serviceState.findMany({
        where: { ownerId: owner, service: { not: service } },
        orderBy: { service: 'asc' },
      });
      const batchId = await capture(service, 'Heat', 'full-update');
      const review = (await (
        await succeeds(await request(`/batches/${batchId}/review`))
      ).json()) as {
        sections: {
          removals: { count: number; withheld: boolean; items: { listingId: string }[] };
        };
      };
      expect(review.sections.removals).toMatchObject({ count: 1, withheld: false });
      const listingId = review.sections.removals.items[0]!.listingId;
      expect(await testPrisma().serviceListing.findUnique({ where: { listingId } })).toMatchObject({
        titleId: dune.titleId,
        service,
        state: 'active',
      });
      await succeeds(await request(`/batches/${batchId}/close`, 'POST', {}), 409);
      await succeeds(
        await request(`/batches/${batchId}/removals`, 'PATCH', { tick: [listingId], untick: [] }),
      );
      await succeeds(await request(`/batches/${batchId}/close`, 'POST', { confirmRemovals: true }));
      expect(
        await testPrisma().serviceListing.findMany({
          where: { ownerId: owner, service: { not: service } },
          orderBy: { listingId: 'asc' },
        }),
      ).toEqual(othersBefore);
      expect(
        await testPrisma().serviceState.findMany({
          where: { ownerId: owner, service: { not: service } },
          orderBy: { service: 'asc' },
        }),
      ).toEqual(stateBefore);
      body = await list();
      const retained = body.items.find(({ titleId }) => titleId === dune.titleId)!;
      expect(retained.badges).toHaveLength(7);
      expect(retained).toMatchObject({ watching: true, priority: 'someday' });
      const removed = (await (
        await succeeds(await request(`/removed?service=${service}`))
      ).json()) as {
        items: { listingId: string }[];
      };
      expect(removed.items.map((item) => item.listingId)).toEqual([listingId]);
      await succeeds(await request(`/listings/${listingId}/restore`, 'POST', {}));
    }
    expect(await findWatchPreference(owner, DUNE)).toMatchObject({
      watching: true,
      priority: 'someday',
    });
    const originalProvenance = await testPrisma().batchChange.findMany({
      where: { ownerId: owner, titleId: dune.titleId },
      orderBy: { id: 'asc' },
    });
    await succeeds(await request(`/titles/${dune.titleId}`, 'DELETE'));
    const reappearingBatch = await capture('peacock');
    await succeeds(await request(`/batches/${reappearingBatch}/close`, 'POST', {}));
    const reappeared = (await list()).items.find(({ workIdentity }) => workIdentity === DUNE)!;
    expect(reappeared.titleId).not.toBe(dune.titleId);
    expect(reappeared).toMatchObject({ watching: true, priority: 'someday' });
    expect(reappeared.badges.map(({ service }) => service)).toEqual(['peacock']);
    expect(
      await testPrisma().batchChange.findMany({
        where: { ownerId: owner, titleId: dune.titleId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(originalProvenance);
    await succeeds(await request(`/titles/${reappeared.titleId}/suppress`, 'POST', {}));
    for (const service of SERVICES) {
      await succeeds(
        await request('/titles', 'POST', { service, tmdbId: 438631, mediaType: 'movie' }),
        409,
      );
    }
    expect(await findWatchPreference(owner, DUNE)).toMatchObject({
      watching: true,
      priority: 'someday',
    });
  }, 120_000);

  it('T-SVC-001h applies repeatable service filters before paging, unknown counts and eligible ratings', async () => {
    let seq = 3000;
    async function seed(
      id: string,
      service: Service,
      runtime: number | null,
      on = owner,
      hidden = false,
    ) {
      const batchId = hidden ? `batch-${id}` : null;
      if (batchId !== null)
        await createUploadBatch(on, {
          id: batchId,
          service,
          mode: 'append-only',
          status: 'in-review',
        });
      const title = await createTitle(on, {
        id,
        workIdentity: `tmdb:movie:${++seq}`,
        state: 'active',
        matchState: 'matched',
        tmdbId: seq,
        tmdbMediaType: 'movie',
        tmdbName: id,
        tmdbGenres: '["Drama"]',
        tmdbRuntimeMinutes: runtime,
        tmdbFetchedAt: new Date(),
        sortDateAdded: new Date('2026-01-01'),
        createdByBatchId: batchId,
      });
      await createServiceListing(on, {
        listingId: `listing-${id}`,
        titleId: id,
        service,
        state: 'active',
        dateAdded: new Date('2026-01-01'),
        createdByBatchId: batchId,
      });
      return title;
    }
    for (const service of SERVICES) {
      await seed(`${service}-a`, service, 20);
      await seed(`${service}-b`, service, 25);
      await seed(`${service}-unknown`, service, null);
    }
    await seed('foreign', 'peacock', null, other);
    await seed('hidden', 'peacock', null, owner, true);
    const suppressed = await seed('suppressed', 'peacock', null);
    await createSuppression(owner, {
      id: 'suppressed-work',
      workIdentity: suppressed.workIdentity,
      displayName: 'Suppressed',
    });
    for (const service of SERVICES) {
      const query = `?service=${service}&type=movie&genre=Drama&runtime=under30&watching=false&sort=name&limit=1`;
      const first = await list(query);
      expect(first.items.map(({ titleId }) => titleId)).toEqual([`${service}-a`]);
      expect(first.runtimeUnknownHidden).toBe(1);
      expect(first.nextCursor).not.toBeNull();
      const last = await list(`${query}&cursor=${first.nextCursor}`);
      expect(last.items.map(({ titleId }) => titleId)).toEqual([`${service}-b`]);
      expect(last.nextCursor).toBeNull();
      expect(last.runtimeUnknownHidden).toBe(1);
      const ratingRows = await listTitleRatingRows(owner, {
        services: [service],
        mediaType: 'movie',
        genres: ['Drama'],
        runtimes: ['under30'],
        watching: false,
      });
      expect(ratingRows.map(({ id }) => id).sort()).toEqual([`${service}-a`, `${service}-b`]);
    }
    const all = await list(`?${SERVICES.map((s) => `service=${s}`).join('&')}&runtime=under30`);
    expect(all.items).toHaveLength(16);
    expect(all.runtimeUnknownHidden).toBe(8);
    const two = await list(
      '?service=prime-video&service=disney-plus&runtime=under30&genre=Drama&type=movie',
    );
    expect(new Set(two.items.map(({ titleId }) => titleId))).toEqual(
      new Set(['prime-video-a', 'prime-video-b', 'disney-plus-a', 'disney-plus-b']),
    );
    expect(two.runtimeUnknownHidden).toBe(2);
    for (const path of [
      '/titles?service=unsupported-service',
      '/removed?service=unsupported-service',
    ]) {
      await succeeds(await request(path), 400);
    }
    await succeeds(
      await request('/batches', 'POST', { service: 'unsupported-service', mode: 'append-only' }),
      400,
    );
  });
});
