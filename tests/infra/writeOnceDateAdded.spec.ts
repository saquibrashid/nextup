/**
 * `T-INV-006` — `dateAdded` is write-once (TASK-035, REQ-030, US-021 AC-6).
 *
 * This asserts a NEGATIVE, which is the easiest kind of test to be decoration:
 * a repository that happens to contain no illegal write passes whether or not
 * the checker works at all. So `T-INV-006a` asserts the real tree is clean,
 * and every rule after it is fed a scratch tree that DOES contain the
 * prohibited thing and proven to catch it. `T-INV-006k` is the counterweight
 * in the other direction — the legal creation path must keep passing, or the
 * cheapest way to "fix" a failure would be to ban the write the product needs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_WRITER,
  FORBIDDEN_WRITER_NAMES,
  MUTATING_PRISMA_CALLS,
  dateAddedWriteViolations,
} from '../../tools/check-write-once-date-added.mjs';

let root: string;

/**
 * Scratch trees live in the OS temp directory, never inside the repository.
 * A scratch directory planted in the repo is walked by the other static gates
 * while it exists, which is exactly how `T-CI-008g` was made to flake.
 */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nextup-writeonce-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function plant(relPath: string, source: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, source, 'utf8');
}

/** The legal writer, so the exemption exists in trees that need it. */
function plantAllowedWriter(body: string): void {
  plant(
    ALLOWED_WRITER.file,
    `export async function ${ALLOWED_WRITER.fn}(ownerId, data, tx) {\n${body}\n}\n`,
  );
}

describe('T-INV-006 dateAdded is written once and never rewritten', () => {
  it('T-INV-006a: the real repository has no illegal write', () => {
    const violations = dateAddedWriteViolations(process.cwd());
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T-INV-006b: catches a direct assignment in application source', () => {
    plant(
      'apps/api/src/routes/evil.ts',
      'export function f(l) {\n  l.dateAdded = new Date();\n}\n',
    );

    expect(dateAddedWriteViolations(root).join('\n')).toMatch(/evil\.ts:2/);
  });

  it('T-INV-006c: catches an assignment in the ALLOWED FILE but outside the allowed function', () => {
    // The likeliest real regression: a new helper added next to the legal
    // writer, in the file where writing dateAdded already looks normal.
    plantAllowedWriter('  return db(tx).serviceListing.create({ data });');
    plant(
      ALLOWED_WRITER.file,
      `export async function ${ALLOWED_WRITER.fn}(ownerId, data, tx) {\n` +
        '  return db(tx).serviceListing.create({ data });\n' +
        '}\n\n' +
        'export async function backfill(listing) {\n' +
        '  listing.dateAdded = new Date();\n' +
        '}\n',
    );

    expect(dateAddedWriteViolations(root).join('\n')).toMatch(/ownerData\.ts:6/);
  });

  it('T-INV-006d: does NOT fire on an assignment inside the allowed function', () => {
    plantAllowedWriter('  data.dateAdded = normalise(data.dateAdded);');

    expect(dateAddedWriteViolations(root)).toEqual([]);
  });

  it('T-INV-006e: the exemption fails CLOSED if the allowed function is renamed', () => {
    // If somebody renames createServiceListing, the exemption must evaporate
    // rather than silently widen to the whole file. A gate that keeps
    // exempting a function it can no longer find is worse than no gate.
    plant(
      ALLOWED_WRITER.file,
      'export async function createListingV2(ownerId, data, tx) {\n' +
        '  data.dateAdded = new Date();\n' +
        '}\n',
    );

    expect(dateAddedWriteViolations(root).join('\n')).toMatch(/ownerData\.ts:2/);
  });

  it('T-INV-006f: does NOT fire on dateAddedEdited, which is legitimately assignable', () => {
    // REQ-059's adjacent field. A prefix match would fire here, and the
    // cheapest fix for that false positive is to weaken the real rule.
    plant('apps/api/src/routes/ok.ts', 'export function f(l) {\n  l.dateAddedEdited = false;\n}\n');

    expect(dateAddedWriteViolations(root)).toEqual([]);
  });

  it('T-INV-006g: does NOT fire on a comparison', () => {
    plant(
      'apps/api/src/routes/ok.ts',
      'export function f(a, b) {\n' +
        '  if (a.dateAdded === b.dateAdded) return 1;\n' +
        '  return a.dateAdded < b.dateAdded ? -1 : 0;\n' +
        '}\n',
    );

    expect(dateAddedWriteViolations(root)).toEqual([]);
  });

  it('T-INV-006h: catches dateAdded in every mutating Prisma payload', () => {
    for (const call of MUTATING_PRISMA_CALLS) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      plant(
        'apps/api/src/repository/sneaky.ts',
        'export async function f(db, id, when) {\n' +
          `  return db.serviceListing.${call}({\n` +
          '    where: { listingId: id },\n' +
          '    data: { dateAdded: when },\n' +
          '  });\n' +
          '}\n',
      );

      const found = dateAddedWriteViolations(root).join('\n');
      expect(found, `.${call}() was not caught`).toMatch(new RegExp(`\\.${call}\\(\\)`));
    }
  });

  it('T-INV-006i: does NOT fire on dateAdded inside a create payload', () => {
    // Non-vacuity for 006h. `create` is the legal path — if the payload rule
    // fired on it too, the gate would forbid the only write the product needs
    // and would have to be switched off entirely.
    plant(
      'apps/api/src/repository/ok.ts',
      'export async function f(db, data) {\n' +
        '  return db.serviceListing.create({ data: { ...data, dateAdded: data.dateAdded } });\n' +
        '}\n',
    );

    expect(dateAddedWriteViolations(root)).toEqual([]);
  });

  it('T-INV-006j: catches every forbidden writer name', () => {
    for (const name of FORBIDDEN_WRITER_NAMES) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      plant('apps/api/src/repository/named.ts', `export async function ${name}(id, when) {}\n`);

      const found = dateAddedWriteViolations(root).join('\n');
      expect(found, `${name} was not caught`).toContain(name);
    }
  });

  it('T-INV-006k: a clean tree containing the legal creation path passes', () => {
    // The counterweight. Without it, a checker that reported a violation for
    // EVERY file would pass every catching test above and would look like the
    // strictest gate in the repository.
    plantAllowedWriter('  return db(tx).serviceListing.create({ data: { ...data, ownerId } });');
    plant(
      'apps/api/src/routes/titles.ts',
      'export function toItem(l) {\n  return { dateAdded: toIsoDate(l.dateAdded) };\n}\n',
    );

    expect(dateAddedWriteViolations(root)).toEqual([]);
  });

  it('T-INV-006l: a commented-out assignment is not a finding', () => {
    plant(
      'apps/api/src/routes/ok.ts',
      'export function f(l) {\n' +
        '  // l.dateAdded = new Date();\n' +
        '  /* l.dateAdded = new Date(); */\n' +
        '  return l;\n' +
        '}\n',
    );

    expect(dateAddedWriteViolations(root)).toEqual([]);
  });

  it('T-INV-006m: the scan reaches every declared source root', () => {
    // The walk is the single point of failure for all of the above: a root
    // that is never visited reports clean forever. Proven by planting the
    // same violation in each root in turn.
    for (const dir of ['apps/api/src', 'packages/domain/src', 'apps/web/src']) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      plant(`${dir}/probe.ts`, 'export function f(l) {\n  l.dateAdded = new Date();\n}\n');

      expect(dateAddedWriteViolations(root).length, `${dir} was not scanned`).toBe(1);
    }
  });

  it('T-INV-006n: build output is skipped, so a stale dist cannot fail the gate', () => {
    plant('apps/api/src/dist/old.ts', 'export function f(l) {\n  l.dateAdded = new Date();\n}\n');
    plant(
      'apps/api/src/dist-dev/old.ts',
      'export function f(l) {\n  l.dateAdded = new Date();\n}\n',
    );

    expect(dateAddedWriteViolations(root)).toEqual([]);
  });
});
