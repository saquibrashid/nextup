import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  IMAGE_RETENTION_DAYS,
  IMDB_RATING_MAX_AGE_DAYS,
  TMDB_METADATA_MAX_AGE_DAYS,
  WATCH_PROVIDER_MAX_AGE_DAYS,
} from '../../src/config.js';

// TASK-014 · US-035 AC-7. A static test, because the property being defended
// is a property of the SOURCE — that these numbers are written down separately,
// independently — and no runtime observation can distinguish that from one
// number aliased to another.
//
// ⚠ The family grew from two to three when ADR-0011 added
// `IMDB_RATING_MAX_AGE_DAYS`, and from three to FOUR when Epic L (ADR-0010)
// added `WATCH_PROVIDER_MAX_AGE_DAYS`. The name "the two 30-ish-day constants"
// is kept for `T-INV-008`'s id stability, but the rule is now n-ary: EVERY
// pair must stay independent, and a new member must extend `DAY_CONSTANTS`
// below rather than be exempted from it.
//
// ⚠ `data-model.md` §17.3, ADR-0010 Trap 5 and `testing.md` §38.2 all call
// `WATCH_PROVIDER_MAX_AGE_DAYS` the "third" such constant. They were written
// before Epic M landed `IMDB_RATING_MAX_AGE_DAYS`, so the ordinal is stale —
// the RULE they state is not. Registering it here is the whole of what they
// ask for; nothing is to be merged to make the count come out at three.

const CONFIG_PATH = fileURLToPath(new URL('../../src/config.ts', import.meta.url));
const source = readFileSync(CONFIG_PATH, 'utf8');

/**
 * The whole family, in declaration order. Adding a member here is the ONLY
 * supported way to add a `*DAYS*` constant — `T-INV-008c` fails otherwise, so
 * a new one cannot be introduced without a deliberate decision about which
 * existing policy it might be confused with.
 */
const DAY_CONSTANTS: ReadonlyArray<readonly [name: string, value: number]> = [
  ['IMAGE_RETENTION_DAYS', 30],
  ['TMDB_METADATA_MAX_AGE_DAYS', 183],
  ['IMDB_RATING_MAX_AGE_DAYS', 14],
  ['WATCH_PROVIDER_MAX_AGE_DAYS', 7],
];

describe('T-INV-008 the 30-ish-day constants stay separate', () => {
  it('T-INV-008a: every constant exists with its specified value', () => {
    expect(IMAGE_RETENTION_DAYS).toBe(30);
    expect(TMDB_METADATA_MAX_AGE_DAYS).toBe(183);
    expect(IMDB_RATING_MAX_AGE_DAYS).toBe(14);
    expect(WATCH_PROVIDER_MAX_AGE_DAYS).toBe(7);
  });

  it('T-INV-008b: each is its own literal declaration, not derived from any other', () => {
    // The failure this prevents: someone "tidies up" similar numbers into one,
    // and a later change to a cache-freshness policy silently rewrites a
    // stated privacy retention promise. The diff looks like housekeeping.
    for (const [name, value] of DAY_CONSTANTS) {
      expect(source).toMatch(new RegExp(`^export const ${name} = ${String(value)};$`, 'm'));
    }

    // No member may be defined in terms of any other, in either direction.
    for (const [a] of DAY_CONSTANTS) {
      for (const [b] of DAY_CONSTANTS) {
        if (a === b) continue;
        expect(source, `${a} must not be derived from ${b}`).not.toMatch(
          new RegExp(`${a}\\s*=\\s*[^;]*${b}`),
        );
      }
    }
  });

  it('T-INV-008c: there is no unregistered day constant, and no list-staleness constant', () => {
    // R9 / A46: the list-staleness nudge was retired outright. A re-introduced
    // LIST_STALENESS_DAYS would be a feature the owner explicitly dropped,
    // arriving disguised as a constant.
    expect(source).not.toMatch(/export const LIST_STALENESS_DAYS/);

    const dayConstants = [...source.matchAll(/^export const (\w*DAYS\w*) =/gm)].map((m) => m[1]);
    expect(dayConstants).toEqual(DAY_CONSTANTS.map(([name]) => name));
  });

  it('T-INV-008d: no call site references two of them', () => {
    // Sharing a call site is how two independent policies quietly become one.
    const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

    for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name === 'config.ts') continue;
      const file = join(entry.parentPath, entry.name);
      const text = readFileSync(file, 'utf8');
      const present = DAY_CONSTANTS.filter(([name]) => text.includes(name)).map(([name]) => name);
      expect(
        present.length,
        `${file} references ${present.join(' and ')}; these policies must never share a call site (US-035 AC-7)`,
      ).toBeLessThan(2);
    }
  });
});

// TASK-184 · US-042 AC-8 · ADR-0010 Trap 5.
//
// `T-INV-008` already forces the whole family apart n-arily, so this could look
// redundant. It is not: `T-AVAIL-008` is the id Epic L is MEASURED by, and it
// names the specific confusion that would make the feature inert rather than
// merely untidy. If someone ever narrows `DAY_CONSTANTS`, this still fails.
describe('T-AVAIL-008 availability age is independent of metadata age', () => {
  it('T-AVAIL-008: WATCH_PROVIDER_MAX_AGE_DAYS is separately declared and not 183', () => {
    expect(source).toMatch(/^export const WATCH_PROVIDER_MAX_AGE_DAYS = 7;$/m);

    // ⚠ Inverting THIS is what makes Epic L inert. Availability is the
    // fast-moving signal the epic exists to catch; a work becomes streamable
    // months before its descriptive metadata changes at all. Bound to 183 days
    // the waiting view would essentially never refresh.
    expect(WATCH_PROVIDER_MAX_AGE_DAYS).not.toBe(TMDB_METADATA_MAX_AGE_DAYS);
    expect(WATCH_PROVIDER_MAX_AGE_DAYS).toBeLessThan(TMDB_METADATA_MAX_AGE_DAYS);

    // Not derived from any sibling, in either direction.
    for (const [name] of DAY_CONSTANTS) {
      if (name === 'WATCH_PROVIDER_MAX_AGE_DAYS') continue;
      expect(source).not.toMatch(new RegExp(`WATCH_PROVIDER_MAX_AGE_DAYS\\s*=\\s*[^;]*${name}`));
    }
  });
});
