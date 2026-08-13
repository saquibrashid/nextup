/**
 * TASK-048 — the shared owner-facing copy (`specs/ui.md`).
 *
 * The consequence of a mode is stated by the SERVER so that the upload
 * screen, the confirmation and the API response cannot drift into three
 * slightly different promises about whether titles get removed (US-003
 * AC-2/AC-3). These tests pin the wording as a contract rather than as
 * decoration.
 */

import { BATCH_MODES, SERVICES, modeExplanation } from '@nextup/domain';
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
