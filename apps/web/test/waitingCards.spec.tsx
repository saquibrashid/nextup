/**
 * #467/#470 — the Waiting card content pass (`T-WCARD-*`): sentence-cased
 * titles, a poster placeholder, one page-level "as of" note, and "Not
 * interested" behind the row's overflow menu with suppression unchanged.
 */

import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { WaitingItem } from '../src/lib/apiClient';
import { displayTitle } from '../src/lib/displayTitle';
import { WaitingPage } from '../src/pages/WaitingPage';

function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

function item(over: Partial<WaitingItem> = {}): WaitingItem {
  return {
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:1',
    name: 'Wicked',
    releaseYear: 2025,
    posterPath: '/w.jpg',
    discoveredAt: '2026-09-24',
    discoverySource: 'fandango-at-home',
    availableOn: [],
    flaggedOn: [],
    accessState: 'rent-only',
    rentOn: ['Apple TV Store'],
    availabilityCheckedAt: '2026-09-24T00:00:00.000Z',
    availabilityRegion: 'US',
    forecast: null,
    ...over,
  };
}

describe('T-WCARD-001 · displayed titles read as sentences', () => {
  it('T-WCARD-001a · a multi-word ALL-CAPS name is title-cased, initialisms and mixed case survive', () => {
    expect(displayTitle('THE LORD OF THE RINGS')).toBe('The Lord of the Rings');
    expect(displayTitle('DC COMICS')).toBe('DC Comics');
    expect(displayTitle('Wicked: For Good')).toBe('Wicked: For Good');
    expect(displayTitle('IT')).toBe('IT');
  });
});

describe('T-WCARD-002 · the poster placeholder', () => {
  it('T-WCARD-002a · a title without artwork shows its initial, not a blank box', () => {
    render(<WaitingPage items={[item({ posterPath: null, name: 'WICKED FOR GOOD' })]} />);
    const placeholder = screen.getByTestId('waiting-poster-placeholder');
    expect(placeholder.textContent).toBe('W');
    expect(screen.queryByTestId('waiting-poster')).toBeNull();
  });
});

describe('T-WCARD-003 · one "not seen" note, not one per row', () => {
  it('T-WCARD-003a · rows sharing a checked date show it once on the page', () => {
    render(
      <WaitingPage
        items={[
          item(),
          item({ intentId: 'wi-2', titleId: 'title-2', workIdentity: 'tmdb:movie:2', name: 'Two' }),
        ]}
      />,
    );
    expect(screen.getAllByTestId('waiting-asof-note')).toHaveLength(1);
  });
});

describe('T-WCARD-004 · Not interested lives in the row menu', () => {
  it('T-WCARD-004a · the menu offers it and suppression is the unchanged per-title call', () => {
    const onNotInterested = vi.fn(() => Promise.resolve());
    render(<WaitingPage items={[item()]} onSuppress={onNotInterested} />);
    expect(screen.queryByTestId('waiting-not-interested')).toBeNull();
    fireEvent.click(screen.getByTestId('waiting-row-menu'));
    fireEvent.click(
      within(screen.getByTestId('waiting-row-menu').closest('li')!).getByTestId(
        'waiting-not-interested',
      ),
    );
    expect(onNotInterested).toHaveBeenCalledTimes(1);
    expect(onNotInterested).toHaveBeenCalledWith('title-1');
  });

  it('T-WCARD-004b · Escape closes the menu', () => {
    render(<WaitingPage items={[item()]} onSuppress={vi.fn(() => Promise.resolve())} />);
    fireEvent.click(screen.getByTestId('waiting-row-menu'));
    expect(screen.getByTestId('waiting-not-interested')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('waiting-not-interested'), { key: 'Escape' });
    expect(screen.queryByTestId('waiting-not-interested')).toBeNull();
  });
});
