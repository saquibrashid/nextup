/**
 * `T-UX-017` — `specs/ux-states.md` §2.8 **Partial data — TMDB stale**:
 * *"Rows render from stored metadata; a subtle chip 'Details may be out of
 * date' on affected rows"*, and the user can still do *"Everything,
 * normally"*.
 *
 * ⚠ **"STALE" IS OVERLOADED IN THIS PRODUCT, AND THIS IS THE OTHER ONE**
 * (product invariant 8). A46 deleted the freshness-strip staleness nudge
 * whole — no threshold, no nag, no derived state — and `specs/ui.md` §2.1
 * item 1 says so in the same breath as "the stale chip". That sentence is
 * about how long ago the OWNER last uploaded. This chip is TMDB's 183-day
 * lazy refresh (NFR-014, REQ-076, `specs/api.md` §6.4) failing or timing out
 * while serving one page, which is still required. Deleting this because it
 * says "stale" breaks the metadata pipeline's only user-visible signal.
 *
 * ⚠ **THE FLAG WAS ALREADY ON THE WIRE.** `apps/api/src/routes/titles.ts`
 * has emitted `metadataStale` on every item since the refresh landed, and
 * `apiClient` casts the parsed JSON straight through — so the value has been
 * arriving in the browser and being dropped for want of a field on the type.
 * `T-UX-017f` is the case that would have caught that, because every other
 * case here builds its own item and passes with the type change reverted only
 * if TypeScript is ignored.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { ListRoute } from '../src/containers/ListRoute';
import { TitleRow, type TitleListItem } from '../src/components/TitleRow';
import { METADATA_STALE_CHIP } from '../src/copy';
import type { ApiClient } from '../src/lib/apiClient';

afterEach(cleanup);

function item(overrides: Partial<TitleListItem> = {}): TitleListItem {
  return {
    titleId: 'ttl_1',
    workIdentity: 'tmdb:movie:603',
    matchState: 'matched',
    name: 'The Matrix',
    mediaType: 'movie',
    releaseYear: 1999,
    genres: ['Action', 'Science Fiction'],
    runtimeMinutes: 136,
    posterPath: '/poster.jpg',
    badges: [{ service: 'netflix', listingId: 'lst_1', dateAdded: '2026-01-04' }],
    sortDateAdded: '2026-01-04',
    dateAddedLabel: 'Added to nextup on 4 Jan 2026',
    imdbRating: 8.7,
    ...overrides,
  };
}

function renderRow(overrides: Partial<TitleListItem> = {}): void {
  render(
    <MemoryRouter>
      <ul>
        <TitleRow item={item(overrides)} onOpenMenu={() => undefined} />
      </ul>
    </MemoryRouter>,
  );
}

describe('T-UX-017 partial data — TMDB stale', () => {
  it('T-UX-017a: a stale row carries the chip, worded as the spec words it', () => {
    renderRow({ metadataStale: true });

    const chip = screen.getByTestId('metadata-stale-chip');
    expect(chip).toHaveTextContent(METADATA_STALE_CHIP);
    // Transcribed, not paraphrased: "may be" is the honest claim. The server
    // could not CONFIRM the stored copy; it never established it was wrong.
    expect(METADATA_STALE_CHIP).toBe('Details may be out of date');
  });

  it('T-UX-017b: a fresh row carries no chip at all', () => {
    renderRow({ metadataStale: false });

    expect(screen.queryByTestId('metadata-stale-chip')).toBeNull();
    expect(screen.queryByText(METADATA_STALE_CHIP)).toBeNull();
  });

  it('T-UX-017c: an item with no flag at all is treated as fresh', () => {
    /*
      The API is the only writer of this field. An item without it is an older
      payload or a fixture, and the safe reading of an unknown is "not
      flagged" — chipping every row that omits the field would put a warning
      on a list where nothing is actually unconfirmed.
    */
    renderRow();

    expect(screen.queryByTestId('metadata-stale-chip')).toBeNull();
  });

  it('T-UX-017d: the row still renders its stored metadata in full', () => {
    /*
      ⚠ THE HALF OF §2.8 THAT IS EASIEST TO GET WRONG. "Rows render from
      stored metadata" — the flag is not an error state, and the list
      deliberately succeeds rather than failing on TMDB (`specs/api.md` §6.4:
      "The list never fails because of TMDB"). An implementation that blanked
      the poster, hid the genres, or swapped the row for a placeholder would
      pass every other case in this file while destroying the data the spec
      says to show.
    */
    renderRow({ metadataStale: true });

    expect(screen.getByTestId('title-name')).toHaveTextContent('The Matrix');
    expect(screen.getByTestId('genres')).toHaveTextContent('Action, Science Fiction');
    expect(screen.getByTestId('release-year')).toHaveTextContent('1999');
    expect(screen.getByTestId('poster')).toBeInTheDocument();
    expect(screen.getByTestId('imdb-rating-value')).toHaveTextContent('8.7');
    expect(screen.getByTestId('date-added-label')).toHaveTextContent('Added to nextup on 4 Jan');
  });

  it('T-UX-017e: the row stays fully interactive — "everything, normally"', () => {
    /*
      §2.8's "user can" column is *"Everything, normally"*. Nothing is in
      flight and nothing is broken, so — unlike §2.13's pending state — the
      row menu must NOT be disabled and the row must NOT report itself busy.
    */
    renderRow({ metadataStale: true });

    expect(screen.getByTestId('row-menu')).toBeEnabled();
    expect(screen.getByTestId('title-row-ttl_1')).not.toHaveAttribute('aria-busy');
    expect(screen.queryByTestId('row-pending')).toBeNull();
  });

  it('T-UX-017f: the flag survives the round trip from the API response', async () => {
    /*
      ⚠ THE WIRING CASE. Every case above hands `TitleRow` an object the test
      built, so all of them pass on a build where the field is stripped
      somewhere between `fetch` and the row — which is exactly the state this
      screen was in: the server has always sent `metadataStale`, and the SPA
      dropped it because no type declared it. This case is the only one that
      fails if the value cannot travel.
    */
    const client = {
      getTitles: async () => ({
        items: [item({ titleId: 'ttl_9', name: 'Arrival', metadataStale: true })],
        nextCursor: null,
        limit: 50,
      }),
      getServiceState: async () => ({ services: [] }),
      getSuppressions: async () => ({ items: [] }),
      getRemoved: async () => ({ items: [], nextCursor: null, limit: 50 }),
      getMe: async () => ({}),
    } as unknown as ApiClient;

    render(
      <MemoryRouter initialEntries={['/']}>
        <ListRoute client={client} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Arrival')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('metadata-stale-chip')).toHaveTextContent(METADATA_STALE_CHIP);
    });
  });

  it('T-UX-017g: an unmatched title can be stale too — both chips render', () => {
    /*
      The two states are independent. An unmatched row still carries stored
      metadata TMDB can fail to confirm, and writing the chips as one
      `unmatched ? … : …` branch would drop the stale signal on precisely the
      rows whose data the owner trusts least.
    */
    renderRow({ metadataStale: true, matchState: 'unmatched' });

    expect(screen.getByTestId('unidentified-chip')).toBeInTheDocument();
    expect(screen.getByTestId('metadata-stale-chip')).toBeInTheDocument();
  });

  it('T-UX-017h: the chip does not interrupt — it is not a live region', () => {
    /*
      "Subtle" (§2.8) and "everything, normally" together rule out `role=
      "alert"` and `role="status"`. There is no action for the owner to take
      and the refresh retries itself on the next view, so announcing it over
      whatever they were reading would be noise. It must still BE in the
      accessibility tree — it is plain text, not `aria-hidden`.
    */
    renderRow({ metadataStale: true });

    const chip = screen.getByTestId('metadata-stale-chip');
    expect(chip).not.toHaveAttribute('role');
    expect(chip).not.toHaveAttribute('aria-live');
    expect(chip).not.toHaveAttribute('aria-hidden');
    expect(screen.getByText(METADATA_STALE_CHIP)).toBe(chip);
  });

  it('T-UX-017i: the chip is styled subtly, and the rule exists', () => {
    /*
      ⚠ NO DOM ASSERTION CAN SEE THIS. jsdom applies no stylesheet, so
      deleting the rule leaves every case above green while the chip renders
      at full weight — indistinguishable from the `Unidentified` chip, which
      reports a genuinely different kind of problem. `T-CSS-001a` fails on a
      class with NO rule at all, but not on one whose declarations were
      emptied, so the properties are named here.
    */
    const root = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
      ? join(process.cwd(), 'apps', 'web')
      : process.cwd();
    const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');

    const rule = /\.title-row__chip--stale\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    // Muted, never a warning colour: nothing is wrong with the row.
    expect(rule?.[1]).toContain('var(--color-text-muted)');
  });
});
