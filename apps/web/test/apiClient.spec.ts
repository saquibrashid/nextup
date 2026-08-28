/**
 * `T-DATA-001`, `T-DATA-003`…`T-DATA-006`, `T-DATA-010` — the API client
 * (`specs/ui.md` §12, ADR-0012, TASK-175).
 *
 * ⚠ EVERY ASSERTION HERE GUARDS A FAILURE THAT LOOKS LIKE SUCCESS. A missing
 * `credentials` produces a redirect loop, not an error. A 401 rendered as a
 * failure shows a signed-in owner a retry button that can never work. An
 * automatic retry turns one visible failure into three invisible extra
 * requests against a single 0.25 vCPU replica. None of them throws.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  RefusedError,
  createApiClient,
  signInUrl,
  type ApiClientDeps,
} from '../src/lib/apiClient';

/**
 * ⚠ Resolved from `process.cwd()`, not from `import.meta.url`. The `web`
 * Vitest project runs in **jsdom**, where `import.meta.url` is an `http://`
 * URL and `fileURLToPath` throws — which fails the whole suite at import time
 * rather than failing an assertion, so it looks like a broken test file.
 */
const SRC_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web', 'src')
  : join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Builds a client whose every dependency is observable. */
function harness(responder: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; init: RequestInit }[] = [];
  const redirects: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), init: init ?? {} });
    return responder(String(input), init ?? {});
  });
  const deps: ApiClientDeps = {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onUnauthorized: (url) => redirects.push(url),
    currentPath: () => '/removed?service=max',
  };
  return { client: createApiClient(deps), calls, redirects, fetchImpl };
}

describe('T-DATA-001 — no component calls fetch directly', () => {
  it('T-DATA-001a: `fetch(` appears in apps/web/src only inside lib/apiClient.ts', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => !file.endsWith(join('lib', 'apiClient.ts')))
      .filter((file) => /(?<![\w.])fetch\s*\(/.test(readFileSync(file, 'utf8')));

    // ⚠ The check is over SOURCE, not over rendered components, so it holds
    // for screens that do not exist yet. A behavioural test could only cover
    // the screens someone remembered to write a test for.
    expect(offenders).toEqual([]);
  });
});

describe('T-DATA-003 — every method sends credentials', () => {
  it('T-DATA-003a: every exported client method sets credentials: same-origin', async () => {
    const { client, calls } = harness(() => jsonResponse(200, {}));
    const form = new FormData();

    // ⚠ ENUMERATED, not sampled. One hand-written method that forgets
    // `credentials` 401s on exactly one screen, and by T-DATA-004 that screen
    // then bounces to sign-in and back forever — which reads as a hung page,
    // not as a bug in one method.
    const invocations: Record<string, () => Promise<unknown>> = {
      getMe: () => client.getMe(),
      getTitles: () => client.getTitles('sort=date'),
      getTitle: () => client.getTitle('ttl_1'),
      getServiceState: () => client.getServiceState(),
      getSuppressions: () => client.getSuppressions(),
      suppressTitle: () => client.suppressTitle('ttl_1'),
      unsuppress: () => client.unsuppress('sup_1'),
      createBatch: () => client.createBatch('netflix', 'append'),
      listBatches: () => client.listBatches(),
      getBatch: () => client.getBatch('bat_1'),
      getReview: () => client.getReview('bat_1'),
      confirmAllCandidates: () => client.confirmAllCandidates('bat_1', 'additions'),
      closeBatch: () => client.closeBatch('bat_1', false),
      addBatchImages: () => client.addBatchImages('bat_1', form),
      removeBatchImage: () => client.removeBatchImage('bat_1', 'img_1'),
      submitBatch: () => client.submitBatch('bat_1'),
      discardBatch: () => client.discardBatch('bat_1'),
      undoBatch: () => client.undoBatch('bat_1'),
      undoRemovalGroup: () => client.undoRemovalGroup('grp_1'),
      restoreListing: () => client.restoreListing('lst_1'),
      lookupImdb: () => client.lookupImdb('The Matrix'),
    };

    // The client's surface and the list above must not drift apart.
    expect(Object.keys(invocations).sort()).toEqual(Object.keys(client).sort());

    for (const invoke of Object.values(invocations)) {
      await invoke();
    }

    expect(calls).toHaveLength(Object.keys(invocations).length);
    for (const call of calls) {
      expect(call.init.credentials).toBe('same-origin');
    }
  });

  it('T-DATA-003b: a multipart body carries no hand-set Content-Type', async () => {
    const { client, calls } = harness(() => jsonResponse(200, {}));
    await client.addBatchImages('bat_1', new FormData());
    // Setting it by hand omits the multipart boundary and the server rejects
    // every upload with a parse error that names neither cause.
    expect(calls[0]?.init.headers).toBeUndefined();
  });
});

describe('T-DATA-004 — 401 redirects, and is never an error screen', () => {
  it('T-DATA-004a: a 401 redirects to Easy Auth preserving the current path', async () => {
    const { client, redirects } = harness(() => jsonResponse(401, {}));

    await expect(client.getTitles('')).rejects.toBeInstanceOf(ApiError);

    expect(redirects).toEqual([
      '/.auth/login/aad?post_login_redirect_uri=%2Fremoved%3Fservice%3Dmax',
    ]);
  });

  it('T-DATA-004b: a 401 is not a RefusedError, so no refusal screen renders', async () => {
    const { client } = harness(() => jsonResponse(401, {}));
    await expect(client.getMe()).rejects.not.toBeInstanceOf(RefusedError);
  });

  it('T-DATA-004c: signInUrl encodes the path so a deep link survives expiry', () => {
    expect(signInUrl('/list?sort=date&dir=desc')).toBe(
      '/.auth/login/aad?post_login_redirect_uri=%2Flist%3Fsort%3Ddate%26dir%3Ddesc',
    );
  });
});

describe('T-DATA-005 — 403 is a refusal, distinct from a transport failure', () => {
  it('T-DATA-005a: a 403 raises RefusedError, not ApiError', async () => {
    const { client, redirects } = harness(() =>
      jsonResponse(403, {
        error: {
          code: 'FORBIDDEN',
          message: 'This account is not on the allow list.',
          details: {},
        },
      }),
    );

    await expect(client.getTitles('')).rejects.toBeInstanceOf(RefusedError);
    // ⚠ A refusal must NOT bounce to sign-in: the owner is already
    // authenticated, so the redirect would succeed and land back on the same
    // 403, forever.
    expect(redirects).toEqual([]);
  });

  it('T-DATA-005b: a transport failure is neither a refusal nor a 401', async () => {
    const { client, redirects } = harness(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(client.getTitles('')).rejects.toBeInstanceOf(TypeError);
    expect(redirects).toEqual([]);
  });
});

describe('T-DATA-006 — retry is the owner’s decision', () => {
  it('T-DATA-006a: a 500 issues exactly one request', async () => {
    const { client, fetchImpl } = harness(() =>
      jsonResponse(500, {
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: {} },
      }),
    );

    await expect(client.getTitles('')).rejects.toBeInstanceOf(ApiError);

    // ⚠ Production is ONE replica at 0.25 vCPU. An automatic retry converts a
    // struggling container into a harder-hit one at exactly the moment it is
    // least able to absorb it.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('T-DATA-006b: a transport failure issues exactly one request', async () => {
    const { client, fetchImpl } = harness(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(client.getMe()).rejects.toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('T-DATA-006c: no source file schedules a retry with a timer', () => {
    const source = readFileSync(join(SRC_ROOT, 'lib', 'apiClient.ts'), 'utf8');
    expect(source).not.toMatch(/setTimeout|setInterval|backoff/i);
  });
});

describe('T-DATA-010 — server error text is rendered verbatim', () => {
  it('T-DATA-010a: the envelope message survives unchanged', async () => {
    const message = 'That image is too large to open on this size of container (25.0 MP limit).';
    const { client } = harness(() =>
      jsonResponse(422, { error: { code: 'IMAGE_TOO_LARGE', message, details: { limit: 25 } } }),
    );

    // ⚠ A client-side table keyed on `code` is a second source of truth, and
    // it goes stale in the one message whose job is to state the current
    // limit — right after the owner up-sizes memory (§3.2a).
    await expect(client.submitBatch('bat_1')).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
      message,
      status: 422,
      details: { limit: 25 },
    });
  });

  it('T-DATA-010b: a refusal message is carried verbatim too', async () => {
    const message = 'nextup is set up for one person, and it is not this account.';
    const { client } = harness(() =>
      jsonResponse(403, { error: { code: 'FORBIDDEN', message, details: {} } }),
    );
    await expect(client.getMe()).rejects.toMatchObject({ message });
  });

  it('T-DATA-010c: a non-JSON error body degrades to the generic message, not a crash', async () => {
    const { client } = harness(() => new Response('<html>502</html>', { status: 502 }));
    await expect(client.getMe()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
    });
  });
});
