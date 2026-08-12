import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { IMAGE_RETENTION_DAYS, TMDB_METADATA_MAX_AGE_DAYS } from '../../src/config.js';

// TASK-014 · US-035 AC-7. A static test, because the property being defended
// is a property of the SOURCE — that these two numbers are written down twice,
// independently — and no runtime observation can distinguish that from one
// number aliased to another.

const CONFIG_PATH = fileURLToPath(new URL('../../src/config.ts', import.meta.url));
const source = readFileSync(CONFIG_PATH, 'utf8');

describe('T-INV-008 the two 30-ish-day constants stay two', () => {
  it('T-INV-008a: both constants exist with their specified values', () => {
    expect(IMAGE_RETENTION_DAYS).toBe(30);
    expect(TMDB_METADATA_MAX_AGE_DAYS).toBe(183);
  });

  it('T-INV-008b: each is its own literal declaration, not derived from the other', () => {
    // The failure this prevents: someone "tidies up" two similar numbers into
    // one, and a later change to a cache-freshness policy silently rewrites a
    // stated privacy retention promise. The diff looks like housekeeping.
    expect(source).toMatch(/^export const IMAGE_RETENTION_DAYS = 30;$/m);
    expect(source).toMatch(/^export const TMDB_METADATA_MAX_AGE_DAYS = 183;$/m);

    // Neither may be defined in terms of the other, in any direction.
    expect(source).not.toMatch(/IMAGE_RETENTION_DAYS\s*=\s*[^;]*TMDB_METADATA_MAX_AGE_DAYS/);
    expect(source).not.toMatch(/TMDB_METADATA_MAX_AGE_DAYS\s*=\s*[^;]*IMAGE_RETENTION_DAYS/);
  });

  it('T-INV-008c: there is no third 30-ish-day constant, and no list-staleness constant', () => {
    // R9 / A46: the list-staleness nudge was retired outright. A re-introduced
    // LIST_STALENESS_DAYS would be a feature the owner explicitly dropped,
    // arriving disguised as a constant.
    expect(source).not.toMatch(/export const LIST_STALENESS_DAYS/);

    const dayConstants = [...source.matchAll(/^export const (\w*DAYS\w*) =/gm)].map((m) => m[1]);
    expect(dayConstants).toEqual(['IMAGE_RETENTION_DAYS', 'TMDB_METADATA_MAX_AGE_DAYS']);
  });

  it('T-INV-008d: no call site references both constants', () => {
    // Sharing a call site is how two independent policies quietly become one.
    const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

    for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name === 'config.ts') continue;
      const file = join(entry.parentPath, entry.name);
      const text = readFileSync(file, 'utf8');
      expect(
        text.includes('IMAGE_RETENTION_DAYS') && text.includes('TMDB_METADATA_MAX_AGE_DAYS'),
        `${file} references both retention constants; they must never share a call site (US-035 AC-7)`,
      ).toBe(false);
    }
  });
});
