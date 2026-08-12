/**
 * Licence and third-party notice gates (TASK-153, `T-LICENSE-001`).
 *
 * Defined in `specs/testing.md` §9A; the obligation itself is
 * `specs/security.md` §9 and `docs/adr/ADR-0008-heic-transcode-on-ingest.md`.
 *
 * As with `T-SEC-009`, these assert **the check itself works**, not merely
 * that the tree is currently clean. A repository with no copyleft dependency
 * passes a copyleft gate that does nothing at all, and would keep passing
 * right up until the day it mattered.
 *
 * That is not hypothetical here. The one obligation this project knowingly
 * carries — `libheif-js`, LGPL-3.0 — is added by **TASK-147**, which has not
 * landed. Every assertion about the LGPL path is therefore driven through
 * synthetic package lists, so the handling is proven NOW rather than being
 * exercised for the first time in M3, when nobody is looking at licensing.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  checkLicences,
  classify,
  collectRuntimePackages,
  isStrongCopyleft,
  isWeakCopyleft,
  renderNotices,
} from '../../tools/check-licences.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** The real chain from ADR-0008 §"Licence obligation", as TASK-147 will install it. */
const HEIC_CHAIN = [
  { name: 'heic-convert', version: '2.1.0', licence: 'ISC' },
  { name: 'heic-decode', version: '2.0.0', licence: 'ISC' },
  { name: 'libheif-js', version: '1.17.6', licence: 'LGPL-3.0' },
];

describe('T-LICENSE-001 · the MIT licence and its retained-notice obligations', () => {
  it('T-LICENSE-001a · the repository ships an MIT LICENSE with a copyright line', () => {
    const licence = read('LICENSE');

    expect(licence).toContain('MIT License');
    expect(licence).toMatch(/Copyright \(c\) \d{4}/);
    // The two operative clauses. A truncated LICENSE still "contains MIT".
    expect(licence).toContain(
      'The above copyright notice and this permission notice shall be included',
    );
    expect(licence).toContain('WITHOUT WARRANTY OF ANY KIND');
  });

  it('T-LICENSE-001b · README, NOTICE and LICENSE agree on the licence', () => {
    // Three files stating the licence is three chances to disagree. The README
    // badge in particular renders fine while pointing at a licence the repo
    // does not carry.
    expect(read('README.md')).toContain('license-MIT');
    expect(read('NOTICE')).toContain('MIT License');
  });

  it('T-LICENSE-001c · THIRD-PARTY-NOTICES.md matches the installed production tree', () => {
    // The drift gate. This is the assertion that keeps the notice file honest
    // as dependencies change, which is the only way a notice obligation
    // survives contact with Dependabot.
    const packages = collectRuntimePackages();
    expect(packages.length).toBeGreaterThan(0);

    const expected = renderNotices(packages);
    expect(read('THIRD-PARTY-NOTICES.md').replace(/\r\n/g, '\n')).toBe(
      expected.replace(/\r\n/g, '\n'),
    );
  });

  it('T-LICENSE-001d · every production dependency has a resolvable licence', () => {
    const { unknown } = classify(collectRuntimePackages());
    expect(unknown.map((pkg) => pkg.name)).toEqual([]);
  });

  it('T-LICENSE-001e · LGPL-3.0 is classified as WEAK copyleft, not strong', () => {
    // The single most dangerous mistake in this file. "LGPL-3.0" contains the
    // substring "GPL-", so a naive strong-copyleft match rejects libheif-js —
    // which would remove HEIC support entirely (ASM-058) on what looks like a
    // sound licence-compliance argument.
    expect(isWeakCopyleft('LGPL-3.0')).toBe(true);
    expect(isStrongCopyleft('LGPL-3.0')).toBe(false);
    expect(isStrongCopyleft('LGPL-3.0-or-later')).toBe(false);

    expect(isStrongCopyleft('GPL-3.0')).toBe(true);
    expect(isStrongCopyleft('AGPL-3.0')).toBe(true);
    expect(isStrongCopyleft('SSPL-1.0')).toBe(true);
    expect(isStrongCopyleft('MIT')).toBe(false);
    expect(isStrongCopyleft('Apache-2.0')).toBe(false);
  });

  it('T-LICENSE-001f · the HEIC chain passes once libheif-js is listed in the notices', () => {
    // Proves the TASK-147 end state is clean BEFORE TASK-147 lands.
    const notices = renderNotices(HEIC_CHAIN);

    expect(notices).toContain('libheif-js');
    expect(notices).toContain('LGPL-3.0');
    expect(notices).toContain('retained-notice obligation');
    expect(checkLicences(HEIC_CHAIN, notices)).toEqual([]);
  });

  it('T-LICENSE-001g · an LGPL dependency MISSING from the notices is caught', () => {
    // The failure this whole gate exists to prevent: the codec ships, the
    // notice does not, and the LGPL-3.0 obligation is silently breached.
    const findings = checkLicences(HEIC_CHAIN, '# Third-party notices\n\nNothing here.\n');

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('libheif-js');
    expect(findings[0]).toContain('not');
  });

  it('T-LICENSE-001h · a strong-copyleft dependency is refused outright', () => {
    // GPL-3.0 in a distributed MIT app is not a notice obligation, it is an
    // incompatibility. Listing it in the notice file must NOT clear it.
    const gpl = [{ name: 'some-gpl-lib', version: '1.0.0', licence: 'GPL-3.0' }];
    const findings = checkLicences(gpl, renderNotices(gpl));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('some-gpl-lib');
    expect(findings[0]).toContain('strong copyleft');
  });

  it('T-LICENSE-001i · an unlicensed dependency cannot be cleared', () => {
    const mystery = [{ name: 'mystery-lib', version: '0.1.0', licence: 'UNKNOWN' }];
    const findings = checkLicences(mystery, renderNotices(mystery));

    expect(findings.some((finding) => finding.includes('mystery-lib'))).toBe(true);
  });

  it('T-LICENSE-001j · the notice render is deterministic', () => {
    // The drift check in T-LICENSE-001c compares bytes. A render that varied
    // between runs — an embedded date, an unstable sort — would make that
    // comparison fail at random and get switched off.
    expect(renderNotices(HEIC_CHAIN)).toBe(renderNotices(HEIC_CHAIN));
    expect(renderNotices(collectRuntimePackages())).toBe(renderNotices(collectRuntimePackages()));
  });

  it('T-LICENSE-001k · NOTICE records the approved LGPL-3.0 obligation and its decode-only scope', () => {
    const notice = read('NOTICE');

    expect(notice).toContain('libheif-js');
    expect(notice).toContain('LGPL-3.0');
    expect(notice).toContain('unmodified');
    // Decode-only is what keeps the floor at LGPL rather than GPL: the x265
    // ENCODER is GPL. If that scope is ever lost, the analysis in ADR-0008 no
    // longer holds and the approval recorded at TASK-153 no longer applies.
    expect(notice).toMatch(/decode-only/i);
    expect(notice).toContain('TASK-153');
  });

  it('T-LICENSE-001l · the generated notice file is excluded from Prettier', () => {
    // Two CI gates deadlock without this. `format:check` reflows the generated
    // Markdown; `check:licences --check` then compares it BYTE FOR BYTE against
    // a fresh render and reports drift; regenerating undoes the formatting.
    // Neither gate can be satisfied while the other is. This was observed, not
    // theorised — both failed in turn before the ignore line was added, and the
    // obvious "fix" is to weaken the byte comparison, which is the one part of
    // the drift check that gives it any teeth.
    expect(read('.prettierignore')).toMatch(/^THIRD-PARTY-NOTICES\.md$/m);
  });
});
