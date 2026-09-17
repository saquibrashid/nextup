import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { SERVICES, SERVICE_LABELS, serviceFreshnessLabel } from '@nextup/domain';
import { ListPage } from '../src/pages/ListPage';
import { UploadPage } from '../src/pages/UploadPage';
import { UploadRoute } from '../src/containers/UploadRoute';
import { parseAppliedState } from '../src/containers/ListRoute';
import { parseFilters, applyFilters } from '../src/components/FilterBar';
import { FreshnessStrip } from '../src/components/FreshnessStrip';
import type { TitleListItem } from '../src/components/TitleRow';

const EXPECTED_LABELS = [
  'Netflix',
  'Max',
  'Prime Video',
  'Disney+',
  'Apple TV+',
  'Paramount+',
  'Starz',
  'Peacock',
];

const title: TitleListItem = {
  titleId: 'all-services',
  workIdentity: 'tmdb:movie:438631',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  releaseYear: 2021,
  genres: [],
  runtimeMinutes: 155,
  posterPath: null,
  badges: SERVICES.map((service) => ({ service, listingId: service, dateAdded: '2026-09-01' })),
  sortDateAdded: '2026-09-01',
  dateAddedLabel: 'Added to nextup 1 Sep 2026',
};

it('T-SVC-002a all eight services use correct labels and exclusive nondefault upload choices', () => {
  const choose = vi.fn();
  render(<UploadPage onSelectionChange={choose} />);
  expect(SERVICES.map((service) => SERVICE_LABELS[service])).toEqual(EXPECTED_LABELS);
  const group = screen.getByTestId('service-step');
  expect(within(group).getAllByRole('radio')).toHaveLength(8);
  expect(within(group).queryAllByRole('radio', { checked: true })).toHaveLength(0);
  for (const service of SERVICES) {
    fireEvent.click(
      within(group).getByRole('radio', { name: SERVICE_LABELS[service], exact: true }),
    );
    expect(within(group).getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(choose).toHaveBeenLastCalledWith({ service, mode: null });
    expect(screen.getByTestId('mode-card-full-update-consequence')).toHaveTextContent(
      SERVICE_LABELS[service],
    );
  }
});

it.each(SERVICES)(
  'T-SVC-002b upload links preselect %s without selecting a mode or writing a batch',
  (service) => {
    render(
      <MemoryRouter initialEntries={[`/upload?service=${service}`]}>
        <UploadRoute />
      </MemoryRouter>,
    );
    expect(screen.getByRole('radio', { name: SERVICE_LABELS[service], exact: true })).toBeChecked();
    expect(
      within(screen.getByTestId('mode-step')).queryAllByRole('radio', { checked: true }),
    ).toHaveLength(0);
    expect(screen.getByTestId('file-input')).toBeEnabled();
  },
);

it.each(SERVICES)(
  'T-SVC-002c manual add submits exactly the selected %s service',
  async (service) => {
    const add = vi
      .fn()
      .mockResolvedValue({ titleId: 'added', name: 'Dune', titleWasCreated: true });
    const search = vi.fn().mockResolvedValue({
      items: [
        { tmdbId: 438631, mediaType: 'movie', name: 'Dune', releaseYear: 2021, posterPath: null },
      ],
    });
    render(
      <MemoryRouter>
        <ListPage items={[title]} onAddTitle={add} onSearchTmdb={search} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('add-title-open'));
    fireEvent.change(screen.getByTestId('add-title-search-input'), { target: { value: 'Dune' } });
    fireEvent.click(await screen.findByTestId('add-select-438631'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('radio')).toHaveLength(8);
    expect(within(dialog).queryAllByRole('radio', { checked: true })).toHaveLength(0);
    fireEvent.click(screen.getByTestId(`add-service-${service}`));
    fireEvent.click(screen.getByTestId('confirm-add-title'));
    await waitFor(() =>
      expect(add).toHaveBeenCalledExactlyOnceWith({ tmdbId: 438631, mediaType: 'movie', service }),
    );
  },
);

it('T-SVC-002d one title renders all eight badges and filter URLs retain all selected services', () => {
  render(
    <MemoryRouter>
      <ListPage items={[title]} />
    </MemoryRouter>,
  );
  expect(screen.getAllByTestId('title-name')).toHaveLength(1);
  const badges = screen.getByTestId('badges');
  for (const label of EXPECTED_LABELS)
    expect(within(badges).getByText(label, { exact: true })).toBeVisible();
  const params = new URLSearchParams('sort=watchPriority&dir=asc');
  for (const service of SERVICES) params.append('service', service);
  const filters = parseFilters(params);
  expect(filters.services).toEqual(SERVICES);
  expect(applyFilters(new URLSearchParams('sort=watchPriority&dir=asc'), filters).toString()).toBe(
    params.toString(),
  );
});

it('T-SVC-002e every service has an independently named factual update link', () => {
  render(
    <MemoryRouter>
      <FreshnessStrip
        services={SERVICES.map((service) => ({
          service,
          lastCompletedBatchAt: null,
          lastCompletedBatchId: null,
          ageDays: null,
          label: serviceFreshnessLabel(service, null),
        }))}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Service updates' }));
  expect(screen.queryByTestId('freshness-degraded')).not.toBeInTheDocument();
  for (const service of SERVICES) {
    expect(
      screen.getByRole('link', { name: `${SERVICE_LABELS[service]} has never been updated` }),
    ).toHaveAttribute('href', `/upload?service=${service}`);
  }
});

it('T-SVC-002f post-close notices accept every supported service and refuse unknown sources', () => {
  const applied = {
    batchId: 'batch',
    undoable: true,
    summary: { listingsCreated: 1, listingsRemoved: 0, removalGroupId: null },
  };
  for (const service of SERVICES) {
    expect(parseAppliedState({ applied: { ...applied, service } })?.service).toBe(service);
  }
  expect(
    parseAppliedState({ applied: { ...applied, service: 'unsupported-service' } }),
  ).toBeUndefined();
});
