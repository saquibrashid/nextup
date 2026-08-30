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
 *
 * ⚠ `d` closes the OTHER half of the same loophole (TASK-127). `a`–`c` guard
 * the exclusion LIST, but the threshold NUMBERS were unguarded: a future agent
 * facing a red coverage gate could "fix" it by editing `95` down to `70`, and
 * every check in CI would stay green. The repo's standing rule — a coverage
 * shortfall is fixed with a test, never with a lowered threshold or a widened
 * exclude — was a prohibition with nothing enforcing it, which is the
 * `T-INFRA-016` lesson restated: a rule no test asserts is a comment.
 *
 * So `d` does not hardcode the numbers. It parses the §1 table in
 * `specs/testing.md` and the `thresholds` block in `vitest.config.ts` and
 * asserts they AGREE. The spec stays the single source of truth, and lowering
 * a floor is still possible — but only by editing the spec too, which is a
 * visible, reviewable act rather than a one-character config tweak.
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

  it('T-INV-023d pins the coverage thresholds to the specs/testing.md §1 table', () => {
    // The spec table: | `path/**` | **95 %** | **90 %** |
    const spec = read('specs/testing.md');
    const specRows = [
      ...spec.matchAll(
        /^\|\s*`((?:apps|packages)\/[^`]+)`\s*\|\s*\*\*(\d+)\s*%\*\*\s*\|\s*\*\*(\d+)\s*%\*\*\s*\|/gm,
      ),
    ];

    // A positive control: if the table is ever reformatted so this regex stops
    // matching, the assertion below would compare {} to {} and pass vacuously.
    expect(
      specRows.length,
      'Could not parse the coverage table in specs/testing.md §1. If the table was ' +
        'reformatted, update this parser — do not delete the assertion.',
    ).toBe(3);

    const fromSpec = Object.fromEntries(
      specRows.map((m) => [m[1], { statements: Number(m[2]), branches: Number(m[3]) }]),
    );

    // The config block: 'path/**': { statements: 95, branches: 90 },
    // Brace-matched rather than sliced to the first '},', which would stop at
    // the end of the FIRST entry and silently yield an empty set.
    const open = config.indexOf('thresholds: {') + 'thresholds: '.length;
    let depth = 0;
    let close = open;
    for (let i = open; i < config.length; i += 1) {
      if (config[i] === '{') depth += 1;
      else if (config[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    const thresholdBlock = config.slice(open, close);
    const configRows = [
      ...thresholdBlock.matchAll(
        /'((?:apps|packages)\/[^']+)':\s*\{\s*statements:\s*(\d+),\s*branches:\s*(\d+)\s*\}/g,
      ),
    ];
    const fromConfig = Object.fromEntries(
      configRows.map((m) => [m[1], { statements: Number(m[2]), branches: Number(m[3]) }]),
    );

    // Symmetric positive control. Without it, a broken config parser reports a
    // confusing "{} !== {3 rows}" diff instead of naming the real problem.
    expect(
      configRows.length,
      'Could not parse the thresholds block in vitest.config.ts. If it was reformatted, ' +
        'update this parser — do not delete the assertion.',
    ).toBe(3);

    expect(
      fromConfig,
      'vitest.config.ts coverage thresholds disagree with the specs/testing.md §1 table. ' +
        'A coverage shortfall is fixed by adding a test — never by lowering a threshold ' +
        'or widening an exclude. If the floor genuinely must change, change §1 first.',
    ).toEqual(fromSpec);
  });
});
