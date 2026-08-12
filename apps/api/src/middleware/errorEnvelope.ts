// The error envelope — `specs/api.md` §2. The ONE place an error becomes a
// response body.
//
// Mounted last: `requirePrincipal → requireAllowList → attachOwnerScope →
// routes → errorEnvelope` (`specs/security.md` §3, `T-SEC-005`).

import { randomUUID } from 'node:crypto';

import { type ErrorCode, isErrorCode } from '@nextup/domain';
import type { NextFunction, Request, Response } from 'express';

import { AppError, isAppError, mapConstraintViolation } from '../errors/AppError.js';

/** The wire shape. `details` is ALWAYS an object; it may be empty. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
}

export const INTERNAL_ERROR_MESSAGE = 'Something went wrong. Nothing was changed.';

/**
 * Substrings that must never appear in a `message` (`T-SEC-007`).
 *
 * These are the shapes a leak actually takes: a driver dumping SQL, a stack
 * trace, a connection string, a storage URL. The check is a backstop, not the
 * primary control — the primary control is that a driver-supplied string is
 * never assigned to `message` in the first place (see `mapConstraintViolation`).
 * A backstop is worth having because the leak is silent and permanent: it goes
 * to the owner's browser and, more importantly, into logs and screenshots.
 */
const FORBIDDEN_IN_MESSAGE: readonly RegExp[] = [
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/, // a stack frame
  /\bselect\b[\s\S]*\bfrom\b/i, // a SQL fragment
  /\binsert\s+into\b|\bupdate\b\s+\w+\s+\bset\b/i,
  /\b(?:Server|Data Source)=|Password=|AccountKey=/i, // a connection string
  /blob\.core\.windows\.net/i,
  /\b(?:tmdb|unmatched):[0-9a-z:]+/i, // a workIdentity
  /\bViolation of (?:UNIQUE KEY|PRIMARY KEY) constraint\b/i,
  /\bmssql\b|\bTediousError\b|\bPrismaClientKnownRequestError\b/i,
];

/** @returns the message, or the generic one when it looks like a leak. */
export function redactMessage(message: string): string {
  return FORBIDDEN_IN_MESSAGE.some((re) => re.test(message)) ? INTERNAL_ERROR_MESSAGE : message;
}

export function buildEnvelope(error: AppError, correlationId: string): ErrorEnvelope {
  const details = { ...error.details };
  // A correlation id on a 5xx is what makes an opaque message diagnosable: the
  // owner reports the id, the full error is in the log line under that id.
  if (error.httpStatus >= 500) {
    details['correlationId'] = correlationId;
  }
  return {
    error: {
      code: error.code,
      message: redactMessage(error.message),
      details,
    },
  };
}

/**
 * Normalise anything thrown into an `AppError`.
 *
 * Order matters. A recognised uniqueness violation becomes a domain 409 with
 * our own wording; everything else unrecognised becomes 500 `INTERNAL_ERROR`
 * with the fixed message — never the thrown error's own text, which for a
 * driver error carries the constraint name and the duplicated key VALUE.
 */
export function toAppError(thrown: unknown): AppError {
  if (isAppError(thrown)) return thrown;

  const mapped = mapConstraintViolation(thrown);
  if (mapped) return mapped;

  return new AppError('INTERNAL_ERROR', 500, INTERNAL_ERROR_MESSAGE);
}

export function errorEnvelope(
  thrown: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express cannot rewrite headers that are already on the wire; handing it
  // back is the only correct action and it will close the connection.
  if (res.headersSent) {
    next(thrown);
    return;
  }

  const error = toAppError(thrown);
  const correlationId = randomUUID();

  if (error.httpStatus >= 500) {
    // The FULL error goes to the log, keyed by the id the owner sees. This is
    // the counterpart to redaction: nothing is lost, it just does not travel
    // to the browser.
    console.error(
      JSON.stringify({
        level: 'error',
        correlationId,
        code: error.code,
        message: error instanceof Error ? error.message : String(error),
        stack: thrown instanceof Error ? thrown.stack : undefined,
      }),
    );
  }

  res.status(error.httpStatus).json(buildEnvelope(error, correlationId));
}

/**
 * A guard for the enumeration boundary. `AppError`'s constructor is typed, so
 * TypeScript already refuses an unknown code — this catches a code arriving as
 * an untyped string across a boundary the compiler cannot see.
 */
export function assertErrorCode(value: string): ErrorCode {
  if (!isErrorCode(value)) {
    throw new Error(`"${value}" is not a member of the closed error-code enumeration (api.md §8)`);
  }
  return value;
}
