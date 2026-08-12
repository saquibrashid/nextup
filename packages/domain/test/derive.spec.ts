import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deriveSortDateAdded, deriveTitleState, titleSchema } from '../src/index.js';
import type { ServiceListing } from '../src/index.js';

// TASK-016 — `specs/data-model.md` §5.

function listing(overrides: Partial<ServiceListing> = {}): ServiceListing {
  return {
    listingId: '01J9ZQ0000000000000000LST1',
    service: 'netflix',
    state: 'active',
    dateAdded: '2026-08-11',
    dateAddedEdited: false,
    removedAt: null,
    removedByBatchId: null,
    removedByGroupId: null,
    createdByBatchId: '01J9ZQ0000000000000000BAT1',
    ...overrides,
  };
}

const active = listing();
const max = listing({ listingId: '01J9ZQ0000000000000000LST2', service: 'max' });

describe('T-INV-010 derived title fields', () => {
  it('T-INV-010a: a title is removed only when EVERY listing is removed', () => {
    expect(deriveTitleState([active])).toBe('active');
    expect(deriveTitleState([{ ...active, state: 'removed' }])).toBe('removed');
    // One surviving listing keeps the title active — REQ-028. Getting this
    // backwards hides a title the owner still has on one service.
    expect(deriveTitleState([{ ...active, state: 'removed' }, max])).toBe('active');
    expect(
      deriveTitleState([
        { ...active, state: 'removed' },
        { ...max, state: 'removed' },
      ]),
    ).toBe('removed');
  });

  it('T-INV-010b: a title with no listings throws rather than reporting removed', () => {
    // `[].every(...)` is `true`, so the natural implementation would silently
    // call an impossible title "removed" — invariant I-3 says it cannot exist.
    expect(() => deriveTitleState([])).toThrow(RangeError);
  });

  it('T-INV-010c: sortDateAdded is the EARLIEST date across non-removed listings', () => {
    expect(deriveSortDateAdded([active])).toBe('2026-08-11');
    expect(
      deriveSortDateAdded([
        { ...active, dateAdded: '2026-08-11' },
        { ...max, dateAdded: '2025-01-02' },
      ]),
    ).toBe('2025-01-02');
    // Order of the input must not matter.
    expect(
      deriveSortDateAdded([
        { ...max, dateAdded: '2025-01-02' },
        { ...active, dateAdded: '2026-08-11' },
      ]),
    ).toBe('2025-01-02');
  });

  it('T-INV-010d: adding a work on a second service does not move the row (US-020 AC-4)', () => {
    // The row's position is owned by the FIRST time the owner saved the work,
    // not the most recent time. `T-LIST-014` asserts the same thing end to end.
    const before = deriveSortDateAdded([{ ...active, dateAdded: '2025-01-02' }]);
    const after = deriveSortDateAdded([
      { ...active, dateAdded: '2025-01-02' },
      { ...max, dateAdded: '2026-08-11' },
    ]);
    expect(after).toBe(before);
  });

  it('T-INV-010e: removing the earliest listing recomputes the value (US-020 AC-5)', () => {
    const after = deriveSortDateAdded([
      { ...active, dateAdded: '2025-01-02', state: 'removed' },
      { ...max, dateAdded: '2026-08-11' },
    ]);
    expect(after).toBe('2026-08-11');
  });

  it('T-INV-010f: a fully removed title has sortDateAdded null (US-020 AC-7)', () => {
    expect(
      deriveSortDateAdded([
        { ...active, state: 'removed' },
        { ...max, state: 'removed' },
      ]),
    ).toBeNull();
    expect(deriveSortDateAdded([])).toBeNull();
  });

  it('T-INV-010g: dates compare lexicographically, so no timezone can shift a day', () => {
    // YYYY-MM-DD sorts chronologically as text. Parsing to Date would let a
    // local timezone move a listing across a day boundary and reorder the list.
    const dates = ['2026-01-09', '2026-01-10', '2025-12-31', '2026-02-01'];
    const listings = dates.map((d, i) =>
      listing({ listingId: `01J9ZQ000000000000000LS${i}`, dateAdded: d }),
    );
    expect(deriveSortDateAdded(listings)).toBe('2025-12-31');
  });

  it('T-INV-010h: the title schema refuses a title whose derived fields disagree', () => {
    // Invariant I-4 enforced at the boundary: no fixture, backfill or
    // hand-built response can put an inconsistent title into circulation.
    const base = {
      id: '01J9ZQ0000000000000000TTL1',
      type: 'title' as const,
      ownerId: 'o_9f2c1a7b',
      workIdentity: 'tmdb:movie:438631',
      matchState: 'matched' as const,
      rawExtractedText: null,
      normalisedText: null,
      createdByBatchId: '01J9ZQ0000000000000000BAT1',
      visible: true,
      listings: [{ ...active, dateAdded: '2025-01-02' }],
      tmdb: {
        tmdbId: 438631,
        mediaType: 'movie' as const,
        name: 'Dune',
        releaseYear: 2021,
        runtimeMinutes: 155,
        genres: ['Science Fiction'],
        posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
        fetchedAt: '2026-08-11T21:04:33.000Z',
      },
      createdAt: '2026-08-11T21:04:33.000Z',
      updatedAt: '2026-08-11T21:04:33.000Z',
    };

    expect(
      titleSchema.safeParse({ ...base, state: 'active', sortDateAdded: '2025-01-02' }).success,
    ).toBe(true);
    // Wrong sort date — the row would sort into the wrong place, silently.
    expect(
      titleSchema.safeParse({ ...base, state: 'active', sortDateAdded: '2026-08-11' }).success,
    ).toBe(false);
    // Wrong state — the title would look removed while a listing survives.
    expect(
      titleSchema.safeParse({ ...base, state: 'removed', sortDateAdded: '2025-01-02' }).success,
    ).toBe(false);
  });
});

describe('T-INV-009 the derivation exists in exactly one place', () => {
  const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const SCAN_DIRS = ['packages/domain/src', 'apps/api/src', 'apps/web/src'];
  const ALLOWED = 'packages/domain/src/derive.ts';

  function sources(): Array<{ path: string; text: string }> {
    const out: Array<{ path: string; text: string }> = [];
    for (const dir of SCAN_DIRS) {
      let entries;
      try {
        entries = readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true });
      } catch {
        continue; // A workspace whose src/ does not exist yet is not a finding.
      }
      for (const entry of entries) {
        if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
        const full = join(entry.parentPath, entry.name);
        const rel = full.slice(ROOT.length).split('\\').join('/');
        if (rel === ALLOWED) continue;
        out.push({ path: rel, text: readFileSync(full, 'utf8') });
      }
    }
    return out;
  }

  it('T-INV-009a: no second implementation of deriveTitleState', () => {
    // A copy cannot be kept in step with the original, and when it drifts
    // nothing throws — a title just reports the wrong state.
    const reimplementation = /\.every\s*\(\s*\(?\s*\w+\s*\)?\s*=>[^)]*['"]removed['"]/;
    for (const { path, text } of sources()) {
      expect(reimplementation.test(text), `${path} appears to re-derive title state`).toBe(false);
    }
  });

  it('T-INV-009b: no second implementation of deriveSortDateAdded', () => {
    // Matches the shape of the spec's own reference implementation: filtering
    // listings by state and reaching for dateAdded.
    const reimplementation = /dateAdded[\s\S]{0,120}\.sort\s*\(|\.sort\s*\([\s\S]{0,120}dateAdded/;
    for (const { path, text } of sources()) {
      expect(reimplementation.test(text), `${path} appears to re-derive sortDateAdded`).toBe(false);
    }
  });

  it('T-INV-009c: the scan actually reaches source files', () => {
    // Without this, a broken path would make the two greps above pass over an
    // empty set — a green test asserting nothing, which is worse than a red one.
    const scanned = sources();
    expect(scanned.length).toBeGreaterThan(3);
    expect(scanned.some((f) => f.path === 'packages/domain/src/schemas.ts')).toBe(true);
    expect(scanned.some((f) => f.path === ALLOWED)).toBe(false);
  });

  it('T-INV-009d: the greps fire on a real re-implementation', () => {
    // Proves the patterns match the thing they claim to forbid, rather than
    // being satisfied by a codebase that happens not to contain it.
    const stateCopy = "return listings.every((l) => l.state === 'removed') ? 'removed' : 'active';";
    const sortCopy =
      "const dates = listings.filter((l) => l.state !== 'removed').map((l) => l.dateAdded).sort();";
    expect(/\.every\s*\(\s*\(?\s*\w+\s*\)?\s*=>[^)]*['"]removed['"]/.test(stateCopy)).toBe(true);
    expect(
      /dateAdded[\s\S]{0,120}\.sort\s*\(|\.sort\s*\([\s\S]{0,120}dateAdded/.test(sortCopy),
    ).toBe(true);
  });
});
