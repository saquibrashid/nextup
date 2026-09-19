import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildReviewResponse, type BuildReviewInput, type ReviewCandidate } from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';

const candidate: ReviewCandidate = {
  candidateId: 'new',
  rawText: 'READ FROM SCREENSHOT',
  inferredTitle: null,
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'llm',
  verdict: 'title-candidate',
  ocrConfidence: 0.9,
  resolvedWorkIdentity: 'tmdb:movie:1',
  match: {
    tmdbId: 1,
    mediaType: 'movie',
    name: 'A title',
    releaseYear: 2025,
    posterPath: null,
    score: 0.9,
    uncertain: false,
    ambiguous: false,
  },
  alternatives: [],
  sourceImageIds: ['image'],
  tileCrop: null,
  disposition: 'pending',
  collapsedIntoCandidateId: null,
  classification: 'new',
};

function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: 'grouped',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates: [
      candidate,
      { ...candidate, candidateId: 'known', classification: 'already-present-for-this-service' },
      { ...candidate, candidateId: 'chrome', verdict: 'chrome-suspected' },
      { ...candidate, candidateId: 'unreadable', verdict: 'unreadable-tile', rawText: '' },
    ],
    disappearedListings: [],
    imagesWithNoText: [],
    ...overrides,
  });
}

describe('T-UX-158 grouped review', () => {
  it('T-UX-158a: secondary grouping retains all evidence and known matches remain inert', () => {
    render(<ReviewPage review={review()} />);
    expect(screen.getByTestId('review-secondary')).toHaveTextContent('Other extracted items (2)');
    expect(screen.getByTestId('candidate-chrome')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-unreadable')).toBeInTheDocument();
    const known = within(screen.getByTestId('review-already-on-list'));
    expect(known.getByTestId('candidate-known')).toHaveTextContent('Stays on your list');
    expect(known.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('candidate-new')).toHaveTextContent('READ FROM SCREENSHOT');
  });

  it('T-UX-158b: empty full-update known group remains counted; append-only omits it', () => {
    const { rerender } = render(<ReviewPage review={review({ candidates: [] })} />);
    expect(screen.getByTestId('review-already-on-list')).toHaveTextContent(
      'Already on your list (0)',
    );
    rerender(<ReviewPage review={review({ mode: 'append-only' })} />);
    expect(screen.queryByTestId('review-already-on-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-removals')).not.toBeInTheDocument();
  });

  it('T-UX-158c: withheld removals are explained rather than presented as an empty success', () => {
    render(<ReviewPage review={review({ lowYield: true })} />);
    expect(screen.getByTestId('review-removals-withheld')).toHaveTextContent(
      'extraction is incomplete',
    );
    expect(screen.getByTestId('candidate-new')).toBeInTheDocument();
    expect(screen.queryByTestId('review-removals')).not.toBeInTheDocument();
  });
});
