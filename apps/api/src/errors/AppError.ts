// `AppError` — the only way a handler reports a failure (`specs/api.md` §2).
//
// Handlers `throw` this; `middleware/errorEnvelope.ts` is the only place it
// becomes a response. A handler that calls `res.status(...).json(...)` itself
// bypasses the envelope, the redaction and the correlation id, and produces a
// body no client knows how to read.

import { type ErrorCode } from '@nextup/domain';

/** Route-specific context. Always an object, may be empty — never a string. */
export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, httpStatus: number, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

// ── Constraint-violation mapping (`specs/api.md` §2, R4) ────────────────────
//
// Azure SQL raises 2627 (unique constraint) / 2601 (unique index) with the
// CONSTRAINT NAME and THE DUPLICATED KEY VALUE inside the driver message. That
// value is owner data — a title name, a workIdentity hash — so the driver
// string must never reach `message`. We map the constraint name we recognise
// to a domain code and discard everything else the driver said.

/** SQL Server error numbers for a uniqueness violation. */
export const SQL_UNIQUE_VIOLATION_NUMBERS: readonly number[] = [2627, 2601];

interface MappedConstraint {
  code: ErrorCode;
  status: number;
  message: string;
}

const CONSTRAINT_TO_CODE: ReadonlyMap<string, MappedConstraint> = new Map([
  [
    'title_one_active_per_work',
    {
      code: 'DUPLICATE_WORK_IDENTITY',
      status: 409,
      message: 'That work is already on your list. Nothing was changed.',
    },
  ],
  [
    'listing_one_per_service',
    {
      code: 'DUPLICATE_WORK_IDENTITY',
      status: 409,
      message: 'That title is already saved on that service. Nothing was changed.',
    },
  ],
  [
    'suppression_one_active',
    {
      code: 'WORK_SUPPRESSED',
      status: 409,
      message: 'That work is already marked as not interested. Nothing was changed.',
    },
  ],
]);

interface DriverErrorShape {
  number?: unknown;
  message?: unknown;
}

/**
 * Turn a database driver error into an `AppError`, or return `null` when it is
 * not a uniqueness violation we recognise — the caller then reports
 * `INTERNAL_ERROR`, which is the safe default, because an unrecognised driver
 * error is not something we can describe to the owner accurately.
 *
 * The constraint name is matched against the driver's message, but **no part of
 * that message is ever propagated**: only our own fixed sentence is.
 */
export function mapConstraintViolation(error: unknown): AppError | null {
  if (typeof error !== 'object' || error === null) return null;
  const { number, message } = error as DriverErrorShape;

  if (typeof number !== 'number' || !SQL_UNIQUE_VIOLATION_NUMBERS.includes(number)) return null;
  if (typeof message !== 'string') return null;

  for (const [constraint, mapped] of CONSTRAINT_TO_CODE) {
    if (message.includes(constraint)) {
      return new AppError(mapped.code, mapped.status, mapped.message, { constraint });
    }
  }
  return null;
}
