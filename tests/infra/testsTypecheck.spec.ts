/**
 * T-INFRA-017 — the Vitest suite is typechecked by something.
 *
 * The sibling of `T-INFRA-016`, and the larger hole of the two. That gate
 * closed `tests/e2e/**`; this one closes everything else. Before TASK-193, no
 * tsconfig in this repo included a single Vitest spec file:
 *
 *   - `tsc --build` walks the root `references` array, and every referenced
 *     project (`packages/domain`, `apps/api`, `apps/web`, `scripts`) includes
 *     only its own `src/**`.
 *   - `typecheck:e2e` covers `tests/e2e/**`.
 *   - Nothing covered the ~240 Vitest-collected specs in between.
 *
 * ESLint does not typecheck. So a spec could name a variable that does not
 * exist, pass lint, pass every static gate, and fail only if and when that
 * exact line executed. That is not hypothetical: `T-AI-017u`/`v` (TASK-192)
 * reached CI with `where: { ownerId, batchId }` in a file where the owner id
 * is bound as `owner`, and the first thing that noticed was a `ReferenceError`
 * inside a seven-minute integration job.
 *
 * ⚠ AND IT IS WORST WHERE NO RUNNER EVER REACHES. `T-CI-008` catches a spec
 * file that sits outside every collected path. It cannot catch a *collected*
 * spec containing a `describe` that never executes — a `.skip`, a guarded
 * branch, an error path reached only on inputs no case supplies. A type error
 * there is invisible for ever. Static checking is the only thing that sees it.
 *
 * The four cases mirror `T-INFRA-016` deliberately, including `d`: `a`–`c` are
 * all satisfied by a tsconfig whose file set is EMPTY, because `tsc --noEmit`
 * over no files exits 0 for ever.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const TESTS_TSCONFIG = 'tsconfig.tests.json';

interface RootManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(read('package.json')) as RootManifest;
const scripts = manifest.scripts ?? {};

/** `tsconfig.tests.json` and the root `tsconfig.json` carry `//` comments. */
function parseJsonc(text: string): unknown {
  const stripped = text
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
  return JSON.parse(stripped);
}

describe('T-INFRA-017 — the Vitest suite drift alarm is actually run', () => {
  it('T-INFRA-017a: the root typecheck script chains the test typecheck', () => {
    const typecheck = scripts.typecheck;
    expect(typecheck, 'package.json must define a "typecheck" script').toBeDefined();

    // Chaining is what makes the alarm reach every caller — CI's `1 · lint`
    // job, docs/getting-started.md, and every lane agent's gate list — without
    // any of them changing.
    expect(
      typecheck,
      'npm run typecheck must also run the Vitest-suite drift alarm ' +
        '(T-INFRA-017). Without it, apps/api/test/** and packages/domain/test/** ' +
        'are typechecked by nothing and a spec can reference an undefined ' +
        'variable while passing lint (TASK-192).',
    ).toMatch(/\btypecheck:tests\b/);

    // ...and the other two halves must survive. A `typecheck` reduced to only
    // this alarm would pass this case while checking none of the source.
    expect(typecheck).toMatch(/tsc\s+--build/);
    expect(typecheck).toMatch(/\btypecheck:e2e\b/);
  });

  it('T-INFRA-017b: typecheck:tests really points at the tests tsconfig', () => {
    const tests = scripts['typecheck:tests'];
    expect(tests, 'package.json must define a "typecheck:tests" script').toBeDefined();

    // `a` alone is satisfied by a chained script that checks nothing at all.
    expect(tests).toMatch(/--noEmit/);
    expect(tests).toContain(TESTS_TSCONFIG);
  });

  it('T-INFRA-017c: the tests project is noEmit and stays OUT of the root build graph', () => {
    const tests = parseJsonc(read(TESTS_TSCONFIG)) as {
      compilerOptions?: { noEmit?: boolean; composite?: boolean; noImplicitAny?: boolean };
      include?: readonly string[];
    };
    expect(tests.compilerOptions?.noEmit).toBe(true);
    expect(tests.compilerOptions?.composite).toBe(false);

    // ⚠ The one way to make this gate green while gutting it. The paths still
    // outside `include` are dominated by implicit-any errors; switching the
    // check off would "fix" them by blinding the alarm to its loudest class.
    expect(
      tests.compilerOptions?.noImplicitAny,
      'tsconfig.tests.json must not disable noImplicitAny — that turns the ' +
        'alarm off for exactly the files it fires hardest on.',
    ).toBeUndefined();

    const root = parseJsonc(read('tsconfig.json')) as {
      references?: readonly { readonly path: string }[];
    };
    const referenced = (root.references ?? []).map((r) => r.path.replace(/\\/g, '/'));
    expect(
      referenced.some((p) => p.includes('tsconfig.tests')),
      'tsconfig.tests.json must NOT be a root tsconfig reference: `tsc --build` ' +
        'requires a referenced project to be composite, and a composite project ' +
        'emits build info and declarations for files that produce no build ' +
        'output. It is chained onto `typecheck` as a separate --noEmit run.',
    ).toBe(false);
  });

  it('T-INFRA-017d: the tests tsconfig include actually resolves to spec files', () => {
    // The positive control. See the header: an empty file set passes `a`–`c`.
    const tests = parseJsonc(read(TESTS_TSCONFIG)) as { include?: readonly string[] };
    const include = tests.include ?? [];
    expect(include.length).toBeGreaterThan(0);

    // Both suites the config claims, named explicitly: dropping either one
    // silently halves the alarm.
    expect(include.some((p) => p.startsWith('apps/api/test/'))).toBe(true);
    expect(include.some((p) => p.startsWith('packages/domain/test/'))).toBe(true);

    // And the directories really do hold the file the alarm exists for.
    const outage = read('apps/api/test/integration/tmdbOutageExtraction.spec.ts');
    expect(outage).toContain('T-AI-017u');
  });
});
