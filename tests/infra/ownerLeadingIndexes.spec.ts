/**
 * `T-INV-014` — every table has an `owner_id` column, and every index that
 * serves an owner-scoped query leads with it (`specs/data-model.md` §16.2).
 *
 * ⚠ This rule spent its whole life orphaned — named in `specs/testing.md`,
 * assigned to nobody, enforced by nothing — and in that state it was ALSO
 * false: 12 indexes did not lead with `owner_id`, all of them correctly. So
 * `T-INV-014a` asserts the real schema is clean, and every rule after it is
 * fed a scratch schema that DOES contain the thing in question and proven to
 * catch it. `T-INV-014e` and `T-INV-014f` are the counterweights that keep the
 * narrowing honest: the exemption list must stay an allow-list, and every name
 * on it must still refer to a real index.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EXEMPT_INDEXES,
  SCHEMA_PATH,
  ownerLeadingIndexViolations,
  staleExemptions,
} from '../../tools/check-owner-leading-indexes.mjs';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nextup-ownerix-'));
  mkdirSync(join(root, 'prisma'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function plantSchema(body: string): void {
  writeFileSync(join(root, SCHEMA_PATH), body, 'utf8');
}

describe('T-INV-014 owner-scoped indexes lead with ownerId', () => {
  it('T-INV-014a: the real schema is clean', () => {
    const violations = ownerLeadingIndexViolations(process.cwd());
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T-INV-014b: catches an index that does not lead with ownerId', () => {
    plantSchema(
      [
        'model Title {',
        '  id      String @id',
        '  ownerId String',
        '  state   String',
        '  @@index([state, ownerId], map: "title_state_owner")',
        '}',
      ].join('\n'),
    );

    expect(ownerLeadingIndexViolations(root).join('\n')).toMatch(
      /title_state_owner" leads with state/,
    );
  });

  it('T-INV-014c: catches a table with no ownerId column at all', () => {
    // The more dangerous half of the rule. An index can only be owner-leading
    // if the column exists; a table without one cannot be owner-scoped by any
    // query, so a cross-owner read is not a bug there but the only option.
    plantSchema(['model Orphan {', '  id String @id', '}'].join('\n'));

    expect(ownerLeadingIndexViolations(root).join('\n')).toMatch(
      /model Orphan has no ownerId column/,
    );
  });

  it('T-INV-014d: checks @@unique constraints, not only @@index', () => {
    // A unique constraint is an index. One that does not lead with ownerId
    // enforces uniqueness ACROSS owners, which in a single-owner product looks
    // harmless right up until it is not.
    plantSchema(
      [
        'model Suppression {',
        '  id           String @id',
        '  ownerId      String',
        '  workIdentity String',
        '  @@unique([workIdentity], map: "uq_suppression_work")',
        '}',
      ].join('\n'),
    );

    expect(ownerLeadingIndexViolations(root).join('\n')).toMatch(
      /uq_suppression_work" leads with workIdentity/,
    );
  });

  it('T-INV-014e: the exemption list is an allow-list, not a pattern', () => {
    // A schema whose index merely LOOKS like a foreign-key index gets no
    // exemption. If exemption were inferred from shape, every future
    // single-column index would exempt itself and the rule would decay to
    // nothing without anyone editing it.
    plantSchema(
      [
        'model Title {',
        '  id      String @id',
        '  ownerId String',
        '  otherId String',
        '  @@index([otherId], map: "title_other")',
        '}',
      ].join('\n'),
    );

    expect(ownerLeadingIndexViolations(root).join('\n')).toMatch(/title_other" leads with otherId/);
  });

  it('T-INV-014f: every named exemption still refers to a real index', () => {
    // Non-vacuity for the narrowing itself. A name left behind after its index
    // was removed makes the allow-list look better justified than it is, and
    // silently pre-approves any future index that reuses the name.
    const stale = staleExemptions(process.cwd());
    expect(stale, `exemptions naming no index: ${stale.join(', ')}`).toEqual([]);
    expect(EXEMPT_INDEXES.size).toBe(12);
  });
});
