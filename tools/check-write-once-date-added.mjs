/**
 * `T-INV-006` — `dateAdded` is WRITE-ONCE (REQ-030, US-021 AC-6, TASK-035).
 *
 * `packages/domain/src/types.ts` states the rule: exactly one function may set
 * `dateAdded`, there is no `updateDateAdded`, and this gate greps for any
 * other assignment.
 *
 * WHY A STATIC GATE AND NOT ONLY A BEHAVIOURAL ONE
 * ------------------------------------------------
 * `dateAdded` is the owner's own history — *when they saved the title*. It is
 * not derived and it cannot be recomputed once overwritten, so a bug that
 * rewrites it is **silent and permanent**: the list still renders, every date
 * still looks plausible, and nothing anywhere reports an error. The only
 * moment such a bug is cheap to catch is the moment the write is added.
 *
 * ⚠ WHAT THIS GATE CAN AND CANNOT SEE — read before trusting it.
 * It reasons about SOURCE TEXT. It catches a literal assignment and a literal
 * `dateAdded` key in a non-create Prisma payload. It CANNOT see a value that
 * reaches an update through a spread of a variable
 * (`data: { ...patch }` where `patch` happens to carry `dateAdded`).
 * That residual case is covered behaviourally by `T-DATE-011` — the same
 * listing seen in a later batch keeps its original date. **Neither test
 * replaces the other**, and removing either leaves a real path open.
 *
 * Scope is the shipped SOURCE, not the tests. A test constructing a listing
 * with a chosen `dateAdded` is using the ALLOWED creation path, which is how
 * `T-DATE-010`/`T-DATE-013` seed their fixtures at all; scanning tests would
 * report those as violations and the gate would be neutered to silence them.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Shipped source only. Tests construct listings through the legal path. */
export const SOURCE_ROOTS = ['apps/api/src', 'packages/domain/src', 'apps/web/src'];

/**
 * The single function permitted to set `dateAdded`.
 *
 * ⚠ `specs/testing.md` §9 and `types.ts` both call it `createListing()`; the
 * implementation is `createServiceListing()`. Recorded as a naming drift
 * rather than silently "corrected" in the spec — see `specs/testing.md` §19.1.
 */
export const ALLOWED_WRITER = {
  file: join('apps', 'api', 'src', 'repository', 'ownerData.ts'),
  fn: 'createServiceListing',
};

/** Prisma calls that write to an EXISTING row. `create` is the legal path. */
export const MUTATING_PRISMA_CALLS = ['update', 'updateMany', 'upsert'];

/** Names that describe the forbidden operation, whatever their body does. */
export const FORBIDDEN_WRITER_NAMES = [
  'updateDateAdded',
  'setDateAdded',
  'rewriteDateAdded',
  'resetDateAdded',
  'overwriteDateAdded',
];

/**
 * `.dateAdded =` but never `.dateAddedEdited =` and never `.dateAdded ===`.
 *
 * The trailing `(?![A-Za-z0-9_])` is load-bearing: `dateAddedEdited` is a real
 * adjacent field (REQ-059) that IS legitimately assignable, so a looser prefix
 * match would fire on it and the gate would be relaxed to make it stop.
 */
const ASSIGNMENT_RE = /\.dateAdded(?![A-Za-z0-9_])\s*=(?!=)/;

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

/** Strip `//` and block comments so a commented-out example is not a finding. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * The 0-based line span of `functionName`'s body, by brace balance.
 * Returns `null` when the function is absent — the caller treats that as
 * "nothing is exempt", which fails closed if the function is ever renamed.
 */
function functionBodyRange(lines, functionName) {
  const startIdx = lines.findIndex((l) => new RegExp(`function\\s+${functionName}\\b`).test(l));
  if (startIdx === -1) return null;

  let depth = 0;
  let seenBrace = false;
  for (let i = startIdx; i < lines.length; i += 1) {
    for (const ch of lines[i] ?? '') {
      if (ch === '{') {
        depth += 1;
        seenBrace = true;
      } else if (ch === '}') depth -= 1;
    }
    if (seenBrace && depth <= 0) return [startIdx, i];
  }
  return [startIdx, lines.length - 1];
}

/** The balanced-paren argument text of `call(` starting at `fromIndex`. */
function callArguments(source, fromIndex) {
  const open = source.indexOf('(', fromIndex);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/**
 * Every place the shipped source writes `dateAdded` other than the one
 * permitted creation path. Returns human-readable strings; `[]` means clean.
 *
 * `root` is a parameter so the spec can point it at a scratch directory and
 * prove each rule catches what it claims. A checker that can only ever be run
 * against the real repository cannot be mutation-tested, and an untested
 * checker asserting a NEGATIVE is indistinguishable from a no-op.
 */
export function dateAddedWriteViolations(root = process.cwd()) {
  const violations = [];

  for (const sourceRoot of SOURCE_ROOTS) {
    for (const file of listFiles(join(root, sourceRoot))) {
      const rel = relative(root, file);
      const raw = readFileSync(file, 'utf8');
      const source = stripComments(raw);
      const lines = source.split('\n');

      const isAllowedFile = rel.split(sep).join(sep) === ALLOWED_WRITER.file;
      const exempt = isAllowedFile ? functionBodyRange(lines, ALLOWED_WRITER.fn) : null;
      const inExemptRange = (idx) => exempt !== null && idx >= exempt[0] && idx <= exempt[1];

      lines.forEach((line, idx) => {
        if (ASSIGNMENT_RE.test(line) && !inExemptRange(idx)) {
          violations.push(
            `${rel}:${idx + 1} assigns to .dateAdded outside ${ALLOWED_WRITER.fn}(): ${line.trim()}`,
          );
        }
        for (const name of FORBIDDEN_WRITER_NAMES) {
          if (new RegExp(`\\b${name}\\b`).test(line)) {
            violations.push(`${rel}:${idx + 1} declares or calls ${name}, which must not exist`);
          }
        }
      });

      for (const call of MUTATING_PRISMA_CALLS) {
        const re = new RegExp(`\\.${call}\\s*\\(`, 'g');
        let match;
        while ((match = re.exec(source)) !== null) {
          const args = callArguments(source, match.index);
          if (/\bdateAdded\b(?![A-Za-z0-9_])/.test(args)) {
            const lineNo = source.slice(0, match.index).split('\n').length;
            violations.push(
              `${rel}:${lineNo} passes dateAdded to a Prisma .${call}() — dateAdded is write-once`,
            );
          }
        }
      }
    }
  }

  return violations.sort();
}

if (process.argv[1] && process.argv[1].endsWith('check-write-once-date-added.mjs')) {
  const found = dateAddedWriteViolations();
  if (found.length > 0) {
    console.error('dateAdded is WRITE-ONCE (REQ-030). Offending writes:\n');
    for (const v of found) console.error(`  ${v}`);
    console.error('\nThe only legal write is createServiceListing(). There is no updateDateAdded.');
    process.exit(1);
  }
  console.log(`dateAdded write-once gate: clean (${SOURCE_ROOTS.join(', ')}).`);
}
