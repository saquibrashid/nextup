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
  /**
   * REQ-122 — what agreeing to THIS card does, in the owner's terms.
   *
   * ⚠ PASSED IN, NEVER DERIVED, for the same reason `unidentified` is: the
   * card does not know which section it is being rendered in, and guessing
   * from `match === null` would label a "probably not a title" row as an
   * addition. Only the caller knows.
   *
   * ⚠ This is what makes a card identifiable WITH NO HEADING IN VIEW
   * (`T-UX-134`). It is not decoration and it is not a duplicate of the
   * section label — a long review is scrolled, and the heading is gone.
   */
  readonly consequence?: string | null;
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
  consequence = null,
}: CandidateCardProps): JSX.Element {
  // Chrome is a transcription to inspect, not a resolved movie to promote.
  // Keep alternatives available in the action controls without its poster/year
  // making an incidental catalogue match look like screenshot evidence.
  const match = candidate.verdict === 'chrome-suspected' ? null : candidate.match;
  const unreadable = candidate.verdict === 'unreadable-tile';
  // §5.3a: the tile must be rendered for both fabrication-adjacent verdicts,
  // and it is the ONLY content an unreadable tile has.
  //
  // ⚠ That is a FLOOR, not a ceiling. A card with no TMDB match has no poster
  // either, so before this the only other branch was the empty grey
  // placeholder — the owner reported an unmatched card as having "no title and
  // no image" and asked "what am I confirming?". When there is no poster the
  // tile is the only evidence the card can carry, so show it (`T-UX-151b`).
  const hasPoster = match?.posterPath !== undefined && match?.posterPath !== null;
  const needsThumbnail = unreadable || candidate.verdict === 'inferred-unverified' || !hasPoster;
  const displayName =
    candidate.verdict === 'chrome-suspected' ? null : (match?.name ?? candidate.inferredTitle);
  // ⚠ "No title read from this tile" is a claim about the READER, not about
  // matching, and it is false whenever the tile produced text. An unmatched
  // candidate has no `match` and usually no `inferredTitle`, so the old
  // `displayName === null` test printed that line directly above the text the
  // reader had in fact read — the card contradicted itself. Say what was read;
  // the consequence line below already says it will not be added (`T-UX-151a`).
  const readText = candidate.rawText !== '' ? candidate.rawText : null;
  const headline = displayName ?? readText;
  // ⚠ `?? null`, not `=== null`. `tileCrop` was added to the review payload
  // after this component shipped, so a response from an older API — or from
  // the previous revision during a Container Apps rolling deploy — carries no
  // such key at all. Nullish-coalescing degrades that to the uncropped whole
  // screenshot; strict `=== null` would instead take the crop branch and throw
  // on `undefined.w`, blanking the entire review page.
  const crop = candidate.tileCrop ?? null;
  const chips = chipsFor(candidate, unidentified);

  return (
    // ⚠ A `<div>`, NOT the `<li>`: `CandidateList` owns the row element,
    // because the windowed branch (SD-11c) must position and measure it. The
    // list semantics are unchanged — this card is still the only child of an
    // `<li>` inside the section's `<ul>`.
    //
    // ⚠ `id` + `tabIndex={-1}` make the card a PROGRAMMATIC focus target for
    // the §6.14 pending-additions error, and nothing more. `-1` keeps it out
    // of the tab order; any supplied correction controls have their own stops.
    <div
      className="candidate-card"
      id={reviewCandidateDomId(candidate.candidateId)}
      tabIndex={-1}
      data-testid={`candidate-${candidate.candidateId}`}
    >
      {needsThumbnail && thumbnailUrl !== null ? (
        crop === null ? (
          // NO CROP — the two readers did not agree on where this tile is, so
          // the whole screenshot is all there is to show.
          //
          // ⚠ **THIS BRANCH MUST NOT LOOK LIKE A CROP, AND IT USED TO.** With
          // `object-fit: cover` in a ~96px box, a wide screenshot renders as
          // its middle fifth — a confident, well-framed rectangle of whatever
          // happens to be in the centre. The owner reported exactly that from
          // a 1246x205 Netflix strip: three different cards each showed the
          // same two unrelated tiles, and it read as a mis-crop rather than as
          // "we could not locate this". The tell was that all three were
          // IDENTICAL, which independent crops cannot be and a shared
          // uncropped render must.
          //
          // So it is letterboxed (`contain`, not `cover`) and labelled. Seeing
          // the entire screenshot is honest and occasionally useful; seeing an
          // arbitrary fifth of it presented as the tile is neither.
          <span className="candidate-card__whole" data-testid="candidate-thumb-whole">
            <img
              className="candidate-card__thumb"
              data-testid="candidate-thumb"
              src={thumbnailUrl}
              alt=""
            />
            {/* Not `aria-hidden`: a screen-reader user has no other way to
                learn that this picture is the whole screenshot rather than
                the tile, which is the one thing the sighted cue conveys. */}
            <span className="candidate-card__whole-note">Whole screenshot</span>
          </span>
        ) : (
          // §5.3a's CROP. The whole image is fetched either way — the byte
          // route serves whole screenshots and cropping server-side would put
          // image processing on the request path of a 0.25 vCPU container —
          // so the crop is presentational, done by scaling the image up inside
          // a clipping box. `tileCrop` is normalised 0..1, so the arithmetic
          // is resolution-independent and needs no natural dimensions.
          //
          // ⚠ `overflow: hidden` on the wrapper is what makes this a crop and
          // not a very large picture. Removing it renders a hugely magnified
          // screenshot that overflows the card.
          <span
            className="candidate-card__thumb candidate-card__thumb--cropped"
            data-testid="candidate-thumb-crop"
          >
            <img
              data-testid="candidate-thumb"
              src={thumbnailUrl}
              alt=""
              style={{
                width: `${(100 / crop.w).toFixed(4)}%`,
                height: `${(100 / crop.h).toFixed(4)}%`,
                left: `${(-(crop.x * 100) / crop.w).toFixed(4)}%`,
                top: `${(-(crop.y * 100) / crop.h).toFixed(4)}%`,
              }}
            />
          </span>
        )
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
        {headline === null ? (
          <p className="candidate-card__name" data-testid="candidate-no-title">
            {CANDIDATE_UNREADABLE_NO_TITLE}
          </p>
        ) : (
          <p className="candidate-card__name" data-testid="candidate-name">
            {headline}
          </p>
        )}

        {match !== null && (
          <p className="candidate-card__meta" data-testid="candidate-meta">
            {[match.releaseYear, MEDIA_TYPE_LABELS[match.mediaType] ?? match.mediaType]
              .filter((part) => part !== null && part !== undefined)
              .join(' · ')}
          </p>
        )}

        {chips.length > 0 && (
          <div className="candidate-card__signals">
            {chips.map((chip) => (
              <span className="candidate-card__chip" data-testid="candidate-chip" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        )}

        {consequence !== null && (
          <p className="candidate-card__consequence" data-testid="candidate-consequence">
            {consequence}
          </p>
        )}

        {/* ⚠ ALWAYS RENDERED when there is text - this is what the owner
            checks the match against. Suppressed only when empty, where the
            thumbnail above carries the evidence instead, or when the headline
            IS that text (an unmatched row), where repeating it verbatim one
            line down reads as two separate findings. */}
        {candidate.rawText !== '' && headline !== candidate.rawText && (
          <div className="candidate-card__evidence">
            <span className="candidate-card__evidence-label">Read from screenshot</span>
            <p className="candidate-card__raw" data-testid="candidate-raw-text">
              {candidate.rawText}
            </p>
          </div>
        )}
      </div>
      {actions !== null && <div className="candidate-card__actions">{actions}</div>}
    </div>
  );
}
