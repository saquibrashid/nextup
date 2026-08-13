/**
 * `POST /api/titles/:titleId/suppress` — the handler's branch arms, over real
 * HTTP with the repository mocked (TASK-101, US-027 AC-4).
 *
 * This is not a duplicate of `test/integration/suppressions.spec.ts`. That
 * suite proves what the STORE does; this one proves what the HANDLER does when
 * the store answers in each of four ways — including **the concurrent-press
 * race**, which is the one arm a real database cannot be made to take
 * deterministically. Two presses in flight together both miss the existence
 * check, both attempt the insert, and the loser hits the unique index. The
 * owner pressed a button twice; being told the server broke would be wrong.
 *
 * It also carries the coverage. `npm run coverage` excludes the integration
 * project, so a route proven only there scores ~8% against the
 * `apps/api/src/**` floor — which is a gate failure, not a formality.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findTitle = vi.fn();
const findActiveSuppression = vi.fn();
const reactivateSuppression = vi.fn();
const createSuppression = vi.fn();

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findTitle: (...args: unknown[]) => findTitle(...args) as unknown,
    findActiveSuppression: (...args: unknown[]) => findActiveSuppression(...args) as unknown,
    reactivateSuppression: (...args: unknown[]) => reactivateSuppression(...args) as unknown,
    createSuppression: (...args: unknown[]) => createSuppression(...args) as unknown,
  };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-suppress-unit';

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

const TITLE = {
  id: 't-0001',
  workIdentity: 'tmdb:movie:603',
  rawExtractedText: null,
  tmdbName: 'The Matrix',
  tmdbReleaseYear: 1999,
  tmdbMediaType: 'movie',
  tmdbPosterPath: '/p.jpg',
};

interface SuppressBody {
  suppressionId: string;
  workIdentity: string;
  alreadySuppressed: boolean;
}

let server: Server;
let app: Express;
let origin: string;

const post = (titleId = 't-0001'): Promise<Response> =>
  fetch(`${origin}/api/titles/${titleId}/suppress`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    body: '{}',
  });

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;

  findTitle.mockResolvedValue(TITLE);
  findActiveSuppression.mockResolvedValue(null);
  reactivateSuppression.mockResolvedValue({ count: 0 });
  createSuppression.mockResolvedValue({ id: 'supp:tmdb:movie:603' });

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/titles/:titleId/suppress — handler arms', () => {
  it('T-SUP-010g · first press · creates and reports alreadySuppressed false', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()) as SuppressBody).toEqual({
      suppressionId: 'supp:tmdb:movie:603',
      workIdentity: 'tmdb:movie:603',
      alreadySuppressed: false,
    });

    expect(createSuppression).toHaveBeenCalledTimes(1);
    const data = createSuppression.mock.calls[0]?.[1] as Record<string, unknown>;
    // The snapshot is written at create time, not read at display time.
    expect(data['id']).toBe('supp:tmdb:movie:603');
    expect(data['workIdentity']).toBe('tmdb:movie:603');
    expect(data['displayName']).toBe('The Matrix');
    // ⚠ The title id is in scope at this call site and must not reach the row.
    expect(JSON.stringify(data)).not.toContain('t-0001');
  });

  it('T-SUP-013d · already active · writes NOTHING at all', async () => {
    findActiveSuppression.mockResolvedValue({ id: 'supp:tmdb:movie:603', active: true });

    const res = await post();
    expect(res.status).toBe(200);
    expect(((await res.json()) as SuppressBody).alreadySuppressed).toBe(true);

    // Not "writes the same values" — writes nothing. A no-op update would
    // still touch `suppressedAt` under any future default or trigger.
    expect(reactivateSuppression).not.toHaveBeenCalled();
    expect(createSuppression).not.toHaveBeenCalled();
  });

  it('T-SUP-013e · previously lifted · re-arms rather than creating a second row', async () => {
    reactivateSuppression.mockResolvedValue({ count: 1 });

    const res = await post();
    expect(res.status).toBe(200);
    expect(((await res.json()) as SuppressBody).alreadySuppressed).toBe(false);

    expect(reactivateSuppression).toHaveBeenCalledTimes(1);
    expect(createSuppression).not.toHaveBeenCalled();
  });

  it('T-SUP-013f · concurrent press · a unique violation is success, not a 500', async () => {
    // The arm a real database cannot be made to take on demand: both presses
    // miss the existence check, both insert, the loser hits the unique index.
    //
    // ⚠ A duck-typed `{ code: 'P2002' }` does NOT work here, and that is the
    // point: `isUniqueViolation` tests `instanceof
    // PrismaClientKnownRequestError` first. A hand-rolled stand-in would make
    // this test pass against a handler that never handles the real error.
    const { Prisma } = await import('@prisma/client');
    createSuppression.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'suppression_one_active' },
      }),
    );

    const res = await post();
    expect(res.status).toBe(200);
    expect(((await res.json()) as SuppressBody).alreadySuppressed).toBe(true);
  });

  it('T-SUP-013h · the raw SQL Server error number is also recognised', async () => {
    // 2627/2601 reach the handler unnormalised from the raw-SQL paths.
    // ⚠ NOT PostgreSQL's 23505 — that appears in superseded spec revisions
    // (ADR-0005 Rev 3) and would silently never match.
    createSuppression.mockRejectedValue(Object.assign(new Error('duplicate'), { number: 2627 }));

    const res = await post();
    expect(res.status).toBe(200);
    expect(((await res.json()) as SuppressBody).alreadySuppressed).toBe(true);
  });

  it('T-SUP-013g · a NON-unique store failure is still a 500', async () => {
    // The other half of the arm above, and the reason it is written as a
    // narrow `isUniqueViolation` check rather than a bare catch: swallowing
    // every insert failure would report a suppression the store never took.
    createSuppression.mockRejectedValue(new Error('connection reset'));

    const res = await post();
    expect(res.status).toBe(500);
  });

  it('T-SUP-001i · a missing title is 404 and touches no suppression', async () => {
    findTitle.mockResolvedValue(null);

    const res = await post('no-such-title');
    expect(res.status).toBe(404);
    expect(findActiveSuppression).not.toHaveBeenCalled();
    expect(createSuppression).not.toHaveBeenCalled();
  });

  it('T-SUP-001j · the lookup is owner-scoped, never from the path', async () => {
    await post();
    // `findTitle(ownerId, titleId)` — the owner comes from the auth chain and
    // the id from the path, never the reverse and never from a body.
    const [ownerArg, idArg] = findTitle.mock.calls[0] ?? [];
    expect(idArg).toBe('t-0001');
    expect(ownerArg).not.toBe('t-0001');
    expect(typeof ownerArg).toBe('string');
    expect(String(ownerArg).length).toBeGreaterThan(0);
  });
});
