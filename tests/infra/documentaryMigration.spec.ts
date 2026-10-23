/**
 * #456 — `T-DOC-004`: migration 0021 (PRD `A62`) widens the owner category
 * allow-list to include `documentary` without dropping the 0016 CHECK. The
 * `NOCHECK` line is pinned by exact text and file hash in
 * `tools/check-migrations.ts`; these cases pin the rest of the shape.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TITLE_CATEGORIES } from '@nextup/domain';

import { scanSql } from '../../tools/check-migrations.js';

const PATH = 'prisma/migrations/0021_documentary_category/migration.sql';
const SQL = readFileSync(fileURLToPath(new URL(`../../${PATH}`, import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const EXECUTABLE = SQL.replace(/--[^\n]*/g, ' ');

describe('T-DOC-004 — migration 0021 is additive and a strict superset', () => {
  it('T-DOC-004a: the gate passes it as pinned, and it only disables the one superseded CHECK', () => {
    expect(scanSql(PATH, SQL)).toEqual([]);
    expect(scanSql('prisma/migrations/0022_copy/migration.sql', SQL)).not.toEqual([]);
    expect(scanSql(PATH, `${SQL}\nDELETE FROM [watch_preference];`)).not.toEqual([]);
    expect(EXECUTABLE).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|sp_rename)\b/i);
    expect(EXECUTABLE).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(EXECUTABLE.match(/\bNOCHECK\s+CONSTRAINT\b/gi)).toHaveLength(1);
  });
  it('T-DOC-004b: the superset is installed WITH CHECK before the old rule is disabled, and lists every category', () => {
    const added = EXECUTABLE.indexOf('WITH CHECK ADD CONSTRAINT [ck_watch_preference_category_v2]');
    const disabled = EXECUTABLE.indexOf('NOCHECK CONSTRAINT [ck_watch_preference_category]');
    expect(added).toBeGreaterThan(-1);
    expect(disabled).toBeGreaterThan(added);
    const values = [...EXECUTABLE.slice(added, disabled).matchAll(/N''([^']+)''/g)].map(
      (match) => match[1],
    );
    expect(values).toEqual([...TITLE_CATEGORIES]);
  });
});
