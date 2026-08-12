/**
 * Component tests for the SPA (TASK-002) - ~10% of the pyramid, < 30s.
 *
 * These own the screen states in `specs/ux-states.md`: copy constants,
 * section presence/absence, and ticked-by-default behaviour. jsdom is enough
 * for all of it; anything that genuinely needs a browser (the 320px floor,
 * clipboard permissions, axe scans) belongs in Playwright instead.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.spec.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});
