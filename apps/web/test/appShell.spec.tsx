/**
 * TASK-025 - the app shell and the nine-route table (`specs/ui.md` §1).
 *
 * `T-UI-023` is defined in `specs/testing.md` §9A. The point of the test is
 * that "all nine routes" is a phrase FOUR later suites depend on
 * (`T-ATTR-002`, `T-ATTR-003`, `T-A11Y-001`, `T-A11Y-012`), and each of them
 * asserts something ACROSS the route set rather than about it. If a route were
 * missing from `ROUTES`, every one of those suites would keep passing while
 * silently not covering the missing screen. This test is the only place the
 * route set itself is the subject.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { ROUTES } from '../src/routes';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('AppShell and routing', () => {
  it('T-UI-023a · specs/ui.md §1 · the route table holds exactly the ten specified screens', () => {
    // ⚠ The EXACT PATH LIST is the assertion; the length is a redundant
    // restatement of it kept only so a diff reads clearly. Epic M added
    // `/rating` (REQ-092), which is why this is ten and not nine.
    expect(ROUTES.map((route) => route.path)).toStrictEqual([
      '/',
      '/upload',
      '/batches',
      '/batches/:batchId',
      '/batches/:batchId/review',
      '/removed',
      '/not-interested',
      '/about',
      '/rating',
      '*',
    ]);
    expect(ROUTES).toHaveLength(10);
  });

  it('T-UI-023b · specs/ui.md §1 · every route renders its own screen inside the shell', () => {
    // Each screen is identified by its own <h1>, so a route falling through to
    // the catch-all - the failure mode a "does it render?" check misses - shows
    // up as the wrong heading rather than as a pass.
    const headings = ROUTES.map((route) => {
      const view = renderAt(route.examplePath);
      const heading = screen.getByRole('heading', { level: 1 }).textContent;
      view.unmount();
      return heading;
    });

    expect(new Set(headings).size).toBe(ROUTES.length);
    expect(headings).not.toContain(null);
  });

  it('T-UI-023c · specs/ui.md §10.2 · each landmark appears exactly once per route', () => {
    // T-A11Y-004 owns this at the browser level; asserting it here as well
    // means a duplicated <main> or <nav> fails in the fast suite, at the point
    // a page introduces it, instead of in Playwright.
    for (const route of ROUTES) {
      const view = renderAt(route.examplePath);
      expect(document.querySelectorAll('header')).toHaveLength(1);
      expect(document.querySelectorAll('nav')).toHaveLength(1);
      expect(document.querySelectorAll('main')).toHaveLength(1);
      expect(document.querySelectorAll('footer')).toHaveLength(1);
      view.unmount();
    }
  });

  it('T-UI-023d · specs/ui.md §1 · an unknown route renders NotFoundPage with a way back to /', () => {
    renderAt('/definitely-not-a-route');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
    expect(screen.getByRole('link', { name: 'Back to your list' })).toHaveAttribute('href', '/');
  });

  it('T-UI-023e · specs/ui.md §1 · a parameterised route does NOT swallow its own sibling', () => {
    // `/batches`, `/batches/:batchId` and `/batches/:batchId/review` overlap.
    // react-router ranks by specificity, so declaration order does not decide
    // this - but a stray wildcard or a `/batches/*` added later would, and the
    // symptom is an app that looks fine until the owner opens a batch and
    // lands on the list of batches instead.
    renderAt('/batches');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Batch history');
  });

  it('T-UI-023f · specs/ui.md §1 · the nav exposes the seven top-level destinations', () => {
    renderAt('/');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);

    expect(labels).toStrictEqual([
      'List',
      'Upload',
      'Batches',
      'Removal history',
      'Not interested',
      'About',
      // Epic M (REQ-092). Reachable from the nav rather than only from a row,
      // because US-045 is about checking something the owner has NOT saved -
      // so there is no row to start from.
      'Check a rating',
    ]);
  });

  it('T-UI-023g · specs/ui.md §8 · the global footer landmark exists on every route, ready for TMDB attribution', () => {
    // The attribution copy itself is TASK-026 (T-ATTR-001..003). What must
    // hold now is that there is one footer per route to put it in - if the
    // shell omitted it, TASK-026 would silently have nowhere to mount and the
    // compliance obligation fails invisibly, which is exactly the failure mode
    // specs/ui.md §8 calls out.
    for (const route of ROUTES) {
      const view = renderAt(route.examplePath);
      expect(screen.getByTestId('app-footer')).toBeInTheDocument();
      view.unmount();
    }
  });
});
