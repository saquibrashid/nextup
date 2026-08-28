/**
 * `T-REM-011` — append-only removes the removal question from the DOM, not
 * merely from view (TASK-093, REQ-022, `specs/ui.md` §5.2).
 *
 * ⚠ **"ABSENT" AND "HIDDEN" LOOK IDENTICAL IN A SCREENSHOT AND ARE NOT THE
 * SAME PROPERTY.** A `hidden` attribute, a `display: none` rule or an
 * `aria-hidden` wrapper all satisfy a human skim while leaving the section in
 * the accessibility tree, in the tab order and in the serialised HTML — so a
 * screen-reader user is offered a removal decision that the mode says does not
 * exist, and any later code that reads the DOM finds removals in a batch that
 * can never have any. `T-REM-011`'s AC says *"no removals section exists in
 * the response **or the DOM**"*, and these cases are the DOM half.
 *
 * The response half is asserted where it is decided — `T-REV-006g`,
 * `T-UI-006a`/`d` in `apps/api/test/integration/batchReview.spec.ts`. This
 * file deliberately does NOT restate it: two implementations of one rule is
 * the thing the review pipeline is designed to avoid.
 *
 * ⚠ **THE NEGATIVE CASES NEED A POSITIVE TWIN.** A `ReviewPage` that never
 * rendered removals at all would pass every absence assertion here. Each
 * absence is therefore paired with the same fixture in `full-update`, where
 * the section must be present — the mode is what decides, and that is exactly
 * the distinction being tested.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildReviewResponse,
  removalsLabel,
  type BuildReviewInput,
  type ReviewCandidate,
} from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';

const WEB_ROOT = process.cwd().endsWith(join('apps', 'web'))
  ? process.cwd()
  : join(process.cwd(), 'apps', 'web');

function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: 'cand_1',
    rawText: 'THE MATRIX',
    inferredTitle: 'The Matrix',
    basis: 'text',
    ocrSupport: 'corroborated',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.94,
    resolvedWorkIdentity: 'tmdb:movie:603',
    match: {
      tmdbId: 603,
      mediaType: 'movie',
      name: 'The Matrix',
      releaseYear: 1999,
      posterPath: '/matrix.jpg',
      score: 0.98,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['img_1'],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    ...overrides,
  };
}

/** One active Netflix listing that nothing in the batch extracted. */
const DISAPPEARED = [
  {
    listingId: 'lst_1',
    titleId: 'ttl_1',
    name: 'Arrival',
    releaseYear: 2016,
    posterPath: null,
    service: 'netflix' as const,
    dateAdded: '2026-01-02',
  },
];

/**
 * ⚠ THE SAME INPUT IN BOTH MODES. The fixtures differ ONLY in `mode`, so a
 * passing absence case cannot be explained by the data — only by the mode.
 */
function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: '01J0000000000000000000BTCH',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [candidate({ classification: 'already-present-for-this-service' })],
    disappearedListings: DISAPPEARED,
    imagesWithNoText: [],
    ...overrides,
  });
}

const appendOnly = () => review({ mode: 'append-only' });

/* -------------------------------------------------------------------------- */

describe('T-REM-011 · US-014 AC-2 · append-only: the removals section does not EXIST', () => {
  it('T-REM-011a: no removals section is rendered', () => {
    render(<ReviewPage review={appendOnly()} />);

    expect(screen.queryByTestId('review-removals')).not.toBeInTheDocument();
  });

  it('T-REM-011b: the same fixture in full-update DOES render it', () => {
    // ⚠ THE TWIN. Without this, a page that never renders removals passes
    // every other case in this file while silently breaking US-014 AC-1.
    render(<ReviewPage review={review()} />);

    const removals = screen.getByTestId('review-removals');
    expect(removals).toHaveTextContent(`${removalsLabel('netflix')} (1)`);
    expect(within(removals).getByTestId('removal-card')).toHaveTextContent('Arrival');
    // The bar counts it too, so `T-REM-011g`'s zero is a consequence of the
    // MODE and not of a bar that can only ever say zero.
    expect(screen.getByTestId('review-counts')).toHaveTextContent('1 to remove');
  });

  it('T-REM-011c: the removals LABEL appears nowhere in the document', () => {
    // Asserted by text, not by test id: a section rendered without its
    // `data-testid` — or moved into another wrapper — would slip past a
    // test-id-only check while still offering the owner the decision.
    render(<ReviewPage review={appendOnly()} />);

    expect(screen.queryByText(new RegExp(removalsLabel('netflix')))).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('Arrival');
  });

  it('T-REM-011d: no removal checkbox exists to be ticked, hidden or otherwise', () => {
    // ⚠ THE ACCESSIBILITY-TREE CHECK. `getAllByRole` ignores nothing that is
    // merely off-screen, so this fails on a section hidden with CSS while
    // passing on one that is genuinely absent.
    render(<ReviewPage review={appendOnly()} />);

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('T-REM-011e: nothing in the tree is hidden — absence is not achieved with an attribute', () => {
    // `hidden`, `aria-hidden` and `display: none` all look identical to a
    // reviewer and none of them is what REQ-022 asks for.
    const { container } = render(<ReviewPage review={appendOnly()} />);

    expect(container.querySelectorAll('[hidden]')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('display: none');
  });

  it('T-REM-011f: "Already on your list" is absent in append-only too', () => {
    // REQ-022 covers both. ⚠ ABSENCE IS ONLY SAFE HERE BECAUSE APPEND-ONLY
    // REMOVES NOTHING. In full-update the same absence would be product
    // invariant 2 violated, which is why `T-UI-006e` exists.
    render(<ReviewPage review={appendOnly()} />);

    expect(screen.queryByTestId('review-already-on-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/Already on your list/)).not.toBeInTheDocument();
  });

  it('T-REM-011g: the running count says 0 to remove, never a number borrowed from elsewhere', () => {
    // The bar reads its number from the section it is describing. ⚠ THE
    // FIXTURE HAS A NON-ZERO ADDITIONS COUNT ON PURPOSE: with both numbers
    // zero, a bar that printed the additions count in the removals slot would
    // read correctly and this case would be vacuous.
    render(<ReviewPage review={review({ mode: 'append-only', candidates: [candidate()] })} />);

    const counts = screen.getByTestId('review-counts');
    expect(counts).toHaveTextContent('1 to add');
    expect(counts).toHaveTextContent('0 to remove');
  });

  it('T-REM-011h: a WITHHELD full-update hides no section silently — it explains itself', () => {
    // ⚠ WITHHELD IS NOT THE SAME AS OMITTED. A low-yield full-update proposes
    // no removals because the read was too thin to trust, and the owner must
    // be TOLD that rather than shown an empty screen that looks like "nothing
    // has been removed from your list".
    render(<ReviewPage review={review({ lowYield: true })} />);

    expect(screen.queryByTestId('review-removals')).not.toBeInTheDocument();
    expect(screen.getByTestId('review-banner')).toHaveTextContent(/nothing will be removed/i);
    // And the known section is STILL there — that is invariant 2.
    expect(screen.getByTestId('review-already-on-list')).toBeInTheDocument();
  });

  it('T-REM-011i: the stylesheet contains no rule that could hide a review section', () => {
    // ⚠ READ AS A FILE. If a `display: none` were ever added to
    // `.review-section`, every assertion above would still pass — the element
    // would be absent from the DOM in append-only and invisible in
    // full-update, and the failure would be a section the owner cannot see in
    // the mode where they most need it.
    const css = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const reviewBlock = css.slice(css.indexOf('.review-heading'));

    expect(reviewBlock).not.toMatch(/display:\s*none/);
    expect(reviewBlock).not.toMatch(/visibility:\s*hidden/);
  });
});

/* -------------------------------------------------------------------------- */

describe('the removal group is confirmed as ONE decision (US-015, rendered)', () => {
  it('T-UI-007d: every proposed removal renders CHECKED on first paint', () => {
    // REQ-055. The server sends `ticked: true`; this is the assertion that the
    // page paints it that way. ⚠ A card that rendered them unticked would make
    // the safe default — rescue everything — the one the owner never chose,
    // and it would look like the batch had already been reviewed.
    render(<ReviewPage review={review()} />);

    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeChecked();
    }
  });

  it('T-UI-008c: there is NO per-row remove affordance anywhere in the review', () => {
    // ⚠ REQ-020. Removals are confirmed as one group, precisely so the owner
    // is never one stray tap away from a deletion. A per-row button would be
    // a second, unconfirmed path to the same destructive outcome — and the
    // integration half (`T-UI-008a`/`b`) cannot see it, because it is a DOM
    // affordance that the API would never hear about until it fired.
    render(<ReviewPage review={review()} />);

    const removals = screen.getByTestId('review-removals');
    expect(within(removals).queryAllByRole('button')).toHaveLength(0);

    const bar = screen.getByTestId('review-action-bar');
    for (const button of screen.getAllByRole('button')) {
      expect(bar).toContainElement(button);
    }
  });
});
