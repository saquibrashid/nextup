import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildReviewResponse, withReviewEvidence, type ReviewCandidate } from '@nextup/domain';
import { ReviewPage } from '../src/pages/ReviewPage';
import { tileNextStep } from '../src/components/TileReview';

const regions = Array.from({ length: 5 }, (_, i) => ({ x: i * 0.2, y: 0.1, w: 0.19, h: 0.8 }));
function candidate(index: number, overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  const crop = { imageId: 'image', ...regions[index]! };
  return {
    candidateId: `c${index}`,
    rawText: `TITLE ${index}`,
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 1,
    resolvedWorkIdentity: `tmdb:movie:${index + 1}`,
    classification: index < 2 ? 'already-present-for-this-service' : 'new',
    match: {
      tmdbId: index + 1,
      mediaType: 'movie',
      name: `Title ${index}`,
      releaseYear: 2026,
      posterPath: '/poster.jpg',
      score: 1,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['image'],
    inputTiles: [crop],
    measuredTiles: [crop],
    tileCrop: crop,
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    ...overrides,
  };
}
function review(items = regions.map((_, i) => candidate(i))) {
  return buildReviewResponse({
    batchId: 'batch',
    service: 'netflix',
    mode: 'append-only',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates: withReviewEvidence(items),
    disappearedListings: [],
    imagesWithNoText: [],
    tileCoverage: [
      {
        imageId: 'image',
        fileName: 'shot.png',
        href: '/api/images/image',
        detectedTiles: 5,
        locatedTiles: 5,
        titleCandidates: items.length,
        tiles: regions,
      },
    ],
  });
}
function actions() {
  return {
    onKeepUnmatched: vi.fn(async () => undefined),
    onDiscardUnmatched: vi.fn(async () => undefined),
    onMatchUnmatched: vi.fn(async () => undefined),
    onSearchTmdb: vi.fn(async () => []),
  };
}

describe('T-AI-067 - tile-first owner review', () => {
  it('T-AI-067a - every original has its match; known matches can be confirmed without addition or discard controls', () => {
    render(<ReviewPage review={review()} {...actions()} />);
    expect(
      screen.getByRole('heading', { name: '5 tiles found · 2 already saved · 3 to review' }),
    ).toBeVisible();
    expect(screen.getAllByRole('img', { name: 'Original screenshot tile' })).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const tile = within(screen.getByRole('region', { name: `Tile ${i + 1}` }));
      expect(tile.getByTestId('candidate-poster')).toBeVisible();
      expect(tile.getByRole('img', { name: 'Original screenshot tile' })).toBeVisible();
      if (i < 2) {
        expect(tile.getByText(/Already on your Netflix list. Nothing to add/)).toBeVisible();
        expect(tile.getByRole('button', { name: 'Confirm match', exact: true })).toBeVisible();
        expect(tile.getByRole('button', { name: 'Change match', exact: true })).toHaveClass(
          'btn--ghost',
        );
        expect(tile.queryByTestId('addition-keep')).not.toBeInTheDocument();
        expect(tile.queryByTestId('known-discard')).not.toBeInTheDocument();
      }
    }
    expect(screen.queryByTestId('candidate-thumb-whole')).not.toBeInTheDocument();
  });

  it('T-AI-067b - other-service, weak and unidentified readings have distinct next steps; conflicts stay under their tile', () => {
    const items = [
      candidate(0),
      candidate(1),
      candidate(2, { alreadyInLibrary: true }),
      candidate(3, {
        rawText: 'BEST& BEST',
        match: { ...candidate(3).match!, name: 'Best Ed', uncertain: true },
      }),
      candidate(4, {
        rawText: '',
        match: null,
        resolvedWorkIdentity: null,
        verdict: 'unreadable-tile',
      }),
      candidate(3, {
        candidateId: 'fragment',
        rawText: 'KIKY',
        provider: 'ocr-only',
        verdict: 'low-confidence',
        match: null,
      }),
    ];
    render(<ReviewPage review={review(items)} {...actions()} />);
    expect(screen.getByText(/Already in your library; confirm adding Netflix/)).toBeVisible();
    const weak = within(screen.getByRole('region', { name: 'Tile 4' }));
    expect(weak.getByTestId('candidate-c3')).toHaveTextContent('Catalogue suggestion: Best Ed');
    expect(weak.getByTestId('candidate-fragment')).toHaveTextContent('KIKY');
    expect(screen.getByRole('button', { name: 'Confirm all 1 clear new matches' })).toBeVisible();
    const empty = within(screen.getByRole('region', { name: 'Tile 5' }));
    expect(empty.getByText(/Search for its title or discard it/)).toBeVisible();
    expect(empty.queryByTestId('unmatched-keep')).not.toBeInTheDocument();
    expect(empty.getByTestId('unmatched-discard')).toBeVisible();
  });

  it('T-AI-067c - catalogue alternatives can correct a match without replacing its source tile', async () => {
    const alternative = {
      tmdbId: 1514863,
      mediaType: 'movie' as const,
      name: 'Best of the Best',
      releaseYear: 2026,
      posterPath: null,
      score: 0.88,
    };
    const callbacks = actions();
    render(
      <ReviewPage
        review={review([candidate(2, { alternatives: [alternative] })])}
        {...callbacks}
      />,
    );
    const tile = within(screen.getByRole('region', { name: 'Tile 3' }));
    fireEvent.click(tile.getByTestId('addition-find'));
    fireEvent.click(tile.getByRole('button', { name: /Best of the Best/ }));
    await waitFor(() => expect(callbacks.onMatchUnmatched).toHaveBeenCalledWith('c2', alternative));
    expect(tile.getByRole('img', { name: 'Original screenshot tile' })).toBeVisible();
  });

  it('T-AI-067d - repeated works keep every source tile but have unique card and search IDs', () => {
    const shared = candidate(2, { inputTiles: [candidate(2).tileCrop!, candidate(3).tileCrop!] });
    render(<ReviewPage review={review([shared])} {...actions()} />);
    expect(screen.getAllByTestId('candidate-c2')).toHaveLength(2);
    expect(new Set(screen.getAllByTestId('candidate-c2').map((card) => card.id)).size).toBe(2);
    for (const button of screen.getAllByTestId('addition-find')) fireEvent.click(button);
    const inputs = screen.getAllByRole('searchbox');
    expect(inputs).toHaveLength(2);
    expect(new Set(inputs.map((input) => input.id)).size).toBe(2);
    expect(screen.getByText(/Its decision is shared/)).toBeVisible();
  });

  it('T-AI-067e - saved choices update the tile step without another confirmation', () => {
    const items = regions.map((_, i) => candidate(i));
    const view = render(<ReviewPage controlled review={review(items)} {...actions()} />);
    items[2]!.disposition = 'confirmed';
    view.rerender(<ReviewPage controlled review={review(items)} {...actions()} />);
    expect(
      screen.getByRole('heading', {
        name: '5 tiles found · 2 already saved · 2 to review · 1 decided',
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Tile 3' })).getByText(
        /Your choice is saved for review/,
      ),
    ).toBeVisible();
  });

  it('T-AI-067g - confirming a known match waits for server state and leaves addition counts unchanged', async () => {
    const callbacks = actions();
    const items = regions.map((_, i) => candidate(i));
    const view = render(<ReviewPage controlled review={review(items)} {...callbacks} />);
    const tile = within(screen.getByRole('region', { name: 'Tile 1' }));
    const counts = screen.getByTestId('review-counts').textContent;
    fireEvent.click(tile.getByRole('button', { name: 'Confirm match' }));
    await waitFor(() => expect(callbacks.onKeepUnmatched).toHaveBeenCalledWith('c0'));
    expect(tile.queryByTestId('known-outcome')).not.toBeInTheDocument();
    items[0]!.disposition = 'confirmed';
    view.rerender(<ReviewPage controlled review={review(items)} {...callbacks} />);
    expect(tile.getByTestId('known-outcome')).toHaveTextContent(
      'Match confirmed. Already saved; nothing will be added.',
    );
    expect(tile.getByText(/Your match is confirmed/)).toBeVisible();
    expect(tile.queryByRole('button', { name: 'Confirm match' })).not.toBeInTheDocument();
    expect(screen.getByTestId('review-counts').textContent).toBe(counts);
    fireEvent.click(tile.getByRole('button', { name: 'Change decision' }));
    expect(tile.getByRole('button', { name: 'Change match' })).toBeVisible();
    expect(callbacks.onDiscardUnmatched).not.toHaveBeenCalled();
  });

  it('T-AI-067h - discovery matches also explain confirmation without promising another addition', () => {
    const known = candidate(0, { classification: 'already-in-your-list' });
    expect(tileNextStep(known, null)).toBe(
      'Already in your library. Nothing to add. Confirm this match, or change it if needed.',
    );
    expect(tileNextStep({ ...known, disposition: 'corrected' }, null)).toBe(
      'Already in your library. Nothing to add. Your match is confirmed.',
    );
  });
});
