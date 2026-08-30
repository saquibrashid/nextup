/**
 * TASK — the §9.7 undo SUCCESS payload and the §9.10 lifecycle refusal, the two
 * non-refusal outcomes of `POST /api/batches/:batchId/undo` the SPA must now
 * distinguish (`specs/ux-states.md` §9.7, §9.10).
 *
 * ⚠ **THE COUNTS ARE THE SERVER'S, NEVER INVENTED** (§9.7). The 200 body is the
 * service's `UndoResult` (`apps/api/src/services/batchUndo.ts`): `titlesDeleted`
 * is the "N titles" the owner is told about and `listingsRemoved` is the "M
 * service entries". The web client types the response `unknown`, so both are
 * read defensively here rather than cast — a missing field degrades to 0, never
 * to `undefined` rendered as a number.
 *
 * ⚠ **`BATCH_ALREADY_UNDONE` IS NOT A REFUSAL TO ENUMERATE** (§9.10). It is a
 * final fact — the batch is already undone — and it is deliberately kept
 * distinct from the §8.4 `BATCH_NOT_CREATES_ONLY` enumeration and from a
 * retryable network fault. Merging any two of these tells the owner something
 * untrue: that a settled batch can be repaired, or that a transient blip is
 * permanent.
 */

import { ApiError } from './apiClient';
import {
  BATCHES_UNDONE,
  BATCHES_UNDONE_ENTRIES_MANY,
  BATCHES_UNDONE_ENTRIES_ONE,
  BATCHES_UNDONE_TITLES_MANY,
  BATCHES_UNDONE_TITLES_ONE,
} from '../copy';

/** The 409 code for a batch that was already undone (`services/batchUndo.ts`). */
export const BATCH_ALREADY_UNDONE = 'BATCH_ALREADY_UNDONE';

/** The counts §9.7 reports, projected off the service's `UndoResult.reversed`. */
export interface UndoSuccess {
  /** `reversed.titlesDeleted` — the "N titles" that left the owner's list. */
  readonly titlesRemoved: number;
  /** `reversed.listingsRemoved` — the "M service entries" that left. */
  readonly entriesRemoved: number;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Coerce the 200 `undoBatch` body into the two §9.7 counts. `reversed` is read
 * defensively because the web client declares the response `unknown`.
 */
export function parseUndoResult(result: unknown): UndoSuccess {
  const reversed =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)['reversed']
      : undefined;
  const row =
    typeof reversed === 'object' && reversed !== null ? (reversed as Record<string, unknown>) : {};
  return {
    titlesRemoved: count(row['titlesDeleted']),
    entriesRemoved: count(row['listingsRemoved']),
  };
}

/** Is this the §9.10 lifecycle 409, rather than the §8.4 enumeration or a fault? */
export function isBatchAlreadyUndone(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && error.code === BATCH_ALREADY_UNDONE;
}

/**
 * §9.7 — render "Undone. N titles and M service entries were removed." from the
 * server's counts, pluralising each noun honestly for a count of one. The
 * numbers are never hard-coded; they are exactly what {@link parseUndoResult}
 * read off the response.
 */
export function formatUndoneSummary({ titlesRemoved, entriesRemoved }: UndoSuccess): string {
  const titles =
    titlesRemoved === 1
      ? BATCHES_UNDONE_TITLES_ONE
      : BATCHES_UNDONE_TITLES_MANY.replace('{count}', String(titlesRemoved));
  const entries =
    entriesRemoved === 1
      ? BATCHES_UNDONE_ENTRIES_ONE
      : BATCHES_UNDONE_ENTRIES_MANY.replace('{count}', String(entriesRemoved));
  return BATCHES_UNDONE.replace('{titles}', titles).replace('{entries}', entries);
}
