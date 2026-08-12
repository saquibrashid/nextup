/**
 * `App` (TASK-025) - the router, mounting all nine routes inside `AppShell`.
 *
 * `BrowserRouter` per `specs/ui.md` (top matter): real paths, not hashes, so
 * every screen is deep-linkable and Easy Auth can return the owner to the path
 * they actually asked for after sign-in (TASK-027).
 *
 * The router lives apart from `main.tsx` so tests can mount the whole app
 * inside a `MemoryRouter` at an arbitrary path without touching the DOM entry
 * point.
 */

import type { JSX } from 'react';
import { Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { ROUTES } from './routes';

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {ROUTES.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
      </Route>
    </Routes>
  );
}
