/**
 * T-META-004 — every `it(...)` title in the suite starts with a `T-` test id,
 * and ids are unique.
 *
 * `specs/testing.md` §11: "Every test declares its id in its title so a CI
 * failure names the AC directly", e.g.
 *
 *   it('T-SUP-003 · US-028 AC-3 · a suppressed work that reappears creates nothing', ...)
 *
 * Why this is a lint rule and not a convention: a CI failure that says
 * "reconciliation test failed" costs a spelunking session; one that says
 * "T-REV-006 failed" names the acceptance criterion directly. The rule is the
 * only thing that keeps that property true as the suite grows.
 *
 * SCOPE — this rule sees one file at a time, so it enforces:
 *   1. the id prefix on every test title, and
 *   2. uniqueness WITHIN a file.
 * Cross-file uniqueness of SUFFIXED ids is enforced by `T-META-008`
 * (`tests/infra/testIdUniqueness.spec.ts`), and the AC->test mapping by
 * `T-META-001` (TASK-126), which parses the whole suite. All three are needed;
 * none subsumes the others.
 *
 * ⚠ Corrected in place, because this is a claim a reader acts on. It read:
 * ~~"Cross-file uniqueness and the AC->test mapping are enforced by
 * `T-META-001` (TASK-126), which parses the whole suite. Both halves are
 * needed; neither subsumes the other."~~ `T-META-001` maps ACs to test ids; it
 * has never checked that a suffixed id is used only once. So cross-file
 * uniqueness was documented as guaranteed, assigned to a named owner, and
 * enforced by nothing — and 65 collisions accumulated behind the guarantee,
 * including `T-AI-036b`, which names "issues both legs in parallel" in one
 * file and "a missing OCR leg is NOT degraded" in another.
 */

'use strict';

/**
 * `T-` + an UPPERCASE area + `-` + digits, with an OPTIONAL lowercase suffix.
 *
 * The suffix is not decoration: one acceptance criterion often needs several
 * cases (`T-SEC-009a` the clean tree, `T-SEC-009b` the caught violation), and
 * the specs already use the form — see `T-AI-010b` / `T-AI-011b` in
 * `specs/testing.md`. It is part of the captured id so that suffixed variants
 * count as DISTINCT ids; without it every case for one AC collides and the
 * uniqueness check would push authors into one giant test per criterion,
 * which is the opposite of "a failure names exactly one thing".
 *
 * e.g. T-SUP-003, T-E2E-001, T-INV-013, T-AI-010b
 *
 * ⚠ The suffix is up to TWO letters (`aa`, `ab`, …), not one. A one-letter
 * suffix caps a spec id at 26 cases, and `T-AI-033` is defined in
 * `specs/testing.md` as ONE suite spanning BOTH extraction adapters — it
 * exceeds 26 by design. With `[a-z]?` the overflow ids did not error as
 * unknown: `T-AI-033aa` matched as `T-AI-033a`, so every overflow case
 * silently collapsed onto one existing id and was reported as a DUPLICATE of
 * a test in a different file. The same single-optional-letter mistake lived in
 * `check-status.mjs`'s `TASK_RE` (`TASK-056b` → `TASK-056`); keep all seven of
 * these regexes in step.
 */
const TEST_ID = /^(T-[A-Z][A-Z0-9]*-\d+[a-z]{0,2})/;

/** Call names that declare a test case. `describe` blocks are deliberately exempt. */
const TEST_CALLERS = new Set(['it', 'test']);

/** True for `it.each(table)` / `test.each(table)` — the TABLE call. */
function isEachTableCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'each' &&
    node.callee.object.type === 'Identifier' &&
    TEST_CALLERS.has(node.callee.object.name)
  );
}

/** Modifiers that still declare a test: it.only, it.skip, it.each`...`, test.concurrent ... */
function isTestCall(node) {
  const callee = node.callee;

  if (callee.type === 'Identifier') {
    return TEST_CALLERS.has(callee.name);
  }

  // `it.each(table)(title, fn)` — the OUTER call is the test declaration and
  // carries the title; the inner `it.each(table)` carries the data. Before
  // this, the outer call (a CallExpression callee) matched nothing and the
  // inner one was reported as a dynamic title — so every table test failed
  // lint, which would push authors off the table tests
  // `specs/data-model.md` §2.2 makes MANDATORY.
  if (isEachTableCall(callee)) {
    return true;
  }

  // it.only(...) / it.skip(...) / it.concurrent(...)
  if (callee.type === 'MemberExpression') {
    // The table call itself declares no test; its title is on the outer call.
    if (isEachTableCall(node)) {
      return false;
    }

    let object = callee.object;
    // Unwrap it.each([...])(...) - the callee object is itself a CallExpression.
    while (object && object.type === 'CallExpression') {
      object = object.callee;
    }
    while (object && object.type === 'MemberExpression') {
      object = object.object;
    }
    return Boolean(object) && object.type === 'Identifier' && TEST_CALLERS.has(object.name);
  }

  return false;
}

/** Returns the literal title string, or null when it is not statically knowable. */
function staticTitle(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked).join('');
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every test title to start with a unique T- test id (T-META-004, specs/testing.md section 11).',
      recommended: true,
    },
    schema: [],
    messages: {
      missingId:
        "Test title must start with a T- test id, e.g. it('T-SUP-003 - US-028 AC-3 - ...'). Got: {{title}} (T-META-004, specs/testing.md section 11).",
      dynamicTitle:
        'Test title must be a static string so its T- id can be verified. Computed titles hide the id from CI (T-META-004).',
      duplicateId:
        'Duplicate test id {{id}} - already used on line {{line}} of this file. Test ids must be unique so a failure names exactly one acceptance criterion (T-META-004).',
    },
  },

  create(context) {
    /** @type {Map<string, number>} id -> line of first use, per file */
    const seen = new Map();

    return {
      CallExpression(node) {
        if (!isTestCall(node)) return;

        const first = node.arguments[0];
        if (!first) return;

        const title = staticTitle(first);
        if (title === null) {
          context.report({ node: first, messageId: 'dynamicTitle' });
          return;
        }

        const match = TEST_ID.exec(title);
        if (!match) {
          context.report({
            node: first,
            messageId: 'missingId',
            data: { title: JSON.stringify(title) },
          });
          return;
        }

        const id = match[1];
        const previous = seen.get(id);
        if (previous !== undefined) {
          context.report({
            node: first,
            messageId: 'duplicateId',
            data: { id, line: String(previous) },
          });
          return;
        }
        seen.set(id, node.loc.start.line);
      },
    };
  },
};
