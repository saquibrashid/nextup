// Production-dependency vulnerability gate.
//
// WHY THIS EXISTS RATHER THAN A BARE `npm audit --omit=dev --audit-level=high`:
//
// `npm audit` is all-or-nothing. When an advisory lands that is real, high
// severity, and has NO published fix, a bare audit leaves exactly three
// options: block every commit indefinitely on something nobody can fix,
// weaken `--audit-level` and lose the whole class of finding, or take
// `npm audit fix --force` and accept whatever it does. All three are worse
// than a reviewed, documented, self-expiring exception.
//
// The third option is a genuine trap here: for GHSA-ggr8-5vv4-36mx npm
// reports `fixAvailable: { name: 'prisma', version: '6.12.0' }` — which is a
// DOWNGRADE from the installed 6.19.3, presented in the same field and the
// same words as an upgrade. Running the suggested fix would silently move the
// datastore layer seven minor versions BACKWARDS to make a warning disappear.
//
// The rules below are what make an exception safe:
//
//   1. Anything high or critical that is not explicitly listed FAILS.
//   2. A listed exception that no longer appears in the audit ALSO FAILS.
//
// Rule 2 is the important half. An allow-list that only ever suppresses is a
// permanent hole that outlives the reason it was added; this one forces its
// own deletion the moment upstream publishes a fix, so the exception cannot
// quietly become policy.

import { execFileSync } from 'node:child_process';

const BLOCKING = new Set(['high', 'critical']);

/**
 * Advisories accepted in the PRODUCTION dependency tree.
 *
 * Adding an entry is a security decision, not a build fix. Each one must say
 * what the code is, how it is reached, and why it cannot hurt this product.
 */
export const EXCEPTIONS = [
  {
    id: 'GHSA-ggr8-5vv4-36mx',
    package: 'deepmerge-ts',
    accepted: '2026-08-17',
    reason:
      'Stack exhaustion in deepmerge-ts when merging recursive object graphs. ' +
      'Reached only as @prisma/client → prisma → @prisma/config → deepmerge-ts, ' +
      'i.e. the Prisma CLI config loader, which runs at build and migrate time ' +
      'against our own committed prisma.config file. It is not on any request ' +
      'path: @prisma/client does not load @prisma/config at runtime, and no ' +
      'owner-supplied input — screenshots included — reaches a config merge. ' +
      'Exploitation needs attacker-controlled cyclic input, which does not exist ' +
      'here. NO patched version exists at time of acceptance (deepmerge-ts ' +
      'latest is 7.1.5; the advisory covers *), so the finding is unfixable, ' +
      'not unfixed. npm\u2019s suggested "fix" is a DOWNGRADE to prisma 6.12.0 ' +
      'from the installed 6.19.3 and must not be taken.',
  },
];

function runAudit() {
  try {
    return execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    // npm exits non-zero when it finds anything. That is the normal path here;
    // the report we need is still on stdout. Only a genuinely empty stdout
    // means the command itself failed.
    if (err.stdout && String(err.stdout).trim()) return String(err.stdout);
    throw new Error(`npm audit did not produce a report: ${err.message}`, { cause: err });
  }
}

export function collectAdvisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via === 'string') continue; // an indirect edge, not an advisory
      if (!BLOCKING.has(via.severity)) continue;
      const id =
        String(via.url ?? '')
          .split('/')
          .pop() || `npm-${via.source}`;
      if (!found.has(id)) {
        found.set(id, { id, package: via.name, title: via.title, severity: via.severity });
      }
    }
  }
  return found;
}

// Only shell out when run as a gate; importing this module for tests must not
// invoke npm.
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
) {
  const report = JSON.parse(runAudit());
  const found = collectAdvisories(report);
  const allowed = new Map(EXCEPTIONS.map((e) => [e.id, e]));
  const problems = [];

  for (const adv of found.values()) {
    if (allowed.has(adv.id)) continue;
    problems.push(
      `UNREVIEWED ${adv.severity} advisory in the PRODUCTION tree: ${adv.id} (${adv.package})\n` +
        `    ${adv.title}\n` +
        '    Fix it, or add a reviewed exception to tools/check-audit.mjs saying why it cannot hurt this product.\n' +
        '    Do NOT run `npm audit fix --force` without reading what it proposes — it may be a DOWNGRADE.',
    );
  }

  for (const exc of EXCEPTIONS) {
    if (found.has(exc.id)) continue;
    problems.push(
      `STALE EXCEPTION: ${exc.id} (${exc.package}) is allow-listed but no longer reported.\n` +
        '    Upstream has fixed it or the dependency is gone. DELETE the entry from\n' +
        '    tools/check-audit.mjs. This gate fails on unnecessary exceptions on purpose:\n' +
        '    a suppression nobody removes is a permanent hole.',
    );
  }

  if (problems.length > 0) {
    console.error('\nProduction dependency audit FAILED:\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
  }

  const n = EXCEPTIONS.length;
  console.log(
    `Production audit passed: no unreviewed high or critical advisories ` +
      `(${n} documented exception${n === 1 ? '' : 's'}, ${n === 1 ? 'still applicable' : 'all still applicable'}).`,
  );
}
