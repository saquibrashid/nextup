/**
 * TASK-042 - the freshness strip (`specs/ui.md` §2.1, REQ-039, US-022).
 *
 * Test: `T-FRESH-014` - if the dates cannot be computed, the list still renders
 * and the strip degrades visibly.
 *
 * ⚠ FINDING - no test id covers the SECOND half of REQ-039: `specs/ui.md` §2.1
 * requires clicking a chip to open `/upload` **with that service pre-selected**,
 * and `specs/testing.md` §9's US-022 table runs AC-1/3/4/5, none of which is
 * that. The link itself is asserted below as part of `T-FRESH-014i` (a degraded
 * strip must not lose the affordance), but `/upload` consuming `?service=` is
 * NOT built here: the `T-META-004` lint rule rightly forbids an unnamed test,
 * and squatting a `T-FRESH-*` number would make an unallocated id report as
 * covered. `T-FRESH-016` is requested.
 *
 * ⚠ The strip is the mitigation for RSK-007 (the list going out of date without
 * the owner noticing), so its failure mode matters more than its happy path: a
 * strip that renders nothing when the payload is missing looks EXACTLY like a
 * strip reporting that everything is current.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { serviceFreshnessLabel } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

import {
  FreshnessStrip,
  uploadPathFor,
  type ServiceFreshness,
} from '../src/components/FreshnessStrip';
import { ListPage } from '../src/pages/ListPage';
import { FRESHNESS_UNAVAILABLE } from '../src/copy';
import type { TitleListItem } from '../src/components/TitleRow';

const NETFLIX_TODAY: ServiceFreshness = {
  service: 'netflix',
  lastCompletedBatchAt: '2026-08-10T20:19:44.007Z',
  lastCompletedBatchId: '01J8ZF',
  ageDays: 0,
  label: 'Netflix updated today',
};

const MAX_NEVER: ServiceFreshness = {
  service: 'max',
  lastCompletedBatchAt: null,
  lastCompletedBatchId: null,
  ageDays: null,
  label: 'Max has never been updated',
};

const DUNE: TitleListItem = {
  titleId: '01J8ZC',
  workIdentity: 'tmdb:movie:438631',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  releaseYear: 2021,
  genres: ['Science Fiction'],
  runtimeMinutes: 155,
  posterPath: null,
  badges: [{ service: 'netflix', listingId: '01J8ZD', dateAdded: '2026-04-02' }],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

function renderStrip(services: readonly ServiceFreshness[] | null): HTMLElement {
  render(
    <MemoryRouter>
      <FreshnessStrip services={services} />
    </MemoryRouter>,
  );
  return screen.getByTestId('freshness-strip');
}

describe('T-FRESH-014 - the strip degrades visibly and never takes the list with it', () => {
  it('T-FRESH-014a renders both factual labels verbatim when the dates are available', () => {
    const strip = renderStrip([NETFLIX_TODAY, MAX_NEVER]);

    expect(within(strip).getByTestId('freshness-label-netflix').textContent).toBe(
      'Netflix updated today',
    );
    expect(within(strip).getByTestId('freshness-label-max').textContent).toBe(
      'Max has never been updated',
    );
    expect(strip).not.toHaveAttribute('data-degraded');
    expect(within(strip).queryByTestId('freshness-degraded')).toBeNull();
  });

  it('T-FRESH-014b degrades visibly, not silently, when the payload is missing entirely', () => {
    const strip = renderStrip(null);

    // The assertion that matters: something the owner can SEE says the dates
    // are unknown. An empty strip is indistinguishable from a healthy one.
    expect(within(strip).getByTestId('freshness-degraded')).toHaveTextContent(
      FRESHNESS_UNAVAILABLE,
    );
    expect(strip).toHaveAttribute('data-degraded', 'true');
    expect(within(strip).getByTestId('freshness-label-netflix').textContent).toBe(
      FRESHNESS_UNAVAILABLE,
    );
    expect(within(strip).getByTestId('freshness-label-max').textContent).toBe(
      FRESHNESS_UNAVAILABLE,
    );
  });

  it('T-FRESH-014c never reports a missing date as "never updated"', () => {
    const strip = renderStrip(null);

    // "Never updated" is a FACT about the owner's history (US-022 AC-3). Saying
    // it from absent data is a fabrication, and it is the precise misreading
    // `T-FRESH-012` exists to prevent - in reverse.
    expect(strip.textContent ?? '').not.toContain('never been updated');
    expect(strip.textContent ?? '').not.toMatch(/never|error|failed/i);
  });

  it('T-FRESH-014d degrades only the service actually missing from a partial payload', () => {
    const strip = renderStrip([NETFLIX_TODAY]);

    expect(within(strip).getByTestId('freshness-label-netflix').textContent).toBe(
      'Netflix updated today',
    );
    expect(within(strip).getByTestId('freshness-label-max').textContent).toBe(
      FRESHNESS_UNAVAILABLE,
    );
    expect(strip).toHaveAttribute('data-degraded', 'true');
  });

  it('T-FRESH-014e keeps both chips identifiable by service while degraded', () => {
    const strip = renderStrip(null);

    expect(within(strip).getByTestId('freshness-service-netflix')).toHaveTextContent('Netflix');
    expect(within(strip).getByTestId('freshness-service-max')).toHaveTextContent('Max');
  });

  it('T-FRESH-014f falls back to the domain wording, not a local sentence, for an empty label', () => {
    const strip = renderStrip([{ ...MAX_NEVER, label: '' }, NETFLIX_TODAY]);

    expect(within(strip).getByTestId('freshness-label-max').textContent).toBe(
      serviceFreshnessLabel('max', null),
    );
  });

  it('T-FRESH-014g renders the list unchanged while the strip is degraded', () => {
    render(
      <MemoryRouter>
        <ListPage items={[DUNE]} serviceState={null} />
      </MemoryRouter>,
    );

    // §2.1: the strip is informational and never blocks the list.
    expect(screen.getByTestId('freshness-degraded')).toBeInTheDocument();
    expect(screen.getByTestId('title-name')).toHaveTextContent('Dune');
    expect(screen.getByTestId('date-added-label')).toHaveTextContent('Added to nextup 2 Apr 2026');
  });

  it('T-FRESH-014h states a fact and never nags, degraded or not (A46)', () => {
    render(
      <MemoryRouter>
        <FreshnessStrip services={[NETFLIX_TODAY, MAX_NEVER]} />
      </MemoryRouter>,
    );
    const healthy = screen.getByTestId('freshness-strip').textContent ?? '';
    render(
      <MemoryRouter>
        <FreshnessStrip services={null} />
      </MemoryRouter>,
    );
    const degraded = screen.getAllByTestId('freshness-strip')[1]?.textContent ?? '';

    // `A46` deleted the staleness nudge outright. The forbidden wording is
    // asserted directly because there is no longer any code to point at.
    for (const text of [healthy, degraded]) {
      expect(text).not.toMatch(
        /you haven'?t|time to|should update|remember to|don'?t forget|out of date|overdue|update now/i,
      );
    }
  });
});

describe('REQ-039 strip navigation', () => {
  it('T-FRESH-014i keeps the chip links identical whether or not the dates resolved', () => {
    const healthy = renderStrip([NETFLIX_TODAY, MAX_NEVER]);
    const healthyHrefs = ['netflix', 'max'].map((service) =>
      within(healthy).getByTestId(`freshness-chip-${service}`).getAttribute('href'),
    );
    cleanup();
    const degraded = renderStrip(null);
    const degradedHrefs = ['netflix', 'max'].map((service) =>
      within(degraded).getByTestId(`freshness-chip-${service}`).getAttribute('href'),
    );

    // Degrading VISIBLY (`T-FRESH-014`) must not mean degrading FUNCTIONALLY:
    // the route to `/upload` is the owner's only way to fix the very thing the
    // degraded strip is reporting, and a chip that stops linking when the
    // payload fails would remove it exactly when it is needed. Making the link
    // conditional on an age instead is how the `A46`-deleted nudge returns.
    expect(healthyHrefs).toEqual(['/upload?service=netflix', '/upload?service=max']);
    expect(degradedHrefs).toEqual(healthyHrefs);
    expect(uploadPathFor('netflix')).toBe('/upload?service=netflix');
  });
});
