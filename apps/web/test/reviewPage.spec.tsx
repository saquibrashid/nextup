/**
 * Review page component tests (TASK-069, TASK-070, TASK-082, TASK-092,
 * TASK-093).
 *
 * Tests:
 *   TASK-069: `T-REV-013`, `T-UX-061`, `T-UX-011`
 *   TASK-070: (confirm-all wired; T-UI-013 is ImageDropzone-owned, blocked)
 *   TASK-082: `T-REV-016` (T-UI-014 already delivered by TASK-162)
 *   TASK-092: `T-REV-017`
 *   TASK-093: `T-REM-011`
 *
 * Also covers: `T-UI-007`, `T-UI-008`, `T-UX-064`, `T-UX-065`
 *
 * ⚠ FINDING: `T-UI-014` is double-claimed by TASK-082 and TASK-162. The
 * test is about the upload page's three ingest affordances and was fully
 * implemented by TASK-162 in `pasteCapture.spec.tsx`. TASK-082 describes
 * the review page's "alreadyOnYourList" section — that work is delivered
 * here as `T-REV-016` (US-013 AC-2), which is the correct test id.
 *
 * ⚠ FINDING: `T-UI-013` (TASK-070 "Done when") is about `ImageDropzone`
 * rendering decode errors verbatim (US-004 AC-11). It cannot be added to
 * `imageDropzone.spec.tsx` because that file is outside this lane's owned
 * paths. Reported in `LANE-H-BLOCKED.md`.
 *
 * ⚠ FINDING: `T-PERF-002` (TASK-070 / TASK-129) is level E (e2e, Playwright).
 * It requires `tests/e2e/` which is outside this lane's owned paths.
 * Reported in `LANE-H-BLOCKED.md`.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ReviewCandidate, ReviewRemovalItem, ReviewResponse } from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';

// ── Fixture builders ─────────────────────────────────────────────────────────

const CANDIDATE_ID = 'cand:01J8ZF000000000000000000B:01J8ZG000000000000000000I:1';
const CANDIDATE_ID_2 = 'cand:01J8ZF000000000000000000B:01J8ZG000000000000000000I:2';
const LISTING_ID = '01J8ZD000000000000000000L';
const LISTING_ID_2 = '01J8ZD000000000000000000M';

function makeCandidate(over: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: CANDIDATE_ID,
    rawText: 'Dune',
    inferredTitle: 'Dune',
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.97,
    resolvedWorkIdentity: 'tmdb:movie:438631',
    match: {
      tmdbId: 438631,
      mediaType: 'movie',
      name: 'Dune',
      releaseYear: 2021,
      posterPath: '/d5NXSklc4TiGrFKD.jpg',
      score: 1.0,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['01J8ZG000000000000000000I'],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    ...over,
  };
}

function makeRemoval(over: Partial<ReviewRemovalItem> = {}): ReviewRemovalItem {
  return {
    listingId: LISTING_ID,
    titleId: '01J8ZC000000000000000000T',
    name: 'Heat',
    releaseYear: 1995,
    posterPath: '/heat.jpg',
    service: 'netflix',
    dateAdded: '2026-01-04',
    ticked: true,
    ...over,
  };
}

/**
 * Builds a minimal full-update ReviewResponse.
 *
 * ⚠ APPEND-ONLY MODE OMITS `alreadyOnYourList` AND `removals` ENTIRELY.
 * Any fixture that needs those sections must use mode: 'full-update'.
 * Already-present items carry `rawText`, not `name`.
 */
function makeReview(over: Partial<ReviewResponse> = {}): ReviewResponse {
  return {
    batchId: '01J8ZF000000000000000000B',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    banner: null,
    sections: {
      additions: { label: 'New to your list', count: 1, items: [makeCandidate()] },
      alreadyOnYourList: {
        label: 'Already on your list',
        count: 0,
        collapsedByDefault: true,
        omitted: false,
        items: [],
      },
      probablyNotTitles: {
        label: 'Probably not titles',
        count: 0,
        collapsedByDefault: true,
        omitted: false,
        items: [],
      },
      unmatched: { label: "Couldn't identify these", count: 0, items: [] },
      unreadableTiles: { label: "Couldn't read these", count: 0, items: [] },
      removals: {
        label: 'No longer on Netflix',
        count: 1,
        omitted: false,
        withheld: false,
        withheldReason: null,
        items: [makeRemoval()],
      },
    },
    imagesWithNoText: [],
    ...over,
  };
}

// ── T-REV-013 ────────────────────────────────────────────────────────────────

describe('T-REV-013 - addition card shows poster, name, year, type', () => {
  it('T-REV-013 addition card renders poster, matched name, release year and media type', () => {
    // Use a candidate where rawText ≠ match.name so the displayName-fallback
    // chain is observable. If displayName collapsed to rawText the name assertion
    // would show 'Dune: Part One (2021)' instead of 'Dune Part One'.
    const candidate = makeCandidate({
      rawText: 'Dune: Part One (2021)',
      match: {
        tmdbId: 438631,
        mediaType: 'movie',
        name: 'Dune Part One',
        releaseYear: 2021,
        posterPath: '/d5NXSklc4TiGrFKD.jpg',
        score: 1.0,
        uncertain: false,
        ambiguous: false,
      },
    });
    render(
      <ReviewPage
        review={makeReview({
          sections: {
            ...makeReview().sections,
            additions: { label: 'New to your list', count: 1, items: [candidate] },
          },
        })}
      />,
    );

    const addList = screen.getByTestId('additions-list');
    const card = within(addList).getByTestId(`candidate-card-${CANDIDATE_ID}`);

    // Poster
    const poster = within(card).getByTestId('candidate-poster');
    expect(poster).toBeInTheDocument();
    expect(poster).toHaveAttribute('alt', 'Poster for Dune Part One');

    // Name shows match.name, not rawText
    expect(within(card).getByTestId('candidate-name').textContent).toBe('Dune Part One');

    // Year
    expect(within(card).getByTestId('candidate-year').textContent).toBe('2021');

    // Type
    expect(within(card).getByTestId('candidate-type').textContent).toBe('Movie');

    // Action buttons present (not readOnly — readOnly hides them)
    expect(within(card).getByTestId('candidate-actions')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });
});

// ── T-UX-061 ─────────────────────────────────────────────────────────────────

describe('T-UX-061 - zero additions renders the explicit empty state, not a blank panel', () => {
  it('T-UX-061 zero-count additions section shows an explicit empty state message', () => {
    render(
      <ReviewPage
        review={makeReview({
          sections: {
            ...makeReview().sections,
            additions: { label: 'New to your list', count: 0, items: [] },
          },
        })}
      />,
    );

    // The section is present
    const section = screen.getByTestId('section-additions');
    expect(section).toBeInTheDocument();

    // The empty state message is visible — NOT a blank panel
    expect(screen.getByTestId('additions-empty')).toBeInTheDocument();

    // There is no item list rendered
    expect(screen.queryByTestId('additions-list')).not.toBeInTheDocument();
  });

  it('T-UX-061b the low-yield banner is visible when lowYield is true', () => {
    render(<ReviewPage review={makeReview({ lowYield: true })} />);

    const banner = screen.getByTestId('low-yield-banner');
    expect(banner).toBeInTheDocument();
    // Banner is an alert so assistive technology announces it
    expect(banner).toHaveAttribute('role', 'alert');
  });
});

// ── T-UX-011 ─────────────────────────────────────────────────────────────────

describe('T-UX-011 - ReviewPage renders a sticky action bar', () => {
  it('T-UX-011 the review action bar is always in the document', () => {
    render(<ReviewPage review={makeReview()} />);

    const bar = screen.getByTestId('review-action-bar');
    expect(bar).toBeInTheDocument();
    // The action bar has aria-label "Review actions"
    expect(bar).toHaveAttribute('aria-label', 'Review actions');
  });
});

// ── T-REV-016 ────────────────────────────────────────────────────────────────

describe('T-REV-016 - alreadyOnYourList items are read-only, not actionable as additions', () => {
  it('T-REV-016 a card in alreadyOnYourList has no confirm or discard buttons', () => {
    const alreadyCandidate = makeCandidate({
      candidateId: CANDIDATE_ID_2,
      rawText: 'Inception',
      classification: 'already-present-for-this-service',
      disposition: 'pending',
    });

    render(
      <ReviewPage
        review={makeReview({
          sections: {
            ...makeReview().sections,
            alreadyOnYourList: {
              label: 'Already on your list',
              count: 1,
              collapsedByDefault: false,
              omitted: false,
              items: [alreadyCandidate],
            },
          },
        })}
      />,
    );

    const section = screen.getByTestId('section-already-on-list');
    const card = within(section).getByTestId(`candidate-card-${CANDIDATE_ID_2}`);

    // No action buttons in the read-only card
    expect(within(card).queryByTestId('candidate-actions')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
  });

  it('T-REV-016b the alreadyOnYourList section is absent from the DOM in append-only', () => {
    render(
      <ReviewPage
        review={makeReview({
          mode: 'append-only',
          sections: {
            ...makeReview().sections,
            alreadyOnYourList: {
              label: 'Already on your list',
              count: 0,
              collapsedByDefault: true,
              omitted: true,
              items: [],
            },
            removals: {
              label: 'No longer on Netflix',
              count: 0,
              omitted: true,
              withheld: false,
              withheldReason: null,
              items: [],
            },
          },
        })}
      />,
    );

    // NOT merely hidden — must be absent from the DOM
    expect(screen.queryByTestId('section-already-on-list')).not.toBeInTheDocument();
  });
});

// ── T-UI-007 ─────────────────────────────────────────────────────────────────

describe('T-UI-007 - every removal arrives ticked and renders checked on first paint', () => {
  it('T-UI-007a all removal checkboxes are checked on first render', () => {
    const removal1 = makeRemoval({ listingId: LISTING_ID, ticked: true });
    const removal2 = makeRemoval({ listingId: LISTING_ID_2, name: 'Inception', ticked: true });

    render(
      <ReviewPage
        review={makeReview({
          sections: {
            ...makeReview().sections,
            removals: {
              label: 'No longer on Netflix',
              count: 2,
              omitted: false,
              withheld: false,
              withheldReason: null,
              items: [removal1, removal2],
            },
          },
        })}
      />,
    );

    const cb1 = screen.getByTestId(`removal-checkbox-${LISTING_ID}`);
    const cb2 = screen.getByTestId(`removal-checkbox-${LISTING_ID_2}`);
    expect(cb1).toBeChecked();
    expect(cb2).toBeChecked();
  });

  it('T-UI-007b a removal item with ticked:true from the API is checked without any user interaction', () => {
    render(<ReviewPage review={makeReview()} />);

    const cb = screen.getByTestId(`removal-checkbox-${LISTING_ID}`);
    // Checked on first paint — no user interaction has occurred
    expect(cb).toBeChecked();
  });
});

// ── T-UI-008 ─────────────────────────────────────────────────────────────────

describe('T-UI-008 - one group confirmation; no per-row remove control in the DOM', () => {
  it('T-UI-008a there is no per-row remove button anywhere in the removals section', () => {
    render(<ReviewPage review={makeReview()} />);

    const section = screen.getByTestId('section-removals');
    // The only buttons in the removals section are in the action bar or dialog,
    // never attached to individual removal rows.
    const rowButtons = within(section).queryAllByRole('button');
    expect(rowButtons).toHaveLength(0);
  });

  it('T-UI-008b clicking Apply changes opens the confirmation dialog naming the ticked titles', async () => {
    const user = userEvent.setup();
    render(<ReviewPage review={makeReview()} />);

    await user.click(screen.getByTestId('review-apply-button'));

    const dialog = screen.getByTestId('removal-confirm-dialog');
    expect(dialog).toBeInTheDocument();

    // Heat (the ticked removal) is named in the dialog
    expect(within(dialog).getByTestId(`removal-dialog-item-${LISTING_ID}`)).toHaveTextContent(
      'Heat',
    );
  });

  it('T-UI-008c confirming the dialog calls onApply with the ticked listing ids', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ReviewPage review={makeReview()} onApply={onApply} />);

    await user.click(screen.getByTestId('review-apply-button'));
    await user.click(screen.getByTestId('removal-dialog-confirm'));

    expect(onApply).toHaveBeenCalledWith([LISTING_ID]);
  });

  it('T-UI-008d an unticked removal is absent from the confirmation dialog', async () => {
    const user = userEvent.setup();
    // One ticked, one unticked removal — only the ticked one must appear in the dialog.
    const tickedRemoval = makeRemoval({ listingId: LISTING_ID, name: 'Heat', ticked: true });
    const untickedRemoval = makeRemoval({
      listingId: LISTING_ID_2,
      name: 'Inception',
      ticked: false,
    });
    render(
      <ReviewPage
        review={makeReview({
          sections: {
            ...makeReview().sections,
            removals: {
              label: 'No longer on Netflix',
              count: 2,
              omitted: false,
              withheld: false,
              withheldReason: null,
              items: [tickedRemoval, untickedRemoval],
            },
          },
        })}
      />,
    );

    await user.click(screen.getByTestId('review-apply-button'));

    const dialog = screen.getByTestId('removal-confirm-dialog');
    // Ticked item IS in the dialog
    expect(within(dialog).getByTestId(`removal-dialog-item-${LISTING_ID}`)).toBeInTheDocument();
    // Unticked item is NOT in the dialog
    expect(
      within(dialog).queryByTestId(`removal-dialog-item-${LISTING_ID_2}`),
    ).not.toBeInTheDocument();
  });
});

// ── T-UX-064 ─────────────────────────────────────────────────────────────────

describe('T-UX-064 - the removals count is visible without expanding the section', () => {
  it('T-UX-064 the removals summary shows the selected count before the <details> is opened', () => {
    render(<ReviewPage review={makeReview()} />);

    const summary = screen.getByTestId('removals-summary');
    // The count is in the summary element (visible without expanding <details>)
    expect(summary.textContent).toContain('1 selected');
  });
});

// ── T-UX-065 ─────────────────────────────────────────────────────────────────

describe('T-UX-065 - undo affordance offered immediately after confirmation', () => {
  it('T-UX-065 clicking confirm in the removal dialog reveals the undo button immediately', async () => {
    const user = userEvent.setup();
    render(<ReviewPage review={makeReview()} />);

    await user.click(screen.getByTestId('review-apply-button'));
    await user.click(screen.getByTestId('removal-dialog-confirm'));

    // Immediately after — no navigation, no wait — the undo affordance is visible
    const undo = screen.getByTestId('removal-undo-button');
    expect(undo).toBeInTheDocument();
  });
});

// ── T-REM-011 (component half) ───────────────────────────────────────────────

describe('T-REM-011 - append-only: no removals section exists in the DOM', () => {
  it('T-REM-011 append-only mode: the removals section is absent from the DOM, not merely hidden', () => {
    render(
      <ReviewPage
        review={makeReview({
          mode: 'append-only',
          sections: {
            ...makeReview().sections,
            alreadyOnYourList: {
              label: 'Already on your list',
              count: 0,
              collapsedByDefault: true,
              omitted: true,
              items: [],
            },
            removals: {
              label: 'No longer on Netflix',
              count: 0,
              omitted: true,
              withheld: false,
              withheldReason: null,
              items: [],
            },
          },
        })}
      />,
    );

    // The removals section must be ABSENT, not merely hidden
    expect(screen.queryByTestId('section-removals')).not.toBeInTheDocument();
    expect(screen.queryByTestId('removals-summary')).not.toBeInTheDocument();
  });
});

// ── T-REV-017 (component half) ───────────────────────────────────────────────

describe('T-REV-017 - discrepancy is visible: missed title in removals, rest in known-titles', () => {
  it('T-REV-017 a known title missed by extraction appears in removals, and the known-titles section shows the rest', () => {
    // Scenario: Heat was on the list but not extracted → in removals.
    // Inception was extracted AND on the list → in alreadyOnYourList.
    // The discrepancy (Heat absent from extraction but present in list) is visible.
    const knownCandidate = makeCandidate({
      candidateId: CANDIDATE_ID_2,
      rawText: 'Inception',
      match: {
        tmdbId: 27205,
        mediaType: 'movie',
        name: 'Inception',
        releaseYear: 2010,
        posterPath: '/inception.jpg',
        score: 0.99,
        uncertain: false,
        ambiguous: false,
      },
      classification: 'already-present-for-this-service',
    });

    const heatRemoval = makeRemoval({ name: 'Heat', listingId: LISTING_ID, ticked: true });

    render(
      <ReviewPage
        review={makeReview({
          sections: {
            ...makeReview().sections,
            additions: { label: 'New to your list', count: 0, items: [] },
            alreadyOnYourList: {
              label: 'Already on your list',
              count: 1,
              collapsedByDefault: false,
              omitted: false,
              items: [knownCandidate],
            },
            removals: {
              label: 'No longer on Netflix',
              count: 1,
              omitted: false,
              withheld: false,
              withheldReason: null,
              items: [heatRemoval],
            },
          },
        })}
      />,
    );

    // The removals section shows Heat (missed by extraction)
    const removalsSection = screen.getByTestId('section-removals');
    expect(within(removalsSection).getByText(/Heat/)).toBeInTheDocument();

    // The already-on-list section shows Inception (successfully extracted and known)
    const knownSection = screen.getByTestId('section-already-on-list');
    const knownCard = within(knownSection).getByTestId(`candidate-card-${CANDIDATE_ID_2}`);
    expect(within(knownCard).getByTestId('candidate-name').textContent).toBe('Inception');
  });
});

// ── Confirm-all control (TASK-070, SD-11a) ───────────────────────────────────

describe('Confirm-all control (TASK-070, SD-11a)', () => {
  it('T-UX-064b confirm-all button is present when additions count > 0 and calls onConfirmAll with the section name', async () => {
    const user = userEvent.setup();
    const onConfirmAll = vi.fn();
    render(<ReviewPage review={makeReview()} onConfirmAll={onConfirmAll} />);

    const btn = screen.getByTestId('confirm-all-additions');
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(onConfirmAll).toHaveBeenCalledWith('additions');
  });

  it('T-UX-064c confirm-all button is absent when the additions section is empty', () => {
    render(
      <ReviewPage
        review={makeReview({
          sections: {
            ...makeReview().sections,
            additions: { label: 'New to your list', count: 0, items: [] },
          },
        })}
      />,
    );

    expect(screen.queryByTestId('confirm-all-additions')).not.toBeInTheDocument();
  });
});

// ── Full-update safety: alreadyOnYourList section present and not omitted ────

describe('Full-update safety invariant (T-REV-006)', () => {
  it('T-UI-007c alreadyOnYourList section is rendered in full-update even when omitted: false and count 0', () => {
    // omitted: false, count: 0 means "we looked, nothing here" — NOT the same as omitted: true
    render(
      <ReviewPage
        review={makeReview({
          sections: {
            ...makeReview().sections,
            additions: { label: 'New to your list', count: 0, items: [] },
          },
        })}
      />,
    );

    // The section is present in the DOM (count: 0 but omitted: false)
    const section = screen.getByTestId('section-already-on-list');
    expect(section).toBeInTheDocument();
    expect(section.dataset['count']).toBe('0');
  });
});
