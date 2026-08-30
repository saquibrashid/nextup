/**
 * TASK-116 — parse a 409 `BATCH_NOT_CREATES_ONLY` envelope's `details` into the
 * shared `UndoRefusalDetails` shape the panel renders.
 *
 * ⚠ **VALIDATED, NEVER CAST.** `ApiError.details` is `Record<string, unknown>`
 * — the untyped boundary the server projects its response through. A blind cast
 * would put `undefined.map` into the panel the first time a field is missing or
 * an older build answers, on the one screen whose job is to enumerate exactly
 * what an undo would touch. Every field is read defensively; a malformed group
 * degrades to empty rather than throwing, because a refusal that renders a
 * short list is still safer than a refusal that renders a crash.
 *
 * ⚠ `truncated` is pinned to the literal `false` on the way out. The API never
 * truncates (`packages/domain/src/undoRefusal.ts`); the panel paginates
 * client-side, so there is no honest wire value other than `false`.
 */

import type {
  UndoRefusalCreatedEntry,
  UndoRefusalCurrentState,
  UndoRefusalDetails,
  UndoRefusalModifiedEntry,
  UndoRefusalReason,
  UndoRefusalRemovedEntry,
} from '@nextup/domain';

import { ApiError } from './apiClient';

/** The 409 code that carries a §8.4 refusal body (`apps/api/src/services/batchUndo.ts`). */
export const BATCH_NOT_CREATES_ONLY = 'BATCH_NOT_CREATES_ONLY';

/** Is this error the enumerated undo refusal, rather than a lifecycle 409? */
export function isUndoRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && error.code === BATCH_NOT_CREATES_ONLY;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const REASONS: readonly UndoRefusalReason[] = [
  'modified-or-removed',
  'later-owner-edits',
  'provenance-unavailable',
];

function reasonOf(value: unknown): UndoRefusalReason {
  return REASONS.includes(value as UndoRefusalReason)
    ? (value as UndoRefusalReason)
    : 'modified-or-removed';
}

const STATES: readonly UndoRefusalCurrentState[] = ['active', 'removed', 'suppressed'];

function stateOf(value: unknown): UndoRefusalCurrentState {
  return STATES.includes(value as UndoRefusalCurrentState)
    ? (value as UndoRefusalCurrentState)
    : 'active';
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
      )
    : [];
}

function createdEntry(row: Record<string, unknown>): UndoRefusalCreatedEntry {
  return {
    titleId: str(row['titleId']),
    name: str(row['name']),
    releaseYear: numOrNull(row['releaseYear']),
    posterPath: strOrNull(row['posterPath']),
    currentState: stateOf(row['currentState']),
    remedy: 'not-interested',
    remedyHref: str(row['remedyHref']),
  };
}

function modifiedEntry(row: Record<string, unknown>): UndoRefusalModifiedEntry {
  return {
    titleId: str(row['titleId']),
    name: str(row['name']),
    releaseYear: numOrNull(row['releaseYear']),
    posterPath: strOrNull(row['posterPath']),
    attr: str(row['attr']),
    before: row['before'],
    currentState: stateOf(row['currentState']),
    remedy: 'fix-match',
    remedyHref: str(row['remedyHref']),
  };
}

function removedEntry(row: Record<string, unknown>): UndoRefusalRemovedEntry {
  return {
    titleId: str(row['titleId']),
    listingId: str(row['listingId']),
    name: str(row['name']),
    releaseYear: numOrNull(row['releaseYear']),
    posterPath: strOrNull(row['posterPath']),
    currentState: stateOf(row['currentState']),
    remedy: 'restore',
    remedyHref: str(row['remedyHref']),
  };
}

/** Coerce an `ApiError.details` payload into a renderable `UndoRefusalDetails`. */
export function parseUndoRefusalDetails(details: Record<string, unknown>): UndoRefusalDetails {
  return {
    batchId: str(details['batchId']),
    reason: reasonOf(details['reason']),
    created: asRecords(details['created']).map(createdEntry),
    modified: asRecords(details['modified']).map(modifiedEntry),
    removed: asRecords(details['removed']).map(removedEntry),
    truncated: false,
  };
}
