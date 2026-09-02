/**
 * `T-INV-016` — a non-empty `title.duplicate_ack_seq` is written in
 * `routes/fixMatch.ts` and `routes/listings.ts`, and **nowhere else**
 * (`specs/data-model.md` §16.4).
 *
 * WHY THE RULE EXISTS
 * -------------------
 * `duplicate_ack_seq` is the third column of the filtered unique index
 * `title_one_active_per_work`, keyed on `(owner, work_identity, dup_ack_seq)`.
 * Every ordinary title carries `''`, so the index holds "one active title per
 * work". The two writers set the title's OWN id instead, which is how a
 * deliberately acknowledged duplicate is allowed to sit beside the existing
 * active row without the index firing.
 *
 * That makes a stray write catastrophic in a quiet way: any third site that
 * sets a non-empty value hands out a permanent exemption from the product's
 * one-active-title-per-work rule, and nothing fails. The list simply starts
 * showing two rows for one work, which looks like a de-duplication bug rather
 * than an index bug, and the rows are real data that cannot be merged back.
 *
 * ⚠ THIS RULE HAS BEEN WRONG TWICE. Its first form grepped for a `dup:`
 * work-identity prefix that appears nowhere in the codebase — it passed
 * vacuously. Its second form named `createTitleAllowingDuplicate()`, a
 * function that has never existed; it could not be implemented at all,
 * because **both** real writers are `updateTitle()` calls on titles that
 * already exist. So this checker is written to be run against PLANTED
 * violations as well as against the real tree — see
 * `tests/infra/duplicateAckWriters.spec.ts`. A checker for a negative that is
 * only ever run against a clean repository is indistinguishable from a no-op,
 * which is exactly how the first form survived.
 *
 * ⚠ SCOPE IS FILE-LEVEL, and deliberately so. The rule names call sites, not
 * functions, because the two writers are route handlers rather than named
 * helpers — there is no function to point at. File-level is therefore the
 * tightest granularity the rule can honestly claim.
 *
 * ⚠ EMPTY WRITES ARE NOT VIOLATIONS. The rule is about a **non-empty** value;
 * writing `''` restores the ordinary state and is what the column defaults to.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Shipped source only. Tests legitimately construct titles with a value set. */
export const SOURCE_ROOTS = ['apps/api/src', 'packages/domain/src', 'apps/web/src'];

/**
 * The only two files permitted to write a non-empty `duplicateAckSeq`.
 *
 * Stored with forward slashes and compared against a normalised path so the
 * gate behaves identically on Windows and on the Linux CI runner.
 */
export const ALLOWED_WRITERS = [
  'apps/api/src/routes/fixMatch.ts',
  'apps/api/src/routes/listings.ts',
];

/** The field, as it is spelled in application source (Prisma camel-cases it). */
export const FIELD = 'duplicateAckSeq';

/**
 * A TYPE annotation rather than a write: `duplicateAckSeq: string;`,
 * `duplicateAckSeq?: string | null`, `let duplicateAckSeq: string | undefined;`.
 *
 * These are how `packages/domain` declares the field at all, so treating them
 * as writes would make the gate fire on the type definitions and it would be
 * relaxed to silence them. Anything that is NOT one of these and NOT an empty
 * string is treated as supplying a value — the gate fails CLOSED, so a write
 * through a shape this checker has never seen is a violation rather than a
 * blind spot.
 */
const TYPE_DECL_RE = new RegExp(
  `\\b${FIELD}\\??\\s*:\\s*(string|number|Date|boolean)(\\s*\\|\\s*(null|undefined|string))*\\s*[;,]?\\s*$`,
);

/** An explicit empty write, which the rule does not cover. */
const EMPTY_WRITE_RE = new RegExp(`\\b${FIELD}\\s*:\\s*(''|""|\`\`)`);

function listFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('dist-')) continue;
      listFiles(full, out);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip `//` and block comments so prose describing the rule is not a finding. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every place the shipped source writes a non-empty `duplicateAckSeq` outside
 * the two permitted files. Returns human-readable strings; `[]` means clean.
 *
 * `root` is a parameter so the spec can point it at a scratch tree and prove
 * each rule catches what it claims.
 */
export function duplicateAckWriteViolations(root = process.cwd()) {
  const violations = [];
  const allowed = new Set(ALLOWED_WRITERS);

  for (const sourceRoot of SOURCE_ROOTS) {
    for (const file of listFiles(join(root, sourceRoot))) {
      const rel = relative(root, file).split('\\').join('/');
      if (allowed.has(rel)) continue;

      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');

      lines.forEach((line, idx) => {
        if (!new RegExp(`\\b${FIELD}\\b`).test(line)) return;
        if (TYPE_DECL_RE.test(line.trim())) return;
        if (EMPTY_WRITE_RE.test(line)) return;

        violations.push(
          `${rel}:${idx + 1} writes ${FIELD} outside ${ALLOWED_WRITERS.join(' and ')}: ${line.trim()}`,
        );
      });
    }
  }

  return violations.sort();
}

if (process.argv[1] && process.argv[1].endsWith('check-duplicate-ack-writers.mjs')) {
  const found = duplicateAckWriteViolations();
  if (found.length > 0) {
    console.error('A non-empty duplicate_ack_seq may only be written by the two route handlers.');
    console.error('Offending writes:\n');
    for (const v of found) console.error(`  ${v}`);
    console.error(
      '\nA third writer hands out a permanent exemption from title_one_active_per_work.',
    );
    process.exit(1);
  }
  console.log(`duplicate_ack_seq writer gate: clean (${SOURCE_ROOTS.join(', ')}).`);
}
