/**
 * #415 — `GET /api/waiting`'s `sort` and `dir` (US-065, REQ-131).
 *
 * The same contract as the Library's `sort`/`dir` (`titlesQuery.ts`): an
 * unknown or repeated value is a `400 VALIDATION_FAILED` naming the field and
 * the permitted values — never silently ignored, so a client bug cannot
 * quietly render the wrong order. An absent `dir` is the key's own default.
 */

import { AppError } from '../errors/AppError.js';
import {
  DEFAULT_WAITING_DIRECTION,
  DEFAULT_WAITING_SORT,
  WAITING_SORTS,
  type WaitingSort,
  type WaitingSortDirection,
} from '../services/waitingSort.js';

const DIRECTIONS: readonly WaitingSortDirection[] = ['asc', 'desc'];

export interface WaitingQuery {
  sort: WaitingSort;
  dir: WaitingSortDirection;
}

export function parseWaitingQuery(query: Record<string, unknown>): WaitingQuery {
  const sortRaw = query['sort'];
  if (sortRaw !== undefined && !(WAITING_SORTS as readonly unknown[]).includes(sortRaw)) {
    throw new AppError('VALIDATION_FAILED', 400, '"sort" is not a supported sort.', {
      field: 'sort',
      permitted: [...WAITING_SORTS],
    });
  }
  const dirRaw = query['dir'];
  if (dirRaw !== undefined && !(DIRECTIONS as readonly unknown[]).includes(dirRaw)) {
    throw new AppError('VALIDATION_FAILED', 400, '"dir" must be "asc" or "desc".', {
      field: 'dir',
      permitted: [...DIRECTIONS],
    });
  }
  const sort = (sortRaw as WaitingSort | undefined) ?? DEFAULT_WAITING_SORT;
  return {
    sort,
    dir: (dirRaw as WaitingSortDirection | undefined) ?? DEFAULT_WAITING_DIRECTION[sort],
  };
}
