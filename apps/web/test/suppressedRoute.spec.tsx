/**
 * `T-DATA-002` — the not-interested screen actually reads its data
 * (TASK-107, `specs/ui.md` §7/§12, ADR-0012).
 *
 * ⚠ **THIS IS THE ASSERTION WHOSE ABSENCE LEFT `/not-interested` BLANK.**
 * `suppressedPage.spec.tsx` has twenty passing cases and every one of them
 * hands `items` to the component by hand, which measures rendering and says
 * nothing about whether anything ever fetches. The route table mounted the
 * bare page, `items` defaulted to `[]`, and the screen told an owner with
 * suppressions that they had none — while the suite stayed green. These tests
 * are about the WIRING; the rendering is the other file's job.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SuppressedRoute } from '../src/containers/SuppressedRoute';
import { RefusedError, type ApiClient, type SuppressionItem } from '../src/lib/apiClient';

function suppression({
  suppressionId = 'sup_1',
  name = 'The Matrix',
}: { suppressionId?: string; name?: string } = {}): SuppressionItem {
  // ⚠ NO `as SuppressionItem` CAST. An earlier draft of this fixture invented
  // a flat `{ name, releaseYear }` shape and cast it; the compiler said
  // nothing and every row threw at runtime. The real contract nests them
  // under `displaySnapshot`.
  return {
    suppressionId,
    workIdentity: 'tmdb:movie:603',
    suppressedAt: '2026-01-04T00:00:00.000Z',
    identityStability: 'stable',
    displaySnapshot: {
      name,
      releaseYear: 1999,
      mediaType: 'movie',
      posterPath: null,
    },
    unsuppressHref: `/api/suppressions/${suppressionId}/unsuppress`,
  };
}

function stubClient(overrides: Partial<ApiClient> = {}) {
  const calls: string[] = [];
  const record =
    <T,>(name: string, value: T) =>
    async () => {
      calls.push(name);
      return value;
    };

  const client = {
    getSuppressions: record('getSuppressions', { items: [suppression()] }),
    unsuppress: record('unsuppress', {
      suppressionId: 'sup_1',
      active: false,
      restoredAnything: true,
    }),
    getTitles: record('getTitles', { items: [], nextCursor: null, limit: 50 }),
    getServiceState: record('getServiceState', { services: [] }),
    getMe: record('getMe', {}),
    ...overrides,
  } as unknown as ApiClient;

  return { client, calls };
}

function renderRoute(client: ApiClient, strict = false) {
  const tree = (
    <MemoryRouter initialEntries={['/not-interested']}>
      <SuppressedRoute client={client} />
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('T-DATA-002 — the not-interested screen reads its data from the API', () => {
  it('T-DATA-002j: mounting the not-interested route requests the suppressions', async () => {
    const { client, calls } = stubClient();
    renderRoute(client);

    await waitFor(() => {
      expect(calls).toContain('getSuppressions');
    });
    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
  });

  it('T-DATA-002k: the rows rendered are the ones the API returned, not defaults', async () => {
    // ⚠ THE REGRESSION. An unwired container renders the page's `items = []`
    // default, which is a legitimate, silent, permanently-green state.
    const { client } = stubClient({
      getSuppressions: (async () => ({
        items: [suppression({ suppressionId: 'sup_9', name: 'Dune' })],
      })) as unknown as ApiClient['getSuppressions'],
    });
    renderRoute(client);

    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(screen.queryByText('The Matrix')).not.toBeInTheDocument();
  });

  it('T-DATA-002l: the loading state shows while the read is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { client } = stubClient({
      getSuppressions: (async () => {
        await pending;
        return { items: [suppression()] };
      }) as unknown as ApiClient['getSuppressions'],
    });

    renderRoute(client);

    expect(await screen.findByTestId('suppressed-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('suppressed-list')).not.toBeInTheDocument();

    release(undefined);
    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
  });

  it('T-DATA-002m: a failed read says nothing has changed and offers retry', async () => {
    const { client } = stubClient({
      getSuppressions: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as ApiClient['getSuppressions'],
    });

    renderRoute(client);

    const error = await screen.findByTestId('suppressed-load-error');
    expect(error).toHaveTextContent(/nothing has changed/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // An empty LIST here would read as "you have never marked anything not
    // interested", which is the failure this screen must never impersonate.
    expect(screen.queryByTestId('suppressed-list')).not.toBeInTheDocument();
  });

  it('T-DATA-002n: retry re-issues the read', async () => {
    let attempts = 0;
    const { client } = stubClient({
      getSuppressions: (async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return { items: [suppression()] };
      }) as unknown as ApiClient['getSuppressions'],
    });

    renderRoute(client);

    await userEvent.click(await screen.findByRole('button', { name: /retry/i }));

    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('T-DATA-002o: a 403 renders the refusal, not the failure state', async () => {
    const { client } = stubClient({
      getSuppressions: (async () => {
        throw new RefusedError('Not this account.', {});
      }) as unknown as ApiClient['getSuppressions'],
    });

    renderRoute(client);

    expect(await screen.findByText(/isn't set up for this account/i)).toBeInTheDocument();
    // A refusal must never offer retry: the owner is authenticated, so every
    // retry produces the identical 403, forever.
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('suppressed-load-error')).not.toBeInTheDocument();
  });
});

describe('T-DATA-002 — un-suppressing is a mutation from a click', () => {
  it('T-DATA-002p: confirming a row calls unsuppress with that row\u2019s id', async () => {
    const seen: string[] = [];
    const { client } = stubClient({
      getSuppressions: (async () => ({
        items: [suppression({ suppressionId: 'sup_7', name: 'Dune' })],
      })) as unknown as ApiClient['getSuppressions'],
      unsuppress: (async (suppressionId: string) => {
        seen.push(suppressionId);
        return { suppressionId, active: false, restoredAnything: true };
      }) as unknown as ApiClient['unsuppress'],
    });

    renderRoute(client);

    await userEvent.click(await screen.findByTestId('stop-ignoring-button'));
    await userEvent.click(await screen.findByTestId('unsuppress-confirm-button'));

    await waitFor(() => {
      expect(seen).toEqual(['sup_7']);
    });
  });

  it('T-DATA-002q: no mutation is issued on mount, only on the click', async () => {
    // ⚠ REQ-102. React 19 double-invokes effects under StrictMode, so a
    // mutation placed in one fires twice — here that would silently restore a
    // title the owner never asked to restore.
    const { client, calls } = stubClient();
    renderRoute(client, true);

    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
    expect(calls).not.toContain('unsuppress');
  });

  it('T-DATA-002r: a failed un-suppression does not blank the list', async () => {
    const { client } = stubClient({
      unsuppress: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as ApiClient['unsuppress'],
    });

    renderRoute(client);

    await userEvent.click(await screen.findByTestId('stop-ignoring-button'));
    await userEvent.click(await screen.findByTestId('unsuppress-confirm-button'));

    expect(await screen.findByTestId('unsuppress-error')).toBeInTheDocument();
    expect(screen.getByTestId('suppressed-list')).toBeInTheDocument();
    expect(screen.getByText('The Matrix')).toBeInTheDocument();
  });

  it('T-DATA-002s: a successful un-suppression does NOT refetch the list', async () => {
    // A refetch's only visible effect is to remove a row the page has already
    // removed — and a refetch that FAILS would replace a screen that just
    // worked with an error about something that already succeeded.
    const { client, calls } = stubClient();
    renderRoute(client);

    await userEvent.click(await screen.findByTestId('stop-ignoring-button'));
    await userEvent.click(await screen.findByTestId('unsuppress-confirm-button'));

    await waitFor(() => {
      expect(calls).toContain('unsuppress');
    });
    expect(calls.filter((call) => call === 'getSuppressions')).toHaveLength(1);
  });
});

describe('T-DATA-002 — the route table mounts the container, not the bare page', () => {
  it('T-DATA-002t: /not-interested is wired to the container', async () => {
    // ⚠ The defect this file exists for was in the ROUTE TABLE, not the page:
    // mounting the prop-driven page directly is a permanently-green blank
    // screen. Asserting the container's behaviour alone would not catch a
    // revert of that one line.
    const { ROUTES } = await import('../src/routes');
    const route = ROUTES.find((candidate) => candidate.path === '/not-interested');
    expect(route?.Component).toBe(SuppressedRoute);
  });

  it('T-DATA-002u: mounting logs no React warning under StrictMode', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = stubClient();
    renderRoute(client, true);
    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
