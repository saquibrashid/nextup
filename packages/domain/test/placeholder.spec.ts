/**
 * Scaffold-only coverage for the `@nextup/domain` placeholder export.
 *
 * ⚠ TEMPORARY. `packages/domain/src/index.ts` is a placeholder; the real
 * domain (`types.ts` — SERVICES, `workIdentity`, normalisation) arrives with
 * its own backlog task and its own named tests. **Delete this file at that
 * point** rather than growing it: `T-SCAFFOLD-001` is not an acceptance
 * criterion and must never look like one.
 *
 * It exists because `specs/testing.md` §1 sets a 95% statement floor on
 * `packages/domain/src/**`, and a threshold that is switched off "until there
 * is code" is a threshold that never comes back on.
 */

import { describe, expect, it } from 'vitest';
import { PLACEHOLDER } from '../src/index.js';

describe('@nextup/domain scaffold', () => {
  it('T-SCAFFOLD-001 · the domain package exports its placeholder', () => {
    expect(PLACEHOLDER).toBe(true);
  });
});
