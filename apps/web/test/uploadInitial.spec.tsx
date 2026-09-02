/**
 * `T-UX-040` — `/upload` §4.1 "Initial": service and mode unselected.
 *
 * ⚠ THIS ROW USED TO SPECIFY THE OPPOSITE, and the contradiction sat one line
 * below the row that contradicts it. §4.1 said the attach area was *disabled*
 * with the reason "Choose a service and a mode first."; §4.0a, added at A45,
 * says a paste arriving before selection is **held client-side, not
 * discarded**. A disabled attach area cannot hold anything. The code has
 * always implemented §4.0a — `ImageDropzone` contains no `disabled` at all —
 * so the spec was wrong, and it was corrected in place.
 *
 * That makes this test's job unusual and worth stating plainly: it exists to
 * stop the *spec's* old wording being "restored" by someone who reads §4.1,
 * sees an enabled attach area, and files it as a bug. The cost of getting it
 * wrong is not cosmetic — disabling the attach area discards the owner's
 * screenshot for the single most ordinary sequence in the product, pasting
 * before picking a service, and the screenshot is often no longer on the
 * clipboard to paste again.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { SUBMIT_NEEDS_SELECTION } from '../src/copy';
import { UploadRoute } from '../src/containers/UploadRoute';

afterEach(cleanup);

function mountInitial(): void {
  render(
    <MemoryRouter initialEntries={['/upload']}>
      <UploadRoute />
    </MemoryRouter>,
  );
}

describe('T-UX-040 /upload initial state', () => {
  it('T-UX-040a: the attach area is enabled before a service and mode are chosen', () => {
    mountInitial();

    const chooser = screen.getByTestId('file-input');
    expect(chooser).not.toBeDisabled();
  });

  it('T-UX-040b: no attach control is disabled and no fieldset is disabled', () => {
    // Broader than 040a on purpose. The old wording would most naturally be
    // re-implemented by disabling the surrounding fieldset or the drop target
    // rather than the file input itself, and 040a alone would not notice.
    mountInitial();

    const dropzone = screen.getByTestId('dropzone');
    const disabled = dropzone.querySelectorAll(
      '[disabled], [aria-disabled="true"], fieldset[disabled]',
    );

    expect(
      [...disabled].map((el) => el.outerHTML.slice(0, 120)),
      'the attach area must stay enabled so a pre-selection paste can be held (§4.0a)',
    ).toEqual([]);
  });

  it('T-UX-040c: the reason is visible, and it sits on submit', () => {
    // §3.3 forbids a silently disabled control. The sentence itself survived
    // the correction unchanged — only what it explains moved from attach to
    // submit — so asserting the sentence alone would pass under BOTH the old
    // and the new wording. Its location is the whole point.
    mountInitial();

    const reason = screen.getByTestId('submit-reason');
    expect(reason).toHaveTextContent(SUBMIT_NEEDS_SELECTION);
    expect(screen.getByTestId('submit-step')).toContainElement(reason);
    expect(screen.getByTestId('dropzone')).not.toContainElement(reason);
  });

  it('T-UX-040d: submit is the control that is blocked', () => {
    mountInitial();

    expect(screen.getByTestId('submit-button')).toBeDisabled();
  });
});
