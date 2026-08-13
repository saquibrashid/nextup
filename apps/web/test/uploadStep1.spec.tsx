// `/upload` step 1 - service and mode (TASK-049, `specs/ui.md` §3.1).
//
// `T-UI-003` (`specs/testing.md` §9, US-003 AC-2): "Both mode consequence
// sentences are in the DOM without interaction."
//
// ⚠ "Without interaction" is the entire point of the test, so every case below
// that asserts a consequence sentence does so on a FRESH render with nothing
// clicked. Asserting it after selecting a mode would pass against a UI that
// reveals the sentence on selection - which is exactly the design §3.1 forbids
// ("never behind a tooltip or an info icon"). The owner has to be able to read
// what full update does BEFORE choosing it; afterwards is too late.
//
// The sentences are compared to `modeExplanation()` from `@nextup/domain` - the
// same function that builds the `modeExplanation` field of `POST /api/batches`
// (`specs/api.md` §6.11) - not to a literal re-typed here. A literal would let
// the card and the API response drift while this test stayed green.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BATCH_MODES,
  SERVICES,
  SERVICE_LABELS,
  modeExplanation,
  type BatchMode,
} from '@nextup/domain';

import { UploadPage, modeConsequence } from '../src/pages/UploadPage.js';
import { MODE_FULL_UPDATE_SERVICE_PLACEHOLDER } from '../src/copy.js';

const consequenceOf = (mode: BatchMode): HTMLElement =>
  screen.getByTestId(`mode-card-${mode}-consequence`);

describe('/upload step 1 - service and mode', () => {
  it('T-UI-003a · US-003 AC-2 · both mode consequence sentences are in the DOM without interaction', () => {
    render(<UploadPage />);

    // Enumerated from BATCH_MODES, so a third mode cannot be added without a
    // card - the failure mode being a mode whose consequence is never stated.
    expect(BATCH_MODES).toHaveLength(2);
    for (const mode of BATCH_MODES) {
      expect(consequenceOf(mode)).toBeVisible();
    }
  });

  it('T-UI-003b · US-003 AC-3 · the append-only card states that nothing will be removed, unselected', () => {
    render(<UploadPage />);

    const text = consequenceOf('append-only').textContent;
    expect(text).toBe(modeExplanation('append-only', 'netflix'));
    expect(text).toContain('Nothing will be removed');
    // The phrase that belongs exclusively to full update. If it appears here
    // the two cards have been swapped - a wiring bug that looks fine on screen.
    expect(text).not.toContain('offered for removal');
  });

  it('T-UI-003c · US-003 AC-2 · the full-update card names removal before it can be chosen', () => {
    render(<UploadPage />);

    const text = consequenceOf('full-update').textContent ?? '';
    expect(text).toContain('offered for removal');
    expect(screen.getByTestId('mode-card-full-update').querySelector('input')).not.toBeChecked();
  });

  it('T-UI-003d · specs/ui.md §3.1 · neither sentence is behind a tooltip or a disclosure', () => {
    const { container } = render(<UploadPage />);

    // §3.1: "always visible, never behind a tooltip or an info icon". A
    // <details>/<summary> or a title-attribute tooltip renders text that is in
    // the DOM but not readable, so getByText alone would not catch it.
    expect(container.querySelector('details')).toBeNull();
    for (const mode of BATCH_MODES) {
      const el = consequenceOf(mode);
      expect(el).toBeVisible();
      expect(el).not.toHaveAttribute('title');
      expect(el.closest('[hidden]')).toBeNull();
    }
  });

  it('T-UI-003e · US-003 AC-1/AC-2 · no service and no mode is selected by default', () => {
    render(<UploadPage />);

    // REQ-003: "no default that could be accepted by inaction". Enumerated so a
    // new service or mode cannot arrive pre-checked.
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    expect(screen.getAllByRole('radio')).toHaveLength(SERVICES.length + BATCH_MODES.length);
  });

  it('T-UI-003f · US-003 AC-1 · exactly one service can be chosen, from {Netflix, Max}', async () => {
    const user = userEvent.setup();
    render(<UploadPage />);

    expect(SERVICES).toStrictEqual(['netflix', 'max']);
    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.netflix }));
    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.max }));

    expect(screen.getByRole('radio', { name: SERVICE_LABELS.max })).toBeChecked();
    // Radios are one group, so choosing Max must have cleared Netflix. Two
    // independent checkboxes would leave a batch claiming both services.
    expect(screen.getByRole('radio', { name: SERVICE_LABELS.netflix })).not.toBeChecked();
  });

  it('T-UI-003g · US-003 AC-2 · the full-update sentence names the chosen service, not a defaulted one', async () => {
    const user = userEvent.setup();
    render(<UploadPage />);

    // Before choosing, the sentence must name NO real service - naming one
    // would state a consequence for Netflix while the owner is picking Max.
    expect(consequenceOf('full-update').textContent).toContain(
      MODE_FULL_UPDATE_SERVICE_PLACEHOLDER,
    );
    expect(consequenceOf('full-update').textContent).not.toContain(SERVICE_LABELS.netflix);

    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.max }));

    expect(consequenceOf('full-update').textContent).toBe(modeExplanation('full-update', 'max'));
    expect(consequenceOf('full-update').textContent).toContain(SERVICE_LABELS.max);
  });

  it('T-UI-003h · US-003 AC-2/AC-3 · the selection is reported upward for step 2', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<UploadPage onSelectionChange={onSelectionChange} />);

    await user.click(screen.getByRole('radio', { name: SERVICE_LABELS.netflix }));
    await user.click(within(screen.getByTestId('mode-card-full-update')).getByRole('radio'));

    // Step 2 may only open once BOTH are answered (ux-states.md §4.1/§4.2).
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      service: 'netflix',
      mode: 'full-update',
    });
    expect(onSelectionChange.mock.calls[0]?.[0]).toStrictEqual({
      service: 'netflix',
      mode: null,
    });
  });

  it('T-UI-003i · specs/api.md §6.11 · the card text is the API wording, not a re-typed copy', () => {
    // The guarantee behind US-003 AC-2/AC-3: what the owner agreed to and what
    // POST /api/batches records are the same string because there is one source.
    for (const mode of BATCH_MODES) {
      expect(modeConsequence(mode, 'max')).toBe(modeExplanation(mode, 'max'));
    }
  });

  it('T-UI-003j · specs/ui.md §10.2 · the consequence is part of each radio accessible name', () => {
    render(<UploadPage />);

    // A sighted owner reads the sentence beside the control; a screen-reader
    // owner only hears the accessible name. Nesting the consequence inside the
    // <label> is what makes the two get the same warning. If the sentence were
    // moved outside the label it would still LOOK correct and still pass
    // T-UI-003a, while announcing a bare "Full update" - the exact
    // meaningless-label failure §3.1 exists to prevent.
    const fullUpdate = within(screen.getByTestId('mode-card-full-update')).getByRole('radio');
    expect(fullUpdate).toHaveAccessibleName(expect.stringContaining('offered for removal'));
  });
});
