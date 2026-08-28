// The review candidate card (`specs/ui.md` §5.3/§5.3a, TASK-069).
//
// ⚠ THE RAW EXTRACTED TEXT IS ALWAYS VISIBLE, next to the proposed match.
// The owner's only way to tell a good match from a plausible-looking wrong one
// is to see what was actually read off the screenshot beside what nextup
// decided it meant. A card that showed only the resolved name would make every
// misread indistinguishable from a correct read, and the owner would confirm
// it. `T-REV-013` pins both halves on the same card.
//
// ⚠ THE `inferred-unverified` AND `unreadable-tile` PRESENTATIONS ARE THE
// REVIEW-SIDE HALF OF THE RSK-028 (fabrication) MITIGATION, not decoration
// (`specs/ui.md` §5.3a). `inferred-unverified` means the title came from the
// model with NO corroborating OCR text, so the cropped tile must be beside it
// and verification must be a glance. Rendering either as an ordinary card
// silently removes the safeguard.
//
// ⚠ `rawText` MAY BE EMPTY for `unreadable-tile`, and the "always visible"
// rule degrades to the thumbnail rather than to an empty line - an empty
// element reads as "nothing was there", which is the opposite of the truth.
//
// This component RENDERS. It decides nothing: the section a candidate belongs
// to is `sectionForCandidate` in `packages/domain/src/review.ts`, server-side,
// and is not recomputed here.

import type { JSX } from 'react';
import type { ReviewCandidate } from '@nextup/domain';

import {
  CANDIDATE_AMBIGUOUS_CHIP,
  CANDIDATE_INFERRED_CHIP,
  CANDIDATE_LOW_CONFIDENCE_CHIP,
  CANDIDATE_OCR_ONLY_CHIP,
  CANDIDATE_UNCERTAIN_CHIP,
  CANDIDATE_UNREADABLE_CHIP,
  CANDIDATE_UNREADABLE_NO_TITLE,
} from '../copy';
import { TMDB_IMAGE_BASE } from './TitleRow';

const MEDIA_TYPE_LABELS: Record<string, string> = { movie: 'Film', tv: 'Series' };

export interface CandidateCardProps {
  readonly candidate: ReviewCandidate;
  /**
   * The cropped tile for this candidate, when one exists. ⚠ Required by §5.3a
   * for `inferred-unverified` and `unreadable-tile`: without it those two
   * verdicts have nothing to verify against.
   */
  readonly thumbnailUrl?: string | null;
}

/**
 * The chips §5.3/§5.3a require. Order is fixed so a card never reshuffles its
 * own warnings between renders.
 */
function chipsFor(candidate: ReviewCandidate): readonly string[] {
  const chips: string[] = [];
  if (candidate.verdict === 'low-confidence') chips.push(CANDIDATE_LOW_CONFIDENCE_CHIP);
  if (candidate.verdict === 'inferred-unverified') chips.push(CANDIDATE_INFERRED_CHIP);
  if (candidate.verdict === 'unreadable-tile') chips.push(CANDIDATE_UNREADABLE_CHIP);
  if (candidate.provider === 'ocr-only') chips.push(CANDIDATE_OCR_ONLY_CHIP);
  if (candidate.match?.uncertain === true) chips.push(CANDIDATE_UNCERTAIN_CHIP);
  if (candidate.match?.ambiguous === true) chips.push(CANDIDATE_AMBIGUOUS_CHIP);
  return chips;
}

export function CandidateCard({ candidate, thumbnailUrl = null }: CandidateCardProps): JSX.Element {
  const { match } = candidate;
  const unreadable = candidate.verdict === 'unreadable-tile';
  // §5.3a: the tile must be rendered for both fabrication-adjacent verdicts,
  // and it is the ONLY content an unreadable tile has.
  const needsThumbnail = unreadable || candidate.verdict === 'inferred-unverified';
  const displayName = match?.name ?? candidate.inferredTitle;

  return (
    <li className="candidate-card" data-testid={`candidate-${candidate.candidateId}`}>
      {needsThumbnail && thumbnailUrl !== null ? (
        <img
          className="candidate-card__thumb"
          data-testid="candidate-thumb"
          src={thumbnailUrl}
          alt=""
        />
      ) : match?.posterPath !== undefined && match?.posterPath !== null ? (
        <img
          className="candidate-card__poster"
          data-testid="candidate-poster"
          src={`${TMDB_IMAGE_BASE}${match.posterPath}`}
          // Empty alt: the name is rendered as text immediately beside it, and
          // naming the poster too would make a screen reader say it twice.
          alt=""
        />
      ) : (
        <div
          className="candidate-card__poster candidate-card__poster--empty"
          data-testid="candidate-poster-placeholder"
          aria-hidden="true"
        />
      )}

      <div className="candidate-card__body">
        {unreadable || displayName === null ? (
          <p className="candidate-card__name" data-testid="candidate-no-title">
            {CANDIDATE_UNREADABLE_NO_TITLE}
          </p>
        ) : (
          <p className="candidate-card__name" data-testid="candidate-name">
            {displayName}
          </p>
        )}

        {match !== null && (
          <p className="candidate-card__meta" data-testid="candidate-meta">
            {[MEDIA_TYPE_LABELS[match.mediaType] ?? match.mediaType, match.releaseYear]
              .filter((part) => part !== null && part !== undefined)
              .join(' · ')}
          </p>
        )}

        {/* ⚠ ALWAYS RENDERED when there is text - this is what the owner
            checks the match against. Suppressed only when empty, where the
            thumbnail above carries the evidence instead. */}
        {candidate.rawText !== '' && (
          <p className="candidate-card__raw" data-testid="candidate-raw-text">
            {candidate.rawText}
          </p>
        )}

        {chipsFor(candidate).map((chip) => (
          <span className="candidate-card__chip" data-testid="candidate-chip" key={chip}>
            {chip}
          </span>
        ))}
      </div>
    </li>
  );
}
