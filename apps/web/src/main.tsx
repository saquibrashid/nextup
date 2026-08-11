// @nextup/web — React + Vite SPA entry point.
//
// PLACEHOLDER (baseline scaffold). The nine screens, copy constants
// (apps/web/src/copy.ts), routing, breakpoints and accessibility behaviour are
// specified in specs/ui.md and specs/ux-states.md and built by the backlog
// tasks. This file only proves the app mounts.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <main>
        <h1>nextup</h1>
        <p>Scaffolded from specs — not yet implemented. See docs/backlog.md.</p>
      </main>
    </StrictMode>,
  );
}
