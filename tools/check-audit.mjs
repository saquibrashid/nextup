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

function defaultSleep(ms) {
  // Synchronous by design: the gate is a straight-line script, and an async
  // main() here would change how a thrown error sets the process exit code.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Fetch the report, retrying a transport failure a few times.
 *
 * The audit endpoint is a remote service in the middle of being retired, and
 * its failures here are intermittent — this same tree audited clean an hour
 * either side of a `400`. A gate that goes red on somebody else's outage is a
 * gate that gets switched off, so a couple of retries is the difference
 * between this control surviving and this control being deleted. It still
 * FAILS after the last attempt: a repeatable outage must block, because an
 * unchecked production tree is not a passing one.
 */
export function loadReport({ attempts = 3, waitMs = 4000, sleep = defaultSleep, read } = {}) {
  const fetchOnce = read ?? (() => assertAuditRan(JSON.parse(runAudit())));
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return fetchOnce();
    } catch (err) {
      last = err;
      if (attempt < attempts) {
        console.error(
          `npm audit attempt ${attempt} of ${attempts} failed (${err.message.split('\n')[0]}); ` +
            `retrying in ${waitMs}ms.`,
        );
        sleep(waitMs);
      }
    }
  }
  throw last;
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

/**
 * Reject a payload that is not an audit result at all.
 *
 * ⚠ "NO ADVISORIES" AND "THE AUDIT DID NOT RUN" ARE THE SAME SHAPE, AND THE
 * DIFFERENCE IS THE WHOLE GATE.
 *
 * When npm's audit endpoint is unavailable — it returned `400 Bad Request` on
 * the quick-audit route while being retired, and is documented as retiring —
 * `npm audit --json` still exits with a parseable JSON document on stdout.
 * That document carries an `error` object and NO `vulnerabilities` key. Fed
 * straight to `collectAdvisories` it yields an empty map, which is
 * indistinguishable from a clean tree.
 *
 * Both of this gate's rules then invert:
 *
 *   - Rule 1 (unreviewed advisories fail) passes vacuously — an outage would
 *     wave through a genuine unfixed critical.
 *   - Rule 2 (stale exceptions fail) fires on EVERY exception at once, telling
 *     the reader to delete a documented, still-applicable suppression because
 *     "upstream has fixed it". That advice is confidently wrong and destroys
 *     reviewed security reasoning.
 *
 * The second is why this throws rather than warns. A transport failure must
 * read as "the audit could not be run", never as a finding about the tree.
 */
export function assertAuditRan(report) {
  if (report && typeof report === 'object' && report.vulnerabilities !== undefined) return report;

  const detail =
    report && typeof report === 'object' && report.error
      ? `${report.error.code ?? 'error'}: ${report.error.summary ?? report.error.detail ?? 'no summary'}`
      : 'the report has no `vulnerabilities` key';

  throw new Error(
    'npm audit did not return a usable report, so the production tree was NEVER CHECKED.\n' +
      `    ${detail}\n` +
      '    This is an audit failure, not a clean result — do not read it as "no advisories",\n' +
      '    and do NOT delete any exception on the strength of it. Re-run; if npm\u2019s audit\n' +
      '    endpoint is down or retired, fix the gate rather than skipping it.',
  );
}

// Only shell out when run as a gate; importing this module for tests must not
// invoke npm.
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
) {
  let report;
  try {
    report = loadReport();
  } catch (err) {
    console.error(`\nProduction dependency audit COULD NOT RUN:\n\n  - ${err.message}\n`);
    process.exit(1);
  }
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
