import type { JSX } from 'react';
import {
  SERVICE_LABELS,
  type ReviewCandidate,
  type ReviewTileGroup,
  type Service,
} from '@nextup/domain';
import { SourceTile } from './SourceTile';
import { CandidateList } from './CandidateList';

export function alreadySaved(candidate: ReviewCandidate): boolean {
  return (
    candidate.classification === 'already-present-for-this-service' ||
    candidate.classification === 'already-in-your-list'
  );
}

export function tileNextStep(candidate: ReviewCandidate, service: Service | null): string {
  if (candidate.disposition === 'discarded')
    return 'You discarded this reading. It will not be added.';
  if (alreadySaved(candidate)) {
    return `Already ${service === null ? 'in your library' : `on your ${SERVICE_LABELS[service]} list`}. Nothing to add. Change the match if it is wrong.`;
  }
  if (candidate.disposition === 'confirmed' || candidate.disposition === 'corrected') {
    return 'Your choice is saved for review. It will be included when you apply changes.';
  }
  if (candidate.verdict === 'unreadable-tile')
    return 'This tile was found but not identified. Search for its title or discard it.';
  if (candidate.verdict === 'chrome-suspected')
    return 'Additional text from this tile. It is not automatically treated as another title.';
  if (candidate.match === null)
    return 'This reading is unidentified. Find a match, keep it unidentified, or discard it.';
  if (candidate.alreadyInLibrary) {
    return `Already in your library; confirm adding ${service === null ? 'this source' : SERVICE_LABELS[service]}.`;
  }
  return candidate.match.uncertain || candidate.match.ambiguous
    ? 'Several readings or matches may be possible. Check the original tile and choose the right work.'
    : 'New to your list. Is this match correct?';
}

export function TileReview({
  tiles,
  renderCandidate,
}: {
  tiles: readonly ReviewTileGroup[];
  renderCandidate: (candidate: ReviewCandidate, domId?: string) => JSX.Element;
}): JSX.Element {
  const already = tiles.filter((tile) => {
    const main = tile.candidates.filter(
      (candidate) =>
        candidate.verdict !== 'chrome-suspected' && candidate.disposition !== 'discarded',
    );
    return main.length > 0 && main.every(alreadySaved);
  }).length;
  const pending = tiles.filter(
    (tile) =>
      tile.candidates.length === 0 ||
      tile.candidates.some(
        (candidate) =>
          candidate.verdict !== 'chrome-suspected' &&
          candidate.disposition === 'pending' &&
          !alreadySaved(candidate),
      ),
  ).length;
  const ready = tiles.length - already - pending;
  const firstTile = new Map<string, string>();
  for (const tile of tiles)
    for (const candidate of tile.candidates) {
      if (!firstTile.has(candidate.candidateId)) firstTile.set(candidate.candidateId, tile.tileId);
    }
  return (
    <section className="review-section" data-testid="review-tiles">
      <h2>
        {tiles.length} tiles found · {already} already saved · {pending} to review
        {ready > 0 ? ` · ${ready} decided` : ''}
      </h2>
      <p>
        Every detected tile stays visible, including titles already saved. Compare the original with
        its proposed match before applying changes.
      </p>
      <CandidateList
        items={tiles.map((tile, index) => ({ tile, index }))}
        keyFor={({ tile }) => tile.tileId}
        renderItem={({ tile, index }) => (
          <section className="review-tile" key={tile.tileId} aria-label={`Tile ${index + 1}`}>
            <div className="review-tile__source">
              <h3>Tile {index + 1} · Original screenshot</h3>
              <a
                href={`/api/images/${encodeURIComponent(tile.source.imageId)}`}
                target="_blank"
                rel="noreferrer"
              >
                <SourceTile
                  crop={tile.source}
                  src={`/api/images/${encodeURIComponent(tile.source.imageId)}`}
                />
                Open source screenshot
              </a>
            </div>
            <div className="review-tile__readings">
              <h3>Match and next step</h3>
              {tile.candidates.length === 0 && (
                <p>No visible match for this tile. Use manual entry below if a title was missed.</p>
              )}
              {tile.candidates.map((candidate) => {
                const repeated = firstTile.get(candidate.candidateId) !== tile.tileId;
                return (
                  <div key={candidate.candidateId}>
                    {repeated && (
                      <p>
                        The same work appears in another tile. Its decision is shared; it will not
                        be added twice.
                      </p>
                    )}
                    {renderCandidate(
                      candidate,
                      repeated ? `tile-${tile.tileId}-${candidate.candidateId}` : undefined,
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      />
    </section>
  );
}
