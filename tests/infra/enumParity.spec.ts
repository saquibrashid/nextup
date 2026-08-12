/**
 * T-INV-024 — the domain enums and the database CHECK constraints are two
 * copies of the same truth, and they must not drift.
 *
 * `packages/domain/src/enums.ts` declares the permitted values in TypeScript;
 * `prisma/migrations/0001_init/migration.sql` declares them again as `CHECK
 * (col IN (...))`. Neither generates the other, so nothing stops one being
 * extended without the other.
 *
 * Both directions of that drift fail badly and quietly:
 *
 *  - A value added to the enum but not the constraint typechecks everywhere,
 *    passes every unit test, and then throws a raw SQL constraint violation in
 *    production the first time a real row carries it.
 *  - A value added to the constraint but not the enum is unreachable from the
 *    application, so a column can hold a state the domain cannot name — and
 *    exhaustive `switch` statements over the union silently stop being
 *    exhaustive for that row.
 *
 * The map below is deliberately explicit rather than inferred from column
 * names. An inferred mapping would quietly skip a pair it failed to match,
 * which is precisely the case this test exists to catch: it would report
 * success by checking nothing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  BATCH_MODES,
  BATCH_STATUSES,
  BOX_SOURCES,
  CANDIDATE_BASES,
  CANDIDATE_CLASSIFICATIONS,
  CANDIDATE_PROVIDERS,
  CLEANUP_VERDICTS,
  CROSS_CHECK_OUTCOMES,
  EXTRACTION_ERROR_CODES,
  IMAGE_FORMATS,
  INGEST_SOURCES,
  LISTING_STATES,
  MATCH_STATES,
  MEDIA_TYPES,
  OCR_SUPPORTS,
  REVIEW_DISPOSITIONS,
  SERVICES,
  TITLE_STATES,
  UPLOAD_FORMATS,
} from '@nextup/domain';
import { describe, expect, it } from 'vitest';

const MIGRATION = fileURLToPath(
  new URL('../../prisma/migrations/0001_init/migration.sql', import.meta.url),
);

const sql = readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n');

/** Constraint name → the domain enum it must agree with. */
const PAIRS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['ck_batch_mode', BATCH_MODES],
  ['ck_batch_service', SERVICES],
  ['ck_batch_status', BATCH_STATUSES],
  ['ck_batch_err_code', EXTRACTION_ERROR_CODES],
  ['ck_batch_cross_check', CROSS_CHECK_OUTCOMES],
  ['ck_title_state', TITLE_STATES],
  ['ck_title_match_state', MATCH_STATES],
  ['ck_title_media_type', MEDIA_TYPES],
  ['ck_listing_service', SERVICES],
  ['ck_listing_state', LISTING_STATES],
  ['ck_image_ingest_source', INGEST_SOURCES],
  ['ck_image_uploaded_format', UPLOAD_FORMATS],
  ['ck_image_format', IMAGE_FORMATS],
  ['ck_cand_basis', CANDIDATE_BASES],
  ['ck_cand_ocr_sup', OCR_SUPPORTS],
  ['ck_cand_provider', CANDIDATE_PROVIDERS],
  ['ck_cand_box_source', BOX_SOURCES],
  ['ck_cand_verdict', CLEANUP_VERDICTS],
  ['ck_cand_classification', CANDIDATE_CLASSIFICATIONS],
  ['ck_cand_disposition', REVIEW_DISPOSITIONS],
  ['ck_state_service', SERVICES],
  ['ck_suppression_media_type', MEDIA_TYPES],
];

/**
 * IN-style constraints that deliberately have no domain enum, with the reason.
 *
 * An omission from `PAIRS` must be a decision, not an oversight, so this list
 * is required to be exhaustive by `T-INV-024c`. Adding a constrained column
 * therefore forces a choice: mirror it in the domain, or say here why not.
 */
const UNMAPPED: Readonly<Record<string, string>> = {
  // `batch_change.kind` is storage-only provenance. The domain models the same
  // information as the three arrays of `BatchProvenance` (created / modified /
  // removed) rather than as a discriminant, so there is no union to compare.
  // When provenance persistence lands, mirror it and move this into PAIRS.
  ck_change_kind: 'storage-only provenance; the domain models it as BatchProvenance arrays',
};

/**
 * Reads the literal list out of `CONSTRAINT [name] CHECK (... IN ('a','b'))`.
 * Returns `null` when the constraint is absent, so a renamed or deleted
 * constraint fails loudly instead of comparing against an empty list.
 */
export function checkConstraintValues(name: string): string[] | null {
  const match = new RegExp(`CONSTRAINT \\[${name}\\] CHECK \\(([^;]*?)\\)\\s*(?:,|\\n)`).exec(sql);
  if (!match?.[1]) return null;
  const inList = /IN \(([^)]*)\)/.exec(match[1]);
  if (!inList?.[1]) return null;
  return [...inList[1].matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
}

describe('T-INV-024 domain enums match the database CHECK constraints', () => {
  it('T-INV-024a: every CHECK constraint permits exactly its domain enum values', () => {
    const problems: string[] = [];

    for (const [constraint, values] of PAIRS) {
      const fromSql = checkConstraintValues(constraint);
      if (fromSql === null) {
        problems.push(`[${constraint}] was not found in the migration — renamed or deleted?`);
        continue;
      }
      const inSqlOnly = fromSql.filter((v) => !values.includes(v));
      const inEnumOnly = values.filter((v) => !fromSql.includes(v));
      if (inSqlOnly.length > 0 || inEnumOnly.length > 0) {
        problems.push(
          `[${constraint}] disagrees with the domain enum — ` +
            `only in SQL: [${inSqlOnly.join(', ')}]; only in the enum: [${inEnumOnly.join(', ')}]. ` +
            `Add the value to BOTH packages/domain/src/enums.ts and a new additive migration.`,
        );
      }
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('T-INV-024b: reports a missing constraint rather than passing vacuously', () => {
    expect(checkConstraintValues('ck_does_not_exist')).toBeNull();
  });

  it('T-INV-024c: covers every IN-style CHECK constraint in the migration', () => {
    // Without this, adding a column with a new CHECK constraint and forgetting
    // to add it to PAIRS would leave that pair unguarded, and T-INV-024a would
    // still report success.
    //
    // The match is line-scoped on purpose. A pattern allowed to span lines
    // reaches forward into a LATER constraint's `IN (`, so constraints that
    // contain no value list at all (`ISJSON(...) = 1`, `LEN(...) > 0`) are
    // reported as unmapped enums — noise that would push someone to weaken the
    // test. Every constraint in this migration is written on one line.
    const declared = [...sql.matchAll(/CONSTRAINT \[(ck_\w+)\] CHECK \([^\n]*?IN \(/g)].map(
      (m) => m[1] as string,
    );
    const known = new Set([...PAIRS.map(([name]) => name), ...Object.keys(UNMAPPED)]);

    expect(
      declared.filter((name) => !known.has(name)),
      'Every IN-style CHECK constraint must either be mapped to a domain enum in PAIRS, ' +
        'or listed in UNMAPPED with the reason it has none.',
    ).toEqual([]);
  });
});
