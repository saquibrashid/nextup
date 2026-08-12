/**
 * Component-test setup (TASK-002). Adds jest-dom matchers and clears the DOM
 * between tests so state cannot leak from one screen state to the next.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
