/**
 * #378 — `T-WAIT-014`: the owner-approved 0017 migration, pinned like 0012.
 *
 * `T-MIG-001` forbids `DROP CONSTRAINT` everywhere. Widening a CHECK in SQL
 * Server means replacing it, so the owner approved exactly this file: two
 * discovery-source CHECKs, each replaced by a wider trusted CHECK before the
 * original is dropped, inside one transaction. These cases prove the approval
 * cannot be stretched to anything else.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DISCOVERY_SOURCES, INTENT_SOURCES } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

import { scanSql } from '../../tools/check-migrations.js';

const PATH = 'prisma/migrations/0017_waiting_to_stream/migration.sql';
const SQL = readFileSync(fileURLToPath(new URL(`../../${PATH}`, import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const SCHEMA = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);
const UNAPPROVED = 'Unapproved discovery source expansion SQL';

function checkValues(constraint: string): string[] {
  const add = `WITH CHECK ADD CONSTRAINT [${constraint}_expanded]`;
  const start = SQL.indexOf(add);
  expect(start, constraint).toBeGreaterThan(-1);
  const check = SQL.slice(start, SQL.indexOf(';', start));
  return [...check.matchAll(/'([^']*)'/g)].map((match) => match[1] as string);
}

describe('T-WAIT-014 — the owner-approved discovery-source CHECK replacement', () => {
  it('T-WAIT-014a — authorizes only the complete approved file at its exact path', () => {
    expect(scanSql(PATH, SQL)).toEqual([]);
    expect(scanSql(PATH.replace(/\//g, '\\'), SQL)).toEqual([]);
    expect(scanSql(PATH, SQL.replace(/\n/g, '\r\n'))).toEqual([]);

    for (const moved of [
      'prisma/migrations/0018_waiting_to_stream/migration.sql',
      'prisma/migrations/0017_waiting_to_stream/copy.sql',
      `copy/${PATH}`,
      PATH.toUpperCase(),
    ]) {
      expect(
        scanSql(moved, SQL).map((v) => v.statement),
        moved,
      ).toEqual(['DROP CONSTRAINT', 'DROP CONSTRAINT']);
    }
  });

  it('T-WAIT-014b — the widened CHECKs hold exactly the domain enums, installed before any drop', () => {
    expect(checkValues('ck_batch_discovery_source')).toEqual([...DISCOVERY_SOURCES]);
    expect(checkValues('ck_intent_source')).toEqual([...INTENT_SOURCES]);

    const begin = SQL.indexOf('BEGIN TRANSACTION;');
    const firstDrop = SQL.indexOf('] DROP CONSTRAINT [');
    for (const constraint of ['ck_batch_discovery_source', 'ck_intent_source']) {
      const add = SQL.indexOf(`WITH CHECK ADD CONSTRAINT [${constraint}_expanded]`);
      expect(add).toBeGreaterThan(begin);
      expect(add).toBeLessThan(firstDrop);
      expect(SQL).toContain(
        `EXEC sp_rename N'dbo.${constraint}_expanded', N'${constraint}', N'OBJECT';`,
      );
    }
    expect(SQL.match(/\] DROP CONSTRAINT \[/g)).toHaveLength(2);
    expect(SQL.match(/WITH NOCHECK/g)).toBeNull();
    expect(SQL).toContain('SET XACT_ABORT ON;');
    expect(SQL).toContain('COMMIT TRANSACTION;\nEND TRY\nBEGIN CATCH');
    expect(SQL).toContain('IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;\n  THROW;');
    expect(SQL).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
    expect(INTENT_SOURCES.every((source) => source.length <= 64)).toBe(true);
  });

  it('T-WAIT-014c — a batchless intent is allowed ONLY for search, and the new columns are guarded', () => {
    expect(SQL).toContain(
      'ALTER COLUMN [source_batch_id]\n    NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL;',
    );
    expect(SQL).toContain("([discovery_source] = ''search'' AND [source_batch_id] IS NULL)");
    expect(SQL).toContain("([discovery_source] <> ''search'' AND [source_batch_id] IS NOT NULL)");
    expect(SQL).toContain('CHECK ([rent_on] IS NULL OR ISJSON([rent_on]) = 1)');
    expect(SQL).toContain('CHECK ([rent_on] IS NULL OR [availability_checked_at] IS NOT NULL)');
    expect(SCHEMA).toMatch(/sourceBatchId\s+String\?\s+@map\("source_batch_id"\)/);
    expect(SCHEMA).toMatch(/rentOn\s+String\?\s+@map\("rent_on"\)/);
    expect(SCHEMA).toMatch(/streamingSince\s+DateTime\?\s+@map\("streaming_since"\)/);
  });

  it('T-WAIT-014d — rejects weakening, reordering and appended SQL', () => {
    const mutations: Array<readonly [string, string]> = [
      ['empty file', ''],
      ['no XACT_ABORT', SQL.replace('SET XACT_ABORT ON;', '')],
      ['no transaction', SQL.replace('BEGIN TRANSACTION;', '')],
      ['untrusted replacement', SQL.replace('WITH CHECK', 'WITH NOCHECK')],
      ['extra source', SQL.replace("'google-tv-store'));", "'google-tv-store','hulu'));")],
      [
        'search as a batch source',
        SQL.replace("'google-tv-store'));", "'google-tv-store','search'));"),
      ],
      ['column rename', SQL.replace("N'OBJECT'", "N'COLUMN'")],
      ['wrong table', SQL.replace('[dbo].[watch_intent] DROP', '[dbo].[title] DROP')],
      ['no coherence', SQL.replace('ck_intent_source_batch_coherent', 'ck_intent_other')],
      ['appended drop', `${SQL}\nALTER TABLE dbo.title DROP CONSTRAINT ck_title_state;`],
      ['appended DML', `${SQL}\nDELETE FROM dbo.watch_intent;`],
      ['appended select', `${SQL}\nSELECT 1;`],
    ];
    for (const [label, sql] of mutations) {
      expect(sql, label).not.toBe(SQL);
      expect(
        scanSql(PATH, sql).map((v) => v.statement),
        label,
      ).toContain(UNAPPROVED);
    }
  });
});
