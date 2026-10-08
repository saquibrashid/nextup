/**
 * US-064 (PRD `A55`, `specs/api.md` §6.45–§6.48) — the pure rules behind the
 * "Availability changes" review: which rows one "Check more titles" tap looks
 * up, which service a bulk "Add to Library" uses, and what the bulk body may
 * carry. No I/O; the routes are covered in `routes/availabilityReview.spec.ts`.
 */

import { describe, expect, it } from 'vitest';

import { WATCH_PROVIDER_MAX_AGE_DAYS } from '../../../src/config.js';
import { AVAILABILITY_REFRESH_PER_REQUEST } from '../../../src/services/watchAvailability.js';
import {
  AVAILABILITY_CHECK_BATCH,
  AVAILABILITY_REVIEW_APPLY_MAX,
  checkCounts,
  firstOwnerService,
  parseApplyBody,
  selectForAvailabilityCheck,
  type CheckCandidate,
} from '../../../src/services/availabilityReview.js';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const DAY = 86_400_000;

function candidate(
  id: string,
  checkedDaysAgo: number | null,
  overrides: Partial<CheckCandidate['row']> = {},
  kind: CheckCandidate['kind'] = 'title',
): CheckCandidate {
  return {
    kind,
    row: {
      id,
      workIdentity: `tmdb:movie:${id}`,
      tmdbId: 1,
      tmdbMediaType: 'movie',
      availabilityRegion: 'US',
      availabilityCheckedAt:
        checkedDaysAgo === null ? null : new Date(NOW.getTime() - checkedDaysAgo * DAY),
      availableOn: [],
      rentOn: [],
      streamingSince: null,
      ...overrides,
    },
  };
}

describe('T-AVREV-001 · US-064 AC-3 · "Check more titles" picks the next batch', () => {
  it('T-AVREV-001a: only stale rows, never-checked first, then the oldest answer first', () => {
    const rows = [
      candidate('fresh', 1),
      candidate('old-10', 10),
      candidate('never-a', null),
      candidate('old-30', 30, {}, 'intent'),
      candidate('never-b', null, {}, 'intent'),
      candidate('unmatched', null, { tmdbId: null }),
    ];
    expect(selectForAvailabilityCheck(rows, NOW).map((row) => row.row.id)).toEqual([
      'never-a',
      'never-b',
      'old-30',
      'old-10',
    ]);
  });

  it('T-AVREV-001b: one tap looks up at most AVAILABILITY_CHECK_BATCH (20) rows', () => {
    const rows = Array.from({ length: 45 }, (_, i) => candidate(`r${String(i)}`, 8 + i));
    const picked = selectForAvailabilityCheck(rows, NOW);
    expect(AVAILABILITY_CHECK_BATCH).toBe(20);
    expect(picked).toHaveLength(20);
    // The oldest twenty, so the next tap reaches the rest.
    expect(picked[0]?.row.id).toBe('r44');
    expect(picked[19]?.row.id).toBe('r25');
    expect(selectForAvailabilityCheck(rows, NOW, 3)).toHaveLength(3);
  });

  it('T-AVREV-001c: the batch size is its own constant, not the on-access cap', () => {
    expect(AVAILABILITY_CHECK_BATCH).not.toBe(AVAILABILITY_REFRESH_PER_REQUEST);
    expect(AVAILABILITY_REVIEW_APPLY_MAX).toBe(50);
  });

  it('T-AVREV-001d: the counts line splits matched rows into recent and not recent', () => {
    const rows = [
      candidate('fresh', 1),
      candidate('edge', WATCH_PROVIDER_MAX_AGE_DAYS),
      candidate('never', null),
      candidate('unmatched', null, { tmdbMediaType: null }),
    ];
    expect(checkCounts(rows, NOW)).toEqual({ checked: 1, notCheckedRecently: 2 });
    expect(checkCounts([], NOW)).toEqual({ checked: 0, notCheckedRecently: 0 });
  });
});

describe('T-AVREV-002 · US-064 AC-4 · bulk "Add to Library" uses the first owner service', () => {
  it('T-AVREV-002a: the first owner service in SERVICES order, or none', () => {
    expect(firstOwnerService(['max', 'netflix'], ['netflix', 'max'])).toBe('netflix');
    expect(firstOwnerService(['max', 'netflix'], ['max'])).toBe('max');
    expect(firstOwnerService(['prime-video'], ['netflix'])).toBeNull();
    expect(firstOwnerService([], ['netflix'])).toBeNull();
    expect(firstOwnerService(null, ['netflix'])).toBeNull();
  });
});

describe('T-AVREV-003 · specs/api.md §6.48 · the bulk body is validated whole', () => {
  const SIG = 'left=netflix;joined=';

  it('T-AVREV-003a: accepts each action and its items', () => {
    expect(parseApplyBody({ action: 'keep', items: [{ id: 't1', signature: SIG }] })).toEqual({
      action: 'keep',
      items: [{ id: 't1', signature: SIG }],
    });
    // Add to Library answers no change signature; one sent is ignored.
    expect(
      parseApplyBody({ action: 'add-to-library', items: [{ id: 'i1', signature: 'x' }] }),
    ).toEqual({ action: 'add-to-library', items: [{ id: 'i1', signature: null }] });
  });

  it('T-AVREV-003b: refuses a bad action, an empty or oversized list, and a bad item', () => {
    const many = Array.from({ length: AVAILABILITY_REVIEW_APPLY_MAX + 1 }, (_, i) => ({
      id: `t${String(i)}`,
      signature: SIG,
    }));
    const bodies: unknown[] = [
      null,
      [],
      'keep',
      { items: [{ id: 't1', signature: SIG }] },
      { action: 'delete', items: [{ id: 't1', signature: SIG }] },
      { action: 'keep' },
      { action: 'keep', items: [] },
      { action: 'keep', items: many },
      { action: 'keep', items: [null] },
      { action: 'keep', items: [[]] },
      { action: 'keep', items: [{ id: '', signature: SIG }] },
      { action: 'keep', items: [{ id: 'x'.repeat(201), signature: SIG }] },
      {
        action: 'keep',
        items: [
          { id: 't1', signature: SIG },
          { id: 't1', signature: SIG },
        ],
      },
      { action: 'keep', items: [{ id: 't1' }] },
      { action: 'remove-left-badges', items: [{ id: 't1', signature: 'nonsense' }] },
    ];
    for (const body of bodies) {
      expect(() => parseApplyBody(body)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED', httpStatus: 400 }),
      );
    }
  });
});
