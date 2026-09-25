/**
 * #380 — `T-FORECAST-002`: the owner-approved 0018 migration is additive only.
 *
 * It adds six nullable forecast columns to `watch_intent`. It needs no pin in
 * `tools/check-migrations.ts` because it holds no destructive statement at all,
 * and these cases keep it that way.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SERVICES } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

import { scanSql } from '../../tools/check-migrations.js';

const PATH = 'prisma/migrations/0018_streaming_forecast/migration.sql';
const SQL = readFileSync(fileURLToPath(new URL(`../../${PATH}`, import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const EXECUTABLE = SQL.replace(/--[^\n]*/g, ' ');
const SCHEMA = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

const COLUMNS = [
  'forecast_checked_at',
  'studio_company_ids',
  'theatrical_release_on',
  'digital_release_on',
  'announced_service',
  'announced_on',
];

describe('T-FORECAST-002 — migration 0018 is additive and matches the domain', () => {
  it('T-FORECAST-002a — the migration gate finds nothing destructive, and it touches no row', () => {
    expect(scanSql(PATH, SQL)).toEqual([]);
    expect(EXECUTABLE).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|sp_rename)\b/i);
    expect(EXECUTABLE).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  it('T-FORECAST-002b — every new column is nullable and mirrored in the Prisma schema', () => {
    for (const column of COLUMNS) {
      expect(EXECUTABLE, column).toMatch(new RegExp(`\\[${column}\\] [A-Z0-9()]+ NULL`));
      expect(SCHEMA, column).toContain(`@map("${column}")`);
    }
    expect(EXECUTABLE).not.toMatch(/NOT NULL,|NOT NULL;/);
  });

  it('T-FORECAST-002c — the announced-service CHECK holds exactly the SERVICES enum', () => {
    const start = EXECUTABLE.indexOf('[ck_intent_announced_service]');
    expect(start).toBeGreaterThan(-1);
    const check = EXECUTABLE.slice(start, EXECUTABLE.indexOf(');', start));
    const values = [...check.matchAll(/''([^']+)''/g)].map((m) => m[1]);
    expect(values).toEqual([...SERVICES]);
  });

  it('T-FORECAST-002d — announced pairs, the JSON shape and the checked-at marker are enforced', () => {
    for (const name of [
      'ck_intent_announced_coherent',
      'ck_intent_studio_ids_json',
      'ck_intent_forecast_coherent',
    ]) {
      expect(EXECUTABLE, name).toContain(`WITH CHECK ADD CONSTRAINT [${name}]`);
    }
    expect(EXECUTABLE).toContain('ISJSON([studio_company_ids]) = 1');
  });
});
