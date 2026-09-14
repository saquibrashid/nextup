// `packages/domain/src/titleRuntime.ts` — buckets, ordering and display
// (REQ-119 / REQ-035 / REQ-037, `specs/ui-refresh.md` §5a).
//
// ⚠ NOT `runtime.spec.ts`, which already exists and is about the JavaScript
// runtime. The two modules share a word and nothing else.

import { describe, expect, it } from 'vitest';

import {
  RUNTIME_BUCKETS,
  compareTitlesByRuntime,
  formatRuntime,
  isKnownRuntime,
  isRuntimeBucket,
  runtimeInAnyBucket,
  runtimeInBucket,
} from '../src/titleRuntime.js';

describe('runtime buckets', () => {
  it('T-UX-123a: the boundaries are half-open, so 60 minutes is in `60-120` and not in `30-60`', () => {
    // The one case that looks arbitrary and is not. With an inclusive upper
    // bound a 60-minute title satisfies BOTH buckets, so the same row appears
    // under two filters and any count over the buckets contradicts the list it
    // describes.
    expect(runtimeInBucket(60, '60-120')).toBe(true);
    expect(runtimeInBucket(60, '30-60')).toBe(false);

    expect(runtimeInBucket(59, '30-60')).toBe(true);
    expect(runtimeInBucket(30, '30-60')).toBe(true);
    expect(runtimeInBucket(29, 'under30')).toBe(true);
    expect(runtimeInBucket(30, 'under30')).toBe(false);
    expect(runtimeInBucket(120, 'over120')).toBe(true);
    expect(runtimeInBucket(119, 'over120')).toBe(false);
    expect(runtimeInBucket(119, '60-120')).toBe(true);
  });

  it('T-UX-123b: every runtime lands in exactly one bucket', () => {
    // The partition property, checked rather than asserted by inspection: any
    // overlap or gap in the bounds table shows up here as a count that is not
    // 1, whichever pair of adjacent buckets the mistake is in.
    for (const minutes of [1, 29, 30, 31, 59, 60, 61, 119, 120, 121, 600]) {
      const hits = RUNTIME_BUCKETS.filter((bucket) => runtimeInBucket(minutes, bucket));
      expect(
        hits,
        `runtime ${String(minutes)} landed in ${hits.join(', ') || 'no bucket'}`,
      ).toHaveLength(1);
    }
  });

  it('T-UX-123c: a ZERO runtime lands in NO bucket — it is unknown, not short', () => {
    // ⚠ THE CONTRADICTION THIS EXISTS TO PREVENT. TMDB returns `runtime: 0`
    // for works it has no runtime for. `under30` is `[null, 30)`, so a naive
    // `< 30` admits it — and the row then appears INSIDE the Under-30m results
    // while displaying "Runtime unknown", is absent from the hidden-unknown
    // count that is supposed to account for it, and sorts first under
    // "Shortest first" as the shortest title the owner owns. Three visible
    // symptoms, one missing floor.
    //
    // Deliberately NOT folded into the partition case above, which asserts
    // exactly one bucket: zero belongs to none, and merging the two would make
    // this case impossible to state.
    for (const minutes of [0, -1]) {
      expect(RUNTIME_BUCKETS.filter((bucket) => runtimeInBucket(minutes, bucket))).toEqual([]);
    }
    expect(runtimeInAnyBucket(0, ['under30'])).toBe(false);
  });

  it('T-UX-122d: isKnownRuntime is the single rule every consumer reads', () => {
    expect(isKnownRuntime(1)).toBe(true);
    expect(isKnownRuntime(155)).toBe(true);
    expect(isKnownRuntime(null)).toBe(false);
    expect(isKnownRuntime(0)).toBe(false);
    expect(isKnownRuntime(-1)).toBe(false);
    expect(isKnownRuntime(Number.NaN)).toBe(false);
    expect(isKnownRuntime(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('T-UX-122e: display, filtering and ordering agree about every unknown value', () => {
    // ⚠ THE CROSS-CONSUMER CHECK. Each rule below is tested on its own above;
    // this asserts they reach the SAME verdict, which is the property that
    // actually broke. A value that formats as unknown, satisfies a bucket and
    // sorts as a number is self-contradictory on screen, and no single-consumer
    // test can see it.
    for (const minutes of [null, 0, -1, Number.NaN]) {
      expect(formatRuntime(minutes, 'movie'), `format(${String(minutes)})`).toBeNull();
      expect(runtimeInAnyBucket(minutes, [...RUNTIME_BUCKETS]), `bucket(${String(minutes)})`).toBe(
        false,
      );
      // Sorts with the unknowns: after a known runtime in BOTH directions.
      const known = { id: 'a', runtimeMinutes: 90 };
      const unknown = { id: 'b', runtimeMinutes: minutes };
      expect(compareTitlesByRuntime(known, unknown, 'asc'), `asc(${String(minutes)})`).toBeLessThan(
        0,
      );
      expect(
        compareTitlesByRuntime(known, unknown, 'desc'),
        `desc(${String(minutes)})`,
      ).toBeLessThan(0);
    }
  });

  it('T-UX-123d: a null runtime satisfies NO bucket and is never treated as zero', () => {
    // Coercing `null` to `0` would file every title TMDB never gave a runtime
    // for under "Under 30m" — a claim that those titles are short, made about
    // titles nothing is known about. This is why `runtimeUnknownHidden` has to
    // exist at all.
    for (const bucket of RUNTIME_BUCKETS) {
      expect(runtimeInBucket(null, bucket)).toBe(false);
    }
    expect(runtimeInAnyBucket(null, ['under30'])).toBe(false);
  });

  it('T-UX-123e: no selected bucket means no filtering — including for a null runtime', () => {
    // The unfiltered list must show every title. If the empty-selection case
    // fell through to `some()` it would return `false` and empty the list.
    expect(runtimeInAnyBucket(null, [])).toBe(true);
    expect(runtimeInAnyBucket(90, [])).toBe(true);
  });

  it('T-UX-123f: buckets are OR-ed within the dimension (US-019 AC-4)', () => {
    expect(runtimeInAnyBucket(20, ['under30', 'over120'])).toBe(true);
    expect(runtimeInAnyBucket(200, ['under30', 'over120'])).toBe(true);
    expect(runtimeInAnyBucket(90, ['under30', 'over120'])).toBe(false);
  });

  it('T-UX-123g: rejects tokens that are not buckets', () => {
    expect(isRuntimeBucket('60-120')).toBe(true);
    expect(isRuntimeBucket('120-60')).toBe(false);
    expect(isRuntimeBucket('')).toBe(false);
    expect(isRuntimeBucket('short')).toBe(false);
  });
});

describe('formatRuntime', () => {
  it('T-UX-121d: film renders `1h 55m` with no `/ep` suffix', () => {
    expect(formatRuntime(115, 'movie')).toBe('1h 55m');
    expect(formatRuntime(115, 'movie')).not.toContain('/ep');
  });

  it('T-UX-121e: TV renders the per-episode suffix', () => {
    // THE SUFFIX IS THE REQUIREMENT. `tmdbClient.readRuntime` takes the first
    // element of TMDB's `episode_run_time` array, so the stored number is ONE
    // EPISODE. A bare `45m` beside a nine-season series is false in the
    // direction that matters, because the owner is choosing what to watch
    // tonight.
    expect(formatRuntime(45, 'tv')).toBe('45m/ep');
    expect(formatRuntime(90, 'tv')).toBe('1h 30m/ep');
  });

  it('T-UX-121f: under an hour renders minutes alone, never `0h 45m`', () => {
    expect(formatRuntime(45, 'movie')).toBe('45m');
    expect(formatRuntime(1, 'movie')).toBe('1m');
  });

  it('T-UX-121g: a whole number of hours drops the minutes', () => {
    expect(formatRuntime(120, 'movie')).toBe('2h');
    expect(formatRuntime(60, 'movie')).toBe('1h');
  });

  it('T-UX-122f: returns null — not a string — when there is no runtime to show', () => {
    // `null` forces the caller to decide what an unknown runtime SAYS, and
    // REQ-119 requires it to say so in words. A default string returned from
    // here would put owner-facing copy outside `apps/web/src/copy.ts` and
    // outside `specs/ui.md` §9's governance.
    expect(formatRuntime(null, 'movie')).toBeNull();
    expect(formatRuntime(null, 'tv')).toBeNull();
  });

  it('T-UX-122g: treats a non-positive or non-finite runtime as unknown', () => {
    // Not defensive hypotheticals: the column is nullable and TMDB stores `0`
    // for works it has no runtime for. `0m` is not a length, and `Infinity`
    // from a corrupt row would render as `Infinityh`.
    expect(formatRuntime(0, 'movie')).toBeNull();
    expect(formatRuntime(-5, 'movie')).toBeNull();
    expect(formatRuntime(Number.NaN, 'movie')).toBeNull();
    expect(formatRuntime(Number.POSITIVE_INFINITY, 'movie')).toBeNull();
  });
});

describe('compareTitlesByRuntime', () => {
  const rows = [
    { id: 'c', runtimeMinutes: 90 },
    { id: 'a', runtimeMinutes: null },
    { id: 'd', runtimeMinutes: 45 },
    { id: 'b', runtimeMinutes: null },
    { id: 'e', runtimeMinutes: 90 },
  ];

  it('T-API-019j: ascending puts nulls LAST, not first', () => {
    // ⚠ SQL Server sorts NULL FIRST on ASC. Without an explicit nulls-last
    // rule, "Shortest first" opens with every title whose runtime is unknown —
    // an absence of data presented as a claim that those titles are shortest.
    const sorted = [...rows].sort((a, b) => compareTitlesByRuntime(a, b, 'asc'));
    expect(sorted.map((row) => row.id)).toEqual(['d', 'c', 'e', 'a', 'b']);
  });

  it('T-API-019k: descending puts nulls last TOO', () => {
    // The asymmetry is the point: nulls-last is decided BEFORE direction, so
    // reversing the sort does not drag the unknowns to the top.
    const sorted = [...rows].sort((a, b) => compareTitlesByRuntime(a, b, 'desc'));
    expect(sorted.map((row) => row.id)).toEqual(['c', 'e', 'd', 'a', 'b']);
  });

  it('T-API-019l: ties break on id ASCENDING in both directions', () => {
    // Mirrors the `id: 'asc'` tie-break the SQL keyset uses in both
    // directions. If this comparator reversed the tie-break under `desc` it
    // would disagree with the query it exists to check, and the disagreement
    // would only appear on a page boundary that fell between two equal
    // runtimes.
    const tied = [
      { id: 'z', runtimeMinutes: 90 },
      { id: 'a', runtimeMinutes: 90 },
    ];
    expect([...tied].sort((a, b) => compareTitlesByRuntime(a, b, 'asc')).map((r) => r.id)).toEqual([
      'a',
      'z',
    ]);
    expect([...tied].sort((a, b) => compareTitlesByRuntime(a, b, 'desc')).map((r) => r.id)).toEqual(
      ['a', 'z'],
    );
  });

  it('T-API-019m: is a total order — no pair compares 0 unless it is the same row', () => {
    for (const a of rows) {
      for (const b of rows) {
        const result = compareTitlesByRuntime(a, b, 'asc');
        if (a.id === b.id) expect(result).toBe(0);
        else expect(result).not.toBe(0);
      }
    }
  });
});
