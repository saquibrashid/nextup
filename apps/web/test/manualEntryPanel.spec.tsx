/**
 * TASK-067 — `ManualEntryPanel` (`specs/api.md` §6.20, US-006 AC-5).
 * `T-UI-028`.
 *
 * ⚠ **THE PANEL IS THE ONLY ROUTE ONTO THE LIST FOR A TITLE THE READER NEVER
 * SAW.** `T-AI-041` covers rendering the untitled artwork-only tile and
 * `T-UNM-010` covers acting on an *unmatched* candidate; neither one CREATES
 * anything, so without these cases the whole US-006 AC-5 escape hatch is
 * asserted by nobody.
 *
 * ⚠ **The two 409s are asserted separately from a generic failure.** A
 * suppressed work and a work already in the batch are refusals the owner can
 * act on; collapsing them into "couldn't add" leaves them pressing the same
 * button against a rule they cannot see.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReviewResponse } from '@nextup/domain';

import { ManualEntryPanel, resultLabel } from '../src/components/ManualEntryPanel';
import {
  MANUAL_ENTRY_ADD_FAILED,
  MANUAL_ENTRY_ALREADY_IN_BATCH,
  MANUAL_ENTRY_NO_RESULTS,
  MANUAL_ENTRY_SEARCH_FAILED,
  MANUAL_ENTRY_SUPPRESSED,
  MANUAL_ENTRY_TITLE,
} from '../src/copy';
import type { TmdbSearchResult } from '../src/lib/apiClient';
import { ReviewPage } from '../src/pages/ReviewPage';

afterEach(cleanup);

const DUNE: TmdbSearchResult = {
  tmdbId: 438631,
  mediaType: 'movie',
  name: 'Dune',
  releaseYear: 2021,
  posterPath: null,
};

/** An error shaped like `ApiClient`'s: a `code` plus a message. */
function refusal(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

async function searchFor(query: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/search tmdb/i), query);
  await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
}

describe('T-UI-028 · the manual-entry panel', () => {
  it('T-UI-028a: renders the panel and says what it is for', () => {
    render(<ManualEntryPanel onAdd={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByRole('heading', { name: MANUAL_ENTRY_TITLE })).toBeInTheDocument();
    expect(screen.getByLabelText(/search tmdb/i)).toBeInTheDocument();
  });

  it('T-UI-028b: searching shows the hits, with the year that separates remakes', async () => {
    const onSearch = vi.fn().mockResolvedValue([DUNE, { ...DUNE, tmdbId: 841, releaseYear: 1984 }]);
    render(<ManualEntryPanel onAdd={vi.fn()} onSearch={onSearch} />);

    await searchFor('dune');

    expect(onSearch).toHaveBeenCalledWith('dune');
    await waitFor(() => {
      expect(screen.getByText('Dune (2021)')).toBeInTheDocument();
    });
    expect(screen.getByText('Dune (1984)')).toBeInTheDocument();
  });

  it('T-UI-028c: adds ONLY on an explicit press, and sends the id (REQ-014, SD-05)', async () => {
    const onSearch = vi.fn().mockResolvedValue([DUNE]);
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<ManualEntryPanel onAdd={onAdd} onSearch={onSearch} />);

    await searchFor('dune');
    await waitFor(() => {
      expect(screen.getByText('Dune (2021)')).toBeInTheDocument();
    });
    // Nothing has been added merely by searching.
    expect(onAdd).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /add dune/i }));
    expect(onAdd).toHaveBeenCalledWith(DUNE);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/added dune/i);
    });
  });

  it('T-UI-028d: a suppressed work is reported as suppressed, not as a generic failure', async () => {
    const onSearch = vi.fn().mockResolvedValue([DUNE]);
    const onAdd = vi.fn().mockRejectedValue(refusal('WORK_SUPPRESSED'));
    render(<ManualEntryPanel onAdd={onAdd} onSearch={onSearch} />);

    await searchFor('dune');
    await waitFor(() => {
      expect(screen.getByText('Dune (2021)')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /add dune/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(MANUAL_ENTRY_SUPPRESSED);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('T-UI-028e: a work already in the batch says so', async () => {
    const onSearch = vi.fn().mockResolvedValue([DUNE]);
    const onAdd = vi.fn().mockRejectedValue(refusal('ALREADY_IN_BATCH'));
    render(<ManualEntryPanel onAdd={onAdd} onSearch={onSearch} />);

    await searchFor('dune');
    await waitFor(() => {
      expect(screen.getByText('Dune (2021)')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /add dune/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(MANUAL_ENTRY_ALREADY_IN_BATCH);
    });
  });

  it('T-UI-028f: any other failure says nothing has changed', async () => {
    const onSearch = vi.fn().mockResolvedValue([DUNE]);
    const onAdd = vi.fn().mockRejectedValue(new Error('boom'));
    render(<ManualEntryPanel onAdd={onAdd} onSearch={onSearch} />);

    await searchFor('dune');
    await waitFor(() => {
      expect(screen.getByText('Dune (2021)')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /add dune/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(MANUAL_ENTRY_ADD_FAILED);
    });
  });

  it('T-UI-028g: an empty result set is stated, not left blank', async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    render(<ManualEntryPanel onAdd={vi.fn()} onSearch={onSearch} />);

    await searchFor('nothing');

    await waitFor(() => {
      expect(screen.getByText(MANUAL_ENTRY_NO_RESULTS)).toBeInTheDocument();
    });
  });

  it('T-UI-028h: a failed search says so AND clears stale hits', async () => {
    // ⚠ The clearing is the load-bearing half. Results left on screen under a
    // failure message can still be added, from a search the owner is no longer
    // looking at.
    const onSearch = vi
      .fn()
      .mockResolvedValueOnce([DUNE])
      .mockRejectedValueOnce(new Error('offline'));
    render(<ManualEntryPanel onAdd={vi.fn()} onSearch={onSearch} />);

    await searchFor('dune');
    await waitFor(() => {
      expect(screen.getByText('Dune (2021)')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(MANUAL_ENTRY_SEARCH_FAILED);
    });
    expect(screen.queryByText('Dune (2021)')).not.toBeInTheDocument();
  });

  it('T-UI-028i: an empty query searches nothing', async () => {
    const onSearch = vi.fn();
    render(<ManualEntryPanel onAdd={vi.fn()} onSearch={onSearch} />);

    await userEvent.type(screen.getByLabelText(/search tmdb/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('T-UI-028j: a hit with no year renders its bare name', () => {
    expect(resultLabel({ ...DUNE, releaseYear: null })).toBe('Dune');
    expect(resultLabel(DUNE)).toBe('Dune (2021)');
  });
});

describe('T-UI-028 · the panel is MOUNTED on the review screen', () => {
  // ⚠ A component nobody renders is the TASK-076 defect in miniature: every
  // case above passes against a component the owner never sees. These two
  // assert the mount, and the negative one asserts the half-wired case — a
  // search box with no add is worse than no panel at all.
  function review() {
    return buildReviewResponse({
      batchId: '01J0000000000000000000BTCH',
      service: 'netflix',
      mode: 'append-only',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'agreed',
      candidates: [],
      disappearedListings: [],
      imagesWithNoText: [],
    });
  }

  it('T-UI-028k: ReviewPage renders the panel when both halves are wired', () => {
    render(<ReviewPage onManualEntry={vi.fn()} onSearchTmdb={vi.fn()} review={review()} />);
    expect(screen.getByRole('heading', { name: MANUAL_ENTRY_TITLE })).toBeInTheDocument();
  });

  it('T-UI-028l: and does NOT render it when only one half is wired', () => {
    render(<ReviewPage onSearchTmdb={vi.fn()} review={review()} />);
    expect(screen.queryByRole('heading', { name: MANUAL_ENTRY_TITLE })).not.toBeInTheDocument();
  });
});
