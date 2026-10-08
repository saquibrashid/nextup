/**
 * #415 (US-065, REQ-131) — the order of `GET /api/waiting`, as pure functions:
 * `T-WSORT-001` (query validation) and `T-WSORT-002` (the comparator).
 * The route arm over HTTP is `waitingSortRoute.spec.ts` (`T-WSORT-003`).
 */

import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/errors/AppError.js';
import { parseWaitingQuery } from '../../src/routes/waitingQuery.js';
import {
  DEFAULT_WAITING_DIRECTION,
  DEFAULT_WAITING_SORT,
  expectedPosition,
  sortWaiting,
  type WaitingSort,
  type WaitingSortDirection,
  type WaitingSortFacts,
} from '../../src/services/waitingSort.js';

const caught = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected a throw');
};

describe('T-WSORT-001 · sort and dir are validated like the Library', () => {
  it('T-WSORT-001a · absent → expected availability, soonest first', () => {
    expect(DEFAULT_WAITING_SORT).toBe('expected');
    expect(parseWaitingQuery({})).toEqual({ sort: 'expected', dir: 'asc' });
  });

  it('T-WSORT-001b · each key has its own default direction', () => {
    expect(DEFAULT_WAITING_DIRECTION).toEqual({
      expected: 'asc',
      discovered: 'desc',
      name: 'asc',
      releaseYear: 'desc',
    });
    for (const sort of ['expected', 'discovered', 'name', 'releaseYear'] as const) {
      expect(parseWaitingQuery({ sort })).toEqual({ sort, dir: DEFAULT_WAITING_DIRECTION[sort] });
    }
  });

  it('T-WSORT-001c · an explicit dir wins over the default', () => {
    expect(parseWaitingQuery({ sort: 'discovered', dir: 'asc' })).toEqual({
      sort: 'discovered',
      dir: 'asc',
    });
    expect(parseWaitingQuery({ dir: 'desc' })).toEqual({ sort: 'expected', dir: 'desc' });
  });

  it('T-WSORT-001d · an unknown or repeated sort is 400 VALIDATION_FAILED naming the permitted keys', () => {
    for (const sort of ['dateAdded', '', ['name', 'name']]) {
      const error = caught(() => parseWaitingQuery({ sort }));
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.httpStatus).toBe(400);
      expect(error.details).toEqual({
        field: 'sort',
        permitted: ['expected', 'discovered', 'name', 'releaseYear'],
      });
    }
  });

  it('T-WSORT-001e · an unknown or repeated dir is 400 VALIDATION_FAILED', () => {
    for (const dir of ['up', 'ASC', ['asc']]) {
      const error = caught(() => parseWaitingQuery({ dir }));
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.httpStatus).toBe(400);
      expect(error.details).toEqual({ field: 'dir', permitted: ['asc', 'desc'] });
    }
  });
});

const facts = (over: Partial<WaitingSortFacts> & { intentId: string }): WaitingSortFacts => ({
  tmdbName: over.intentId,
  rawExtractedText: null,
  discoveredAt: new Date('2026-01-01T00:00:00Z'),
  releaseYear: null,
  forecast: null,
  onYourServices: false,
  ...over,
});

const order = (rows: WaitingSortFacts[], sort: WaitingSort, dir: WaitingSortDirection): string[] =>
  sortWaiting(rows, (row) => row, sort, dir).map((row) => row.intentId);

describe('T-WSORT-002 · the waiting comparator', () => {
  const announcedLate = facts({
    intentId: 'announced-dec',
    forecast: { kind: 'announced', service: 'max', on: '2026-12-04' },
  });
  const announcedSoon = facts({
    intentId: 'announced-nov',
    forecast: { kind: 'announced', service: 'netflix', on: '2026-11-02' },
  });
  const estimateSoon = facts({
    intentId: 'estimate-soon',
    forecast: { kind: 'estimate-soon', service: 'peacock' },
  });
  const estimateOct = facts({
    intentId: 'estimate-oct',
    forecast: { kind: 'estimate', service: 'max', month: '2026-10' },
  });
  const estimateRange = facts({
    intentId: 'estimate-range',
    forecast: { kind: 'estimate-range', service: 'max', from: '2027-01', to: '2027-03' },
  });
  const undatedA = facts({ intentId: 'undated-a', tmdbName: 'Alpha' });
  const undatedB = facts({ intentId: 'undated-b', tmdbName: 'Beta' });
  const forecastRows = [
    undatedB,
    estimateRange,
    announcedLate,
    estimateOct,
    undatedA,
    estimateSoon,
    announcedSoon,
  ];

  it('T-WSORT-002a · expected asc: announced dates soonest first, then estimates, then no date', () => {
    expect(order(forecastRows, 'expected', 'asc')).toEqual([
      'announced-nov',
      'announced-dec',
      'estimate-soon',
      'estimate-oct',
      'estimate-range',
      'undated-a',
      'undated-b',
    ]);
  });

  it('T-WSORT-002b · expected desc mirrors the dated rows and still puts no date LAST', () => {
    expect(order(forecastRows, 'expected', 'desc')).toEqual([
      'estimate-range',
      'estimate-oct',
      'estimate-soon',
      'announced-dec',
      'announced-nov',
      'undated-a',
      'undated-b',
    ]);
  });

  it('T-WSORT-002c · forecast positions: announced tier 0, every estimate tier 1, none null', () => {
    expect(expectedPosition(null)).toBeNull();
    expect(expectedPosition(announcedSoon.forecast)).toEqual({ tier: 0, date: '2026-11-02' });
    expect(expectedPosition(estimateOct.forecast)).toEqual({ tier: 1, date: '2026-10-01' });
    expect(expectedPosition(estimateRange.forecast)).toEqual({ tier: 1, date: '2027-01-01' });
    expect(expectedPosition(estimateSoon.forecast)).toEqual({ tier: 1, date: '' });
  });

  const older = facts({ intentId: 'older', discoveredAt: new Date('2026-01-01T09:00:00Z') });
  const newer = facts({ intentId: 'newer', discoveredAt: new Date('2026-03-01T09:00:00Z') });
  const sameDayLater = facts({
    intentId: 'same-day-later',
    discoveredAt: new Date('2026-03-01T18:00:00Z'),
  });

  it('T-WSORT-002d · discovered: newest first by default, oldest first reversed, to the instant', () => {
    expect(order([older, newer, sameDayLater], 'discovered', 'desc')).toEqual([
      'same-day-later',
      'newer',
      'older',
    ]);
    expect(order([newer, sameDayLater, older], 'discovered', 'asc')).toEqual([
      'older',
      'newer',
      'same-day-later',
    ]);
  });

  const theZoo = facts({ intentId: 'w1', tmdbName: 'The Zookeeper' });
  const amelie = facts({ intentId: 'w2', tmdbName: 'Amélie' });
  const apple = facts({ intentId: 'w3', tmdbName: 'apple' });
  const banana = facts({ intentId: 'w4', tmdbName: null, rawExtractedText: 'Banana' });

  it('T-WSORT-002e · name: A→Z ignoring a leading article, case and accents; Z→A reversed', () => {
    expect(order([theZoo, banana, apple, amelie], 'name', 'asc')).toEqual(['w2', 'w3', 'w4', 'w1']);
    expect(order([theZoo, banana, apple, amelie], 'name', 'desc')).toEqual([
      'w1',
      'w4',
      'w3',
      'w2',
    ]);
  });

  const y2024 = facts({ intentId: 'y2024', releaseYear: 2024 });
  const y2026 = facts({ intentId: 'y2026', releaseYear: 2026 });
  const yNone = facts({ intentId: 'y-none', releaseYear: null });

  it('T-WSORT-002f · release year: newest first by default, oldest reversed, unknown LAST in both', () => {
    expect(order([yNone, y2024, y2026], 'releaseYear', 'desc')).toEqual([
      'y2026',
      'y2024',
      'y-none',
    ]);
    expect(order([yNone, y2026, y2024], 'releaseYear', 'asc')).toEqual([
      'y2024',
      'y2026',
      'y-none',
    ]);
  });

  it('T-WSORT-002g · ties break by name A→Z then intent id, whatever the direction', () => {
    const tieB = facts({ intentId: 'b', tmdbName: 'Same', releaseYear: 2025 });
    const tieA = facts({ intentId: 'a', tmdbName: 'Same', releaseYear: 2025 });
    const tieZed = facts({ intentId: 'c', tmdbName: 'Zed', releaseYear: 2025 });
    const tieAlpha = facts({ intentId: 'd', tmdbName: 'Alpha', releaseYear: 2025 });
    for (const dir of ['asc', 'desc'] as const) {
      expect(order([tieZed, tieB, tieAlpha, tieA], 'releaseYear', dir)).toEqual([
        'd',
        'a',
        'b',
        'c',
      ]);
      expect(order([tieB, tieA], 'name', dir)).toEqual(['a', 'b']);
    }
  });

  it("T-WSORT-002h · a row streaming on the owner's services leads in every key and direction", () => {
    const streaming = facts({ intentId: 'streaming', tmdbName: 'Zulu', onYourServices: true });
    const rows = [announcedSoon, y2026, newer, apple, streaming];
    for (const sort of ['expected', 'discovered', 'name', 'releaseYear'] as const) {
      for (const dir of ['asc', 'desc'] as const) {
        expect(order(rows, sort, dir)[0]).toBe('streaming');
      }
    }
  });

  it('T-WSORT-002i · the input array is not mutated', () => {
    const rows = [undatedB, announcedSoon];
    order(rows, 'expected', 'asc');
    expect(rows.map((row) => row.intentId)).toEqual(['undated-b', 'announced-nov']);
  });
});
