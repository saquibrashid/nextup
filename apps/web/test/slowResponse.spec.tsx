/**
 * `T-UX-001` (§1 *"Never an indefinite spinner"*) and `T-UX-010` (§2.1
 * *"Loading (initial)"*).
 *
 * ⚠ NEITHER EXISTED. `SlowResponseNotice` was not a renamed component — it was
 * a component `TASK-143` renamed **in the spec** while recording that it had
 * never been built, so §1's central promise ("any pending request that passes
 * 1200 ms…") was documented, justified, and enforced by nothing. The list's
 * loading state was a single sentence with no skeletons and, crucially, **no
 * end**: a request that hung showed *"Loading your list…"* for ever, with no
 * way for the owner to learn it had stalled and nothing to retry.
 *
 * ⚠ THE 15 s CASE IS THE ONE THAT MATTERS. *"Still working…"* is always true
 * while a request is pending, so on its own it is an indefinite spinner that
 * has learned to talk. `T-UX-001d`/`e` assert the wait terminates in something
 * actionable.
 */
import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SlowResponseNotice } from '../src/components/SlowResponseNotice';
import { useSlowRequest, SLOW_AFTER_MS, STALLED_AFTER_MS } from '../src/lib/useSlowRequest';
import { ListPage } from '../src/pages/ListPage';
import { LIST_LOADING_BODY, SLOW_RESPONSE_BODY, SLOW_RESPONSE_STALLED_BODY } from '../src/copy';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

/** Drives the hook through a real render so the effect and timers both run. */
function Probe({ pending }: { pending: boolean }): React.JSX.Element {
  const phase = useSlowRequest(pending);
  return (
    <>
      <span data-testid="phase">{phase}</span>
      <SlowResponseNotice phase={phase} onRetry={() => undefined} />
    </>
  );
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function renderLoadingList(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ListPage items={[]} loading onRetry={() => undefined} />
    </MemoryRouter>,
  );
}

describe('T-UX-001 never an indefinite spinner', () => {
  it('T-UX-001a: nothing is announced before 1200 ms', () => {
    render(<Probe pending />);

    expect(screen.getByTestId('phase')).toHaveTextContent('normal');
    /*
      ⚠ THE NUMBERS ARE WRITTEN OUT, NOT DERIVED FROM THE CONSTANTS. A test
      that advances `SLOW_AFTER_MS - 1` moves with the value it is meant to
      pin: change the source to 0 and the test dutifully advances -1 ms and
      still "passes". The literals are the spec; the constants are the code,
      and this is the one place the two must be compared rather than shared.
    */
    expect(SLOW_AFTER_MS).toBe(1200);
    expect(STALLED_AFTER_MS).toBe(15000);

    /*
      ⚠ A notice that appears WITH the skeletons fires on every ordinary load
      and immediately stops carrying information. The threshold is the feature.
    */
    advance(1199);
    expect(screen.queryByTestId('slow-response')).not.toBeInTheDocument();
    // ⚠ Both ids. Asserting only `slow-response` passes when the component
    // renders the *stalled* block early, which is a worse defect, not a lesser
    // one — a mutation that did exactly that slipped through this test once.
    expect(screen.queryByTestId('slow-stalled')).not.toBeInTheDocument();
  });

  it('T-UX-001b: passing 1200 ms swaps in the notice', () => {
    render(<Probe pending />);

    advance(1200);

    expect(screen.getByTestId('slow-response')).toHaveTextContent(SLOW_RESPONSE_BODY);
    // `role="status"`, not `alert`: a progress update must not interrupt what a
    // screen-reader user is doing on every ordinary slow request.
    expect(screen.getByTestId('slow-response')).toHaveAttribute('role', 'status');
  });

  it('T-UX-001c: the notice names no cause it cannot know', () => {
    /*
      ⚠ TASK-143 RENAMED THIS FROM `ColdStartNotice` / "Waking things up…"
      because ADR-0003 Rev 3 pins `minReplicas = 1` — the container is always
      warm, so there is no cold start to wake from. A confident, specific,
      WRONG explanation is worse than the vaguer true one, and the old wording
      is exactly what a well-meaning rewrite would restore.
    */
    render(<Probe pending />);
    advance(1200);

    const text = screen.getByTestId('slow-response').textContent ?? '';
    expect(text.toLowerCase()).not.toContain('waking');
    expect(text.toLowerCase()).not.toContain('cold');
  });

  it('T-UX-001d: past 15 s the wait becomes an error with a remedy', () => {
    render(<Probe pending />);

    advance(15000);

    const stalled = screen.getByTestId('slow-stalled');
    expect(stalled).toHaveTextContent(SLOW_RESPONSE_STALLED_BODY);
    // ⚠ `alert`, not `status`. This one IS a failure the owner needs now.
    expect(stalled).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('slow-retry')).toBeInTheDocument();
    // The "still working" reassurance must be GONE, not stacked above it.
    expect(screen.queryByTestId('slow-response')).not.toBeInTheDocument();
  });

  it('T-UX-001e: the stalled state says nothing was changed', () => {
    // §1 "Errors say what was NOT changed" — the ASM-029 defence. A timeout is
    // the case where the owner is least able to tell whether it half-applied.
    render(<Probe pending />);
    advance(15000);

    expect(screen.getByTestId('slow-stalled').textContent ?? '').toMatch(
      /nothing has been changed/i,
    );
  });

  it('T-UX-001f: a retry restarts the clock instead of inheriting it', () => {
    /*
      ⚠ THE BUG THIS CATCHES IS INVISIBLE ON THE FIRST REQUEST. If the timers
      are not torn down when `pending` goes false, the retry inherits the
      previous attempt's elapsed time and lands straight in the stalled state —
      telling the owner a request that started a moment ago has already failed.
    */
    const { rerender } = render(<Probe pending />);
    advance(15000);
    expect(screen.getByTestId('slow-stalled')).toBeInTheDocument();

    rerender(<Probe pending={false} />);
    rerender(<Probe pending />);

    expect(screen.getByTestId('phase')).toHaveTextContent('normal');
    expect(screen.queryByTestId('slow-stalled')).not.toBeInTheDocument();

    advance(1199);
    expect(screen.queryByTestId('slow-response')).not.toBeInTheDocument();
  });

  it('T-UX-001h: a timer left over from the previous attempt never fires', () => {
    /*
      ⚠ `T-UX-001f` DOES NOT COVER THIS, AND I ASSUMED IT DID. Deleting
      `clearTimeout(stalled)` from the cleanup survived the whole first
      battery: `f` lets the first attempt run the full 15 s, so its stalled
      timer has already fired and there is nothing left to leak.
      The leak only shows when the first attempt settles EARLY. Here the
      abandoned timer is still armed for absolute t=15000; the second attempt
      starts at t=1200 and is only 13.9 s old when the clock reaches 15.1 s —
      so a leaked timer reports a stall that has not happened, on a request
      that is still perfectly healthy.
    */
    const { rerender } = render(<Probe pending />);
    advance(1200);
    rerender(<Probe pending={false} />);
    rerender(<Probe pending />);

    advance(13900);

    expect(screen.queryByTestId('slow-stalled')).not.toBeInTheDocument();
    expect(screen.getByTestId('phase')).toHaveTextContent('slow');
  });

  it('T-UX-001g: a settled request clears the notice', () => {
    const { rerender } = render(<Probe pending />);
    advance(1200);
    expect(screen.getByTestId('slow-response')).toBeInTheDocument();

    rerender(<Probe pending={false} />);

    expect(screen.queryByTestId('slow-response')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slow-stalled')).not.toBeInTheDocument();
  });
});

describe('T-UX-010 the list loading state', () => {
  it('T-UX-010a: six row skeletons, plus the strip and the bar', () => {
    /*
      ⚠ SIX, NOT THREE AND NOT ONE. The skeleton's job is to claim the SHAPE of
      what is coming; a single bar promises a list of one, which is the same
      damaging lie about a full library that the empty state would tell.
    */
    renderLoadingList();

    expect(screen.getAllByTestId('title-row-skeleton')).toHaveLength(6);
    expect(screen.getByTestId('list-loading-skeletons')).toBeInTheDocument();
    expect(document.querySelector('.freshness-strip--skeleton')).not.toBeNull();
    expect(document.querySelector('.filter-bar--skeleton')).not.toBeNull();
  });

  it('T-UX-010b: the skeletons are hidden from assistive technology', () => {
    // Announcing six empty rows describes a list that does not exist. The one
    // `role="status"` wrapper carries the whole message.
    renderLoadingList();

    for (const skeleton of screen.getAllByTestId('title-row-skeleton')) {
      expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByLabelText(LIST_LOADING_BODY)).toHaveAttribute('role', 'status');
  });

  it('T-UX-010c: no real controls or rows are rendered while loading', () => {
    // The empty state's lie is the damaging one: zero rows with no filters is
    // indistinguishable from an empty library.
    renderLoadingList();

    expect(screen.queryByTestId('list-empty-never-uploaded')).not.toBeInTheDocument();
    expect(screen.queryByTestId('title-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-count')).not.toBeInTheDocument();
  });

  it('T-UX-010d: past 1200 ms the loading list gains the notice', () => {
    /*
      ⚠ THE WIRING CASE. `T-UX-001a`-`g` drive a probe component; every one of
      them passes with `ListPage` never calling the hook at all, which is
      exactly the state this screen was in.
    */
    renderLoadingList();
    expect(screen.queryByTestId('slow-response')).not.toBeInTheDocument();

    advance(1200);

    expect(screen.getByTestId('slow-response')).toHaveTextContent(SLOW_RESPONSE_BODY);
    // The skeletons stay: the request has not failed, it is merely slow.
    expect(screen.getAllByTestId('title-row-skeleton')).toHaveLength(6);
  });

  it('T-UX-010e: a stalled list load offers a retry', () => {
    renderLoadingList();

    advance(15000);

    expect(screen.getByTestId('slow-retry')).toBeInTheDocument();
  });
});
