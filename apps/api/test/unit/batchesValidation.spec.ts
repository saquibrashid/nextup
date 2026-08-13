/**
 * TASK-048 — the parts of `POST /api/batches` that never touch the store.
 *
 * Validation runs BEFORE the open-batch lookup, so every rejection path is
 * reachable without a database. That is what makes these unit tests rather
 * than a second copy of the integration suite — and it matters practically:
 * coverage is measured on the `unit` project, which CI runs with no store at
 * all, so behaviour proven only in `test/integration` counts as uncovered.
 *
 * The store-dependent halves (the 201 and the 409) live in
 * `test/integration/batches.spec.ts`, where a real SQL Server can enforce the
 * one-open-batch property that a stub could only agree with.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { JSON_BODY_LIMIT, mapBodyParserError } from '../../src/routes/index.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-validation';

const principalHeader = (): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: OID, val: SUBJECT },
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let app: Express;
let origin: string;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const post = (body: string): Promise<Response> =>
  fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader() },
    body,
  });

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
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

describe('T-BATCH-010 the batch request is validated before the store is touched', () => {
  it('T-BATCH-010h: an omitted mode is refused without a store', async () => {
    // No database is configured in this project. Reaching the store at all
    // would surface as a connection error rather than a 400, so a clean 400
    // is itself the evidence that validation precedes the lookup.
    const res = await post(JSON.stringify({ service: 'netflix' }));
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details['field']).toBe('mode');
    expect(body.error.details['permitted']).toEqual(['append-only', 'full-update']);
  });

  it('T-BATCH-010i: an omitted service is refused before the mode is read', async () => {
    const res = await post(JSON.stringify({}));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.details['field']).toBe('service');
  });

  it('T-BATCH-010j: a non-string service is refused', async () => {
    // `typeof value !== 'string'` is the guard that stops an array or object
    // reaching `includes`, where a crafted value could otherwise be coerced.
    const res = await post(JSON.stringify({ service: ['netflix'], mode: 'append-only' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.details['field']).toBe('service');
  });

  it('T-BATCH-010k: an empty body is a 400, not a crash', async () => {
    const res = await post('');
    expect(res.status).toBe(400);
  });
});

describe('T-BATCH-010 body-parser failures are domain errors', () => {
  const capture = (thrown: unknown): unknown => {
    let captured: unknown;
    mapBodyParserError(
      thrown,
      {} as never,
      {} as never,
      ((e: unknown) => {
        captured = e;
      }) as never,
    );
    return captured;
  };

  it('T-BATCH-010l: an oversized body maps to PAYLOAD_TOO_LARGE, not a 500', () => {
    const mapped = capture({ type: 'entity.too.large' }) as {
      code: string;
      httpStatus: number;
      details: Record<string, unknown>;
    };
    expect(mapped.code).toBe('PAYLOAD_TOO_LARGE');
    expect(mapped.httpStatus).toBe(413);
    expect(mapped.details['limit']).toBe(JSON_BODY_LIMIT);
  });

  it('T-BATCH-010m: an unsupported encoding maps to VALIDATION_FAILED', () => {
    const mapped = capture({ type: 'encoding.unsupported' }) as { httpStatus: number };
    expect(mapped.httpStatus).toBe(400);
  });

  it('T-BATCH-010n: an unrelated error passes through untouched', () => {
    // The mapper must not claim errors it does not understand: swallowing a
    // genuine fault into a 400 would hide a real failure behind a message
    // telling the owner their request was malformed when it was not.
    const original = new Error('something else entirely');
    expect(capture(original)).toBe(original);
  });
});
