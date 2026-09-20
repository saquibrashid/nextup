import { describe, expect, it, vi } from 'vitest';
import { assessCaptureIntake, type CaptureAttemptEvidence } from '../src/captureIntake.js';

describe('Capture intake evidence', () => {
  it('T-UX-164a: successful intake cannot erase a rejected or interrupted request', () => {
    const attempts: CaptureAttemptEvidence[] = [
      { id: 'saved', state: 'complete' },
      { id: 'rejected', state: 'incomplete' },
      { id: 'interrupted', state: 'receiving' },
    ];
    expect(assessCaptureIntake('tracked', attempts, new Set(['saved-image']))).toEqual({
      complete: false,
      reason: 'unresolved-input',
      unresolvedAttemptIds: ['rejected', 'interrupted'],
    });
  });

  it('T-UX-164b: uploading another image does not implicitly resolve failed input', () => {
    const attempts: CaptureAttemptEvidence[] = [{ id: 'failed', state: 'incomplete' }];
    for (const saved of [[], ['new-image'], ['duplicate-name-image', 'new-image']]) {
      expect(assessCaptureIntake('tracked', attempts, new Set(saved))).toEqual({
        complete: false,
        reason: 'unresolved-input',
        unresolvedAttemptIds: ['failed'],
      });
    }
  });

  it('T-UX-164c: explicit existing or new replacements resolve only the associated issue', () => {
    const attempts: CaptureAttemptEvidence[] = [
      { id: 'old-upload', state: 'complete' },
      { id: 'duplicate', state: 'resolved', replacementImageIds: ['existing-image'] },
      { id: 'partial-request', state: 'resolved', replacementImageIds: ['accepted-sibling'] },
      { id: 'rejected', state: 'resolved', replacementImageIds: ['new-image'] },
    ];
    const saved = new Set(['existing-image', 'accepted-sibling', 'new-image']);
    expect(assessCaptureIntake('tracked', attempts, saved)).toEqual({
      complete: true,
      reason: null,
      unresolvedAttemptIds: [],
    });
    expect(
      assessCaptureIntake(
        'tracked',
        [...attempts, { id: 'other-failure', state: 'incomplete' }],
        saved,
      ),
    ).toEqual({
      complete: false,
      reason: 'unresolved-input',
      unresolvedAttemptIds: ['other-failure'],
    });
  });

  it('T-UX-164d: empty or partly removed replacement associations remain unresolved', () => {
    const attempts: CaptureAttemptEvidence[] = [
      { id: 'empty', state: 'resolved', replacementImageIds: [] },
      { id: 'two-images', state: 'resolved', replacementImageIds: ['retained', 'deleted'] },
      { id: 'intact', state: 'resolved', replacementImageIds: ['retained'] },
    ];
    expect(assessCaptureIntake('tracked', attempts, new Set(['retained']))).toEqual({
      complete: false,
      reason: 'unresolved-input',
      unresolvedAttemptIds: ['empty', 'two-images'],
    });
  });

  it('T-UX-164e: legacy or inherited uncertainty cannot be repaired by rereading accepted images', () => {
    for (const origin of ['unverified', 'inherited-incomplete'] as const) {
      expect(
        assessCaptureIntake(
          origin,
          [{ id: 'successful-replacement', state: 'resolved', replacementImageIds: ['saved'] }],
          new Set(['saved']),
        ),
      ).toEqual({ complete: false, reason: origin, unresolvedAttemptIds: [] });
      expect(
        assessCaptureIntake(origin, [{ id: 'failure', state: 'incomplete' }], new Set()),
      ).toEqual({
        complete: false,
        reason: origin,
        unresolvedAttemptIds: ['failure'],
      });
    }
  });

  it('T-UX-164f: no recorded intake issue is not a substitute for the separate extraction gate', () => {
    expect(assessCaptureIntake('tracked', [], new Set())).toEqual({
      complete: true,
      reason: null,
      unresolvedAttemptIds: [],
    });
    expect(assessCaptureIntake('unverified', [], new Set())).toEqual({
      complete: false,
      reason: 'unverified',
      unresolvedAttemptIds: [],
    });
  });

  it('T-UX-164g: reassessment preserves evidence and ignores time while saved rows remain', () => {
    const replacementImageIds = Object.freeze(['saved']);
    const attempts = Object.freeze([
      Object.freeze({ id: 'failed', state: 'resolved' as const, replacementImageIds }),
    ]);
    const saved = new Set(['saved']);
    const before = assessCaptureIntake('tracked', attempts, saved);
    vi.useFakeTimers();
    try {
      for (const date of ['2026-01-01', '2026-02-01', '2040-01-01']) {
        vi.setSystemTime(new Date(date));
        expect(assessCaptureIntake('tracked', attempts, saved)).toEqual(before);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(before.complete).toBe(true);
    expect(attempts[0]?.replacementImageIds).toEqual(['saved']);
    expect(saved).toEqual(new Set(['saved']));
    expect(assessCaptureIntake('tracked', attempts, new Set()).complete).toBe(false);
  });
});
