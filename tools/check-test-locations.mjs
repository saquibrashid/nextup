/**
 * Test-location gate (`T-CI-008`).
 *
 * A `.spec.*` file that no runner collects DOES NOT RUN, and the suite stays
 * green. That is the worst failure class in this repository: the work looks
 * done, CI agrees, and nothing was ever asserted.
 *
 * This is not hypothetical. `docs/backlog.md` and `docs/parallel-execution-plan.md`
 * both directed paste tests to `tests/web/`, which no Vitest project collects.
 * A canary asserting `1 === 2` was dropped there and `npm test` reported
 * `122 passed`. Four tasks (TASK-159/160/161/162) and an entire parallel lane
 * were pointed at that path.
 *
 * WHY IT ASKS VITEST RATHER THAN HARDCODING A LIST
 * ------------------------------------------------
 * A hardcoded set of allowed directories is itself a thing that drifts from
 * `vitest.config.ts`, and it would drift silently in the same direction. So
 * the collected set comes from `vitest list --filesOnly`, i.e. from the runner
 * itself. Playwright's roots are declared separately because Playwright is a
 * different runner with its own config, and `tests/smoke/**` runs only against
 * a deployed revision (never in `npm test`) — both are legitimately outside
 * Vitest and are listed here explicitly rather than being silently tolerated.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/**
 * Suites owned by a runner OTHER than Vitest. Each entry needs a reason: an
 * unexplained exemption here is indistinguishable from an orphaned test.
 */
export const NON_VITEST_ROOTS = Object.freeze([
  { dir: 'tests/e2e', runner: 'Playwright (`npm run test:e2e`)' },
  { dir: 'tests/smoke', runner: 'Playwright, against a DEPLOYED revision only (deploy workflow)' },
]);

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'playwright-report']);
const SPEC_RE = /\.spec\.(ts|tsx|js|jsx|mts|cts)$/;

export function findSpecFiles(root = ROOT) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      // `.tmp-*` is `tests/infra/supplyChain.spec.ts`'s scratch directory,
      // created inside the repository root and deleted again while Vitest is
      // running sibling spec FILES in parallel. Any root walker that does not
      // skip it eventually stats a path that has just been removed. See the
      // long note on `SKIP_DIRS` in `tools/check-status.mjs`.
      if (IGNORED_DIRS.has(entry) || entry.startsWith('.tmp-')) continue;
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue; // vanished between the listing and the stat
      }
      if (stat.isDirectory()) walk(full);
      else if (SPEC_RE.test(entry)) found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return found.sort();
}

/** Ask Vitest itself which files it collects. */
export function collectedByVitest(root = ROOT) {
  const out = execFileSync('npx', ['vitest', 'list', '--filesOnly'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
  return new Set(
    out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('['))
      .map((line) => line.replace(/^\[[^\]]+\]\s*/, ''))
      .filter(Boolean),
  );
}

export function isNonVitest(file) {
  return NON_VITEST_ROOTS.some((r) => file.startsWith(`${r.dir}/`));
}

/**
 * @returns orphan spec files — present in the tree, collected by nobody.
 */
export function orphanSpecs(specFiles, collected) {
  return specFiles.filter((f) => !collected.has(f) && !isNonVitest(f));
}

export function formatFailure(orphans) {
  const allowed = [
    ...new Set(
      [...NON_VITEST_ROOTS.map((r) => `${r.dir}/** (${r.runner})`)].concat(
        'every other spec file must sit in a path collected by a Vitest project — see specs/testing.md §11',
      ),
    ),
  ];
  return [
    `${orphans.length} spec file(s) are collected by NO test runner:`,
    ...orphans.map((f) => `  - ${f}`),
    '',
    'These files DO NOT RUN. Any assertion inside them passes by never executing,',
    'so CI will stay green no matter what they claim.',
    '',
    'Allowed locations:',
    ...allowed.map((a) => `  - ${a}`),
    '',
    'Move the file to the location named in specs/testing.md §11, or add a',
    'Vitest project that collects it in vitest.config.ts.',
  ].join('\n');
}

function main() {
  const specFiles = findSpecFiles();
  const collected = collectedByVitest();
  const orphans = orphanSpecs(specFiles, collected);

  if (orphans.length > 0) {
    console.error(formatFailure(orphans));
    process.exit(1);
  }

  const nonVitest = specFiles.filter(isNonVitest).length;
  console.log(
    `Test location check passed: ${specFiles.length} spec files, ` +
      `${collected.size} collected by Vitest, ${nonVitest} owned by Playwright.`,
  );
}

// `file://${argv[1]}` is WRONG on Windows: import.meta.url is `file:///C:/...`
// with three slashes, so the comparison silently never matches and the gate
// exits 0 having checked nothing. pathToFileURL is platform-correct.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
