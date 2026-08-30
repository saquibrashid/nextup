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

import { useEffect, useState, type JSX } from 'react';
import type { ReviewCandidate, ReviewResponse, ReviewSection } from '@nextup/domain';

import type { TmdbSearchResult } from '../lib/apiClient';

import { CandidateCard, reviewCandidateDomId } from '../components/CandidateCard';
import { CandidateList } from '../components/CandidateList';
import { ManualEntryPanel } from '../components/ManualEntryPanel';
import { RemovalConfirmDialog } from '../components/RemovalConfirmDialog';
import { UnmatchedActions } from '../components/UnmatchedActions';
import {
  effectiveDisposition,
  readLocalDispositions,
  writeLocalDispositions,
  type LocalDispositionMap,
} from '../lib/reviewDispositions';
import {
  REVIEW_APPLY_LABEL,
  REVIEW_APPLYING,
  REVIEW_APPLY_FAILED,
  REVIEW_CONFIRM_ALL,
  REVIEW_DISCARD_LABEL,
  REVIEW_LOADING,
  REVIEW_NO_TEXT_IN,
  REVIEW_LOAD_FAILED,
  REVIEW_NO_ADDITIONS_BODY,
  REVIEW_NO_ADDITIONS_TITLE,
  REVIEW_RETRY_LABEL,
  REVIEW_SECTION_EMPTY,
  REVIEW_TITLE,
  reviewPendingAdditions,
} from '../copy';

export interface ReviewPageProps {
  readonly review?: ReviewResponse | null;
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  readonly onRetry?: () => void;
  /**
   * `specs/ux-states.md` §6.16 — the last close attempt failed with a 5xx or a
   * network error. ⚠ This is NOT `loadFailed`: the review is still on screen
   * with every disposition intact (SD-11e). The message renders beside the
   * apply control, and **Apply changes** is the "Try again" — see the action
   * bar. The container clears it the instant a new attempt starts.
   */
  readonly applyFailed?: boolean;
  /**
   * `specs/ux-states.md` §6.12 (`T-UX-064`) — the close is in flight.
   *
   * ⚠ THE ONE CONTROL ON THIS SCREEN THAT MUST NOT FIRE TWICE. `closeBatch` is
   * the batch's single irreversible transition; a second one lands on a batch
   * that is no longer `in-review` and is refused 409 `BATCH_NOT_IN_REVIEW`, so
   * a double-tap yields a success immediately followed by a spurious error the
   * owner has no way to interpret. Disabling covers **both** buttons: a
   * discard issued while a close is in flight is a genuine race over which
   * terminal state the batch ends in, not merely a wasted request.
   */
  readonly applying?: boolean;
  /**
   * `specs/ux-states.md` §6.14 (`T-UX-066`) — the candidate ids the server
   * named in a 409 `PENDING_ADDITIONS` when the owner tried to close. Non-null
   * renders the inline *"N titles still need a decision."* alert beside the
   * apply control and moves focus to the first of these cards. Nothing was
   * applied; **Apply changes** is the retry. `null` when the last close did
   * not 409 on pending additions — the container clears it at each attempt.
   */
  readonly pendingAdditionIds?: readonly string[] | null;
  /**
   * `specs/ux-states.md` §6.15 (`T-REV-005`) — a monotonic nonce the container
   * bumps when the server refuses the close with 409 `REMOVALS_NOT_CONFIRMED`.
   * Each bump re-opens the §6.10 removal dialog so the owner confirms the
   * group before the close is retried with `confirmRemovals: true`. ⚠ A nonce,
   * not a boolean: the client's `needsConfirmation` can be `false` while the
   * server still has removals to confirm (the two views diverged), and the
   * dialog must re-open on EVERY such refusal, including a second identical
   * one — a boolean would latch after the first.
   */
  readonly reconfirmSignal?: number;
  /**
   * ⚠ Takes `confirmRemovals`, which the container sends verbatim to
   * `POST /api/batches/:id/close`. It is `true` **only** when the owner has
   * been through the §6.10 dialog: a page that always sent `true` would make
   * REQ-020's group confirmation a formality, and one that always sent `false`
   * would 409 every full-update close.
   */
  readonly onApply?: (confirmRemovals: boolean) => void;
  readonly onDiscard?: () => void;
  /**
   * SD-11a. Called with the section whose pending candidates the owner just
   * bulk-confirmed; the container sends it to
   * `POST /api/batches/:id/candidates/confirm-all`.
   */
  readonly onConfirmAll?: (section: ConfirmableSection) => void;
  /**
   * TASK-067 — the §6.29 search behind the manual-entry panel. Optional, and
   * the panel renders ONLY when both halves are supplied: a search box with no
   * add, or an add with no search, is worse than no panel at all.
   */
  readonly onSearchTmdb?: (query: string) => Promise<TmdbSearchResult[]>;
  /** TASK-067 — §6.20. Rejects with the server's refusal code on the two 409s. */
  readonly onManualEntry?: (result: TmdbSearchResult) => Promise<void>;
  /**
   * TASK-068 — the §6.8 unmatched actions, all three §6.18 patches.
   *
   * ⚠ The actions render ONLY when all three, plus `onSearchTmdb`, are
   * supplied. A card offering "keep" with no "discard", or a "find a match"
   * with no search behind it, is a control that does nothing — and on this
   * screen a control that does nothing is indistinguishable from a decision
   * the owner believes they have made.
   */
  readonly onKeepUnmatched?: (candidateId: string) => Promise<void>;
  /** TASK-068 — §6.18 `{ disposition: 'discarded' }`. */
  readonly onDiscardUnmatched?: (candidateId: string) => Promise<void>;
  /** TASK-068 — §6.18 `{ disposition: 'corrected', tmdbId, mediaType }`. */
  readonly onMatchUnmatched?: (candidateId: string, result: TmdbSearchResult) => Promise<void>;
  /**
   * SD-11e. Injectable so the persistence rule is testable, and OPTIONAL so a
   * environment without one (SSR, a locked-down browser) renders normally
   * instead of throwing — see `lib/reviewDispositions.ts`.
   */
  readonly storage?: Storage;
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

/**
 * SD-11a — the sections a "Confirm all N" control may appear in, and the ONLY
 * ones the server's `POST …/candidates/confirm-all` accepts (TASK-066).
 *
 * ⚠ `alreadyOnYourList` IS DELIBERATELY ABSENT even though the server permits
 * it. `T-REV-016` requires that section to carry no interactive control at
 * all: those titles are already on the list, so confirming them is either a
 * no-op or a duplicate-identity add the server refuses. The API accepts the
 * section for a caller that is not this screen; this screen must not offer it.
 */
export type ConfirmableSection = 'additions' | 'unmatched';

/**
 * The cropped-tile thumbnail source for a candidate (`specs/ui.md` §5.3a).
 *
 * ⚠ DERIVED FROM `sourceImageIds`, PASSED IN — never invented by the caller of
 * `CandidateCard`. §5.3a requires the tile beside `inferred-unverified` and
 * `unreadable-tile`, the review-side half of the RSK-028 (fabrication)
 * mitigation. There is no crop endpoint; the only bytes served are the whole
 * uploaded screenshot at `GET /api/images/:imageId` (`specs/api.md` §6.27),
 * mirroring the `imagesWithNoText.href` shape the route already emits.
 *
 * ⚠ `noUncheckedIndexedAccess` makes `sourceImageIds[0]` `string | undefined`:
 * a candidate with no source image yields `null`, so `CandidateCard` renders
 * no broken `<img>` rather than an empty `src`.
 */
function thumbnailUrlFor(candidate: ReviewCandidate): string | null {
  const imageId = candidate.sourceImageIds[0];
  return imageId === undefined ? null : `/api/images/${encodeURIComponent(imageId)}`;
}

function CandidateSection({
  section,
  testId,
  confirmAll,
  pendingCount,
  renderCard,
}: {
  readonly section: SectionView;
  readonly testId: string;
  /** Omitted ⇒ the section carries no bulk control at all (see above). */
  readonly confirmAll?: () => void;
  readonly pendingCount?: number;
  /** Overrides the card rendering — the §6.8 unmatched treatment uses it. */
  readonly renderCard?: (candidate: ReviewCandidate) => JSX.Element;
}): JSX.Element | null {
  // ⚠ ABSENT, not hidden (REQ-022, `T-REM-011`).
  if (section.omitted === true) return null;

  // ⚠ THE COUNT ON THE BUTTON IS THE NUMBER OF DECISIONS THE PRESS WOULD MAKE,
  // not the size of the section. Once some rows are already confirmed, a
  // button reading "Confirm all 9" over 3 undecided rows is a false promise
  // about what one tap is about to do — and with nothing left to decide the
  // control disappears rather than reading "Confirm all 0".
  const remaining = pendingCount ?? 0;
  const showConfirmAll = confirmAll !== undefined && remaining > 0;

  return (
    <section className="review-section" data-testid={testId}>
      <details open={section.collapsedByDefault !== true}>
        <summary className="review-section__summary">
          {/* The count sits INSIDE the summary so it is legible while
              collapsed (SD-11b) - it is the owner's only sanity check against
              a silently under-read batch. */}
          {`${section.label} (${section.count})`}
        </summary>
        {showConfirmAll && (
          <button
            className="tap-target review-section__confirm-all"
            data-testid="confirm-all-button"
            onClick={confirmAll}
            type="button"
          >
            {REVIEW_CONFIRM_ALL.replace('{n}', String(remaining))}
          </button>
        )}
        {section.items.length === 0 ? (
          <p className="review-empty__body" data-testid="review-section-empty">
            {REVIEW_SECTION_EMPTY}
          </p>
        ) : (
          <CandidateList
            items={section.items}
            keyFor={(candidate) => candidate.candidateId}
            renderItem={(candidate) =>
              renderCard === undefined ? (
                <CandidateCard candidate={candidate} thumbnailUrl={thumbnailUrlFor(candidate)} />
              ) : (
                renderCard(candidate)
              )
            }
          />
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
  applyFailed = false,
  applying = false,
  pendingAdditionIds = null,
  reconfirmSignal = 0,
  onRetry,
  onApply,
  onDiscard,
  onConfirmAll,
  onSearchTmdb,
  onManualEntry,
  onKeepUnmatched,
  onDiscardUnmatched,
  onMatchUnmatched,
  storage = typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
}: ReviewPageProps): JSX.Element {
  // ⚠ Declared before the early returns: hooks must run unconditionally, and
  // the loading and failure branches below both return.
  const [confirmAllOverride, setConfirmAllOverride] = useState<LocalDispositionMap | null>(null);
  const [confirming, setConfirming] = useState(false);
  /*
   * ⚠ WHY THE DIALOG IS NOT CLOSED BY AN EFFECT WHEN THE CLOSE FINISHES.
   * §6.12 disables every control while the close is in flight, and the
   * dialog's own Confirm is one of them — so it has to stay mounted for the
   * duration rather than unmounting the instant it is pressed. Closing it
   * again from a `useEffect` on `applying` would race the §6.15 effect below:
   * a 409 `REMOVALS_NOT_CONFIRMED` clears `applying` and bumps the nonce in
   * the SAME render, and the later-declared effect would win and shut the
   * dialog the refusal exists to re-open. Deriving the open state from
   * `applying` instead needs no effect and cannot be ordered wrongly.
   */
  const [confirmedFlight, setConfirmedFlight] = useState(false);

  // §6.14. When the server refuses the close with 409 `PENDING_ADDITIONS`, move
  // focus (and scroll) to the first pending card the owner still has to decide.
  // ⚠ Keyed on the array the container hands down, which is a FRESH array on
  // every refusal, so a second identical refusal re-fires this — the owner who
  // presses Apply again without deciding is taken back to the card, not left
  // wondering why nothing moved. `scrollIntoView` is feature-detected: jsdom
  // does not implement it, and a hard call would throw in every component test
  // that touches this path.
  useEffect(() => {
    if (pendingAdditionIds === null) return;
    for (const candidateId of pendingAdditionIds) {
      const card = document.getElementById(reviewCandidateDomId(candidateId));
      if (card === null) continue;
      if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' });
      card.focus();
      break;
    }
  }, [pendingAdditionIds]);

  // §6.15. A bump of the nonce re-opens the removal dialog: the server refused
  // with 409 `REMOVALS_NOT_CONFIRMED`, so the owner must confirm the group
  // before the close is retried. `reconfirmSignal` starts at 0 and only the
  // container increments it, so this never fires on first render.
  useEffect(() => {
    if (reconfirmSignal > 0) {
      setConfirmedFlight(false);
      setConfirming(true);
    }
  }, [reconfirmSignal]);

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

  // ⚠ SD-11e. READ, not cached in state, so a reload takes the server's
  // dispositions and the cache only ever speaks for rows the server still
  // reports `pending`. The override exists solely so the press the owner just
  // made is visible before the container refetches.
  const local: LocalDispositionMap =
    confirmAllOverride ?? readLocalDispositions(review.batchId, storage);

  const pendingIn = (items: readonly ReviewCandidate[]): number =>
    items.filter(
      (candidate) =>
        effectiveDisposition(candidate.disposition, local[candidate.candidateId]) === 'pending',
    ).length;

  // ⚠ ALL FOUR OR NONE. See `onKeepUnmatched` above: a partly-wired card is a
  // control that silently does nothing, which on the review screen reads as a
  // decision the owner has made.
  const onKeepU = onKeepUnmatched;
  const onDiscardU = onDiscardUnmatched;
  const onMatchU = onMatchUnmatched;
  const onSearchU = onSearchTmdb;
  const unmatchedWired =
    onKeepU !== undefined &&
    onDiscardU !== undefined &&
    onMatchU !== undefined &&
    onSearchU !== undefined;

  const confirmAll = (key: ConfirmableSection): void => {
    const next: Record<string, 'confirmed' | 'discarded'> = { ...local };
    for (const candidate of sections[key].items) {
      // ⚠ Only the pending ones. Overwriting a `discarded` row here would turn
      // a bulk confirm into a silent undo of a decision the owner had already
      // made, which is the one thing a one-tap control must never do.
      if (effectiveDisposition(candidate.disposition, local[candidate.candidateId]) === 'pending') {
        next[candidate.candidateId] = 'confirmed';
      }
    }
    writeLocalDispositions(review.batchId, next, storage);
    setConfirmAllOverride(next);
    onConfirmAll?.(key);
  };

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
        <CandidateSection
          confirmAll={() => {
            confirmAll('additions');
          }}
          pendingCount={pendingIn(sections.additions.items)}
          section={sections.additions}
          testId="review-additions"
        />
      )}

      <CandidateSection
        confirmAll={() => {
          confirmAll('unmatched');
        }}
        pendingCount={pendingIn(sections.unmatched.items)}
        renderCard={(candidate) => (
          <CandidateCard
            candidate={candidate}
            thumbnailUrl={thumbnailUrlFor(candidate)}
            unidentified
            actions={
              unmatchedWired ? (
                <UnmatchedActions
                  candidateId={candidate.candidateId}
                  disposition={effectiveDisposition(
                    candidate.disposition,
                    local[candidate.candidateId],
                  )}
                  onDiscard={onDiscardU}
                  onKeep={onKeepU}
                  onMatch={onMatchU}
                  onSearch={onSearchU}
                />
              ) : null
            }
          />
        )}
        section={sections.unmatched}
        testId="review-unmatched"
      />
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

      {onSearchTmdb !== undefined && onManualEntry !== undefined && (
        <ManualEntryPanel onAdd={onManualEntry} onSearch={onSearchTmdb} />
      )}

      {/* ⚠ SD-11d / `T-UX-011`. Sticky, so the primary action and the running
          counts stay reachable through a 200-candidate pass on a phone. */}
      <div className="review-action-bar" data-testid="review-action-bar">
        {/* ⚠ `specs/ux-states.md` §6.16 (`T-UX-067`). The review above is left
            fully intact — this is not the load-failure state. The message sits
            beside the apply control because **Apply changes** IS the retry: it
            is never disabled here, and re-pressing it re-runs the exact same
            flow, re-opening the §6.10 removal dialog when there are removals so
            `confirmRemovals` is never silently re-applied without the owner. */}
        {applyFailed && (
          <p role="alert" data-testid="review-apply-error">
            {REVIEW_APPLY_FAILED}
          </p>
        )}
        {/* ⚠ `specs/ux-states.md` §6.14 (`T-UX-066`). A 409 `PENDING_ADDITIONS`:
            the close was refused and NOTHING was applied. The count is the
            number of cards the owner still has to decide, and the effect above
            has already moved focus to the first of them. **Apply changes** is
            the retry once the decisions are made. */}
        {pendingAdditionIds !== null && pendingAdditionIds.length > 0 && (
          <p role="alert" data-testid="review-pending-error">
            {reviewPendingAdditions(pendingAdditionIds.length)}
          </p>
        )}
        <p className="review-action-bar__counts" data-testid="review-counts">
          {`${sections.additions.count} to add · ${sections.removals.count} to remove`}
        </p>
        <button
          type="button"
          className="tap-target"
          data-testid="discard-batch-button"
          disabled={applying}
          onClick={onDiscard}
        >
          {REVIEW_DISCARD_LABEL}
        </button>
        <button
          type="button"
          className="tap-target"
          data-testid="apply-changes-button"
          disabled={applying}
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
          {applying ? REVIEW_APPLYING : REVIEW_APPLY_LABEL}
        </button>
      </div>

      {(confirming || (applying && confirmedFlight)) && (
        <RemovalConfirmDialog
          service={review.service}
          items={sections.removals.items}
          submitting={applying}
          onCancel={() => {
            // ⚠ Cancel returns to the review with everything intact. It must
            // never fall through to `onApply` — a cancelled confirmation that
            // still closed the batch is the worst outcome this screen has.
            setConfirmedFlight(false);
            setConfirming(false);
          }}
          onConfirm={() => {
            // Handed to the derived open state above, so the dialog survives
            // the close it just issued and shows §6.12's disabled controls
            // instead of vanishing under the owner's finger.
            setConfirming(false);
            setConfirmedFlight(true);
            onApply?.(true);
          }}
        />
      )}
    </>
  );
}
