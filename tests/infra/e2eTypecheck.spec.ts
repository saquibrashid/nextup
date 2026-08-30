/**
 * T-INFRA-016 — a typecheck that no script invokes is not a gate, it is a file.
 *
 * `tests/e2e/**` is compiled by Playwright's esbuild loader, which STRIPS types
 * and never checks them. The root `npm run typecheck` was `tsc --build`, and the
 * root `tsconfig.json` references only `packages/domain`, `apps/api`,
 * `apps/web` and `scripts`. So for the whole life of the e2e suite, nothing had
 * ever typechecked it.
 *
 * That matters more than it sounds, because of what `tests/e2e/journey.spec.ts`
 * became. `T-E2E-001` now drives a STATEFUL in-memory backend — a second
 * implementation of the server — and the only thing keeping that stub honest
 * against the real contract is that its response builders are annotated with
 * the SPA's own types (`TitleListResponse`, `RemovedResponse`, …). Those
 * annotations are the entire drift alarm, and an annotation nothing compiles is
 * decoration. A reviewer who sees `: TitleListResponse` on a builder reasonably
 * concludes drift is caught. Until the alarm is actually run, it is not.
 *
 * The wiring is deliberately OUTSIDE the build graph, and `c` pins that: a
 * project listed in the root `references` array must be `composite`, and a
 * composite project emits `.tsbuildinfo` and declarations for a directory that
 * produces no build output. A separate `--noEmit` invocation chained onto
 * `typecheck` is the correct shape, so a future tidy-up that "properly"
 * references it would break the build rather than improve it.
 *
 * Same principle as `T-CI-008` (a spec no runner collects never runs), applied
 * to a typecheck instead of a spec file.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const E2E_TSCONFIG = 'tests/e2e/tsconfig.json';

interface RootManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(read('package.json')) as RootManifest;
const scripts = manifest.scripts ?? {};

/**
 * `tests/e2e/tsconfig.json` and the root `tsconfig.json` both carry `//`
 * comments, which `JSON.parse` rejects. Strip line comments that are not inside
 * a string before parsing.
 */
function parseJsonc(text: string): unknown {
  const stripped = text
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
  return JSON.parse(stripped);
}

describe('T-INFRA-016 — the e2e drift alarm is actually run', () => {
  it('T-INFRA-016a: the root typecheck script chains the e2e typecheck', () => {
    const typecheck = scripts.typecheck;
    expect(typecheck, 'package.json must define a "typecheck" script').toBeDefined();

    // Every caller in the repo runs `npm run typecheck` — CI's `1 · lint` job,
    // docs/getting-started.md, and every lane agent's gate list. Chaining is
    // what makes the alarm reach all of them without any of them changing.
    expect(
      typecheck,
      'npm run typecheck must also run the e2e drift alarm (T-INFRA-016). ' +
        'Without it, tests/e2e/** is never typechecked by anything and the ' +
        'stub type annotations in journey.spec.ts are decoration.',
    ).toMatch(/\btypecheck:e2e\b/);

    // ...and the build must still happen. A `typecheck` reduced to only the
    // e2e alarm would pass this file while checking none of the source.
    expect(typecheck).toMatch(/tsc\s+--build/);
  });

  it('T-INFRA-016b: typecheck:e2e really points at the e2e tsconfig', () => {
    const e2e = scripts['typecheck:e2e'];
    expect(e2e, 'package.json must define a "typecheck:e2e" script').toBeDefined();

    // `a` alone is satisfied by a chained script that checks nothing at all.
    expect(e2e).toMatch(/--noEmit/);
    expect(e2e).toContain(E2E_TSCONFIG);
  });

  it('T-INFRA-016c: the e2e project is noEmit and stays OUT of the root build graph', () => {
    const e2e = parseJsonc(read(E2E_TSCONFIG)) as {
      compilerOptions?: { noEmit?: boolean; composite?: boolean };
      include?: readonly string[];
    };
    expect(e2e.compilerOptions?.noEmit).toBe(true);
    expect(e2e.compilerOptions?.composite).toBe(false);

    const root = parseJsonc(read('tsconfig.json')) as {
      references?: readonly { readonly path: string }[];
    };
    const referenced = (root.references ?? []).map((r) => r.path);
    expect(
      referenced.some((p) => p.replace(/\\/g, '/').includes('tests/e2e')),
      'tests/e2e must NOT be a root tsconfig reference: `tsc --build` requires a ' +
        'referenced project to be composite, and a composite project emits build ' +
        'info and declarations for a directory that produces no build output. ' +
        'The alarm is chained onto `typecheck` as a separate --noEmit run instead.',
    ).toBe(false);
  });

  it('T-INFRA-016d: the e2e tsconfig include actually resolves to the spec files', () => {
    // The positive control. `a`–`c` are all satisfied by a tsconfig whose file
    // set is EMPTY: `tsc --noEmit` over nothing exits 0 for ever, so the alarm
    // would report green while checking not one line of the stub.
    const e2e = parseJsonc(read(E2E_TSCONFIG)) as { include?: readonly string[] };
    const include = e2e.include ?? [];
    expect(include.length).toBeGreaterThan(0);
    expect(include.some((p) => /\*\*\/\*\.tsx?$/.test(p))).toBe(true);

    // And the directory really does hold the file the alarm exists for.
    const journey = read('tests/e2e/journey.spec.ts');
    expect(journey).toContain('TitleListResponse');
  });
});
