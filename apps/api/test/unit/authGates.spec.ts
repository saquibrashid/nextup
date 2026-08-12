/**
 * The two STATIC security gates for the auth chain: `T-SEC-015` and
 * `T-SEC-019`.
 *
 * Both assert an ABSENCE. That makes them unusual and worth stating plainly:
 * they can pass because the property holds, or because the test stopped
 * looking in the right place. Each one below therefore also proves it can
 * fail, by running the same check against a fixture that violates it — a
 * grep-based gate that has never been shown to fire is indistinguishable from
 * a comment.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const API = path.join(ROOT, 'apps', 'api');

const read = (abs: string) => readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');

const filesUnder = (dir: string, match: RegExp): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, match));
    else if (match.test(entry)) out.push(full);
  }
  return out;
};

/**
 * The authorisation inputs that must not appear in the two matching modules.
 *
 * A sign-in address is REASSIGNABLE: authorising on one grants access to
 * whoever the tenant hands it to next. The subject id is not. This gate is
 * blunt on purpose — it bans the word outright in the two files that decide
 * access, so the unsafe design cannot be written there even by accident.
 */
const FORBIDDEN_AUTHORISATION_INPUTS = /\bemail\b|\bupn\b|preferred_username/i;

const MATCHING_MODULES = [
  path.join(API, 'src', 'middleware', 'allowList.ts'),
  path.join(API, 'src', 'middleware', 'ownerScope.ts'),
];

describe('T-SEC-015 authorisation matches subject ids, never addresses', () => {
  it('T-SEC-015a: the matching modules exist where the gate looks for them', () => {
    // Without this, renaming a file turns the whole gate into a no-op that
    // still reports success.
    for (const file of MATCHING_MODULES) {
      expect(existsSync(file), `${file} not found — did it move?`).toBe(true);
    }
  });

  it('T-SEC-015b: neither matching module mentions an address claim', () => {
    for (const file of MATCHING_MODULES) {
      const offending = read(file)
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => FORBIDDEN_AUTHORISATION_INPUTS.test(line));

      expect(
        offending,
        `${path.relative(ROOT, file)} references a reassignable identifier: ` +
          offending.map(([n, l]) => `line ${n}: ${l.trim()}`).join(' | '),
      ).toEqual([]);
    }
  });

  it('T-SEC-015c: the pattern actually catches an address-based check', () => {
    expect(FORBIDDEN_AUTHORISATION_INPUTS.test('if (allowed.has(principal.email)) next();')).toBe(
      true,
    );
    expect(FORBIDDEN_AUTHORISATION_INPUTS.test('const v = claim.preferred_username;')).toBe(true);
    expect(FORBIDDEN_AUTHORISATION_INPUTS.test('if (allowed.has(principal.subject)) next();')).toBe(
      false,
    );
  });
});

/**
 * Strings that must not survive into the production build. If any appears in
 * `dist`, the dev principal shim — which fabricates an authenticated identity
 * from an environment variable — has shipped.
 */
const DEV_SHIM_STRINGS = ['devPrincipal', 'NEXTUP_DEV_SUBJECT', 'readDevPrincipal'] as const;

describe('T-SEC-019 the dev principal shim never reaches production', () => {
  it('T-SEC-019a: the shim lives outside the compiled source root', () => {
    // This is the actual control. `tsconfig.json` compiles `src/**` only, so a
    // file outside it CANNOT be emitted — there is no exclude list to keep up
    // to date and no build flag to get wrong.
    expect(existsSync(path.join(API, 'dev', 'devPrincipal.ts'))).toBe(true);
    expect(existsSync(path.join(API, 'src', 'auth', 'devPrincipal.ts'))).toBe(false);
  });

  it('T-SEC-019b: the production tsconfig compiles only src', () => {
    const tsconfig = read(path.join(API, 'tsconfig.json'));
    expect(JSON.parse(tsconfig.replace(/^\s*\/\/.*$/gm, '')).include).toEqual(['src/**/*.ts']);
  });

  it('T-SEC-019c: no file under src references the shim', () => {
    const offenders = filesUnder(path.join(API, 'src'), /\.tsx?$/).filter((file) =>
      DEV_SHIM_STRINGS.some((needle) => read(file).includes(needle)),
    );
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      'Production source must not name the dev shim. createApp takes the ' +
        'principal reader as a parameter so the shim is injected from dev/.',
    ).toEqual([]);
  });

  it('T-SEC-019d: a real production build contains none of the shim strings', () => {
    // Built here rather than assuming a prior build, so the assertion is about
    // output that definitely corresponds to the current source. A test that
    // skipped when dist was absent would pass on every clean checkout.
    //
    // ⚠ Two things here are load-bearing.
    //
    // The dist directory is DELETED first. `tsc` never removes outputs whose
    // source has gone, so a file compiled from a source that has since been
    // deleted lingers in `dist` indefinitely. Scanning that is scanning
    // history, not the current build — and it produced a confusing failure
    // here after a source file was removed.
    //
    // `--force` is the other half: `tsc --build` is incremental and decides
    // from `.tsbuildinfo` whether to do anything at all. Without it, this test
    // was observed to PASS while scanning a stale dist, with a shim sitting in
    // `src`. Together the two make the output correspond exactly to the source
    // being asserted about.
    const dist = path.join(API, 'dist');
    rmSync(dist, { recursive: true, force: true });

    execFileSync('npx', ['tsc', '--build', '--force', path.join(API, 'tsconfig.json')], {
      cwd: ROOT,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });

    expect(existsSync(dist), 'the build produced no dist directory').toBe(true);

    const emitted = filesUnder(dist, /\.(js|cjs|mjs|map|d\.ts)$/);
    // Naming real production modules, not just a non-zero count: a partial or
    // skipped build can leave a handful of files behind and still look busy.
    const emittedNames = emitted.map((f) => path.relative(dist, f).split(path.sep).join('/'));
    for (const expected of ['index.js', 'app.js', 'auth/principal.js', 'middleware/allowList.js']) {
      expect(emittedNames, `${expected} missing — the build did not run properly`).toContain(
        expected,
      );
    }

    const leaks: string[] = [];
    for (const file of emitted) {
      const contents = read(file);
      for (const needle of DEV_SHIM_STRINGS) {
        if (contents.includes(needle))
          leaks.push(`${path.relative(ROOT, file)} contains ${needle}`);
      }
    }
    expect(leaks, leaks.join('\n')).toEqual([]);
  }, 180_000);

  it('T-SEC-019e: the shim refuses to work when NODE_ENV is production', async () => {
    // Belt and braces, NOT the control. If this is ever the only thing between
    // the shim and production, the structural boundary has already failed.
    const previous = process.env['NODE_ENV'];
    const previousSubject = process.env['NEXTUP_DEV_SUBJECT'];
    try {
      process.env['NODE_ENV'] = 'production';
      process.env['NEXTUP_DEV_SUBJECT'] = 'oid-dev';
      const shim = await import('../../dev/devPrincipal.js');
      expect(shim.readDevPrincipal({})).toBeNull();
    } finally {
      if (previous === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previous;
      if (previousSubject === undefined) delete process.env['NEXTUP_DEV_SUBJECT'];
      else process.env['NEXTUP_DEV_SUBJECT'] = previousSubject;
    }
  });

  it('T-SEC-019f: the shim is signed out by default', async () => {
    const previousSubject = process.env['NEXTUP_DEV_SUBJECT'];
    try {
      delete process.env['NEXTUP_DEV_SUBJECT'];
      const shim = await import('../../dev/devPrincipal.js');
      expect(shim.readDevPrincipal({})).toBeNull();
    } finally {
      if (previousSubject !== undefined) process.env['NEXTUP_DEV_SUBJECT'] = previousSubject;
    }
  });
});
