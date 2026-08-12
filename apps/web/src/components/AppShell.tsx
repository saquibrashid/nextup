/**
 * `AppShell` (TASK-025) - the frame every screen sits inside (`specs/ui.md` §1).
 *
 * Renders the header, the nav and the global footer, and nothing else: the
 * routed screen goes in the `<main>` via `<Outlet />`.
 *
 * The landmark structure is load-bearing, not decoration. `specs/ui.md` §10.2
 * requires `<header>`, `<nav>`, `<main>` and `<footer>` to appear EXACTLY ONCE
 * per page (`T-A11Y-004`), which is why they live here and must not be
 * repeated by an individual page.
 *
 * The footer is where TMDB attribution goes (`specs/ui.md` §8) - it is a
 * compliance obligation that must be present, as visible text, on every one of
 * the nine routes. TASK-026 fills it from `GET /api/me`, backed by
 * `TMDB_DISCLAIMER` in `packages/domain/src/attribution.ts`. It is deliberately
 * NOT hard-coded here: US-011 AC-2 requires the sentence verbatim, and
 * `T-ATTR-001` asserts one string flows constant -> API -> DOM. A literal in
 * this file would be a second source of truth that can silently diverge.
 */

import type { JSX } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { ROUTES } from '../routes';

const NAV_ITEMS = ROUTES.filter(
  (route): route is typeof route & { navLabel: string } => route.navLabel !== null,
);

export function AppShell(): JSX.Element {
  return (
    <div className="app-shell">
      <header>
        <NavLink to="/" className="app-shell__logo">
          nextup
        </NavLink>
        <nav aria-label="Primary">
          <ul>
            {NAV_ITEMS.map((route) => (
              <li key={route.path}>
                <NavLink to={route.path} className="tap-target">
                  {route.navLabel}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main>
        <Outlet />
      </main>

      {/*
        TASK-026 mounts <TmdbAttribution /> here. The landmark itself ships now
        so that the shell's structure is asserted from the start rather than
        being introduced alongside the copy it must carry.
      */}
      <footer data-testid="app-footer" />
    </div>
  );
}
