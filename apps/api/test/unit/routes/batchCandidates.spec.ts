/**
 * `PATCH /api/batches/:batchId/candidates/:candidateId` — the handler's
 * TMDB-outage seam, with the repository and TMDB client mocked (TASK-066,
 * `specs/api.md` §6.18, US-007 AC-5).
 *
 * This is not a duplicate of `test/integration/batchCandidates.spec.ts`. That
 * suite proves what the STORE does under a real 503 — that a rescued candidate
 * stays unmatched and the batch stays reviewable (`T-AI-017a`), which is the
 * swallow's job. This one proves what the HANDLER does when a
 * `TmdbUnavailableError` is NOT swallowed but reaches the route: it becomes
 * 502 `TMDB_UNAVAILABLE`, identically to `/tmdb/search`, never the generic 500
 * the error envelope gives an unrecognised throw.
 *
 * ⚠ **Why this route-level net is not dead code the integration suite already
 * covers.** `applyReclassify` is the only path here that reaches TMDB and it
 * swallows the outage by design, so in normal operation no TMDB error escapes
 * to the handler. The net exists because that swallow is one `return` away
 * from being removed by a well-meaning refactor that decides it is hiding
 * errors — and the only thing that then stands between the owner and an opaque
 * 500 mid-review during a routine TMDB outage is this mapping. These cases
 * inject the error at a non-swallowing seam so the mapping is REACHABLE and
 * provable without a database: the route's contract is "any escaping
 * `TmdbUnavailableError` is 502", and the seam it escaped from is irrelevant
 * to that contract.
 *
 * It also carries the coverage. `npm run coverage` excludes the integration
 * project, so a branch proven only there scores near zero against the
 * `apps/api/src/**` floor — which is a gate failure, not a formality.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUploadBatch = vi.fn();
const findExtractionCandidate = vi.fn();
const updateCandidateDisposition = vi.fn();
const searchMulti = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (...args: unknown[]) => findUploadBatch(...args) as unknown,
    findExtractionCandidate: (...args: unknown[]) => findExtractionCandidate(...args) as unknown,
    updateCandidateDisposition: (...args: unknown[]) =>
      updateCandidateDisposition(...args) as unknown,
  };
});

vi.mock('../../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/clients/tmdbClient.js')>();
  return {
    ...actual,
    // The error classes stay REAL: the shared mapper decides 502-vs-passthrough
    // with `instanceof`, and a stubbed class would make the check meaningless.
    TmdbClient: class {
      searchMulti = (...args: unknown[]) => searchMulti(...args) as unknown;
    },
  };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');
const { TmdbUnavailableError } = await import('../../../src/clients/tmdbClient.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-batch-candidates-unit';

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

const BATCH = { id: 'b-0001', service: 'netflix', status: 'in-review' };

const ROW = {
  id: 'c-0001',
  batchId: 'b-0001',
  rawText: 'Dune',
  inferredTitle: 'Dune',
  cleanupVerdict: 'title-candidate',
  resolvedWorkIdentity: null,
  correctedToTmdbId: null,
  reviewDisposition: 'pending',
};

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;

const patch = (body: unknown, batchId = 'b-0001', candidateId = 'c-0001'): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/candidates/${candidateId}`, {
    method: 'PATCH',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';

  findUploadBatch.mockResolvedValue(BATCH);
  findExtractionCandidate.mockResolvedValue(ROW);
  updateCandidateDisposition.mockResolvedValue(undefined);
  searchMulti.mockResolvedValue([]);

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  delete process.env['TMDB_API_KEY'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

describe('PATCH candidates — TMDB-outage mapping (§6.18)', () => {
  it('T-AI-017b · a TmdbUnavailableError reaching the handler is 502 TMDB_UNAVAILABLE, not 500', async () => {
    // Injected at a NON-swallowing seam: the disposition write. The route's
    // contract is "any escaping TmdbUnavailableError is 502", and the seam is
    // irrelevant to it — mirroring `/tmdb/search` (`T-TMDB-010q`).
    updateCandidateDisposition.mockRejectedValueOnce(
      new TmdbUnavailableError('boom https://api.themoviedb.org/3?api_key=SECRET', 503, true),
    );

    const res = await patch({ disposition: 'confirmed' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('TMDB_UNAVAILABLE');
    // ⚠ The upstream text never reaches the owner: a fetch failure message can
    // carry the request URL, and the TMDB URL carries the API key.
    expect(body.error.message).not.toContain('boom');
    expect(body.error.message).not.toContain('SECRET');
  });

  it('T-AI-017c · an unrelated failure on the same route stays 500 — the outage is not blanket-claimed', async () => {
    // THE DISCRIMINATOR. A handler that mapped every throw to 502 would tell
    // the owner TMDB is down when it is their own database — so a plain Error
    // must fall through the shared mapper's `null` arm to the generic 500.
    updateCandidateDisposition.mockRejectedValueOnce(new Error('the database is on fire'));

    const res = await patch({ disposition: 'confirmed' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.code).not.toBe('TMDB_UNAVAILABLE');
  });

  it('T-AI-017d · the reclassify swallow is intact: an outage during a rescue is still 200', async () => {
    // Regression guard for invariant 2 at the unit level. `applyReclassify`
    // swallows the outage so the verdict flip survives and the batch stays
    // reviewable; deleting that swallow would let the net turn this into a 502
    // and the assertion below would fail. `T-AI-017a` proves the store-side
    // effect against a real database.
    searchMulti.mockRejectedValueOnce(new TmdbUnavailableError('down', 503, true));

    const res = await patch({ reclassifyAsTitle: true });
    expect(res.status).toBe(200);
    // The TMDB call was reached and threw — the 200 is the swallow, not a
    // vacuous pass from never calling out.
    expect(searchMulti).toHaveBeenCalledTimes(1);
  });
});
