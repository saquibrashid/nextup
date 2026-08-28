/**
 * TASK-070 — the three review ergonomics of `specs/ui.md` §5.4:
 * **SD-11a** the "Confirm all N" control, **SD-11c** virtualisation above 100
 * items in a section, and **SD-11e** dispositions persisted to
 * `sessionStorage` under `nextup.review.<batchId>`.
 *
 * ⚠ **THE BACKLOG ROW NAMED ONLY `E`-LEVEL IDS** — `T-E2E-001` step 3 and
 * `T-PERF-002` — both owned by LATER tasks (TASK-080, TASK-129). As written,
 * this task could be built, merged and marked `done` with nothing asserting it
 * at the layer it is written in, and the two ids that would eventually cover
 * it would arrive owned by someone else. `T-UI-025`/`026`/`027` are defined in
 * `specs/testing.md` §12.2 — the section that exists for exactly this — and
 * cited from the backlog row.
 *
 * ⚠ **`T-PERF-002` CANNOT SUBSTITUTE FOR `T-UI-026`.** It measures a real
 * browser at 500 candidates and asserts the page stays interactive; it cannot
 * distinguish "fast because windowed" from "fast because the machine is". The
 * threshold behaviour — windowed above 100, plain at or below — is a decision
 * only a component test can pin, and it must be pinned in BOTH directions:
 * virtualising unconditionally silently renders a subset of a nine-item
 * section anywhere layout is not computed, which is every component test in
 * this suite.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildReviewResponse, type BuildReviewInput, type ReviewCandidate } from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';
import { REVIEW_CONFIRM_ALL } from '../src/copy';
import {
  clearLocalDispositions,
  effectiveDisposition,
  readLocalDispositions,
  reviewStorageKey,
  writeLocalDispositions,
} from '../src/lib/reviewDispositions';

const BATCH_ID = '01J0000000000000000000BTCH';

/** A minimal in-memory `Storage`, so the persistence rule is observable. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
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

/** `n` distinct additions, so section size is the only variable. */
function additions(n: number, overrides: Partial<ReviewCandidate> = {}): ReviewCandidate[] {
  return Array.from({ length: n }, (_unused, index) =>
    candidate({
      candidateId: `cand_${index + 1}`,
      resolvedWorkIdentity: `tmdb:movie:${1000 + index}`,
      ...overrides,
    }),
  );
}

/** An unmatched candidate: no identity, no match (`T-CLS-013`). */
function unmatched(candidateId: string): ReviewCandidate {
  return candidate({
    candidateId,
    resolvedWorkIdentity: null,
    match: null,
    classification: null,
  });
}

function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: BATCH_ID,
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: additions(2),
    disappearedListings: [],
    imagesWithNoText: [],
    ...overrides,
  });
}

const cards = (): number => document.querySelectorAll('.candidate-card').length;

/* ── SD-11a ─────────────────────────────────────────────────────────────── */

describe('T-UI-025 · SD-11a · the "Confirm all N" control', () => {
  it('T-UI-025a offers one press for the whole additions section', () => {
    // Without it a 200-title first import is ~200 taps (`specs/ui.md` §5.4).
    render(<ReviewPage review={review()} storage={fakeStorage()} />);

    const button = within(screen.getByTestId('review-additions')).getByTestId('confirm-all-button');
    expect(button.textContent).toBe(REVIEW_CONFIRM_ALL.replace('{n}', '2'));
  });

  it('T-UI-025b counts the DECISIONS the press would make, not the section', () => {
    // ⚠ A button reading "Confirm all 3" over one undecided row is a false
    // promise about what one tap is about to do — and this is the assertion
    // that stops `section.count` being used because it is closer to hand.
    const mixed = [
      candidate({ candidateId: 'cand_1', disposition: 'confirmed' }),
      candidate({ candidateId: 'cand_2', resolvedWorkIdentity: 'tmdb:movie:1001' }),
      candidate({
        candidateId: 'cand_3',
        resolvedWorkIdentity: 'tmdb:movie:1002',
        disposition: 'discarded',
      }),
    ];
    render(<ReviewPage review={review({ candidates: mixed })} storage={fakeStorage()} />);

    const section = screen.getByTestId('review-additions');
    expect(section.textContent).toContain('(3)');
    expect(within(section).getByTestId('confirm-all-button').textContent).toBe(
      REVIEW_CONFIRM_ALL.replace('{n}', '1'),
    );
  });

  it('T-UI-025c disappears once there is nothing left to decide', () => {
    // "Confirm all 0" is a control that does nothing, and a control that does
    // nothing teaches the owner that this screen's buttons are decorative.
    render(
      <ReviewPage
        review={review({ candidates: additions(2, { disposition: 'confirmed' }) })}
        storage={fakeStorage()}
      />,
    );

    expect(
      within(screen.getByTestId('review-additions')).queryByTestId('confirm-all-button'),
    ).toBeNull();
  });

  it('T-UI-025d is ABSENT from "Already on your list", though the API accepts it', () => {
    // ⚠ `T-REV-016` requires that section to carry NO control: those works are
    // already on the list, so a bulk confirm there is either a no-op or the
    // duplicate-identity add the server refuses. The API permits the section
    // for callers that are not this screen.
    render(
      <ReviewPage
        review={review({
          candidates: additions(2, { classification: 'already-present-for-this-service' }),
        })}
        storage={fakeStorage()}
      />,
    );

    const section = screen.getByTestId('review-already-on-list');
    expect(within(section).queryByTestId('confirm-all-button')).toBeNull();
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
  });

  it('T-UI-025e is absent from the collapsed-by-default sections', () => {
    // Bulk-confirming what the owner never opened is accept-by-inaction, which
    // REQ-014 forbids — the same reason TASK-066's endpoint refuses them.
    render(
      <ReviewPage
        review={review({
          candidates: [
            candidate({ candidateId: 'cand_1', verdict: 'chrome-suspected' }),
            candidate({
              candidateId: 'cand_2',
              resolvedWorkIdentity: null,
              match: null,
              classification: null,
              verdict: 'unreadable-tile',
            }),
          ],
        })}
        storage={fakeStorage()}
      />,
    );

    for (const testId of ['review-probably-not-titles', 'review-unreadable-tiles']) {
      expect(within(screen.getByTestId(testId)).queryByTestId('confirm-all-button')).toBeNull();
    }
  });

  it('T-UI-025f reports the section it confirmed, so the caller can post it', () => {
    const onConfirmAll = vi.fn();
    render(<ReviewPage review={review()} onConfirmAll={onConfirmAll} storage={fakeStorage()} />);

    fireEvent.click(
      within(screen.getByTestId('review-additions')).getByTestId('confirm-all-button'),
    );

    expect(onConfirmAll).toHaveBeenCalledWith('additions');
  });

  it('T-UI-025g gives the unmatched section its own control and its own key', () => {
    const onConfirmAll = vi.fn();
    render(
      <ReviewPage
        review={review({ candidates: [unmatched('cand_1'), unmatched('cand_2')] })}
        onConfirmAll={onConfirmAll}
        storage={fakeStorage()}
      />,
    );

    fireEvent.click(
      within(screen.getByTestId('review-unmatched')).getByTestId('confirm-all-button'),
    );

    expect(onConfirmAll).toHaveBeenCalledWith('unmatched');
  });

  it('T-UI-025h leaves an already-decided row alone', () => {
    // ⚠ A bulk confirm that overwrote a `discarded` row would be a silent undo
    // of a decision the owner had already made — the one thing a one-tap
    // control must never do.
    const storage = fakeStorage({
      [reviewStorageKey(BATCH_ID)]: JSON.stringify({ cand_1: 'discarded' }),
    });
    render(<ReviewPage review={review()} storage={storage} />);

    fireEvent.click(
      within(screen.getByTestId('review-additions')).getByTestId('confirm-all-button'),
    );

    expect(readLocalDispositions(BATCH_ID, storage)).toEqual({
      cand_1: 'discarded',
      cand_2: 'confirmed',
    });
  });

  it('T-UI-025i drops away after the press, because nothing is pending', () => {
    render(<ReviewPage review={review()} storage={fakeStorage()} />);

    const section = screen.getByTestId('review-additions');
    fireEvent.click(within(section).getByTestId('confirm-all-button'));

    expect(
      within(screen.getByTestId('review-additions')).queryByTestId('confirm-all-button'),
    ).toBeNull();
  });

  it('T-UI-025j pins the label, because every other case compares to the constant', () => {
    // ⚠ Every assertion above reads `REVIEW_CONFIRM_ALL` for its expectation,
    // so rewording the constant moves both sides of the comparison and kills
    // nothing. `{n}` in particular is load-bearing: a label with no
    // interpolation point renders "Confirm all" over an unknown number of
    // rows, and this screen's whole job is telling the owner what one tap does.
    expect(REVIEW_CONFIRM_ALL).toBe('Confirm all {n}');
  });
});

/* ── SD-11c ─────────────────────────────────────────────────────────────── */

describe('T-UI-026 · SD-11c · the list is virtualised above 100 items', () => {
  it('T-UI-026a renders every card at the threshold', () => {
    // ⚠ THE LOWER DIRECTION IS THE ONE THAT FAILS SILENTLY. A component test
    // environment computes no layout, so an unconditionally-windowed list
    // renders a subset of a small section and every DOM assertion in this
    // suite starts passing for the wrong reason.
    render(<ReviewPage review={review({ candidates: additions(100) })} storage={fakeStorage()} />);

    expect(cards()).toBe(100);
    expect(screen.queryByTestId('candidate-list-viewport')).toBeNull();
  });

  it('T-UI-026b windows the list one item above it', () => {
    render(<ReviewPage review={review({ candidates: additions(101) })} storage={fakeStorage()} />);

    expect(screen.getByTestId('candidate-list-viewport')).not.toBeNull();
    expect(cards()).toBeLessThan(101);
  });

  it('T-UI-026c keeps list semantics in both branches', () => {
    // A windowed list built from `<div>`s reads as unstructured text at
    // exactly the size where structure matters most.
    const { unmount } = render(
      <ReviewPage review={review({ candidates: additions(4) })} storage={fakeStorage()} />,
    );
    expect(screen.getAllByTestId('candidate-list')[0]?.tagName).toBe('UL');
    expect(document.querySelectorAll('.review-section__row').length).toBe(4);
    unmount();

    render(<ReviewPage review={review({ candidates: additions(150) })} storage={fakeStorage()} />);
    expect(screen.getAllByTestId('candidate-list')[0]?.tagName).toBe('UL');
  });

  it('T-UI-026d scrolls the window inside its own viewport, not the page', () => {
    // The virtualiser measures a scroll element; without one it has nothing to
    // window against and falls back to rendering into an unbounded container.
    render(<ReviewPage review={review({ candidates: additions(150) })} storage={fakeStorage()} />);

    const viewport = screen.getByTestId('candidate-list-viewport');
    expect(viewport.contains(screen.getAllByTestId('candidate-list')[0] ?? null)).toBe(true);
  });

  it('T-UI-026e reserves height for the WHOLE section, not the rendered window', () => {
    // ⚠ Without this the windowed list is a list that ends after one screen:
    // the scrollbar reports the size of the window rather than the section, so
    // the owner scrolls to what looks like the bottom and never sees the other
    // 400 candidates — a silent truncation of the review pass itself.
    render(<ReviewPage review={review({ candidates: additions(150) })} storage={fakeStorage()} />);

    const list = screen.getAllByTestId('candidate-list')[0] as HTMLElement;
    const reserved = Number.parseFloat(list.style.height);
    expect(Number.isNaN(reserved)).toBe(false);
    expect(reserved).toBeGreaterThan(150 * 100);
  });
});

/* ── SD-11e ─────────────────────────────────────────────────────────────── */

describe('T-UI-027 · SD-11e · dispositions survive a refresh, but the server wins', () => {
  it('T-UI-027a writes under the key SD-11e names', () => {
    const storage = fakeStorage();
    render(<ReviewPage review={review()} storage={storage} />);

    fireEvent.click(
      within(screen.getByTestId('review-additions')).getByTestId('confirm-all-button'),
    );

    expect(storage.getItem(reviewStorageKey(BATCH_ID))).not.toBeNull();
    expect(reviewStorageKey(BATCH_ID)).toBe(`nextup.review.${BATCH_ID}`);
  });

  it('T-UI-027b re-reads the cache on mount, so a refresh loses nothing', () => {
    // This is the whole point: an accidental refresh mid-review must not cost
    // an hour of decisions.
    const storage = fakeStorage({
      [reviewStorageKey(BATCH_ID)]: JSON.stringify({ cand_1: 'confirmed' }),
    });
    render(<ReviewPage review={review()} storage={storage} />);

    expect(
      within(screen.getByTestId('review-additions')).getByTestId('confirm-all-button').textContent,
    ).toBe(REVIEW_CONFIRM_ALL.replace('{n}', '1'));
  });

  it('T-UI-027c lets the SERVER win wherever it has a decision', () => {
    // ⚠ Otherwise this cache becomes a second, divergent record of the owner's
    // decisions — and the close acts on the server's.
    expect(effectiveDisposition('discarded', 'confirmed')).toBe('discarded');
    expect(effectiveDisposition('confirmed', 'discarded')).toBe('confirmed');
    expect(effectiveDisposition('pending', 'confirmed')).toBe('confirmed');
    expect(effectiveDisposition('pending', undefined)).toBe('pending');
  });

  it('T-UI-027d treats a malformed payload as an empty cache, never a throw', () => {
    // A corrupt entry must not be able to stop the review screen rendering.
    const storage = fakeStorage({ [reviewStorageKey(BATCH_ID)]: '{not json' });
    render(<ReviewPage review={review()} storage={storage} />);

    expect(
      within(screen.getByTestId('review-additions')).getByTestId('confirm-all-button').textContent,
    ).toBe(REVIEW_CONFIRM_ALL.replace('{n}', '2'));
  });

  it('T-UI-027e filters values that are not dispositions a client may propose', () => {
    const storage = fakeStorage({
      [reviewStorageKey(BATCH_ID)]: JSON.stringify({
        cand_1: 'pending',
        cand_2: 'unresolved',
        cand_3: 'confirmed',
      }),
    });

    expect(readLocalDispositions(BATCH_ID, storage)).toEqual({ cand_3: 'confirmed' });
  });

  it('T-UI-027f survives a storage that throws (Safari private mode)', () => {
    // A review screen that throws on the owner's first confirmation is a worse
    // failure than one that forgets.
    //
    // ⚠ ASSERTED AGAINST THE MODULE, NOT ONLY THROUGH THE PAGE. A throw raised
    // inside a React event handler is caught and re-dispatched by React, so a
    // `not.toThrow()` around `fireEvent.click` passes on an implementation
    // that throws — the mutant proved it. The guard lives in these three
    // functions, so this is where it is pinned.
    const hostile: Storage = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };

    expect(() => writeLocalDispositions(BATCH_ID, { cand_1: 'confirmed' }, hostile)).not.toThrow();
    expect(readLocalDispositions(BATCH_ID, hostile)).toEqual({});
    expect(() => {
      clearLocalDispositions(BATCH_ID, hostile);
    }).not.toThrow();

    render(<ReviewPage review={review()} storage={hostile} />);
    const button = within(screen.getByTestId('review-additions')).getByTestId('confirm-all-button');
    expect(() => {
      fireEvent.click(button);
    }).not.toThrow();
  });

  it('T-UI-027g renders normally with no storage at all', () => {
    render(<ReviewPage review={review()} storage={undefined} />);

    expect(screen.getByTestId('review-additions')).not.toBeNull();
  });

  it('T-UI-027h drops the cache when the batch is done with it', () => {
    // A cache that outlives its batch is a set of decisions with nothing left
    // to apply them to.
    const storage = fakeStorage({
      [reviewStorageKey(BATCH_ID)]: JSON.stringify({ cand_1: 'confirmed' }),
    });

    clearLocalDispositions(BATCH_ID, storage);

    expect(storage.getItem(reviewStorageKey(BATCH_ID))).toBeNull();
  });

  it('T-UI-027i never writes to localStorage', () => {
    // ⚠ `localStorage` outlives the batch, the tab and the sign-in, and would
    // replay a stale decision over a later batch that reused a candidate id.
    const storage = fakeStorage();
    render(<ReviewPage review={review()} storage={storage} />);
    fireEvent.click(
      within(screen.getByTestId('review-additions')).getByTestId('confirm-all-button'),
    );

    expect(localStorage.getItem(reviewStorageKey(BATCH_ID))).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
