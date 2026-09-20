/**
 * TASK-178 — the review container (`specs/ui.md` §5, §12.6, ADR-0012).
 *
 * ⚠ **`ReviewPage` WAS MOUNTED BARE ON THE SCREEN THE PRODUCT LIVES OR DIES
 * ON.** `onApply`, `onDiscard` and `onConfirmAll` had no producer at all: the
 * endpoints have existed since TASK-066 and TASK-071 and were unreachable from
 * the SPA, so the owner could complete a whole review pass and close nothing.
 *
 * Every decision write and final preflight re-reads the authoritative review.
 * Preserve the mounted page during these reads so focus and scroll survive.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';

import type { ReviewResponse } from '@nextup/domain';

import {
  apiClient,
  ApiError,
  RefusedError,
  setUnauthorizedHandler,
  type ApiClient,
  type CandidatePatchBody,
  type CloseBatchResult,
} from '../lib/apiClient';
import { SESSION_ENDED_REVIEW_BODY } from '../copy';
import { type AppliedBatch } from '../components/BatchAppliedNotice';
import { parseSkeletonCount } from '../components/ReviewSkeleton';
import { useResource } from '../lib/useResource';
import { useOnline } from '../lib/useOnline';
import { RefusalPage } from '../pages/RefusalPage';
import { ReviewPage, type ConfirmableSection } from '../pages/ReviewPage';
import { useReviewDecisions, intentLabel } from '../lib/useReviewDecisions';
import { Button } from '../components/ui/Button';
import { ReviewRecovery } from '../components/ReviewRecovery';

export interface ReviewRouteProps {
  readonly client?: ApiClient;
}

/**
 * The §6.22 close response, narrowed to what the notice needs.
 *
 * ⚠ **`service` MOVES.** The wire nests it under `serviceState`, the notice
 * reads it flat, and nothing in between would have caught the difference: a
 * mis-mapped `service` renders `undefined` inside the summary sentence rather
 * than throwing. Mapping here keeps the wire shape at the one boundary that
 * knows it, and leaves `ListRoute` free to distrust whatever history hands it.
 */
export function toAppliedBatch(result: CloseBatchResult): AppliedBatch {
  return {
    batchId: result.batchId,
    service: result.serviceState.service,
    summary: {
      listingsCreated: result.summary.listingsCreated,
      listingsRemoved: result.summary.listingsRemoved,
      removalGroupId: result.summary.removalGroupId,
    },
    undoable: result.undoable,
  };
}

/**
 * The `details.pendingCandidateIds` a 409 `PENDING_ADDITIONS` carries
 * (`specs/api.md` §7.9), narrowed defensively: `ApiError.details` is
 * `Record<string, unknown>`, and a malformed body must degrade to "the count
 * is unknown" rather than throw INSIDE the rejection handler — a throw there
 * would be swallowed by the promise and the owner would get no feedback at
 * all, the very defect §6.14 exists to remove.
 */
export function pendingCandidateIdsFrom(details: Record<string, unknown>): readonly string[] {
  const ids = details['pendingCandidateIds'];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function ReviewRoute(props: ReviewRouteProps = {}): JSX.Element {
  const { batchId } = useParams();
  return <ReviewContent key={batchId} {...props} />;
}

function ReviewContent({ client = apiClient }: ReviewRouteProps): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const batchId = params['batchId'] ?? '';

  /**
   * §6.1 (`T-UX-060`) — the placeholder count carried forward from the batch
   * screen, or `null` on a cold deep-link into this URL.
   *
   * ⚠ **READ ONCE, NOT PER RENDER.** `navigate('/', { state: … })` on a close
   * and the browser's own restoration both rewrite `location.state`; re-reading
   * it would let the skeleton change shape underneath a load already in
   * flight. It describes the batch we arrived for, so it is fixed on arrival.
   */
  const [skeletonCount] = useState<number | null>(() => parseSkeletonCount(location.state));

  /*
   * §6.17 — no refetch on reconnect. The review the owner is working through
   * is the review they loaded; silently replacing it under them would discard
   * every disposition they had made while offline, which is exactly the
   * data-loss `T-UX-024` pairs with `T-UX-023` to prevent.
   */
  const online = useOnline();

  // `specs/ux-states.md` §6.16. `true` when the last close attempt failed with
  // a 5xx or a network error; cleared the instant a new attempt starts, so a
  // subsequent success never leaves a stale error on screen during navigation.
  const [applyFailed, setApplyFailed] = useState(false);
  /** §6.12 — the close is in flight; the sticky bar's controls are disabled. */
  const [applying, setApplying] = useState(false);

  // `specs/ux-states.md` §6.14. The candidate ids the server named in a 409
  // `PENDING_ADDITIONS`, or `null` when the last close did not refuse that way.
  // A FRESH array on every refusal, so `ReviewPage`'s focus effect re-fires
  // even when the owner presses Apply again without deciding anything.
  const [pendingAdditionIds, setPendingAdditionIds] = useState<readonly string[] | null>(null);

  // `specs/ux-states.md` §6.15. Bumped on every 409 `REMOVALS_NOT_CONFIRMED`
  // to re-open the §6.10 removal dialog. Monotonic so a second identical
  // refusal still re-opens it (a boolean would latch after the first).
  const [reconfirmSignal, setReconfirmSignal] = useState(0);
  const [freshReview, setFreshReview] = useState<ReviewResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const writing = useRef(false);
  const closing = useRef(false);

  const refresh = useCallback(async () => {
    const next = await client.getReview(batchId);
    setFreshReview(next);
    setDecisionError(null);
    return next;
  }, [batchId, client]);

  const decide = useCallback(
    async (action: () => Promise<unknown>): Promise<void> => {
      if (writing.current || closing.current || !online) {
        throw new Error('Wait for the current action or reconnect before making this decision.');
      }
      writing.current = true;
      setSaving(true);
      setDecisionError(null);
      try {
        await action();
        await refresh();
      } catch (error) {
        setDecisionError(
          'The decision could not be verified. Review your choices before continuing.',
        );
        throw error;
      } finally {
        writing.current = false;
        setSaving(false);
      }
    },
    [online, refresh],
  );

  /*
   * `specs/ux-states.md` §6.18 (`T-UX-069`) — the sign-in URL a 401 produced,
   * or `null` while the session is live.
   *
   * ⚠ **The review is the one screen that intercepts its own 401 instead of
   * bouncing to the IdP.** Everywhere else the redirect is right (see
   * `apiClient.request`), but here the owner has uncommitted dispositions and
   * a silent bounce gives them no reason to believe those survived — so §6.18
   * requires the screen to say so first and let them press **Sign in**.
   *
   * ⚠ The handler is registered for the LIFETIME OF THIS SCREEN and cleared on
   * unmount. Leaving it installed would disable the redirect app-wide from a
   * screen the owner is no longer on.
   */
  const [sessionEndedHref, setSessionEndedHref] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler((url) => setSessionEndedHref(url));
    return () => setUnauthorizedHandler(null);
  }, []);

  const review = useResource((signal) => client.getReview(batchId, signal), `review:${batchId}`);

  /*
   * ⚠ THE PREVIOUS REVIEW IS HELD ACROSS A REFETCH, AND THAT IS THE WHOLE FIX
   *   FOR THE SCROLL JUMP (TASK-291, reported from the owner's phone).
   *
   * Before TASK-291, every decision on a card bumped the resource key,
   * returning the hook to `loading`. `ReviewPage` rendered the skeleton, so the entire
   * list unmounted and the page collapsed to skeleton height on EVERY action.
   * The browser has nowhere to keep the scroll offset, so the owner was thrown
   * back to the top of a long review and had to find their place again after
   * each of ~19 rows. Focus went with it.
   *
   * Holding the last good value keeps the list mounted while the refetch is in
   * flight, so the scroll position and focus survive because nothing moved.
   * The §6.1 skeleton still renders on the FIRST load, where there is nothing
   * to preserve and the owner is waiting on content rather than looking at it.
   *
   * ⚠ Reset on `batchId`, not just held. Without that, navigating to a second
   * batch would show the first batch's rows under the new URL until its load
   * landed — a wrong list the owner could act on.
   *
   * ⚠ Declared HERE, with the other hooks, and not beside the JSX that uses
   * it: the screen early-returns for a dead session and for a refusal, and a
   * hook below those runs conditionally. React counts hooks per render, so
   * that is not a style point — it throws the moment a 401 arrives.
   */
  const previous = useRef<{ batchId: string; value: ReviewResponse } | null>(null);
  if (review.resource.kind === 'ok') {
    previous.current = { batchId, value: review.resource.value };
  } else if (previous.current !== null && previous.current.batchId !== batchId) {
    previous.current = null;
  }
  const held = previous.current?.batchId === batchId ? previous.current.value : null;
  const shown =
    freshReview?.batchId === batchId
      ? freshReview
      : review.resource.kind === 'ok'
        ? review.resource.value
        : held;
  const decisions = useReviewDecisions({
    batchId,
    client,
    online,
    review: shown,
    writing,
    closing,
    refresh,
    setSaving,
    setError: setDecisionError,
  });

  const confirmAll = useCallback(
    (section: ConfirmableSection) => decisions.confirmAll(section),
    [decisions],
  );

  const apply = useCallback(
    (confirmRemovals: boolean): void => {
      if (closing.current || writing.current || !online || decisions.intents.length > 0) return;
      closing.current = true;
      // `confirmRemovals` is carried through EXACTLY as the page computed it:
      // it is `true` only once the owner has been through the §6.10 dialog.
      //
      // ⚠ **THE CLOSE RESULT IS CARRIED TO THE LIST, NOT DISCARDED.** US-017
      // AC-1 requires the undo to be offered *immediately* after confirmation,
      // and `BatchAppliedNotice` on `/` is where §6.13 puts it. This route
      // previously ran `.then(() => navigate('/'))`, dropping the only copy of
      // the summary that exists — `removalGroupId` and `undoable` are not
      // derivable from `GET /api/titles`, so the notice could never render and
      // the owner who mis-ticked a removal had no offered way back.
      //
      // History state, not a store: it belongs to THIS navigation. A module
      // variable would re-show the notice on the next visit to `/`, and the
      // back button would take the owner to a screen still claiming a batch
      // had just been applied.
      //
      // Clear any prior §6.16 / §6.14 error the moment a fresh attempt starts,
      // or a subsequent success leaves a stale "couldn't apply" / "titles still
      // need a decision" alert on screen. The §6.15 nonce is monotonic and is
      // not reset here — bumping it is what re-opens the dialog, and it never
      // renders anything by itself.
      setApplyFailed(false);
      setPendingAdditionIds(null);
      setApplying(true);
      void client.closeBatch(batchId, confirmRemovals).then(
        (result) => {
          // ⚠ `applying` is deliberately NOT cleared here. The navigation is
          // the terminal state; clearing it first re-enables both buttons for
          // the frame before the route changes, which is exactly the window a
          // double-tap lands in.
          navigate('/', { state: { applied: toAppliedBatch(result) } });
        },
        (error: unknown) => {
          // A failed close must NOT navigate: the batch is still in review and
          // the list has not changed. Sending the owner to `/` would show them
          // an unchanged list as though the close had succeeded.
          //
          // ⚠ Each close-error state is DISTINCT and routed on its own code —
          // §6.16's "nothing was changed, try again" wording is wrong for the
          // others, so an empty or catch-all handler is a defect, not caution:
          //
          //   - 409 `PENDING_ADDITIONS` (§6.14) → name the still-pending
          //     candidates and send the owner to the first card to decide it.
          //   - 409 `REMOVALS_NOT_CONFIRMED` (§6.15) → re-open the §6.10 removal
          //     dialog so the owner confirms the group, then retries with
          //     `confirmRemovals: true`. Reachable when the client's and the
          //     server's view of "are there removals" diverged.
          //   - 401 (§6.18) is handled by the screen-scoped handler installed
          //     above, which renders the session-ended page instead of
          //     redirecting; every other 4xx (a refusal) is not a "try again"
          //     case either.
          //   - Only a 5xx or a network failure is §6.16.
          //
          // ⚠ CLEARED BEFORE THE BRANCHING, NOT INSIDE EACH ARM. Every one of
          // these arms leaves the owner on the review with something to do,
          // and three of them `return` early — a per-arm clear would be
          // forgotten by exactly the arm that was added last, leaving the
          // owner with a permanently dead **Apply changes** button and no way
          // to retry the close.
          setApplying(false);
          closing.current = false;
          if (error instanceof ApiError) {
            if (error.code === 'PENDING_ADDITIONS') {
              setPendingAdditionIds(pendingCandidateIdsFrom(error.details));
              return;
            }
            if (error.code === 'REMOVALS_NOT_CONFIRMED') {
              setSaving(true);
              void refresh()
                .then(
                  () => setReconfirmSignal((n) => n + 1),
                  () =>
                    setDecisionError(
                      'Could not refresh the removal proposals. Go back and try again.',
                    ),
                )
                .finally(() => setSaving(false));
              return;
            }
          }
          if (error instanceof RefusedError) return;
          setApplyFailed(true);
        },
      );
    },
    [batchId, client, navigate, online, refresh, decisions.intents.length],
  );

  const discard = useCallback((): void => {
    if (writing.current || closing.current || !online) return;
    writing.current = true;
    setSaving(true);
    void client.discardBatch(batchId).then(
      () => navigate('/'),
      () => {
        writing.current = false;
        setSaving(false);
        setDecisionError('Could not verify the discard. Your review is still here.');
      },
    );
  }, [batchId, client, navigate, online]);

  const searchTmdb = useCallback(
    async (query: string) => {
      if (!online) throw new Error('Reconnect to search for another title.');
      return (await client.searchTmdb(query)).items;
    },
    [client, online],
  );

  /**
   * TASK-067 — §6.20. Re-reads the review afterwards, for the same reason
   * `confirmAll` does: the entry becomes a candidate the owner must be able to
   * SEE in the additions section, and a screen that reported "added" without
   * showing the row is indistinguishable from one that added nothing.
   *
   * ⚠ The rejection is RE-THROWN. `ManualEntryPanel` turns the two deliberate
   * 409s into their own messages; swallowing the error here would show the
   * owner a success notice for a title the batch does not contain.
   */
  const manualEntry = useCallback(
    async (result: { tmdbId: number; mediaType: string }): Promise<void> => {
      await decide(() => client.addManualEntry(batchId, result.tmdbId, result.mediaType));
    },
    [batchId, client, decide],
  );

  /**
   * TASK-068 — the three §6.8 actions, each one §6.18 patch.
   *
   * ⚠ **THE REVIEW IS RE-READ, AND THE REJECTION IS RE-THROWN.** A keep or a
   * discard changes what the close will write, and `UnmatchedActions` reports
   * a refusal on the card rather than pretending the decision stuck — a
   * swallowed rejection here would leave the card saying "kept" over a row the
   * server still holds `pending`, and the close would then 409 on
   * `PENDING_ADDITIONS` naming a candidate the owner believes they dealt with.
   *
   * ⚠ A CORRECTION SENDS THE TMDB **id**, never the name (SD-05) — the server
   * re-resolves the identity from TMDB's own record.
   */
  const patch = useCallback(
    async (candidateId: string, body: CandidatePatchBody): Promise<void> => {
      await decisions.candidate(candidateId, body);
    },
    [decisions],
  );

  const keepUnmatched = useCallback(
    (candidateId: string) => patch(candidateId, { disposition: 'confirmed' }),
    [patch],
  );

  const discardUnmatched = useCallback(
    (candidateId: string) => patch(candidateId, { disposition: 'discarded' }),
    [patch],
  );

  /*
   * REQ-109 — the correction carries what the owner's chosen match LOOKS like.
   *
   * ⚠ The display fields are not decoration and dropping them re-opens the
   * defect. `applyCorrection` is network-free on purpose, and the review pass
   * runs before any `Title` row exists, so if the client does not carry the
   * name the server has none: the card then falls back to `matchCandidates[0]`
   * — the identity the owner just rejected — and the owner is left guessing
   * whether their fix took.
   *
   * ⚠ These values came from THIS server's own `/api/tmdb/search`; they are
   * echoed back, not invented here. Identity is still `tmdbId` + `mediaType`.
   */
  const matchUnmatched = useCallback(
    (
      candidateId: string,
      result: {
        tmdbId: number;
        mediaType: string;
        name: string;
        releaseYear: number | null;
        posterPath: string | null;
      },
    ) =>
      patch(candidateId, {
        disposition: 'corrected',
        tmdbId: result.tmdbId,
        mediaType: result.mediaType,
        correctedName: result.name,
        correctedReleaseYear: result.releaseYear,
        correctedPosterPath: result.posterPath,
      }),
    [patch],
  );

  /*
   * ⚠ BEFORE the refusal branch and before any review UI. A 401 can arrive
   * from the initial load or from any action, and in every case the review on
   * screen is being rendered against a session that no longer exists.
   */
  if (sessionEndedHref !== null) {
    return (
      <RefusalPage
        reason="session-expired"
        signInHref={sessionEndedHref}
        reassurance={SESSION_ENDED_REVIEW_BODY}
      />
    );
  }

  if (review.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;
  return (
    <ReviewPage
      controlled
      hasUnsaved={decisions.intents.length > 0}
      reviewTools={
        <section className="review-recovery" aria-label="Review recovery">
          <ReviewRecovery
            batchId={batchId}
            client={client}
            offline={!online}
            busy={saving || applying}
            onDiscarded={decisions.clear}
            onNavigate={(path) => {
              void navigate(path);
            }}
            begin={() => {
              if (writing.current || closing.current) return false;
              writing.current = true;
              setSaving(true);
              return true;
            }}
            end={() => {
              writing.current = false;
              setSaving(false);
            }}
          />
          {decisions.storageFailed && (
            <p role="alert">
              Local decision recovery is unavailable. Keep this tab open until your choices are
              saved.
            </p>
          )}
          {decisions.intents.length > 0 && decisions.showIntents && (
            <section
              className="upload-checkpoint review-unsaved"
              aria-label="Unsaved review choices"
            >
              <h2>
                {decisions.intents.length}{' '}
                {decisions.intents.length === 1 ? 'choice is' : 'choices are'} not saved or verified
              </h2>
              <p>
                The cards show saved decisions. Your local choices remain below; reconnecting never
                submits them automatically.
              </p>
              <ul>
                {decisions.intents.map((intent) => (
                  <li className="review-unsaved__choice" key={`${intent.kind}:${intent.id}`}>
                    <p>
                      <strong>{intent.label}</strong>: {intentLabel(intent)} —{' '}
                      {intent.state === 'conflict'
                        ? 'Saved review changed; check the current card'
                        : intent.state === 'unknown'
                          ? 'Outcome unverified'
                          : 'Not saved'}
                    </p>
                    <Button
                      variant="secondary"
                      disabled={saving || applying}
                      onClick={() => decisions.useSaved(intent)}
                    >
                      Use saved decision
                    </Button>
                    {intent.state === 'conflict' && (
                      <Button
                        variant="secondary"
                        disabled={saving || applying || !online}
                        onClick={() => {
                          void decisions
                            .useMine(intent)
                            .catch(() =>
                              setDecisionError(
                                'Your choice was not verified. Check the current review before continuing.',
                              ),
                            );
                        }}
                      >
                        Use my choice
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                variant="primary"
                disabled={saving || applying || !online}
                onClick={() => {
                  void decisions
                    .save()
                    .catch(() =>
                      setDecisionError(
                        'Some choices remain unverified. Nothing was automatically retried.',
                      ),
                    );
                }}
              >
                Check and save choices
              </Button>
            </section>
          )}
        </section>
      }
      review={shown}
      loading={review.resource.kind === 'loading' && shown === null}
      skeletonCount={skeletonCount}
      loadFailed={review.resource.kind === 'failed'}
      applyFailed={applyFailed}
      applying={applying}
      saving={saving}
      decisionError={decisionError}
      offline={!online}
      pendingAdditionIds={pendingAdditionIds}
      reconfirmSignal={reconfirmSignal}
      onRetry={review.reload}
      onApply={apply}
      onDiscard={discard}
      onConfirmAll={confirmAll}
      onPrepare={refresh}
      onToggleRemoval={decisions.removal}
      onRescueCandidate={(candidateId) => patch(candidateId, { reclassifyAsTitle: true })}
      onSearchTmdb={searchTmdb}
      onManualEntry={manualEntry}
      onKeepUnmatched={keepUnmatched}
      onDiscardUnmatched={discardUnmatched}
      onMatchUnmatched={matchUnmatched}
    />
  );
}
