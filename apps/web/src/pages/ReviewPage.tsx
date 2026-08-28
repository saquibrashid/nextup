// `/batches/:batchId/review` - the review pass (`specs/ui.md` §5, TASK-069).
//
// ⚠ THIS IS THE SAFETY GATE, and it is where the mode contract becomes
// visible. Three rules are load-bearing and each fails SILENTLY if got wrong:
//
// 1. **Full update renders "Already on your list (N)" ALWAYS** (REQ-057,
//    product invariant 2). Collapsible, never omitted, and its count stays
//    legible while collapsed so the owner can sanity-check it against what
//    they expect. Hiding it makes a failed extraction of a known title
//    indistinguishable from a removal.
// 2. **Append-only renders NEITHER that section NOR removals** (REQ-022), and
//    they are ABSENT FROM THE DOM rather than hidden with CSS - `T-REM-011`
//    reads the DOM, and a `hidden` attribute would satisfy a human skim while
//    leaving both present to a screen reader.
// 3. **Which section a candidate belongs to is decided SERVER-SIDE**
//    (`sectionForCandidate`, `packages/domain/src/review.ts`) and is rendered
//    here as given. A client-side re-derivation would be a second
//    implementation of the one rule whose entire point is having only one.
//
// ⚠ `omitted` AND `count: 0` ARE DIFFERENT AND BOTH RENDER DIFFERENTLY.
// `omitted` is "this question does not apply to this mode"; `count: 0` is "we
// looked and there was nothing". Collapsing them is how a full update comes to
// look like an append-only one.
//
// ⚠ THE STICKY ACTION BAR IS NOT DECORATION (SD-11d, `T-UX-011`). At ~200
// candidates the confirm action scrolls out of reach on a phone and the owner
// loses their place - the likeliest cause of abandonment this screen has.
//
// ⚠ THIS PAGE IS PROP-DRIVEN AND MUTATES NOTHING. Dispositions, the removal
// confirm dialog and the apply call are TASK-082/091/093; the seam is
// `onApply` / `onDiscard`. See `containers/ListRoute.tsx` for why a page that
// fetches for itself is a defect this project has already shipped twice.
//
// ⚠ NO `<header>` ELEMENT HERE. `T-UI-023c` requires exactly ONE header
// landmark per route and the app shell already provides it; a second one is a
// duplicated landmark, not a heading. For the same reason the `<h1>` is
// rendered in EVERY state, including loading and failure - `T-UI-023b`
// identifies each route by its unique level-1 heading, so a state without one
// reads as a route that fell through to the catch-all.

import { useState, type JSX } from 'react';
import type { ReviewCandidate, ReviewResponse, ReviewSection } from '@nextup/domain';

import { CandidateCard } from '../components/CandidateCard';
import { RemovalConfirmDialog } from '../components/RemovalConfirmDialog';
import {
  REVIEW_APPLY_LABEL,
  REVIEW_DISCARD_LABEL,
  REVIEW_LOADING,
  REVIEW_NO_TEXT_IN,
  REVIEW_LOAD_FAILED,
  REVIEW_NO_ADDITIONS_BODY,
  REVIEW_NO_ADDITIONS_TITLE,
  REVIEW_RETRY_LABEL,
  REVIEW_SECTION_EMPTY,
  REVIEW_TITLE,
} from '../copy';

export interface ReviewPageProps {
  readonly review?: ReviewResponse | null;
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  readonly onRetry?: () => void;
  /**
   * ⚠ Takes `confirmRemovals`, which the container sends verbatim to
   * `POST /api/batches/:id/close`. It is `true` **only** when the owner has
   * been through the §6.10 dialog: a page that always sent `true` would make
   * REQ-020's group confirmation a formality, and one that always sent `false`
   * would 409 every full-update close.
   */
  readonly onApply?: (confirmRemovals: boolean) => void;
  readonly onDiscard?: () => void;
}

const SERVICE_LABELS: Record<string, string> = { netflix: 'Netflix', max: 'Max' };
const MODE_LABELS: Record<string, string> = {
  'full-update': 'Full update',
  'append-only': 'Append only',
};

/** A section that may be collapsed and may not apply to this mode at all. */
interface SectionView extends ReviewSection<ReviewCandidate> {
  readonly omitted?: boolean;
  readonly collapsedByDefault?: boolean;
}

function CandidateSection({
  section,
  testId,
}: {
  readonly section: SectionView;
  readonly testId: string;
}): JSX.Element | null {
  // ⚠ ABSENT, not hidden (REQ-022, `T-REM-011`).
  if (section.omitted === true) return null;

  return (
    <section className="review-section" data-testid={testId}>
      <details open={section.collapsedByDefault !== true}>
        <summary className="review-section__summary">
          {/* The count sits INSIDE the summary so it is legible while
              collapsed (SD-11b) - it is the owner's only sanity check against
              a silently under-read batch. */}
          {`${section.label} (${section.count})`}
        </summary>
        {section.items.length === 0 ? (
          <p className="review-empty__body" data-testid="review-section-empty">
            {REVIEW_SECTION_EMPTY}
          </p>
        ) : (
          <ul className="review-section__list">
            {section.items.map((candidate) => (
              <CandidateCard candidate={candidate} key={candidate.candidateId} />
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function ReviewHeading({ subtitle }: { readonly subtitle: string | null }): JSX.Element {
  return (
    <div className="review-heading" data-testid="review-heading">
      <h1>{REVIEW_TITLE}</h1>
      {subtitle !== null && (
        <p className="review-heading__context" data-testid="review-context">
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function ReviewPage({
  review = null,
  loading = false,
  loadFailed = false,
  onRetry,
  onApply,
  onDiscard,
}: ReviewPageProps): JSX.Element {
  // ⚠ Declared before the early returns: hooks must run unconditionally, and
  // the loading and failure branches below both return.
  const [confirming, setConfirming] = useState(false);

  if (loadFailed) {
    return (
      <>
        <ReviewHeading subtitle={null} />
        <div role="alert" data-testid="review-load-error">
          <p>{REVIEW_LOAD_FAILED}</p>
          {onRetry !== undefined && (
            <button type="button" className="tap-target" onClick={onRetry}>
              {REVIEW_RETRY_LABEL}
            </button>
          )}
        </div>
      </>
    );
  }

  if (loading || review === null) {
    return (
      <>
        <ReviewHeading subtitle={null} />
        <p role="status" data-testid="review-loading">
          {REVIEW_LOADING}
        </p>
      </>
    );
  }

  const { sections } = review;
  const service = SERVICE_LABELS[review.service] ?? review.service;
  const mode = MODE_LABELS[review.mode] ?? review.mode;
  // ⚠ THE COUNT IS THE SERVER'S. `buildReviewResponse` already reports
  // `count: 0` whenever removals are omitted or withheld, so a client-side
  // `omitted ? 0 : count` guard here is not a safeguard - it is a second
  // implementation of the same rule that no test can distinguish from the
  // first, and it would go on agreeing after the server's rule changed.
  const showRemovals = !sections.removals.omitted && !sections.removals.withheld;
  // ⚠ PROPOSALS, NOT TICKS — the same rule TASK-086 put on the server's gate.
  // ⚠ And NOT `showRemovals && …`: a section that was omitted or withheld
  // already arrives with `count: 0` (see the note above), so the conjunct was
  // a second copy of the server's rule that no test could distinguish — it
  // survived mutation, which is the proof. `T-UI-008j` covers the withheld
  // case through the count alone.
  const needsConfirmation = sections.removals.count > 0;

  return (
    <>
      <ReviewHeading subtitle={`${service} · ${mode}`} />

      {review.banner !== null && (
        <p className="review-banner" role="status" data-testid="review-banner">
          {review.banner}
        </p>
      )}

      {sections.additions.count === 0 ? (
        <section className="review-section" data-testid="review-additions">
          {/* ⚠ `T-UX-061`. A BLANK PANEL READS AS A FAILED RENDER, and the
              owner's next move is to upload the same screenshots again. */}
          <div className="review-empty" data-testid="review-additions-empty">
            <p className="review-empty__title">{REVIEW_NO_ADDITIONS_TITLE}</p>
            <p className="review-empty__body">{REVIEW_NO_ADDITIONS_BODY}</p>
          </div>
        </section>
      ) : (
        <CandidateSection section={sections.additions} testId="review-additions" />
      )}

      <CandidateSection section={sections.unmatched} testId="review-unmatched" />
      <CandidateSection section={sections.alreadyOnYourList} testId="review-already-on-list" />
      <CandidateSection section={sections.probablyNotTitles} testId="review-probably-not-titles" />
      <CandidateSection section={sections.unreadableTiles} testId="review-unreadable-tiles" />

      {showRemovals && (
        <section className="review-section" data-testid="review-removals">
          <details open>
            <summary className="review-section__summary">
              {`${sections.removals.label} (${sections.removals.count})`}
            </summary>
            <ul className="review-section__list">
              {sections.removals.items.map((item) => (
                <li className="removal-card" data-testid="removal-card" key={item.listingId}>
                  {/* ⚠ TICKED ON ARRIVAL (REQ-055) AND THE DEFAULT COMES FROM
                      THE SERVER - re-deriving it here would silently empty a
                      removal group the owner had already seen ticked. There is
                      deliberately NO per-row remove affordance (REQ-020,
                      `T-UI-008`): removals are confirmed as ONE group, so that
                      the owner is never one stray tap from a deletion. */}
                  <label className="removal-card__label">
                    <input type="checkbox" checked={item.ticked} readOnly />
                    {item.name}
                  </label>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {review.imagesWithNoText.length > 0 && (
        <section className="review-section" data-testid="images-with-no-text">
          <ul className="review-section__list">
            {/* ⚠ `T-AI-020`, US-006 AC-3, `specs/ai.md` §8.2: "the image
                thumbnail is shown. NEVER A SILENT SKIP." Both halves matter —
                a bare file name will not pick one screenshot out of twenty
                near-identical ones in a camera roll, and picking the right one
                to retake is the entire action this section exists to enable. */}
            {review.imagesWithNoText.map((image) => (
              <li className="review-no-text" key={image.imageId}>
                <img
                  className="review-no-text__thumb"
                  src={image.href}
                  alt=""
                  data-testid="no-text-thumb"
                />
                <span className="review-empty__body" data-testid="no-text-name">
                  {REVIEW_NO_TEXT_IN.replace('{file}', image.fileName)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ⚠ SD-11d / `T-UX-011`. Sticky, so the primary action and the running
          counts stay reachable through a 200-candidate pass on a phone. */}
      <div className="review-action-bar" data-testid="review-action-bar">
        <p className="review-action-bar__counts" data-testid="review-counts">
          {`${sections.additions.count} to add · ${sections.removals.count} to remove`}
        </p>
        <button
          type="button"
          className="tap-target"
          data-testid="discard-batch-button"
          onClick={onDiscard}
        >
          {REVIEW_DISCARD_LABEL}
        </button>
        <button
          type="button"
          className="tap-target"
          data-testid="apply-changes-button"
          onClick={() => {
            // ⚠ The dialog is not a formality that can be skipped: without
            // removals there is nothing to confirm and the close goes straight
            // through, but with them the owner must see the names first.
            if (needsConfirmation) {
              setConfirming(true);
              return;
            }
            onApply?.(false);
          }}
        >
          {REVIEW_APPLY_LABEL}
        </button>
      </div>

      {confirming && (
        <RemovalConfirmDialog
          service={review.service}
          items={sections.removals.items}
          onCancel={() => {
            // ⚠ Cancel returns to the review with everything intact. It must
            // never fall through to `onApply` — a cancelled confirmation that
            // still closed the batch is the worst outcome this screen has.
            setConfirming(false);
          }}
          onConfirm={() => {
            setConfirming(false);
            onApply?.(true);
          }}
        />
      )}
    </>
  );
}
