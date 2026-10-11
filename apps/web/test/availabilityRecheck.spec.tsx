/**
 * US-068 (PRD `A59`) — "Check now" on one title and "Re-check everything" on
 * the Availability screen, on the web.
 *
 * ⚠ Invariant 8a: the control states a fact ("Checked just now") and never
 * nags. ⚠ Invariant 5: it is owner-pressed; nothing here fires on its own.
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckNowControl, checkedLabel } from '../src/components/CheckNowControl';
import type { TitleAvailability } from '../src/components/TitleRow';
import type { ApiClient, TitleDetailResponse, WaitingItem } from '../src/lib/apiClient';
import { AvailabilityReviewPage } from '../src/pages/AvailabilityReviewPage';
import { TitleDetailsPage } from '../src/pages/TitleDetailsPage';
import { WaitingDetailsPage } from '../src/pages/WaitingDetailsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = new Date('2026-10-05T12:00:00.000Z');

describe('T-RECHECK-007 the Check now control', () => {
  it('T-RECHECK-007a: checkedLabel states the fact — just now, today, a date, never', () => {
    expect(checkedLabel('2026-10-05T11:59:00.000Z', NOW)).toBe('Checked just now');
    expect(checkedLabel('2026-10-05T08:00:00.000Z', NOW)).toBe('Checked today');
    expect(checkedLabel('2026-09-20T08:00:00.000Z', NOW)).toMatch(/^Checked /);
    expect(checkedLabel(null, NOW)).toBe('Not checked yet');
    expect(checkedLabel('garbage', NOW)).toBe('Not checked yet');
  });

  function mount(
    check: () => Promise<unknown>,
    extra: { hasMatch?: boolean; offline?: boolean } = {},
  ) {
    const onChecked = vi.fn();
    render(
      <CheckNowControl
        name="The Housemaid"
        checkedAt="2026-09-01T10:00:00.000Z"
        hasMatch={extra.hasMatch ?? true}
        offline={extra.offline ?? false}
        check={check}
        onChecked={onChecked}
      />,
    );
    return { onChecked };
  }

  it('T-RECHECK-007b: idle → checking (disabled) → done "Checked just now", then re-reads', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const { onChecked } = mount(() => new Promise((r) => (resolve = r)));
    expect(screen.getByTestId('check-now-fact')).toHaveTextContent(/^Checked /);
    await userEvent.click(screen.getByTestId('check-now-button'));
    expect(screen.getByTestId('check-now-button')).toHaveTextContent('Checking…');
    expect(screen.getByTestId('check-now-button')).toBeDisabled();
    await act(async () => {
      resolve({});
      await Promise.resolve();
    });
    expect(screen.getByTestId('check-now-fact')).toHaveTextContent('Checked just now');
    expect(screen.getByTestId('check-now-button')).toHaveTextContent('Check now');
    expect(onChecked).toHaveBeenCalledOnce();
  });

  it('T-RECHECK-007c: a failed lookup says so, keeps the stored fact, offers Try again', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({});
    const { onChecked } = mount(check);
    await userEvent.click(screen.getByTestId('check-now-button'));
    await waitFor(() => expect(screen.getByTestId('check-now-error')).toBeInTheDocument());
    expect(screen.getByTestId('check-now-button')).toHaveTextContent('Try again');
    expect(screen.getByTestId('check-now-fact')).toHaveTextContent(/^Checked /);
    expect(screen.getByTestId('check-now-fact')).not.toHaveTextContent('just now');
    expect(onChecked).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('check-now-button'));
    await waitFor(() => expect(onChecked).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('check-now-error')).toBeNull();
  });

  it('T-RECHECK-007d: no TMDB match disables it with a reason; offline too', () => {
    mount(() => Promise.resolve({}), { hasMatch: false });
    expect(screen.getByTestId('check-now-button')).toBeDisabled();
    expect(screen.getByTestId('check-now-reason')).toHaveTextContent(/No TMDB match/);
    cleanup();
    mount(() => Promise.resolve({}), { offline: true });
    expect(screen.getByTestId('check-now-button')).toBeDisabled();
    expect(screen.getByTestId('check-now-reason')).toBeInTheDocument();
  });
});

const JOINED: TitleAvailability = {
  accessState: 'streaming',
  checkedAt: '2026-10-05T12:00:00.000Z',
  region: 'US',
  streamingOn: ['starz', 'max'] as never,
  rentOn: [],
  left: [],
  joined: ['max'],
  signature: 'left=;joined=max',
  kept: false,
  canMoveToWaiting: false,
};

const BASE = {
  titleId: 'title-1',
  workIdentity: 'tmdb:movie:1',
  matchState: 'matched',
  name: 'The Housemaid',
  mediaType: 'movie',
  releaseYear: 2025,
  genres: [],
  runtimeMinutes: null,
  posterPath: null,
  imdbRating: null,
  listState: 'active',
  badges: [{ service: 'starz', listingId: 'l-1', dateAdded: '2026-01-05' }],
  sortDateAdded: '2026-01-05',
  dateAddedLabel: null,
  availability: null,
} as unknown as TitleDetailResponse;

describe('T-RECHECK-008 where the control sits and what it reveals', () => {
  it('T-RECHECK-008a: on the title details, a successful check reveals the Add badge prompt', async () => {
    const checkTitleAvailabilityNow = vi.fn().mockResolvedValue({});
    function Harness() {
      const [item, setItem] = useState<TitleDetailResponse>(BASE);
      return (
        <MemoryRouter>
          <TitleDetailsPage
            item={item}
            backTo="/"
            offline={false}
            actions={{ checkTitleAvailabilityNow, addBadge: vi.fn() } as never}
            onReload={() => setItem({ ...BASE, availability: JOINED })}
          />
        </MemoryRouter>
      );
    }
    render(<Harness />);
    expect(screen.queryByTestId('availability-add-max')).toBeNull();
    await userEvent.click(screen.getByTestId('check-now-button'));
    await waitFor(() => expect(screen.getByTestId('availability-add-max')).toBeInTheDocument());
    expect(checkTitleAvailabilityNow).toHaveBeenCalledWith('title-1');
    expect(screen.getByTestId('check-now-fact')).toHaveTextContent('Checked just now');
  });

  it('T-RECHECK-008b: an unmatched Library title shows it disabled with a reason', () => {
    render(
      <MemoryRouter>
        <TitleDetailsPage
          item={{ ...BASE, matchState: 'unmatched' } as TitleDetailResponse}
          backTo="/"
          offline={false}
          actions={{ checkTitleAvailabilityNow: vi.fn() } as never}
          onReload={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('check-now-button')).toBeDisabled();
    expect(screen.getByTestId('check-now-reason')).toBeInTheDocument();
  });

  it('T-RECHECK-008c: on the waiting details it checks by intent id and reloads', async () => {
    const onCheckNow = vi.fn().mockResolvedValue({});
    const onReload = vi.fn();
    const item = {
      intentId: 'wi-1',
      titleId: 'title-1',
      workIdentity: 'tmdb:movie:1',
      name: 'The Housemaid',
      releaseYear: 2025,
      posterPath: null,
      discoveredAt: '2026-09-24',
      discoverySource: 'search',
      availableOn: [],
      flaggedOn: [],
      otherServicesOn: [],
      otherProvidersOn: [],
      accessState: 'not-seen',
      rentOn: [],
      availabilityCheckedAt: null,
      availabilityRegion: 'US',
      forecast: null,
    } as unknown as WaitingItem;
    render(
      <MemoryRouter>
        <WaitingDetailsPage
          item={item}
          title={BASE}
          offline={false}
          onReload={onReload}
          onSuppress={vi.fn()}
          onSuppressed={vi.fn()}
          onCheckNow={onCheckNow}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('check-now-fact')).toHaveTextContent('Not checked yet');
    await userEvent.click(screen.getByTestId('check-now-button'));
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect(onCheckNow).toHaveBeenCalledWith('wi-1');
  });
});

describe('T-RECHECK-009 Re-check everything on the Availability screen', () => {
  function mount() {
    const checkMoreAvailability = vi
      .fn()
      .mockResolvedValueOnce({
        lookedUp: 20,
        failed: 0,
        checked: 150,
        notCheckedRecently: 30,
        recheck: { since: 'S', cursor: 'C1', total: 50, remaining: 30, processed: 20, done: false },
      })
      .mockResolvedValueOnce({
        lookedUp: 30,
        failed: 0,
        checked: 180,
        notCheckedRecently: 0,
        recheck: { since: 'S', cursor: 'C2', total: 50, remaining: 0, processed: 50, done: true },
      });
    const onChanged = vi.fn();
    render(
      <MemoryRouter>
        <AvailabilityReviewPage
          data={{
            library: [],
            nowStreaming: [],
            check: { checked: 130, notCheckedRecently: 0 },
          }}
          loading={false}
          loadFailed={false}
          onRetry={vi.fn()}
          offline={false}
          actions={{ checkMoreAvailability } as unknown as ApiClient}
          onChanged={onChanged}
        />
      </MemoryRouter>,
    );
    return { checkMoreAvailability, onChanged };
  }

  it('T-RECHECK-009a: it works when nothing is stale, shows N of M, and continues with since and cursor', async () => {
    const { checkMoreAvailability, onChanged } = mount();
    expect(screen.getByTestId('avrev-check-more')).toBeDisabled();
    await userEvent.click(screen.getByTestId('avrev-recheck-all'));
    expect(checkMoreAvailability).toHaveBeenNthCalledWith(1, 'all');
    await waitFor(() =>
      expect(screen.getByTestId('avrev-recheck-progress')).toHaveTextContent('20 of 50 re-checked'),
    );
    expect(screen.getByTestId('avrev-recheck-all')).toHaveTextContent('Continue re-check');
    await userEvent.click(screen.getByTestId('avrev-recheck-all'));
    expect(checkMoreAvailability).toHaveBeenNthCalledWith(2, { since: 'S', cursor: 'C1' });
    await waitFor(() =>
      expect(screen.getByTestId('avrev-recheck-progress')).toHaveTextContent(
        'Everything has been re-checked.',
      ),
    );
    expect(screen.getByTestId('avrev-recheck-all')).toBeDisabled();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});
