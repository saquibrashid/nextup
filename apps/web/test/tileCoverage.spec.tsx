import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildReviewResponse, type ReviewCandidate } from '@nextup/domain';
import { ReviewPage } from '../src/pages/ReviewPage';

const candidate: ReviewCandidate = {
  candidateId: 'chrome',
  rawText: 'My List',
  inferredTitle: 'My Wish List',
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'ocr-only',
  verdict: 'chrome-suspected',
  ocrConfidence: 0.9,
  resolvedWorkIdentity: 'tmdb:movie:1',
  classification: 'new',
  match: {
    tmdbId: 1,
    mediaType: 'movie',
    name: 'My Wish List',
    releaseYear: 2026,
    posterPath: '/speculative.jpg',
    score: 0.7,
    uncertain: true,
    ambiguous: false,
  },
  alternatives: [],
  sourceImageIds: ['img'],
  tileCrop: null,
  disposition: 'pending',
  collapsedIntoCandidateId: null,
};
const review = () =>
  buildReviewResponse({
    batchId: 'batch',
    service: 'netflix',
    mode: 'append-only',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates: [candidate],
    disappearedListings: [],
    imagesWithNoText: [],
    tileCoverage: [
      {
        imageId: 'img',
        fileName: 'shot.png',
        href: '/api/images/img',
        detectedTiles: 5,
        locatedTiles: 3,
        titleCandidates: 3,
      },
    ],
  });

/**
 * The live screen said "Couldn't read these (0)" even though two of five tiles
 * had no candidate. That bucket counts explicit unreadable outputs, not silent
 * omissions: keep it honest and show measured coverage independently, outside
 * collapsed sections. "Unlocated" cannot be relabelled "unread" because an
 * artwork-only candidate may be correct while its location remains unknown.
 * The same report's "My Wish List" was a speculative catalogue match for the
 * correctly flagged "My List" chrome. Its name, year and poster cannot headline
 * evidence of what the screenshot actually said.
 */
describe('T-AI-064 - visible tile evidence', () => {
  it('T-AI-064a - shows partial coverage even when the unreadable bucket is empty', () => {
    const data = review();
    expect(data.sections.unreadableTiles.count).toBe(0);
    render(<ReviewPage review={data} />);
    expect(
      screen.getByText(/3 title candidates; titles located in 3 of 5 detected tiles/),
    ).toBeVisible();
    expect(screen.getByText(/an unlocated tile is not necessarily unread/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'shot.png' })).toHaveAttribute(
      'href',
      '/api/images/img',
    );
  });

  it('T-AI-064b - old payloads make no invented completeness claim', () => {
    const old = review();
    delete old.tileCoverage;
    render(<ReviewPage review={old} />);
    expect(screen.queryByText(/detected tiles/)).not.toBeInTheDocument();
  });

  it('T-AI-064c - chrome headlines its transcription, never the speculative match or poster', () => {
    render(<ReviewPage review={review()} />);
    const card = within(screen.getByTestId('candidate-chrome'));
    expect(card.getByTestId('candidate-name')).toHaveTextContent(/^My List$/);
    expect(card.queryByTestId('candidate-poster')).not.toBeInTheDocument();
    expect(card.queryByTestId('candidate-meta')).not.toBeInTheDocument();
    expect(card.getByTestId('candidate-thumb-whole')).toBeInTheDocument();
  });

  it('T-AI-064d - ordinary matched titles retain the chosen name and poster', () => {
    const data = buildReviewResponse({
      batchId: 'batch',
      service: 'netflix',
      mode: 'append-only',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
      candidates: [{ ...candidate, verdict: 'title-candidate' }],
      disappearedListings: [],
      imagesWithNoText: [],
    });
    render(<ReviewPage review={data} />);
    expect(screen.getByTestId('candidate-name')).toHaveTextContent('My Wish List');
    expect(screen.getByTestId('candidate-poster')).toBeInTheDocument();
  });
});
