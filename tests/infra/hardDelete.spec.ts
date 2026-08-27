/**
 * `T-INV-012` — **soft delete forever, with a closed set of exemptions**
 * (REQ-028, US-023 AC-5, `specs/data-model.md` I-7 and §8.3, TASK-051,
 * TASK-112).
 *
 * `T-INV-013` already proves the INFRASTRUCTURE half: no TTL, no Azure SQL
 * Agent job, no Elastic Job, no scheduled deletion anywhere. This is the
 * SOURCE half it names but does not implement - "`DELETE` in exactly one
 * module". Without it, REQ-028 is enforced against Bicep and against nothing
 * a developer would actually write.
 *
 * ⚠ WHY THIS GATE IS WORTH ITS WEIGHT. A hard delete is invisible in review
 * and irreversible in production: `prisma.title.delete(...)` is one plausible
 * line, it typechecks, its tests pass, and the row it removes was the only
 * copy. Every other REQ-028 protection is a soft-delete CONVENTION, and a
 * convention is exactly what this stops being the moment one call site
 * disagrees with it.
 *
 * ⚠ The exemption list is a RATCHET, not a permission. Each entry names a
 * product decision (`data-model.md` I-7), never a test fix. If a task needs a
 * row gone, the answer is almost always a soft delete - see
 * `softDeleteServiceListing`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Shipping source only. Tests legitimately delete rows to arrange fixtures. */
const SOURCE_ROOTS = ['apps/api/src', 'apps/web/src', 'packages/domain/src'];

/**
 * The sanctioned hard deletes.
 *
 * 1. A PRE-SUBMIT DRAFT image (`specs/api.md` §6.13). Nothing has been
 *    reconciled against the list and no candidate references it, so removing
 *    it deletes something that never entered the record.
 * 2. SD-03 creates-only batch undo (`specs/data-model.md` §8.3, US-032). The
 *    owner is asserting the import never legitimately happened, so its
 *    creations are DISCARDED rather than soft-deleted: a soft delete would
 *    park them in the removed view, which is a historical log of things the
 *    owner once had (invariant L1/A33) - and they never had these. The
 *    exemption is narrow by construction: `undoDiscard.ts` exists ONLY to
 *    hold these two deletes, so the blast radius stays the size of the
 *    exemption. Evidence (candidates, images) and provenance are RETAINED.
 *
 * ⚠ KEYED ON FILE **AND MODEL**, not on file alone. A file-scoped exemption
 * silently pre-authorises every future delete written into that file, and
 * `ownerData.ts` is where all forty-odd repository functions live - so
 * `title.delete(...)` added next to it would have inherited the exemption. It
 * is the `uploadedImage` delete that I-7 exempts, nothing else in the module.
 *
 * ⚠ The exemption is a RATCHET, not a permission. Adding an entry is a product
 * decision (`data-model.md` I-7), not a test fix. If a task needs a row gone,
 * the answer is almost always a soft delete - see `softDeleteServiceListing`.
 */
const SANCTIONED = new Map<string, string>([
  [
    'apps/api/src/repository/ownerData.ts::uploadedImage',
    'deleteUploadedImage - the I-7 pre-submit draft-image exemption (TASK-051)',
  ],
  [
    'apps/api/src/repository/undoDiscard.ts::title',
    'discardCreatedTitles - SD-03 creates-only undo (data-model.md §8.3, TASK-112)',
  ],
  [
    'apps/api/src/repository/undoDiscard.ts::serviceListing',
    'discardCreatedListings - SD-03 creates-only undo (data-model.md §8.3, TASK-112)',
  ],
]);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const next = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(next);
        continue;
      }
      if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) out.push(next);
    }
  };
  for (const root of SOURCE_ROOTS) walk(path.join(ROOT, root));
  return out;
}

/** Prisma model accessors, derived from the schema so the list cannot drift. */
function prismaAccessors(): string[] {
  const schema = readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(
    (match) => (match[1] ?? '').charAt(0).toLowerCase() + (match[1] ?? '').slice(1),
  );
}

/**
 * Find every hard delete of a persisted row.
 *
 * ⚠ SCOPED TO PRISMA MODEL ACCESSORS, deliberately. A bare `/\.delete\(/`
 * scan also matches `Map.delete`, `Set.delete`, `headers.delete` and
 * `URLSearchParams.delete` - all of which are ordinary and none of which touch
 * a row. A gate that fires on those gets an allow-list bolted onto it within a
 * week and stops meaning anything. `startExtraction.ts` already calls
 * `inFlight.delete(batchId)` on a `Map`, so this is not hypothetical.
 */
function hardDeletes(): { key: string; file: string; line: number; text: string }[] {
  const accessors = prismaAccessors();
  const pattern = new RegExp(`\\.(${accessors.join('|')})\\s*\\.\\s*delete(?:Many)?\\s*\\(`);
  const rawSql = /\bDELETE\s+FROM\b/i;
  const found: { key: string; file: string; line: number; text: string }[] = [];

  for (const file of sourceFiles()) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        // A comment naming the rule is not a violation of it.
        const code = text.replace(/^\s*(?:\/\/|\*|\/\*).*$/, '');
        const match = pattern.exec(code);
        if (match) {
          found.push({
            key: `${relative}::${match[1] ?? '?'}`,
            file: relative,
            line: index + 1,
            text: text.trim(),
          });
        } else if (rawSql.test(code)) {
          found.push({
            key: `${relative}::raw-sql`,
            file: relative,
            line: index + 1,
            text: text.trim(),
          });
        }
      });
  }
  return found;
}

describe('T-INV-012 no hard delete outside the sanctioned exemption', () => {
  it('T-INV-012g: every hard delete in shipping source is sanctioned', () => {
    const unsanctioned = hardDeletes().filter((hit) => !SANCTIONED.has(hit.key));

    expect(
      unsanctioned.map((hit) => `${hit.file}:${String(hit.line)} ${hit.text}`),
      'REQ-028 is soft-delete-forever. If a row must go, soft-delete it ' +
        '(see softDeleteServiceListing). Adding an entry to SANCTIONED is a ' +
        'product decision under data-model.md I-7, not a test fix.',
    ).toEqual([]);
  });

  it('T-INV-012h: the sanctioned exemption is REAL, not a stale allow-list entry', () => {
    // An exemption for a call site that no longer exists is worse than none:
    // it silently pre-authorises whatever is written into that file next.
    const keys = new Set(hardDeletes().map((hit) => hit.key));
    for (const key of SANCTIONED.keys()) {
      expect(keys, `${key} is sanctioned but no such hard delete exists`).toContain(key);
    }
  });

  it('T-INV-012i: the sanctioned delete is guarded by a draft check at its call site', () => {
    // The exemption is I-7's "pre-submit draft image", NOT "uploaded image".
    // The repository function cannot enforce that - only the route can - so
    // the route is asserted to refuse a non-draft batch.
    const route = readFileSync(path.join(ROOT, 'apps/api/src/routes/batchImages.ts'), 'utf8');
    const handler = route.slice(route.indexOf("router.delete('/batches/:batchId/images"));

    expect(handler).toContain('deleteUploadedImage');
    expect(handler.indexOf("status !== 'draft'")).toBeGreaterThan(-1);
    expect(handler.indexOf("status !== 'draft'")).toBeLessThan(
      handler.indexOf('deleteUploadedImage'),
    );
    expect(handler).toContain('BATCH_NOT_DRAFT');
  });

  it('T-INV-012k: the SD-03 discard is guarded by a creates-only check at its call site', () => {
    // The exemption is SD-03's "the batch created it and nothing else",
    // NOT "undo deletes rows". `undoDiscard.ts` cannot enforce that - only the
    // service can - so the service is asserted to refuse a batch that
    // modified or removed anything BEFORE it reaches the discard.
    const source = readFileSync(path.join(ROOT, 'apps/api/src/services/batchUndo.ts'), 'utf8');
    // ⚠ From the function body, not the file: `discardCreatedTitles` also
    // appears in the import list at offset ~0, which would make any ordering
    // assertion against the whole file trivially false.
    const service = source.slice(source.indexOf('export async function undoBatch'));

    expect(service).toContain('discardCreatedTitles');
    expect(service.indexOf('BATCH_NOT_CREATES_ONLY')).toBeGreaterThan(-1);
    expect(service.indexOf('BATCH_NOT_CREATES_ONLY')).toBeLessThan(
      service.indexOf('discardCreatedTitles'),
    );
    // And the plan - never the caller - decides WHICH rows go.
    expect(service).toContain('planCreatesOnlyUndo');
  });

  it('T-INV-012j: the scan finds Prisma deletes and ignores Map/Set deletes', () => {
    // NON-VACUITY, in both directions. A scan that matched nothing would pass
    // `g` forever; a scan that matched every `.delete(` would be turned off by
    // the first ordinary `Map.delete`.
    const accessors = prismaAccessors();
    expect(accessors).toContain('uploadedImage');
    expect(accessors).toContain('title');

    const pattern = new RegExp(`\\.(${accessors.join('|')})\\s*\\.\\s*delete(?:Many)?\\s*\\(`);
    expect(pattern.test('await db(tx).title.delete({ where: { id } });')).toBe(true);
    expect(pattern.test('db(tx).uploadedImage.deleteMany({ where: { ownerId } })')).toBe(true);
    expect(pattern.test('inFlight.delete(batchId)')).toBe(false);
    expect(pattern.test('headers.delete("x-foo")')).toBe(false);

    // And the real tree currently holds exactly the sanctioned hits - no more,
    // no fewer. Sorted so the assertion tracks the SET, not the walk order.
    expect(
      hardDeletes()
        .map((hit) => hit.key)
        .sort(),
    ).toEqual([...SANCTIONED.keys()].sort());
  });
});
