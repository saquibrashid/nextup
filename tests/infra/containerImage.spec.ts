/**
 * Container image invariants that only bite at runtime (TASK-147).
 *
 * `T-INFRA-007` — the runtime stage installs with `--omit=optional`, and
 * sharp ships EVERY one of its native libvips binaries as an OPTIONAL
 * dependency. Those two facts together mean `sharp` installs successfully,
 * builds successfully, starts successfully, and then throws "Could not load
 * the sharp module" the first time the owner uploads a HEIC photo (REQ-077).
 *
 * Nothing else in CI catches this: the unit suite runs on the host where the
 * host's own binary is present, and a container that never processes an image
 * never touches the missing module. So the guard is structural — if the
 * `--omit=optional` flag is present, the `@img` COPY must be present too.
 *
 * This is a text assertion over the Dockerfile rather than a container run
 * because it must hold on every PR, in the unit job, with no Docker daemon.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCKERFILE = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

/** The runtime stage only — the build stage legitimately installs everything. */
function runtimeStage(text: string): string {
  const at = text.indexOf('AS runtime');
  expect(at, 'Dockerfile must have a stage named "runtime"').toBeGreaterThan(-1);
  return text.slice(at);
}

describe('T-INFRA-007 · sharp native binaries survive the production install', () => {
  it('T-INFRA-007a · the runtime stage copies @img when it omits optional deps', () => {
    const stage = runtimeStage(DOCKERFILE);

    if (!stage.includes('--omit=optional')) {
      // The flag was removed, so optional deps install normally and the COPY
      // is no longer load-bearing. Nothing to assert.
      return;
    }

    expect(
      /COPY\s+--from=build\s+\/app\/node_modules\/@img\s+node_modules\/@img/.test(stage),
      'The runtime stage omits optional dependencies, which excludes every ' +
        'sharp platform binary. Without `COPY --from=build /app/node_modules/@img`, sharp throws ' +
        'at the first image upload. Remove --omit=optional or restore the COPY.',
    ).toBe(true);
  });

  it('T-INFRA-007b · sharp is a runtime dependency of the API workspace', () => {
    // Guards T-INFRA-007a against passing vacuously if sharp were dropped.
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'apps', 'api', 'package.json'), 'utf8'));
    expect(pkg.dependencies?.sharp, 'sharp must be an API runtime dependency').toBeDefined();
  });

  it('T-INFRA-007c · every sharp platform binary really is optional', () => {
    // The premise of this whole test. If sharp ever ships its binaries as
    // regular dependencies, this guard becomes unnecessary and should be
    // reconsidered rather than left as cargo cult.
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const entry = lock.packages['node_modules/@img/sharp-linuxmusl-x64'];

    expect(entry, '@img/sharp-linuxmusl-x64 must be in the lockfile').toBeDefined();
    expect(entry.optional, 'sharp platform binaries are optional dependencies').toBe(true);
  });

  it('T-INFRA-007d · the base image is still musl, matching the copied binary', () => {
    // node:*-alpine is musl. A move to a glibc base is fine — the COPY
    // resolves in the build stage — but it changes which binary ships, so it
    // should be a deliberate, visible change.
    expect(/ARG NODE_IMAGE=node:\d+-alpine@sha256:[0-9a-f]{64}/.test(DOCKERFILE)).toBe(true);
  });
});
