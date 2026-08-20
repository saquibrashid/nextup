/**
 * `GET /api/suppressions` and `POST /api/suppressions/:id/unsuppress` — the
 * handler arms, over real HTTP with the repository mocked (TASK-106,
 * `specs/api.md` §6.7/§6.8, US-029).
 *
 * The store-level properties — that nothing is deleted, that the filtered
 * unique index frees the identity — belong to `integration/suppressions.spec.ts`
 * and are asserted there against a real SQL Server. What is proven here is
 * what the HANDLER does: that it shapes a row the suppressed view can render
 * WITHOUT a title, that it reports `restoredAnything: false` unconditionally,
 * and that a second press is a 200 rather than a 404.
 *
 * It also carries the coverage: `npm run coverage` excludes the integration
 * project.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listActiveSuppressions = vi.fn();
const findSuppression = vi.fn();
const deactivateSuppression = vi.fn();

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    listActiveSuppressions: (...args: unknown[]) => listActiveSuppressions(...args) as unknown,
    findSuppression: (...args: unknown[]) => findSuppression(...args) as unknown,
    deactivateSuppression: (...args: unknown[]) => deactivateSuppression(...args) as unknown,
  };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');
const { identityStabilityOf, toSuppressionItem } = await import('../../src/routes/suppressions.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-suppressions-list';

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

const MATCHED = {
  id: 'supp:tmdb:movie:603',
  ownerId: 'owner-abc',
  workIdentity: 'tmdb:movie:603',
  active: true,
  suppressedAt: new Date('2026-05-02T11:00:00.000Z'),
  unsuppressedAt: null,
  migratedFrom: 'tmdb:movie:999',
  displayName: 'The Matrix',
  displayReleaseYear: 1999,
  displayMediaType: 'movie',
  displayPosterPath: '/p.jpg',
};

const UNMATCHED = {
  ...MATCHED,
  id: 'supp:unmatched:9f2c1a7b4e0d5c83',
  workIdentity: 'unmatched:9f2c1a7b4e0d5c83',
  suppressedAt: new Date('2026-05-01T11:00:00.000Z'),
  migratedFrom: null,
  displayName: 'the mtrix',
  displayReleaseYear: null,
  displayMediaType: null,
  displayPosterPath: null,
};

interface ListBody {
  items: {
    suppressionId: string;
    workIdentity: string;
    suppressedAt: string;
    identityStability: string;
    displaySnapshot: Record<string, unknown>;
    unsuppressHref: string;
  }[];
}

interface UnsuppressBody {
  suppressionId: string;
  active: boolean;
  restoredAnything: boolean;
}

interface ErrorBody {
  error: { code: string; message: string };
}

let server: Server;
let app: Express;
let origin: string;

const list = (): Promise<Response> =>
  fetch(`${origin}/api/suppressions`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

const unsuppress = (id = 'supp:tmdb:movie:603'): Promise<Response> =>
  fetch(`${origin}/api/suppressions/${encodeURIComponent(id)}/unsuppress`, {
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

  listActiveSuppressions.mockResolvedValue([MATCHED, UNMATCHED]);
  findSuppression.mockResolvedValue(MATCHED);
  deactivateSuppression.mockResolvedValue({ count: 1 });

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

describe('T-SUP-020 · US-029 AC-1 · every active suppression lists with a renderable snapshot', () => {
  it('T-SUP-020a · each item carries the frozen snapshot, not a title join', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as ListBody;

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      suppressionId: 'supp:tmdb:movie:603',
      workIdentity: 'tmdb:movie:603',
      suppressedAt: '2026-05-02T11:00:00.000Z',
      identityStability: 'stable',
      displaySnapshot: {
        name: 'The Matrix',
        releaseYear: 1999,
        mediaType: 'movie',
        posterPath: '/p.jpg',
      },
      unsuppressHref: '/api/suppressions/supp%3Atmdb%3Amovie%3A603/unsuppress',
    });
  });

  it('T-SUP-020b · a row renders with NO metadata at all', async () => {
    // US-029 AC-1's real case: an `unmatched:*` suppression that never had
    // TMDB metadata, on a title that may since have been removed. A view that
    // needed a poster or a year would show an empty row for a decision the
    // owner definitely made.
    const { items } = (await (await list()).json()) as ListBody;
    expect(items[1]?.displaySnapshot).toEqual({
      name: 'the mtrix',
      releaseYear: null,
      mediaType: null,
      posterPath: null,
    });
    expect(items[1]?.suppressionId).toBe('supp:unmatched:9f2c1a7b4e0d5c83');
  });

  it('T-SUP-020c · an unmatched identity is flagged text-derived', () => {
    // `ui.md` §7 renders a caveat for exactly this row — "if a future
    // screenshot reads slightly differently, it may come back" — and it can
    // only do so if the API says which kind of key it is.
    expect(identityStabilityOf('unmatched:9f2c1a7b4e0d5c83')).toBe('text-derived');
    expect(identityStabilityOf('tmdb:movie:603')).toBe('stable');
    expect(identityStabilityOf('tmdb:tv:1396')).toBe('stable');
  });

  it('T-SUP-020d · the response is shaped field by field, never spread', async () => {
    // `migratedFrom` — the PREVIOUS work identity of a fix-matched title — is
    // on the row and has no business in a response. Asserted against the RAW
    // body, because the leak guarded against is a future `...row`.
    const raw = await (await list()).text();
    expect(raw).not.toContain('migratedFrom');
    expect(raw).not.toContain('tmdb:movie:999');
    expect(raw).not.toContain('ownerId');
    expect(raw).not.toContain('owner-abc');
  });

  it('T-SUP-020e · only ACTIVE suppressions are read', async () => {
    // The lifted ones are history, not a list of things the owner is still
    // ignoring. The filter lives in the repository read, so the assertion is
    // that this route uses that read and does not re-implement it.
    await list();
    expect(listActiveSuppressions).toHaveBeenCalledTimes(1);
    const [ownerArg] = listActiveSuppressions.mock.calls[0] ?? [];
    expect(typeof ownerArg).toBe('string');
  });

  it('T-SUP-020f · an empty list is 200 with items: [], not 404', async () => {
    // The empty state is a normal state (`ux-states.md` §8) and the view has
    // copy for it. A 404 would render as an error.
    listActiveSuppressions.mockResolvedValue([]);
    const res = await list();
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListBody).items).toEqual([]);
  });

  it('T-SUP-020g · the href round-trips back to this API', async () => {
    // `supp:tmdb:movie:603` contains colons; an unencoded href would still
    // route by accident here and break on any id that ever contains a slash.
    const { items } = (await (await list()).json()) as ListBody;
    const href = items[0]?.unsuppressHref ?? '';
    findSuppression.mockResolvedValue(MATCHED);

    const res = await fetch(`${origin}${href}`, {
      method: 'POST',
      headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(findSuppression.mock.calls[0]?.[1]).toBe('supp:tmdb:movie:603');
  });
});

describe('T-SUP-021 · US-029 AC-2/AC-4 · un-suppress deactivates and deletes nothing', () => {
  it('T-SUP-021a · 200 with active false and restoredAnything false', async () => {
    const res = await unsuppress();
    expect(res.status).toBe(200);
    expect((await res.json()) as UnsuppressBody).toEqual({
      suppressionId: 'supp:tmdb:movie:603',
      active: false,
      restoredAnything: false,
    });
  });

  it('T-SUP-021b · the row is DEACTIVATED, never deleted (REQ-028)', async () => {
    await unsuppress();
    expect(deactivateSuppression).toHaveBeenCalledTimes(1);

    // Non-vacuity: proving "no delete was called" needs the delete to be
    // nameable. There is exactly one hard delete in this codebase and it is
    // not this one, so the assertion is that the repository was asked to
    // UPDATE and that an `unsuppressedAt` was supplied — the record of when
    // the owner changed their mind.
    const [ownerArg, identityArg, atArg] = deactivateSuppression.mock.calls[0] ?? [];
    expect(typeof ownerArg).toBe('string');
    expect(identityArg).toBe('tmdb:movie:603');
    expect(atArg).toBeInstanceOf(Date);
  });

  it('T-SUP-021c · keyed on the WORK IDENTITY read from the row, not on the path id', async () => {
    // Product invariant 1. The route takes a suppression id because that is
    // what the client has; the store is keyed on identity. Resolving one to
    // the other is the whole job, and a handler that passed the path string
    // through would deactivate nothing while answering 200.
    await unsuppress();
    expect(deactivateSuppression.mock.calls[0]?.[1]).toBe('tmdb:movie:603');
    expect(deactivateSuppression.mock.calls[0]?.[1]).not.toBe('supp:tmdb:movie:603');
  });

  it('T-SUP-021d · restoredAnything is false even when rows WERE deactivated', async () => {
    // ⚠ The field is not a count and must never become one. It reports that
    // un-suppression restores no LISTING — invariant 7, restore is an explicit
    // owner action. Computing it from the update count would make it true one
    // day and silently turn an honest sentence in the UI into a false one.
    deactivateSuppression.mockResolvedValue({ count: 1 });
    expect(((await (await unsuppress()).json()) as UnsuppressBody).restoredAnything).toBe(false);

    deactivateSuppression.mockResolvedValue({ count: 0 });
    expect(((await (await unsuppress()).json()) as UnsuppressBody).restoredAnything).toBe(false);
  });

  it('T-SUP-021e · a second press is 200, not 404 — idempotent', async () => {
    // The owner is looking at a stale page. The outcome they are asking for
    // has already happened; telling them the record does not exist would be
    // false as well as alarming.
    findSuppression.mockResolvedValue({ ...MATCHED, active: false });
    deactivateSuppression.mockResolvedValue({ count: 0 });

    const res = await unsuppress();
    expect(res.status).toBe(200);
    expect(((await res.json()) as UnsuppressBody).active).toBe(false);
  });

  it('T-SUP-021f · the lookup is NOT filtered on active', async () => {
    // Non-vacuity for the arm above: a `findActiveSuppression` here would make
    // the second press a 404 and this suite would still pass on every other
    // row. The assertion is that the route calls the unfiltered read.
    await unsuppress();
    expect(findSuppression).toHaveBeenCalledTimes(1);
  });

  it('T-SUP-021g · an unknown id is 404 and writes nothing', async () => {
    findSuppression.mockResolvedValue(null);

    const res = await unsuppress('supp:tmdb:movie:1');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
    expect(deactivateSuppression).not.toHaveBeenCalled();
  });

  it('T-SUP-021h · another owner’s suppression is 404, never 403', async () => {
    // 403 would confirm it exists. `findSuppression` is owner-scoped, so a
    // foreign id and a nonexistent id are the same lookup.
    findSuppression.mockResolvedValue(null);
    expect((await unsuppress()).status).toBe(404);
  });

  it('T-SUP-021i · an anonymous caller reaches neither read nor write', async () => {
    const res = await fetch(`${origin}/api/suppressions/x/unsuppress`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(findSuppression).not.toHaveBeenCalled();
    expect(deactivateSuppression).not.toHaveBeenCalled();
  });
});

describe('toSuppressionItem · the shaping in isolation', () => {
  it('T-SUP-020h · every stored display column reaches the snapshot', () => {
    // A field-by-field shaping silently drops a column when one is added. The
    // symptom is a poster that never renders, with nothing in any log.
    const item = toSuppressionItem(UNMATCHED);
    expect(Object.keys(item.displaySnapshot).sort()).toEqual([
      'mediaType',
      'name',
      'posterPath',
      'releaseYear',
    ]);
    expect(item.identityStability).toBe('text-derived');
    expect(item.suppressedAt).toBe('2026-05-01T11:00:00.000Z');
  });
});
