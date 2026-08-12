import { describe, expect, it } from 'vitest';

import {
  NON_VITEST_ROOTS,
  findSpecFiles,
  isNonVitest,
  orphanSpecs,
  formatFailure,
} from '../../tools/check-test-locations.mjs';

/**
 * T-CI-008 — no spec file may live where no runner collects it.
 *
 * The CLI half runs in CI (job 3). These assertions cover the decision logic,
 * because the failure mode being guarded is silence: a rule that wrongly
 * returns "fine" produces exactly the same output as a clean repository.
 */
describe('T-CI-008 · test files are collected by a runner', () => {
  it('T-CI-008a · flags a spec file that no runner collects', () => {
    const orphans = orphanSpecs(
      ['apps/web/test/listPage.spec.tsx', 'tests/web/pasteCapture.spec.tsx'],
      new Set(['apps/web/test/listPage.spec.tsx']),
    );

    expect(orphans).toEqual(['tests/web/pasteCapture.spec.tsx']);
  });

  it('T-CI-008b · passes when every spec file is collected', () => {
    const files = ['packages/domain/test/ids.spec.ts', 'apps/api/test/unit/config.spec.ts'];

    expect(orphanSpecs(files, new Set(files))).toEqual([]);
  });

  it('T-CI-008c · exempts Playwright-owned suites, which Vitest never collects', () => {
    const files = ['tests/e2e/journey.spec.ts', 'tests/smoke/deployed.spec.ts'];

    expect(orphanSpecs(files, new Set())).toEqual([]);
    expect(files.every(isNonVitest)).toBe(true);
  });

  it('T-CI-008d · exempts only the two declared Playwright roots, not all of tests/', () => {
    // tests/ is not a blanket exemption: tests/infra and tests/extraction ARE
    // Vitest projects, so an uncollected file there is still an orphan.
    expect(isNonVitest('tests/infra/sku.spec.ts')).toBe(false);
    expect(isNonVitest('tests/extraction/golden.spec.ts')).toBe(false);
    expect(isNonVitest('tests/images/isolation.spec.ts')).toBe(false);
  });

  it('T-CI-008e · every non-Vitest exemption states its owning runner', () => {
    // An exemption without a reason is indistinguishable from an orphan that
    // somebody silenced.
    for (const root of NON_VITEST_ROOTS) {
      expect(root.runner, `${root.dir} must name its runner`).toBeTruthy();
    }
  });

  it('T-CI-008f · the failure message says the tests DO NOT RUN', () => {
    const message = formatFailure(['tests/web/pasteCapture.spec.tsx']);

    // The remedy is only obvious if the message explains that green means
    // nothing here — otherwise it reads as a lint preference about layout.
    expect(message).toContain('DO NOT RUN');
    expect(message).toContain('tests/web/pasteCapture.spec.tsx');
    expect(message).toContain('specs/testing.md');
  });

  it('T-CI-008g · the real repository has no orphaned spec files', () => {
    const specs = findSpecFiles();

    expect(specs.length).toBeGreaterThan(0);
    // Guards the historical defect directly: these paths appeared in the
    // backlog and the parallel-execution plan and are collected by nothing.
    expect(specs.filter((f) => f.startsWith('tests/web/'))).toEqual([]);
    expect(specs.filter((f) => f.startsWith('tests/images/'))).toEqual([]);
  });
});
