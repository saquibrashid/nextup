/**
 * TASK-178 — the review container (`specs/ui.md` §5, §12.6, ADR-0012).
 *
 * ⚠ **`ReviewPage` WAS MOUNTED BARE ON THE SCREEN THE PRODUCT LIVES OR DIES
 * ON.** `onApply`, `onDiscard` and `onConfirmAll` had no producer at all: the
 * endpoints have existed since TASK-066 and TASK-071 and were unreachable from
 * the SPA, so the owner could complete a whole review pass and close nothing.
 *
 * ⚠ **THE REVIEW IS RE-READ AFTER A BULK CONFIRM, AND ONLY THEN.** The server
 * is the record of what a close will act on, and a confirm-all changes rows
 * the owner cannot see individually — an optimistic local count would diverge
 * from the batch silently. Every other mutation here NAVIGATES AWAY, so
 * re-reading afterwards would be a request whose result is thrown away.
 */

import { useCallback, useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  apiClient,
  ApiError,
  RefusedError,
  type ApiClient,
  type CandidatePatchBody,
  type CloseBatchResult,
} from '../lib/apiClient';
import { type AppliedBatch } from '../components/BatchAppliedNotice';
import { useResource } from '../lib/useResource';
import { useOnline } from '../lib/useOnline';
import { RefusalPage } from '../pages/RefusalPage';
import { ReviewPage, type ConfirmableSection } from '../pages/ReviewPage';

export interface ReviewRouteProps {
  readonly client?: ApiClient;
  /** Injected so §6.17 is drivable without a real network. Reads TRUE when online. */
  readonly connectivity?: () => boolean;
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

export function ReviewRoute({
  client = apiClient,
  connectivity,
}: ReviewRouteProps = {}): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const batchId = params['batchId'] ?? '';

  /*
   * §6.17 — no refetch on reconnect. The review the owner is working through
   * is the review they loaded; silently replacing it under them would discard
   * every disposition they had made while offline, which is exactly the
   * data-loss `T-UX-024` pairs with `T-UX-023` to prevent.
   */
  const online = useOnline({ connectivity });

  // Bumped to force a re-read after a bulk confirm. `useResource` keys on a
  // string, so the counter IS the declared identity of "the review, again".
  const [generation, setGeneration] = useState(0);

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

  const review = useResource(
    (signal) => client.getReview(batchId, signal),
    `review:${batchId}:${String(generation)}`,
  );

  const confirmAll = useCallback(
    (section: ConfirmableSection): void => {
      void client.confirmAllCandidates(batchId, section).then(
        () => {
          setGeneration((n) => n + 1);
        },
        () => {
          // ⚠ Deliberately silent about the count and deliberately NOT a
          // local tick-through. A failed bulk confirm that optimistically
          // marked the rows would show the owner a screen claiming decisions
          // the close will not make.
          setGeneration((n) => n + 1);
        },
      );
    },
    [batchId, client],
  );

  const apply = useCallback(
    (confirmRemovals: boolean): void => {
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
          //   - 401 (§6.18) is already redirecting inside `request`; every
          //     other 4xx (a refusal) is not a "try again" case either.
          //   - Only a 5xx or a network failure is §6.16.
          //
          // ⚠ CLEARED BEFORE THE BRANCHING, NOT INSIDE EACH ARM. Every one of
          // these arms leaves the owner on the review with something to do,
          // and three of them `return` early — a per-arm clear would be
          // forgotten by exactly the arm that was added last, leaving the
          // owner with a permanently dead **Apply changes** button and no way
          // to retry the close.
          setApplying(false);
          if (error instanceof ApiError) {
            if (error.code === 'PENDING_ADDITIONS') {
              setPendingAdditionIds(pendingCandidateIdsFrom(error.details));
              return;
            }
            if (error.code === 'REMOVALS_NOT_CONFIRMED') {
              setReconfirmSignal((n) => n + 1);
              return;
            }
            if (error.status < 500) return;
          }
          if (error instanceof RefusedError) return;
          setApplyFailed(true);
        },
      );
    },
    [batchId, client, navigate],
  );

  const discard = useCallback((): void => {
    void client.discardBatch(batchId).then(() => navigate('/'));
  }, [batchId, client, navigate]);

  const searchTmdb = useCallback(
    async (query: string) => (await client.searchTmdb(query)).items,
    [client],
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
      await client.addManualEntry(batchId, result.tmdbId, result.mediaType);
      setGeneration((n) => n + 1);
    },
    [batchId, client],
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
      await client.patchCandidate(batchId, candidateId, body);
      setGeneration((n) => n + 1);
    },
    [batchId, client],
  );

  const keepUnmatched = useCallback(
    (candidateId: string) => patch(candidateId, { disposition: 'confirmed' }),
    [patch],
  );

  const discardUnmatched = useCallback(
    (candidateId: string) => patch(candidateId, { disposition: 'discarded' }),
    [patch],
  );

  const matchUnmatched = useCallback(
    (candidateId: string, result: { tmdbId: number; mediaType: string }) =>
      patch(candidateId, {
        disposition: 'corrected',
        tmdbId: result.tmdbId,
        mediaType: result.mediaType,
      }),
    [patch],
  );

  if (review.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  return (
    <ReviewPage
      review={review.resource.kind === 'ok' ? review.resource.value : null}
      loading={review.resource.kind === 'loading'}
      loadFailed={review.resource.kind === 'failed'}
      applyFailed={applyFailed}
      applying={applying}
      offline={!online}
      pendingAdditionIds={pendingAdditionIds}
      reconfirmSignal={reconfirmSignal}
      onRetry={review.reload}
      onApply={apply}
      onDiscard={discard}
      onConfirmAll={confirmAll}
      onSearchTmdb={searchTmdb}
      onManualEntry={manualEntry}
      onKeepUnmatched={keepUnmatched}
      onDiscardUnmatched={discardUnmatched}
      onMatchUnmatched={matchUnmatched}
    />
  );
}
