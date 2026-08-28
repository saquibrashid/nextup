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

import { apiClient, type ApiClient } from '../lib/apiClient';
import { useResource } from '../lib/useResource';
import { RefusalPage } from '../pages/RefusalPage';
import { ReviewPage, type ConfirmableSection } from '../pages/ReviewPage';

export interface ReviewRouteProps {
  readonly client?: ApiClient;
}

export function ReviewRoute({ client = apiClient }: ReviewRouteProps = {}): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const batchId = params['batchId'] ?? '';

  // Bumped to force a re-read after a bulk confirm. `useResource` keys on a
  // string, so the counter IS the declared identity of "the review, again".
  const [generation, setGeneration] = useState(0);

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
      void client.closeBatch(batchId, confirmRemovals).then(() => navigate('/'));
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

  if (review.resource.kind === 'refused') return <RefusalPage reason="not-allowed" />;

  return (
    <ReviewPage
      review={review.resource.kind === 'ok' ? review.resource.value : null}
      loading={review.resource.kind === 'loading'}
      loadFailed={review.resource.kind === 'failed'}
      onRetry={review.reload}
      onApply={apply}
      onDiscard={discard}
      onConfirmAll={confirmAll}
      onSearchTmdb={searchTmdb}
      onManualEntry={manualEntry}
    />
  );
}
