/**
 * TASK-184 — `T-WAIT-011`. `WatchIntent.discoveredAt` must NEVER feed the
 * REQ-038 title-level date sort, which is defined over
 * `ServiceListing.dateAdded` (`specs/data-model.md` §17.1).
 *
 * ⚠ WHY A STRUCTURAL TEST RATHER THAN A BEHAVIOURAL ONE. The defect this
 * guards is a silently WRONG ORDER, not a crash or an error: a discovery date
 * folded into `sortDateAdded` would place a waiting title among works the
 * owner actually saved, dated the day they browsed a storefront. Every list
 * would still render, every existing assertion would still pass, and the only
 * symptom would be an ordering the owner cannot explain. The fields are both
 * `datetime2` and both plausibly "when this showed up", so the mistake is a
 * one-word edit that reads like a fix.
 *
 * The rule is therefore stated over the SOURCE: the two date families never
 * meet in a file that computes list order.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Every `.ts` file under a root, recursively. */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name));
}

const ROOTS = [
  fileURLToPath(new URL('../../src/', import.meta.url)),
  fileURLToPath(new URL('../../../../packages/domain/src/', import.meta.url)),
];

const ALL = ROOTS.flatMap(sourceFiles);

/** The list-order vocabulary, in code and in SQL. */
const SORT_KEY = /sortDateAdded|sort_date_added/;
/** The discovery-date vocabulary, in code and in SQL. */
const DISCOVERY_DATE = /discoveredAt|discovered_at/;
/** Where order is actually expressed. */
const ORDERS = /orderBy|ORDER\s+BY|compare|sort\(/;

/**
 * ⚠ DECLARATION SURFACES ARE EXEMPT, AND MUST BE. `types.ts` and `schemas.ts`
 * name every field of every document, so they mention the sort key and the
 * discovery date unavoidably and harmlessly — the whole point of a type is to
 * say the field exists. Exempting them would be a hole if they could also
 * ORDER things, so `T-WAIT-011d` proves they cannot.
 */
const DECLARATION_ONLY = ['types.ts', 'schemas.ts'];

function isDeclarationSurface(file: string): boolean {
  return DECLARATION_ONLY.some(
    (name) => file.endsWith(`domain\\src\\${name}`) || file.endsWith(`domain/src/${name}`),
  );
}

describe('T-WAIT-011 a discovery date never feeds the list sort', () => {
  it('T-WAIT-011: no file computing list order references a discovery date', () => {
    // ⚠ VACUITY GUARD FIRST. If the scan found no files, or the sort key were
    // renamed out from under this test, every assertion below would pass while
    // checking nothing at all.
    expect(ALL.length).toBeGreaterThan(20);

    const sorters = ALL.filter((f) => SORT_KEY.test(readFileSync(f, 'utf8'))).filter(
      (f) => !isDeclarationSurface(f),
    );
    expect(
      sorters.length,
      'no file references the list sort key — has it been renamed?',
    ).toBeGreaterThan(3);

    for (const file of sorters) {
      const text = readFileSync(file, 'utf8');
      // A file may legitimately mention the discovery date in prose warning
      // against exactly this, so only CODE is considered: strip line comments,
      // block comments and the `///` Prisma-doc form before matching.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^\s*--.*$/gm, '');
      expect(
        DISCOVERY_DATE.test(code),
        `${file} computes list order AND references a discovery date; ` +
          'REQ-038 is defined over ServiceListing.dateAdded only (data-model.md §17.1)',
      ).toBe(false);
    }
  });

  it('T-WAIT-011b: the ordering rule itself names only the listing date', () => {
    // The single place the rule is stated (TASK-036, US-020). Asserted
    // separately from the sweep above so that deleting `ordering.ts` — which
    // would empty the sweep's file list for the one file that matters most —
    // still fails.
    const ordering = readFileSync(
      fileURLToPath(new URL('../../../../packages/domain/src/ordering.ts', import.meta.url)),
      'utf8',
    );
    expect(SORT_KEY.test(ordering)).toBe(true);
    expect(DISCOVERY_DATE.test(ordering)).toBe(false);
  });

  it('T-WAIT-011c: no SQL orders by a discovery date', () => {
    const migrations = fileURLToPath(new URL('../../../../prisma/migrations/', import.meta.url));
    const sql = readdirSync(migrations, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.sql'))
      .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
      .join('\n')
      .replace(/^\s*--.*$/gm, '');

    expect(sql).not.toMatch(/ORDER\s+BY[^;]*discovered_at/i);
    // The waiting-view index is keyed on the availability check, not the
    // discovery date; an index on `discovered_at` would be the first sign
    // someone is sorting by it.
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX[^;]*\(\s*[^)]*discovered_at/i);
  });

  it('T-WAIT-011d: the exempted declaration surfaces cannot express an order', () => {
    // Closes the hole opened by DECLARATION_ONLY. If either file ever gains a
    // comparator or an `orderBy`, it stops being a declaration surface and its
    // exemption above becomes a way to smuggle the discovery date into the
    // sort unobserved.
    const declared = ALL.filter(isDeclarationSurface);
    expect(declared, 'the exemption list matched no file — a rename made it vacuous').toHaveLength(
      DECLARATION_ONLY.length,
    );
    for (const file of declared) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(
        ORDERS.test(code),
        `${file} is exempted as a declaration surface but expresses an order`,
      ).toBe(false);
    }
  });
});
