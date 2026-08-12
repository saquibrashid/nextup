/**
 * T-INV-023 — the coverage exclusion list may not become an untested-code
 * loophole.
 *
 * `vitest.config.ts` excludes `apps/api/src/repository/**` from the coverage
 * thresholds. That is legitimate: coverage is bound to CI job 4 (`test:unit`),
 * which runs with no database, while the repository layer is exercised in full
 * by the `integration` project against a real SQL Server (specs/testing.md
 * §3.3a). Counting it in the unit run would report 0% for well-tested code.
 *
 * The danger is what the exclusion makes POSSIBLE later. Once a directory is
 * outside the thresholds, new code can be added to it — or its tests deleted —
 * and every coverage gate still passes. The exclusion would silently change
 * meaning from "measured elsewhere" to "not measured at all", and nothing in
 * CI would say so.
 *
 * So this suite asserts the thing the exclusion is a promise about: every
 * excluded repository module is genuinely reached by an integration spec, and
 * the exclusion stays scoped to that one directory.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const REPOSITORY_DIR = 'apps/api/src/repository';
const INTEGRATION_DIR = 'apps/api/test/integration';

const filesIn = (rel: string, match: RegExp): string[] => {
  const abs = path.join(ROOT, rel);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = path.join(abs, entry);
    if (statSync(full).isDirectory()) out.push(...filesIn(path.join(rel, entry), match));
    else if (match.test(entry)) out.push(path.join(rel, entry).split(path.sep).join('/'));
  }
  return out;
};

describe('T-INV-023 coverage exclusions stay honest', () => {
  const config = read('vitest.config.ts');

  it('T-INV-023a excludes the repository layer from the unit coverage thresholds', () => {
    expect(config).toContain("'apps/api/src/repository/**'");
  });

  it('T-INV-023b keeps every excluded repository module covered by an integration spec', () => {
    const modules = filesIn(REPOSITORY_DIR, /\.tsx?$/);
    expect(modules.length).toBeGreaterThan(0);

    const specs = filesIn(INTEGRATION_DIR, /\.spec\.ts$/)
      .concat(filesIn(INTEGRATION_DIR, /harness\.ts$/))
      .map((f) => read(f))
      .join('\n');

    for (const module of modules) {
      const name = path.basename(module).replace(/\.tsx?$/, '');
      expect(
        specs.includes(`repository/${name}`),
        `${module} is excluded from coverage but no integration spec imports it. Either add ` +
          `integration tests for it, or remove it from the coverage exclusion list in ` +
          `vitest.config.ts so the unit thresholds measure it.`,
      ).toBe(true);
    }
  });

  it('T-INV-023c does not exclude application source beyond the two entrypoints and the repository', () => {
    const excludeBlock = config.slice(
      config.indexOf('exclude: ['),
      config.indexOf(']', config.indexOf('exclude: [')),
    );
    const sourceExclusions = [...excludeBlock.matchAll(/'((?:apps|packages)\/[^']+)'/g)].map(
      (m) => m[1],
    );

    expect(sourceExclusions.sort()).toEqual(
      ['apps/api/src/index.ts', 'apps/api/src/repository/**', 'apps/web/src/main.tsx'].sort(),
    );
  });
});
