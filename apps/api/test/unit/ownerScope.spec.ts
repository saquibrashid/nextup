import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CREATE_METHODS,
  UNIQUE_SELECTOR_METHODS,
  WHERE_METHODS,
  formatViolations,
  ownerScopeViolations,
  repositoryFiles,
} from '../../../../tools/check-owner-scope.mjs';

// T-SEC-021 — every Prisma call in apps/api/src/repository/** is owner-scoped.
//
// Mandatory compensating control #3 from `specs/security.md` §3 (R3). The spec
// says it is load-bearing, and that weakening, skipping or deleting it is a
// blocking review finding.
//
// ⚠ THE REAL-SOURCE CASE BELOW PASSES WHETHER OR NOT THE CHECKER WORKS.
// A checker that always returns `[]` satisfies it perfectly. So every rule is
// also fed source that DOES contain the violation and proven to catch it —
// otherwise this file is decoration that reports success forever.

function withSource(source: string, fn: (files: string[]) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'ownerscope-'));
  const file = path.join(dir, 'sample.ts');
  writeFileSync(file, source, 'utf8');
  try {
    fn([file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('T-SEC-021 repository calls are owner-scoped', () => {
  it('T-SEC-021a: the committed repository has no un-scoped Prisma call', () => {
    const violations = ownerScopeViolations();
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('T-SEC-021b: the repository directory is non-empty', () => {
    // Without this, deleting every repository file would make T-SEC-021a pass.
    expect(repositoryFiles().length).toBeGreaterThan(0);
  });

  it('T-SEC-021c: catches a `where` that omits ownerId', () => {
    withSource(`export const f = () => db.title.findFirst({ where: { id } });`, (files) => {
      const v = ownerScopeViolations(files);
      expect(v).toHaveLength(1);
      expect(v[0]?.reason).toMatch(/does not bind ownerId/);
    });
  });

  it('T-SEC-021d: catches a call with no `where` at all', () => {
    withSource(`export const f = () => db.title.findMany({ take: 10 });`, (files) => {
      expect(ownerScopeViolations(files)[0]?.reason).toMatch(/no `where` clause/);
    });
  });

  it('T-SEC-021e: accepts a `where` that binds ownerId', () => {
    withSource(
      `export const f = () => db.title.findFirst({ where: { ownerId, id } });`,
      (files) => {
        expect(ownerScopeViolations(files)).toEqual([]);
      },
    );
  });

  it.each(UNIQUE_SELECTOR_METHODS)('T-SEC-021f: bans `%s`', (method) => {
    withSource(
      `export const f = () => db.title.${method}({ where: { ownerId, id } });`,
      (files) => {
        const v = ownerScopeViolations(files);
        // Rejected even WITH ownerId written in — the point is that the method
        // cannot honour it, so the presence of the word must not buy a pass.
        expect(v).toHaveLength(1);
        expect(v[0]?.reason).toMatch(/unique selector/);
      },
    );
  });

  it.each(CREATE_METHODS)('T-SEC-021g: catches `%s` without ownerId in data', (method) => {
    withSource(`export const f = () => db.title.${method}({ data: { id } });`, (files) => {
      expect(ownerScopeViolations(files)[0]?.reason).toMatch(/does not set ownerId/);
    });
  });

  it('T-SEC-021h: accepts a spread that ends in ownerId', () => {
    withSource(`export const f = () => db.title.create({ data: { ...rest, ownerId } });`, (files) =>
      expect(ownerScopeViolations(files)).toEqual([]),
    );
  });

  it('T-SEC-021i: an opaque spread is NOT proof of scoping', () => {
    // `{ ...filter }` could be anything. Accepting it would let any violation
    // through behind a single variable.
    withSource(`export const f = () => db.title.findMany({ where: { ...filter } });`, (files) => {
      expect(ownerScopeViolations(files)).toHaveLength(1);
    });
  });

  it('T-SEC-021j: ownerId nested inside OR does not count as scoping', () => {
    // An OR branch WIDENS the result set. Scoping must narrow it, so ownerId
    // has to sit at the top level of the `where`, not inside a disjunction.
    withSource(
      `export const f = () => db.title.findMany({ where: { OR: [{ ownerId }, { id }] } });`,
      (files) => expect(ownerScopeViolations(files)).toHaveLength(1),
    );
  });

  it('T-SEC-021k: ignores non-Prisma calls of the same name', () => {
    withSource(`export const n = list.findMany({ where: { id } });`, (files) => {
      // `list.findMany` has a plain identifier receiver, not `x.model.method`.
      expect(ownerScopeViolations(files)).toEqual([]);
    });
  });

  it('T-SEC-021l: every guarded method list is non-empty', () => {
    // Emptying a list would silently disable a whole rule while every other
    // case here still passed.
    expect(UNIQUE_SELECTOR_METHODS.length).toBeGreaterThan(0);
    expect(WHERE_METHODS.length).toBeGreaterThan(0);
    expect(CREATE_METHODS.length).toBeGreaterThan(0);
  });
});
