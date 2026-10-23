/**
 * Add title with an INFERRED service (#455, PRD `A60`, US-069) — at the level
 * the owner meets it, through `ListPage`.
 *
 * ⚠ Pre-selection from a real availability lookup is not a silent default
 * (US-047 AC-4): the owner sees it ticked and must press confirm. Every case
 * that asserts a pre-selection also asserts that nothing was written first.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ListPage, type ListPageProps } from '../src/pages/ListPage';
import type { ServiceLookupResponse } from '../src/lib/apiClient';
import {
  ADD_TITLE_CONFIRM_LIBRARY,
  ADD_TITLE_CONFIRM_WAITING,
  ADD_TITLE_LOOKED_UP_NONE,
  ADD_TITLE_LOOKUP_FAILED,
  ADD_TITLE_LOOKUP_UNKNOWN,
  ADD_TITLE_LOOKING_UP,
} from '../src/copy';

const found = (services: ServiceLookupResponse['services']): ServiceLookupResponse => ({
  status: 'found',
  services,
  destination: { kind: 'services', services },
  checkedAt: '2026-10-11T00:00:00.000Z',
});

function mount(
  lookup: ListPageProps['onLookupAddServices'],
  over: Partial<ListPageProps> = {},
): ListPageProps {
  const props: ListPageProps = {
    items: [],
    total: 0,
    onSuppress: vi.fn(),
    onUnsuppress: vi.fn(),
    onSearchTmdb: vi.fn().mockResolvedValue({
      items: [
        {
          tmdbId: 438631,
          mediaType: 'movie' as const,
          name: 'Dune',
          releaseYear: 2021,
          posterPath: null,
        },
      ],
    }),
    onAddTitle: vi.fn().mockResolvedValue({
      titleId: 't',
      name: 'Dune',
      titleWasCreated: true,
      destination: 'services',
    }),
    onReload: vi.fn(),
    ...(lookup === undefined ? {} : { onLookupAddServices: lookup }),
    ...over,
  };
  render(<ListPage {...props} />, { wrapper: MemoryRouter });
  return props;
}

async function pick(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('add-title-open'));
  await user.type(screen.getByTestId('add-title-search-input'), 'dune');
  await user.click(await screen.findByTestId('add-select-438631'));
}

const checked = (id: string): boolean => (screen.getByTestId(id) as HTMLInputElement).checked;

describe('US-069 — Add title infers the service from availability', () => {
  it('T-ADDINF-010a: every matching service is pre-selected, nothing is written until confirm, and the body carries the shown choice', async () => {
    const user = userEvent.setup();
    const props = mount(vi.fn().mockResolvedValue(found(['netflix', 'max'])));
    await pick(user);

    await waitFor(() => {
      expect(checked('add-service-netflix')).toBe(true);
    });
    expect(checked('add-service-max')).toBe(true);
    expect(checked('add-service-disney-plus')).toBe(false);
    expect(checked('add-waiting')).toBe(false);
    expect(props.onAddTitle).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-add-title').textContent).toBe(ADD_TITLE_CONFIRM_LIBRARY);

    await user.click(screen.getByTestId('confirm-add-title'));
    await waitFor(() => {
      expect(props.onAddTitle).toHaveBeenCalledWith({
        tmdbId: 438631,
        mediaType: 'movie',
        destination: { kind: 'services', services: ['netflix', 'max'] },
      });
    });
  });

  it('T-ADDINF-010b: a lookup in flight shows a busy status and blocks confirm', async () => {
    const user = userEvent.setup();
    let release: (value: ServiceLookupResponse) => void = () => undefined;
    const props = mount(
      vi.fn().mockReturnValue(
        new Promise<ServiceLookupResponse>((resolve) => {
          release = resolve;
        }),
      ),
    );
    await pick(user);

    const busy = await screen.findByTestId('add-lookup-busy');
    expect(busy.getAttribute('role')).toBe('status');
    expect(busy.textContent).toBe(ADD_TITLE_LOOKING_UP);
    expect((screen.getByTestId('confirm-add-title') as HTMLButtonElement).disabled).toBe(true);
    expect(props.onAddTitle).not.toHaveBeenCalled();

    release(found(['max']));
    await waitFor(() => {
      expect(checked('add-service-max')).toBe(true);
    });
  });

  it('T-ADDINF-011a: no match proposes Waiting to stream, says so, and still lets the owner pick a service', async () => {
    const user = userEvent.setup();
    const props = mount(
      vi.fn().mockResolvedValue({
        status: 'none',
        services: [],
        destination: { kind: 'waiting' },
        checkedAt: '2026-10-11T00:00:00.000Z',
      } satisfies ServiceLookupResponse),
    );
    await pick(user);

    await waitFor(() => {
      expect(checked('add-waiting')).toBe(true);
    });
    expect(screen.getByTestId('add-lookup-note').textContent).toBe(ADD_TITLE_LOOKED_UP_NONE);
    expect(screen.getByTestId('confirm-add-title').textContent).toBe(ADD_TITLE_CONFIRM_WAITING);
    expect(props.onAddTitle).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('confirm-add-title'));
    await waitFor(() => {
      expect(props.onAddTitle).toHaveBeenCalledWith({
        tmdbId: 438631,
        mediaType: 'movie',
        destination: { kind: 'waiting' },
      });
    });
    expect(await screen.findByTestId('add-title-done')).toBeTruthy();
  });

  it('T-ADDINF-012a: the owner can deselect the proposal and pick another service by hand', async () => {
    const user = userEvent.setup();
    const props = mount(vi.fn().mockResolvedValue(found(['netflix'])));
    await pick(user);
    await waitFor(() => {
      expect(checked('add-service-netflix')).toBe(true);
    });

    await user.click(screen.getByTestId('add-service-netflix'));
    await user.click(screen.getByTestId('add-service-max'));
    await user.click(screen.getByTestId('confirm-add-title'));

    await waitFor(() => {
      expect(props.onAddTitle).toHaveBeenCalledWith({
        tmdbId: 438631,
        mediaType: 'movie',
        destination: { kind: 'services', services: ['max'] },
      });
    });
  });

  it('T-ADDINF-012b: Waiting and services are mutually exclusive, and an empty choice sends nothing', async () => {
    const user = userEvent.setup();
    const props = mount(vi.fn().mockResolvedValue(found(['netflix'])));
    await pick(user);
    await waitFor(() => {
      expect(checked('add-service-netflix')).toBe(true);
    });

    await user.click(screen.getByTestId('add-waiting'));
    expect(checked('add-service-netflix')).toBe(false);
    await user.click(screen.getByTestId('add-service-max'));
    expect(checked('add-waiting')).toBe(false);

    await user.click(screen.getByTestId('add-service-max'));
    await user.click(screen.getByTestId('confirm-add-title'));
    expect(await screen.findByTestId('add-service-required')).toBeTruthy();
    expect(props.onAddTitle).not.toHaveBeenCalled();
  });

  it('T-ADDINF-013a: an unknown lookup pre-selects nothing — not read as Waiting', async () => {
    const user = userEvent.setup();
    const props = mount(
      vi.fn().mockResolvedValue({
        status: 'unknown',
        services: [],
        destination: null,
        checkedAt: '2026-10-11T00:00:00.000Z',
      } satisfies ServiceLookupResponse),
    );
    await pick(user);

    await waitFor(() => {
      expect(screen.getByTestId('add-lookup-note').textContent).toBe(ADD_TITLE_LOOKUP_UNKNOWN);
    });
    expect(checked('add-waiting')).toBe(false);
    expect(checked('add-service-netflix')).toBe(false);
    await user.click(screen.getByTestId('confirm-add-title'));
    expect(await screen.findByTestId('add-service-required')).toBeTruthy();
    expect(props.onAddTitle).not.toHaveBeenCalled();
  });

  it('T-ADDINF-013b: a lookup that fails falls back to a manual choice with an explanation, and adding still works', async () => {
    const user = userEvent.setup();
    const props = mount(vi.fn().mockRejectedValue(new Error('tmdb down')));
    await pick(user);

    await waitFor(() => {
      expect(screen.getByTestId('add-lookup-note').textContent).toBe(ADD_TITLE_LOOKUP_FAILED);
    });
    expect(checked('add-waiting')).toBe(false);
    await user.click(screen.getByTestId('add-service-max'));
    await user.click(screen.getByTestId('confirm-add-title'));
    await waitFor(() => {
      expect(props.onAddTitle).toHaveBeenCalledWith({
        tmdbId: 438631,
        mediaType: 'movie',
        destination: { kind: 'services', services: ['max'] },
      });
    });
  });

  it('T-ADDINF-014a: a slow lookup that lands after Back is ignored', async () => {
    const user = userEvent.setup();
    let release: (value: ServiceLookupResponse) => void = () => undefined;
    mount(
      vi.fn().mockReturnValue(
        new Promise<ServiceLookupResponse>((resolve) => {
          release = resolve;
        }),
      ),
    );
    await pick(user);
    await screen.findByTestId('add-lookup-busy');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    release(found(['netflix']));
    await screen.findByTestId('add-select-438631');
    expect(screen.queryByTestId('add-service-netflix')).toBeNull();
  });

  it('T-ADDINF-015a: the proposal is announced as a status and the summary takes focus', async () => {
    const user = userEvent.setup();
    mount(vi.fn().mockResolvedValue(found(['netflix'])));
    await pick(user);

    const note = await screen.findByTestId('add-lookup-note');
    expect(note.getAttribute('role')).toBe('status');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('add-selected-summary'));
    });
    const box = screen.getByTestId('add-service-netflix');
    expect(box.closest('label')?.textContent).toContain('Netflix');
  });

  it('T-ADDINF-016a: a waiting add reports Waiting, not "in your library"', async () => {
    const user = userEvent.setup();
    mount(
      vi.fn().mockResolvedValue({
        status: 'none',
        services: [],
        destination: { kind: 'waiting' },
        checkedAt: 'x',
      } satisfies ServiceLookupResponse),
      {
        onAddTitle: vi.fn().mockResolvedValue({
          destination: 'waiting',
          intentId: 'i',
          titleId: 't',
          workIdentity: 'tmdb:movie:438631',
          name: 'Dune',
          discoverySource: 'search',
          titleWasCreated: true,
        }),
      },
    );
    await pick(user);
    await waitFor(() => {
      expect(checked('add-waiting')).toBe(true);
    });
    await user.click(screen.getByTestId('confirm-add-title'));
    const done = await screen.findByTestId('add-title-done');
    expect(done.textContent).toMatch(/waiting/i);
  });
});
