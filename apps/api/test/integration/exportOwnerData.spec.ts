/**
 * TASK-131 — `scripts/export-owner-data.ts`, the owner's own copy of
 * everything (`T-EXPORT-001`, OQ-025).
 *
 * ⚠ THESE RUN AGAINST THE REAL DATABASE, AND THEY HAVE TO. The three
 * properties that matter — that every table is reached, that owner scoping
 * holds, and that the artefact actually survives `JSON.stringify` — are all
 * properties of the real schema and the real client. A mocked Prisma would
 * return whatever the test seeded through it and agree that every table was
 * covered, including the one the script forgot.
 *
 * `T-EXPORT-001` (`specs/testing.md` §12): the script writes every owner row to
 * a restorable artefact, is never scheduled, and never deletes — with
 * `docs/restore.md` documenting the 7-day PITR and BACPAC paths.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EXPORT_FORMAT_VERSION,
  exportOwnerData,
  ownerModels,
  parseArgs,
  serialiseExport,
} from '../../../../scripts/export-owner-data.js';
import {
  OWNER_A,
  OWNER_B,
  batchInput,
  closeTestPrisma,
  id,
  listingInput,
  resetDatabase,
  testPrisma,
  titleInput,
} from './harness.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const SCRIPT_SOURCE = readFileSync(resolve(REPO_ROOT, 'scripts/export-owner-data.ts'), 'utf8');
const RUNBOOK = readFileSync(resolve(REPO_ROOT, 'docs/restore.md'), 'utf8');

const db = testPrisma();

/**
 * Seed one owner with a batch, a title, a listing and an image.
 *
 * The image matters more than it looks: `byteSize` is a `BigInt`, and a
 * `BigInt` anywhere in the artefact is what makes `JSON.stringify` throw. A
 * fixture without one lets the serialisation case pass vacuously.
 */
async function seedOwner(ownerId: typeof OWNER_A): Promise<{ batchId: string; titleId: string }> {
  const batch = batchInput({ status: 'applied' });
  await db.uploadBatch.create({ data: { ...batch, ownerId } });
  const title = titleInput();
  await db.title.create({ data: { ...title, ownerId, createdByBatchId: batch.id } });
  await db.serviceListing.create({
    data: { ...listingInput(title.id, batch.id), ownerId },
  });
  await db.uploadedImage.create({
    data: {
      id: id('img'),
      ownerId,
      batchId: batch.id,
      blobPath: `${ownerId}/shot.png`,
      fileName: 'shot.png',
      ingestSource: 'upload',
      uploadedFormat: 'png',
      format: 'png',
      byteSize: BigInt(2048),
      uploadedByteSize: BigInt(2048),
      width: 1170,
      height: 2532,
      uploadedAt: new Date('2026-08-01T09:00:00.000Z'),
      retainUntil: new Date('2026-08-31T09:00:00.000Z'),
    },
  });
  return { batchId: batch.id, titleId: title.id };
}

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-EXPORT-001 — every owner row reaches the artefact', () => {
  it('T-EXPORT-001a: the exported table set is EVERY model, derived from the schema', async () => {
    const data = await exportOwnerData(db, OWNER_A);

    const expected = ownerModels()
      .map((model) => model.dbName ?? model.name)
      .sort();
    expect(Object.keys(data.tables).sort()).toEqual(expected);
    expect(Object.keys(data.rowCounts).sort()).toEqual(expected);

    // ⚠ AND THE MODEL SET IS NOT EMPTY OR TRUNCATED. Without this the case
    // above is satisfied by an export of nothing compared against a model list
    // of nothing — both sides derive from the same source, so a DMMF that
    // failed to load would agree with itself.
    expect(expected.length).toBe(11);
    expect(expected).toContain('upload_batch');
    expect(expected).toContain('suppression');
    expect(expected).toContain('removal_decision');
    expect(expected).toContain('service_state');
  });

  it('T-EXPORT-001b: a table added to the schema is exported without touching the script', async () => {
    // The guarantee is structural, so this asserts the structure rather than
    // the outcome: nothing in the script names a table. A hand-maintained
    // array is the one way this tool fails silently — it keeps succeeding
    // while omitting whichever table was added last, and the omission is
    // discovered during a restore, which is the only moment it cannot be
    // fixed.
    //
    // ⚠ BOTH NAMES, AND THE MODEL NAME WAS THE MISS. The first draft rejected
    // only physical table names (`upload_batch`), and a mutant that hard-coded
    // the list using Prisma MODEL names (`UploadBatch`) walked straight past
    // it — which is the form anyone would actually write, since `ownerModels`
    // returns models. Only `T-EXPORT-001a` caught it, and 001a fails for any
    // omission at all, so this case was contributing nothing.
    for (const model of ownerModels()) {
      for (const name of [model.dbName ?? model.name, model.name]) {
        expect(SCRIPT_SOURCE).not.toContain(`'${name}'`);
        expect(SCRIPT_SOURCE).not.toContain(`"${name}"`);
      }
    }
  });

  it('T-EXPORT-001c: rows are exported, and BigInt and Date survive JSON', async () => {
    const seeded = await seedOwner(OWNER_A);
    const data = await exportOwnerData(db, OWNER_A, new Date('2026-09-01T00:00:00.000Z'));

    expect(data.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(data.exportedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(data.ownerId).toBe(OWNER_A);
    expect(data.rowCounts['upload_batch']).toBe(1);
    expect(data.rowCounts['title']).toBe(1);
    expect(data.rowCounts['service_listing']).toBe(1);
    expect(data.rowCounts['uploaded_image']).toBe(1);
    expect(data.totalRows).toBe(4);

    const batchRow = data.tables['upload_batch']?.rows[0];
    expect(batchRow?.['id']).toBe(seeded.batchId);

    // ⚠ THE WHOLE ARTEFACT MUST SERIALISE. `JSON.stringify` THROWS on a
    // `BigInt` — "Do not know how to serialize a BigInt" — and
    // `uploaded_image.byteSize` is one. Unhandled, the export produces no file
    // at all, and it does so only once there is real image data: never on an
    // empty developer database, always on the owner's.
    const text = serialiseExport(data);
    const round = JSON.parse(text) as typeof data;

    const image = round.tables['uploaded_image']?.rows[0];
    expect(image?.['byteSize']).toBe('2048');
    expect(image?.['uploadedAt']).toBe('2026-08-01T09:00:00.000Z');
    // The types travel with the data, so a restore can tell an encoded BigInt
    // from a String id that happens to be digits.
    expect(data.tables['uploaded_image']?.fieldTypes['byteSize']).toBe('BigInt');
    expect(data.tables['uploaded_image']?.fieldTypes['uploadedAt']).toBe('DateTime');
    expect(data.tables['upload_batch']?.fieldTypes['id']).toBe('String');
  });

  it("T-EXPORT-001d: the export is owner-scoped and contains no other owner's rows", async () => {
    await seedOwner(OWNER_A);
    await seedOwner(OWNER_B);

    const data = await exportOwnerData(db, OWNER_A);
    expect(data.totalRows).toBe(4);

    // Nowhere in the artefact — not in a row, not in a blob path.
    const text = serialiseExport(data);
    expect(text).not.toContain(OWNER_B);
    for (const table of Object.values(data.tables)) {
      for (const row of table.rows) {
        expect(row['ownerId']).toBe(OWNER_A);
      }
    }
  });

  it('T-EXPORT-001e: rows come back in ascending key order, so two exports diff clean', async () => {
    await seedOwner(OWNER_A);
    await seedOwner(OWNER_A);
    await seedOwner(OWNER_A);

    const first = await exportOwnerData(db, OWNER_A, new Date('2026-09-01T00:00:00.000Z'));
    const second = await exportOwnerData(db, OWNER_A, new Date('2026-09-01T00:00:00.000Z'));

    // Comparing last week's artefact with this week's is one of the very few
    // ways a silent corruption gets noticed at all — and REQ-028 means a
    // falling row count is always a defect, never a change the owner made.
    // Unordered output makes that diff useless.
    expect(serialiseExport(second)).toBe(serialiseExport(first));
    expect(first.totalRows).toBe(12);

    // ⚠ AGREEMENT BETWEEN TWO RUNS IS NOT ENOUGH ON ITS OWN, and the first
    // draft stopped there. Dropping `orderBy` entirely still passed it: SQL
    // Server hands back small tables in clustered-index order, which for these
    // models IS key order, so both runs agreed and the mutant survived. That
    // mutant is effectively equivalent TODAY and stops being equivalent the
    // moment a parallel plan or a different index is chosen — the order is
    // not guaranteed without `ORDER BY`. Asserting the order POSITIVELY is
    // what catches the mutants that are not equivalent: a `desc` direction, or
    // a sort keyed on the wrong field.
    const ids = first.tables['upload_batch']?.rows.map((row) => row['id']) ?? [];
    expect(ids.length).toBe(3);
    expect(ids).toStrictEqual([...ids].sort());

    const listingIds = first.tables['service_listing']?.rows.map((row) => row['listingId']) ?? [];
    expect(listingIds.length).toBe(3);
    expect(listingIds).toStrictEqual([...listingIds].sort());
  });

  it('T-EXPORT-001f: an empty export is REFUSED by default, because it looks like a real one', () => {
    // Owner ids are opaque 16-hex hashes. Mistype one and every query matches
    // nothing, the script succeeds, and it writes a well-formed artefact with
    // the right shape, the right table list and zero rows — indistinguishable
    // from a real backup until the day it is restored from. The refusal is the
    // feature; the flag is the escape hatch for a genuinely empty database.
    expect(SCRIPT_SOURCE).toContain('--allow-empty');
    expect(SCRIPT_SOURCE).toMatch(/totalRows === 0 && !options\.allowEmpty/);
    expect(parseArgs(['--owner', 'o_x', '--out', 'a.json']).allowEmpty).toBe(false);
    expect(parseArgs(['--owner', 'o_x', '--out', 'a.json', '--allow-empty']).allowEmpty).toBe(true);
    expect(() => parseArgs(['--out', 'a.json'])).toThrow(/--owner/);
    expect(() => parseArgs(['--owner', 'o_x'])).toThrow(/--out/);
  });

  it('T-EXPORT-001g: the script never writes to the database and never deletes', () => {
    // A backup tool that can also destroy is a footgun pointed at the one copy
    // of the data. REQ-028 forbids hard deletion everywhere; this file is
    // outside the `apps/api/src/**` scope that `T-INV-013` and `T-SEC-021`
    // police, so the property is asserted here directly.
    const code = SCRIPT_SOURCE.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    for (const forbidden of [
      'delete',
      'deleteMany',
      'update',
      'updateMany',
      'create',
      'createMany',
      'upsert',
      'executeRaw',
      'executeRawUnsafe',
      '$transaction',
    ]) {
      expect(code).not.toContain(`.${forbidden}(`);
    }
    expect(code).toContain('.findMany(');
    // It also refuses to clobber an existing artefact: the only thing worse
    // than having no backup is overwriting a good one with a bad one.
    expect(code).toMatch(/flag: 'wx'/);
  });

  it('T-EXPORT-001h: the script is never scheduled', () => {
    const code = SCRIPT_SOURCE.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    // Product invariant 5 permits exactly three non-owner processes and
    // `T-CI-005` fails the build if a fourth appears. `T-CI-005` scans
    // `apps/api/src/**`, not `scripts/**`, so a timer added here would slip
    // past it — this is the case that closes that gap.
    for (const forbidden of ['setInterval', 'setTimeout', 'cron', 'schedule']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('T-EXPORT-001i: docs/restore.md documents the 7-day PITR window and the BACPAC path', () => {
    // ⚠ THE WINDOW IS SEVEN DAYS, NOT THIRTY-FIVE. The Rev-3 plan assumed
    // PostgreSQL Flexible Server; we run Azure SQL Basic (`infra/sqldb.bicep`,
    // `retentionDays: 7`) and A40 corrected it. The difference is the whole
    // reason the manual export is the PRIMARY defence rather than an extra, so
    // a runbook that quietly reverted to 35 would leave the owner believing
    // they had five times the recovery window they have.
    expect(RUNBOOK).toMatch(/\b7 days\b/);
    expect(RUNBOOK).not.toMatch(/\b35[- ]day\b/);
    expect(RUNBOOK).toContain('az sql db restore');
    expect(RUNBOOK).toContain('bacpac');
    expect(RUNBOOK).toContain('az sql db import');
    // Restore to a NEW database, compare, then repoint — never in place.
    expect(RUNBOOK).toContain('nextup-restored');
    expect(RUNBOOK).toContain('T-CI-005');
  });

  it('T-EXPORT-001j: the runbook invokes the entry point the way that actually works', () => {
    // ⚠ THE FIRST DRAFT DOCUMENTED A COMMAND THAT DOES NOT RUN. It said
    // `npm run export:owner-data -- --owner … --out …`, and npm parses
    // `--owner`/`--out` as its OWN config before the script sees them: it
    // prints `Unknown cli config "--owner"` as a warning — not an error — and
    // forwards the bare values as positionals, so the script dies with
    // `Unknown argument: o_xxxx`, which reads as a bug in the script rather
    // than in the instructions. A runbook is executed by a person under
    // pressure who has never run it before; a command that fails on the first
    // line is worse than no runbook.
    expect(RUNBOOK).toContain('npm run build:scripts');
    expect(RUNBOOK).toContain('node scripts/dist/export-owner-data.js --owner');
    expect(RUNBOOK).not.toMatch(/npm run export:owner-data/);

    // And the build step the runbook names must exist.
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:scripts']).toBe('tsc --build scripts');
  });
});
