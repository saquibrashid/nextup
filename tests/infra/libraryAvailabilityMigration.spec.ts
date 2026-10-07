/**
 * #397/#410 — `T-MOVE-013`: the owner-approved 0019 migration (PRD `A54`) is
 * additive only.
 *
 * It adds Library availability columns to `title` and one nullable marker to
 * `watch_intent`. It needs no pin in `tools/check-migrations.ts` because it
 * holds no destructive statement at all, and these cases keep it that way.
 * The one NOT NULL column carries a DEFAULT, so no existing row needs a write.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scanSql } from '../../tools/check-migrations.js';

const PATH = 'prisma/migrations/0019_library_availability/migration.sql';
const SQL = readFileSync(fileURLToPath(new URL(`../../${PATH}`, import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const EXECUTABLE = SQL.replace(/--[^\n]*/g, ' ');
const SCHEMA = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

const NULLABLE = [
  'availability_checked_at',
  'available_on',
  'rent_on',
  'availability_kept_signature',
  'moved_from_library_at',
];

describe('T-MOVE-013 — migration 0019 is additive and matches the schema', () => {
  it('T-MOVE-013a: the migration gate finds nothing destructive, and it touches no row', () => {
    expect(scanSql(PATH, SQL)).toEqual([]);
    expect(EXECUTABLE).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|sp_rename)\b/i);
    expect(EXECUTABLE).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  it('T-MOVE-013b: every new column is nullable or defaulted, and mirrored in the Prisma schema', () => {
    for (const column of NULLABLE) {
      expect(EXECUTABLE, column).toMatch(new RegExp(`\\[${column}\\] [A-Z0-9()]+ NULL`));
      expect(SCHEMA, column).toContain(`@map("${column}")`);
    }
    expect(EXECUTABLE).toMatch(
      /\[availability_region\] NVARCHAR\(8\) NOT NULL CONSTRAINT \[df_title_region\] DEFAULT 'US'/,
    );
    expect(SCHEMA).toContain('@map("availability_region")');
  });

  it('T-MOVE-013c: JSON shape, answer coherence and the moved-intent source are enforced', () => {
    for (const name of [
      'ck_title_available_on_json',
      'ck_title_rent_on_json',
      'ck_title_availability_coherent',
      'ck_intent_moved_from_library_search',
    ]) {
      expect(EXECUTABLE, name).toContain(`WITH CHECK ADD CONSTRAINT [${name}]`);
    }
    expect(EXECUTABLE).toContain('ISJSON([available_on]) = 1');
    expect(EXECUTABLE).toContain('ISJSON([rent_on]) = 1');
    expect(EXECUTABLE).toContain("[discovery_source] = ''search''");
  });
});
