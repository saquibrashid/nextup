/**
 * A single extraction candidate in the review pass (`specs/ui.md` §5.3,
 * TASK-069).
 *
 * Renders the matched name + year + type, the raw extracted text (always
 * visible in small type so the owner can see what was read), and the source
 * thumbnail. In read-only mode (alreadyOnYourList section) there are no
 * action buttons.
 *
 * Tests: `T-REV-013` (addition card shows poster, name, year, type).
 */

import type { JSX } from 'react';

import type { ReviewCandidate } from '@nextup/domain';

export interface CandidateCardProps {
  readonly candidate: ReviewCandidate;
  /**
   * When true the card is read-only: no confirm/discard/change-match controls.
   * Used for `alreadyOnYourList` items (US-013 AC-2, `T-REV-016`).
   */
  readonly readOnly?: boolean;
  readonly onConfirm?: (candidateId: string) => void;
  readonly onDiscard?: (candidateId: string) => void;
}

export function CandidateCard({
  candidate,
  readOnly = false,
  onConfirm,
  onDiscard,
}: CandidateCardProps): JSX.Element {
  const { candidateId, rawText, match, inferredTitle } = candidate;
  const displayName = match?.name ?? inferredTitle ?? rawText;
  const year = match?.releaseYear ?? null;
  const mediaType = match?.mediaType ?? null;
  const posterPath = match?.posterPath ?? null;

  return (
    <article
      aria-label={displayName}
      data-testid={`candidate-card-${candidateId}`}
      data-candidate-id={candidateId}
      data-disposition={candidate.disposition}
    >
      {posterPath !== null && (
        <img
          src={`https://image.tmdb.org/t/p/w92${posterPath}`}
          alt={`Poster for ${displayName}`}
          data-testid="candidate-poster"
          width={46}
          height={69}
        />
      )}
      <div>
        <p data-testid="candidate-name">{displayName}</p>
        {year !== null && <p data-testid="candidate-year">{year}</p>}
        {mediaType !== null && (
          <p data-testid="candidate-type">{mediaType === 'movie' ? 'Movie' : 'TV series'}</p>
        )}
        {rawText !== '' && (
          <p data-testid="candidate-raw-text">
            <small>{rawText}</small>
          </p>
        )}
      </div>
      {!readOnly && (
        <div data-testid="candidate-actions">
          <button
            type="button"
            onClick={() => onConfirm?.(candidateId)}
            aria-label={`Confirm ${displayName}`}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => onDiscard?.(candidateId)}
            aria-label={`Discard ${displayName}`}
          >
            Discard
          </button>
        </div>
      )}
    </article>
  );
}
