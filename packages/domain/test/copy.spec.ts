/**
 * TASK-048 — the shared owner-facing copy (`specs/ui.md`).
 *
 * The consequence of a mode is stated by the SERVER so that the upload
 * screen, the confirmation and the API response cannot drift into three
 * slightly different promises about whether titles get removed (US-003
 * AC-2/AC-3). These tests pin the wording as a contract rather than as
 * decoration.
 */

import {
  BATCH_MODES,
  DATE_ADDED_LABEL_MARKER,
  SERVICES,
  dateAddedLabel,
  modeExplanation,
} from '@nextup/domain';
import { describe, expect, it } from 'vitest';

describe('T-BATCH-010 the mode consequence is stated in plain language', () => {
  it('T-BATCH-010o: full-update names removal and names the service', () => {
    // The destructive mode must say so. A generic "your list will be updated"
    // is the failure this asserts against: the owner has to be able to tell
    // the two modes apart at the moment of choosing.
    const text = modeExplanation('full-update', 'netflix');
    expect(text).toContain('Netflix');
    expect(text).toContain('offered for removal');
  });

  it('T-BATCH-010p: append-only promises nothing is removed', () => {
    const text = modeExplanation('append-only', 'max');
    expect(text).toContain('Nothing will be removed');
    // It must not say anything is OFFERED for removal — the phrase that
    // belongs exclusively to full-update. Asserting on the presence of
    // "removed" alone would pass for both modes, since the append-only
    // promise is itself phrased with that word.
    expect(text).not.toContain('offered for removal');
  });

  it('T-BATCH-010q: every mode and service pair has real wording', () => {
    // Exhaustive rather than sampled: a mode added later with no copy would
    // otherwise ship an empty or undefined sentence to the confirmation
    // screen, which is exactly where silence reads as consent.
    for (const mode of BATCH_MODES) {
      for (const service of SERVICES) {
        const text = modeExplanation(mode, service);
        expect(text.length).toBeGreaterThan(20);
        expect(text).not.toContain('undefined');
      }
    }
  });

  it('T-BATCH-010r: the service is named in its display form, not its slug', () => {
    expect(modeExplanation('full-update', 'max')).toContain('Max');
    expect(modeExplanation('full-update', 'max')).not.toContain('max ');
  });
});

describe('T-LIST-034 the date-added label is honest about whose date it is', () => {
  it('T-LIST-034a: the label always contains "to nextup"', () => {
    // REQ-061. This product does NOT know when the owner saved a title on
    // Netflix or Max, and cannot: there is no API and no scraping. The only
    // date it has is when the title entered THIS list from a screenshot.
    expect(dateAddedLabel('2026-04-02')).toContain(DATE_ADDED_LABEL_MARKER);
    expect(DATE_ADDED_LABEL_MARKER).toBe('to nextup');
  });

  it('T-LIST-034b: no bare "Added <date>" label is produced', () => {
    // The failure this guards: "Added 2 Apr 2026" reads as the streaming
    // service's date and quietly asserts something false about the owner's
    // own history.
    const label = dateAddedLabel('2026-04-02');
    expect(label).toBe('Added to nextup 2 Apr 2026');
    expect(/^Added \d/.test(label)).toBe(false);
  });

  it('T-LIST-034c: the day is un-padded and the month is a name', () => {
    expect(dateAddedLabel('2026-04-02')).toBe('Added to nextup 2 Apr 2026');
    expect(dateAddedLabel('2026-12-25')).toBe('Added to nextup 25 Dec 2026');
    expect(dateAddedLabel('2026-01-01')).toBe('Added to nextup 1 Jan 2026');
  });

  it('T-LIST-034d: every month renders as a real name, never as a number', () => {
    for (let month = 1; month <= 12; month += 1) {
      const iso = `2026-${String(month).padStart(2, '0')}-15`;
      expect(dateAddedLabel(iso), iso).toMatch(/^Added to nextup 15 [A-Z][a-z]{2} 2026$/);
    }
  });

  it('T-LIST-034e: the label does not shift with the host timezone', () => {
    // A `new Date(iso)` implementation renders 1 Apr in any timezone west of
    // UTC, because the string parses as UTC midnight and then gets localised.
    // This one is pure string work, so there is nothing to shift.
    expect(dateAddedLabel('2026-04-01')).toBe('Added to nextup 1 Apr 2026');
  });

  it('T-LIST-034f: a malformed date is refused rather than half-rendered', () => {
    // "Added to nextup Invalid Date" is worse than a loud failure: it looks
    // like a rendering quirk instead of a write path storing a bad value.
    for (const bad of ['', '2026-4-2', '02/04/2026', '2026-04-02T00:00:00Z', 'yesterday']) {
      expect(() => dateAddedLabel(bad), bad).toThrow(RangeError);
    }
  });

  it('T-LIST-034g: an impossible month is refused', () => {
    expect(() => dateAddedLabel('2026-00-10')).toThrow(RangeError);
    expect(() => dateAddedLabel('2026-13-10')).toThrow(RangeError);
  });
});
