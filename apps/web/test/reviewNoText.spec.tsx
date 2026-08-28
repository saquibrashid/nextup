/**
 * TASK-077 — `T-AI-020`: a zero-yield image is NAMED AND THUMBNAILED, never
 * silently skipped (`specs/ai.md` §8.2, US-006 AC-3).
 *
 * ⚠ **A SILENT SKIP IS THE DEFAULT FAILURE HERE, AND IT IS INVISIBLE.** An
 * image the extractor read and found nothing in produces no candidates, so
 * every downstream list looks perfectly normal — there is nothing on screen to
 * notice. In full-update mode that image's titles are simply missing from the
 * read, and their absence is what reconciliation interprets as removal. The
 * owner can only intervene if they are told *which screenshot* to retake, and
 * a file name alone will not pick one out of twenty near-identical shots in a
 * camera roll. Hence: named **and** thumbnailed.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { buildReviewResponse, type BuildReviewInput } from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';
import { REVIEW_NO_TEXT_IN } from '../src/copy';

afterEach(cleanup);

const BLANK = [
  { imageId: 'img_1', fileName: 'screenshot-3.png', href: '/api/images/img_1' },
  { imageId: 'img_2', fileName: 'IMG_0421.HEIC', href: '/api/images/img_2' },
];

function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: '01J0000000000000000000BTCH',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [],
    disappearedListings: [],
    imagesWithNoText: [],
    ...overrides,
  });
}

describe('T-AI-020 — zero-yield images are surfaced, never silently skipped', () => {
  it('T-AI-020a: every blank image gets its own row', () => {
    render(<ReviewPage review={review({ imagesWithNoText: BLANK })} />);
    const section = screen.getByTestId('images-with-no-text');
    expect(within(section).getAllByTestId('no-text-name')).toHaveLength(2);
  });

  it('T-AI-020b: the row NAMES the file, using §8.2 copy verbatim', () => {
    render(<ReviewPage review={review({ imagesWithNoText: [BLANK[0]!] })} />);
    expect(screen.getByTestId('no-text-name')).toHaveTextContent(
      'No text was found in screenshot-3.png.',
    );
    expect(REVIEW_NO_TEXT_IN).toBe('No text was found in {file}.');
  });

  it('T-AI-020c: the row THUMBNAILS the image — a name alone is not enough', () => {
    render(<ReviewPage review={review({ imagesWithNoText: [BLANK[0]!] })} />);
    const thumb = screen.getByTestId('no-text-thumb');
    // ⚠ Presence of the element is not the claim. "Thumbnailed" means an
    // <img> that actually resolves to something — an element with no `src`
    // renders as broken alt-text and satisfies a presence check while showing
    // the owner nothing.
    expect(thumb.tagName).toBe('IMG');
    expect(thumb.getAttribute('src')).toBeTruthy();
  });

  it('T-AI-020d: the thumbnail src is the API path, never a blob URL (NFR-020)', () => {
    render(<ReviewPage review={review({ imagesWithNoText: [BLANK[0]!] })} />);
    const thumb = screen.getByTestId('no-text-thumb');
    expect(thumb).toHaveAttribute('src', '/api/images/img_1');
    expect(thumb.getAttribute('src')).not.toMatch(/^https?:/);
  });

  it('T-AI-020e: each thumbnail points at ITS OWN image, not the first one', () => {
    // ⚠ The plausible bug: hoisting one `src` out of the map. Two blank
    // screenshots rendering the same picture is worse than no picture — it
    // sends the owner to retake the wrong one.
    render(<ReviewPage review={review({ imagesWithNoText: BLANK })} />);
    const sources = screen.getAllByTestId('no-text-thumb').map((el) => el.getAttribute('src'));
    expect(sources).toEqual(['/api/images/img_1', '/api/images/img_2']);
  });

  it('T-AI-020f: the thumbnail is decorative — the NAME carries the meaning', () => {
    // Alt text repeating the file name would make a screen reader announce it
    // twice; the adjacent sentence already says which file this is.
    render(<ReviewPage review={review({ imagesWithNoText: [BLANK[0]!] })} />);
    expect(screen.getByTestId('no-text-thumb')).toHaveAttribute('alt', '');
  });

  it('T-AI-020g: no blank images means no section at all — no empty shell', () => {
    render(<ReviewPage review={review()} />);
    expect(screen.queryByTestId('images-with-no-text')).not.toBeInTheDocument();
  });

  it('T-AI-020h: blank images are surfaced in APPEND-ONLY mode too', () => {
    // §8.2 says "any mode". The full-update safety argument is the stronger
    // one, which is exactly why append-only is the branch likely to be
    // dropped as unnecessary.
    render(<ReviewPage review={review({ mode: 'append-only', imagesWithNoText: BLANK })} />);
    expect(screen.getAllByTestId('no-text-name')).toHaveLength(2);
  });

  it('T-AI-020i: the section survives a batch that yielded NOTHING at all', () => {
    // The worst case and the one most likely to be short-circuited by an
    // early "nothing to review" return: no candidates, every image blank.
    render(<ReviewPage review={review({ lowYield: true, imagesWithNoText: BLANK })} />);
    expect(screen.getByTestId('images-with-no-text')).toBeInTheDocument();
  });
});
