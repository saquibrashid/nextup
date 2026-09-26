/**
 * TASK-262 — the owner's mobile mockup for the review screen.
 *
 * `T-PHONE-011` (the overview: groups, chips, the coverage card) and
 * `T-PHONE-012` (the one-candidate pager).
 *
 * ⚠ **THE GROUPS ARE THE SERVER'S SECTIONS, REARRANGED — never re-derived.**
 * Every test below builds its fixture with the domain's `buildReviewResponse`,
 * so a phone group that drifted from the server's buckets would fail here
 * rather than quietly hiding a candidate.
 */

import { buildReviewResponse, type ReviewCandidate, type ReviewResponse } from '@nextup/domain';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDE_VIEWPORT_QUERY } from '../src/breakpoints';
import { PhoneReview, phoneReviewEntries } from '../src/components/PhoneReview';
import {
  REVIEW_PHONE_BACK,
  REVIEW_PHONE_GROUP_SAVED,
  REVIEW_PHONE_TITLE,
  REVIEW_TITLE,
  reviewPhonePosition,
} from '../src/copy';
import { ReviewPage } from '../src/pages/ReviewPage';

function stubMatchMedia(wide: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === WIDE_VIEWPORT_QUERY ? wide : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

function candidate(
  id: string,
  name: string | null,
  extra: Partial<ReviewCandidate> = {},
): ReviewCandidate {
  return {
    candidateId: id,
    rawText: name ?? 'Continue watching',
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.9,
    resolvedWorkIdentity: name === null ? null : `tmdb:tv:${id}`,
    match:
      name === null
        ? null
        : {
            tmdbId: id.length,
            mediaType: 'tv',
            name,
            releaseYear: 2024,
            posterPath: null,
            score: 0.95,
            uncertain: false,
            ambiguous: false,
          },
    alternatives: [],
    sourceImageIds: ['image'],
    tileCrop: null,
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    ...extra,
  };
}

const uncertainMatch = {
  tmdbId: 9,
  mediaType: 'tv' as const,
  name: 'The Last of Us',
  releaseYear: 2023,
  posterPath: null,
  score: 0.6,
  uncertain: true,
  ambiguous: true,
};

function reviewOf(
  mode: 'append' | 'full-update',
  candidates: readonly ReviewCandidate[],
  coverage = false,
): ReviewResponse {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'max',
    mode,
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates: [...candidates],
    disappearedListings: [],
    imagesWithNoText: [],
    tileCoverage: coverage
      ? [
          {
            imageId: 'image',
            fileName: 'IMG_0001.PNG',
            href: '/api/images/image',
            detectedTiles: 12,
            locatedTiles: 8,
            titleCandidates: 8,
          },
        ]
      : [],
  });
}

const fixture = [
  candidate('fallout', 'Fallout'),
  candidate('shogun', 'Shōgun'),
  candidate('tlou', 'The Last of Us', { rawText: 'THE LAST OF U', match: uncertainMatch }),
  candidate('menu', null),
  candidate('known', 'Dune: Prophecy', { classification: 'already-present-for-this-service' }),
];

function handlers() {
  return {
    onKeep: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    onDiscard: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    onMatch: vi.fn(async () => undefined),
    onSearch: vi.fn(async () => []),
  };
}

function mount(review: ReviewResponse, wired = handlers(), pendingIds: string[] | null = null) {
  render(
    <PhoneReview
      review={review}
      subtitle="5 candidates from Max · Full update"
      controlled={false}
      dispositionOf={(c) => c.disposition}
      thumbnailUrlFor={() => null}
      bulkCount={2}
      onConfirmAll={() => undefined}
      pendingIds={pendingIds}
      {...wired}
    />,
  );
  return wired;
}

describe('T-PHONE-011 — the phone review overview', () => {
  it('T-PHONE-011a: every visible candidate lands in exactly one group, from the server sections', () => {
    const review = reviewOf('full-update', [
      ...fixture,
      candidate('chrome', 'Menu', { verdict: 'chrome-suspected' }),
    ]);
    const entries = phoneReviewEntries(review);
    const byGroup = Object.fromEntries(
      (['new', 'uncertain', 'saved', 'other'] as const).map((g) => [
        g,
        entries.filter((e) => e.group === g).map((e) => e.candidate.candidateId),
      ]),
    );
    expect(byGroup).toEqual({
      new: ['fallout', 'shogun'],
      uncertain: ['tlou', 'menu'],
      saved: ['known'],
      other: ['chrome'],
    });
    const ids = entries.map((e) => e.candidate.candidateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('T-PHONE-011b: a full update keeps "Already in your library" in the overview (invariant 2)', () => {
    stubMatchMedia(false);
    mount(reviewOf('full-update', fixture));
    const saved = screen.getByTestId('phone-review-group-saved');
    expect(within(saved).getByRole('heading', { name: REVIEW_PHONE_GROUP_SAVED })).toBeTruthy();
    expect(within(saved).getByText('Dune: Prophecy')).toBeTruthy();
    expect(screen.getByTestId('phone-review-chip-saved').textContent).toContain('1');
  });

  it('T-PHONE-011c: chips filter the groups and are exposed as toggle buttons', () => {
    stubMatchMedia(false);
    mount(reviewOf('full-update', fixture));
    const all = screen.getByTestId('phone-review-chip-all');
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(all.textContent).toContain('5');
    fireEvent.click(screen.getByTestId('phone-review-chip-uncertain'));
    expect(screen.getByTestId('phone-review-chip-uncertain').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByTestId('phone-review-group-new')).toBeNull();
    expect(screen.getByTestId('phone-review-group-uncertain')).toBeTruthy();
  });

  it('T-PHONE-011d: + on a new row confirms it at once and the row shows the outcome', async () => {
    stubMatchMedia(false);
    const wired = mount(reviewOf('append', fixture));
    fireEvent.click(screen.getByTestId('phone-review-yes-fallout'));
    await waitFor(() => {
      expect(wired.onKeep).toHaveBeenCalledWith('fallout');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('phone-review-yes-fallout')).toBeNull();
    });
    expect(screen.getByTestId('confirm-all-button').textContent).toContain('2');
  });

  it('T-PHONE-011e: the coverage card reports located of detected tiles and hides nothing', () => {
    stubMatchMedia(false);
    mount(reviewOf('append', fixture, true));
    const card = screen.getByTestId('phone-review-coverage');
    expect(card.textContent).toContain('8 of 12');
    fireEvent.click(within(card).getByRole('button', { name: 'Learn more' }));
    expect(within(card).getByRole('link', { name: 'IMG_0001.PNG' })).toBeTruthy();
    expect(card.textContent).toContain('does not verify every title');
  });
});

describe('T-PHONE-012 — the one-candidate pager', () => {
  it('T-PHONE-012a: ✗ on a matched card opens the pager; ✗ on "Is this a title?" discards', async () => {
    stubMatchMedia(false);
    const wired = mount(reviewOf('append', fixture));
    fireEvent.click(screen.getByTestId('phone-review-no-menu'));
    await waitFor(() => {
      expect(wired.onDiscard).toHaveBeenCalledWith('menu');
    });
    fireEvent.click(screen.getByTestId('phone-review-no-tlou'));
    expect(wired.onDiscard).toHaveBeenCalledTimes(1);
    const pager = screen.getByTestId('candidate-tlou');
    expect(within(pager).getByTestId('candidate-raw-text').textContent).toBe('THE LAST OF U');
    expect(within(pager).getByText('60% match')).toBeTruthy();
  });

  it('T-PHONE-012b: the pager confirms, pages within its group and returns focus to the opener', async () => {
    stubMatchMedia(false);
    const wired = mount(reviewOf('append', fixture));
    fireEvent.click(screen.getByTestId('phone-review-open-fallout'));
    const pager = screen.getByTestId('candidate-fallout');
    expect(pager.textContent).toContain(reviewPhonePosition(0, 2));
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe('H2');
    });
    fireEvent.click(within(pager).getByTestId('addition-keep'));
    await waitFor(() => {
      expect(wired.onKeep).toHaveBeenCalledWith('fallout');
    });
    await waitFor(() => {
      expect(within(pager).getByTestId('addition-outcome')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('candidate-shogun')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: REVIEW_PHONE_BACK }));
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-open-id')).toBe('shogun');
    });
  });

  it('T-PHONE-012c: a refused close opens the first still-pending candidate', () => {
    stubMatchMedia(false);
    mount(reviewOf('append', fixture), handlers(), ['tlou']);
    expect(screen.getByTestId('candidate-tlou')).toBeTruthy();
  });

  it('T-PHONE-012d: ReviewPage takes the phone path only when told to', () => {
    const review = reviewOf('append', fixture);
    const { unmount } = render(<ReviewPage review={review} phone />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(REVIEW_PHONE_TITLE);
    expect(screen.getByTestId('phone-review')).toBeTruthy();
    unmount();
    render(<ReviewPage review={review} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(REVIEW_TITLE);
    expect(screen.queryByTestId('phone-review')).toBeNull();
  });
});
