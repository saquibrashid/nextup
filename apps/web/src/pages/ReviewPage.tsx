/**
 * `/batches/:batchId/review` — The review pass, the safety gate
 * (`specs/ui.md` §5, TASK-069).
 *
 * ⚠ THIS IS THE SCREEN THE PRODUCT LIVES OR DIES ON (OQ-011). The most
 * important invariant it upholds: **In full-update mode the review pass shows
 * ALL extracted titles**, including the ones already present for that service
 * (REQ-057, US-013 AC-6). A full-update review that hides known items would
 * make a failed extraction of a known title silently read as a removal.
 *
 * Props-driven: data fetching is the container's job (ADR-0012). This
 * component renders whatever it is given and fires callbacks upward.
 *
 * Tests: `T-REV-013`, `T-UX-061`, `T-UX-011`, `T-REV-016`, `T-UI-007`,
 * `T-UI-008`, `T-UX-064`, `T-UX-065`, `T-REM-011`, `T-REV-017`.
 */

import { useState, type JSX } from 'react';

import type { ReviewCandidate, ReviewRemovalItem, ReviewResponse } from '@nextup/domain';

import { LOW_YIELD_FULL_UPDATE } from '../copy';
import { CandidateCard } from '../components/CandidateCard';
import { RemovalConfirmDialog } from '../components/RemovalConfirmDialog';

export interface ReviewPageProps {
  readonly review?: ReviewResponse | null;
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  /** Called when the owner clicks "Confirm all" for a section. */
  readonly onConfirmAll?: (section: 'additions' | 'unmatched' | 'alreadyOnYourList') => void;
  /** Called per-candidate action (confirm / discard). */
  readonly onCandidateAction?: (
    candidateId: string,
    disposition: 'confirmed' | 'discarded',
  ) => void;
  /** Called when the owner ticks or unticks a removal. */
  readonly onToggleRemoval?: (listingId: string, ticked: boolean) => void;
  /**
   * Called when the owner confirms the removal dialog.
   * `tickedIds` are the listing IDs that were ticked at confirmation time.
   */
  readonly onApply?: (tickedIds: readonly string[]) => void;
  readonly onDiscard?: () => void;
  readonly onRetry?: () => void;
}

/** Controlled tick state for removals (REQ-055, US-015 AC-1). */
function useRemovalTicks(
  items: readonly ReviewRemovalItem[],
  onToggle?: (listingId: string, ticked: boolean) => void,
): {
  ticks: Readonly<Record<string, boolean>>;
  toggle: (listingId: string) => void;
} {
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});

  function toggle(listingId: string): void {
    const current =
      overrides[listingId] ?? items.find((i) => i.listingId === listingId)?.ticked ?? true;
    const next = !current;
    setOverrides((prev) => ({ ...prev, [listingId]: next }));
    onToggle?.(listingId, next);
  }

  const ticks: Record<string, boolean> = {};
  for (const item of items) {
    ticks[item.listingId] = overrides[item.listingId] ?? item.ticked;
  }

  return { ticks, toggle };
}

function serviceLabel(service: string): string {
  if (service === 'netflix') return 'Netflix';
  if (service === 'max') return 'Max';
  return service;
}

function modeLabel(mode: string): string {
  if (mode === 'full-update') return 'Full update';
  return 'Add only';
}

function pendingCount(candidates: readonly ReviewCandidate[]): number {
  return candidates.filter((c) => c.disposition === 'pending').length;
}

export function ReviewPage({
  review = null,
  loading = false,
  loadFailed = false,
  onConfirmAll,
  onCandidateAction,
  onToggleRemoval,
  onApply,
  onDiscard,
  onRetry,
}: ReviewPageProps): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (loading) {
    return (
      <>
        <h1>Review</h1>
        <p role="status">Loading review…</p>
      </>
    );
  }

  if (loadFailed) {
    return (
      <>
        <h1>Review</h1>
        <p>{"Couldn't load the review. Nothing has changed."}</p>
        {onRetry !== undefined && (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </>
    );
  }

  if (review === null) {
    return (
      <>
        <h1>Review</h1>
        <p>No review available.</p>
      </>
    );
  }

  const { service, mode, sections, lowYield } = review;
  const svcLabel = serviceLabel(service);
  const mLabel = modeLabel(mode);
  const isFullUpdate = mode === 'full-update';

  const additions = sections.additions;
  const alreadyOnList = sections.alreadyOnYourList;
  const removals = sections.removals;

  // Controlled removal tick state — every removal arrives ticked (REQ-055).
  const removalItems = removals.omitted ? [] : removals.items;
  const { ticks, toggle } = useRemovalTicks(removalItems, onToggleRemoval);

  const tickedRemovals = removalItems.map((r) => ({
    ...r,
    ticked: ticks[r.listingId] ?? r.ticked,
  }));
  const tickedCount = tickedRemovals.filter((r) => r.ticked).length;

  const pendingTotal = pendingCount(additions.items) + pendingCount(sections.unmatched.items);

  function handleApply(): void {
    setDialogOpen(true);
  }

  function handleDialogConfirm(tickedIds: readonly string[]): void {
    onApply?.(tickedIds);
  }

  function handleDialogCancel(): void {
    setDialogOpen(false);
  }

  return (
    <>
      {/* Sticky header - use div, not header (AppShell owns the header element) */}
      <div data-testid="review-header" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <h1 data-testid="review-batch-label">
          {svcLabel} · {mLabel}
        </h1>
        <button
          type="button"
          onClick={onDiscard}
          data-testid="review-discard-button"
          aria-label="Discard batch"
        >
          Discard batch
        </button>
      </div>

      {/* Low-yield banner (T-AI-021) */}
      {lowYield && (
        <div role="alert" data-testid="low-yield-banner">
          {LOW_YIELD_FULL_UPDATE}
        </div>
      )}

      {/* Additions section */}
      <section aria-label={additions.label} data-testid="section-additions">
        <h2 data-testid="additions-heading">
          {additions.label} ({String(additions.count)})
        </h2>
        {additions.count > 0 && (
          <button
            type="button"
            onClick={() => onConfirmAll?.('additions')}
            data-testid="confirm-all-additions"
            aria-label={`Confirm all ${String(additions.count)} additions`}
          >
            {`Confirm all ${String(additions.count)}`}
          </button>
        )}
        {/* T-UX-061: Zero additions renders the explicit empty state, not a blank panel. */}
        {additions.count === 0 ? (
          <p data-testid="additions-empty">No titles were read from these screenshots.</p>
        ) : (
          <ul data-testid="additions-list">
            {additions.items.map((candidate) => (
              <li key={candidate.candidateId}>
                <CandidateCard
                  candidate={candidate}
                  onConfirm={(id) => onCandidateAction?.(id, 'confirmed')}
                  onDiscard={(id) => onCandidateAction?.(id, 'discarded')}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Unmatched section */}
      <section aria-label={sections.unmatched.label} data-testid="section-unmatched">
        <h2 data-testid="unmatched-heading">
          {sections.unmatched.label} ({String(sections.unmatched.count)})
        </h2>
        <ul data-testid="unmatched-list">
          {sections.unmatched.items.map((candidate) => (
            <li key={candidate.candidateId}>
              <CandidateCard
                candidate={candidate}
                onConfirm={(id) => onCandidateAction?.(id, 'confirmed')}
                onDiscard={(id) => onCandidateAction?.(id, 'discarded')}
              />
            </li>
          ))}
        </ul>
      </section>

      {/*
       * Already on your list — FULL UPDATE ONLY, collapsed by default, NEVER
       * omitted in full-update (T-REV-006). Read-only (T-REV-016).
       * T-REM-011 / append-only: this section is absent from the DOM
       * (not merely hidden) when omitted.
       *
       * ⚠ isFullUpdate is defense-in-depth: the API contract guarantees
       * alreadyOnYourList.omitted === true in append-only mode, so the
       * !alreadyOnList.omitted guard alone is always sufficient for valid data.
       * The isFullUpdate check is provably unobservable on the happy path and
       * intentionally left in for contract-violation defense.
       */}
      {isFullUpdate && !alreadyOnList.omitted && (
        <section
          aria-label={alreadyOnList.label}
          data-testid="section-already-on-list"
          data-count={String(alreadyOnList.count)}
        >
          <details open={!alreadyOnList.collapsedByDefault}>
            {/* Count visible in summary even when collapsed (SD-11b). */}
            <summary data-testid="already-on-list-summary">
              {alreadyOnList.label} ({String(alreadyOnList.count)})
            </summary>
            <ul data-testid="already-on-list-items">
              {alreadyOnList.items.map((candidate) => (
                <li key={candidate.candidateId}>
                  {/* readOnly: no confirm/discard controls — T-REV-016 */}
                  <CandidateCard candidate={candidate} readOnly />
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* Probably not titles — collapsed */}
      <section
        aria-label={sections.probablyNotTitles.label}
        data-testid="section-probably-not-titles"
      >
        <details>
          <summary>
            {sections.probablyNotTitles.label} ({String(sections.probablyNotTitles.count)})
          </summary>
          <ul>
            {sections.probablyNotTitles.items.map((candidate) => (
              <li key={candidate.candidateId}>
                <CandidateCard
                  candidate={candidate}
                  onConfirm={(id) => onCandidateAction?.(id, 'confirmed')}
                  onDiscard={(id) => onCandidateAction?.(id, 'discarded')}
                />
              </li>
            ))}
          </ul>
        </details>
      </section>

      {/*
       * Removals — FULL UPDATE ONLY.
       * T-UI-007: all ticked on first paint (REQ-055).
       * T-UI-008: one group confirmation; no per-row remove control.
       * T-UX-064: count visible without expanding.
       * T-REM-011 (C half): absent from DOM in append-only.
       *
       * ⚠ isFullUpdate is defense-in-depth: the API contract guarantees
       * removals.omitted === true in append-only mode, so the !removals.omitted
       * guard alone is always sufficient for valid data. The isFullUpdate check
       * is provably unobservable on the happy path and intentionally left in
       * for contract-violation defense.
       */}
      {isFullUpdate && !removals.omitted && !removals.withheld && (
        <section aria-label={removals.label} data-testid="section-removals">
          <details>
            {/* T-UX-064: count visible without expanding the section. */}
            <summary data-testid="removals-summary">
              {removals.label} ({String(tickedCount)} selected)
            </summary>
            <ul data-testid="removals-list">
              {tickedRemovals.map((item) => (
                <li key={item.listingId} data-testid={`removal-item-${item.listingId}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={ticks[item.listingId] ?? item.ticked}
                      onChange={() => toggle(item.listingId)}
                      aria-label={`Remove ${item.name}`}
                      data-testid={`removal-checkbox-${item.listingId}`}
                    />
                    {item.name}
                    {item.releaseYear !== null && ` (${String(item.releaseYear)})`}
                  </label>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* Withheld removals notice (low-yield or degraded, T-AI-021) */}
      {isFullUpdate && !removals.omitted && removals.withheld && (
        <div role="note" data-testid="removals-withheld-banner">
          {LOW_YIELD_FULL_UPDATE}
        </div>
      )}

      {/* Sticky action bar — div, not footer (AppShell owns the footer element) */}
      <div
        data-testid="review-action-bar"
        style={{ position: 'sticky', bottom: 0, zIndex: 10 }}
        aria-label="Review actions"
      >
        <p data-testid="review-counts">
          {String(additions.count)} to add
          {isFullUpdate &&
            !removals.omitted &&
            !removals.withheld &&
            ` · ${String(tickedCount)} to remove`}
          {pendingTotal > 0 && ` · ${String(pendingTotal)} still to review`}
        </p>
        <button
          type="button"
          onClick={handleApply}
          data-testid="review-apply-button"
          aria-label="Apply changes"
        >
          Apply changes
        </button>
      </div>

      {/* Removal confirmation dialog (T-UI-008, T-UX-065) */}
      {dialogOpen && (
        <RemovalConfirmDialog
          removals={tickedRemovals}
          service={service}
          onConfirm={handleDialogConfirm}
          onCancel={handleDialogCancel}
        />
      )}
    </>
  );
}
