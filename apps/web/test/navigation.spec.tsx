/**
 * TASK-211 — the navigation (REQ-116/REQ-117, `specs/ui-refresh.md` §6).
 *
 * `T-UX-117`, `T-UX-118`, `T-UX-132`, `T-UX-133`.
 *
 * ⚠ **THE OLD NAVIGATION PASSED EVERY TEST IT HAD.** `T-UI-023f` asserted the
 * eight destinations are present and `T-A11Y-004` asserted there is exactly one
 * `<nav>`; both held perfectly against a `<nav>` with no `className`, no active
 * state and no consumer for React Router's `isActive`. Presence is not the
 * requirement. These assertions are about which destination is *marked*, what
 * marks it, and what survives being collapsed behind `More`.
 *
 * ⚠ **`matchMedia` IS ABSENT IN jsdom AND THAT IS WHY IT IS STUBBED HERE, NOT
 * MOCKED AWAY.** `useWideViewport` falls back to the wide layout when the API
 * is missing — the correct failure for a progressive enhancement, and the
 * reason every pre-existing suite still sees all eight links. A phone
 * assertion that forgot the stub would therefore render the DESKTOP nav and
 * report a pass for the wrong tree, so `atPhoneWidth` asserts the stub took
 * effect rather than trusting it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { BP_SM, WIDE_VIEWPORT_QUERY } from '../src/breakpoints';
import { FreshnessStrip, uploadPathFor } from '../src/components/FreshnessStrip';
import type { ServiceFreshness } from '../src/components/FreshnessStrip';
import { NAV_MORE_LABEL } from '../src/copy';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const CSS = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8');

/** The three slots REQ-117 names, and the six destinations behind `More`. */
const BAR_LABELS = ['List', 'Upload'] as const;
const OVERFLOW_LABELS = [
  'Batches',
  'Removal history',
  'Not interested',
  'Waiting to stream',
  'About',
  'Check a rating',
] as const;

/**
 * Installs a `matchMedia` reporting `wide`.
 *
 * ⚠ BOTH LISTENER APIS ARE IMPLEMENTED. `useWideViewport` prefers
 * `addEventListener` and falls back to the deprecated `addListener` for Safari
 * below 14 — this application's primary device is an iPhone. A stub offering
 * only the modern pair would let the fallback branch rot untested.
 */
function stubMatchMedia(wide: boolean): void {
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === WIDE_VIEWPORT_QUERY ? wide : false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

function renderAt(path: string): HTMLElement {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return screen.getByRole('navigation', { name: 'Primary' });
}

function atPhoneWidth(path: string): HTMLElement {
  stubMatchMedia(false);
  const nav = renderAt(path);
  /*
   * ⚠ THE GUARD, NOT A REDUNDANT ASSERTION. If the stub failed to apply, the
   * wide navigation renders and every "reachable only via More" check below
   * would be asserting against a tree that contains all eight links — and
   * `queryByRole('link', { name: 'About' })` returning an element would fail
   * loudly, but `getAllByRole('link')` returning eight would simply be a
   * confusing count. Fail here instead, where the cause is stated.
   */
  expect(within(nav).getByRole('button', { name: NAV_MORE_LABEL })).toBeInTheDocument();
  return nav;
}

function atWideWidth(path: string): HTMLElement {
  stubMatchMedia(true);
  return renderAt(path);
}

/** The declarations of one top-level rule, or `undefined` if there is none. */
function ruleBody(selector: string): string | undefined {
  const pattern = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`);
  return pattern.exec(CSS)?.[1];
}

/* ------------------------------------------------------------------------ */
/* T-UX-117 — the active destination is marked, and not by colour alone.    */
/* ------------------------------------------------------------------------ */

describe('T-UX-117 · ui-refresh.md §6 · the current destination is indicated', () => {
  it('T-UX-117a: exactly one destination carries aria-current="page", and it is the open one', () => {
    const nav = atWideWidth('/removed');
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(current.map((link) => link.textContent)).toStrictEqual(['Removal history']);
  });

  it('T-UX-117b: the marked link also carries the active CLASS, so the cue and the semantics agree', () => {
    // ⚠ TWO MECHANISMS, ONE STATE. `aria-current` comes from React Router's
    // own matcher and the class comes from `isRouteActive`. They are only
    // equivalent while both pass the same `end`, and a divergence is silent:
    // the page looks right and the screen reader is told nothing, or the
    // reverse. Asserting them on the SAME element is what pins them together.
    const nav = atWideWidth('/not-interested');
    const [current] = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(current).toBeDefined();
    expect(current).toHaveClass('nav__link--active');
  });

  it('T-UX-117c: the active state is carried by a NON-COLOUR channel as well as a colour', () => {
    /*
     * ⚠ THE POINT OF THE REQUIREMENT, AND THE ONLY PART A DOM QUERY CANNOT
     * SEE. jsdom applies no stylesheet, so the rule is read as a file. A
     * colour-only indicator is invisible to roughly one man in twelve and to
     * anyone reading a phone in sunlight, and it looks entirely finished to
     * whoever wrote it.
     */
    for (const selector of ['.nav__link--active', '.nav__slot--active']) {
      const body = ruleBody(selector);
      expect(body, `${selector} has no rule at all`).toBeDefined();

      const declarations = (body ?? '')
        .split(';')
        .map((declaration) => declaration.split(':')[0]?.trim() ?? '')
        .filter(Boolean);
      const nonColour = declarations.filter((property) => !property.includes('color'));

      expect(nonColour.length, `${selector} distinguishes itself only by colour`).toBeGreaterThan(
        0,
      );
      expect(nonColour).toContain('font-weight');
    }
  });

  it('T-UX-117d: "List" is NOT marked current on every other route', () => {
    /*
     * ⚠ THE TWO MATCHERS DISAGREE ABOUT `/` BY DEFAULT, AND THAT IS THE BUG
     * THIS PINS. `matchPath({ path: '/', end: false })` matches every path in
     * the application; `<NavLink to="/">` additionally requires the next
     * character to be a `/`, so it is already exact. Feed `isRouteActive` the
     * wrong `end` and the CLASS says active while `aria-current` says nothing
     * — a state visible only to sighted users, on every route at once.
     *
     * Verified by mutation: replacing the `end` guard with a constant `false`
     * fails this test and nothing else.
     */
    const nav = atWideWidth('/about');
    const list = within(nav).getByRole('link', { name: 'List' });

    expect(list).not.toHaveAttribute('aria-current');
    expect(list).not.toHaveClass('nav__link--active');
  });

  it('T-UX-117e: a nested route keeps its PARENT destination marked', () => {
    // The mirror image of `T-UX-117d`: `end` is exact for `/` and prefix for
    // everything else, so opening a batch keeps "Batches" marked rather than
    // marking nothing at all.
    const nav = atWideWidth('/batches/01J0000000000000000000BTCH');

    expect(within(nav).getByRole('link', { name: 'Batches' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-118 — the freshness strip keeps its deep link.                      */
/* ------------------------------------------------------------------------ */

describe('T-UX-118 · ui-refresh.md §6 · the freshness strip still deep-links to /upload', () => {
  /*
   * ⚠ REQ-039 IS A `must` AND THE MANDATORY MITIGATION FOR RSK-007 — the list
   * silently going out of date without the owner noticing. A navigation
   * rework is exactly where a second, differently-behaved route to upload gets
   * introduced and the pre-selection quietly stops working: the chip still
   * looks tappable, still goes to `/upload`, and simply arrives with no
   * service chosen. Show the fact; never nag about it (`A46`).
   */
  const NETFLIX: ServiceFreshness = {
    service: 'netflix',
    lastCompletedBatchAt: '2026-08-10T20:19:44.007Z',
    lastCompletedBatchId: '01J8ZF',
    ageDays: 0,
    label: 'Netflix updated today',
  };
  const MAX_STALE: ServiceFreshness = {
    service: 'max',
    lastCompletedBatchAt: '2026-06-24T20:19:44.007Z',
    lastCompletedBatchId: '01J8ZG',
    ageDays: 47,
    label: 'Max updated 47 days ago',
  };

  it('T-UX-118a: every chip links to /upload with its own service pre-selected', () => {
    render(
      <MemoryRouter>
        <FreshnessStrip services={[NETFLIX, MAX_STALE]} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('freshness-chip-netflix')).toHaveAttribute(
      'href',
      uploadPathFor('netflix'),
    );
    expect(screen.getByTestId('freshness-chip-max')).toHaveAttribute('href', uploadPathFor('max'));
    expect(uploadPathFor('max')).toContain('service=max');
  });

  it('T-UX-118b: the strip keeps the affordance even when the dates are unavailable', () => {
    // The degraded strip is the case that matters: a strip that renders
    // nothing when the payload is missing looks EXACTLY like a strip
    // reporting that everything is current.
    render(
      <MemoryRouter>
        <FreshnessStrip services={null} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('freshness-chip-netflix')).toHaveAttribute(
      'href',
      uploadPathFor('netflix'),
    );
  });

  it('T-UX-118c: /upload is reachable from the phone bar itself, and there is only one of it', () => {
    // ⚠ `/upload` REACHABILITY IS LOAD-BEARING, NOT MERELY A NAV ITEM (§6).
    // It stays a first-class slot at phone width precisely so the strip's
    // deep link is never the only way in.
    const nav = atPhoneWidth('/');
    const uploads = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/upload');

    expect(uploads).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-132 — below --bp-sm the bar is exactly List, Upload, More.          */
/* ------------------------------------------------------------------------ */

describe('T-UX-132 · ui-refresh.md §6 · the phone destination bar', () => {
  it('T-UX-132a: below --bp-sm the bar renders exactly List, Upload and More', () => {
    const nav = atPhoneWidth('/');

    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toStrictEqual([...BAR_LABELS]);
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toStrictEqual([NAV_MORE_LABEL]);
  });

  it('T-UX-132b: the overflow destinations are NOT in the closed bar', () => {
    /*
     * ⚠ THE OVERFLOW IS SIX ROUTES, NOT THE THREE §6 NAMES. `/removed`,
     * `/not-interested` and `/batches` were the whole overflow when §6 was
     * written; Epic L added `/waiting` and Epic M added `/rating`. Asserting
     * only the named three would leave three routes covered by nothing, which
     * is how a destination silently ends up in neither list.
     */
    const nav = atPhoneWidth('/');
    for (const label of OVERFLOW_LABELS) {
      expect(within(nav).queryByRole('link', { name: label }), label).toBeNull();
    }
  });

  it('T-UX-132c: they become reachable when More is opened, and it is a disclosure', () => {
    const nav = atPhoneWidth('/');
    const more = within(nav).getByRole('button', { name: NAV_MORE_LABEL });
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);

    expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const label of OVERFLOW_LABELS) {
      expect(within(nav).getByRole('link', { name: label }), label).toBeInTheDocument();
    }
  });

  it('T-UX-132d: the breakpoint is ONE number, in :root, in the @media prelude and in TS', () => {
    /*
     * ⚠ A CUSTOM PROPERTY CANNOT BE USED IN A MEDIA QUERY, so `640` is
     * genuinely written three times. Three copies that can disagree produce
     * the nastiest possible symptom: at one narrow band of widths the
     * JavaScript believes it is on a phone while the stylesheet believes it is
     * not, the bar renders with desktop rules, and nothing reports an error.
     */
    const token = /--bp-sm:\s*(\d+)px/.exec(CSS)?.[1];
    expect(token).toBe(String(BP_SM));
    expect(CSS).toContain(`@media (min-width: ${String(BP_SM)}px)`);
    expect(WIDE_VIEWPORT_QUERY).toBe(`(min-width: ${String(BP_SM)}px)`);
  });

  it('T-UX-132e: at or above --bp-sm every destination is a link in its own right', () => {
    // The other half of `T-UX-132a`: `More` is a phone affordance, and a
    // desktop that kept it would be hiding six destinations behind a
    // disclosure for no reason.
    const nav = atWideWidth('/');

    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toStrictEqual([...BAR_LABELS, ...OVERFLOW_LABELS]);
    expect(within(nav).queryByRole('button', { name: NAV_MORE_LABEL })).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-133 — collapsing out of the bar never collapses out of the router.  */
/* ------------------------------------------------------------------------ */

describe('T-UX-133 · ui-refresh.md §6 · a route behind More keeps its URL and its marking', () => {
  it('T-UX-133a: a direct URL to an overflow route still renders that route', () => {
    // ⚠ THE DISCRIMINATING CASE. The obvious implementation of REQ-117 drops
    // the six overflow routes from the nav AND from the route table, because
    // "they are behind More now". The screen then 404s on a bookmark, at one
    // viewport width only.
    atPhoneWidth('/removed');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Removal history');
  });

  it('T-UX-133b: that route is marked aria-current="page" when it is open', () => {
    /*
     * ⚠ THIS IS WHY THE PANEL DEFAULTS TO OPEN WHEN THE CURRENT ROUTE IS
     * INSIDE IT. With a plain `useState(false)` the disclosure renders closed
     * on a deep link, the marked element does not exist, and the requirement
     * is not merely unmet — it is unsatisfiable without the owner tapping
     * `More` to be told where they already are.
     */
    const nav = atPhoneWidth('/not-interested');

    expect(within(nav).getByRole('button', { name: NAV_MORE_LABEL })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(nav).getByRole('link', { name: 'Not interested' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('T-UX-133c: the owner can still close the panel while standing on a route inside it', () => {
    // The auto-open must be a DEFAULT, not a lock. A disclosure whose button
    // does nothing on one route reads as broken.
    const nav = atPhoneWidth('/removed');
    const more = within(nav).getByRole('button', { name: NAV_MORE_LABEL });

    fireEvent.click(more);

    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('link', { name: 'Removal history' })).toBeNull();
  });

  it('T-UX-133d: the More control has a non-empty accessible name', () => {
    // §7c — an undecorated `<svg>` inside a button produces a control whose
    // accessible name is EMPTY. `axe-core` reports that as `button-name`, and
    // in a diff it reads as a styling change rather than as the accessibility
    // regression it is.
    const nav = atPhoneWidth('/');
    const more = within(nav).getByRole('button', { name: NAV_MORE_LABEL });

    expect(more.textContent?.trim()).toBe(NAV_MORE_LABEL);
    expect(more).toHaveAttribute('aria-controls', 'nav-more-panel');
    expect(document.getElementById('nav-more-panel')).toBeNull();

    fireEvent.click(more);
    expect(document.getElementById('nav-more-panel')).toBeInTheDocument();
  });

  it('T-UX-133e: every overflow destination keeps its own href', () => {
    // "Reachable via More" must mean a real link to a real URL — not a
    // click handler that pushes history, which breaks middle-click, copy-link
    // and the browser's own back behaviour while looking identical.
    const nav = atPhoneWidth('/');
    fireEvent.click(within(nav).getByRole('button', { name: NAV_MORE_LABEL }));

    const hrefs = OVERFLOW_LABELS.map((label) =>
      within(nav).getByRole('link', { name: label }).getAttribute('href'),
    );

    expect(hrefs).toStrictEqual([
      '/batches',
      '/removed',
      '/not-interested',
      '/waiting',
      '/about',
      '/rating',
    ]);
  });
});
