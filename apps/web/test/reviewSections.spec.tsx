/**
 * `T-UX-134`, `T-UX-135`, `T-UX-136` — REQ-122, the three review sections are
 * visually distinct and the removals section is the most distinct of them
 * (TASK-218, `specs/ui-refresh.md` §6a.1, `A53` OQ-6 answer (d)).
 *
 * ⚠ **THE OWNER'S REPORT WAS A PRESENTATION DEFECT, AND THAT IS WHY THIS FIX
 * IS SAFE.** They said the upload workflow was *"not smooth and confusing"*;
 * asked what specifically, they chose (d): the three candidate sections look
 * alike despite meaning different things. Agreeing to an addition puts a title
 * INTO the list; agreeing to a removal takes one OUT. Those are opposite acts
 * wearing the same card.
 *
 * ⚠⚠ **DISTINCT DOES NOT MEAN COLLAPSED, REORDERED OR FILTERED, AND
 * `T-UX-136` IS NOT NEGOTIABLE.** A full-update review renders EVERY extracted
 * candidate including the already-correct ones (`A46`, product invariant 2).
 * Hiding the boring section is the single most tempting way to make this
 * screen feel shorter, and it is precisely the change that would make a failed
 * extraction of a known title readable as a removal — the most dangerous
 * defect this product can have. The section treatment hides nothing.
 *
 * ⚠ **`T-UX-134` IS THE CASE THAT DISTINGUISHES THIS FIX FROM RESTYLING THE
 * HEADINGS.** A long full-update review is scrolled; by the time a removal
 * card is on screen its heading is off it. So the card must be identifiable
 * from its OWN rendered content, with no section heading in its accessible
 * subtree. A test that read the heading above the card would pass against the
 * bug the owner reported.
 *
 * ⚠ **NOT BY COLOUR ALONE** (`specs/ui.md` §10.2). Every assertion below reads
 * TEXT. The left rules in `index.css` are a reinforcement; if they were the
 * mechanism this screen would be undifferentiated in greyscale and silent to a
 * screen reader.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildReviewResponse,
  REVIEW_LABELS,
  removalsLabel,
  type BuildReviewInput,
  type ReviewCandidate,
} from '@nextup/domain';

import {
  REVIEW_CONSEQUENCE_ADDITION,
  REVIEW_CONSEQUENCE_REMOVAL,
  REVIEW_CONSEQUENCE_UNMATCHED,
  REVIEW_REMOVALS_MARKER,
} from '../src/copy';
import { ReviewPage } from '../src/pages/ReviewPage';

function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: 'cand_add',
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

/** An unmatched candidate: no resolved identity, so `sectionForCandidate` routes it. */
const unmatched = candidate({
  candidateId: 'cand_unmatched',
  rawText: 'SEVRANCE',
  inferredTitle: 'Sevrance',
  resolvedWorkIdentity: null,
  match: null,
});

/** Already on the list — the section `T-UX-136` exists to keep visible. */
const known = candidate({
  candidateId: 'cand_known',
  rawText: 'HEAT',
  inferredTitle: 'Heat',
  resolvedWorkIdentity: 'tmdb:movie:949',
  match: {
    tmdbId: 949,
    mediaType: 'movie',
    name: 'Heat',
    releaseYear: 1995,
    posterPath: null,
    score: 0.99,
    uncertain: false,
    ambiguous: false,
  },
  classification: 'already-present-for-this-service',
});

const disappeared = [
  { listingId: 'lst_1', titleId: 'ttl_1', name: 'Arrival', year: 2016, posterPath: null },
  { listingId: 'lst_2', titleId: 'ttl_2', name: 'Paddington', year: 2014, posterPath: null },
];

function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: '01J0000000000000000000BTCH',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [candidate(), unmatched, known],
    disappearedListings: disappeared,
    imagesWithNoText: [],
    ...overrides,
  });
}

const additionCard = () => screen.getByTestId('candidate-cand_add');
const unmatchedCard = () => screen.getByTestId('candidate-cand_unmatched');
const removalCards = () => screen.getAllByTestId('removal-card');

/**
 * Every heading-shaped element the card could be leaning on. ⚠ `<summary>` is
 * included deliberately: it is THE heading on this screen, and a card that
 * contained one would be readable only because the section was.
 */
function headingsIn(el: HTMLElement): readonly Element[] {
  return Array.from(el.querySelectorAll('h1, h2, h3, h4, h5, h6, summary, [role="heading"]'));
}

/* -------------------------------------------------------------------------- */

describe('T-UX-134 · REQ-122 · a card says what it does, with no heading in view', () => {
  it('T-UX-134a: an addition card and a removal card carry different consequence text', () => {
    // ⚠ THE CORE OF THE OWNER'S COMPLAINT, stated as an assertion. Two cards
    // that mean opposite things must not read the same. Compared to each
    // other rather than to a literal, so a future copy change that made both
    // say the same thing still fails.
    render(<ReviewPage review={review()} />);

    const add = within(additionCard()).getByTestId('candidate-consequence').textContent ?? '';
    const remove = within(removalCards()[0] as HTMLElement).getByTestId(
      'candidate-consequence',
    ).textContent;

    expect(add).not.toBe('');
    expect(remove).not.toBe('');
    expect(add).not.toBe(remove);
  });

  it('T-UX-134b: each names what agreeing to it does — adds to, or removes from, the list', () => {
    // The strings themselves, so a refactor that made them merely *different*
    // ("Section A"/"Section B") does not satisfy 134a vacuously.
    render(<ReviewPage review={review()} />);

    expect(within(additionCard()).getByTestId('candidate-consequence')).toHaveTextContent(
      REVIEW_CONSEQUENCE_ADDITION,
    );
    expect(
      within(removalCards()[0] as HTMLElement).getByTestId('candidate-consequence'),
    ).toHaveTextContent(REVIEW_CONSEQUENCE_REMOVAL);
  });

  it('T-UX-134c: neither card contains a section heading in its own subtree', () => {
    // ⚠ THIS IS THE CASE THAT MAKES THE OTHERS MEAN ANYTHING. A long review is
    // scrolled and the heading is off-screen; if the card could only be
    // identified by reading upward, the fix would be the bug restyled.
    render(<ReviewPage review={review()} />);

    expect(headingsIn(additionCard())).toHaveLength(0);
    expect(headingsIn(removalCards()[0] as HTMLElement)).toHaveLength(0);
  });

  it('T-UX-134d: neither card repeats its section label, so it is not the heading in disguise', () => {
    // Copying "No longer on Netflix" onto every removal row would pass 134a-c
    // while re-introducing the coupling: rename the section and the card goes
    // silent. The card states a CONSEQUENCE, which is a different sentence.
    render(<ReviewPage review={review()} />);

    expect(additionCard()).not.toHaveTextContent(REVIEW_LABELS.additions);
    expect(removalCards()[0] as HTMLElement).not.toHaveTextContent(removalsLabel('netflix'));
  });

  it('T-UX-134e: the unmatched card is distinct from BOTH of them, not just from removals', () => {
    // ⚠ THE OWNER SAID *THREE* SECTIONS LOOKED ALIKE. Differentiating two of
    // them and leaving the third sharing a card with an addition would answer
    // two thirds of the report and read as done.
    render(<ReviewPage review={review()} />);

    const texts = [
      within(additionCard()).getByTestId('candidate-consequence').textContent,
      within(unmatchedCard()).getByTestId('candidate-consequence').textContent,
      within(removalCards()[0] as HTMLElement).getByTestId('candidate-consequence').textContent,
    ];

    expect(within(unmatchedCard()).getByTestId('candidate-consequence')).toHaveTextContent(
      REVIEW_CONSEQUENCE_UNMATCHED,
    );
    expect(new Set(texts).size).toBe(3);
  });

  it('T-UX-134f: every removal row carries it, not only the first', () => {
    // A marker rendered once, above the list, is the heading again.
    render(<ReviewPage review={review()} />);

    const cards = removalCards();
    expect(cards).toHaveLength(disappeared.length);
    for (const card of cards) {
      expect(within(card).getByTestId('candidate-consequence')).toHaveTextContent(
        REVIEW_CONSEQUENCE_REMOVAL,
      );
    }
  });
});

describe('T-UX-135 · REQ-122 · every section has a heading, a count and its own surface', () => {
  it('T-UX-135a: each of the three sections renders its label and its count in a summary', () => {
    // SD-11b already required the count to live in the <summary> so it stays
    // legible while collapsed; REQ-122 requires all three to have one.
    render(<ReviewPage review={review()} />);

    for (const [testId, label, count] of [
      ['review-additions', REVIEW_LABELS.additions, 1],
      ['review-unmatched', REVIEW_LABELS.unmatched, 1],
      ['review-removals', removalsLabel('netflix'), disappeared.length],
    ] as const) {
      const summary = within(screen.getByTestId(testId)).getByText(`${label} (${String(count)})`);
      expect(summary.tagName).toBe('SUMMARY');
    }
  });

  it('T-UX-135b: the removals section carries a consequential marker', () => {
    render(<ReviewPage review={review()} />);

    const marker = within(screen.getByTestId('review-removals')).getByTestId(
      'review-section-marker',
    );
    expect(marker).toHaveTextContent(REVIEW_REMOVALS_MARKER);
  });

  it('T-UX-135c: that marker is a WORD, not a colour', () => {
    // ⚠ `specs/ui.md` §10.2. A coloured rule is invisible in greyscale, to
    // roughly one man in twelve, and to every screen reader. The assertion is
    // on rendered text precisely so a future restyle to a bare dot fails here
    // rather than in the field.
    render(<ReviewPage review={review()} />);

    const marker = within(screen.getByTestId('review-removals')).getByTestId(
      'review-section-marker',
    );
    expect((marker.textContent ?? '').trim().length).toBeGreaterThan(0);
    expect(marker.textContent).toMatch(/[a-z]/i);
  });

  it('T-UX-135d: no other section claims that marker', () => {
    // "Most distinct of them" is a comparison, and it is false the moment the
    // marker is decoration applied everywhere.
    render(<ReviewPage review={review()} />);

    for (const testId of ['review-additions', 'review-unmatched', 'review-already-on-list']) {
      expect(within(screen.getByTestId(testId)).queryByTestId('review-section-marker')).toBeNull();
    }
  });

  it('T-UX-135e: the three sections carry different surface treatments', () => {
    // The visual half of REQ-122. Read as class names rather than computed
    // styles because jsdom applies no stylesheet — the CSS itself is asserted
    // in `listSurface.spec.tsx`'s idiom, and what matters here is that the
    // page asks for three different treatments rather than one.
    render(<ReviewPage review={review()} />);

    const classes = ['review-additions', 'review-unmatched', 'review-removals'].map(
      (testId) => screen.getByTestId(testId).className,
    );

    expect(new Set(classes).size).toBe(3);
    for (const className of classes) expect(className).toContain('review-section');
  });
});

describe('T-UX-136 · REQ-122 · the section treatment hides nothing', () => {
  it('T-UX-136a: a full-update review still renders every extracted candidate', () => {
    // ⚠⚠ PRODUCT INVARIANT 2. A failed extraction of a known title must never
    // be readable as a removal, which is only true while the owner can SEE
    // that the title was read. Counting every card on the page, so a section
    // quietly dropped from the render fails here.
    const response = review();
    render(<ReviewPage review={response} />);

    const candidateIds = [candidate(), unmatched, known].map((c) => c.candidateId);
    for (const id of candidateIds) {
      expect(screen.getByTestId(`candidate-${id}`)).toBeInTheDocument();
    }
    expect(document.querySelectorAll('.candidate-card')).toHaveLength(candidateIds.length);
  });

  it('T-UX-136b: the already-correct ones are among them, by name and by count', () => {
    // ⚠ THE SECTION THE DIFFERENTIATION IS MOST TEMPTED TO HIDE. It is the
    // longest and the least interesting, and it is the proof.
    render(<ReviewPage review={review()} />);

    const section = screen.getByTestId('review-already-on-list');
    expect(section).toHaveTextContent('Heat');
    expect(within(section).getByText(`${REVIEW_LABELS.alreadyOnYourList} (1)`).tagName).toBe(
      'SUMMARY',
    );
  });

  it('T-UX-136c: it is in the DOM without being expanded, and is not display:none', () => {
    // `<details>` keeps its children; a treatment that reached for `hidden` or
    // an `aria-hidden` wrapper to "tidy" the section would still pass a naive
    // presence check.
    render(<ReviewPage review={review()} />);

    const card = screen.getByTestId('candidate-cand_known');
    expect(card).not.toHaveAttribute('hidden');
    expect(card.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('T-UX-136d: the sections keep their order — additions, unmatched, known, removals', () => {
    // Reordering is the other half of the forbidden shortcut. Removals stay
    // LAST: the consequential group is the one the owner should reach having
    // already seen everything that was read.
    render(<ReviewPage review={review()} />);

    const order = ['review-additions', 'review-unmatched', 'review-already-on-list'].map((testId) =>
      screen.getByTestId(testId),
    );
    const removals = screen.getByTestId('review-removals');

    expect(order[0]?.compareDocumentPosition(order[1] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(order[1]?.compareDocumentPosition(order[2] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(order[2]?.compareDocumentPosition(removals)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
