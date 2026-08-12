import { describe, expect, it, vi } from 'vitest';

import { ERROR_CODES, isErrorCode } from '@nextup/domain';

import { AppError, mapConstraintViolation } from '../../src/errors/AppError.js';
import {
  INTERNAL_ERROR_MESSAGE,
  assertErrorCode,
  buildEnvelope,
  errorEnvelope,
  redactMessage,
  toAppError,
} from '../../src/middleware/errorEnvelope.js';

// TASK-022 — `specs/api.md` §2 and §8.

function fakeRes() {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

/** Asserts the envelope shape from `specs/api.md` §2, whatever the code. */
function expectEnvelope(body: unknown) {
  expect(body).toMatchObject({
    error: {
      code: expect.any(String),
      message: expect.any(String),
      details: expect.any(Object),
    },
  });
  const { error } = body as { error: { code: string; details: unknown } };
  expect(isErrorCode(error.code)).toBe(true);
  // "ALWAYS an object, may be empty" — an array or a string would satisfy a
  // loose typeof check and break every client that reads a field from it.
  expect(Array.isArray(error.details)).toBe(false);
  expect(Object.keys(Object(error.details)).length).toBeGreaterThanOrEqual(0);
}

describe('T-API-002 every error response uses the one envelope', () => {
  it('T-API-002a: a thrown AppError becomes its envelope', () => {
    const res = fakeRes();
    errorEnvelope(
      new AppError('NOT_FOUND', 404, 'That batch does not exist.', { batchId: 'x' }),
      {} as never,
      res as never,
      vi.fn() as never,
    );
    expect(res.statusCode).toBe(404);
    expectEnvelope(res.body);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'That batch does not exist.',
        details: { batchId: 'x' },
      },
    });
  });

  it('T-API-002b: details defaults to an empty object, never undefined', () => {
    const envelope = buildEnvelope(
      new AppError('NO_IMAGES', 400, 'Add a screenshot first.'),
      'cid',
    );
    expectEnvelope(envelope);
    expect(envelope.error.details).toEqual({});
  });

  it('T-API-002c: every code in the closed enumeration produces a valid envelope', () => {
    for (const code of ERROR_CODES) {
      const envelope = buildEnvelope(new AppError(code, 400, 'A safe sentence.'), 'cid');
      expectEnvelope(envelope);
      expect(envelope.error.code).toBe(code);
    }
  });

  it('T-API-002d: an unknown thrown value becomes 500 INTERNAL_ERROR', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const thrown of [new Error('boom'), 'a string', null, undefined, { weird: true }]) {
      const res = fakeRes();
      errorEnvelope(thrown, {} as never, res as never, vi.fn() as never);
      expect(res.statusCode).toBe(500);
      expectEnvelope(res.body);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
    }
    consoleError.mockRestore();
  });

  it('T-API-002e: a 5xx carries a correlationId and a 4xx does not', () => {
    // The id is what makes an intentionally opaque message diagnosable. On a
    // 4xx the message already says what to do, so an id is just noise.
    expect(buildEnvelope(new AppError('INTERNAL_ERROR', 500, 'x'), 'cid-1').error.details).toEqual({
      correlationId: 'cid-1',
    });
    expect(buildEnvelope(new AppError('NOT_FOUND', 404, 'x'), 'cid-1').error.details).toEqual({});
  });

  it('T-API-002f: the full error is logged server-side under that same id', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fakeRes();
    errorEnvelope(
      new Error('the real cause: SELECT * FROM title'),
      {} as never,
      res as never,
      vi.fn() as never,
    );

    const logged = JSON.parse(consoleError.mock.calls[0]![0] as string) as {
      correlationId: string;
      stack?: string;
    };
    const body = res.body as { error: { details: { correlationId: string } } };
    expect(logged.correlationId).toBe(body.error.details.correlationId);
    expect(logged.stack).toContain('the real cause');
    consoleError.mockRestore();
  });

  it('T-API-002g: an error after headers are sent is handed back to Express', () => {
    // Rewriting a response already on the wire is impossible; swallowing it
    // would leave the connection hanging.
    const res = fakeRes();
    res.headersSent = true;
    const next = vi.fn();
    const thrown = new AppError('NOT_FOUND', 404, 'x');
    errorEnvelope(thrown, {} as never, res as never, next as never);
    expect(next).toHaveBeenCalledWith(thrown);
    expect(res.statusCode).toBe(0);
  });

  it('T-API-002h: the enumeration is closed at the boundary too', () => {
    expect(assertErrorCode('NOT_FOUND')).toBe('NOT_FOUND');
    expect(() => assertErrorCode('SOMETHING_NEW')).toThrow(/closed error-code enumeration/);
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('nope')).toBe(false);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('T-SEC-007 an error message never leaks internals', () => {
  it('T-SEC-007a: a SQL Server uniqueness violation becomes a domain code', () => {
    // 2627/2601 carry the constraint name AND the duplicated key value — which
    // is owner data. The driver string must not survive the mapping.
    const driverError = {
      number: 2627,
      message:
        "Violation of UNIQUE KEY constraint 'title_one_active_per_work'. Cannot insert duplicate key in object 'dbo.title'. The duplicate key value is (o_9f2c1a7b, tmdb:movie:438631).",
    };

    const mapped = mapConstraintViolation(driverError);
    expect(mapped).not.toBeNull();
    expect(mapped!.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(mapped!.httpStatus).toBe(409);
    expect(mapped!.message).not.toContain('tmdb:movie:438631');
    expect(mapped!.message).not.toContain('UNIQUE KEY');
    expect(mapped!.message).not.toContain('dbo.title');
  });

  it('T-SEC-007b: the same violation through the middleware leaks nothing', () => {
    const res = fakeRes();
    errorEnvelope(
      {
        number: 2601,
        message:
          "Cannot insert duplicate key row in object 'dbo.service_listing' with unique index 'listing_one_per_service'. The duplicate key value is (01J9, netflix).",
      },
      {} as never,
      res as never,
      vi.fn() as never,
    );
    expect(res.statusCode).toBe(409);
    expectEnvelope(res.body);
    const message = (res.body as { error: { message: string } }).error.message;
    expect(message).not.toMatch(/duplicate key|dbo\.|unique index/i);
  });

  it('T-SEC-007c: an unrecognised driver error does not fall through as its own text', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fakeRes();
    errorEnvelope(
      { number: 4060, message: "Cannot open database 'nextup' requested by the login." },
      {} as never,
      res as never,
      vi.fn() as never,
    );
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: { message: string } }).error.message).toBe(INTERNAL_ERROR_MESSAGE);
    consoleError.mockRestore();
  });

  it('T-SEC-007d: a 2627 with an unknown constraint name is not silently mapped', () => {
    // Guessing a domain code from an unrecognised constraint would tell the
    // owner the wrong remedy with full confidence.
    expect(
      mapConstraintViolation({ number: 2627, message: "constraint 'some_future_index'" }),
    ).toBeNull();
    expect(
      mapConstraintViolation({ number: 50000, message: 'title_one_active_per_work' }),
    ).toBeNull();
    for (const notAnError of [null, undefined, 'string', 42, {}]) {
      expect(mapConstraintViolation(notAnError)).toBeNull();
    }
  });

  it('T-SEC-007e: the redaction backstop catches leaked internals in any message', () => {
    const leaks = [
      'at handler (/app/dist/routes/titles.js:42:11)',
      'SELECT id FROM title WHERE owner_id = @p0',
      'UPDATE title SET state = @p1',
      'Server=tcp:nextup.database.windows.net;Password=hunter2',
      'https://nextupstore.blob.core.windows.net/screenshots/o_9f/img.png',
      'could not resolve tmdb:movie:438631',
      "Violation of UNIQUE KEY constraint 'x'",
      'TediousError: connection lost',
    ];
    for (const leak of leaks) {
      expect(redactMessage(leak), leak).toBe(INTERNAL_ERROR_MESSAGE);
    }
  });

  it('T-SEC-007f: the backstop does not mangle legitimate owner-facing copy', () => {
    // A redaction that fires on ordinary sentences would replace every helpful
    // message with the generic one — a silent loss of every remedy.
    const safe = [
      'That batch has already been applied. Undo it first.',
      'Add at least one screenshot before submitting.',
      'This image is no longer available. Screenshots are kept for 30 days.',
      'We could not read that file. Try re-taking the screenshot.',
      INTERNAL_ERROR_MESSAGE,
    ];
    for (const message of safe) {
      expect(redactMessage(message), message).toBe(message);
    }
  });

  it('T-SEC-007g: an AppError raised by our own code is passed through unchanged', () => {
    const original = new AppError('BATCH_NOT_DRAFT', 409, 'That batch is no longer a draft.');
    expect(toAppError(original)).toBe(original);
  });
});
