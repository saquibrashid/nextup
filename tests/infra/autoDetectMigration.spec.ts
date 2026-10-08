/**
 * #396 — `T-AUTO-006`: the 0020 auto-detect migration (PRD `A57`, ADR-0010
 * Rev 6) is additive, and widens the batch-source rule without dropping it.
 *
 * `ck_batch_source_exclusive` (0006) says exactly one of `service` and
 * `discovery_source` is set; an auto-detect batch sets neither. A DROP is
 * forbidden (T-MIG-001), so 0020 installs `ck_batch_source_kind` — the same
 * rule for every non-auto row — WITH CHECK, then disables the old one. The
 * `NOCHECK` line is pinned by exact text and file hash; these cases pin the
 * rest of the shape.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scanSql } from '../../tools/check-migrations.js';

const PATH = 'prisma/migrations/0020_auto_detect_source/migration.sql';
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
  'service_lookup_status',
  'service_lookup_identity',
  'service_lookup_at',
  'looked_up_available_on',
  'looked_up_rent_on',
  'destination_kind',
  'destination_services',
];

describe('T-AUTO-006 — migration 0020 is additive and matches the schema', () => {
  it('T-AUTO-006a: the gate passes it as pinned, and nothing else is destructive or touches a row', () => {
    expect(scanSql(PATH, SQL)).toEqual([]);
    // The SAME text under any other path is not approved: the pin is by path.
    expect(scanSql('prisma/migrations/0021_copy/migration.sql', SQL)).not.toEqual([]);
    expect(EXECUTABLE).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|sp_rename)\b/i);
    expect(EXECUTABLE).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(EXECUTABLE.match(/\bNOCHECK\s+CONSTRAINT\b/gi)).toHaveLength(1);
  });

  it('T-AUTO-006b: the new columns are nullable or defaulted, and mirrored in the Prisma schema', () => {
    for (const column of NULLABLE) {
      expect(EXECUTABLE, column).toMatch(new RegExp(`\\[${column}\\] [A-Z0-9()]+ NULL`));
      expect(SCHEMA, column).toContain(`@map("${column}")`);
    }
    expect(EXECUTABLE).toMatch(
      /\[auto_detect\] BIT NOT NULL CONSTRAINT \[df_batch_auto_detect\] DEFAULT 0/,
    );
    expect(SCHEMA).toContain('@map("auto_detect")');
  });

  it('T-AUTO-006c: the replacement source rule is checked BEFORE the old one is disabled', () => {
    const added = EXECUTABLE.indexOf('WITH CHECK ADD CONSTRAINT [ck_batch_source_kind]');
    const disabled = EXECUTABLE.indexOf('NOCHECK CONSTRAINT [ck_batch_source_exclusive]');
    expect(added).toBeGreaterThan(-1);
    expect(disabled).toBeGreaterThan(added);
    // The old rule, verbatim, for every non-auto row; "both NULL" only for auto.
    expect(EXECUTABLE).toMatch(
      /\[auto_detect\] = 0 AND \[service\] IS NOT NULL AND \[discovery_source\] IS NULL/,
    );
    expect(EXECUTABLE).toMatch(
      /\[auto_detect\] = 0 AND \[service\] IS NULL\s+AND \[discovery_source\] IS NOT NULL/,
    );
    expect(EXECUTABLE).toMatch(
      /\[auto_detect\] = 1 AND \[service\] IS NULL\s+AND \[discovery_source\] IS NULL/,
    );
  });

  it('T-AUTO-006d: auto is append-only in the store, and the candidate shapes are enforced', () => {
    expect(EXECUTABLE).toContain("CHECK ([auto_detect] = 0 OR [mode] = ''append-only'')");
    for (const name of [
      'ck_batch_auto_append_only',
      'ck_candidate_lookup_status',
      'ck_candidate_lookup_coherent',
      'ck_candidate_looked_up_available_json',
      'ck_candidate_looked_up_rent_json',
      'ck_candidate_destination_kind',
      'ck_candidate_destination_coherent',
    ]) {
      expect(EXECUTABLE, name).toContain(`WITH CHECK ADD CONSTRAINT [${name}]`);
    }
    expect(EXECUTABLE).toContain('ISJSON([destination_services]) = 1');
  });
});
