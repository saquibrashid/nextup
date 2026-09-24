// `T-TOOLBAR-002` — the library toolbar's Filters, order and layout controls
// (#370). The restyle must not move meaning into colour or drop a control:
// names, counts, pressed states and the reverse button are asserted here.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { FilterBar } from '../src/components/FilterBar';
import { ListViewControl } from '../src/components/ListViewControl';
import { SortControl } from '../src/components/SortControl';
import { FILTERS_TRIGGER_LABEL } from '../src/copy';

function mountFilters(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <FilterBar genres={[]} shown={3} total={3} />
    </MemoryRouter>,
  );
  return screen.getByTestId('filters-trigger');
}

describe('T-TOOLBAR-002 library toolbar controls (#370)', () => {
  it('T-TOOLBAR-002a the Filters trigger keeps its name and a decorative icon', () => {
    const trigger = mountFilters('/');
    expect(trigger).toHaveAccessibleName(FILTERS_TRIGGER_LABEL);
    expect(trigger).toHaveTextContent(FILTERS_TRIGGER_LABEL);
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).not.toHaveAttribute('data-active');
  });

  it('T-TOOLBAR-002b an active filter is shown by count and state, but search alone is not', () => {
    const trigger = mountFilters('/?service=netflix&type=movie');
    expect(trigger).toHaveAttribute('data-active', 'true');
    expect(trigger).toHaveAccessibleName(`${FILTERS_TRIGGER_LABEL} 2 active`);
    expect(trigger).toHaveTextContent('2');
  });

  it('T-TOOLBAR-002c a search without filters leaves the Filters trigger inactive', () => {
    const trigger = mountFilters('/?q=Dune');
    expect(trigger).not.toHaveAttribute('data-active');
    expect(trigger).toHaveAccessibleName(FILTERS_TRIGGER_LABEL);
  });

  it('T-TOOLBAR-002d the order trigger reads "Sort:" plus the complete order, with the reverse kept', () => {
    render(
      <MemoryRouter initialEntries={['/?sort=name&dir=asc']}>
        <SortControl />
      </MemoryRouter>,
    );
    const trigger = screen.getByTestId('sort-trigger');
    expect(trigger).toHaveTextContent(/^Sort: .+/);
    expect(trigger.textContent).not.toMatch(/Sort: Sort/);
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.getAttribute('aria-label')).toMatch(/^Sort: .+\. Change the order\.$/);
    expect(trigger.querySelector('.sort-trigger-disclosure svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    const reverse = screen.getByTestId('sort-reverse');
    expect(reverse.getAttribute('aria-label')).toMatch(/^Reverse the order: /);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('sort-control')).toBeInTheDocument();
  });

  it('T-TOOLBAR-002e Grid and Compact are one named two-option switch with one pressed', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ListViewControl view="grid" onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'List layout' });
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Grid view',
      'Compact view',
    ]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    fireEvent.click(screen.getByRole('button', { name: 'Compact view' }));
    expect(onChange).toHaveBeenCalledWith('compact');
    rerender(<ListViewControl view="compact" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Compact view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
