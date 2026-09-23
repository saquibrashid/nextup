import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReviewCandidate, EditionLabel } from '@nextup/domain';
import { CandidateCard } from '../src/components/CandidateCard';
import { TitleRow, type TitleListItem } from '../src/components/TitleRow';
import { EditionLabels } from '../src/components/EditionLabels';
import { UnmatchedActions } from '../src/components/UnmatchedActions';
import { resultLabel } from '../src/components/ManualEntryPanel';
import { RemovalConfirmDialog } from '../src/components/RemovalConfirmDialog';

afterEach(cleanup);
const name = 'The X-Files: I Want to Believe';
const edition: EditionLabel = { name: `${name} Vrach Frankenshteyn`, kind: 'directors-cut' };
const match = {
  tmdbId: 8836,
  mediaType: 'movie' as const,
  name,
  releaseYear: 2008,
  posterPath: null,
  score: 1,
  uncertain: false,
  ambiguous: false,
  edition,
};
const candidate: ReviewCandidate = {
  candidateId: 'candidate',
  rawText: edition.name.toUpperCase(),
  inferredTitle: name,
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'llm',
  verdict: 'title-candidate',
  ocrConfidence: 1,
  resolvedWorkIdentity: 'tmdb:movie:8836',
  match,
  alternatives: [match],
  sourceImageIds: ['image'],
  tileCrop: null,
  disposition: 'pending',
  collapsedIntoCandidateId: null,
  classification: 'new',
};
const item: TitleListItem = {
  titleId: 'title',
  workIdentity: 'tmdb:movie:8836',
  matchState: 'matched',
  name,
  mediaType: 'movie',
  releaseYear: 2008,
  genres: [],
  runtimeMinutes: 104,
  posterPath: null,
  badges: [{ service: 'netflix', listingId: 'listing', dateAdded: '2026-09-23' }],
  sortDateAdded: '2026-09-23',
  dateAddedLabel: 'Added to nextup 23 Sep 2026',
  editionLabels: [edition],
};

describe('T-EDITION-004 visible editions retain the original film context', () => {
  it('T-EDITION-004h names the edition in final confirmation even when no film is added', () => {
    render(
      <RemovalConfirmDialog
        service="netflix"
        items={[]}
        editionUpdates={[candidate]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('No titles will be added.')).toBeVisible();
    expect(screen.getByTestId('confirmation-editions')).toHaveTextContent(edition.name);
  });

  it('T-EDITION-004a shows the verified edition beside untouched screenshot evidence and original-year metadata', () => {
    render(<CandidateCard candidate={candidate} />);
    expect(screen.getByTestId('edition-labels')).toHaveTextContent(
      "Vrach Frankenshteyn — Director's cut",
    );
    expect(screen.getByTestId('candidate-meta')).toHaveTextContent('Original film: 2008');
    expect(screen.getByTestId('candidate-raw-text')).toHaveTextContent(candidate.rawText);
    expect(resultLabel(match)).toContain('Original film: 2008');
    expect(resultLabel({ ...match, releaseYear: null })).not.toContain('2008');
  });

  it('T-EDITION-004b shows the same edition on the saved film without duplicating its row or service badge', () => {
    render(
      <MemoryRouter>
        <ul>
          <TitleRow item={item} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId('title-row-title')).toHaveLength(1);
    expect(screen.getByTestId('release-year')).toHaveTextContent('Original film: 2008');
    expect(screen.getByTestId('edition-labels')).toHaveTextContent(edition.name);
    expect(screen.getAllByTestId('badge-netflix')).toHaveLength(1);
  });

  it('T-EDITION-004c does not invent an edition for an older response', () => {
    render(<EditionLabels />);
    expect(screen.queryByTestId('edition-labels')).not.toBeInTheDocument();
  });

  it('T-EDITION-004d lets an already-saved film explicitly keep its edition without changing its match', async () => {
    const keep = vi.fn().mockResolvedValue(undefined);
    render(
      <UnmatchedActions
        candidateId="candidate"
        variant="known"
        onKeep={keep}
        onDiscard={vi.fn()}
        onMatch={vi.fn()}
        onSearch={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm match' }));
    expect(keep).toHaveBeenCalledWith('candidate');
  });
});
