/**
 * Per-service freshness (REQ-039, US-022) — the pure half.
 *
 * These carry the A46 constraint as much as the formatting: the labels state a
 * FACT and nothing more. A test that only checked "the string mentions the
 * service" would pass through a reword into a nudge, which is the one change
 * the owner explicitly rejected.
 */

import { ageInDays, serviceFreshnessLabel } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

const at = (iso: string): Date => new Date(iso);

describe('ageInDays', () => {
  it('T-FRESH-010a · US-022 AC-1 · same UTC day is zero', () => {
    expect(ageInDays(at('2026-08-13T00:00:00.000Z'), at('2026-08-13T23:59:59.999Z'))).toBe(0);
  });

  it('T-FRESH-010b · US-022 AC-1 · it counts CALENDAR days, not 24-hour blocks', () => {
    // 2 hours apart, but across midnight. The naive `(now - from) / 86400000`
    // reports 0 and labels this "today", which contradicts the calendar the
    // owner is reading it against.
    expect(ageInDays(at('2026-08-12T23:00:00.000Z'), at('2026-08-13T01:00:00.000Z'))).toBe(1);
  });

  it('T-FRESH-010c · a month boundary is counted correctly', () => {
    expect(ageInDays(at('2026-07-31T12:00:00.000Z'), at('2026-08-01T00:00:00.000Z'))).toBe(1);
    expect(ageInDays(at('2026-06-27T12:00:00.000Z'), at('2026-08-13T12:00:00.000Z'))).toBe(47);
  });

  it('T-FRESH-010d · a future timestamp clamps to zero, never negative', () => {
    // Clock skew between the database and the container is real, and
    // "updated -1 days ago" is a bug report. Zero degrades to "today".
    expect(ageInDays(at('2026-08-20T00:00:00.000Z'), at('2026-08-13T00:00:00.000Z'))).toBe(0);
  });
});

describe('serviceFreshnessLabel', () => {
  it('T-FRESH-010e · US-022 AC-1 · today, one day, and many days', () => {
    // Spelled out independently of the function that builds them.
    expect(serviceFreshnessLabel('netflix', 0)).toBe('Netflix updated today');
    expect(serviceFreshnessLabel('max', 47)).toBe('Max updated 47 days ago');
  });

  it('T-FRESH-010f · one day is singular, not "1 days ago"', () => {
    expect(serviceFreshnessLabel('netflix', 1)).toBe('Netflix updated 1 day ago');
  });

  it('T-FRESH-012a · US-022 AC-3 · null is "never updated", not an error', () => {
    // The ordinary first-run state for a service the owner has not captured.
    // Rendering it as a failure would teach them to distrust the strip on day
    // one; rendering it as "updated today" would be a lie.
    expect(serviceFreshnessLabel('max', null)).toBe('Max has never been updated');
    expect(serviceFreshnessLabel('netflix', null)).toBe('Netflix has never been updated');
  });

  it('T-FRESH-012b · the display name is capitalised, never the stored value', () => {
    for (const label of [serviceFreshnessLabel('netflix', 0), serviceFreshnessLabel('max', null)]) {
      expect(label).not.toContain('netflix');
      expect(label.startsWith('Netflix') || label.startsWith('Max')).toBe(true);
    }
  });

  it('T-FRESH-015a · A46 · the label states a FACT and never nags', () => {
    // ⚠ The whole point of A46. The owner dropped the staleness concept
    // outright: no threshold, no nag, no derived "stale" state, no re-capture
    // reminder. A reword into a prompt would pass every other assertion here,
    // so this asserts the ABSENCE directly.
    const forbidden = [
      'stale',
      'out of date',
      'outdated',
      'update now',
      'time to',
      'you haven',
      'consider',
      'should',
      'reminder',
      'overdue',
      '?',
      '!',
    ];

    const labels = [
      serviceFreshnessLabel('netflix', 0),
      serviceFreshnessLabel('netflix', 1),
      serviceFreshnessLabel('max', 47),
      serviceFreshnessLabel('max', 400),
      serviceFreshnessLabel('max', null),
    ];

    for (const label of labels) {
      for (const word of forbidden) {
        expect(label.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('T-FRESH-015b · A46 · a very old date is worded exactly like a recent one', () => {
    // No threshold exists, so there is no age at which the wording changes.
    // If someone reintroduces a cliff, these two shapes diverge.
    expect(serviceFreshnessLabel('max', 3)).toBe('Max updated 3 days ago');
    expect(serviceFreshnessLabel('max', 3650)).toBe('Max updated 3650 days ago');
  });
});
