/**
 * Supply-chain static gates (TASK-004).
 *
 * `T-SEC-009` — US-034 AC-6 — NFR-005: no telemetry, no analytics, no APM,
 * anywhere. `T-CI-006` — every GitHub Action pinned to a commit SHA.
 *
 * These assert the CHECK ITSELF WORKS, not merely that the repository is
 * currently clean. A clean repository passes a check that does nothing, so
 * each test also feeds the checker a deliberate violation in a temporary
 * directory and requires it to be caught. `TASK-004`'s exit criterion is
 * literally "adding `posthog-js` fails CI".
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { checkActionPinning, checkDependencies } from '../../tools/check-deps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'check-deps.mjs');

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `nextup-supply-${prefix}-`));
  created.push(dir);
  return dir;
}

describe('T-SEC-009 · no telemetry, analytics or APM anywhere (NFR-005)', () => {
  it('T-SEC-009a · US-034 AC-6 · the repository as committed is clean', async () => {
    const findings = await checkDependencies();
    expect(findings).toEqual([]);
  });

  it('T-SEC-009b · US-034 AC-6 · adding posthog-js is caught', async () => {
    const dir = scratchDir('posthog');
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'violation', dependencies: { 'posthog-js': '^1.0.0' } }),
    );

    const findings = await checkDependencies(dir);
    expect(findings.some((f) => f.includes('posthog-js'))).toBe(true);
  });

  it('T-SEC-009c · US-034 AC-6 · every named vendor in specs/security.md §8 is caught', async () => {
    // The seven the spec names explicitly, in the scoped/suffixed shapes a
    // real install would actually produce.
    const vendors = {
      applicationinsights: '^3.0.0',
      '@microsoft/applicationinsights-web': '^3.0.0',
      'posthog-node': '^4.0.0',
      'mixpanel-browser': '^2.0.0',
      '@segment/analytics-node': '^2.0.0',
      '@sentry/node': '^8.0.0',
      'dd-trace': '^5.0.0',
      newrelic: '^12.0.0',
    };

    for (const [name, version] of Object.entries(vendors)) {
      const dir = scratchDir('vendor');
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'violation', dependencies: { [name]: version } }),
      );

      const findings = await checkDependencies(dir);
      expect(
        findings.some((f) => f.includes(name)),
        `${name} was not caught`,
      ).toBe(true);

      rmSync(dir, { recursive: true, force: true });
      created.pop();
    }
  });

  it('T-SEC-009d · US-034 AC-6 · a devDependency is caught, not just a runtime one', async () => {
    const dir = scratchDir('devdep');
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'violation', devDependencies: { mixpanel: '^0.18.0' } }),
    );

    const findings = await checkDependencies(dir);
    expect(findings.some((f) => f.includes('mixpanel'))).toBe(true);
  });

  it('T-SEC-009e · US-034 AC-6 · a third-party script tag is caught', async () => {
    const dir = scratchDir('script');
    writeFileSync(
      path.join(dir, 'index.html'),
      '<html><body><script src="https://cdn.example.com/a.js"></script></body></html>',
    );

    const findings = await checkDependencies(dir);
    expect(findings.some((f) => f.includes('third-party script tag'))).toBe(true);
  });

  it('T-SEC-009f · US-034 AC-6 · a same-origin script tag is allowed', async () => {
    const dir = scratchDir('samescript');
    writeFileSync(
      path.join(dir, 'index.html'),
      '<html><body><script src="/assets/index.js"></script><script type="module" src="./src/main.tsx"></script></body></html>',
    );

    const findings = await checkDependencies(dir);
    expect(findings).toEqual([]);
  });

  it('T-SEC-009g · US-034 AC-6 · a hand-rolled analytics beacon is caught', async () => {
    // A violation does not need a package: `fetch('https://…/collect')` is the
    // same defect with none of the dependency-diff visibility.
    const dir = scratchDir('beacon');
    writeFileSync(
      path.join(dir, 'beacon.ts'),
      "export const send = () => fetch('https://www.google-analytics.com/collect');",
    );

    const findings = await checkDependencies(dir);
    expect(findings.some((f) => f.includes('google-analytics.com'))).toBe(true);
  });

  it('T-SEC-009h · US-034 AC-6 · the decode sentinel log lines are NOT a violation', async () => {
    // R5 clarification, guarding against the collision being "resolved" by
    // deleting the sentinel that T-IMG-021 requires. These are stdout debug
    // logs: no SDK, no third party, no product instrumentation.
    const dir = scratchDir('sentinel');
    writeFileSync(
      path.join(dir, 'sentinel.ts'),
      [
        "console.log(JSON.stringify({ event: 'image.decode.begin', imageId }));",
        "console.log(JSON.stringify({ event: 'image.decode.end', imageId }));",
      ].join('\n'),
    );

    const findings = await checkDependencies(dir);
    expect(findings).toEqual([]);
  });

  it('T-SEC-009i · US-034 AC-6 · the script exits non-zero on a violation', async () => {
    // The vitest-level checks above call the exported function; CI calls the
    // script. A checker that finds violations but exits 0 blocks nothing.
    const dir = scratchDir('exitcode');
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'violation', dependencies: { 'posthog-js': '^1.0.0' } }),
    );

    const tools = path.join(dir, 'tools');
    mkdirSync(tools);
    copyFileSync(SCRIPT, path.join(tools, 'check-deps.mjs'));
    copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(dir, 'package-lock.json'));
    expect(() =>
      execFileSync(process.execPath, [path.join(tools, 'check-deps.mjs')], { stdio: 'pipe' }),
    ).toThrow(/posthog-js/);
  });

  it('T-SEC-009j · US-034 AC-6 · the script exits zero on the clean tree', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });

  it('T-SEC-009l · parallel scans cannot see another scan’s violation fixture', async () => {
    const clean = scratchDir('clean');
    const violation = scratchDir('violation');
    writeFileSync(
      path.join(violation, 'package.json'),
      JSON.stringify({ dependencies: { 'posthog-js': '^1.0.0' } }),
    );
    const [cleanFindings, violationFindings] = await Promise.all([
      checkDependencies(clean),
      checkDependencies(violation),
    ]);
    expect(cleanFindings).toEqual([]);
    expect(violationFindings.some((finding) => finding.includes('posthog-js'))).toBe(true);
  });
});

describe('T-CI-006 · every GitHub Action is pinned to a commit SHA', () => {
  it('T-CI-006a · no workflow uses a mutable tag', async () => {
    // A tag is mutable: `@v2` can be re-pointed at new code by anyone who can
    // push to that repository, in a workflow that holds GITHUB_TOKEN.
    const findings = await checkActionPinning();
    expect(findings).toEqual([]);
  });

  it('T-CI-006b · a tag-pinned action is caught', async () => {
    const root = scratchDir('action');
    const dir = path.join(root, '.github', 'workflows');
    const file = path.join(dir, 'zz-fixture-unpinned.yml');
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, 'jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v4\n');

    const findings = await checkActionPinning(root);
    expect(findings.some((f) => f.includes('actions/checkout@v4'))).toBe(true);
  });
});
