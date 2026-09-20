/**
 * `T-UX-148` — the `/upload` progressive-reveal wizard (issue #287,
 * `specs/ui.md` §3.0).
 *
 * ⚠ These tests exist because the wizard's failure modes are all INVISIBLE in
 * a screenshot: a step that is dimmed but gone from the accessibility tree, a
 * collapsed answer with no way back to it, and a full-update agreement that
 * silently survives being re-pointed at another service. Each is a defect the
 * owner could not see until it had already proposed removals from the wrong
 * list.
 */

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { BATCH_MODES, SERVICE_LABELS } from '@nextup/domain';

import { UploadPage } from '../src/pages/UploadPage';
import { UploadRoute } from '../src/containers/UploadRoute';
import { apiClient } from '../src/lib/apiClient';
import { IMAGES_STEP_WAITING_HINT, MODE_STEP_LOCKED_HINT, STEP_CHANGE_LABEL } from '../src/copy';

function modeRadio(mode: string): HTMLElement {
  return within(screen.getByTestId(`mode-card-${mode}`)).getByRole('radio');
}

describe('T-UX-148 — /upload progressive reveal', () => {
  it('T-UX-148a: an unanswerable step stays in the accessibility tree, disabled and explained', () => {
    render(<UploadPage />);

    expect(screen.getByTestId('mode-step-panel')).toHaveAttribute('data-state', 'locked');
    const hint = screen.getByTestId('mode-step-panel-hint');
    expect(hint).toHaveTextContent(MODE_STEP_LOCKED_HINT);

    /*
     * ⚠ The radios are QUERIED, not skipped. `hidden`, `display: none` or an
     * unmounted branch would make this pass by deleting the question — and a
     * screen-reader owner would never learn step 2 exists or why it cannot be
     * answered yet.
     */
    for (const mode of BATCH_MODES) {
      const radio = modeRadio(mode);
      expect(radio).toBeDisabled();
      expect(radio).toHaveAttribute('aria-describedby', hint.id);
    }
  });

  it('T-UX-148b: answering collapses the step to its answer, and Change brings it back', async () => {
    const user = userEvent.setup();
    render(<UploadPage />);

    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.netflix }));

    const panel = screen.getByTestId('service-step-panel');
    expect(panel).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('service-step-panel-answer')).toHaveTextContent(
      SERVICE_LABELS.netflix,
    );
    // Collapsed, therefore out of reach — which is only acceptable because the
    // answer and a labelled way back are both on screen.
    expect(screen.queryByRole('radio', { name: SERVICE_LABELS.max })).toBeNull();

    const change = screen.getByTestId('service-step-panel-change');
    expect(change).toHaveTextContent(STEP_CHANGE_LABEL);
    await user.click(change);
    expect(screen.getByRole('radio', { name: SERVICE_LABELS.netflix })).toBeChecked();
  });

  it('T-UX-148c: answering step 1 unlocks step 2 without answering it', async () => {
    const user = userEvent.setup();
    render(<UploadPage />);

    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.netflix }));

    expect(screen.getByTestId('mode-step-panel')).toHaveAttribute('data-state', 'active');
    expect(screen.queryByTestId('mode-step-panel-hint')).toBeNull();
    // REQ-002/REQ-003: revealing a step must never pre-answer it.
    expect(
      within(screen.getByTestId('mode-step')).queryAllByRole('radio', { checked: true }),
    ).toHaveLength(0);
    for (const mode of BATCH_MODES) {
      expect(modeRadio(mode)).toBeEnabled();
    }
  });

  it('T-UX-148d: changing the service clears an agreed full update instead of re-pointing it', async () => {
    const user = userEvent.setup();
    const seen: unknown[] = [];
    render(
      <UploadPage
        onSelectionChange={(selection) => {
          seen.push(selection);
        }}
      />,
    );

    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.netflix }));
    await user.click(modeRadio('full-update'));
    expect(screen.getByTestId('mode-step-panel-answer')).toHaveTextContent(SERVICE_LABELS.netflix);

    await user.click(screen.getByTestId('service-step-panel-change'));
    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.max }));

    /*
     * ⚠ The whole point. The owner agreed that titles missing from the
     * screenshots would be offered for removal FROM NETFLIX. Carrying that to
     * Max would aim a destructive choice at a list they never agreed to touch,
     * while the collapsed summary still read "Full update".
     */
    expect(seen.at(-1)).toEqual({ service: 'max', mode: null });
    expect(screen.getByTestId('mode-step-panel')).toHaveAttribute('data-state', 'active');
    expect(
      within(screen.getByTestId('mode-step')).queryAllByRole('radio', { checked: true }),
    ).toHaveLength(0);
  });

  it('T-UX-148e: re-choosing the same service keeps the mode, so backing out of Change costs nothing', async () => {
    const user = userEvent.setup();
    render(<UploadPage />);

    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.netflix }));
    await user.click(modeRadio('append-only'));
    await user.click(screen.getByTestId('service-step-panel-change'));
    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.netflix }));

    expect(screen.getByTestId('mode-step-panel')).toHaveAttribute('data-state', 'done');
    // The append-only answer survived the reopen intact — the consequence
    // sentence is service-independent, so its wording is the assertion.
    expect(screen.getByTestId('mode-step-panel-answer')).toHaveTextContent(
      screen.getByTestId('mode-card-append-only-consequence').textContent ?? '',
    );
  });

  it('T-UX-148f: step 3 is never locked, because it holds images pasted before the questions are answered', async () => {
    render(
      <MemoryRouter initialEntries={['/upload']}>
        <UploadRoute client={{ ...apiClient, listBatches: async () => ({ batches: [] }) }} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('dropzone')).toBeVisible());

    /*
     * ⚠ A DOCUMENTED DEVIATION from the progressive reveal, and it must stay
     * one. `ImageDropzone`/`PasteButton` deliberately HOLD what arrives before
     * the two questions are answered (`ux-states.md` §4.3), and the owner's
     * primary path is pasting the moment they have a screenshot. Dimming or
     * disabling this step would advertise the opposite of what it does and
     * would lose exactly that paste.
     */
    expect(screen.getByTestId('images-step-panel')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('images-step-panel-hint')).toHaveTextContent(
      IMAGES_STEP_WAITING_HINT,
    );
    expect(screen.getByTestId('file-input')).toBeEnabled();
  });
});
