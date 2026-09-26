/**
 * `T-NAV-004` — the sign-out link is always reachable from the shell
 * (TASK-261, `specs/ux-states.md` §10.5, `specs/security.md` §3 "Sign-out").
 *
 * The sidebar (≥ --bp-lg) shows it under the nav; every narrower layout
 * reaches it through the Menu drawer. It is a plain link to Easy Auth's
 * `/.auth/logout` — the post-sign-out landing is `T-AUTH-004`, a manual
 * deployment check, because it needs a real interactive sign-in.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { SIDEBAR_VIEWPORT_QUERY, WIDE_VIEWPORT_QUERY } from '../src/breakpoints';
import { AppShell } from '../src/components/AppShell';
import { NAV_MENU_LABEL, NAV_MENU_TITLE, SIGN_OUT_LABEL } from '../src/copy';
import { OwnerNameContext } from '../src/lib/ownerContext';

type Layout = 'phone' | 'wide' | 'sidebar';

function stubLayout(layout: Layout): void {
  const matches = (query: string): boolean =>
    (query === WIDE_VIEWPORT_QUERY && layout !== 'phone') ||
    (query === SIDEBAR_VIEWPORT_QUERY && layout === 'sidebar');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

function renderShell(layout: Layout, owner: string | null = 'owner@example.com'): HTMLElement {
  stubLayout(layout);
  render(
    <OwnerNameContext.Provider value={owner}>
      <MemoryRouter initialEntries={['/about']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/about" element={<h1>About</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </OwnerNameContext.Provider>,
  );
  return screen.getByRole('banner');
}

function openDrawer(header: HTMLElement): HTMLElement {
  fireEvent.click(within(header).getByRole('button', { name: NAV_MENU_LABEL }));
  return screen.getByRole('dialog', { name: NAV_MENU_TITLE });
}

describe('T-NAV-004 · ux-states.md §10.5 · the sign-out link is always reachable', () => {
  it('T-NAV-004a: the sidebar shows who is signed in and a Sign out link to /.auth/logout', () => {
    const header = renderShell('sidebar');
    const link = within(header).getByRole('link', { name: SIGN_OUT_LABEL });

    expect(link).toHaveAttribute('href', '/.auth/logout');
    expect(within(header).getByText('Signed in as owner@example.com')).toBeInTheDocument();
    // An action, not a destination: it sits beside the nav, never in it.
    const nav = within(header).getByRole('navigation', { name: 'Primary' });
    expect(within(nav).queryByRole('link', { name: SIGN_OUT_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: NAV_MENU_LABEL })).toBeNull();
  });

  it.each(['phone', 'wide'] as const)(
    'T-NAV-004b: at %s width it lives in the Menu drawer, below the destination list',
    (layout) => {
      const header = renderShell(layout);
      expect(within(header).queryByRole('link', { name: SIGN_OUT_LABEL })).toBeNull();

      const drawer = openDrawer(header);
      const link = within(drawer).getByRole('link', { name: SIGN_OUT_LABEL });
      expect(link).toHaveAttribute('href', '/.auth/logout');
      expect(within(drawer).getByText('Signed in as owner@example.com')).toBeInTheDocument();
      expect(
        within(within(drawer).getByRole('list')).queryByRole('link', { name: SIGN_OUT_LABEL }),
      ).toBeNull();
    },
  );

  it('T-NAV-004c: with no display name the Sign out link is still there', () => {
    const header = renderShell('sidebar', null);

    expect(within(header).getByRole('link', { name: SIGN_OUT_LABEL })).toHaveAttribute(
      'href',
      '/.auth/logout',
    );
    expect(within(header).queryByText(/^Signed in as/)).toBeNull();
  });

  it('T-NAV-004d: it is a plain document link, not a router link that never leaves the SPA', () => {
    const header = renderShell('sidebar');
    const link = within(header).getByRole('link', { name: SIGN_OUT_LABEL });

    expect(link).not.toHaveAttribute('aria-current');
    expect(link).not.toHaveAttribute('target');
    expect(link.className).not.toMatch(/nav__link/);
  });
});
