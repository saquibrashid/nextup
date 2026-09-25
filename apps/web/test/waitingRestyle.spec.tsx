/**
 * #382 — the waiting view restyled in the Library's visual language
 * (`T-WAIT-020`).
 *
 * ⚠ **A RESTYLE CHANGES NO BEHAVIOUR**, so these assertions pin STRUCTURE the
 * owner asked for — one page heading, the Library's meta line and marks, a
 * forecast headline, a small "Not interested", a Library-style search field
 * and friendly dates — while `T-AVAIL-*`, `T-FORECAST-007` and `T-WAIT-009`
 * keep guarding what the rows say and do.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { render as rtlRender, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { WaitingItem } from '../src/lib/apiClient';
import {
  WAITING_FORECAST_TAG_ANNOUNCED,
  WAITING_FORECAST_TAG_ESTIMATE,
  WAITING_NOT_INTERESTED,
  WAITING_SEARCH_LABEL,
  WAITING_SUBTITLE,
} from '../src/copy';
import { WaitingPage, forecastWhen } from '../src/pages/WaitingPage';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const css = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

function item(over: Partial<WaitingItem> = {}): WaitingItem {
  return {
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:967941',
    name: 'Wicked: For Good',
    releaseYear: 2025,
    posterPath: '/w.jpg',
    discoveredAt: '2026-09-24',
    discoverySource: 'fandango-at-home',
    availableOn: [],
    flaggedOn: [],
    accessState: 'rent-only',
    rentOn: ['Apple TV Store', 'Amazon Video'],
    availabilityCheckedAt: '2026-09-24T00:00:00.000Z',
    availabilityRegion: 'US',
    forecast: { kind: 'estimate', service: 'peacock', month: '2026-10', yours: true },
    ...over,
  };
}

const noop = () => Promise.resolve([]);

describe('T-WAIT-020 · #382 · the waiting view in the Library look', () => {
  it('T-WAIT-020a · one page heading with the helper as its subtitle; the search has no heading', () => {
    render(<WaitingPage items={[item()]} onSearch={noop} onSearchAdd={noop} />);

    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Waiting to stream',
    ]);
    expect(screen.getByTestId('waiting-subtitle').textContent).toBe(WAITING_SUBTITLE);
    expect(within(screen.getByTestId('waiting-search')).queryByRole('heading')).toBeNull();
    // The row names are the only level-2 headings, as on Library.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Wicked: For Good',
    ]);
  });

  it('T-WAIT-020b · a compact meta line of year and type, separators kept out of the text', () => {
    render(
      <WaitingPage
        items={[item(), item({ intentId: 'wi-2', workIdentity: 'tmdb:tv:1399', name: 'Show' })]}
      />,
    );
    const metas = screen.getAllByTestId('waiting-meta');
    expect(metas.map((meta) => meta.textContent)).toEqual(['2025Movie', '2025TV']);
    expect(metas[0]!.className).toBe('waiting-row__meta');
  });

  it('T-WAIT-020c · the forecast leads with a tag, the service mark and the when', () => {
    render(
      <WaitingPage
        items={[
          item(),
          item({
            intentId: 'wi-2',
            forecast: { kind: 'announced', service: 'max', on: '2099-03-04', yours: true },
          }),
        ]}
      />,
    );
    const heads = document.querySelectorAll('.waiting-row__outlook-head');
    expect(heads).toHaveLength(2);
    const [estimate, announced] = [...heads];
    // ⚠ Decorative: the sentence beside it is the accessible truth, so a
    // screen reader hears "Estimate: likely on Peacock…" once, not twice.
    expect(estimate!.getAttribute('aria-hidden')).toBe('true');
    expect(estimate!.querySelector('.waiting-row__tag')?.textContent).toBe(
      WAITING_FORECAST_TAG_ESTIMATE,
    );
    expect(estimate!.querySelector('.brand-mark')).not.toBeNull();
    expect(estimate!.querySelector('.waiting-row__when')?.textContent).toBe('Oct 2026');
    expect(announced!.querySelector('.waiting-row__tag')?.textContent).toBe(
      WAITING_FORECAST_TAG_ANNOUNCED,
    );
    expect(announced!.querySelector('.waiting-row__when')?.textContent).toBe('Mar 4, 2099');
    expect(screen.getAllByTestId('waiting-forecast')[0]!.textContent).toMatch(/^Estimate: /);
    expect(
      forecastWhen({ kind: 'estimate-range', service: 'max', from: '2026-11', to: '2027-02' }),
    ).toBe('Nov 2026 – Feb 2027');
    expect(forecastWhen({ kind: 'estimate-soon', service: 'max' })).toBe('Soon');
  });

  it('T-WAIT-020d · "Not interested" is a small ghost control naming the title', () => {
    render(<WaitingPage items={[item()]} />);
    const button = screen.getByTestId('waiting-not-interested');
    expect(button.className).toBe('btn btn--ghost tap-target');
    expect(button.getAttribute('aria-label')).toBe(`${WAITING_NOT_INTERESTED}: Wicked: For Good`);
    expect(button.closest('.waiting-row__footer')).not.toBeNull();
  });

  it('T-WAIT-020e · the search is the Library field: an icon submit inside a rounded control', () => {
    render(<WaitingPage items={[]} onSearch={noop} onSearchAdd={noop} />);
    const input = screen.getByRole('searchbox', { name: WAITING_SEARCH_LABEL });
    expect(input.closest('.list-search__control')).not.toBeNull();
    const submit = screen.getByTestId('waiting-search-submit');
    expect(submit.getAttribute('aria-label')).toBe('Search');
    expect(submit.querySelector('svg')).not.toBeNull();
    expect(document.querySelector(`label[for="${input.id}"]`)?.classList.contains('sr-only')).toBe(
      true,
    );
  });

  it('T-WAIT-020f · every date on the row reads like Library, never as raw ISO', () => {
    render(<WaitingPage items={[item()]} />);
    const row = screen.getByTestId('waiting-row');
    expect(row.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(screen.getByTestId('waiting-discovery').textContent).toBe(
      'Seen on Fandango at Home (rent/buy) on 24 Sep 2026',
    );
    expect(screen.getByTestId('waiting-rent-only').textContent).toContain('24 Sep 2026');
  });

  it('T-WAIT-020g · the stylesheet uses the Library surface, poster sizes and breakpoints', () => {
    const rule = (selector: string, within: string = css): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(within);
      return match?.[1] ?? '';
    };
    const row = rule('.waiting-row');
    expect(row).toContain('background: var(--color-catalog-raised)');
    expect(row).toContain('border-radius: var(--radius-card)');
    expect(row).toContain('box-shadow: var(--shadow-card)');
    const poster = rule('.waiting-row__poster');
    expect(poster).toContain('aspect-ratio: 2 / 3');
    expect(poster).toContain('width: 4.5rem');
    const at640 = /@media \(min-width: 640px\) \{\s*\.waiting-row \{[\s\S]*?\n\}/.exec(css)?.[0];
    expect(at640).toContain('width: 6rem');
    const at1024 = /@media \(min-width: 1024px\) \{\s*\.waiting-list \{([^}]*)\}/.exec(css)?.[1];
    expect(at1024).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });
});
