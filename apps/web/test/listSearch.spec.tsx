import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ListSearch } from '../src/components/ListSearch';

function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="query">{location.search}</output>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

function mount(initial = '/') {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <ListSearch />
      <Navigation />
    </MemoryRouter>,
  );
}

function params(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('query').textContent ?? '');
}

describe('T-UX-140 server-backed library search control', () => {
  it('T-MOCK-005a: one mounted form resets discarded drafts without losing canonical search', async () => {
    mount('/?q=Orbit&service=max');
    const user = userEvent.setup();
    const form = screen.getByRole('search');
    await user.type(screen.getByRole('searchbox'), ' unfinished');
    await user.click(screen.getByRole('button', { name: 'Close search' }));
    expect(form).toBeInTheDocument();
    expect(form).not.toBeVisible();
    expect(params().get('q')).toBe('Orbit');
    await user.click(screen.getByTestId('list-search-trigger'));
    expect(screen.getByRole('search')).toBe(form);
    expect(screen.getByRole('searchbox')).toHaveValue('Orbit');
    expect(params().get('service')).toBe('max');
  });

  it('T-UX-140a reads the URL and exposes a labelled, bounded native search form', () => {
    mount('/?q=Dune');
    expect(screen.getByRole('search', { name: 'Search your list' })).toBeTruthy();
    const input = screen.getByRole('searchbox', { name: 'Search your list' });
    expect(input).toHaveValue('Dune');
    expect(input).toHaveAttribute('maxlength', '500');
    expect(input).toHaveAttribute('placeholder', 'Find something to watch');
    expect(screen.getByRole('button', { name: 'Search', exact: true })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it('T-UX-140b submits on Enter, not keystrokes, preserving repeated filters and sort', async () => {
    mount('/?service=max&service=netflix&genre=Drama&runtime=under30&sort=name&dir=asc&cursor=old');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('list-search-trigger'));
    await user.type(screen.getByRole('searchbox'), '  The Matrix  ');
    expect(params().has('q')).toBe(false);
    expect(params().get('cursor')).toBe('old');
    await user.keyboard('{Enter}');
    expect(params().get('q')).toBe('The Matrix');
    expect(params().getAll('service')).toEqual(['max', 'netflix']);
    expect(params().get('genre')).toBe('Drama');
    expect(params().get('runtime')).toBe('under30');
    expect(params().get('sort')).toBe('name');
    expect(params().get('dir')).toBe('asc');
    expect(params().has('cursor')).toBe(false);
  });

  describe('compact search disclosure', () => {
    it('T-LIB-002a: starts compact and keyboard opening focuses the labelled input', async () => {
      mount('/?service=max&sort=name&dir=asc');
      const user = userEvent.setup();
      const trigger = screen.getByTestId('list-search-trigger');
      expect(trigger).toHaveAccessibleName('Search');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('search')).toBeNull();
      await user.tab();
      expect(trigger).toHaveFocus();
      await user.keyboard('{Enter}');
      const input = screen.getByRole('searchbox');
      expect(input).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('search').id).toBe(trigger.getAttribute('aria-controls'));
      await user.type(input, 'unsubmitted');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('search')).toBeNull();
      expect(trigger).toHaveFocus();
      expect(params().has('q')).toBe(false);
      await user.keyboard(' ');
      expect(screen.getByRole('searchbox')).toHaveValue('');
      expect(params().get('service')).toBe('max');
    });

    it('T-LIB-002b: an active search can collapse without clearing, then reopen with its value', async () => {
      mount('/?q=Orbit&service=max');
      const user = userEvent.setup();
      expect(screen.getByTestId('list-search-trigger')).toHaveAccessibleName('Search active');
      await user.click(screen.getByRole('button', { name: 'Close search' }));
      expect(screen.queryByRole('search')).toBeNull();
      expect(params().get('q')).toBe('Orbit');
      await user.click(screen.getByTestId('list-search-trigger'));
      expect(screen.getByRole('searchbox')).toHaveValue('Orbit');
      await user.click(screen.getByRole('button', { name: 'Clear search' }));
      await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus());
      expect(params().has('q')).toBe(false);
      expect(params().get('service')).toBe('max');
      expect(screen.getByTestId('list-search-trigger')).toHaveAccessibleName('Search');
    });

    it('T-LIB-002c: history reveals active URL search without stealing focus', async () => {
      mount('/?q=Orbit');
      const user = userEvent.setup();
      await user.clear(screen.getByRole('searchbox'));
      await user.type(screen.getByRole('searchbox'), 'Lanterns{Enter}');
      await user.click(screen.getByTestId('list-search-trigger'));
      expect(screen.queryByRole('searchbox')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(await screen.findByRole('searchbox')).toHaveValue('Orbit');
      expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
      await user.click(screen.getByRole('button', { name: 'Forward' }));
      expect(screen.getByRole('searchbox')).toHaveValue('Lanterns');
    });
  });

  it('T-UX-140c clears only search and cursor and removes its clear control', () => {
    mount('/?q=Dune&service=max&sort=rating&cursor=old');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(params().has('q')).toBe(false);
    expect(params().has('cursor')).toBe(false);
    expect(params().get('service')).toBe('max');
    expect(params().get('sort')).toBe('rating');
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('T-UX-140d replaces drafts on history navigation and creates no keystroke history', async () => {
    mount('/?q=Dune');
    const user = userEvent.setup();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'Arrival');
    await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
    await user.type(screen.getByRole('searchbox'), ' unfinished');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(params().get('q')).toBe('Dune');
    expect(screen.getByRole('searchbox')).toHaveValue('Dune');
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(params().get('q')).toBe('Arrival');
    expect(screen.getByRole('searchbox')).toHaveValue('Arrival');
  });

  it('T-UX-140e submitting whitespace removes search without dropping filters', () => {
    mount('/?q=Dune&type=movie');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(params().has('q')).toBe(false);
    expect(params().get('type')).toBe('movie');
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
});
