/**
 * Third-party licence inventory and copyleft gate (TASK-153, `T-LICENSE-001`).
 *
 * nextup ships under **MIT** (`LICENSE`). `specs/security.md` §9 records one
 * obligation attached to that: the HEIC decode chain reaches `libheif-js`,
 * which is **LGPL-3.0**. Used unmodified and decode-only it does not relicense
 * this app, but its notice must be RETAINED. A notice obligation is the kind
 * of thing that is satisfied once, by hand, and then silently broken by the
 * next dependency change — so it is a CI gate, not a README paragraph.
 *
 * Three jobs, deliberately separated so each can be tested on its own:
 *
 *   1. `collectRuntimePackages()` — the **production** dependency tree with a
 *      licence for each package. Dev dependencies are excluded because they
 *      are not distributed; a notice file that lists the test runner buries
 *      the four packages that actually carry obligations.
 *   2. `classify()` / `renderNotices()` — PURE functions over that list. Being
 *      pure is what lets the LGPL path be tested TODAY, with a synthetic
 *      `libheif-js` entry, even though TASK-147 has not yet added the real
 *      dependency. Without that, the obligation would ship untested and would
 *      first be exercised in M3, which is precisely when nobody is looking at
 *      licensing.
 *   3. `checkLicences()` — the gate. It fails on a **strong-copyleft** runtime
 *      dependency (GPL/AGPL), which genuinely would relicense this MIT app,
 *      and on a **weak-copyleft** one (LGPL/MPL/EPL) that is missing from the
 *      committed notice file.
 *
 * ⚠ The distinction between strong and weak copyleft is the whole point. A
 * blanket "no copyleft" rule would ban `libheif-js` and with it every iPhone
 * HEIC upload (ASM-058). A blanket "copyleft is fine" rule would let a GPL-3.0
 * package in and quietly relicense the repository. Neither is safe; this
 * distinguishes them.
 *
 * so the notice file and the SBOM cannot disagree about what ships.
 *
 * Usage:
 *   node tools/check-licences.mjs           → rewrite THIRD-PARTY-NOTICES.md
 *   node tools/check-licences.mjs --check   → exit 1 on drift or a violation
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const NOTICES_FILE = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');
export const LOCKFILE = path.join(ROOT, 'package-lock.json');

/**
 * Strong copyleft: linking these into a distributed work requires the whole
 * work to be offered under the same licence. For this MIT repository that is
 * not an obligation to document, it is an incompatibility to refuse.
 */
const STRONG_COPYLEFT = [/^AGPL/i, /^GPL-/i, /^GPL$/i, /^SSPL/i];

/**
 * Weak copyleft: permitted, but only as an unmodified, replaceable dependency
 * whose notice is retained. Each one MUST appear in THIRD-PARTY-NOTICES.md.
 */
const WEAK_COPYLEFT = [/^LGPL/i, /^MPL-/i, /^EPL-/i, /^CDDL/i];

function matchesAny(patterns, licence) {
  return patterns.some((re) => re.test(licence));
}

export function isStrongCopyleft(licence) {
  // `LGPL-3.0` contains `GPL-`, so weak copyleft is tested FIRST. Getting this
  // order wrong would reject libheif-js and remove HEIC support entirely.
  if (matchesAny(WEAK_COPYLEFT, licence)) return false;
  return matchesAny(STRONG_COPYLEFT, licence);
}

export function isWeakCopyleft(licence) {
  return matchesAny(WEAK_COPYLEFT, licence);
}

/**
 * Reads the installed PRODUCTION tree through `npm sbom`, which is the same
 * artefact `specs/security.md` §9 requires on release — so the notice file and
 * the SBOM cannot disagree about what ships.
 */
/**
 * Reads the installed PRODUCTION tree from `package-lock.json`.
 *
 * Deliberately NOT a call out to `npm sbom`. Node 22 refuses to spawn a `.cmd`
 * without a shell (the CVE-2024-27980 fix), so an `npm` subprocess fails on
 * Windows and succeeds on Linux CI — the worst possible split, because the
 * gate would be silently unrunnable for the one person maintaining it. The
 * lockfile is the same source of truth `npm sbom` reads, needs no subprocess,
 * no network and no shell, and is byte-identical on every platform.
 *
 * `dev: true` entries are excluded: dev dependencies are not distributed, and
 * a notice file listing the test runner buries the handful of packages that
 * actually carry obligations. `link: true` entries are the local workspaces.
 */
export function collectRuntimePackages(lockfilePath = LOCKFILE, modulesRoot = ROOT) {
  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  const entries = lockfile.packages ?? {};

  return Object.entries(entries)
    .filter(([key, meta]) => key.startsWith('node_modules/') && !meta.dev && !meta.link)
    .map(([key, meta]) => {
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      return {
        name,
        version: meta.version ?? '',
        licence: meta.license ?? readLicenceFromDisk(modulesRoot, key),
      };
    })
    .filter((pkg) => !pkg.name.startsWith('@nextup/'))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * The lockfile omits `license` for a few packages. Falling back to the
 * installed `package.json` matters: without it those arrive as `UNKNOWN` and
 * the gate blocks on packages that are in fact fine, which trains whoever hits
 * it to weaken the gate.
 */
function readLicenceFromDisk(modulesRoot, key) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(modulesRoot, key, 'package.json'), 'utf8'));
    if (typeof manifest.license === 'string') return manifest.license;
    if (manifest.license?.type) return manifest.license.type;
    if (Array.isArray(manifest.licenses)) {
      const ids = manifest.licenses.map((l) => l.type ?? l).filter(Boolean);
      if (ids.length > 0) return ids.join(' OR ');
    }
  } catch {
    /* falls through to UNKNOWN */
  }
  return 'UNKNOWN';
}

export function classify(packages) {
  return {
    strong: packages.filter((pkg) => isStrongCopyleft(pkg.licence)),
    weak: packages.filter((pkg) => isWeakCopyleft(pkg.licence)),
    unknown: packages.filter((pkg) => pkg.licence === 'UNKNOWN'),
  };
}

/**
 * Renders the notice file. Pure: same input, same bytes. That is what makes
 * the drift check (`--check`) meaningful rather than a diff of timestamps —
 * a generated file carrying a date can never be compared to a committed one.
 */
export function renderNotices(packages) {
  const { weak } = classify(packages);

  const lines = [
    '# Third-party notices',
    '',
    '<!--',
    '  GENERATED by `node tools/check-licences.mjs`. Do not edit by hand.',
    '  `npm run check:licences` fails CI if this file drifts from the installed',
    '  production dependency tree (T-LICENSE-001).',
    '-->',
    '',
    'nextup is distributed under the MIT licence (see `LICENSE`). It bundles the',
    'third-party packages below, each under its own licence.',
    '',
    '## Components carrying a retained-notice obligation',
    '',
  ];

  if (weak.length === 0) {
    lines.push(
      '_None currently installed._ The HEIC decode chain (TASK-147) will add',
      '`libheif-js` (LGPL-3.0) here; the owner approved carrying it at TASK-153.',
      '',
    );
  } else {
    lines.push(
      'These are weak-copyleft. They are used **unmodified** and are replaceable,',
      'so they do not relicense this work — but their notices must be retained.',
      '',
      '| Package | Version | Licence |',
      '|---|---|---|',
      ...weak.map((pkg) => `| \`${pkg.name}\` | ${pkg.version} | **${pkg.licence}** |`),
      '',
    );
  }

  lines.push(
    '## All production dependencies',
    '',
    '| Package | Version | Licence |',
    '|---|---|---|',
  );

  for (const pkg of packages) {
    lines.push(`| \`${pkg.name}\` | ${pkg.version} | ${pkg.licence} |`);
  }

  lines.push('');
  return lines.join('\n');
}

export function checkLicences(packages, noticesText) {
  const findings = [];
  const { strong, weak, unknown } = classify(packages);

  for (const pkg of strong) {
    findings.push(
      `${pkg.name}@${pkg.version} is ${pkg.licence} (strong copyleft). ` +
        'It cannot ship in this MIT application. See specs/security.md §9.',
    );
  }

  for (const pkg of weak) {
    if (!noticesText.includes(pkg.name)) {
      findings.push(
        `${pkg.name}@${pkg.version} is ${pkg.licence} (weak copyleft) but is not ` +
          'listed in THIRD-PARTY-NOTICES.md. Its notice must be retained.',
      );
    }
  }

  for (const pkg of unknown) {
    findings.push(`${pkg.name}@${pkg.version} declares no licence; it cannot be cleared.`);
  }

  return findings;
}

function main() {
  const check = process.argv.includes('--check');
  const packages = collectRuntimePackages();
  const expected = renderNotices(packages);

  let committed;
  try {
    committed = readFileSync(NOTICES_FILE, 'utf8');
  } catch {
    // A missing notices file is drift, not a crash: `npm run notices` creates it.
    committed = '';
  }

  const findings = checkLicences(packages, committed);

  if (!check) {
    writeFileSync(NOTICES_FILE, expected);
    console.error(`Wrote ${path.relative(ROOT, NOTICES_FILE)} (${packages.length} packages).`);
    return;
  }

  if (committed.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
    findings.push(
      'THIRD-PARTY-NOTICES.md is out of date. Run `npm run notices` and commit the result.',
    );
  }

  if (findings.length > 0) {
    console.error('Licence check failed:\n');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
    return;
  }

  console.error(`Licence check passed: ${packages.length} production packages cleared.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
