// T-MIG-001 — the destructive-migration gate (TASK-144).
//
// REQ-028 says data is never lost. A migration is the ONE place it can be lost
// quietly and irreversibly, and Prisma will happily generate `DROP COLUMN`
// from a field rename — a diff that looks like a rename and behaves like a
// deletion. `specs/testing.md` §11.2 calls this "the highest-value single test
// added this revision". It is deliberately a blunt textual gate: subtle is
// worthless here.
//
// The T-SQL grep set is `specs/testing.md` §11-R4.2 (there is no `DROP TYPE`
// in SQL Server — enums are CHECK constraints), extended with the two further
// forms `.github/copilot-instructions.md` names: `DROP CONSTRAINT` and an
// `sp_rename` column rename. A dropped constraint silently repeals an
// invariant the database was enforcing; `sp_rename` on a column is a rename
// that orphans every reader of the old name.
//
// No general escape hatch. The owner authorized ONLY 0012's three service
// CHECK replacements after this gate was raised. Its exact path and full SQL
// hash are pinned below; changing that approval requires another visible diff.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SERVICE_EXPANSION_PATH = 'prisma/migrations/0012_expand_services/migration.sql';
// Normalize CRLF only, not whitespace/comments/literals: none may hide added SQL.
const SERVICE_EXPANSION_SHA256 = '7c357e70ae71ffa2d703aeb60ae271d6cebfebcd1b322f36fbdcb9eb9312bdb5';
const SERVICE_CONSTRAINT_DROPS = new Set([
  'ALTER TABLE [dbo].[upload_batch] DROP CONSTRAINT [ck_batch_service];',
  'ALTER TABLE [dbo].[service_listing] DROP CONSTRAINT [ck_listing_service];',
  'ALTER TABLE [dbo].[service_state] DROP CONSTRAINT [ck_state_service];',
]);

/** Statements that destroy data or repeal an enforced invariant. */
export const DESTRUCTIVE_PATTERNS = [
  {
    name: 'DROP TABLE',
    // `IF EXISTS` and bracket-quoted identifiers are the usual generated forms.
    pattern: /\bDROP\s+TABLE\b/i,
    why: 'destroys every row in the table',
  },
  {
    name: 'ALTER TABLE ... DROP COLUMN',
    pattern: /\bDROP\s+COLUMN\b/i,
    why: 'destroys one column of every row; Prisma generates this from a field rename',
  },
  {
    name: 'TRUNCATE TABLE',
    pattern: /\bTRUNCATE\s+TABLE\b/i,
    why: 'destroys every row without so much as a WHERE clause',
  },
  {
    name: 'DROP INDEX',
    pattern: /\bDROP\s+INDEX\b/i,
    why: 'repeals a filtered unique index, and those indexes ARE the invariants (data-model.md §16.4)',
  },
  {
    name: 'DROP CONSTRAINT',
    pattern: /\bDROP\s+CONSTRAINT\b/i,
    why: 'repeals a CHECK or UNIQUE constraint the database was enforcing',
  },
  {
    name: "sp_rename ... 'COLUMN'",
    pattern: /\bsp_rename\b[\s\S]{0,200}?['"]COLUMN['"]/i,
    why: 'renames a column, orphaning every reader of the old name',
  },
  {
    // Not destructive — this one destroys the DEPLOY. `GO` is a sqlcmd batch
    // separator, not T-SQL, and Prisma hands the file straight to the driver,
    // which fails with "Incorrect syntax near 'GO'". Verified by running
    // `prisma migrate deploy` against mssql/server:2022-latest.
    //
    // It is an easy thing to reach for, because every SQL Server example on
    // the web is written for sqlcmd or SSMS, where it works. The consequence
    // here is a half-applied migration recorded as FAILED, which then blocks
    // every later migration until someone runs `migrate resolve` by hand.
    // Use `EXEC('...')` for the deferred-compilation the batch boundary was
    // wanted for.
    name: 'GO batch separator',
    pattern: /^[ \t]*GO[ \t]*$/im,
    why: 'is sqlcmd syntax, not T-SQL; Prisma sends the file to the driver and the migration fails to apply',
  },
] as const;

export interface MigrationViolation {
  file: string;
  line: number;
  statement: string;
  text: string;
  why: string;
}

/**
 * Strip SQL comments so a destructive statement quoted in a comment does not
 * fail the build — and, far more importantly, so a real one cannot be smuggled
 * past the gate by the reverse trick.
 */
function stripComments(sql: string): string {
  // Block comments first; then line comments. Replace with spaces rather than
  // nothing so line numbers survive.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

function collectSqlFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // No migrations directory yet (pre-TASK-017). The gate passes vacuously —
    // and `T-MIG-001c` proves it would not pass a real violation.
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSqlFiles(full));
    } else if (entry.toLowerCase().endsWith('.sql')) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Scan one migration's SQL text. Exported so tests can feed it violations. */
export function scanSql(file: string, sql: string): MigrationViolation[] {
  const violations: MigrationViolation[] = [];
  const isServiceExpansion = file.replace(/\\/g, '/') === SERVICE_EXPANSION_PATH;
  const approvedServiceExpansion =
    isServiceExpansion &&
    createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') ===
      SERVICE_EXPANSION_SHA256;
  if (isServiceExpansion && !approvedServiceExpansion) {
    violations.push({
      file,
      line: 1,
      statement: 'Unapproved service expansion SQL',
      text: 'The complete migration must match its owner-authorized SHA-256.',
      why: 'only the immutable 0012 service CHECK replacement is authorized; no other SQL is exempt',
    });
  }

  const uncommented = stripComments(sql);
  for (const { name, pattern, why } of DESTRUCTIVE_PATTERNS) {
    // Scan the whole file so splitting DROP and CONSTRAINT across lines
    // cannot bypass the general prohibition outside the pinned exception.
    for (const match of uncommented.matchAll(new RegExp(pattern, `${pattern.flags}g`))) {
      const line = uncommented.slice(0, match.index).split('\n').length;
      const text = uncommented.split(/\r?\n/)[line - 1]?.trim() ?? '';
      if (
        approvedServiceExpansion &&
        name === 'DROP CONSTRAINT' &&
        SERVICE_CONSTRAINT_DROPS.has(text)
      ) {
        continue;
      }
      violations.push({ file, line, statement: name, text, why });
    }
  }

  return violations.sort((a, b) => a.line - b.line);
}

/** Scan every migration under `prisma/migrations/**`. */
export function checkMigrations(root = process.cwd()): MigrationViolation[] {
  const dir = path.join(root, 'prisma', 'migrations');
  return collectSqlFiles(dir).flatMap((file) =>
    scanSql(path.relative(root, file), readFileSync(file, 'utf8')),
  );
}

export function formatViolations(violations: MigrationViolation[]): string {
  return [
    'T-MIG-001 — destructive migration blocked (REQ-028: data is never lost).',
    '',
    ...violations.map(
      (v) => `  ${v.file}:${v.line}  ${v.statement}\n    ${v.text}\n    ↳ ${v.why}`,
    ),
    '',
    'A destructive migration is an owner decision, made in the open. If the data',
    'genuinely must go, say so explicitly in the PR and change this gate in the',
    'same commit — do not work around it.',
  ].join('\n');
}
