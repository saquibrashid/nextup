/**
 * `T-MENU-001` / `T-MENU-002` — the light row action menu (#471, `A69`,
 * US-078 / REQ-144). Layout is asserted in a browser (`T-MENU-080`); these
 * cover the accessible naming and the stylesheet's guarantees.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { RowMenu } from '../src/components/RowMenu';
import type { TitleListItem } from '../src/components/TitleRow';

const ITEM = {
  titleId: 't1',
  workIdentity: 'tmdb:movie:1',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  badges: [],
} as unknown as TitleListItem;

const CSS = readFileSync(join(__dirname, '..', 'src', 'index.css'), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]()']/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  return match?.[1] ?? '';
}

describe('T-MENU-001 · short visible labels, full accessible names', () => {
  it('T-MENU-001a: items show one-line labels and keep the full wording as name and tooltip', () => {
    render(
      <MemoryRouter>
        <RowMenu item={ITEM} canRemove canFinish onChoose={vi.fn()} onDismiss={vi.fn()} />
      </MemoryRouter>,
    );
    const menu = screen.getByRole('menu', { name: 'Actions for Dune' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toStrictEqual([
      'Not interested',
      'Remove',
      'Fix match',
      'Finished',
      'Close',
    ]);
    const remove = within(menu).getByRole('menuitem', { name: 'Remove from library' });
    expect(remove.getAttribute('title')).toBe('Remove from library');
    expect(within(menu).getByRole('menuitem', { name: 'Finished watching' })).toBeTruthy();
  });

  it('T-MENU-001b: the close control is a named menuitem that dismisses', () => {
    const onDismiss = vi.fn();
    render(
      <MemoryRouter>
        <RowMenu item={ITEM} onChoose={vi.fn()} onDismiss={onDismiss} />
      </MemoryRouter>,
    );
    screen.getByRole('menuitem', { name: 'Close menu' }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('T-MENU-002 · the stylesheet keeps the menu light', () => {
  it('T-MENU-002a: items have no border and no bold weight; Close is phone-only', () => {
    const item = rule('.row-menu .btn');
    expect(item).toMatch(/border:\s*0/);
    expect(item).toMatch(/font-weight:\s*var\(--weight-normal\)/);
    expect(rule('.row-menu .btn[data-menu-close]')).toMatch(/display:\s*none/);
    expect(rule("html[data-layout='phone'] .row-menu .btn[data-menu-close]")).toMatch(
      /display:\s*flex/,
    );
    expect(rule('.row-menu')).toMatch(/min-width:\s*11rem/);
  });
});
