/**
 * #454 — `T-SEAS-070`: migration 0022 (PRD `A64`) is additive only.
 *
 * It adds the owner's opt-in and the next-season facts to `watch_preference`,
 * and the season marker to `watch_intent`. No pin is needed in
 * `tools/check-migrations.ts` because it holds no destructive statement.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scanSql } from '../../tools/check-migrations.js';

const PATH = 'prisma/migrations/0022_track_new_seasons/migration.sql';
const SQL = readFileSync(fileURLToPath(new URL(`../../${PATH}`, import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const EXECUTABLE = SQL.replace(/--[^\n]*/g, ' ');
const SCHEMA = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('T-SEAS-070 — migration 0022 is additive and matches the schema', () => {
  it('T-SEAS-070a: the migration gate finds nothing destructive, and it touches no row', () => {
    expect(scanSql(PATH, SQL)).toEqual([]);
    expect(EXECUTABLE).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|sp_rename)\b/i);
    expect(EXECUTABLE).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  it('T-SEAS-070b: every new column is nullable or defaulted, and mirrored in the Prisma schema', () => {
    for (const column of ['season_checked_at', 'season_number', 'season_air_on']) {
      expect(EXECUTABLE, column).toMatch(new RegExp(`\\[${column}\\] [A-Z0-9()]+ NULL`));
      expect(SCHEMA, column).toContain(`@map("${column}")`);
    }
    expect(EXECUTABLE).toMatch(
      /\[track_new_season\] BIT NOT NULL CONSTRAINT \[df_watch_preference_track_season\] DEFAULT 0/,
    );
    expect(SCHEMA).toContain('@map("track_new_season")');
  });

  it('T-SEAS-070c: season number and date are all-or-nothing on both tables', () => {
    for (const name of ['ck_watch_preference_season_coherent', 'ck_intent_season_coherent']) {
      expect(EXECUTABLE, name).toContain(`WITH CHECK ADD CONSTRAINT [${name}]`);
    }
    expect(EXECUTABLE).toContain('[season_number] IS NULL AND [season_air_on] IS NULL');
  });
});
