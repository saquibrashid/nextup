import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findTitleDetail = vi.fn();
const findActiveSuppression = vi.fn();
const setWatchPreference = vi.fn();
const setCategoryOverride = vi.fn();
const lockTitleForWatchPreferences = vi.fn();
const tx = { transaction: true };

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/repository/ownerData.js')>()),
  findTitleDetail: (...args: unknown[]) => findTitleDetail(...args) as unknown,
  findActiveSuppression: (...args: unknown[]) => findActiveSuppression(...args) as unknown,
  setWatchPreference: (...args: unknown[]) => setWatchPreference(...args) as unknown,
  setCategoryOverride: (...args: unknown[]) => setCategoryOverride(...args) as unknown,
  lockTitleForWatchPreferences: (...args: unknown[]) =>
    lockTitleForWatchPreferences(...args) as unknown,
  runInTransaction: async (work: (value: unknown) => Promise<unknown>) => work(tx),
}));

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');

const subject = 'watch-unit-owner';
const principal = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: subject },
    ],
  }),
).toString('base64');

let server: Server;
let origin: string;
function patch(body: unknown) {
  return fetch(`${origin}/api/titles/title-1/watch-preferences`, {
    method: 'PATCH',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principal, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('T-CATEGORY-002 owner category mutation', () => {
  async function category(body: unknown) {
    return fetch(`${origin}/api/titles/title-1/category`, {
      method: 'PATCH',
      headers: { [CLIENT_PRINCIPAL_HEADER]: principal, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  it('T-CATEGORY-002d locks owned active identity and saves or clears only the category', async () => {
    expect((await category({ categoryOverride: 'comedy-show' })).status).toBe(200);
    expect(setCategoryOverride).toHaveBeenCalledWith(
      expect.any(String),
      'tmdb:movie:1',
      'comedy-show',
      tx,
    );
    expect(lockTitleForWatchPreferences).toHaveBeenCalledWith(expect.any(String), 'title-1', tx);
    expect((await category({ categoryOverride: null })).status).toBe(200);
    expect(setCategoryOverride).toHaveBeenLastCalledWith(
      expect.any(String),
      'tmdb:movie:1',
      null,
      tx,
    );
    expect(setWatchPreference).not.toHaveBeenCalled();
  });
  it('T-CATEGORY-002e rejects malformed, unavailable and suppressed titles without saving', async () => {
    expect((await category({})).status).toBe(400);
    findTitleDetail.mockResolvedValueOnce(null);
    expect((await category({ categoryOverride: null })).status).toBe(404);
    findTitleDetail.mockResolvedValueOnce({ state: 'removed', listings: [] });
    expect((await category({ categoryOverride: null })).status).toBe(404);
    findTitleDetail.mockResolvedValueOnce({ state: 'active', listings: [] });
    expect((await category({ categoryOverride: null })).status).toBe(404);
    findActiveSuppression.mockResolvedValueOnce({ id: 'blocked' });
    expect((await category({ categoryOverride: null })).status).toBe(409);
    expect(setCategoryOverride).not.toHaveBeenCalled();
  });
  it('T-CATEGORY-002f surfaces failed storage, never false success', async () => {
    setCategoryOverride.mockRejectedValueOnce(new Error('storage unavailable'));
    expect((await category({ categoryOverride: 'movie' })).status).toBe(500);
  });
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = subject;
  findTitleDetail.mockResolvedValue({
    id: 'title-1',
    workIdentity: 'tmdb:movie:1',
    state: 'active',
    listings: [{ state: 'active' }],
  });
  findActiveSuppression.mockResolvedValue(null);
  lockTitleForWatchPreferences.mockResolvedValue(undefined);
  setWatchPreference.mockResolvedValue({ watching: true, priority: 'someday' });
  await new Promise<void>((resolve) => {
    server = createApp({ webRoot: 'C:\\nonexistent-web-root' }).listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

describe('T-WATCH-001 preference mutation route', () => {
  it('T-WATCH-001k writes only the supplied fields, keyed by owned identity in one transaction', async () => {
    const response = await patch({ watching: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      titleId: 'title-1',
      watching: true,
      priority: 'someday',
    });
    expect(setWatchPreference).toHaveBeenCalledWith(
      expect.any(String),
      'tmdb:movie:1',
      { watching: true },
      tx,
    );
    expect(findTitleDetail).toHaveBeenCalledWith(expect.any(String), 'title-1', tx);
    expect(lockTitleForWatchPreferences).toHaveBeenCalledWith(expect.any(String), 'title-1', tx);
  });

  it('T-WATCH-001l checks owned visibility before parsing and refuses extra fields without a write', async () => {
    findTitleDetail.mockResolvedValueOnce(null);
    expect((await patch({})).status).toBe(404);
    findTitleDetail.mockResolvedValueOnce({ state: 'removed', listings: [] });
    expect((await patch({ watching: true })).status).toBe(404);
    findTitleDetail.mockResolvedValueOnce({ state: 'active', listings: [{ state: 'removed' }] });
    expect((await patch({ watching: true })).status).toBe(404);
    expect((await patch({ watching: true, extra: 1 })).status).toBe(400);
    expect(setWatchPreference).not.toHaveBeenCalled();
    expect(findActiveSuppression).not.toHaveBeenCalled();
  });

  it('T-WATCH-001m returns the established suppression refusal and does not mutate it', async () => {
    findActiveSuppression.mockResolvedValue({ id: 'supp-1' });
    const response = await patch({ watching: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'WORK_SUPPRESSED',
        details: {
          workIdentity: 'tmdb:movie:1',
          suppressionId: 'supp-1',
          unsuppressHref: '/api/suppressions/supp-1/unsuppress',
        },
      },
    });
    expect(setWatchPreference).not.toHaveBeenCalled();
  });

  it('T-WATCH-001n surfaces storage errors instead of reporting a successful preference update', async () => {
    setWatchPreference.mockRejectedValueOnce(new Error('storage failed'));
    const response = await patch({ priority: 'someday' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });
});
