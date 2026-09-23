/**
 * TASK-038 - the combined-list row (`specs/ui.md` §2.2).
 *
 * Tests: `T-UI-010` (US-018 AC-5), `T-LIST-018` (US-021 AC-3), `T-UI-012`
 * (US-038 AC-3).
 *
 * `T-LIST-018` lives here rather than with TASK-035 by `specs/testing.md` §19.3:
 * its assertion is about a RENDERED label, and until `TitleRow.tsx` existed
 * there was nothing for it to fail on. The domain half - that `dateAddedLabel()`
 * produces the marker - is `T-LIST-034`. This is the other half: that the
 * component actually shows what the server computed instead of quietly
 * rebuilding it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DATE_ADDED_LABEL_MARKER } from '@nextup/domain';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  TitleRow,
  TMDB_IMAGE_BASE,
  TMDB_IMAGE_BASE_2X,
  type TitleListItem,
} from '../src/components/TitleRow';
import { ListPage } from '../src/pages/ListPage';
import { RUNTIME_UNKNOWN_LABEL } from '../src/copy';

/** `ListPage` mounts the freshness strip, whose chips are router `Link`s. */
function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

const DUNE: TitleListItem = {
  titleId: '01J8ZC',
  workIdentity: 'tmdb:movie:438631',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  releaseYear: 2021,
  genres: ['Science Fiction', 'Adventure'],
  runtimeMinutes: 155,
  posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
  badges: [
    { service: 'netflix', listingId: '01J8ZD', dateAdded: '2026-04-02' },
    { service: 'max', listingId: '01J8ZE', dateAdded: '2026-06-11' },
  ],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

function item(overrides: Partial<TitleListItem>): TitleListItem {
  return { ...DUNE, ...overrides };
}

function renderRow(overrides: Partial<TitleListItem> = {}): HTMLElement {
  render(
    <ul>
      <TitleRow item={item(overrides)} />
    </ul>,
  );
  return screen.getByTestId(`title-row-${item(overrides).titleId}`);
}

/** Every element in the subtree carrying a URL attribute. */
function urlAttributes(root: HTMLElement): string[] {
  const urls: string[] = [];
  for (const el of root.querySelectorAll('[href], [src], [srcset], [action], [data-url]')) {
    for (const name of ['href', 'src', 'srcset', 'action', 'data-url']) {
      const value = el.getAttribute(name);
      if (value !== null) urls.push(value);
    }
  }
  return urls;
}

describe('T-UI-010 - the row shows poster, name, type, year, date-added label and badges', () => {
  it('T-UI-010a renders all six elements of §2.2 for a matched title', () => {
    const row = renderRow();

    expect(within(row).getByTestId('poster')).toHaveAttribute(
      'src',
      `${TMDB_IMAGE_BASE}/d5NXSklXo0qyIYkgV94XAgMIckC.jpg`,
    );
    expect(within(row).getByTestId('title-name')).toHaveTextContent('Dune');
    expect(within(row).getByTestId('media-type')).toHaveTextContent('Movie');
    expect(within(row).getByTestId('release-year')).toHaveTextContent('2021');
    expect(within(row).getByTestId('date-added-label')).toHaveTextContent(
      'Added to nextup 2 Apr 2026',
    );
    expect(within(row).getByTestId('badge-netflix')).toBeInTheDocument();
    expect(within(row).getByTestId('badge-max')).toBeInTheDocument();
  });

  it('T-UI-010b gives the name the only heading weight in the row', () => {
    const row = renderRow();
    const headings = within(row).getAllByRole('heading');

    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Dune');
  });

  it('T-UI-010c marks the poster decorative so the name is not announced twice', () => {
    const row = renderRow();

    // `alt=""` removes it from the a11y tree, so querying by img role finds
    // nothing - that absence IS the assertion (§2.2).
    expect(within(row).queryAllByRole('img')).toHaveLength(0);
    expect(within(row).getByTestId('poster')).toHaveAttribute('alt', '');
  });

  it('T-UI-010d shows a placeholder tile, never a broken image, when there is no poster', () => {
    const row = renderRow({ posterPath: null });

    expect(within(row).getByTestId('poster-placeholder')).toBeInTheDocument();
    expect(within(row).queryByTestId('poster')).toBeNull();
    expect(row.querySelectorAll('img')).toHaveLength(0);
  });

  it('T-UI-010e renders one row with two badges for a work saved on both services', () => {
    render(<ListPage items={[DUNE]} />);

    // The collapse is the product (REQ-026): two listings, ONE row.
    expect(screen.getAllByTestId(/^title-row-/)).toHaveLength(1);
    expect(within(screen.getByTestId('badges')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('T-UI-010f labels badges with text, never colour alone', () => {
    const badges = within(renderRow()).getByTestId('badges');

    expect(within(badges).getByTestId('badge-netflix')).toHaveTextContent('Netflix');
    expect(within(badges).getByTestId('badge-max')).toHaveTextContent('Max');
  });

  it('T-UI-010g renders nothing at all for an empty genre list - never "Unknown"', () => {
    const row = renderRow({ genres: [] });

    expect(within(row).queryByTestId('genres')).toBeNull();
    expect(row.textContent ?? '').not.toMatch(/unknown|n\/a|—|not available/i);
  });

  it('T-UI-010h omits the year rather than inventing one when the release year is unknown', () => {
    const row = renderRow({ releaseYear: null });

    expect(within(row).queryByTestId('release-year')).toBeNull();
    expect(within(row).getByTestId('title-name')).toHaveTextContent('Dune');
  });

  it('T-UI-010i shows the raw text, an Unidentified chip and a Find a match action when unmatched', async () => {
    const onFixMatch = vi.fn();
    const unmatched = item({
      matchState: 'unmatched',
      name: 'DUNE PART TVVO',
      posterPath: null,
      genres: [],
      releaseYear: null,
    });
    render(
      <ul>
        <TitleRow item={unmatched} onFixMatch={onFixMatch} />
      </ul>,
    );
    const row = screen.getByTestId(`title-row-${unmatched.titleId}`);

    expect(within(row).getByTestId('title-name')).toHaveTextContent('DUNE PART TVVO');
    expect(within(row).getByTestId('unidentified-chip')).toHaveTextContent('Unidentified');

    await userEvent.click(within(row).getByRole('button', { name: 'Find a match' }));
    expect(onFixMatch).toHaveBeenCalledWith(unmatched);
    // An unmatched row has no identity to suppress against yet (REQ-071), so it
    // offers the match action instead of the menu - not both.
    expect(within(row).queryByTestId('row-menu')).toBeNull();
  });

  it('T-UI-010j the row menu reports the intent rather than acting on a single tap', async () => {
    const onOpenMenu = vi.fn();
    render(
      <ul>
        <TitleRow item={DUNE} onOpenMenu={onOpenMenu} />
      </ul>,
    );
    const menu = screen.getByTestId('row-menu');

    expect(menu).toHaveAttribute('aria-haspopup', 'menu');
    expect(menu).toHaveAccessibleName('Actions for Dune');
    await userEvent.click(menu);
    expect(onOpenMenu).toHaveBeenCalledWith(DUNE);
  });

  it('T-A11Y-016g the row menu trigger is the shared icon, decorative, and still named', () => {
    // ⚠ THE SUFFIX BELONGS TO THE ICON FAMILY, NOT `T-UI-010`, because the
    // rule being asserted is §7c's (an icon is never the sole label and never
    // a second one) at the call site `T-A11Y-016e`'s comment already names.
    // `T-UI-010` is also full: a-z are taken, and `T-META-008b` fails on a
    // reused suffix because a CI failure would then name two different tests.
    //
    // ⚠ THE GLYPH WAS THE DEFECT, not the styling. The trigger used to be a
    // literal `⋮` (U+22EE) — the one control left in the product that predated
    // REQ-124's closed icon set. A text character renders in whatever the
    // system font happens to have at that codepoint, inherits none of §7c's
    // 24px grid or `stroke-width`, and is read aloud as whatever the voice
    // makes of it.
    render(
      <ul>
        <TitleRow item={DUNE} onOpenMenu={vi.fn()} />
      </ul>,
    );
    const menu = screen.getByTestId('row-menu');

    const svg = menu.querySelector('svg');
    expect(svg).not.toBeNull();
    // §7c: an icon inside an already-named control is decorative, or the
    // reader announces the name twice. `T-A11Y-016f` states the same rule
    // generally; this is the call site it was written for.
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(menu.textContent).not.toContain('⋮');
    // The accessible name is unchanged by the swap - the whole point.
    expect(menu).toHaveAccessibleName('Actions for Dune');
  });

  it('T-UI-010k renders without action handlers wired, offering no DEAD affordance', async () => {
    // ⚠ CORRECTED. This case previously clicked the `⋮` on an unwired
    // `ListPage` and asserted the row survived, under the heading "as the
    // read-only list does". That passed, and it locked in a real defect:
    // `specs/ui.md` §2.2 describes no read-only list, `ListPage` was the only
    // consumer, and it wired nothing — so the menu the spec requires shipped
    // as a button that did nothing on every click, for every row, while this
    // test reported the behaviour as intended.
    //
    // The row must still render safely without handlers (that much was always
    // right); what it must NOT do is draw an affordance it cannot honour.
    render(<ListPage items={[DUNE]} />);

    expect(screen.getByTestId('title-name')).toHaveTextContent('Dune');
    expect(screen.queryByTestId('row-menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Find a match' })).toBeNull();
  });
});

describe('T-LIST-018 - every rendered date label is honest about whose date it is', () => {
  it('T-LIST-018a renders the API label verbatim', () => {
    const row = renderRow({ dateAddedLabel: 'Added to nextup 11 Jun 2026' });

    expect(within(row).getByTestId('date-added-label').textContent).toBe(
      'Added to nextup 11 Jun 2026',
    );
  });

  it('T-LIST-018b every date label rendered by the list contains "to nextup"', () => {
    render(
      <ListPage
        items={[
          DUNE,
          item({ titleId: '01J8ZF', dateAddedLabel: 'Added to nextup 11 Jun 2026' }),
          item({ titleId: '01J8ZG', dateAddedLabel: 'Added to nextup today' }),
        ]}
      />,
    );

    const labels = screen.getAllByTestId('date-added-label');
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label.textContent ?? '').toContain(DATE_ADDED_LABEL_MARKER);
    }
  });

  it('T-LIST-018c no bare "Added" label exists anywhere in a rendered row', () => {
    render(<ListPage items={[DUNE, item({ titleId: '01J8ZF', posterPath: null, genres: [] })]} />);
    const list = screen.getByTestId('title-list');

    // Walk text nodes rather than reading the container's whole textContent:
    // concatenation across siblings can make a bare "Added" look adjacent to a
    // "to nextup" that belongs to a different row entirely.
    const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (!/\bAdded\b/.test(text)) continue;
      seen += 1;
      expect(text).toContain(DATE_ADDED_LABEL_MARKER);
    }
    expect(seen).toBe(2);
  });

  it('T-LIST-018d renders no date label at all when the API supplies none', () => {
    const row = renderRow({ dateAddedLabel: null, sortDateAdded: null });

    // The component must not fall back to a locally built string: REQ-061 has
    // exactly one implementation and it is server-side.
    expect(within(row).queryByTestId('date-added-label')).toBeNull();
    expect(row.textContent ?? '').not.toMatch(/\bAdded\b/);
  });
});

describe('T-UI-012 - the row makes no automated or credentialed approach to a streaming service', () => {
  const STREAMING_HOSTS = /netflix\.com|max\.com|hbomax\.com|hbo\.com/i;
  const CREDENTIAL_LIKE = /(token|auth|session|cookie|password|apikey|api_key|secret)=/i;

  it('T-UI-012a any anchor leaving the app is a plain new-tab link with noopener noreferrer', () => {
    render(<ListPage items={[DUNE, item({ titleId: '01J8ZF' })]} />);
    const anchors = [...screen.getByTestId('title-list').querySelectorAll('a')];

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:/i.test(href)) continue;
      expect(anchor).toHaveAttribute('target', '_blank');
      const rel = anchor.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    }
  });

  it('T-UI-012b no URL in a row addresses a streaming service (NFR-010)', () => {
    render(<ListPage items={[DUNE, item({ titleId: '01J8ZF', posterPath: null })]} />);

    for (const url of urlAttributes(screen.getByTestId('title-list'))) {
      expect(url).not.toMatch(STREAMING_HOSTS);
    }
  });

  it('T-UI-012c no URL in a row carries a credential or token (NFR-009)', () => {
    render(<ListPage items={[DUNE]} />);

    for (const url of urlAttributes(screen.getByTestId('title-list'))) {
      expect(url).not.toMatch(CREDENTIAL_LIKE);
    }
  });

  it('T-UI-012d the only remote asset a row fetches is the TMDB poster', () => {
    render(<ListPage items={[DUNE]} />);

    // ⚠ `srcset` IS A LIST, AND FLATTENING IT WOULD WEAKEN THIS TEST.
    // `urlAttributes` returns the raw attribute, so a `srcset` arrives as one
    // string holding several URLs and their density descriptors. Comparing
    // that string to an expected literal would have turned this NFR-010/009
    // assertion into a spelling test that a second, unrelated host could be
    // appended to without failing. Each candidate is split out and checked on
    // its own, so every remote URL a row can fetch is asserted individually.
    const remote = urlAttributes(screen.getByTestId('title-list'))
      .flatMap((value) => value.split(','))
      .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
      .filter((url) => /^https?:/i.test(url));

    expect(remote).toEqual([
      `${TMDB_IMAGE_BASE}/d5NXSklXo0qyIYkgV94XAgMIckC.jpg`,
      `${TMDB_IMAGE_BASE}/d5NXSklXo0qyIYkgV94XAgMIckC.jpg`,
      `${TMDB_IMAGE_BASE_2X}/d5NXSklXo0qyIYkgV94XAgMIckC.jpg`,
    ]);
  });

  it('T-UX-153a the poster is requested at a resolution it is actually painted at', () => {
    // ⚠ PINS THE RENDITION WIDTH, WHICH THE OTHER POSTER TESTS DO NOT.
    // Every existing assertion interpolates `TMDB_IMAGE_BASE`, so it agrees
    // with whatever the constant happens to say — setting it back to `w154`,
    // or to `w92`, keeps them all green. That is exactly how the soft artwork
    // the owner reported survived: nothing in the suite ever looked at the
    // number. The literal widths are written out here on purpose.
    //
    // TMDB's path segment IS the pixel width, so `w342` is a 342 px-wide
    // source. The grid tile paints the poster at ~200 CSS px and up, which on
    // any 2x display needs ~400+ real pixels — hence the `w500` candidate.
    render(<ListPage items={[DUNE]} />);
    const poster = screen.getByTestId('poster');

    expect(poster.getAttribute('src')).toContain('/t/p/w342/');
    expect(poster.getAttribute('srcset')).toContain('/t/p/w342/');
    expect(poster.getAttribute('srcset')).toContain('/t/p/w500/');
    // The descriptors, without which a browser cannot choose between them and
    // simply takes the first — leaving high-density displays on the 1x image.
    expect(poster.getAttribute('srcset')).toMatch(/w342\/[^\s]+ 1x/);
    expect(poster.getAttribute('srcset')).toMatch(/w500\/[^\s]+ 2x/);
  });

  it('T-UX-153b every rendition clears the REQ-111 poster box, so none is upscaled at the floor', () => {
    // REQ-111 puts a 72 x 108 floor on the rendered box and the compact view
    // sits exactly on it. A source narrower than the box is upscaled by
    // definition, so the smallest rendition offered must still exceed 72 px —
    // asserted as a property rather than by restating 342, so shrinking the
    // constant toward the floor fails here even if the literals above are
    // updated to match it.
    render(<ListPage items={[DUNE]} />);
    const poster = screen.getByTestId('poster');

    const widths = [
      ...`${poster.getAttribute('src')} ${poster.getAttribute('srcset')}`.matchAll(
        /\/t\/p\/w(\d+)\//g,
      ),
    ].map((match) => Number(match[1]));

    expect(widths.length).toBeGreaterThanOrEqual(3);
    for (const width of widths) {
      expect(width).toBeGreaterThan(72);
    }
  });
});

describe('REQ-119 - the runtime is on the row (`specs/ui-refresh.md` §5a)', () => {
  it('T-UX-121a a film renders `1h 55m` with no per-episode suffix', () => {
    // 115, not 155: `1h 55m` is REQ-119's own worked example. The DUNE fixture
    // is 155 minutes (2h 35m), which is why this passes an explicit runtime
    // rather than leaning on the default.
    renderRow({ mediaType: 'movie', runtimeMinutes: 115 });

    expect(screen.getByTestId('runtime').textContent).toBe('1h 55m');
    expect(screen.getByTestId('runtime').textContent).not.toContain('/ep');
  });

  it('T-UX-121b a series renders the `/ep` suffix', () => {
    // ⚠ THE SUFFIX IS THE REQUIREMENT, NOT A FLOURISH. TMDB gives a series an
    // `episode_run_time` ARRAY and `tmdbClient.readRuntime` takes its first
    // element, so the stored number is ONE EPISODE. A bare `45m` beside a
    // nine-season series is a false statement about the work, and false in the
    // direction that matters - the owner is choosing what to watch tonight.
    renderRow({ mediaType: 'tv', runtimeMinutes: 45 });

    expect(screen.getByTestId('runtime').textContent).toBe('45m/ep');
  });

  it('T-UX-121c the runtime precedes the wrapping genre names', () => {
    const row = renderRow({});
    const meta = within(row).getByTestId('title-meta');
    // Ignore the grouping wrapper without including the nested genre chips.
    const order = Array.from(
      meta.querySelectorAll<HTMLElement>(
        ':scope > .title-row__facts > *, :scope > :not(.title-row__facts)',
      ),
    ).map((s) => s.dataset['testid']);

    expect(order).toEqual(['release-year', 'media-type', 'runtime', 'genres']);
  });

  it('T-UX-122a a null runtime renders the WORDS, never `0m` and never an empty slot', () => {
    // ⚠ THIS DELIBERATELY DIFFERS FROM THE EMPTY-GENRE RULE (US-019 AC-6),
    // which renders nothing. Runtime is FILTERABLE (REQ-035) and a null runtime
    // satisfies no bucket, so whether a row has one decides whether it can
    // appear at all. An owner who cannot see that a title has no runtime cannot
    // understand why it vanished when they filtered.
    renderRow({ runtimeMinutes: null });

    const runtime = screen.getByTestId('runtime');
    expect(runtime.textContent).toBe(RUNTIME_UNKNOWN_LABEL);
    expect(runtime.textContent).not.toMatch(/\b0m\b/);
    expect(runtime.textContent?.trim()).not.toBe('');
  });

  it('T-UX-122b a zero runtime is unknown, not "0m"', () => {
    // TMDB stores `0` for works it has no runtime for, so this is a real row
    // rather than a defensive hypothetical. `0m` is not a length, and it would
    // read as a claim that the title is zero minutes long.
    renderRow({ runtimeMinutes: 0 });

    expect(screen.getByTestId('runtime').textContent).toBe(RUNTIME_UNKNOWN_LABEL);
  });

  it('T-UX-122c the unknown wording is the shared constant, not a local string', () => {
    // `specs/ui.md` §9: owner-facing copy lives in `copy.ts` so a wording
    // change is one diff. A literal inlined into the component would pass every
    // assertion above and silently fork the wording.
    //
    // ⚠ THE NAME IS ASSERTED IN FULL, not as a prefix. `specs/ui.md` §9 governs
    // this string under the name `RUNTIME_UNKNOWN_LABEL`; a bare
    // `RUNTIME_UNKNOWN` would satisfy `toContain` while naming a constant the
    // spec does not have, which is how the code and §9 drifted apart before.
    const source = readFileSync(
      join(process.cwd(), 'apps/web/src/components/TitleRow.tsx'),
      'utf8',
    );
    expect(source).toContain('RUNTIME_UNKNOWN_LABEL');
    expect(source).not.toContain("'Runtime unknown'");
  });
});
