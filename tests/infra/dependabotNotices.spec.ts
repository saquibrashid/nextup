/**
 * `T-CI-010` — the Dependabot notices workflow holds `contents: write`, so its
 * safety properties are asserted rather than assumed.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `.github/workflows/dependabot-notices.yml` regenerates `THIRD-PARTY-
 * NOTICES.md` on a Dependabot PR and pushes the result. Dependabot's own token
 * is read-only on `pull_request` and `push`, so the workflow has to run on
 * `pull_request_target` — which runs in the BASE repository's context with a
 * writable token.
 *
 * That combination — a write token in a job whose input is a pull request — is
 * the classic GitHub Actions privilege-escalation shape. It is safe here for
 * exactly ONE reason: **the job never installs anything**, so no code from the
 * bumped dependency is ever executed. `tools/check-licences.mjs` imports only
 * `node:` built-ins and reads `package-lock.json` as data.
 *
 * ⚠ **THAT REASON IS ONE LINE AWAY FROM BEING UNTRUE, AND THE LINE LOOKS LIKE
 * A FIX.** Someone maintaining this later sees a workflow that runs a Node
 * script with no `npm ci` and adds one "so the script has its dependencies".
 * It has none. But that edit silently converts a file-copy into arbitrary
 * `postinstall` execution holding `contents: write` on the default branch —
 * and the diff would read as an obvious correction. No other gate in this
 * repository would notice: the workflow would still be SHA-pinned
 * (`T-CI-006`), still unscheduled (`T-CI-005d`), still lint-clean.
 *
 * So the ban is asserted here, with the reasoning attached, and `d` proves the
 * matcher actually catches the edit it is aimed at rather than passing because
 * the file happens to be clean today.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(ROOT, '.github/workflows/dependabot-notices.yml');
const yml = readFileSync(WORKFLOW, 'utf8');

/**
 * An install is any command that resolves a manifest and may run lifecycle
 * scripts. Kept as a list of whole commands rather than a search for the word
 * "install", so that prose in the header explaining why installs are banned
 * does not match itself.
 */
const INSTALL_COMMANDS = [
  /\bnpm\s+ci\b/,
  /\bnpm\s+i(?:nstall)?\b/,
  /\bnpm\s+exec\b/,
  /\bnpx\b/,
  /\byarn\b/,
  /\bpnpm\b/,
];

/** Only the executable half of the file — comments explain the ban. */
const runLines = yml
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('T-CI-010 · the Dependabot notices workflow cannot execute dependency code', () => {
  it('T-CI-010a: it never installs anything — the whole basis of its safety', () => {
    // ⚠ If this fails, do not "fix" it by relaxing the matcher. The workflow
    // holds `contents: write` on a `pull_request_target` trigger; an install
    // step there runs the bumped package's `postinstall` with that token.
    const offenders = INSTALL_COMMANDS.filter((re) => re.test(runLines));
    expect(offenders.map(String)).toEqual([]);
  });

  it('T-CI-010b: it runs the generator directly, and the generator has no imports to install', () => {
    expect(runLines).toMatch(/node tools\/check-licences\.mjs/);

    // The claim in `a` is only true while this stays true.
    const script = readFileSync(path.join(ROOT, 'tools/check-licences.mjs'), 'utf8');
    const imports = [...script.matchAll(/^import\s.*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec, `${spec} is not a node: built-in`).toMatch(/^node:/);
    }
  });

  it('T-CI-010c: it is gated on Dependabot AND on the branch being in this repository', () => {
    // The author check alone is not enough: a fork PR can be opened by anyone,
    // and `pull_request_target` would still run with the base repo's token.
    expect(runLines).toMatch(/github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
    expect(runLines).toMatch(
      /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
    );
  });

  it('T-CI-010d: the install matcher is not vacuous — it catches the edit it exists to stop', () => {
    // The mutation that matters, and the exact shape a well-meaning
    // maintainer would add: an install step placed before the generator.
    const planted = ['      - run: npm ci', '      - run: node tools/check-licences.mjs'].join(
      '\n',
    );
    expect(INSTALL_COMMANDS.some((re) => re.test(planted))).toBe(true);

    // …and it does not fire on the workflow's legitimate `node` invocation.
    expect(INSTALL_COMMANDS.some((re) => re.test('      - run: node tools/x.mjs'))).toBe(false);
  });

  it('T-CI-010e: it holds the narrowest token — contents only, and no PR write', () => {
    expect(runLines).toMatch(/permissions:\s*\n\s*contents: write/);
    // No `pull-requests: write`: this workflow must not approve, label,
    // comment on or merge a dependency bump. It makes a PR truthful; a human
    // still decides whether to take it.
    expect(runLines).not.toMatch(/pull-requests:\s*write/);
  });

  it('T-CI-010f: it refuses to push anything but the notices file', () => {
    // The generator is supposed to write exactly one file. Asserting the dirty
    // set before pushing is what keeps an unexpected write from riding along
    // on a commit made with a privileged token.
    expect(runLines).toMatch(/Refusing to push/);
    expect(runLines).toMatch(/git status --porcelain/);
    expect(runLines).toMatch(/THIRD-PARTY-NOTICES\.md"/);
  });

  it('T-CI-010g: it is not a scheduler and not an auto-merge', () => {
    // `T-CI-005d` covers `schedule:` across every workflow; this pins the two
    // specific escalations someone might add to THIS file while "finishing the
    // automation" — it running on its own, or it merging its own result.
    expect(runLines).not.toMatch(/^\s*schedule:\s*$/m);
    expect(runLines).not.toMatch(/gh pr merge|pull-request-merge|automerge|auto-merge/i);
  });
});
