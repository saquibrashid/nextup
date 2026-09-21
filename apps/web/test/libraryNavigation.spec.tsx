import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryNavigation, libraryQuery } from '../src/components/LibraryNavigation';
import { ListRoute } from '../src/containers/ListRoute';
import { apiClient, type ApiClient } from '../src/lib/apiClient';

const KEY = 'nextup.library.v1';
const CHOICES = 'service=max&type=tv&genre=Drama&runtime=30-60&sort=name&dir=asc&q=Orbit';

function Controls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="url">{location.pathname + location.search}</output>
      <output data-testid="state">{JSON.stringify(location.state)}</output>
      <Link to="/upload">Upload fixture</Link>
      <Link to="/batches">History fixture</Link>
      <Link to="/batches/first/review">Review fixture</Link>
      <Link to="/titles/first">Details fixture</Link>
      <Link to="/">Return to list</Link>
      <Link to="/?sort=runtime&dir=desc">Explicit order</Link>
      <Link to={`/?${CHOICES}`}>Choose filters</Link>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
      <button onClick={() => navigate('/', { state: { receipt: 'preserved' } })}>
        Applied return
      </button>
      <button onClick={() => navigate('/')}>Clear all query</button>
    </>
  );
}

function mount(path = '/', client: ApiClient = apiClient) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Controls />
        <LibraryNavigation>
          <Routes>
            <Route path="/" element={<ListRoute client={client} />} />
            <Route path="*" element={<p>Other destination</p>} />
          </Routes>
        </LibraryNavigation>
      </MemoryRouter>
    </StrictMode>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(apiClient, 'getTitles').mockResolvedValue({ items: [], nextCursor: null, limit: 50 });
  vi.spyOn(apiClient, 'getServiceState').mockResolvedValue({ services: [] });
  vi.spyOn(apiClient, 'getSuppressions').mockResolvedValue({ items: [] });
  vi.spyOn(apiClient, 'getRemoved').mockResolvedValue({
    items: [],
    nextCursor: null,
    limit: 50,
  });
});

afterEach(() => vi.restoreAllMocks());

describe('remembered library destination', () => {
  it('T-UX-166a: restores before the first list request and across a fresh app lifetime', async () => {
    const first = mount(`/?${CHOICES}`);
    await screen.findByTestId('zero-match');
    first.unmount();
    vi.mocked(apiClient.getTitles).mockClear();
    mount();
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(`/?${CHOICES}`));
    expect(vi.mocked(apiClient.getTitles).mock.calls[0]?.[0]).toBe(CHOICES);
    expect(screen.getByRole('searchbox', { name: 'Search your list' })).toHaveValue('Orbit');
    expect(screen.getByRole('button', { name: 'Remove genre filter: Drama' })).toBeVisible();
  });

  it.each(['/upload', '/batches', '/batches/first/review', '/titles/first'])(
    'T-UX-166b: returns from %s with the saved URL and navigation state',
    async (path) => {
      localStorage.setItem(KEY, CHOICES);
      mount(path);
      fireEvent.click(screen.getByRole('button', { name: 'Applied return' }));
      await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(`/?${CHOICES}`));
      expect(screen.getByTestId('state')).toHaveTextContent('preserved');
      expect(vi.mocked(apiClient.getTitles).mock.calls[0]?.[0]).toBe(CHOICES);
    },
  );

  it('T-UX-166c: explicit links replace remembered choices rather than merging', async () => {
    localStorage.setItem(KEY, CHOICES);
    mount('/?sort=runtime&dir=desc');
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe('sort=runtime&dir=desc'));
    expect(vi.mocked(apiClient.getTitles).mock.calls[0]?.[0]).toBe('sort=runtime&dir=desc');
    expect(screen.queryByRole('button', { name: 'Remove genre filter: Drama' })).toBeNull();
  });

  it('T-UX-166d: Back/Forward and an in-place clear keep their authoritative URLs', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Your list' });
    expect(vi.mocked(apiClient.getTitles).mock.calls[0]?.[0]).toBe('');
    fireEvent.click(screen.getByRole('link', { name: 'Choose filters' }));
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe(CHOICES));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(CHOICES));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all query' }));
    await waitFor(() => expect(screen.getByTestId('url').textContent).not.toContain('service='));
    fireEvent.click(screen.getByRole('link', { name: 'Upload fixture' }));
    fireEvent.click(screen.getByRole('link', { name: 'Return to list' }));
    await waitFor(() => expect(screen.getByTestId('url').textContent).not.toContain('service='));
  });

  it('T-UX-166e: supported absent genres stay visible and clearable; cursors are never remembered', async () => {
    mount('/?genre=Vanished&sort=dateAdded&dir=asc&cursor=old');
    await screen.findByTestId('zero-match');
    expect(localStorage.getItem(KEY)).toBe('genre=Vanished&sort=dateAdded&dir=asc');
    fireEvent.click(screen.getByRole('button', { name: 'Remove genre filter: Vanished' }));
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe('sort=dateAdded&dir=asc'));
  });

  it('T-UX-166f: obsolete stored values are validated and disclosed rather than breaking requests', async () => {
    localStorage.setItem(KEY, 'service=retired&type=bogus&sort=old&dir=wrong&cursor=secret');
    mount();
    await screen.findByText('Some saved browsing choices are no longer supported and were reset.');
    expect(vi.mocked(apiClient.getTitles).mock.calls[0]?.[0]).toBe('sort=dateAdded&dir=desc');
    expect(libraryQuery(new URLSearchParams(`q=${'x'.repeat(501)}`))).toBe(
      'sort=dateAdded&dir=desc',
    );
  });

  it('T-UX-166g: blocked storage reports the limitation but keeps in-app navigation working', async () => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (this === localStorage) throw new DOMException('Blocked', 'SecurityError');
      return originalGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === localStorage) throw new DOMException('Full', 'QuotaExceededError');
      originalSet.call(this, key, value);
    });
    mount(`/?${CHOICES}`);
    await screen.findByText(/could not remember them across restarts/);
    fireEvent.click(screen.getByRole('link', { name: 'Upload fixture' }));
    fireEvent.click(screen.getByRole('link', { name: 'Return to list' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(CHOICES));
  });
});
