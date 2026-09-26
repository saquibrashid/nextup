import { Input } from '../components/ui/Input';
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

import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { ReviewCandidate, ReviewResponse, ReviewSection } from '@nextup/domain';
import { batchSourceLabel, canBulkConfirm } from '@nextup/domain';

import type { TmdbSearchResult } from '../lib/apiClient';

import { CandidateCard, reviewCandidateDomId } from '../components/CandidateCard';
import { CandidateList } from '../components/CandidateList';
import { TileReview, alreadySaved, tileNextStep } from '../components/TileReview';
import { ManualEntryPanel } from '../components/ManualEntryPanel';
import { PhoneReview } from '../components/PhoneReview';
import { RemovalConfirmDialog } from '../components/RemovalConfirmDialog';
import { ReviewSkeleton } from '../components/ReviewSkeleton';
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
  REVIEW_CONSEQUENCE_ADDITION,
  REVIEW_CONSEQUENCE_REMOVAL,
  REVIEW_CONSEQUENCE_UNMATCHED,
  REVIEW_DISCARD_LABEL,
  REVIEW_LOADING,
  REVIEW_NO_TEXT_IN,
  REVIEW_LOAD_FAILED,
  REVIEW_NO_ADDITIONS_BODY,
  REVIEW_NO_ADDITIONS_TITLE,
  REVIEW_REMOVALS_MARKER,
  REVIEW_RETRY_LABEL,
  REVIEW_SECTION_EMPTY,
  REVIEW_TITLE,
  reviewCounts,
  reviewPendingAdditions,
  reviewPhoneSubtitle,
} from '../copy';
import { OFFLINE_DISABLED_REASON } from '../copy';
import { Button } from '../components/ui/Button';
import { CaptureProgress } from '../components/CaptureProgress';
import { Fieldset } from '../components/ui/Fieldset';

export interface ReviewPageProps {
  /**
   * TASK-262 — below `--bp-sm` the review is the owner's phone mockup: an
   * overview of groups and a one-candidate pager (`specs/ui.md` §5.0a).
   */
  readonly phone?: boolean;
  readonly controlled?: boolean;
  readonly hasUnsaved?: boolean;
  readonly reviewTools?: ReactNode;
  readonly onRescueCandidate?: (candidateId: string) => Promise<void>;
  readonly review?: ReviewResponse | null;
  readonly loading?: boolean;
  /**
   * `specs/ux-states.md` §6.1 (`T-UX-060`) — how many candidate cards to draw
   * as placeholders while the review loads, or `null`/absent for the countless
   * skeleton. Carried forward from the batch the owner came from; a cold
   * deep-link into this URL has no such history and gets the countless one.
   */
  readonly skeletonCount?: number | null;
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
  readonly applyRecovery?: JSX.Element | null;
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
  readonly saving?: boolean;
  readonly decisionError?: string | null;
  readonly onPrepare?: () => Promise<ReviewResponse>;
  readonly onToggleRemoval?: (listingId: string, ticked: boolean) => Promise<void>;
  /**
   * §6.17 — the connection is gone. **Apply changes** and **Discard** are
   * disabled with the reason as visible text; everything else on the page
   * keeps working, because dispositions are local until the close.
   */
  readonly offline?: boolean;
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
  readonly onConfirmAll?: (section: ConfirmableSection) => Promise<void> | void;
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
 *
 * ⚠ **`tileCrop.imageId` WINS over `sourceImageIds[0]`.** The crop rectangle
 * is only meaningful against the image it was measured on, and after an SD-02
 * collapse a candidate's source images are not guaranteed to be in the order
 * its boxes were recorded. Cropping image A's rectangle out of image B shows
 * a confidently-wrong region of the wrong screenshot — evidence that looks
 * like evidence and is not.
 */
function thumbnailUrlFor(candidate: ReviewCandidate): string | null {
  const imageId = candidate.tileCrop?.imageId ?? candidate.sourceImageIds[0];
  return imageId === undefined ? null : `/api/images/${encodeURIComponent(imageId)}`;
}

/**
 * REQ-122 — the per-section surface treatments (`specs/ui-refresh.md` §6a.1).
 *
 * ⚠ Presentation only, and it must never decide what a section CONTAINS: a
 * full-update review renders every extracted candidate whatever treatment it
 * wears (`T-UX-136`, product invariant 2). The words on the cards carry the
 * distinction; these rules only reinforce it.
 */
type SectionVariant = 'plain' | 'additions' | 'unmatched';

/**
 * ⚠ A PLAIN ANNOTATED CONST, NOT `as const`: `analyzeClassNames`
 * (`T-UI-032`) reads the initialiser as an object literal, and an `as const`
 * assertion wraps it in an expression the harvester rejects — which is
 * `T-CSS-001c` failing on a file whose classes are, in fact, all literal.
 */
const SECTION_CLASS: Record<SectionVariant, string> = {
  plain: 'review-section',
  additions: 'review-section review-section--additions',
  unmatched: 'review-section review-section--unmatched',
};

function CandidateSection({
  section,
  testId,
  confirmAll,
  confirmDisabled = false,
  pendingCount,
  individualCount = 0,
  renderCard,
  description,
  variant = 'plain',
}: {
  readonly section: SectionView;
  readonly testId: string;
  /** Omitted ⇒ the section carries no bulk control at all (see above). */
  readonly confirmAll?: () => void;
  readonly confirmDisabled?: boolean;
  readonly pendingCount?: number;
  readonly individualCount?: number;
  /** Overrides the card rendering — the §6.8 unmatched treatment uses it. */
  readonly renderCard?: (candidate: ReviewCandidate) => JSX.Element;
  readonly description?: string;
  /**
   * REQ-122 — the section's own surface treatment, as a BEM modifier.
   *
   * ⚠ Presentation only. It must never decide what the section contains: a
   * full-update review renders every extracted candidate whatever the
   * treatment (`T-UX-136`, product invariant 2).
   * ⚠ A MAP, NOT A TEMPLATE LITERAL. `T-CSS-001b/c` harvest the class
   * vocabulary statically, so `review-section--${variant}` would render a
   * class the stylesheet analysis cannot see — and a stylesheet rule nothing
   * could be shown to use.
   */
  readonly variant?: SectionVariant;
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
    <section className={SECTION_CLASS[variant]} data-testid={testId}>
      <details open={section.collapsedByDefault !== true}>
        <summary className="review-section__summary">
          {/* The count sits INSIDE the summary so it is legible while
              collapsed (SD-11b) - it is the owner's only sanity check against
              a silently under-read batch. */}
          {`${section.label} (${section.count})`}
        </summary>
        {description !== undefined && <p className="review-section__description">{description}</p>}
        {individualCount > 0 && (
          <p className="review-section__description">
            {individualCount} readings need individual review and are not included in Confirm all.
          </p>
        )}
        {showConfirmAll && (
          <p className="review-section__confirm-all">
            {/* Layout only — the margin belongs to the section, not the button. */}
            <Button
              variant="secondary"
              data-testid="confirm-all-button"
              disabled={confirmDisabled}
              onClick={confirmAll}
            >
              {REVIEW_CONFIRM_ALL.replace('{n}', String(remaining))}
            </Button>
          </p>
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
      <CaptureProgress stage="review" />
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
  phone = false,
  controlled = false,
  hasUnsaved = false,
  reviewTools,
  onRescueCandidate,
  review = null,
  loading = false,
  skeletonCount = null,
  loadFailed = false,
  applyFailed = false,
  applyRecovery = null,
  applying = false,
  saving = false,
  decisionError = null,
  onPrepare,
  onToggleRemoval,
  offline = false,
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
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [localPending, setLocalPending] = useState<readonly string[] | null>(null);
  const pendingIds = pendingAdditionIds ?? localPending;
  // Keep the summary mounted through Apply and refusals so failures retain
  // their context and a retry always requires another explicit press.

  // §6.14. When the server refuses the close with 409 `PENDING_ADDITIONS`, move
  // focus (and scroll) to the first pending card the owner still has to decide.
  // ⚠ Keyed on the array the container hands down, which is a FRESH array on
  // every refusal, so a second identical refusal re-fires this — the owner who
  // presses Apply again without deciding is taken back to the card, not left
  // wondering why nothing moved. `scrollIntoView` is feature-detected: jsdom
  // does not implement it, and a hard call would throw in every component test
  // that touches this path.
  useEffect(() => {
    if (pendingIds === null) return;
    setConfirming(false);
    for (const candidateId of pendingIds) {
      const card = document.getElementById(reviewCandidateDomId(candidateId));
      if (card === null) continue;
      for (let parent = card.parentElement; parent !== null; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' });
      card.focus();
      break;
    }
  }, [pendingIds]);

  // §6.15. A bump of the nonce re-opens the refreshed summary: the server refused
  // with 409 `REMOVALS_NOT_CONFIRMED`, so the owner must confirm the group
  // before the close is retried. `reconfirmSignal` starts at 0 and only the
  // container increments it, so this never fires on first render.
  useEffect(() => {
    if (reconfirmSignal > 0) {
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
            <Button variant="secondary" onClick={onRetry}>
              {REVIEW_RETRY_LABEL}
            </Button>
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
        <ReviewSkeleton count={skeletonCount ?? null} />
      </>
    );
  }

  const { sections } = review;
  // ⚠ A DISCOVERY capture has no service (ADR-0010 D-1), so the heading names
  // the storefront instead. Reading `SERVICE_LABELS[null]` would render
  // `undefined` in the one place the owner looks to check what they captured.
  const service = batchSourceLabel(review);
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
  const local: LocalDispositionMap = controlled
    ? {}
    : (confirmAllOverride ?? readLocalDispositions(review.batchId, storage));

  const pendingIn = (items: readonly ReviewCandidate[]): number =>
    items.filter(
      (candidate) =>
        effectiveDisposition(candidate.disposition, local[candidate.candidateId]) === 'pending',
    ).length;

  /**
   * How many rows a close would actually WRITE from these items.
   *
   * ⚠ **NOT `sections.additions.count`, which is the section's LENGTH.** The
   * owner reported deciding four cards and then reading "11 to add" — the bar
   * was counting every row in the section, including the seven they had just
   * discarded and any still pending. `applicableCandidates`
   * (`packages/domain/src/close.ts`) applies `confirmed` and `corrected` only;
   * a discard writes nothing, and a pending row does not survive the close's
   * own gate. A count that disagrees with the close is worse than no count:
   * it is the only number the owner has to check a destructive action against.
   *
   * ⚠ Reads through `effectiveDisposition` for the same reason `pendingIn`
   * does — the press just made must be in the number before the refetch lands,
   * or the bar appears to ignore the decision for a beat.
   */
  const applicableIn = (items: readonly ReviewCandidate[]): number =>
    items.filter((candidate) => {
      const disposition = effectiveDisposition(candidate.disposition, local[candidate.candidateId]);
      return disposition === 'confirmed' || disposition === 'corrected';
    }).length;

  const bulkPendingIn = (items: readonly ReviewCandidate[]): number =>
    items.filter((candidate) =>
      canBulkConfirm({
        ...candidate,
        disposition: effectiveDisposition(candidate.disposition, local[candidate.candidateId]),
      }),
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
    if (controlled) {
      void Promise.resolve(onConfirmAll?.(key)).catch(() => {
        setPrepareError(
          'Some decisions were not verified. Check the unsaved choices before continuing.',
        );
      });
      return;
    }
    const next: Record<string, 'confirmed' | 'discarded'> = { ...local };
    for (const candidate of sections[key].items) {
      // ⚠ Only the pending ones. Overwriting a `discarded` row here would turn
      // a bulk confirm into a silent undo of a decision the owner had already
      // made, which is the one thing a one-tap control must never do.
      if (
        canBulkConfirm({
          ...candidate,
          disposition: effectiveDisposition(candidate.disposition, local[candidate.candidateId]),
        })
      ) {
        next[candidate.candidateId] = 'confirmed';
      }
    }
    writeLocalDispositions(review.batchId, next, storage);
    setConfirmAllOverride(next);
    void Promise.resolve(onConfirmAll?.(key)).catch(() => {
      writeLocalDispositions(review.batchId, local, storage);
      setConfirmAllOverride(local);
      setPrepareError('Could not save those decisions. Check the titles and try again.');
    });
  };

  const prepare = async (): Promise<void> => {
    if (preparing || saving || applying || offline || hasUnsaved) return;
    setPreparing(true);
    setPrepareError(null);
    setLocalPending(null);
    try {
      const latest = onPrepare === undefined ? review : await onPrepare();
      if (onPrepare !== undefined) {
        writeLocalDispositions(review.batchId, {}, storage);
        setConfirmAllOverride({});
      }
      const undecided = [...latest.sections.additions.items, ...latest.sections.unmatched.items]
        .filter(
          (item) =>
            (onPrepare === undefined
              ? effectiveDisposition(item.disposition, local[item.candidateId])
              : item.disposition) === 'pending',
        )
        .map((item) => item.candidateId);
      if (undecided.length > 0) {
        setLocalPending(undecided);
        return;
      }
      setConfirming(true);
    } catch {
      setPrepareError(
        'Could not refresh this review. Nothing was applied. Try again when connected.',
      );
    } finally {
      setPreparing(false);
    }
  };
  const additions = [...sections.additions.items, ...sections.unmatched.items].filter((item) => {
    const disposition = effectiveDisposition(item.disposition, local[item.candidateId]);
    return disposition === 'confirmed' || disposition === 'corrected';
  });
  const correctionActions = (
    candidate: ReviewCandidate,
    variant: 'known' | 'correction' = 'correction',
  ) =>
    unmatchedWired ? (
      <UnmatchedActions
        candidateId={candidate.candidateId}
        correctedName={candidate.match?.name ?? null}
        disposition={candidate.disposition}
        controlled={controlled}
        variant={variant}
        alternatives={candidate.alternatives}
        onKeep={onKeepU}
        onDiscard={onDiscardU}
        onMatch={onMatchU}
        onSearch={onSearchU}
      />
    ) : null;
  const extracted =
    review.candidateSummary?.total ??
    sections.additions.count +
      sections.unmatched.count +
      sections.alreadyOnYourList.count +
      sections.probablyNotTitles.count +
      sections.unreadableTiles.count;
  const knownCount = review.candidateSummary?.alreadyKnown ?? sections.alreadyOnYourList.count;
  const allDiscarded =
    sections.additions.items.length > 0 &&
    sections.additions.items.every((candidate) => candidate.disposition === 'discarded');

  const byId = new Map(
    [
      ...sections.additions.items,
      ...sections.unmatched.items,
      ...sections.alreadyOnYourList.items,
      ...sections.probablyNotTitles.items,
      ...sections.unreadableTiles.items,
    ].map((candidate) => [candidate.candidateId, candidate]),
  );
  const tiles = (review.tiles ?? []).map((tile) => ({
    ...tile,
    candidates: tile.candidates.map((candidate) => {
      const current = byId.get(candidate.candidateId) ?? candidate;
      return {
        ...current,
        disposition: effectiveDisposition(current.disposition, local[current.candidateId]),
      };
    }),
  }));
  const groupedIds = new Set(
    tiles.flatMap((tile) => tile.candidates.map((candidate) => candidate.candidateId)),
  );
  const untiled = [
    ...sections.additions.items,
    ...sections.unmatched.items,
    ...sections.alreadyOnYourList.items,
    ...sections.probablyNotTitles.items,
    ...sections.unreadableTiles.items,
  ].filter((candidate) => !groupedIds.has(candidate.candidateId));
  const renderTileCandidate = (candidate: ReviewCandidate, domId?: string): JSX.Element => {
    const current = {
      ...candidate,
      disposition: effectiveDisposition(candidate.disposition, local[candidate.candidateId]),
    };
    return (
      <CandidateCard
        candidate={current}
        {...(domId === undefined ? {} : { domId })}
        sourceShown={(candidate.inputTiles?.length ?? 0) > 0}
        thumbnailUrl={(candidate.inputTiles?.length ?? 0) > 0 ? null : thumbnailUrlFor(candidate)}
        consequence={tileNextStep(current, review.service)}
        unidentified={candidate.match === null && candidate.verdict !== 'chrome-suspected'}
        actions={
          unmatchedWired ? (
            <>
              <UnmatchedActions
                controlled={controlled}
                candidateId={candidate.candidateId}
                alternatives={candidate.alternatives}
                disposition={current.disposition}
                correctedName={candidate.match?.name ?? null}
                variant={
                  candidate.verdict === 'chrome-suspected'
                    ? 'correction'
                    : alreadySaved(candidate)
                      ? 'known'
                      : candidate.match === null
                        ? 'unmatched'
                        : 'addition'
                }
                hideKeep={candidate.verdict === 'unreadable-tile'}
                onDiscard={onDiscardU}
                onKeep={onKeepU}
                onMatch={onMatchU}
                onSearch={onSearchU}
              />
              {candidate.verdict === 'chrome-suspected' && onRescueCandidate !== undefined && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void onRescueCandidate(candidate.candidateId).catch(() =>
                      setPrepareError(
                        'The rescue was not verified. Check the saved review before trying again.',
                      ),
                    );
                  }}
                >
                  This is a title
                </Button>
              )}
            </>
          ) : null
        }
      />
    );
  };

  const reviewLead = (
    <>
      {review.banner !== null && (
        <p className="review-banner" role="status" data-testid="review-banner">
          {review.banner}
        </p>
      )}
      {(review.unsegmentedImages ?? []).map((image) => (
        <p className="review-banner" role="status" key={image.imageId}>
          Tile boundaries could not be verified for{' '}
          <a href={image.href} target="_blank" rel="noreferrer">
            {image.fileName}
          </a>
          . These readings came from the whole screenshot; their count is not a tile count. Check
          the source for missed titles.
        </p>
      ))}
      {/* On phone the coverage card carries these lines under Learn more. */}
      {(phone ? [] : (review.tileCoverage ?? [])).map((image) => (
        <p className="review-guidance" key={image.imageId}>
          <a href={image.href} target="_blank" rel="noreferrer">
            {image.fileName}
          </a>
          {`: ${image.titleCandidates} title candidates; readings located in ${image.locatedTiles} of ${image.detectedTiles} detected tiles.`}
          {
            ' Located readings can include duplicates or misreads; this does not verify every title.'
          }
          {image.locatedTiles < image.detectedTiles &&
            ' Some tiles could not be linked to a title. Compare the screenshot and add any missing titles below; an unlocated tile is not necessarily unread.'}
        </p>
      ))}
      {reviewTools}
      {!confirming && applyRecovery}
      {allDiscarded && (
        <p role="status">
          You discarded every proposed new title. You can change those decisions before applying.
        </p>
      )}
    </>
  );
  const reviewFoot = (
    <>
      {sections.removals.withheld && (
        <p className="review-banner" role="status" data-testid="review-removals-withheld">
          Removals are withheld because this extraction is incomplete. You can still review
          additions; nothing will be removed from your library.
        </p>
      )}

      {showRemovals && (
        <section className="review-section review-section--removals" data-testid="review-removals">
          <details open>
            <summary className="review-section__summary">
              {`${sections.removals.label} (${sections.removals.count})`}
              {/* ⚠ REQ-122's NON-COLOUR consequential marker. The left rule in
                  `index.css` is a reinforcement of this word, never a
                  substitute for it (`specs/ui.md` §10.2) — and the word is
                  also the only half of the treatment a screen reader meets.

                  ⚠ A SIBLING ELEMENT, not appended to the label string:
                  `getNodeText` reads only direct text-node children, so the
                  existing `(2)` count assertions (`T-UX-099a/b`) still match
                  the summary exactly as before. */}
              <span className="review-section__marker" data-testid="review-section-marker">
                {REVIEW_REMOVALS_MARKER}
              </span>
            </summary>
            <p className="review-section__description">
              {sections.removals.count === 0
                ? 'No removals are proposed for this import.'
                : 'These titles were not found in this capture. Check the screenshots before agreeing to remove them from this service.'}
            </p>
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
                    <Input
                      type="checkbox"
                      checked={item.ticked}
                      readOnly={onToggleRemoval === undefined}
                      disabled={offline && !controlled}
                      onChange={(event) => {
                        void onToggleRemoval?.(item.listingId, event.currentTarget.checked).catch(
                          () => {
                            setPrepareError(
                              'Could not verify the removal choice. Review it before applying.',
                            );
                          },
                        );
                      }}
                    />
                    {item.name}
                  </label>
                  {/* ⚠ REQ-122 / `T-UX-134`. On the CARD, because a
                      full-update review is scrolled and the heading above is
                      off-screen by the time this row is read. Without it a
                      removal card and an addition card are the same object. */}
                  <p className="removal-card__consequence" data-testid="candidate-consequence">
                    {item.ticked ? REVIEW_CONSEQUENCE_REMOVAL : 'Stays in your library'}
                  </p>
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
        {applyFailed && !confirming && (
          <p role="alert" data-testid="review-apply-error">
            {REVIEW_APPLY_FAILED}
          </p>
        )}
        {/* ⚠ `specs/ux-states.md` §6.14 (`T-UX-066`). A 409 `PENDING_ADDITIONS`:
            the close was refused and NOTHING was applied. The count is the
            number of cards the owner still has to decide, and the effect above
            has already moved focus to the first of them. **Apply changes** is
            the retry once the decisions are made. */}
        {pendingIds !== null && pendingIds.length > 0 && (
          <p role="alert" data-testid="review-pending-error">
            {reviewPendingAdditions(pendingIds.length)}
          </p>
        )}
        {/* ⚠ `specs/ux-states.md` §6.17 (`T-UX-023`). Offline disables the
            close — it is a `POST` — and states why, as visible text. What it
            deliberately does NOT do is unmount, reset or discard anything: the
            dispositions above keep working locally, exactly as §6.17 requires,
            and are still there on reconnect. An offline state that recovers by
            throwing away a half-finished review is the data-loss bug
            `T-UX-024` exists to catch. */}
        {offline && (
          <p className="offline-reason" data-testid="review-offline-reason">
            {OFFLINE_DISABLED_REASON}
          </p>
        )}
        {(prepareError ?? decisionError) !== null && (
          <p role="alert">{prepareError ?? decisionError}</p>
        )}
        <p className="review-action-bar__counts" data-testid="review-counts">
          {reviewCounts(
            applicableIn(sections.additions.items) + applicableIn(sections.unmatched.items),
            sections.removals.items.filter((item) => item.ticked).length,
            pendingIn(sections.additions.items) + pendingIn(sections.unmatched.items),
          )}
        </p>
        <Button
          variant="secondary"
          data-testid="discard-batch-button"
          disabled={applying || offline}
          onClick={onDiscard}
        >
          {REVIEW_DISCARD_LABEL}
        </Button>
        <Button
          variant="primary"
          data-testid="apply-changes-button"
          disabled={applying || offline || hasUnsaved}
          onClick={() => {
            void prepare();
          }}
        >
          {preparing ? 'Refreshing review...' : applying ? REVIEW_APPLYING : REVIEW_APPLY_LABEL}
        </Button>
      </div>
    </>
  );
  const confirmDialog = confirming && (
    <RemovalConfirmDialog
      recovery={applyRecovery}
      service={review.service}
      items={sections.removals.items}
      additions={additions}
      editionUpdates={sections.alreadyOnYourList.items.filter(
        (item) =>
          item.match?.edition !== undefined &&
          ['confirmed', 'corrected'].includes(
            effectiveDisposition(item.disposition, local[item.candidateId]),
          ),
      )}
      submitting={applying}
      disabled={offline || saving || decisionError !== null}
      error={applyFailed ? REVIEW_APPLY_FAILED : decisionError}
      offline={offline}
      onCancel={() => {
        // ⚠ Cancel returns to the review with everything intact. It must
        // never fall through to `onApply` — a cancelled confirmation that
        // still closed the batch is the worst outcome this screen has.
        if (!applying) setConfirming(false);
      }}
      onConfirm={() => {
        // Handed to the derived open state above, so the dialog survives
        // the close it just issued and shows §6.12's disabled controls
        // instead of vanishing under the owner's finger.
        if (!applying && !offline && !saving) onApply?.(needsConfirmation);
      }}
    />
  );

  if (phone) {
    // TASK-262 — the owner's phone mockup (`specs/ui.md` §5.0a). The same
    // sections, handlers, banners, removals and action bar as the wide page;
    // only the arrangement of the candidates changes.
    return (
      <div className="review-flow review-flow--phone">
        <Fieldset legend="Review decisions" hideLegend disabled={applying || saving || preparing}>
          <PhoneReview
            review={review}
            subtitle={reviewPhoneSubtitle(extracted, service, mode)}
            controlled={controlled}
            dispositionOf={(candidate) =>
              effectiveDisposition(candidate.disposition, local[candidate.candidateId])
            }
            thumbnailUrlFor={thumbnailUrlFor}
            bulkCount={bulkPendingIn(sections.additions.items)}
            confirmAllDisabled={hasUnsaved}
            onConfirmAll={() => {
              confirmAll('additions');
            }}
            onKeep={unmatchedWired ? onKeepU : undefined}
            onDiscard={unmatchedWired ? onDiscardU : undefined}
            onMatch={unmatchedWired ? onMatchU : undefined}
            onSearch={onSearchTmdb}
            onRescue={
              onRescueCandidate === undefined
                ? undefined
                : (candidateId) =>
                    onRescueCandidate(candidateId).catch((error: unknown) => {
                      setPrepareError(
                        'The rescue was not verified. Check the saved review before trying again.',
                      );
                      throw error;
                    })
            }
            onManualEntry={onManualEntry}
            pendingIds={pendingIds}
            lead={reviewLead}
            tail={reviewFoot}
          />
        </Fieldset>
        {confirmDialog}
      </div>
    );
  }

  return (
    <div className="review-flow">
      <ReviewHeading subtitle={`${service} · ${mode}`} />
      <p className="review-guidance">
        Decide the new titles first, then check the remaining evidence. When you are finished,
        choose Apply changes to review and finish this import. Nothing changes in your library
        before that.
      </p>

      {reviewLead}

      <Fieldset legend="Review decisions" hideLegend disabled={applying || saving || preparing}>
        {tiles.length > 0 ? (
          <>
            {bulkPendingIn(sections.additions.items) > 0 && (
              <Button
                variant="secondary"
                disabled={hasUnsaved}
                onClick={() => confirmAll('additions')}
              >
                Confirm all {bulkPendingIn(sections.additions.items)} clear new matches
              </Button>
            )}
            <TileReview tiles={tiles} renderCandidate={renderTileCandidate} />
            {untiled.length > 0 && (
              <section className="review-section">
                <h2>Other readings without a verified tile</h2>
                <p>These readings still need review. Their location has not been verified.</p>
                {untiled.map((candidate) => (
                  <div key={candidate.candidateId}>{renderTileCandidate(candidate)}</div>
                ))}
              </section>
            )}
          </>
        ) : (
          <>
            {sections.additions.count === 0 ? (
              <section className="review-section" data-testid="review-additions">
                {/* ⚠ `T-UX-061`. A BLANK PANEL READS AS A FAILED RENDER, and the
              owner's next move is to upload the same screenshots again. */}
                <div className="review-empty" data-testid="review-additions-empty">
                  <p className="review-empty__title">
                    {extracted === 0
                      ? 'No extracted titles are available to review'
                      : sections.unmatched.count > 0
                        ? 'Some titles still need identification'
                        : knownCount === extracted
                          ? REVIEW_NO_ADDITIONS_TITLE
                          : 'No new titles are ready to add'}
                  </p>
                  <p className="review-empty__body">
                    {extracted > 0 && knownCount === extracted
                      ? REVIEW_NO_ADDITIONS_BODY
                      : 'Check the screenshots and remaining evidence below. You can identify a title manually or read the screenshots again.'}
                  </p>
                </div>
              </section>
            ) : (
              <CandidateSection
                description="Check each proposed match against the screenshot text. Confirm only the titles you want to keep."
                confirmAll={() => {
                  confirmAll('additions');
                }}
                pendingCount={bulkPendingIn(sections.additions.items)}
                individualCount={
                  pendingIn(sections.additions.items) - bulkPendingIn(sections.additions.items)
                }
                confirmDisabled={hasUnsaved}
                renderCard={(candidate) => (
                  <CandidateCard
                    candidate={candidate}
                    thumbnailUrl={thumbnailUrlFor(candidate)}
                    consequence={
                      effectiveDisposition(candidate.disposition, local[candidate.candidateId]) ===
                      'discarded'
                        ? 'Not included in these changes'
                        : REVIEW_CONSEQUENCE_ADDITION
                    }
                    actions={
                      /* ⚠ TASK-200 / `specs/ui.md` §5.3. Before this the additions
                   section had NO per-card control, so one false extra among
                   ten good rows — a fragment like "LEVANTE" split off
                   "SOL LEVANTE" — could only be rejected by abandoning the
                   whole batch. `unmatchedWired` is reused deliberately: the
                   same four handlers serve both sections, and all-four-or-none
                   still applies. */
                      unmatchedWired ? (
                        <UnmatchedActions
                          controlled={controlled}
                          candidateId={candidate.candidateId}
                          correctedName={candidate.match?.name ?? null}
                          disposition={effectiveDisposition(
                            candidate.disposition,
                            local[candidate.candidateId],
                          )}
                          onDiscard={onDiscardU}
                          onKeep={onKeepU}
                          onMatch={onMatchU}
                          onSearch={onSearchU}
                          variant="addition"
                        />
                      ) : null
                    }
                  />
                )}
                section={sections.additions}
                testId="review-additions"
                variant="additions"
              />
            )}

            <CandidateSection
              description="These readings need your help. Keep the text as an unidentified title, find a match, or discard it."
              confirmAll={() => {
                confirmAll('unmatched');
              }}
              pendingCount={bulkPendingIn(sections.unmatched.items)}
              individualCount={
                pendingIn(sections.unmatched.items) - bulkPendingIn(sections.unmatched.items)
              }
              confirmDisabled={hasUnsaved}
              renderCard={(candidate) => (
                <CandidateCard
                  candidate={candidate}
                  thumbnailUrl={thumbnailUrlFor(candidate)}
                  unidentified
                  consequence={
                    effectiveDisposition(candidate.disposition, local[candidate.candidateId]) ===
                    'discarded'
                      ? 'Not included in these changes'
                      : REVIEW_CONSEQUENCE_UNMATCHED
                  }
                  actions={
                    unmatchedWired ? (
                      <UnmatchedActions
                        controlled={controlled}
                        candidateId={candidate.candidateId}
                        correctedName={candidate.match?.name ?? null}
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
              variant="unmatched"
            />
            <CandidateSection
              section={sections.alreadyOnYourList}
              testId="review-already-on-list"
              description="These titles are already saved. Confirm the matches you have checked, or change a match if needed. They will not be added again."
              renderCard={(candidate) => (
                <CandidateCard
                  candidate={candidate}
                  thumbnailUrl={thumbnailUrlFor(candidate)}
                  consequence="Stays in your library"
                  actions={correctionActions(candidate, 'known')}
                />
              )}
            />
            <details
              className="review-secondary"
              data-testid="review-secondary"
              open={sections.unreadableTiles.count > 0}
            >
              <summary className="review-section__summary">
                {`Other extracted items (${sections.probablyNotTitles.count + sections.unreadableTiles.count})`}
              </summary>
              <p className="review-section__description">
                Nothing here is silently added. Inspect the evidence; use manual entry below if a
                title was missed.
              </p>
              <CandidateSection
                section={sections.probablyNotTitles}
                testId="review-probably-not-titles"
                renderCard={(candidate) => (
                  <CandidateCard
                    candidate={candidate}
                    thumbnailUrl={thumbnailUrlFor(candidate)}
                    actions={
                      <>
                        {correctionActions(candidate)}
                        {onRescueCandidate !== undefined && (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              void onRescueCandidate(candidate.candidateId).catch(() =>
                                setPrepareError(
                                  'The rescue was not verified. Check the saved review before trying again.',
                                ),
                              );
                            }}
                          >
                            This is a title
                          </Button>
                        )}
                      </>
                    }
                  />
                )}
              />
              <CandidateSection
                section={sections.unreadableTiles}
                testId="review-unreadable-tiles"
                renderCard={(candidate) => (
                  <CandidateCard
                    candidate={candidate}
                    thumbnailUrl={thumbnailUrlFor(candidate)}
                    actions={correctionActions(candidate)}
                  />
                )}
              />
            </details>
          </>
        )}

        {reviewFoot}
      </Fieldset>

      {confirmDialog}
    </div>
  );
}
