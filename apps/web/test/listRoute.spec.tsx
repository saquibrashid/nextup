/**
 * `T-DATA-002`, `T-DATA-007`, `T-DATA-008` — the screens actually fetch
 * (`specs/ui.md` §12, ADR-0012, TASK-176/177).
 *
 * ⚠ `T-DATA-002` IS THE ASSERTION WHOSE ABSENCE HID TWO WHOLE MISSING LAYERS.
 * Every other web test in this directory injects props into a component. That
 * measures whether the component renders what it is handed, and says nothing
 * at all about whether anything ever hands it real data — which is why a suite
 * of 179 passing tests, an axe-core pass and a 320 px overflow pass all held
 * on an application that fetched nothing and had no CSS.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ListRoute, collectGenres } from '../src/containers/ListRoute';
import { RefusedError, type ApiClient, type TitleListItem } from '../src/lib/apiClient';
import { LIST_LOADING_BODY } from '../src/copy';

function item(overrides: Partial<TitleListItem> = {}): TitleListItem {
  return {
    titleId: 'ttl_1',
    workIdentity: 'tmdb:movie:603',
    matchState: 'matched',
    name: 'The Matrix',
    mediaType: 'movie',
    releaseYear: 1999,
    genres: ['Action', 'Science Fiction'],
    runtimeMinutes: 136,
    posterPath: null,
    badges: [{ service: 'netflix', listingId: 'lst_1', dateAdded: '2026-01-04' }],
    sortDateAdded: '2026-01-04',
    dateAddedLabel: 'Added to nextup on 4 Jan 2026',
    ...overrides,
  };
}

/** A client whose every call is recorded and individually overridable. */
function stubClient(overrides: Partial<ApiClient> = {}) {
  const calls: string[] = [];
  const record =
    <T,>(name: string, value: T) =>
    async () => {
      calls.push(name);
      return value;
    };

  const client = {
    getTitles: record('getTitles', { items: [item()], nextCursor: null, limit: 50 }),
    getServiceState: record('getServiceState', { services: [] }),
    getSuppressions: record('getSuppressions', { items: [] }),
    getMe: record('getMe', {}),
    getTitle: record('getTitle', item()),
    suppressTitle: record('suppressTitle', {}),
    unsuppress: record('unsuppress', {}),
    createBatch: record('createBatch', {}),
    addBatchImages: record('addBatchImages', {}),
    removeBatchImage: record('removeBatchImage', {}),
    submitBatch: record('submitBatch', {}),
    discardBatch: record('discardBatch', {}),
    lookupImdb: record('lookupImdb', null),
    ...overrides,
  } as unknown as ApiClient;

  return { client, calls };
}

function renderRoute(client: ApiClient, url = '/', strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <ListRoute client={client} />
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('T-DATA-002 — the list screen reads its data from the API', () => {
  it('T-DATA-002a: mounting the list route requests titles', async () => {
    const { client, calls } = stubClient();
    renderRoute(client);

    await waitFor(() => {
      expect(calls).toContain('getTitles');
    });
    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
  });

  it('T-DATA-002b: it also reads service state and suppressions, not just titles', async () => {
    const { client, calls } = stubClient();
    renderRoute(client);

    // ⚠ Both are empty-state DISCRIMINATORS, not decoration: the suppressed
    // count is what separates "Nothing on your list right now" from "Nothing
    // here yet", and the latter on a non-empty history reads as data loss.
    await waitFor(() => {
      expect(calls).toContain('getServiceState');
      expect(calls).toContain('getSuppressions');
    });
  });

  it('T-DATA-002c: the never-uploaded empty state does NOT render while loading', async () => {
    // ⚠ THE REGRESSION THIS EXISTS FOR. Zero rows with no filters is
    // indistinguishable from an empty library, so without a loading state the
    // owner of a full list is told "Nothing here yet" on every page load,
    // briefly, on the way to their data.
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { client } = stubClient({
      getTitles: (() =>
        pending.then(() => ({
          items: [item()],
          nextCursor: null,
          limit: 50,
        }))) as unknown as ApiClient['getTitles'],
    });

    renderRoute(client);

    expect(screen.getByText(LIST_LOADING_BODY)).toBeInTheDocument();
    expect(screen.queryByTestId('list-empty-never-uploaded')).not.toBeInTheDocument();

    release(undefined);
    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
  });

  it('T-DATA-002d: a failed read says nothing has changed and offers retry', async () => {
    const { client } = stubClient({
      getTitles: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as ApiClient['getTitles'],
    });

    renderRoute(client);

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByTestId('list-empty-never-uploaded')).not.toBeInTheDocument();
  });

  it('T-DATA-002e: a 403 renders the refusal, not the failure state', async () => {
    const { client } = stubClient({
      getTitles: (async () => {
        throw new RefusedError('Not this account.', {});
      }) as unknown as ApiClient['getTitles'],
    });

    renderRoute(client);

    // ⚠ Wait for the POSITIVE first. `waitFor` on an absence resolves on the
    // very first tick — before anything has rendered — so asserting the
    // refusal text after it raced the render and failed on slower CI runners.
    // Ordering it this way is also strictly stronger: it proves the refusal
    // arrived AND that no retry came with it.
    expect(await screen.findByText(/isn't set up for this account/i)).toBeInTheDocument();
    // A refusal must never offer retry: the owner is authenticated, so every
    // retry produces the identical 403, forever.
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('T-DATA-002f: a failed freshness strip does not blank the list', async () => {
    const { client } = stubClient({
      getServiceState: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as ApiClient['getServiceState'],
    });

    renderRoute(client);

    // §2.1 — the strip is informational and never a gate in front of the rows.
    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
  });
});

describe('T-DATA-007 — the query string is the request', () => {
  it('T-DATA-007a: filters in the URL are sent to the API verbatim', async () => {
    const seen: string[] = [];
    const { client } = stubClient({
      getTitles: (async (query: string) => {
        seen.push(query);
        return { items: [item()], nextCursor: null, limit: 50 };
      }) as unknown as ApiClient['getTitles'],
    });

    renderRoute(client, '/?service=netflix&genre=Action');

    await waitFor(() => {
      expect(seen).toContain('service=netflix&genre=Action');
    });
  });

  it('T-DATA-007b: with no filter, the unfiltered list is NOT fetched twice', async () => {
    const seen: string[] = [];
    const { client } = stubClient({
      getTitles: (async (query: string) => {
        seen.push(query);
        return { items: [item()], nextCursor: null, limit: 50 };
      }) as unknown as ApiClient['getTitles'],
    });

    renderRoute(client, '/');
    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(0);
    });

    // The filtered request already IS the unfiltered one; a second identical
    // call would double the cost of every list load on one 0.25 vCPU replica.
    expect(seen).toEqual(['']);
  });

  it('T-DATA-007c: no component state mirrors the filters', () => {
    // A mirrored copy desynchronises on the back button, a reload and a shared
    // link — silently, showing a list that contradicts its own controls.
    const source = String(ListRoute);
    expect(source).not.toMatch(/useState/);
  });
});

describe('T-DATA-008 — no mutation on mount, including under StrictMode', () => {
  it('T-DATA-008a: mounting the list route issues no mutating call', async () => {
    const { client, calls } = stubClient();
    renderRoute(client, '/', true);

    await waitFor(() => {
      expect(calls).toContain('getTitles');
    });

    // ⚠ StrictMode double-invokes effects in DEVELOPMENT ONLY, so a POST in a
    // mount effect fires twice here and exactly once in a production build —
    // meaning the duplicate batch and duplicate extraction run would surface
    // first in the owner's real data, not in any test.
    const mutating = ['suppressTitle', 'unsuppress', 'createBatch', 'submitBatch', 'discardBatch'];
    expect(calls.filter((call) => mutating.includes(call))).toEqual([]);
  });

  it('T-DATA-008b: reads are not duplicated into state under StrictMode', async () => {
    const { client } = stubClient();
    renderRoute(client, '/', true);

    // A read may legitimately be issued twice by the double-invoke; what must
    // not happen is two results racing into state. One row, not two.
    expect(await screen.findAllByText('The Matrix')).toHaveLength(1);
  });
});

describe('collectGenres', () => {
  it('T-DATA-002g: the genre facet is derived from the rows, deduplicated and sorted', () => {
    expect(
      collectGenres([
        item({ genres: ['Thriller', 'Action'] }),
        item({ genres: ['Action', 'Comedy'] }),
      ]),
    ).toEqual(['Action', 'Comedy', 'Thriller']);
  });
});

describe('useResource — abort handling', () => {
  it('T-DATA-002h: an aborted request never renders as a failure', async () => {
    // ⚠ Under StrictMode the first mount's request is ALWAYS aborted. Treating
    // that as a failure would render every screen as broken in development and
    // nowhere else — the hardest class of bug to believe.
    const { client } = stubClient({
      getTitles: (async (_query: string, signal?: AbortSignal) => {
        if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError');
        return { items: [item()], nextCursor: null, limit: 50 };
      }) as unknown as ApiClient['getTitles'],
    });

    renderRoute(client, '/', true);

    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe('T-DATA-009 — polling stops', () => {
  it('T-DATA-009a: only the batch-status container starts a repeating timer', async () => {
    // REQ-103 permits polling of a RUNNING batch only, from an open screen.
    // ⚠ THE ASSERTION IS A ONE-MODULE ALLOW-LIST, NOT A BAN. It used to be a
    // ban, because the screen that polls did not exist; a ban would now be
    // satisfied only by deleting the poll, and relaxing it to "some module may
    // poll" would let a second timer appear anywhere. The behavioural half —
    // that this one timer stops at a settled status, on unmount and while the
    // tab is hidden — is `T-DATA-009b`…`f` in `mutatingFlows.spec.tsx`.
    const { readFileSync, readdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
      ? join(process.cwd(), 'apps', 'web', 'src')
      : join(process.cwd(), 'src');

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.tsx?$/.test(entry.name) ? [full] : [];
      });

    const offenders = walk(root)
      .filter((file) => /setInterval\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => file.split(/[\\/]/).slice(-2).join('/'));
    expect(offenders).toEqual(['containers/BatchStatusRoute.tsx']);
  });
});

describe('no unexpected console noise', () => {
  it('T-DATA-002i: mounting the list route logs no React warning', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = stubClient();
    renderRoute(client, '/', true);
    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
