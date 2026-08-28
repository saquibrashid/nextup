/**
 * TASK-120 - `T-UI-022`: `/about` states what nextup does with the owner's
 * images, their removed titles, and their behaviour (`specs/ui.md` §8).
 *
 * ⚠ Why this suite exists at all. US-035's tests are *all* integration
 * retention and purge tests (`T-RET-011/012/013`, `T-INFRA-004`). Every one of
 * them proves the system behaves correctly; not one of them looks at the page
 * that tells the owner what that behaviour IS. The whole promise of REQ-028 -
 * "nothing is lost without asking you first" - is only kept if the owner can
 * find out, before they upload anything, that screenshots go after 30 days and
 * removed titles do not. A correct backend behind a page that says nothing, or
 * says something else, fails the user-visible half of the requirement while
 * every backend test stays green.
 *
 * ⚠ Byte-equality, not `toContain`. A reworded retention promise is a different
 * promise: "kept for about a month", "kept for 30 days or so", or a version
 * that quietly drops "then deleted automatically" all satisfy a substring check
 * and all change what the owner has been told.
 *
 * ⚠ Invariant 8. The sentence on this page is the 30-day IMAGE retention
 * (NFR-019). It is not, and must never be derived from, the 183-day TMDB
 * metadata refresh age (NFR-014). `T-UI-022f` asserts the two never converge
 * here - the page is where a merge of the two constants would first become
 * visible to the owner, and it would read as a plausible sentence.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import {
  ABOUT_NO_ANALYTICS,
  ABOUT_REMOVED_KEPT_FOREVER,
  ABOUT_TMDB_USE,
  IMAGE_RETENTION_STATEMENT,
} from '../src/copy';

/**
 * `specs/ui.md` §630 gives this sentence verbatim. Written out ONCE here and
 * nowhere else in the suite: a test that compared the constant to itself would
 * pass whatever the constant said.
 *
 * The other three constants are not fixed verbatim by any spec, so they are
 * asserted for byte-equality against the constant (which catches a divergence
 * between the page and the copy module) *and* for the substantive claims §8
 * requires them to make (which catches a rewrite of the constant itself).
 */
const REQUIRED_RETENTION_WORDING =
  'Screenshots are kept for 30 days so you can re-extract them, then deleted automatically.';

function renderAbout() {
  return render(
    <MemoryRouter initialEntries={['/about']}>
      <App />
    </MemoryRouter>,
  );
}

/**
 * The visible text of the element that renders `text`.
 *
 * `getByText` + `.textContent`, never `toHaveTextContent`: the matcher
 * normalises whitespace, which is exactly the class of difference this suite
 * exists to catch.
 */
function visibleText(text: string): string {
  return screen.getByText(text).textContent ?? '';
}

describe('T-UI-022 · US-035 AC-6 · /about states retention, never-delete and no-analytics', () => {
  it('T-UI-022a: the retention constant is byte-equal to the wording specs/ui.md §8 requires', () => {
    expect(IMAGE_RETENTION_STATEMENT).toBe(REQUIRED_RETENTION_WORDING);
    // Code-point equality, not string equality alone: a curly apostrophe, a
    // non-breaking space or a trailing space would satisfy a looser check and
    // still be a change to the promise.
    expect([...IMAGE_RETENTION_STATEMENT].map((c) => c.codePointAt(0))).toStrictEqual(
      [...REQUIRED_RETENTION_WORDING].map((c) => c.codePointAt(0)),
    );
  });

  it('T-UI-022b: /about renders the retention statement byte-equal to the constant', () => {
    renderAbout();
    expect(visibleText(REQUIRED_RETENTION_WORDING)).toBe(IMAGE_RETENTION_STATEMENT);
  });

  it('T-UI-022c: /about renders the never-delete statement byte-equal to the constant', () => {
    renderAbout();
    expect(visibleText(ABOUT_REMOVED_KEPT_FOREVER)).toBe(ABOUT_REMOVED_KEPT_FOREVER);
  });

  it('T-UI-022d: /about renders the no-analytics statement byte-equal to the constant', () => {
    renderAbout();
    expect(visibleText(ABOUT_NO_ANALYTICS)).toBe(ABOUT_NO_ANALYTICS);
  });

  it('T-UI-022e: /about renders what TMDB is used for, byte-equal to the constant', () => {
    renderAbout();
    expect(visibleText(ABOUT_TMDB_USE)).toBe(ABOUT_TMDB_USE);
  });

  it('T-UI-022f: invariant 8 · the retention sentence names 30 days and never 183', () => {
    // The failure this guards is a merge of `IMAGE_RETENTION_DAYS` (30, NFR-019)
    // with `TMDB_METADATA_MAX_AGE_DAYS` (183, NFR-014). Either direction reads
    // as a perfectly plausible English sentence, so nothing else would notice.
    expect(IMAGE_RETENTION_STATEMENT).toMatch(/\b30 days\b/);
    expect(IMAGE_RETENTION_STATEMENT).not.toMatch(/\b183\b/);
    expect(IMAGE_RETENTION_STATEMENT.toLowerCase()).not.toContain('metadata');
  });

  it('T-UI-022g: the retention sentence promises deletion, not merely a retention period', () => {
    // "Screenshots are kept for 30 days" alone is true of a system that keeps
    // them forever. The second clause is the part that is a promise.
    expect(IMAGE_RETENTION_STATEMENT).toContain('then deleted automatically');
  });

  it('T-UI-022h: REQ-028 · the never-delete copy promises FOREVER and no silent loss', () => {
    // A rewrite to "kept for a while" or "kept in Removal history" would satisfy
    // a substring check on "Removal history" while retracting the guarantee.
    const copy = ABOUT_REMOVED_KEPT_FOREVER.toLowerCase();
    expect(copy).toContain('forever');
    expect(copy).toContain('removal history');
    // REQ-028 is soft-delete-forever with no TTL and nothing scheduled. Any
    // period named here would contradict it.
    expect(ABOUT_REMOVED_KEPT_FOREVER).not.toMatch(/\b\d+\s*(day|days|month|months|year|years)\b/);
  });

  it('T-UI-022i: NFR-005 · the no-analytics copy is unconditional', () => {
    const copy = ABOUT_NO_ANALYTICS.toLowerCase();
    expect(copy).toContain('no analytics');
    expect(copy).toContain('telemetry');
    // Nothing is collected, so there is nothing to opt out of. Any hedge -
    // "anonymous", "aggregate", "opt out", "only" - is a different claim.
    for (const hedge of ['anonymous', 'aggregate', 'opt out', 'opt-out', 'except']) {
      expect(copy).not.toContain(hedge);
    }
  });

  it('T-UI-022j: all four statements are VISIBLE text, not titles or aria-labels', () => {
    renderAbout();
    // The §8 obligation is discharged by text the owner can read. A `title`
    // attribute or an `aria-label` would be found by a naive DOM query and
    // shown to nobody.
    for (const copy of [
      IMAGE_RETENTION_STATEMENT,
      ABOUT_REMOVED_KEPT_FOREVER,
      ABOUT_NO_ANALYTICS,
      ABOUT_TMDB_USE,
    ]) {
      const node = screen.getByText(copy);
      expect(node.textContent).toBe(copy);
      expect(node.getAttribute('aria-label')).toBeNull();
      expect(node.getAttribute('title')).toBeNull();
    }
  });

  it('T-UI-022k: the four statements are four distinct elements, not one run-on block', () => {
    renderAbout();
    const nodes = [
      screen.getByText(IMAGE_RETENTION_STATEMENT),
      screen.getByText(ABOUT_REMOVED_KEPT_FOREVER),
      screen.getByText(ABOUT_NO_ANALYTICS),
      screen.getByText(ABOUT_TMDB_USE),
    ];
    expect(new Set(nodes).size).toBe(4);
  });
});
