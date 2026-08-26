/**
 * TASK-074 — folding stored `batch_change` rows back into the `specs/data-model
 * .md` §3.7 three-array shape (`T-PROV-010`, `T-PROV-011`).
 *
 * ⚠ The interesting cases here are all about NOT DOUBLE-COUNTING. A batch that
 * creates a title writes two rows — `title_created` and `listing_added` — and
 * §3.7 models that as ONE `created` entry carrying both ids. Emitting two
 * would inflate `created.length`, which SD-03's creates-only undo reads to
 * decide what it is allowed to reverse.
 */

import { describe, expect, it } from 'vitest';

import { toBatchProvenance, type BatchChangeRow } from '../src/provenance.js';

const row = (over: Partial<BatchChangeRow>): BatchChangeRow => ({
  kind: 'title_created',
  titleId: null,
  listingId: null,
  attr: null,
  prevValue: null,
  nextValue: null,
  ...over,
});

describe('T-PROV-010 · created', () => {
  it('T-PROV-010c: a title and its listing fold into ONE created entry', () => {
    const provenance = toBatchProvenance([
      row({ kind: 'title_created', titleId: 't1' }),
      row({ kind: 'listing_added', titleId: 't1', listingId: 'l1' }),
    ]);

    expect(provenance.created).toEqual([{ titleId: 't1', listingId: 'l1', titleWasCreated: true }]);
  });

  it('T-PROV-010d: a listing on a PRE-EXISTING title reports titleWasCreated false', () => {
    // The distinction undo needs: this batch may remove the listing it added,
    // but the title was not its to delete.
    const provenance = toBatchProvenance([
      row({ kind: 'listing_added', titleId: 't1', listingId: 'l1' }),
    ]);

    expect(provenance.created).toEqual([
      { titleId: 't1', listingId: 'l1', titleWasCreated: false },
    ]);
  });

  it('T-PROV-010e: a title created with TWO listings claims creation only once', () => {
    // Not reachable from close today (one batch is one service), but the
    // folding rule must not depend on that: a second entry claiming
    // `titleWasCreated: true` would make undo delete a title twice.
    const provenance = toBatchProvenance([
      row({ kind: 'title_created', titleId: 't1' }),
      row({ kind: 'listing_added', titleId: 't1', listingId: 'l1' }),
      row({ kind: 'listing_added', titleId: 't1', listingId: 'l2' }),
    ]);

    expect(provenance.created).toEqual([
      { titleId: 't1', listingId: 'l1', titleWasCreated: true },
      { titleId: 't1', listingId: 'l2', titleWasCreated: false },
    ]);
  });

  it('T-PROV-010f: a created title with NO listing is still reported, not hidden', () => {
    // An integrity problem (I-3) rather than a normal state — but provenance
    // is evidence, and evidence that omits the anomaly is worse than none.
    const provenance = toBatchProvenance([row({ kind: 'title_created', titleId: 't1' })]);

    expect(provenance.created).toEqual([{ titleId: 't1', listingId: null, titleWasCreated: true }]);
  });

  it('T-PROV-010g: a row with no titleId describes nothing undoable and is skipped', () => {
    const provenance = toBatchProvenance([row({ kind: 'listing_added', listingId: 'l1' })]);
    expect(provenance).toEqual({ created: [], modified: [], removed: [] });
  });

  it('T-PROV-010h: an unknown kind is ignored rather than thrown on', () => {
    // Reading rows written by a newer schema must not take out the batch view.
    const provenance = toBatchProvenance([row({ kind: 'something_new', titleId: 't1' })]);
    expect(provenance).toEqual({ created: [], modified: [], removed: [] });
  });
});

describe('T-PROV-011 · removed', () => {
  it('T-PROV-011c: a removed listing carries its group id and beforeState', () => {
    // US-017 undoes a GROUP, not a listing, so an entry without `groupId`
    // cannot be reversed at all. (The WRITE path is TASK-083 to TASK-086;
    // what is pinned here is the shape those tasks must produce.)
    const provenance = toBatchProvenance([
      row({
        kind: 'listing_removed',
        titleId: 't1',
        listingId: 'l1',
        nextValue: JSON.stringify('grp-1'),
      }),
    ]);

    expect(provenance.removed).toEqual([
      { titleId: 't1', listingId: 'l1', beforeState: 'active', groupId: 'grp-1' },
    ]);
  });

  it('T-PROV-011d: a removal row with no listing id is skipped', () => {
    const provenance = toBatchProvenance([row({ kind: 'listing_removed', titleId: 't1' })]);
    expect(provenance.removed).toEqual([]);
  });
});

describe('T-PROV-012 · modified', () => {
  it('T-PROV-012e: a corrected attribute keeps its PRE-BATCH value', () => {
    // REQ-068. The write path is TASK-075; the mapper is pinned here because
    // REQ-075's refusal enumeration reads `modified` directly, and a `before`
    // that arrived as raw JSON text would compare unequal to everything.
    const provenance = toBatchProvenance([
      row({
        kind: 'attr_modified',
        titleId: 't1',
        attr: 'workIdentity',
        prevValue: JSON.stringify('tmdb:movie:1'),
        nextValue: JSON.stringify('tmdb:movie:2'),
      }),
    ]);

    expect(provenance.modified).toEqual([
      { titleId: 't1', attr: 'workIdentity', before: 'tmdb:movie:1', after: 'tmdb:movie:2' },
    ]);
  });

  it('T-PROV-012f: a modification row with no attr is skipped', () => {
    const provenance = toBatchProvenance([row({ kind: 'attr_modified', titleId: 't1' })]);
    expect(provenance.modified).toEqual([]);
  });

  it('T-PROV-012g: an unparseable stored value is surfaced, never dropped', () => {
    // Dropping the row would make an undo REFUSAL look like a permission.
    const provenance = toBatchProvenance([
      row({ kind: 'attr_modified', titleId: 't1', attr: 'workIdentity', prevValue: 'not json' }),
    ]);

    expect(provenance.modified).toEqual([
      { titleId: 't1', attr: 'workIdentity', before: 'not json', after: null },
    ]);
  });
});
