/**
 * `scripts/export-owner-data.ts` — the owner's own copy of everything
 * (TASK-131, `T-EXPORT-001`, OQ-025).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A NICE-TO-HAVE
 * ------------------------------------------------
 * REQ-028 is soft-delete forever: nothing in this application is ever hard
 * deleted, there is no TTL and there is no sweep. That makes the database
 * append-mostly and therefore **irreplaceable** — the row an owner cares about
 * is never re-derivable from anywhere else, because the screenshots it came
 * from are purged after 30 days (NFR-019).
 *
 * ⚠ AND THE PLATFORM SAFETY NET IS SMALLER THAN IT LOOKS. Azure SQL **Basic**
 * gives **7 days** of point-in-time restore, not the 35 the Rev-3 plan assumed
 * against PostgreSQL Flexible Server (A40 corrected this). A corruption or a
 * bad migration that goes unnoticed for a week is, at that point,
 * **unrecoverable via PITR**. PITR also lives inside the subscription: it does
 * not survive the subscription being lost, suspended, or deleted, and it is
 * not something the owner controls. So this export is the PRIMARY line of
 * defence rather than a belt-and-braces extra, and `docs/restore.md` is its
 * other half.
 *
 * ⚠ IT IS RUN BY A HUMAN, ALWAYS. There is no timer here, no cron, no queue
 * trigger and no Agent job. Product invariant 5 permits exactly three
 * non-owner processes and `T-CI-005` fails the build if a fourth appears — a
 * "helpful" weekly scheduler added to this file would be a REQ-041 violation,
 * not an improvement. `docs/restore.md` documents the weekly cadence as a
 * calendar reminder for the owner, which is the correct place for a habit that
 * a machine must not own.
 *
 * ⚠ IT NEVER DELETES AND NEVER WRITES TO THE DATABASE. Every statement below
 * is a `findMany`. A restore tool that can also destroy is a footgun pointed
 * at the one copy of the data, and the restore direction is deliberately
 * manual and documented rather than automated (`docs/restore.md`).
 *
 * WHY THE TABLE LIST IS DERIVED RATHER THAN WRITTEN DOWN
 * -----------------------------------------------------
 * The set of tables comes from Prisma's DMMF, not from an array in this file.
 * A hand-maintained list is the single most likely way this tool fails: it
 * would keep working, keep reporting success, and keep writing an artefact
 * that silently omits whichever table was added last — and the omission is
 * discovered at the only moment it cannot be fixed, during a restore.
 * `T-EXPORT-001` asserts the exported table set equals the model set, so
 * adding a model to `prisma/schema.prisma` without touching this file is safe
 * BY CONSTRUCTION, and forgetting to is caught by CI.
 *
 * ⚠ THE PLAIN PRISMA CLIENT, NOT THE APPLICATION'S DRIVER ADAPTER. This runs
 * on `DATABASE_URL` with a SQL login, exactly as `prisma migrate deploy`
 * already does in `.github/workflows/deploy.yml`, and for the same reason
 * `apps/api/src/db/connection.ts` gives for migrations: it is an
 * operator-invoked tool holding an operator's credential, it never runs inside
 * the container, and the running app therefore still holds no database
 * credential (`specs/security.md` §7). Nothing here is imported by
 * `apps/api/src/**`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';

/** Bumped only if the artefact's shape changes incompatibly. */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * A JSON-safe scalar. `bigint` and `Date` are NOT in this union on purpose —
 * see {@link encodeValue}.
 */
type JsonScalar = string | number | boolean | null;

export interface ExportedTable {
  /** The physical table name (`@@map`), which is what a restore addresses. */
  table: string;
  /**
   * Field name → Prisma scalar type, carried so a restore can coerce the
   * encoded strings back. Without it `"12345"` is ambiguous between a `String`
   * id and a `BigInt` that had to be stringified, and guessing wrong at
   * restore time is a silent corruption.
   */
  fieldTypes: Record<string, string>;
  rows: Record<string, JsonScalar>[];
}

export interface OwnerExport {
  formatVersion: number;
  exportedAt: string;
  ownerId: string;
  /** Table name → row count. The first thing a restore should check. */
  rowCounts: Record<string, number>;
  totalRows: number;
  tables: Record<string, ExportedTable>;
}

/**
 * Every model in the schema, in a stable order.
 *
 * Read from the DMMF at call time rather than captured at module load so a
 * test cannot accidentally assert against a stale snapshot.
 */
export function ownerModels(): readonly Prisma.DMMF.Model[] {
  return [...Prisma.dmmf.datamodel.models].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The Prisma client property for a model — `UploadBatch` → `uploadBatch`.
 *
 * Derived rather than mapped, for the same reason the table list is.
 */
function delegateName(model: Prisma.DMMF.Model): string {
  return model.name.charAt(0).toLowerCase() + model.name.slice(1);
}

/**
 * A deterministic ordering for a model's rows.
 *
 * ⚠ NOT ALWAYS `id`. `RemovalDecision` and `ServiceState` have composite
 * primary keys and no `id` column at all, and `BatchChange`/
 * `CandidateSourceImage` have `BigInt` ids. Ordering matters because two
 * exports of an unchanged database should diff clean — an owner comparing
 * last week's artefact with this week's is one of the few ways a silent
 * corruption gets noticed at all, and unordered output makes that diff
 * useless.
 */
function orderByFor(model: Prisma.DMMF.Model): Record<string, 'asc'>[] {
  const idField = model.fields.find((field) => field.isId);
  const keyFields = idField ? [idField.name] : (model.primaryKey?.fields ?? []);
  // Fall back to every scalar field: a model with neither is not something
  // this schema has, but silently returning unordered rows would be worse
  // than a slightly odd sort.
  const fields =
    keyFields.length > 0
      ? keyFields
      : model.fields.filter((field) => field.kind === 'scalar').map((field) => field.name);
  return fields.map((field) => ({ [field]: 'asc' as const }));
}

/**
 * Make one value safe to hand to `JSON.stringify`.
 *
 * ⚠ `JSON.stringify` THROWS ON `BigInt` — "Do not know how to serialize a
 * BigInt" — and this schema has four of them (`BatchChange.id`,
 * `CandidateSourceImage.id`, `UploadedImage.byteSize` and
 * `.uploadedByteSize`). Left unhandled the export does not produce a corrupt
 * artefact, it produces NO artefact, and it does so only once there is real
 * image data to export — that is, never on an empty developer database and
 * always on the owner's.
 *
 * Dates become ISO-8601 UTC strings. `Buffer`/`Uint8Array` is handled even
 * though the schema currently has no binary column, because the failure mode
 * if one is added is a silent `{"0":72,"1":105}` object rather than an error.
 */
function encodeValue(value: unknown): JsonScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  // Prisma `Decimal` and anything else object-shaped: stringify rather than
  // drop. Losing a column quietly is the failure this whole file is against.
  return String(value);
}

interface FindManyDelegate {
  findMany(args: {
    where: { ownerId: string };
    orderBy: Record<string, 'asc'>[];
  }): Promise<Record<string, unknown>[]>;
}

/**
 * Read every row this owner has, from every table.
 *
 * Takes the client as a parameter so the integration suite can run it against
 * the real test database with the harness's client, and so nothing here has to
 * reach for a connection of its own.
 */
export async function exportOwnerData(
  prisma: PrismaClient,
  ownerId: string,
  now: Date = new Date(),
): Promise<OwnerExport> {
  const tables: Record<string, ExportedTable> = {};
  const rowCounts: Record<string, number> = {};
  let totalRows = 0;

  for (const model of ownerModels()) {
    const table = model.dbName ?? model.name;
    const delegate = (prisma as unknown as Record<string, FindManyDelegate | undefined>)[
      delegateName(model)
    ];
    if (delegate === undefined) {
      // Unreachable with a generated client, but a thrown error beats an
      // artefact that is quietly missing a table.
      throw new Error(`No Prisma delegate for model ${model.name}; cannot export ${table}.`);
    }

    const rows = await delegate.findMany({
      // ⚠ EVERY read is owner-scoped, matching the repository convention that
      // `T-SEC-021` enforces on `apps/api/src/**`. This file is outside that
      // gate's scope, so the scoping is asserted directly by `T-EXPORT-001`.
      where: { ownerId },
      orderBy: orderByFor(model),
    });

    const fieldTypes: Record<string, string> = {};
    for (const field of model.fields) {
      if (field.kind === 'scalar') fieldTypes[field.name] = field.type;
    }

    tables[table] = {
      table,
      fieldTypes,
      rows: rows.map((row) => {
        const encoded: Record<string, JsonScalar> = {};
        for (const [key, value] of Object.entries(row)) encoded[key] = encodeValue(value);
        return encoded;
      }),
    };
    rowCounts[table] = rows.length;
    totalRows += rows.length;
  }

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    ownerId,
    rowCounts,
    totalRows,
    tables,
  };
}

export interface CliOptions {
  ownerId: string;
  outPath: string;
  allowEmpty: boolean;
}

/**
 * ⚠ `--allow-empty` EXISTS BECAUSE A TYPO IS THE LIKELIEST FAILURE.
 *
 * Owner ids are opaque hashes (`o_` + 16 hex characters). Mistype one and
 * every `findMany` matches nothing, the script succeeds, and it writes a
 * perfectly well-formed artefact containing zero rows. The owner then has a
 * backup that looks exactly like a real one — same shape, same table list,
 * plausible file — and discovers it is empty during a restore. Refusing by
 * default turns the worst outcome into an error message; the flag is there
 * because a genuinely empty database is legitimate on first run.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  let ownerId: string | undefined;
  let outPath: string | undefined;
  let allowEmpty = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--owner') {
      ownerId = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      outPath = argv[index + 1];
      index += 1;
    } else if (arg === '--allow-empty') {
      allowEmpty = true;
    } else {
      throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }

  if (ownerId === undefined || ownerId === '') {
    throw new Error('--owner <ownerId> is required. See docs/restore.md.');
  }
  if (outPath === undefined || outPath === '') {
    throw new Error('--out <file.json> is required. See docs/restore.md.');
  }
  return { ownerId, outPath, allowEmpty };
}

/** Serialise the artefact. Indented, because it is meant to be diffable. */
export function serialiseExport(data: OwnerExport): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  const prisma = new PrismaClient();
  try {
    const data = await exportOwnerData(prisma, options.ownerId);
    if (data.totalRows === 0 && !options.allowEmpty) {
      throw new Error(
        `Exported 0 rows for owner ${options.ownerId}. That is almost always a mistyped ` +
          `--owner. Re-run with --allow-empty if the database really is empty.`,
      );
    }

    const target = resolve(options.outPath);
    mkdirSync(dirname(target), { recursive: true });
    // ⚠ `wx`: refuse to overwrite. The one thing worse than having no backup
    // is overwriting a good one with a bad one, and this tool is reached for
    // precisely when something has already gone wrong.
    writeFileSync(target, serialiseExport(data), { encoding: 'utf8', flag: 'wx' });

    process.stdout.write(`Wrote ${target}\n`);
    for (const [table, count] of Object.entries(data.rowCounts)) {
      process.stdout.write(`  ${table}: ${String(count)}\n`);
    }
    process.stdout.write(`  TOTAL: ${String(data.totalRows)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only when invoked directly, so the integration suite can import this module
// without it trying to open a connection.
if (import.meta.url.endsWith('export-owner-data.js')) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
