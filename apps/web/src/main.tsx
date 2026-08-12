// @nextup/web - React + Vite SPA entry point.
//
// Mounts the router (TASK-025). The nine screens themselves are stubs until
// their own backlog tasks land; copy constants (apps/web/src/copy.ts),
// breakpoints and accessibility behaviour are specified in specs/ui.md and
// specs/ux-states.md.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
