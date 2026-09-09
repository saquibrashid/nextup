/**
 * TASK-188/189 — the waiting view's presentation rules.
 *
 * `T-AVAIL-006` (the sentence the data can support), `T-AVAIL-003a` (a flagged
 * work is an INVITATION, never an automatic add) and `T-WAIT-009` ("not
 * interested" on a waiting work is the ordinary suppression).
 *
 * ⚠ **`T-AVAIL-006` IS THE POINT OF THIS FILE.** Every other assertion here
 * passes just as happily against a build that renders *"not streaming
 * anywhere"* — a claim about every service in the world, from data that only
 * ever answered a question about two. `availableOn = null` means the question
 * was not answered; `[]` means it was answered and no subscription provider
 * carries it. Neither licenses the stronger sentence.
 *
 * ⚠ **`T-AVAIL-003a` ASSERTS AN ABSENCE AS WELL AS A PRESENCE.** The flag must
 * invite the owner to go and add the work themselves, through the ordinary
 * capture path. A build that "helpfully" added it would satisfy any test that
 * only looked for the flag.
 */

import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import type { WaitingItem } from '../src/lib/apiClient';
import {
  JUSTWATCH_ATTRIBUTION,
  RETRY_LABEL,
  WAITING_EMPTY_BODY,
  WAITING_EMPTY_TITLE,
  WAITING_NOT_CHECKED,
  WAITING_NOT_ON_YOUR_SERVICES,
  WAITING_REFRESH_FAILED,
} from '../src/copy';
import { WaitingPage, availabilityLine } from '../src/pages/WaitingPage';

function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

function item(over: Partial<WaitingItem> = {}): WaitingItem {
  return {
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:438631',
    name: 'Dune',
    releaseYear: 2021,
    posterPath: '/p.jpg',
    discoveredAt: '2026-01-04',
    discoverySource: 'fandango-at-home',
    availableOn: null,
    flaggedOn: null,
    availabilityCheckedAt: '2026-02-01T00:00:00.000Z',
    availabilityRegion: 'US',
    ...over,
  };
}

describe('T-AVAIL-006 · US-042 AC-6 · the sentence the data can support', () => {
  it('T-AVAIL-006a · NOT KNOWN renders as a claim about the owner\u2019s own services', () => {
    render(<WaitingPage items={[item({ availableOn: null })]} />);

    const line = screen.getByTestId('waiting-availability').textContent ?? '';
    expect(line).toContain(WAITING_NOT_ON_YOUR_SERVICES);
    expect(line).toContain('2026-02-01');
  });

  it('T-AVAIL-006b · ASKED-AND-NOBODY renders the SAME bounded sentence', () => {
    // ⚠ `[]` is the case a build is most tempted to render as "not streaming
    // anywhere" — TMDB really did answer, and it really did name nobody. It
    // named nobody IN ONE REGION, for the providers JustWatch tracks. The
    // owner's services are the only thing this app can honestly speak for.
    render(<WaitingPage items={[item({ availableOn: [] })]} />);

    expect(screen.getByTestId('waiting-availability').textContent).toContain(
      WAITING_NOT_ON_YOUR_SERVICES,
    );
  });

  it('T-AVAIL-006c · the forbidden sentence appears on no rendering of either case', () => {
    // The load-bearing negative, asserted against the whole document rather
    // than one node: the rule is that the claim is absent, not that one
    // particular element does not carry it.
    for (const availableOn of [null, [], ['Some Rental Store']]) {
      const { unmount } = render(<WaitingPage items={[item({ availableOn })]} />);
      expect(document.body.textContent).not.toContain('not streaming anywhere');
      expect(document.body.textContent).not.toContain('Not streaming anywhere');
      unmount();
    }
  });

  it('T-AVAIL-006d · a never-checked row says so instead of inventing an as-of date', () => {
    render(<WaitingPage items={[item({ availabilityCheckedAt: null })]} />);
    expect(screen.getByTestId('waiting-availability').textContent).toBe(WAITING_NOT_CHECKED);
  });

  it('T-AVAIL-006e · the rule is decided by the sentence chooser, not by the DOM', () => {
    expect(availabilityLine(item({ availabilityCheckedAt: null }))).toBe(WAITING_NOT_CHECKED);
    expect(availabilityLine(item())).toBe(`${WAITING_NOT_ON_YOUR_SERVICES} 2026-02-01.`);
  });
});

describe('T-AVAIL-003c/d · US-042 AC-3 · flagged is an invitation, never an add', () => {
  it('T-AVAIL-003c · a flatrate hit on an owner service is flagged with a link', () => {
    render(<WaitingPage items={[item({ availableOn: ['Netflix'], flaggedOn: ['netflix'] })]} />);

    const flag = screen.getByTestId('waiting-flag');
    expect(flag.textContent).toContain('Now on Netflix');
    // The invitation, not an action this screen takes on the owner's behalf.
    expect(screen.getByTestId('waiting-flag-link').getAttribute('href')).toBe('/upload');
    // And the row is still in the WAITING view — it has not moved anywhere.
    expect(screen.getAllByTestId('waiting-row')).toHaveLength(1);
  });

  it('T-AVAIL-003d · a rent-only answer is not flagged', () => {
    // The server already filters to `flatrate`, so `flaggedOn: []` is what a
    // rent-only work looks like here. Rendering it as a hit would invert the
    // feature: rent-availability is exactly what the owner is waiting to
    // escape (US-042 AC-5).
    render(<WaitingPage items={[item({ availableOn: ['Fandango At Home'], flaggedOn: [] })]} />);

    expect(screen.queryByTestId('waiting-flag')).toBeNull();
    expect(screen.getByTestId('waiting-availability').textContent).toContain(
      WAITING_NOT_ON_YOUR_SERVICES,
    );
  });
});

describe('T-AVAIL-009 · US-042 AC-9 · the JustWatch attribution', () => {
  it('T-AVAIL-009b · is present whether or not any row has provider data', () => {
    const { unmount } = render(<WaitingPage items={[]} />);
    expect(screen.getByTestId('justwatch-attribution').textContent).toBe(JUSTWATCH_ATTRIBUTION);
    unmount();

    render(<WaitingPage items={[item({ availableOn: ['Netflix'], flaggedOn: ['netflix'] })]} />);
    expect(screen.getByTestId('justwatch-attribution').textContent).toBe(JUSTWATCH_ATTRIBUTION);
  });
});

describe('T-AVAIL-007c · US-042 AC-7 · a failed refresh is a note, never a blank page', () => {
  it('T-AVAIL-007c · last-known rows still render, with an unobtrusive note', () => {
    render(
      <WaitingPage
        refreshFailed
        items={[item({ availableOn: ['Netflix'], flaggedOn: ['netflix'] })]}
      />,
    );

    expect(screen.getByTestId('waiting-refresh-failed').textContent).toBe(WAITING_REFRESH_FAILED);
    // The data is still there. Never blank, never an error page.
    expect(screen.getByTestId('waiting-flag').textContent).toContain('Now on Netflix');
    expect(screen.queryByTestId('waiting-load-error')).toBeNull();
  });
});

describe('T-WAIT-009 · US-043 AC-4 · "not interested" is the ordinary suppression', () => {
  it('T-WAIT-009a · suppresses by title id, through the same endpoint as any other work', async () => {
    // ⚠ The ASSERTION IS THE CALL, not the disappearance. Suppression is keyed
    // on canonical work identity server-side (REQ-070/071); a waiting-specific
    // client path would be a second thing that can disagree with the first.
    const onSuppress = vi.fn().mockResolvedValue({ suppressionId: 's-1' });
    render(<WaitingPage items={[item({ titleId: 'title-dune' })]} onSuppress={onSuppress} />);

    fireEvent.click(screen.getByTestId('waiting-not-interested'));

    await waitFor(() => expect(onSuppress).toHaveBeenCalledWith('title-dune'));
  });

  it('T-WAIT-009b · the row leaves the view once it succeeds', async () => {
    const onSuppress = vi.fn().mockResolvedValue({});
    render(<WaitingPage items={[item()]} onSuppress={onSuppress} />);

    fireEvent.click(screen.getByTestId('waiting-not-interested'));

    await waitFor(() => expect(screen.queryByTestId('waiting-row')).toBeNull());
    expect(screen.getByTestId('waiting-empty')).toBeTruthy();
  });

  it('T-WAIT-009c · a failure keeps the row and offers a retry', async () => {
    const onSuppress = vi.fn().mockRejectedValue(new Error('nope'));
    render(<WaitingPage items={[item()]} onSuppress={onSuppress} />);

    fireEvent.click(screen.getByTestId('waiting-not-interested'));

    await waitFor(() => expect(screen.getByTestId('waiting-suppress-error')).toBeTruthy());
    expect(screen.getByTestId('waiting-row')).toBeTruthy();
    expect(screen.getByTestId('waiting-not-interested').textContent).toBe(RETRY_LABEL);
  });
});

describe('T-WAIT-010 · US-043 AC-6 · the empty view explains itself', () => {
  it('T-WAIT-010b · names what the view is for and how to fill it', () => {
    render(<WaitingPage items={[]} />);

    expect(screen.getByTestId('waiting-empty').textContent).toContain(WAITING_EMPTY_TITLE);
    expect(screen.getByTestId('waiting-empty').textContent).toContain(WAITING_EMPTY_BODY);
    // "How to fill it" has to be reachable, not merely described.
    expect(screen.getByTestId('waiting-empty').querySelector('a')?.getAttribute('href')).toBe(
      '/upload',
    );
  });

  it('T-WAIT-010c · a load failure is an error with a retry, not the empty state', () => {
    // ⚠ These two must not collapse into one another: "you are waiting on
    // nothing" and "we could not find out what you are waiting on" look
    // identical on screen and mean opposite things.
    const onRetry = vi.fn();
    render(<WaitingPage loadFailed onRetry={onRetry} />);

    expect(screen.queryByTestId('waiting-empty')).toBeNull();
    fireEvent.click(screen.getByText(RETRY_LABEL));
    expect(onRetry).toHaveBeenCalled();
  });

  it('T-WAIT-010d · the loading state is announced, not silently empty', () => {
    render(<WaitingPage loading />);
    expect(screen.getByTestId('waiting-loading')).toBeTruthy();
    expect(screen.queryByTestId('waiting-empty')).toBeNull();
  });
});
