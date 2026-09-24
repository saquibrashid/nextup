import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ListSearch } from '../src/components/ListSearch';
import { LIST_SEARCH_PLACEHOLDER } from '../src/copy';

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
  it('T-MOCK-005b: Escape retains input focus when the desktop disclosure cannot receive focus', async () => {
    mount('/?q=Orbit&service=max');
    const user = userEvent.setup();
    const input = screen.getByRole('searchbox');
    const focus = vi
      .spyOn(screen.getByTestId('list-search-trigger'), 'focus')
      .mockImplementation(() => {});
    try {
      await user.type(input, ' unfinished');
      await user.keyboard('{Escape}');
      expect(input).toHaveFocus();
      expect(input).toHaveValue('Orbit');
      expect(params().get('q')).toBe('Orbit');
      expect(params().get('service')).toBe('max');
    } finally {
      focus.mockRestore();
    }
  });

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
    expect(input).toHaveAttribute('placeholder', LIST_SEARCH_PLACEHOLDER);
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

describe('T-TOOLBAR-001 the library search field (#370)', () => {
  it('T-TOOLBAR-001a promises title search only and puts a named submit inside the field', () => {
    mount('/?q=Dune');
    const input = screen.getByRole('searchbox', { name: 'Search your list' });
    expect(LIST_SEARCH_PLACEHOLDER).not.toMatch(/actor|people|cast/i);
    expect(input).toHaveAttribute('placeholder', 'Search titles');
    expect(input).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    const submit = screen.getByRole('button', { name: 'Search', exact: true });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.parentElement).toBe(input.parentElement);
    expect(submit.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('T-TOOLBAR-001b Ctrl+K and Cmd+K open the compact search and focus it', async () => {
    mount('/?service=max');
    const user = userEvent.setup();
    expect(screen.queryByRole('search')).toBeNull();
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('searchbox');
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByTestId('list-search-trigger')).toHaveAttribute('aria-expanded', 'true');
    input.blur();
    await user.keyboard('{Meta>}K{/Meta}');
    expect(input).toHaveFocus();
    expect(params().get('service')).toBe('max');
    expect(params().has('q')).toBe(false);
  });

  it('T-TOOLBAR-001c the shortcut leaves modified chords and open dialogs alone', async () => {
    mount('/');
    const user = userEvent.setup();
    await user.keyboard('{Control>}{Shift>}k{/Shift}{/Control}');
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
    await user.keyboard('k');
    expect(screen.queryByRole('search')).toBeNull();
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    try {
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(screen.queryByRole('search')).toBeNull();
    } finally {
      modal.remove();
    }
    const handled = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('T-TOOLBAR-001d the hint names the platform keys and stays out of the accessibility tree', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      mount('/?q=Dune');
      const hint = screen.getByTestId('list-search-shortcut');
      expect(hint).toHaveAttribute('aria-hidden', 'true');
      expect([...hint.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual(['⌘', 'K']);
    } finally {
      platform.mockRestore();
    }
  });

  it('T-TOOLBAR-001e other keyboards are told Ctrl K', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    try {
      mount('/?q=Dune');
      const keys = screen.getByTestId('list-search-shortcut').querySelectorAll('kbd');
      expect([...keys].map((key) => key.textContent)).toEqual(['Ctrl', 'K']);
    } finally {
      platform.mockRestore();
    }
  });
});
