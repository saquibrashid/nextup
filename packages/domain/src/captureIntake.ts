export type CaptureTrackingOrigin = 'tracked' | 'unverified' | 'inherited-incomplete';

export type CaptureAttemptEvidence =
  | { readonly id: string; readonly state: 'receiving' | 'complete' | 'incomplete' }
  | {
      readonly id: string;
      readonly state: 'resolved';
      readonly replacementImageIds: readonly string[];
    };

export interface CaptureIntakeAssessment {
  readonly complete: boolean;
  readonly reason: 'unverified' | 'inherited-incomplete' | 'unresolved-input' | null;
  readonly unresolvedAttemptIds: readonly string[];
}

/**
 * Intake evidence only: extraction quality and full-update consent remain
 * separate gates. The saved-image set must be scoped to this owner and batch.
 * Retention time is deliberately absent: expiry cannot undo an intake decision.
 */
export function assessCaptureIntake(
  origin: CaptureTrackingOrigin,
  attempts: readonly CaptureAttemptEvidence[],
  savedImageIds: ReadonlySet<string>,
): CaptureIntakeAssessment {
  const unresolvedAttemptIds = attempts
    .filter((attempt) => {
      if (attempt.state === 'complete') return false;
      if (attempt.state !== 'resolved') return true;
      return (
        attempt.replacementImageIds.length === 0 ||
        attempt.replacementImageIds.some((id) => !savedImageIds.has(id))
      );
    })
    .map((attempt) => attempt.id);

  const reason =
    origin !== 'tracked' ? origin : unresolvedAttemptIds.length > 0 ? 'unresolved-input' : null;

  return { complete: reason === null, reason, unresolvedAttemptIds };
}
