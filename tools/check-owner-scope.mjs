/**
 * `T-SEC-021` — every Prisma call in the repository is owner-scoped.
 *
 * WHY THIS TEST EXISTS AT ALL
 * ---------------------------
 * `specs/security.md` §3 (R3) is blunt about what the move from Cosmos to
 * Azure SQL cost. Under Cosmos, `ownerId` was the partition key and a
 * cross-owner read was *inexpressible*. On Azure SQL it is an ordinary column,
 * so a query missing its `WHERE` clause returns another owner's rows at full
 * speed, with no error and nothing in the log. The failure has no symptom.
 *
 * The spec names this test as mandatory compensating control #3 and states it
 * is load-bearing, not belt-and-braces: weakening, skipping or deleting it is a
 * blocking review finding.
 *
 * WHY IT PARSES RATHER THAN GREPS
 * -------------------------------
 * `specs/security.md` says "greps ... for any Prisma call whose `where` clause
 * omits `ownerId`". A literal grep cannot do that. `where: { ownerId, id }`
 * and `where: { id }` are both just text, and matching braces with a regular
 * expression across a nested `where: { OR: [{ ... }] }` is exactly the sort of
 * thing that appears to work and then quietly stops. This walks the TypeScript
 * AST instead, which is the same check done correctly.
 *
 * THE THREE RULES
 * ---------------
 * 1. Unique-selector methods are BANNED outright. `findUnique`, `update`,
 *    `delete` and `upsert` accept only a unique selector, so they physically
 *    cannot carry `ownerId` alongside a primary key — the type system rejects
 *    it. Their owner-scoped equivalents are `findFirst`, `updateMany` and
 *    `deleteMany`. Banning them is what stops the whole class of bug rather
 *    than catching instances of it.
 * 2. A read/write call must have a `where`, and that `where` must mention
 *    `ownerId` at its top level. Nested only — inside an `OR`, say — does not
 *    count, because an `OR` branch widens the result set rather than narrowing
 *    it.
 * 3. A create must set `ownerId` in its `data`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const REPOSITORY_DIR = 'apps/api/src/repository';

/**
 * Methods that take a unique selector and therefore CANNOT be owner-scoped.
 *
 * `upsert` is here for a second reason as well: TASK-017 requires the upsert
 * path be an explicit UPDATE-then-INSERT-if-zero-rows, never a `MERGE`, and
 * Prisma's `upsert()` compiles to the form with SQL Server's documented
 * concurrency defects.
 */
export const UNIQUE_SELECTOR_METHODS = Object.freeze([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

/** Methods that must carry a `where` naming `ownerId`. */
export const WHERE_METHODS = Object.freeze([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'updateMany',
  'deleteMany',
  'count',
  'aggregate',
]);

/** Methods that must set `ownerId` in `data`. */
export const CREATE_METHODS = Object.freeze(['create', 'createMany']);

const ALL_METHODS = new Set([...UNIQUE_SELECTOR_METHODS, ...WHERE_METHODS, ...CREATE_METHODS]);

export function repositoryFiles(root = ROOT) {
  const dir = path.join(root, REPOSITORY_DIR);
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Does this object literal bind `ownerId` at its TOP level?
 *
 * Accepts shorthand (`{ ownerId }`), longhand (`{ ownerId: x }`) and a spread
 * of something whose name ends in `ownerId`. A spread of an opaque object is
 * NOT accepted: `{ ...filter }` could contain anything, and treating it as
 * proof would let any violation through behind one variable.
 */
function bindsOwnerId(node) {
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((p) => {
    if (ts.isShorthandPropertyAssignment(p)) return p.name.text === 'ownerId';
    if (ts.isPropertyAssignment(p)) return p.name.getText() === 'ownerId';
    if (ts.isSpreadAssignment(p)) return /ownerId$/.test(p.expression.getText());
    return false;
  });
}

function propertyNamed(node, name) {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  for (const p of node.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
  }
  return undefined;
}

/**
 * @returns {{file: string, line: number, method: string, reason: string}[]}
 */
export function ownerScopeViolations(files = repositoryFiles()) {
  const violations = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);

    const report = (node, method, reason) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push({ file: rel, line: line + 1, method, reason });
    };

    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;

        // `x.model.method(...)` — the receiver must itself be a property
        // access, which is what distinguishes a Prisma model call from an
        // ordinary `array.count()` or a local helper.
        const isModelCall = ts.isPropertyAccessExpression(node.expression.expression);

        if (isModelCall && ALL_METHODS.has(method)) {
          if (UNIQUE_SELECTOR_METHODS.includes(method)) {
            report(
              node,
              method,
              `\`${method}\` takes a unique selector and cannot carry ownerId. ` +
                'Use findFirst / updateMany / deleteMany, or an explicit ' +
                'UPDATE-then-INSERT for upsert (TASK-017 forbids MERGE).',
            );
          } else if (WHERE_METHODS.includes(method)) {
            const arg = node.arguments[0];
            const where = arg ? propertyNamed(arg, 'where') : undefined;
            if (!where) {
              report(node, method, `\`${method}\` has no \`where\` clause, so it is unscoped.`);
            } else if (!bindsOwnerId(where)) {
              report(
                node,
                method,
                `\`${method}\` has a \`where\` that does not bind ownerId at its top level.`,
              );
            }
          } else {
            const arg = node.arguments[0];
            const data = arg ? propertyNamed(arg, 'data') : undefined;
            if (!data || !bindsOwnerId(data)) {
              report(node, method, `\`${method}\` does not set ownerId in \`data\`.`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  return violations;
}

export function formatViolations(violations) {
  return [
    `${violations.length} un-scoped Prisma call(s) in ${REPOSITORY_DIR}:`,
    ...violations.map((v) => `  - ${v.file}:${v.line} ${v.reason}`),
    '',
    'On Azure SQL, owner_id is an ordinary column: a query that omits it returns',
    "ANOTHER OWNER'S ROWS at full speed, with no error and nothing in the log.",
    'See specs/security.md section 3 (R3), compensating control 3.',
  ].join('\n');
}

function main() {
  const violations = ownerScopeViolations();
  if (violations.length > 0) {
    console.error(formatViolations(violations));
    process.exit(1);
  }
  console.log(
    `Owner-scope check passed: every Prisma call in ${REPOSITORY_DIR} is scoped to ownerId.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
