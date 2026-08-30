/**
 * `T-REV-013`, `T-UX-061`, `T-UX-011` — the review pass renders (TASK-069,
 * `specs/ui.md` §5).
 *
 * ⚠ **THIS SCREEN IS THE SAFETY GATE, AND IT WAS A FOUR-LINE STUB.** Every
 * server-side guarantee about the review — that a full update lists the titles
 * it already knows (`T-REV-006`), that the two directions of disagreement land
 * in different visible sections (`T-REV-017`), that append-only proposes
 * nothing for removal — is a guarantee about a JSON body that nothing rendered.
 * A correct response the owner never sees is not a safeguard.
 *
 * These cases are about the DOM. The partitioning itself is asserted where it
 * is decided, in `packages/domain/test/review.spec.ts` and
 * `apps/api/test/integration/batchReview.spec.ts`; re-deriving it here would
 * be a second implementation of the one rule whose point is having only one.
 *
 * ⚠ THE FIXTURES GO THROUGH `buildReviewResponse`, NOT THROUGH A HAND-WRITTEN
 * OBJECT LITERAL. A fixture that invents the response shape — and reaches it
 * with `as ReviewResponse` — is how the suppressed screen's suite stayed green
 * against a component that threw on every row (TASK-107). Here the compiler
 * checks the fixture against the real contract, and a section renamed in the
 * domain breaks this file instead of silently un-covering a section.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildReviewResponse,
  pendingAdditionIds,
  DEGRADED_EXTRACTION_BANNER,
  type BuildReviewInput,
  type ReviewCandidate,
  type ReviewMatch,
} from '@nextup/domain';

import { reviewStorageKey } from '../src/lib/reviewDispositions';
import { ReviewPage } from '../src/pages/ReviewPage';

function match(overrides: Partial<ReviewMatch> = {}): ReviewMatch {
  return {
    tmdbId: 603,
    mediaType: 'movie',
    name: 'The Matrix',
    releaseYear: 1999,
    posterPath: '/matrix.jpg',
    score: 0.98,
    uncertain: false,
    ambiguous: false,
    ...overrides,
  };
}

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
    match: match(),
    alternatives: [],
    sourceImageIds: ['img_1'],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    ...overrides,
  };
}

function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: '01J0000000000000000000BTCH',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [candidate()],
    disappearedListings: [],
    imagesWithNoText: [],
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */

describe('T-REV-013 · specs/ui.md §5.3 · an addition card shows poster, name, year and type', () => {
  it('T-REV-013a: the resolved name is rendered', () => {
    render(<ReviewPage review={review()} />);

    expect(screen.getByTestId('candidate-name')).toHaveTextContent('The Matrix');
  });

  it('T-REV-013b: the poster is rendered from the TMDB path', () => {
    render(<ReviewPage review={review()} />);

    expect(screen.getByTestId('candidate-poster')).toHaveAttribute(
      'src',
      expect.stringContaining('/matrix.jpg'),
    );
  });

  it('T-REV-013c: the year and the media type are both rendered', () => {
    render(<ReviewPage review={review()} />);

    const meta = screen.getByTestId('candidate-meta');
    // "Film"/"Series", not "movie"/"tv" — AC-4 is about what the owner can
    // read, and the API's discriminator is not English.
    expect(meta).toHaveTextContent('Film');
    expect(meta).toHaveTextContent('1999');
  });

  it('T-REV-013d: a series is labelled Series, not Film', () => {
    // Otherwise a hard-coded label satisfies T-REV-013c while telling the
    // owner every title is a film.
    render(
      <ReviewPage
        review={review({
          candidates: [candidate({ match: match({ mediaType: 'tv', name: 'Severance' }) })],
        })}
      />,
    );

    expect(screen.getByTestId('candidate-meta')).toHaveTextContent('Series');
  });

  it('T-REV-013e: the RAW EXTRACTED TEXT is visible beside the proposed match', () => {
    // ⚠ §5.3. The owner's ONLY way to tell a good match from a plausible wrong
    // one is to see what was read off the screenshot next to what nextup
    // decided it meant. A card showing only the resolved name makes every
    // misread look correct, and the owner confirms it.
    render(
      <ReviewPage
        review={review({ candidates: [candidate({ rawText: 'THE MATRlX', match: match() })] })}
      />,
    );

    expect(screen.getByTestId('candidate-raw-text')).toHaveTextContent('THE MATRlX');
  });

  it('T-REV-013f: a missing poster degrades to a placeholder, never to a broken image', () => {
    render(
      <ReviewPage
        review={review({ candidates: [candidate({ match: match({ posterPath: null }) })] })}
      />,
    );

    expect(screen.queryByTestId('candidate-poster')).not.toBeInTheDocument();
    expect(screen.getByTestId('candidate-poster-placeholder')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('T-UX-061 · specs/ux-states.md · zero additions renders an EXPLICIT empty state', () => {
  const noAdditions = () =>
    review({
      candidates: [candidate({ classification: 'already-present-for-this-service' })],
    });

  it('T-UX-061a: the additions section still exists when nothing is new', () => {
    // ⚠ NOT ABSENT. `count: 0` means "we looked and there was nothing";
    // absence is reserved for a section the MODE does not apply (REQ-022).
    render(<ReviewPage review={noAdditions()} />);

    expect(screen.getByTestId('review-additions')).toBeInTheDocument();
  });

  it('T-UX-061b: it says so in words rather than rendering a blank panel', () => {
    // ⚠ A BLANK PANEL READS AS A FAILED RENDER, and the owner's next move is
    // to upload the same screenshots again — producing a second batch of the
    // same titles to review.
    render(<ReviewPage review={noAdditions()} />);

    const empty = screen.getByTestId('review-additions-empty');
    expect(empty).toHaveTextContent('Nothing new in these screenshots');
    expect(empty.textContent?.trim().length ?? 0).toBeGreaterThan(20);
  });

  it('T-UX-061c: the empty state is NOT shown when there are additions', () => {
    // Without this, a component that always renders the empty state passes
    // T-UX-061b while telling the owner nothing was found on every batch.
    render(<ReviewPage review={review()} />);

    expect(screen.queryByTestId('review-additions-empty')).not.toBeInTheDocument();
  });

  it('T-UX-061d: an applicable-but-empty section says so instead of collapsing to nothing', () => {
    // The same distinction one level down: "Probably not titles (0)" applies
    // in every mode, so an empty body there must read as "we looked".
    render(<ReviewPage review={review()} />);

    const section = screen.getByTestId('review-probably-not-titles');
    expect(section).toHaveTextContent('(0)');
    expect(within(section).getByTestId('review-section-empty')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('T-UX-011 · specs/ui.md §5.4 SD-11d · the action bar is STICKY', () => {
  const CSS = readFileSync(
    join(
      process.cwd().endsWith(join('apps', 'web'))
        ? process.cwd()
        : join(process.cwd(), 'apps', 'web'),
      'src',
      'index.css',
    ),
    'utf8',
  );

  it('T-UX-011a: the action bar is rendered', () => {
    render(<ReviewPage review={review()} />);

    expect(screen.getByTestId('review-action-bar')).toBeInTheDocument();
  });

  it('T-UX-011b: it carries position: sticky pinned to the bottom', () => {
    // ⚠ ASSERTED AGAINST THE STYLESHEET AS A FILE. jsdom computes no layout,
    // so a "does it render?" check passes on a bar that scrolls away — which
    // is precisely the failure US-037 describes, and it is invisible to every
    // other assertion in this suite.
    const rule = /\.review-action-bar\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/bottom:\s*0/);
  });

  it('T-UX-011c: the primary action lives inside the bar, not above the fold', () => {
    // A sticky bar that does not contain the confirm action leaves the action
    // itself unreachable at the bottom of a 200-candidate pass.
    render(<ReviewPage review={review()} />);

    const bar = screen.getByTestId('review-action-bar');
    expect(within(bar).getByTestId('apply-changes-button')).toBeInTheDocument();
    expect(within(bar).getByTestId('discard-batch-button')).toBeInTheDocument();
  });

  it('T-UX-011d: the bar carries the running counts', () => {
    // SD-11d — the counts are what tell the owner what confirming will do,
    // at the moment they are about to confirm it.
    render(<ReviewPage review={review()} />);

    expect(screen.getByTestId('review-counts')).toHaveTextContent('1 to add');
    expect(screen.getByTestId('review-counts')).toHaveTextContent('0 to remove');
  });

  it('T-UX-011e: every control in the bar meets the tap-target floor', () => {
    render(<ReviewPage review={review()} />);

    const bar = screen.getByTestId('review-action-bar');
    for (const button of within(bar).getAllByRole('button')) {
      expect(button).toHaveClass('tap-target');
    }
  });
});

/* -------------------------------------------------------------------------- */

/**
 * `T-UX-062` — `specs/ux-states.md` §6.7 partial review: the action bar reads
 * *"9 to add · 3 to remove · 2 still to review"*.
 *
 * ⚠ **THE THIRD CLAUSE WAS MISSING AND IT IS THE LOAD-BEARING ONE.** The bar
 * shipped reading only "N to add · M to remove" — the two numbers that say what
 * a close would WRITE. Neither says whether the close will be ACCEPTED, and
 * `closeBatch` refuses the whole batch with 409 `PENDING_ADDITIONS` while any
 * decidable candidate is still `pending`. The owner's only way to discover an
 * undecided card was therefore to press **Apply changes** and be refused, which
 * is the §6.14 error state doing the job §6.7 exists to make unnecessary.
 *
 * ⚠ **THE COUNT IS ASSERTED AGAINST THE SERVER'S OWN GATE, NOT AGAINST A
 * LITERAL.** `T-UX-062e` runs `pendingAdditionIds` — the exact function
 * `closeBatch` calls — over the same fixture and requires the rendered number
 * to equal its length. A hand-written expectation would go on agreeing after
 * the gate's definition of "pending" changed, which is the one way this number
 * can become a confident lie.
 */
describe('T-UX-062 · specs/ux-states.md §6.7 · the bar reports what is still undecided', () => {
  /** Two additions and one unmatched row, each independently decidable. */
  function partial(dispositions: {
    readonly first: ReviewCandidate['disposition'];
    readonly second: ReviewCandidate['disposition'];
    readonly unmatched: ReviewCandidate['disposition'];
  }) {
    return {
      candidates: [
        candidate({ candidateId: 'cand_1', disposition: dispositions.first }),
        candidate({
          candidateId: 'cand_2',
          rawText: 'ARRIVAL',
          inferredTitle: 'Arrival',
          resolvedWorkIdentity: 'tmdb:movie:329865',
          match: match({ tmdbId: 329865, name: 'Arrival', releaseYear: 2016 }),
          disposition: dispositions.second,
        }),
        candidate({
          candidateId: 'cand_3',
          rawText: 'SOME UNREADABLE THING',
          inferredTitle: 'Some unreadable thing',
          resolvedWorkIdentity: null,
          match: null,
          disposition: dispositions.unmatched,
        }),
      ],
    } satisfies Partial<BuildReviewInput>;
  }

  it('T-UX-062a: undecided additions are reported as "still to review"', () => {
    render(
      <ReviewPage
        review={review(partial({ first: 'pending', second: 'pending', unmatched: 'confirmed' }))}
      />,
    );

    expect(screen.getByTestId('review-counts')).toHaveTextContent('2 still to review');
  });

  it('T-UX-062b: an undecided UNMATCHED row counts too — the close gate counts it', () => {
    // ⚠ NOT A COMPLETENESS FLOURISH. `CLOSE_DECIDABLE_SECTIONS` is
    // `['additions', 'unmatched']`, so a bar that counted additions alone would
    // read "0 still to review" on a batch the server is about to refuse — a
    // number that is worse than absent, because it is confidently wrong.
    render(
      <ReviewPage
        review={review(partial({ first: 'confirmed', second: 'confirmed', unmatched: 'pending' }))}
      />,
    );

    expect(screen.getByTestId('review-counts')).toHaveTextContent('1 still to review');
  });

  it('T-UX-062c: with everything decided the clause is ABSENT, not "0 still to review"', () => {
    // §6.7 is the PARTIAL-review state. With nothing outstanding there is
    // nothing to report, and a permanent "0 still to review" would train the
    // owner to read past the one clause that ever needs their attention.
    render(
      <ReviewPage
        review={review(
          partial({ first: 'confirmed', second: 'discarded', unmatched: 'confirmed' }),
        )}
      />,
    );

    const counts = screen.getByTestId('review-counts');
    expect(counts).toHaveTextContent('2 to add');
    expect(counts.textContent).not.toContain('still to review');
  });

  it('T-UX-062d: a local (SD-11e) decision is reflected before the server has it', () => {
    // The owner's presses are cached locally and the container refetches after
    // them; a count read from `disposition` alone would sit at its old value
    // through the whole gap, which is exactly when the owner is watching it.
    const storage = new Map<string, string>();
    const view = review(partial({ first: 'pending', second: 'pending', unmatched: 'pending' }));
    storage.set(
      reviewStorageKey(view.batchId),
      JSON.stringify({ cand_1: 'confirmed', cand_3: 'discarded' }),
    );

    render(
      <ReviewPage
        review={view}
        storage={{
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
        }}
      />,
    );

    expect(screen.getByTestId('review-counts')).toHaveTextContent('1 still to review');
  });

  it('T-UX-062e: the number EQUALS what the server\u2019s close gate would refuse on', () => {
    const input = partial({ first: 'pending', second: 'confirmed', unmatched: 'pending' });
    const expected = pendingAdditionIds(input.candidates).length;

    render(<ReviewPage review={review(input)} />);

    // The gate's own answer, not a literal — see the block note above.
    expect(expected).toBeGreaterThan(0);
    expect(screen.getByTestId('review-counts')).toHaveTextContent(`${expected} still to review`);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * `T-UX-057` / `T-UX-058` — `specs/ux-states.md` §5.9 and §5.10 require the
 * degraded-read banner **on both the status page and the review page**.
 *
 * ⚠ **ONLY THE STATUS-PAGE HALF EXISTED.** `T-UX-008` covers that surface
 * thoroughly, and `T-UX-008h` is even titled *"the wording is IDENTICAL to the
 * review page banner"* — but it renders `BatchStatusPage` and compares that
 * page's own text to the shared constant. It never renders the review at all.
 * A test that asserts parity with a surface it does not mount can only ever
 * report on the surface it does mount.
 *
 * ⚠ **AND THE REVIEW HALF WAS HALF-BUILT.** `reviewBanner()` returned the
 * constant for `llm-unavailable` and `null` for `ocr-unavailable`, while
 * `isDegraded()` on the status page accepted both. One event therefore produced
 * a banner on one screen and silence on the other — and silence on the review
 * is the expensive one, because the review is where the owner CONFIRMS.
 *
 * These cases mount `ReviewPage` and compare against the same
 * `DEGRADED_EXTRACTION_BANNER` the status-page suite imports, so the two
 * surfaces cannot drift apart on the next copy edit.
 */
describe('T-UX-057 · T-UX-058 · §5.9/§5.10 · the degraded banner reaches the REVIEW page', () => {
  it('T-UX-057a: §5.9 — the tile reader was down: the review carries the banner', () => {
    render(
      <ReviewPage review={review({ crossCheck: 'llm-unavailable', degradedExtraction: true })} />,
    );

    expect(screen.getByTestId('review-banner').textContent).toBe(DEGRADED_EXTRACTION_BANNER);
  });

  it('T-UX-057b: it is NOT dismissible — no control can remove it', () => {
    // §5.9 says persistent and non-dismissible. On this screen especially: the
    // banner qualifies the very list the owner is about to confirm.
    render(
      <ReviewPage review={review({ crossCheck: 'llm-unavailable', degradedExtraction: true })} />,
    );

    expect(within(screen.getByTestId('review-banner')).queryAllByRole('button')).toHaveLength(0);
  });

  it('T-UX-058a: §5.10 — the CROSS-CHECK reader was down: same banner, still shown', () => {
    // ⚠ The case that was missing. It is the tempting one to treat as healthy,
    // because removals are still permitted — but "we could not corroborate what
    // we read" is precisely what the owner needs before confirming a removal.
    render(<ReviewPage review={review({ crossCheck: 'ocr-unavailable' })} />);

    expect(screen.getByTestId('review-banner').textContent).toBe(DEGRADED_EXTRACTION_BANNER);
  });

  it('T-UX-058b: §5.10 is the MILDER consequence — removals are still offered', () => {
    // The banner must not be mistaken for withholding. If this ever fails
    // alongside `T-UX-058a` passing, the fix went too far and turned an OCR
    // outage into a full-update blocker (`T-AI-021e`).
    render(
      <ReviewPage
        review={review({
          crossCheck: 'ocr-unavailable',
          disappearedListings: [
            { listingId: 'lst_1', titleId: 'ttl_1', name: 'Arrival', year: 2016, posterPath: null },
          ],
        })}
      />,
    );

    expect(screen.getByTestId('review-banner').textContent).toBe(DEGRADED_EXTRACTION_BANNER);
    expect(screen.getByTestId('review-counts')).toHaveTextContent('1 to remove');
  });

  it('T-UX-058c: a healthy read carries NO banner on the review either', () => {
    render(<ReviewPage review={review({ crossCheck: 'ok' })} />);

    expect(screen.queryByTestId('review-banner')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('the mode contract is visible in the DOM', () => {
  it('T-REV-013g: full update ALWAYS renders "Already on your list" with its count', () => {
    // ⚠ PRODUCT INVARIANT 2, rendered. `T-REV-006` pins it in the response;
    // this pins that the response reaches the screen. A failed extraction of a
    // known title must never be presentable as a removal.
    render(<ReviewPage review={review()} />);

    const section = screen.getByTestId('review-already-on-list');
    expect(section).toHaveTextContent('Already on your list (0)');
  });

  it('T-REV-013h: the count is inside the <summary>, so it survives collapsing', () => {
    // SD-11b. A count rendered in the body is invisible in the collapsed
    // state, which is the state the section is in by default — so the owner's
    // only sanity check against an under-read batch would never be on screen.
    render(<ReviewPage review={review()} />);

    const summary = within(screen.getByTestId('review-already-on-list')).getByText(
      /Already on your list \(0\)/,
    );
    expect(summary.tagName).toBe('SUMMARY');
  });

  it('T-UX-099a · US-015 AC-6 · the removals COUNT is on screen without expanding the section', () => {
    // ⚠ THE COUNT IS THE OWNER'S ONLY CHEAP SANITY CHECK ON A FULL UPDATE.
    // "3 to remove" when they expected one is the signal that the extraction
    // under-read the screenshots — and it has to be legible at a glance, in
    // the collapsed state, or it is not a check at all. Asserting the number
    // is somewhere in the DOM would pass with it buried in the expanded list.
    render(
      <ReviewPage
        review={review({
          disappearedListings: [
            { listingId: 'lst_1', titleId: 'ttl_1', name: 'Arrival', year: 2016, posterPath: null },
            { listingId: 'lst_2', titleId: 'ttl_2', name: 'Heat', year: 1995, posterPath: null },
          ],
        })}
      />,
    );

    const section = screen.getByTestId('review-removals');
    const summary = within(section).getByText(/\(2\)/);
    // The <summary> is the ONE element a closed <details> still renders.
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')).not.toBeNull();
  });

  it('T-UX-099b · US-015 AC-6 · the count survives the section actually being closed', () => {
    // `099a` proves the count is in the right element. This proves the claim
    // that element makes: close the <details> and the number is still there.
    // Without it, `099a` is an assertion about tag names rather than about
    // what the owner can see.
    render(
      <ReviewPage
        review={review({
          disappearedListings: [
            { listingId: 'lst_1', titleId: 'ttl_1', name: 'Arrival', year: 2016, posterPath: null },
            { listingId: 'lst_2', titleId: 'ttl_2', name: 'Heat', year: 1995, posterPath: null },
          ],
        })}
      />,
    );

    const details = within(screen.getByTestId('review-removals'))
      .getByText(/\(2\)/)
      .closest('details');
    expect(details).not.toBeNull();
    (details as HTMLDetailsElement).open = false;

    expect(within(screen.getByTestId('review-removals')).getByText(/\(2\)/)).toBeVisible();
    // The rows themselves are what collapsing is FOR — jsdom does not apply
    // the UA stylesheet that hides them, so the honest assertion here is that
    // the count is not one of them: it sits outside the list.
    const list = screen.getByTestId('review-removals').querySelector('.review-section__list');
    expect(list?.textContent ?? '').not.toContain('(2)');
  });

  it('T-REV-013i: append-only renders NEITHER the known section NOR removals', () => {
    // REQ-022. `T-REM-011` (TASK-093) owns this properly; asserted here too
    // because the section components are written here and a regression is
    // cheapest to catch at the point it is introduced.
    render(<ReviewPage review={review({ mode: 'append-only' })} />);

    expect(screen.queryByTestId('review-already-on-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-removals')).not.toBeInTheDocument();
  });
});
