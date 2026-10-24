/**
 * #325 / #465 — `T-VIEWED-070`: migration 0023 (PRD `A66`) is additive only.
 *
 * It adds `watch_record` and `watch_preference.library_hidden`. No pin is
 * needed in `tools/check-migrations.ts` because it holds no destructive
 * statement.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scanSql } from '../../tools/check-migrations.js';

const PATH = 'prisma/migrations/0023_watched_history/migration.sql';
const SQL = readFileSync(fileURLToPath(new URL(`../../${PATH}`, import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const EXECUTABLE = SQL.replace(/--[^\n]*/g, ' ');
const SCHEMA = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('T-VIEWED-070 — migration 0023 is additive and matches the schema', () => {
  it('T-VIEWED-070a: the migration gate finds nothing destructive, and it touches no row', () => {
    expect(scanSql(PATH, SQL)).toEqual([]);
    expect(EXECUTABLE).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|sp_rename)\b/i);
    expect(EXECUTABLE).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  it('T-VIEWED-070b: the record is keyed on work identity and season, never on a title row', () => {
    expect(EXECUTABLE).toContain('PRIMARY KEY ([owner_id], [work_identity], [season_number])');
    expect(EXECUTABLE).not.toMatch(/FOREIGN KEY|REFERENCES|ON DELETE/i);
    expect(EXECUTABLE).toMatch(/\[rating\] IS NULL OR \[rating\] BETWEEN 1 AND 5/);
    expect(SCHEMA).toContain('model WatchRecord');
    expect(SCHEMA).toContain('@@map("watch_record")');
  });

  it('T-VIEWED-070c: the Library flag is a defaulted column mirrored in the schema', () => {
    expect(EXECUTABLE).toMatch(
      /\[library_hidden\] BIT NOT NULL CONSTRAINT \[df_watch_preference_library_hidden\] DEFAULT 0/,
    );
    expect(SCHEMA).toContain('@map("library_hidden")');
  });
});
