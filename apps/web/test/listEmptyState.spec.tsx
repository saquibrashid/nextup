// TASK-040 — the combined list's empty and error states (`specs/ux-states.md`
// §2.3, §2.5, §2.9).
//
// §2.4 (zero-match, `T-UX-013`) is TASK-039's and lives in `filterBar.spec`;
// it appears here only where it must be told APART from these.
//
// The defect this suite exists to catch is not a missing state — it is the
// WRONG one. All three render; all three look fine; only one is true. So every
// case asserts both what is shown and what is not.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ListEmptyState,
  ListLoadError,
  listEmptyKind,
  type ListEmptyFacts,
} from '../src/components/ListEmptyState';
import { NO_FILTERS } from '../src/components/FilterBar';
import { MemoryRouter } from 'react-router-dom';
import { ListPage } from '../src/pages/ListPage';
import {
  LIST_EMPTY_ALL_GONE_TITLE,
  LIST_EMPTY_NEVER_UPLOADED_BODY,
  LIST_EMPTY_NEVER_UPLOADED_TITLE,
  LIST_LOAD_FAILED_BODY,
  RETRY_LABEL,
  UPLOAD_SCREENSHOTS_LABEL,
  ZERO_MATCH_TITLE,
} from '../src/copy';

function facts(over: Partial<ListEmptyFacts> = {}): ListEmptyFacts {
  return {
    shown: 0,
    total: 0,
    filters: NO_FILTERS,
    removedCount: 0,
    suppressedCount: 0,
    ...over,
  };
}

describe('T-UX-012 - the never-uploaded empty state', () => {
  it('T-UX-012a shows the first-run message and the way to start', () => {
    render(<ListEmptyState facts={facts()} />);

    expect(screen.getByTestId('list-empty-title').textContent).toBe(
      LIST_EMPTY_NEVER_UPLOADED_TITLE,
    );
    expect(screen.getByTestId('list-empty-body').textContent).toBe(LIST_EMPTY_NEVER_UPLOADED_BODY);
    const cta = screen.getByTestId('list-empty-cta');
    expect(cta.textContent).toBe(UPLOAD_SCREENSHOTS_LABEL);
    expect(cta.getAttribute('href')).toBe('/upload');
  });

  it('T-UX-012b appears only when nothing exists anywhere', () => {
    // A single removed or suppressed title makes "nothing here yet" false -
    // something WAS here, and saying otherwise denies the owner's own history.
    expect(listEmptyKind(facts())).toBe('never-uploaded');
    expect(listEmptyKind(facts({ removedCount: 1 }))).toBe('all-gone');
    expect(listEmptyKind(facts({ suppressedCount: 1 }))).toBe('all-gone');
    expect(listEmptyKind(facts({ total: 5 }))).toBe('all-gone');
  });

  it('T-UX-012c is not shown when a filter is what emptied the list', () => {
    render(
      <ListEmptyState
        facts={facts({ total: 0, filters: { services: ['netflix'], types: [], genres: [] } })}
      />,
    );

    expect(screen.queryByTestId('list-empty-never-uploaded')).toBeNull();
    expect(screen.getByTestId('zero-match-title').textContent).toBe(ZERO_MATCH_TITLE);
  });

  it('T-UX-012d renders nothing at all when the list has rows', () => {
    const { container } = render(<ListEmptyState facts={facts({ shown: 3, total: 3 })} />);

    expect(container.innerHTML).toBe('');
  });
});

describe('T-UX-014 - the everything-removed-or-suppressed empty state', () => {
  it('T-UX-014a says the list is empty right now, not that it never existed', () => {
    render(<ListEmptyState facts={facts({ removedCount: 12, suppressedCount: 3 })} />);

    expect(screen.getByTestId('list-empty-title').textContent).toBe(LIST_EMPTY_ALL_GONE_TITLE);
    expect(screen.queryByText(LIST_EMPTY_NEVER_UPLOADED_TITLE)).toBeNull();
  });

  it('T-UX-014b names both counts and links to both places', () => {
    // The titles are not gone, they are in one of two places, and the owner
    // cannot know which without being told.
    render(<ListEmptyState facts={facts({ removedCount: 12, suppressedCount: 3 })} />);

    const removed = screen.getByTestId('link-removed');
    const suppressed = screen.getByTestId('link-suppressed');
    expect(removed.textContent).toBe('Removal history (12)');
    expect(removed.getAttribute('href')).toBe('/removed');
    expect(suppressed.textContent).toBe('Not interested (3)');
    expect(suppressed.getAttribute('href')).toBe('/not-interested');
  });

  it('T-UX-014c is distinct from the never-uploaded state in wording and in markup', () => {
    const gone = render(<ListEmptyState facts={facts({ removedCount: 1 })} />);
    const goneText = gone.getByTestId('list-empty-title').textContent;
    gone.unmount();

    const fresh = render(<ListEmptyState facts={facts()} />);
    expect(fresh.getByTestId('list-empty-title').textContent).not.toBe(goneText);
    expect(fresh.queryByTestId('list-empty-all-gone')).toBeNull();
  });

  it('T-UX-014d yields to the zero-match state when a filter is also active', () => {
    // Both are true at once when a filtered view of a fully-removed list is
    // open; the filter is the one the owner can act on from here.
    expect(
      listEmptyKind(
        facts({ removedCount: 4, filters: { services: [], types: ['tv'], genres: [] } }),
      ),
    ).toBe('zero-match');
  });
});

describe('T-UX-018 - the load-failure state states that nothing changed', () => {
  it('T-UX-018a says the list could not be loaded AND that nothing changed', () => {
    render(<ListLoadError />);

    const body = screen.getByTestId('list-load-error-body').textContent;
    expect(body).toBe(LIST_LOAD_FAILED_BODY);
    // The reassurance is the load-bearing half: a failed read is the one
    // moment the owner cannot check the no-silent-loss promise themselves.
    expect(body).toContain('Nothing has changed');
  });

  it('T-UX-018b offers Retry', () => {
    const onRetry = vi.fn();
    render(<ListLoadError onRetry={onRetry} />);

    const retry = screen.getByTestId('list-retry');
    expect(retry.textContent).toBe(RETRY_LABEL);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('T-UX-018c never presents the failure as an empty list', () => {
    render(<ListLoadError />);

    const text = screen.getByTestId('list-load-error').textContent ?? '';
    expect(text).not.toContain(LIST_EMPTY_NEVER_UPLOADED_TITLE);
    expect(text).not.toContain(LIST_EMPTY_ALL_GONE_TITLE);
    expect(text).not.toContain(ZERO_MATCH_TITLE);
  });

  it('T-UX-018d is announced, because the screen otherwise looks like a lost list', () => {
    render(<ListLoadError />);

    expect(screen.getByTestId('list-load-error').getAttribute('role')).toBe('alert');
  });
});

describe('T-UX-018 - the page shows the failure instead of the list', () => {
  it('T-UX-018e never renders the filter bar over a failed read', () => {
    // "Showing 0 of 0" beside "Nothing has changed" contradicts the
    // reassurance, and the count would be invented - the API returned nothing
    // to count.
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ListPage loadFailed onRetry={onRetry} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('list-load-error-body').textContent).toBe(LIST_LOAD_FAILED_BODY);
    expect(screen.queryByTestId('filter-bar')).toBeNull();
    expect(screen.queryByTestId('filter-count')).toBeNull();
    expect(screen.queryByTestId('list-empty-never-uploaded')).toBeNull();

    fireEvent.click(screen.getByTestId('list-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
