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
  CANDIDATE_UNIDENTIFIED_CHIP,
  CANDIDATE_UNREADABLE_CHIP,
  CANDIDATE_UNREADABLE_NO_TITLE,
} from '../copy';
import { TMDB_IMAGE_BASE } from './TitleRow';

const MEDIA_TYPE_LABELS: Record<string, string> = { movie: 'Film', tv: 'Series' };

/**
 * The stable DOM `id` of a candidate card, so `ReviewPage` can move focus to a
 * specific one on a 409 `PENDING_ADDITIONS` (`ux-states.md` §6.14). ⚠ Defined
 * HERE, next to the element it names, so the writer and the reader of the id
 * cannot drift — a `getElementById` in `ReviewPage` guessing this format would
 * silently focus nothing the moment either side changed.
 */
export function reviewCandidateDomId(candidateId: string): string {
  return `review-candidate-${candidateId}`;
}

export interface CandidateCardProps {
  readonly candidate: ReviewCandidate;
  /**
   * The cropped tile for this candidate, when one exists. ⚠ Required by §5.3a
   * for `inferred-unverified` and `unreadable-tile`: without it those two
   * verdicts have nothing to verify against.
   */
  readonly thumbnailUrl?: string | null;
  /**
   * ⚠ PASSED IN, NEVER DERIVED. `match === null` is also true of
   * `probablyNotTitles` and `unreadableTiles`, so deriving the chip here would
   * claim TMDB had been asked about rows it was never asked about. Section
   * membership is `sectionForCandidate`, server-side; only the caller knows
   * which section this card is being rendered in (`T-UX-063h`).
   */
  readonly unidentified?: boolean;
  /** The §6.8 per-card action strip, when the section has one. */
  readonly actions?: JSX.Element | null;
}

/**
 * The chips §5.3/§5.3a require. Order is fixed so a card never reshuffles its
 * own warnings between renders.
 */
function chipsFor(candidate: ReviewCandidate, unidentified: boolean): readonly string[] {
  const chips: string[] = [];
  if (unidentified) chips.push(CANDIDATE_UNIDENTIFIED_CHIP);
  if (candidate.verdict === 'low-confidence') chips.push(CANDIDATE_LOW_CONFIDENCE_CHIP);
  if (candidate.verdict === 'inferred-unverified') chips.push(CANDIDATE_INFERRED_CHIP);
  if (candidate.verdict === 'unreadable-tile') chips.push(CANDIDATE_UNREADABLE_CHIP);
  if (candidate.provider === 'ocr-only') chips.push(CANDIDATE_OCR_ONLY_CHIP);
  if (candidate.match?.uncertain === true) chips.push(CANDIDATE_UNCERTAIN_CHIP);
  if (candidate.match?.ambiguous === true) chips.push(CANDIDATE_AMBIGUOUS_CHIP);
  return chips;
}

export function CandidateCard({
  candidate,
  thumbnailUrl = null,
  unidentified = false,
  actions = null,
}: CandidateCardProps): JSX.Element {
  const { match } = candidate;
  const unreadable = candidate.verdict === 'unreadable-tile';
  // §5.3a: the tile must be rendered for both fabrication-adjacent verdicts,
  // and it is the ONLY content an unreadable tile has.
  const needsThumbnail = unreadable || candidate.verdict === 'inferred-unverified';
  const displayName = match?.name ?? candidate.inferredTitle;

  return (
    // ⚠ A `<div>`, NOT the `<li>`: `CandidateList` owns the row element,
    // because the windowed branch (SD-11c) must position and measure it. The
    // list semantics are unchanged — this card is still the only child of an
    // `<li>` inside the section's `<ul>`.
    //
    // ⚠ `id` + `tabIndex={-1}` make the card a PROGRAMMATIC focus target for
    // the §6.14 pending-additions error, and nothing more. `-1` keeps it out
    // of the tab order (it is not a control), so `T-REV-016b`'s keyboard-
    // reachability check — which excludes `[tabindex="-1"]` — still reads the
    // "Already on your list" cards as inert.
    <div
      className="candidate-card"
      id={reviewCandidateDomId(candidate.candidateId)}
      tabIndex={-1}
      data-testid={`candidate-${candidate.candidateId}`}
    >
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

        {chipsFor(candidate, unidentified).map((chip) => (
          <span className="candidate-card__chip" data-testid="candidate-chip" key={chip}>
            {chip}
          </span>
        ))}

        {actions}
      </div>
    </div>
  );
}
