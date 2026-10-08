/**
 * #396 (US-066, PRD `A57`, ADR-0010 Rev 6) — the Auto-detect import source on
 * the web: the upload picker (AC-1, AC-2) and the review control that shows
 * each title's LOOKED-UP services and lets the owner change them (AC-3…AC-6).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOOKED_UP_LABEL,
  LOOKUP_FAILED_LABEL,
  SERVICES,
  type AutoDestination as Destination,
  type ReviewCandidate,
  type UndoRefusalDetails,
} from '@nextup/domain';

import { AutoDestination } from '../src/components/AutoDestination';
import { UndoRefusalPanel } from '../src/components/UndoRefusalPanel';
import { UploadRoute } from '../src/containers/UploadRoute';
import {
  AUTO_DESTINATION_SAVE_FAILED,
  AUTO_DETECT_FULL_UPDATE_HINT,
  UNDO_REFUSAL_BODY,
  UNDO_REFUSAL_WAITING_ROUTED_BODY,
} from '../src/copy';
import { apiClient } from '../src/lib/apiClient';

afterEach(cleanup);

async function mountUpload(path = '/upload'): Promise<void> {
  render(
    <MemoryRouter initialEntries={[path]}>
      <UploadRoute client={{ ...apiClient, listBatches: async () => ({ batches: [] }) }} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('dropzone')).toBeVisible());
}

function radioIn(testId: string): HTMLInputElement {
  return within(screen.getByTestId(testId)).getByRole('radio');
}

describe('T-AUTO-020 the upload source picker', () => {
  it('T-AUTO-020a: /upload defaults to Auto-detect, add only, and the named services stay offered', async () => {
    await mountUpload();

    expect(radioIn('service-option-auto')).toBeChecked();
    expect(screen.getByTestId('auto-detect-hint')).toBeVisible();
    // Owner decision 5: a named service is still one click away.
    for (const service of SERVICES) {
      const radio = radioIn(`service-option-${service}`);
      expect(radio).toBeVisible();
      expect(radio).not.toBeChecked();
    }
    // The mode is decided BY THE SOURCE, so that step is answered and folded:
    // its answer says "add only", and nothing about it waits on the owner.
    expect(screen.getByTestId('mode-step-panel-answer')).toBeVisible();
    expect(
      within(screen.getByTestId('mode-card-append-only')).getByRole('radio', { hidden: true }),
    ).toBeChecked();
  });

  it('T-AUTO-020b: a full update is disabled for Auto-detect, says why, and comes back with a named service', async () => {
    await mountUpload();
    fireEvent.click(screen.getByTestId('mode-step-panel-change'));

    const fullUpdate = radioIn('mode-card-full-update');
    expect(fullUpdate).toBeDisabled();
    expect(fullUpdate).not.toBeChecked();
    expect(screen.getByTestId('auto-detect-full-update-hint')).toHaveTextContent(
      AUTO_DETECT_FULL_UPDATE_HINT,
    );

    fireEvent.click(radioIn('service-option-netflix'));
    await waitFor(() => expect(radioIn('mode-card-full-update')).not.toBeDisabled());
    expect(screen.queryByTestId('auto-detect-full-update-hint')).toBeNull();
  });

  it('T-AUTO-020c: a requested service still pre-selects that service, not Auto-detect', async () => {
    await mountUpload('/upload?service=netflix');

    // The requested service is an answer, so its step is folded (hidden radios).
    const hidden = (id: string): HTMLElement =>
      within(screen.getByTestId(id)).getByRole('radio', { hidden: true });
    expect(hidden('service-option-netflix')).toBeChecked();
    expect(hidden('service-option-auto')).not.toBeChecked();
    expect(screen.queryByTestId('auto-detect-full-update-hint')).toBeNull();
  });
});

function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: 'c1',
    rawText: 'Heat',
    inferredTitle: 'Heat',
    basis: 'vision',
    ocrSupport: 'supported',
    provider: 'vision',
    verdict: 'keep',
    ocrConfidence: null,
    resolvedWorkIdentity: 'tmdb:movie:949',
    match: null,
    alternatives: [],
    sourceImageIds: [],
    tileCrop: null,
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: null,
    serviceLookup: null,
    destination: null,
    effectiveDestination: null,
    ...overrides,
  } as ReviewCandidate;
}

describe('T-AUTO-021 the review destination control', () => {
  it('T-AUTO-021a: several matches are all pre-ticked and labelled "Looked up", never captured', () => {
    render(
      <AutoDestination
        candidate={candidate({
          serviceLookup: {
            status: 'found',
            services: ['netflix', 'max'],
            checkedAt: '2026-10-08T00:00:00Z',
            stale: false,
          },
          effectiveDestination: { kind: 'services', services: ['netflix', 'max'] },
        })}
        onChange={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByTestId('auto-lookup-label')).toHaveTextContent(LOOKED_UP_LABEL);
    expect(screen.getByTestId('auto-lookup-text')).toHaveTextContent('Netflix, Max');
    expect(within(screen.getByTestId('auto-service-netflix')).getByRole('checkbox')).toBeChecked();
    expect(within(screen.getByTestId('auto-service-max')).getByRole('checkbox')).toBeChecked();
    expect(screen.getAllByTestId('auto-service-looked-up')).toHaveLength(2);
    expect(within(screen.getByTestId('auto-waiting')).getByRole('checkbox')).not.toBeChecked();
    // Only a FAILED lookup offers a retry.
    expect(screen.queryByTestId('auto-lookup-retry')).toBeNull();
    expect(screen.getByTestId('auto-destination').textContent).not.toMatch(/captured/i);
  });

  it('T-AUTO-021b: unticking one service saves the rest; the last one cannot be unticked', async () => {
    const onChange = vi.fn<(id: string, dest: Destination) => Promise<void>>(async () => {});
    const { rerender } = render(
      <AutoDestination
        candidate={candidate({
          serviceLookup: {
            status: 'found',
            services: ['netflix', 'max'],
            checkedAt: 'x',
            stale: false,
          },
          effectiveDestination: { kind: 'services', services: ['netflix', 'max'] },
        })}
        onChange={onChange}
      />,
    );

    fireEvent.click(within(screen.getByTestId('auto-service-max')).getByRole('checkbox'));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith('c1', { kind: 'services', services: ['netflix'] });

    rerender(
      <AutoDestination
        candidate={candidate({
          serviceLookup: { status: 'found', services: ['netflix'], checkedAt: 'x', stale: false },
          effectiveDestination: { kind: 'services', services: ['netflix'] },
        })}
        onChange={onChange}
      />,
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('auto-service-netflix')).getByRole('checkbox'),
      ).toBeDisabled(),
    );
  });

  it('T-AUTO-021c: no match proposes Waiting to stream; the owner can pick a service instead', async () => {
    const onChange = vi.fn<(id: string, dest: Destination) => Promise<void>>(async () => {});
    render(
      <AutoDestination
        candidate={candidate({
          serviceLookup: { status: 'none', services: [], checkedAt: 'x', stale: false },
          effectiveDestination: { kind: 'waiting' },
        })}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('auto-lookup-label')).toHaveTextContent(LOOKED_UP_LABEL);
    expect(within(screen.getByTestId('auto-waiting')).getByRole('checkbox')).toBeChecked();
    expect(screen.queryAllByTestId('auto-service-looked-up')).toHaveLength(0);

    fireEvent.click(within(screen.getByTestId('auto-service-max')).getByRole('checkbox'));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('c1', { kind: 'services', services: ['max'] }),
    );
  });

  it('T-AUTO-021d: a failed lookup says "Couldn\'t look up", offers a retry, and routes to Waiting on request', async () => {
    const onChange = vi.fn<(id: string, dest: Destination) => Promise<void>>(async () => {});
    const onRetry = vi.fn<(id: string) => Promise<void>>(async () => {});
    render(
      <AutoDestination
        candidate={candidate({
          serviceLookup: { status: 'failed', services: [], checkedAt: 'x', stale: false },
        })}
        onChange={onChange}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByTestId('auto-lookup-label')).toHaveTextContent(LOOKUP_FAILED_LABEL);
    for (const service of SERVICES) {
      expect(
        within(screen.getByTestId(`auto-service-${service}`)).getByRole('checkbox'),
      ).not.toBeChecked();
    }

    fireEvent.click(screen.getByTestId('auto-lookup-retry'));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith('c1'));

    fireEvent.click(within(screen.getByTestId('auto-waiting')).getByRole('checkbox'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('c1', { kind: 'waiting' }));
  });

  it('T-AUTO-021e: a choice that was not saved is rolled back and says so', async () => {
    const onChange = vi.fn(async () => {
      throw new Error('500');
    });
    render(
      <AutoDestination
        candidate={candidate({
          serviceLookup: { status: 'found', services: ['netflix'], checkedAt: 'x', stale: false },
          effectiveDestination: { kind: 'services', services: ['netflix'] },
        })}
        onChange={onChange}
      />,
    );

    fireEvent.click(within(screen.getByTestId('auto-waiting')).getByRole('checkbox'));
    expect(await screen.findByTestId('auto-destination-error')).toHaveTextContent(
      AUTO_DESTINATION_SAVE_FAILED,
    );
    expect(within(screen.getByTestId('auto-service-netflix')).getByRole('checkbox')).toBeChecked();
    expect(within(screen.getByTestId('auto-waiting')).getByRole('checkbox')).not.toBeChecked();
  });
});

describe('T-AUTO-022 undo of a batch that routed titles to Waiting', () => {
  it('T-AUTO-022a: the refusal explains the Waiting routing, not later edits', () => {
    const details: UndoRefusalDetails = {
      batchId: 'b1',
      reason: 'waiting-routed',
      created: [],
      modified: [],
      removed: [],
      truncated: false,
    };
    const unused = vi.fn(async () => {
      throw new Error('not used');
    });
    render(
      <MemoryRouter>
        <UndoRefusalPanel
          details={details}
          onClose={vi.fn()}
          suppress={unused}
          unsuppress={unused}
          searchTmdb={unused}
          fixMatch={unused}
          restore={unused}
        />
      </MemoryRouter>,
    );

    const panel = screen.getByTestId('undo-refusal-panel');
    expect(panel).toHaveAttribute('data-reason', 'waiting-routed');
    expect(panel).toHaveTextContent(UNDO_REFUSAL_WAITING_ROUTED_BODY);
    expect(panel.textContent).not.toContain(UNDO_REFUSAL_BODY);
  });
});
