/**
 * `T-INV-016` — a non-empty `title.duplicate_ack_seq` is written in
 * `routes/fixMatch.ts` and `routes/listings.ts`, and nowhere else (§16.4).
 *
 * ⚠ THIS RULE HAS BEEN WRONG TWICE, which is why this file is shaped the way
 * it is. Its first form grepped for a `dup:` work-identity prefix that appears
 * nowhere in the codebase — it passed vacuously for as long as it existed. Its
 * second form named `createTitleAllowingDuplicate()`, a function that has
 * never existed and could not be written, because BOTH real writers are
 * `updateTitle()` calls on titles that already exist.
 *
 * So `T-INV-016a` asserts the real tree is clean, and every rule after it is
 * fed a scratch tree that DOES contain the thing in question and proven to
 * catch it — or, for the two exemptions, proven NOT to. `T-INV-016f` is the
 * counterweight: the allow-list must keep pointing at files that really do
 * write the field, or the exemption has quietly become a list of two
 * irrelevant paths and the gate protects nothing.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_WRITERS,
  FIELD,
  duplicateAckWriteViolations,
} from '../../tools/check-duplicate-ack-writers.mjs';

let root: string;

/**
 * Scratch trees live in the OS temp directory, never inside the repository —
 * a scratch directory planted in the repo is walked by the other static gates
 * while it exists, which is how `T-CI-008g` was once made to flake.
 */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nextup-dupack-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function plant(relPath: string, source: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, source, 'utf8');
}

describe('T-INV-016 a non-empty duplicate_ack_seq has exactly two writers', () => {
  it('T-INV-016a: the real repository writes it nowhere else', () => {
    const violations = duplicateAckWriteViolations(process.cwd());
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T-INV-016b: catches a write in a third route', () => {
    plant(
      'apps/api/src/routes/evil.ts',
      `export async function f(tx) {\n  await updateTitle(o, t, { ${FIELD}: t.id }, tx);\n}\n`,
    );

    expect(duplicateAckWriteViolations(root).join('\n')).toMatch(/evil\.ts:2/);
  });

  it('T-INV-016c: catches a write hidden in the web client', () => {
    // The browser can never legitimately set this — it is an index-collision
    // escape hatch, not a user-facing field — so a write here would be a
    // trusted-client bug, the class of defect the owner cannot see at all.
    plant('apps/web/src/lib/evil.ts', `export const patch = { ${FIELD}: someId };\n`);

    expect(duplicateAckWriteViolations(root).join('\n')).toMatch(/lib\/evil\.ts:1/);
  });

  it('T-INV-016d: does NOT flag the type declaration the field needs to exist', () => {
    // `packages/domain` declares this field. Flagging a declaration would make
    // the gate fire on the type definitions, and the cheapest way to silence
    // that is to relax the gate until it catches nothing.
    plant(
      'packages/domain/src/types.ts',
      `export interface Title {\n  ${FIELD}: string;\n  other?: string | null;\n}\n`,
    );

    expect(duplicateAckWriteViolations(root)).toEqual([]);
  });

  it('T-INV-016e: does NOT flag an explicit empty write', () => {
    // The rule is about a NON-EMPTY value. `''` is the column default and the
    // ordinary state; writing it back is how an acknowledgement would be
    // cleared, not how one is granted.
    plant('apps/api/src/routes/reset.ts', `const data = { ${FIELD}: '' };\n`);

    expect(duplicateAckWriteViolations(root)).toEqual([]);
  });

  it('T-INV-016f: the allow-list still points at files that really do write it', () => {
    // Non-vacuity, and the failure this guards is silent: if fix-match or
    // restore stopped writing the field, the allow-list would go on exempting
    // two paths that no longer do anything, and `T-INV-016a` would keep
    // passing while the rule protected nothing.
    for (const writer of ALLOWED_WRITERS) {
      const source = readFileSync(join(process.cwd(), writer), 'utf8');
      expect(source, `${writer} no longer writes ${FIELD}`).toContain(FIELD);
    }

    expect(ALLOWED_WRITERS).toHaveLength(2);
  });
});
