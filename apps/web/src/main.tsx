// @nextup/web - React + Vite SPA entry point.
//
// Mounts the router (TASK-025). The nine screens themselves are stubs until
// their own backlog tasks land; copy constants (apps/web/src/copy.ts),
// breakpoints and accessibility behaviour are specified in specs/ui.md and
// specs/ux-states.md.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { CaptureNavigationProvider } from './components/CaptureNavigation';

import { OwnerGate } from './containers/OwnerGate';

// ⚠ `T-CSS-002` ASSERTS THIS LINE EXISTS. A stylesheet that is never imported
// is indistinguishable from no stylesheet at build time — Vite emits no
// warning — so without it every other Epic O assertion passes on an unstyled
// document, which is exactly how the owner ended up in front of one.
import './index.css';

const root = document.getElementById('root');
if (root) {
  const router = createBrowserRouter([
    {
      path: '*',
      element: (
        <CaptureNavigationProvider>
          <OwnerGate />
        </CaptureNavigationProvider>
      ),
    },
  ]);
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
