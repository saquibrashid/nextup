/**
 * TASK-026 - TMDB attribution (`specs/ui.md` §8, US-011).
 *
 * ⚠ Why this suite is unusually literal: §8 says the failure of this feature is
 * **invisible from inside the product**. nextup works perfectly with the
 * attribution missing, wrong, or hidden behind a link - the only thing that
 * notices is TMDB's licence. So these tests assert the sentence CHARACTER BY
 * CHARACTER, and assert it is visible TEXT rather than merely present in the
 * DOM somewhere.
 *
 * `T-ATTR-001` is specified (`specs/testing.md` §9, US-011 AC-2) as "constant,
 * API value and rendered DOM text are byte-equal". Two of those three legs are
 * asserted here. The third - the `/api/me` `attribution.tmdbDisclaimer` value
 * and `packages/domain/src/attribution.ts` - does not exist yet (TASK-024), and
 * both files are outside this lane's write boundary. `T-ATTR-001c` is the seam:
 * it asserts the component renders an API-supplied value verbatim, so when
 * TASK-024 lands, wiring it up cannot change what is displayed.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  attributionPayload,
  TMDB_DISCLAIMER as DOMAIN_TMDB_DISCLAIMER,
  TMDB_LOGO_PATH as DOMAIN_TMDB_LOGO_PATH,
} from '@nextup/domain';
import { App } from '../src/App';
import {
  ABOUT_NO_ANALYTICS,
  ABOUT_REMOVED_KEPT_FOREVER,
  ABOUT_TMDB_USE,
  IMAGE_RETENTION_STATEMENT,
  TMDB_DISCLAIMER,
} from '../src/copy';
import { TMDB_LOGO_ALT, TMDB_LOGO_PATH, TmdbAttribution } from '../src/components/TmdbAttribution';
import { ROUTES } from '../src/routes';

/**
 * The required wording, written out ONCE here and nowhere else in the suite.
 *
 * This is the only place in the repository the sentence is legitimately
 * duplicated: a test that compared the constant to itself would pass whatever
 * the constant said, which is precisely the silent failure §8 describes.
 */
const REQUIRED_WORDING = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('TMDB attribution', () => {
  it('T-ATTR-001a · US-011 AC-2 · the copy constant is byte-equal to the required wording', () => {
    expect(TMDB_DISCLAIMER).toBe(REQUIRED_WORDING);
    // Byte equality, not "contains" and not a normalised comparison: a trailing
    // space or a curly apostrophe would satisfy a looser check and still be a
    // modification of licensed wording.
    expect([...TMDB_DISCLAIMER].map((c) => c.codePointAt(0))).toStrictEqual(
      [...REQUIRED_WORDING].map((c) => c.codePointAt(0)),
    );
  });

  it('T-ATTR-001b · US-011 AC-2 · the rendered DOM text is byte-equal to the constant', () => {
    render(<TmdbAttribution />);

    const rendered = screen.getByText(REQUIRED_WORDING);
    // `textContent`, not `toHaveTextContent`: the matcher normalises whitespace,
    // which is exactly the class of difference this test exists to catch.
    expect(rendered.textContent).toBe(TMDB_DISCLAIMER);
  });

  it('T-ATTR-001c · specs/api.md §6.1 · the API payload, the constant and the DOM are one source', () => {
    // The third leg of the chain §8 requires. `attributionPayload()` is what
    // `GET /api/me` serves, so this proves the sentence the API advertises and
    // the sentence the SPA paints are the same bytes - not merely two literals
    // that happen to agree today.
    const payload = attributionPayload();
    expect(payload.tmdbDisclaimer).toBe(REQUIRED_WORDING);
    expect(payload.tmdbDisclaimer).toBe(TMDB_DISCLAIMER);
    expect(payload.tmdbLogoPath).toBe(TMDB_LOGO_PATH);

    // The re-exports must still RESOLVE to the domain. Someone reintroducing a
    // local literal here would keep every other assertion green - the strings
    // would agree on the day it was written - and reopen the divergence this
    // whole chain exists to close.
    expect(TMDB_DISCLAIMER).toBe(DOMAIN_TMDB_DISCLAIMER);
    expect(TMDB_LOGO_PATH).toBe(DOMAIN_TMDB_LOGO_PATH);

    render(<TmdbAttribution />);
    expect(screen.getByText(REQUIRED_WORDING).textContent).toBe(payload.tmdbDisclaimer);
    expect(screen.getByRole('img', { name: TMDB_LOGO_ALT })).toHaveAttribute(
      'src',
      payload.tmdbLogoPath,
    );
  });

  it('T-ATTR-001d · specs/api.md §6.1 · an API-supplied disclaimer renders verbatim, unmodified', () => {
    // The seam for TASK-024. If the component ever templated, trimmed, title-cased
    // or otherwise "tidied" the string, the constant/API/DOM chain would break at
    // the point the real API value differs from the local constant - which is the
    // only point at which anyone would ever find out.
    const fromApi = 'A different sentence entirely, supplied by GET /api/me.';
    render(<TmdbAttribution disclaimer={fromApi} logoPath="/assets/from-api.svg" />);

    expect(screen.getByText(fromApi).textContent).toBe(fromApi);
    expect(screen.getByRole('img', { name: TMDB_LOGO_ALT })).toHaveAttribute(
      'src',
      '/assets/from-api.svg',
    );
  });

  it('T-ATTR-001e · US-011 AC-2 · the disclaimer is VISIBLE TEXT, not a title or an aria-label', () => {
    render(<TmdbAttribution />);

    const rendered = screen.getByText(REQUIRED_WORDING);
    expect(rendered).toBeVisible();

    // §8 forbids the three cheap ways of "having" the sentence without showing
    // it. Assert none of them is how it got into the document.
    const carriers = Array.from(document.querySelectorAll('*')).filter(
      (el) =>
        el.getAttribute('title') === REQUIRED_WORDING ||
        el.getAttribute('aria-label') === REQUIRED_WORDING ||
        el.getAttribute('alt') === REQUIRED_WORDING,
    );
    expect(carriers).toHaveLength(0);
  });

  it('T-ATTR-001f · specs/ui.md §8 · the logo renders with alt="TMDB" at the specified path', () => {
    render(<TmdbAttribution />);

    const logo = screen.getByRole('img', { name: TMDB_LOGO_ALT });
    expect(logo).toHaveAttribute('src', TMDB_LOGO_PATH);
    // specs/ui.md §10.2: posters are decorative (alt=""), the TMDB logo is not.
    expect(logo).toHaveAttribute('alt', 'TMDB');
  });

  it('T-ATTR-001g · US-011 AC-3/AC-5 · the disclaimer is in the footer of every one of the nine routes', () => {
    // The nine routes are enumerated from ROUTES rather than listed here, so a
    // tenth screen is covered the day it is added. T-ATTR-002/003 assert the
    // same property in a real browser; this is the fast-suite tripwire that
    // fails at the moment a page breaks out of AppShell.
    for (const route of ROUTES) {
      const view = renderAt(route.examplePath);

      const footer = screen.getByTestId('app-footer');
      const rendered = screen.getByText(REQUIRED_WORDING);

      expect(footer).toContainElement(rendered);
      expect(rendered.textContent).toBe(TMDB_DISCLAIMER);
      expect(screen.getByRole('img', { name: TMDB_LOGO_ALT })).toBeInTheDocument();

      view.unmount();
    }
  });

  it('T-ATTR-001h · US-011 AC-3 · the disclaimer needs no interaction and is not behind /about', () => {
    // §8: never behind an expander, a tooltip, a modal or an "about" link. The
    // failure this catches is a well-meaning refactor that moves the sentence
    // onto /about "where it belongs" and leaves the other eight screens bare.
    renderAt('/');

    expect(screen.getByText(REQUIRED_WORDING)).toBeVisible();
    expect(document.querySelector('details')).toBeNull();
    expect(document.querySelector('[hidden]')).toBeNull();
  });
});

/**
 * `/about` (`specs/ui.md` §8) - what TMDB is used for, the 30-day screenshot
 * retention, that removed titles are kept forever, and that no analytics are
 * collected.
 *
 * `T-UI-022` is now DEFINED in `specs/testing.md` §12.2 (added by the
 * phantom-id reconciliation) as exactly this: "`/about` renders
 * `IMAGE_RETENTION_STATEMENT` and the never-delete and no-analytics copy
 * **byte-equal to the named constants**".
 *
 * ⚠ Byte-equality, not `toHaveTextContent` and not "contains", because - in
 * the spec's own words - "a reworded retention promise is a different
 * promise". `getByText` normalises whitespace before matching, so it can find
 * an element whose text is NOT byte-equal to the constant; every case below
 * therefore re-asserts `textContent` against the constant afterwards.
 *
 * `docs/backlog.md` TASK-120 (M7) also cites `T-UI-022`. When it lands it
 * should adopt these cases rather than duplicate them.
 */
describe('/about', () => {
  /** `getByText` normalises; `textContent` does not. Assert both. */
  function expectByteEqualCopy(constant: string): void {
    const el = screen.getByText(constant);
    expect(el).toBeVisible();
    expect(el.textContent).toBe(constant);
  }

  it('T-UI-022a · specs/ui.md §8 · /about states what TMDB is used for', () => {
    renderAt('/about');
    expectByteEqualCopy(ABOUT_TMDB_USE);
  });

  it('T-UI-022b · US-035 AC-6 · /about renders IMAGE_RETENTION_STATEMENT byte-equal', () => {
    renderAt('/about');
    // NFR-019's IMAGE_RETENTION_DAYS = 30, and NOT the 183-day TMDB metadata
    // refresh age (NFR-014) - invariant 8 keeps the two apart.
    expectByteEqualCopy(IMAGE_RETENTION_STATEMENT);
    expect(IMAGE_RETENTION_STATEMENT).toContain('30 days');
    expect(IMAGE_RETENTION_STATEMENT).not.toContain('183');
  });

  it('T-UI-022c · US-023 AC-2 · /about states that removed titles are kept forever', () => {
    // REQ-028: soft delete forever, no TTL, nothing scheduled. This sentence is
    // the owner-facing half of that promise.
    renderAt('/about');
    expectByteEqualCopy(ABOUT_REMOVED_KEPT_FOREVER);
  });

  it('T-UI-022d · NFR-005 · /about states that no analytics are collected', () => {
    renderAt('/about');
    expectByteEqualCopy(ABOUT_NO_ANALYTICS);
  });

  it('T-UI-022e · US-011 AC-3 · /about does NOT become the home of the disclaimer', () => {
    // §8: the sentence is never behind an "about" link. It must appear here
    // exactly once - from the global footer - and not a second time as page
    // content, which would make it look safe to remove from the footer.
    renderAt('/about');
    expect(screen.getAllByText(REQUIRED_WORDING)).toHaveLength(1);
    expect(screen.getByTestId('app-footer')).toContainElement(screen.getByText(REQUIRED_WORDING));
  });
});
