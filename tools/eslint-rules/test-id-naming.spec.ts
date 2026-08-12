/**
 * Tests for the T-META-004 test-id naming rule (TASK-002).
 *
 * TASK-002's exit criterion is "T-META-004 passes on an intentionally
 * mis-named test" — i.e. the rule must actually FIRE on a bad title rather
 * than merely exist. The `invalid` cases below are those intentionally
 * mis-named tests.
 *
 * This file deliberately contains no literal `it(...)` calls of its own:
 * ESLint's RuleTester generates them at runtime from the cases below.
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from '../eslint-rules/test-id-naming.js';

// RuleTester defaults to whatever `describe`/`it` are global. Vitest only
// exposes those when `globals: true`, which the unit project does NOT set, so
// bind them explicitly — otherwise RuleTester silently runs every case inline
// and vitest reports "no tests found" while the assertions never ran.
RuleTester.describe = describe;
RuleTester.it = it;

// ESLint 10 accepts only flat-config keys here; the eslintrc-era
// `parserOptions` is now a hard error ("eslintrc-incompat"), not a silently
// ignored option.
const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('T-META-004 · test titles carry a unique T- id', () => {
  ruleTester.run('test-id-naming', rule, {
    valid: [
      // The canonical form from specs/testing.md §11.
      "it('T-SUP-003 · US-028 AC-3 · a suppressed work that reappears creates nothing', () => {});",
      // Other real id shapes used across the suite.
      "it('T-E2E-001 · the value loop', () => {});",
      "it('T-INV-013 · no TTL anywhere', async () => {});",
      "test('T-MIG-001 · destructive migrations are refused', () => {});",
      // Modifiers still count as tests and still pass when named.
      "it.skip('T-PERF-001 · index seek on the removed view', () => {});",
      "it.only('T-REV-006 · full update shows all extracted titles', () => {});",
      "it.concurrent('T-IMG-017 · pre-decode pixel guard', () => {});",
      // Static template literal is fine — the id is still visible to CI.
      'it(`T-PASTE-010 · upload path is not displaced`, () => {});',
      // A lowercase suffix distinguishes several cases for ONE acceptance
      // criterion (the specs use it too: T-AI-010b). Suffixed variants are
      // distinct ids, so they may sit in the same file.
      "it('T-SEC-009a · the clean tree', () => {});\nit('T-SEC-009b · the caught violation', () => {});",
      // describe() is exempt: only test cases must carry ids.
      "describe('uploads', () => {});",
      // Distinct ids in one file are fine.
      "it('T-INV-001 · one visible title per work', () => {});\nit('T-INV-002 · one listing per service', () => {});",
      // Not a test call at all.
      "somethingElse('no id here', () => {});",
      // A table test: `it.each(table)` is the TABLE call — its first argument
      // is the data, not a title — and the title lives on the call it returns.
      // `specs/data-model.md` §2.2 makes a table test MANDATORY for T-DM-001,
      // so a rule that rejected the form would push authors off the spec.
      "it.each(CASES)('T-DM-001 · %j → %j', (input, expected) => {});",
      "it.each([[1, 2]])('T-DM-001 · %i', (a, b) => {});",
    ],

    invalid: [
      // A table test is still held to the id rule on the title it DOES have —
      // exempting the table call must not exempt the test.
      {
        code: "it.each(CASES)('normalises text', (a) => {});",
        errors: [{ messageId: 'missingId' }],
      },
      {
        code: 'it.each(CASES)(titleVar, (a) => {});',
        errors: [{ messageId: 'dynamicTitle' }],
      },
      // The intentionally mis-named test TASK-002 names as the exit criterion.
      {
        code: "it('reconciles removals correctly', () => {});",
        errors: [{ messageId: 'missingId' }],
      },
      // Lowercase / malformed ids are not ids.
      {
        code: "it('t-sup-003 · lowercase is not an id', () => {});",
        errors: [{ messageId: 'missingId' }],
      },
      {
        code: "it('TSUP003 · no separators', () => {});",
        errors: [{ messageId: 'missingId' }],
      },
      {
        code: "it('T-SUP · no number', () => {});",
        errors: [{ messageId: 'missingId' }],
      },
      // An id must be at the START — a trailing mention does not name the failure.
      {
        code: "it('suppression works, see T-SUP-003', () => {});",
        errors: [{ messageId: 'missingId' }],
      },
      // Modifiers are not an escape hatch.
      {
        code: "it.skip('unnamed and skipped', () => {});",
        errors: [{ messageId: 'missingId' }],
      },
      {
        code: "test('unnamed via test()', () => {});",
        errors: [{ messageId: 'missingId' }],
      },
      // A computed title hides the id from CI output.
      {
        code: 'it(titleFor(ac), () => {});',
        errors: [{ messageId: 'dynamicTitle' }],
      },
      {
        code: 'it(`T-SUP-${n} · interpolated`, () => {});',
        errors: [{ messageId: 'dynamicTitle' }],
      },
      // Duplicate ids: a failure would name two acceptance criteria at once.
      {
        code: "it('T-SUP-003 · first', () => {});\nit('T-SUP-003 · second', () => {});",
        errors: [{ messageId: 'duplicateId', data: { id: 'T-SUP-003', line: '1' } }],
      },
    ],
  });
});
