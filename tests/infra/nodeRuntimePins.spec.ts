/**
 * `T-INFRA-018` - the Node major is pinned in four places that must agree.
 *
 * The runtime major is not declared once. It is declared in `.nvmrc` (which
 * every CI job reads via `node-version-file`), in `package.json` `engines`, in
 * the digest-pinned `Dockerfile` base image, and - as the type view of the
 * same runtime - in `@types/node`.
 *
 * Nothing asserted that they agree, and the failure mode is asymmetric:
 *
 * - `.nvmrc` ahead of the `Dockerfile` means CI typechecks and tests against a
 *   newer engine than the container ships. Every gate is green and the break
 *   happens in production.
 * - `@types/node` ahead of the runtime is the same defect one level up: code
 *   compiles against APIs the deployed container does not have. That is why
 *   `.github/dependabot.yml` caps it at the running major rather than floating
 *   it to latest, and why the runtime pins moved
 *   to 22 while the types deliberately stayed on 20 - types BEHIND the runtime
 *   only cost you visibility of new APIs, so it is the safe direction and the
 *   assertion below is one-sided on purpose.
 *
 * This is a text assertion over checked-in files rather than a container run,
 * so it holds on every PR in the unit job with no Docker daemon - the same
 * reasoning as `T-INFRA-007`, and the same reasoning as `T-INFRA-005` for the
 * memory/decode-guard pair, which is the existing precedent for "one setting
 * expressed in two files is one setting, and a test must say so".
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const NVMRC = readFileSync(path.join(ROOT, '.nvmrc'), 'utf8');
const DOCKERFILE = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
};

/** The leading integer of a semver-ish string, or `undefined` if there is none. */
function major(value: string | undefined): number | undefined {
  const found = /(\d+)/.exec(value ?? '');
  return found === null ? undefined : Number(found[1]);
}

const nvmrcMajor = major(NVMRC.trim());
const imageMajor = major(/ARG NODE_IMAGE=node:(\d+)-alpine/.exec(DOCKERFILE)?.[1]);
const enginesRange = PKG.engines?.node;
const typesRange = PKG.devDependencies?.['@types/node'];

describe('T-INFRA-018 - the Node major agrees across every place it is pinned', () => {
  it('T-INFRA-018a - the pins were all found, so the later cases cannot pass vacuously', () => {
    // The positive control. Every assertion below compares two parsed values,
    // and `undefined === undefined` would report agreement between two files
    // this test had silently stopped reading - the exact way a reformatted
    // Dockerfile or a renamed field turns a gate into decoration.
    expect(nvmrcMajor, '.nvmrc must declare a Node major').toBeTypeOf('number');
    expect(imageMajor, 'Dockerfile must pin node:<major>-alpine').toBeTypeOf('number');
    expect(enginesRange, 'package.json must declare engines.node').toBeTypeOf('string');
    expect(typesRange, 'package.json must devDepend on @types/node').toBeTypeOf('string');
  });

  it('T-INFRA-018b - the container base image is the engine CI tested with', () => {
    expect(
      imageMajor,
      `Dockerfile pins node:${String(imageMajor)} but .nvmrc says ${String(nvmrcMajor)} - ` +
        'CI would test one engine and ship another',
    ).toBe(nvmrcMajor);
  });

  it('T-INFRA-018c - engines admits exactly the pinned major and no other', () => {
    // `>=22 <23`. A range that merely *includes* the pinned major (`>=20`, or
    // an open upper bound) stops being a pin: it silently accepts whatever a
    // contributor or a future base image happens to provide.
    expect(enginesRange).toBe(`>=${String(nvmrcMajor)} <${String((nvmrcMajor ?? 0) + 1)}`);
  });

  it('T-INFRA-018d - @types/node never describes a newer engine than the one shipped', () => {
    const typesMajor = major(typesRange);

    expect(
      typesMajor,
      `@types/node@${String(typesRange)} describes Node ${String(typesMajor)} but the ` +
        `container runs ${String(nvmrcMajor)} - typechecking against APIs that are absent ` +
        'at run time moves the failure out of CI and into production',
    ).toBeLessThanOrEqual(nvmrcMajor ?? 0);
  });
});
