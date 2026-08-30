/**
 * TASK-181 — the render-crash boundary (`specs/ux-states.md` §1).
 *
 * ⚠ **THIS FILE EXISTS BECAUSE THE DEFECT SHIPPED THREE TIMES AND EVERY
 * EXISTING TEST STAYED GREEN.** A 200 response of the wrong SHAPE throws
 * during render; React then unmounts the whole tree and the owner is left on
 * a white page. `T-A11Y-001c` and `expectStyledAndRendered` both passed
 * throughout, because `role="main"` exists for the instant before the throw
 * propagates — which is why the boundary needs assertions of its own rather
 * than a stronger version of the sweeps.
 *
 * ⚠ **`console.error` IS SILENCED, NOT ASSERTED AWAY.** React logs every
 * caught boundary error and so does the boundary itself; leaving them on
 * makes a PASSING run look like a failing one, and a reviewer who learns to
 * ignore red console output in this suite will ignore the real thing later.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '../src/components/AppShell';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { BOUNDARY_BODY, BOUNDARY_RETRY_LABEL, BOUNDARY_TITLE } from '../src/copy';

/** The defect in miniature: a component that indexes into a missing field. */
function Exploding(): JSX.Element {
  const response = {} as { items: readonly string[] };
  return <p>{response.items[0]!.toUpperCase()}</p>;
}

function Fine(): JSX.Element {
  return <p>a screen that works</p>;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T-BOUND-001 a render crash never becomes a blank page', () => {
  it('T-BOUND-001a · a throwing screen renders a message, not nothing', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Exploding />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(BOUNDARY_TITLE);
    expect(screen.getByText(BOUNDARY_BODY)).toBeInTheDocument();
  });

  it('T-BOUND-001b · the message says nothing was changed', () => {
    // ⚠ §1's ASM-029 rule, and the reason the body is asserted separately
    // from the title. A crash mid-render is precisely when the owner has to
    // guess whether their last action half-applied.
    expect(BOUNDARY_BODY).toMatch(/nothing you have saved was changed/i);
  });

  it('T-BOUND-001c · the shell survives, so every other route stays reachable', () => {
    // ⚠ THE REASON THE BOUNDARY WRAPS THE OUTLET AND NOT THE ROOT. A boundary
    // around the whole app would take the nav down with the crashed screen,
    // stranding the owner on the one page that does not work.
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Exploding />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
  });

  it('T-BOUND-001d · navigating away clears the error', async () => {
    // ⚠ THE LATCH. Without a reset key the boundary keeps rendering its
    // message over a route that is perfectly fine — React never clears
    // boundary state by itself. Driven through the real nav link, because the
    // path IS the reset key and a hand-set prop would not prove the wiring.
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Exploding />} />
            <Route path="/about" element={<Fine />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'About' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('a screen that works')).toBeInTheDocument();
  });

  it('T-BOUND-001e · Try again re-renders the subtree', async () => {
    // A transient failure — the shape was wrong once and is right now — must
    // be recoverable without a full page load.
    let broken = true;
    function Flaky(): JSX.Element {
      if (broken) throw new Error('bad shape');
      return <p>recovered</p>;
    }

    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    broken = false;
    await user.click(screen.getByRole('button', { name: BOUNDARY_RETRY_LABEL }));

    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('T-BOUND-001f · a healthy screen is untouched', () => {
    // ⚠ THE DISCRIMINATOR. Every case above passes against a boundary that
    // renders its message unconditionally, which would replace all ten
    // routes with an apology.
    render(
      <ErrorBoundary>
        <Fine />
      </ErrorBoundary>,
    );

    expect(screen.getByText('a screen that works')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
