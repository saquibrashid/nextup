/**
 * TASK-211, revised by TASK-250 (issue 369) — the navigation (REQ-116/REQ-117,
 * `specs/ui-refresh.md` §6).
 *
 * `T-UX-117`, `T-UX-118`, `T-UX-132`, `T-UX-133`, `T-UX-137`.
 *
 * ⚠ **THE `More` OVERFLOW AND THE BOTTOM-FIXED PHONE BAR ARE GONE (issue
 * 369).** The owner chose a hybrid: from `--bp-sm` up the header shows
 * Library, Import and Review plus a Menu button; below it the Menu button
 * alone. Either way the Menu opens a modal drawer listing every destination.
 * The IDs are kept and redefined in place, so each still guards the property
 * it always did — the current destination is marked, every route keeps its
 * URL, nothing is reachable only through a second disclosure.
 *
 * ⚠ **`matchMedia` IS ABSENT IN jsdom AND THAT IS WHY IT IS STUBBED HERE, NOT
 * MOCKED AWAY.** `useWideViewport` falls back to the wide layout when the API
 * is missing. A phone assertion that forgot the stub would render the DESKTOP
 * header and report a pass for the wrong tree, so `atPhoneWidth` asserts the
 * stub took effect rather than trusting it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { BP_LG, BP_SM, SIDEBAR_VIEWPORT_QUERY, WIDE_VIEWPORT_QUERY } from '../src/breakpoints';
import { FreshnessStrip, uploadPathFor } from '../src/components/FreshnessStrip';
import type { ServiceFreshness } from '../src/components/FreshnessStrip';
import { NAV_MENU_CLOSE_LABEL, NAV_MENU_LABEL, NAV_MENU_TITLE } from '../src/copy';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const CSS = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8');

/** Issue 369 — the three destinations the wide header shows inline. */
const BAR_LABELS = ['Library', 'Import', 'Review'] as const;
/** Every destination, in the drawer's order (the route table's). */
const ALL_LABELS = [
  ...BAR_LABELS,
  'Removal history',
  'Not interested',
  'Waiting to stream',
  'About',
  'Rating lookup',
] as const;
const ALL_HREFS = [
  '/',
  '/upload',
  '/batches',
  '/removed',
  '/not-interested',
  '/waiting',
  '/about',
  '/rating',
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
  // ⚠ THE GUARD: at phone width the header holds NO links. If the stub failed
  // to apply, the wide header renders three and this says so here.
  expect(within(nav).queryAllByRole('link')).toHaveLength(0);
  return nav;
}

function atWideWidth(path: string): HTMLElement {
  stubMatchMedia(true);
  return renderAt(path);
}

function menuButton(nav: HTMLElement): HTMLElement {
  return within(nav).getByRole('button', { name: NAV_MENU_LABEL });
}

/** Opens the Menu drawer and returns it. */
function openDrawer(nav: HTMLElement): HTMLElement {
  fireEvent.click(menuButton(nav));
  return screen.getByRole('dialog', { name: NAV_MENU_TITLE });
}

function labels(scope: HTMLElement): (string | null)[] {
  return within(scope)
    .getAllByRole('link')
    .map((link) => link.textContent);
}

function currentLinks(scope: HTMLElement): HTMLElement[] {
  return within(scope)
    .queryAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page');
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
    // Removal history is not in the bar, so the bar marks nothing …
    expect(currentLinks(nav)).toHaveLength(0);
    // … and the drawer marks exactly it.
    const drawer = openDrawer(nav);
    expect(currentLinks(drawer).map((link) => link.textContent)).toStrictEqual(['Removal history']);
  });

  it('T-UX-117b: the marked link also carries the active CLASS, so the cue and the semantics agree', () => {
    // ⚠ TWO MECHANISMS, ONE STATE. `aria-current` comes from React Router's
    // own matcher and the class from `isRouteActive`; asserting them on the
    // SAME element is what pins them together.
    const drawer = openDrawer(atWideWidth('/not-interested'));
    const [current] = currentLinks(drawer);

    expect(current).toBeDefined();
    expect(current).toHaveClass('nav__link--active');
    expect(
      within(drawer)
        .getAllByRole('link')
        .filter((link) => link.classList.contains('nav__link--active')),
    ).toStrictEqual([current]);
  });

  it('T-UX-117c: the active state is carried by a NON-COLOUR channel as well as a colour', () => {
    // jsdom applies no stylesheet, so the rule is read as a file.
    const body = ruleBody('.nav__link--active');
    expect(body, '.nav__link--active has no rule at all').toBeDefined();

    const declarations = (body ?? '')
      .split(';')
      .map((declaration) => declaration.split(':')[0]?.trim() ?? '')
      .filter(Boolean);
    const nonColour = declarations.filter((property) => !property.includes('color'));

    expect(nonColour.length, 'the active link distinguishes itself only by colour').toBeGreaterThan(
      0,
    );
    expect(nonColour).toContain('font-weight');
  });

  it('T-UX-117d: "Library" is NOT marked current on every other route', () => {
    /*
     * ⚠ `matchPath({ path: '/', end: false })` matches every path in the
     * application; `<NavLink to="/">` is already exact. Feed `isRouteActive`
     * the wrong `end` and the CLASS says active while `aria-current` says
     * nothing. Both the bar link and the drawer link are checked.
     */
    const nav = atWideWidth('/about');
    const bar = within(nav).getByRole('link', { name: 'Library' });
    expect(bar).not.toHaveAttribute('aria-current');
    expect(bar).not.toHaveClass('nav__link--active');

    const drawer = within(openDrawer(nav)).getByRole('link', { name: 'Library' });
    expect(drawer).not.toHaveAttribute('aria-current');
    expect(drawer).not.toHaveClass('nav__link--active');
  });

  it('T-UX-117e: a nested route keeps its PARENT destination marked', () => {
    // `end` is exact for `/` and prefix for everything else, so opening an
    // import keeps "Review" marked rather than marking nothing at all.
    const nav = atWideWidth('/batches/01J0000000000000000000BTCH');

    expect(within(nav).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(openDrawer(nav)).getByRole('link', { name: 'Review' })).toHaveAttribute(
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
    fireEvent.click(screen.getByRole('button', { name: 'Service updates' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Service updates' }));

    expect(screen.getByTestId('freshness-chip-netflix')).toHaveAttribute(
      'href',
      uploadPathFor('netflix'),
    );
  });

  it('T-UX-118c: /upload is reachable from the phone Menu, and there is only one of it', () => {
    // ⚠ `/upload` REACHABILITY IS LOAD-BEARING (§6), so the strip's deep link
    // is never the only way in. Issue 369 moved it from a phone bar slot into
    // the drawer, one tap behind the Menu button.
    const drawer = openDrawer(atPhoneWidth('/'));
    const uploads = within(drawer)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/upload');

    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toHaveTextContent('Import');
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-132 — the header at each width (issue 369's hybrid).                */
/* ------------------------------------------------------------------------ */

describe('T-UX-132 · ui-refresh.md §6 · the header navigation at each width', () => {
  it('T-UX-132a: below --bp-sm the header renders exactly the Menu button', () => {
    const nav = atPhoneWidth('/');

    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toStrictEqual([NAV_MENU_LABEL]);
  });

  it('T-UX-132b: no destination is rendered while the phone Menu is closed', () => {
    const nav = atPhoneWidth('/');
    for (const label of ALL_LABELS) {
      expect(screen.queryByRole('link', { name: label, exact: true }), label).toBeNull();
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(menuButton(nav)).toHaveAttribute('aria-expanded', 'false');
  });

  it('T-UX-132c: the Menu opens a drawer listing EVERY destination, and says so', () => {
    const nav = atPhoneWidth('/');
    const button = menuButton(nav);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');

    const drawer = openDrawer(nav);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    // ⚠ NOTHING NESTED: every destination is a direct row of the drawer.
    expect(labels(drawer)).toStrictEqual([...ALL_LABELS]);
    expect(within(drawer).queryByRole('button', { name: /more/i })).toBeNull();
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

  it('T-UX-132e: at or above --bp-sm the bar shows Library, Import and Review beside the Menu', () => {
    const nav = atWideWidth('/');
    expect(labels(nav)).toStrictEqual([...BAR_LABELS]);
    expect(menuButton(nav)).toHaveAttribute('aria-expanded', 'false');

    const drawer = openDrawer(nav);
    expect(labels(drawer)).toStrictEqual([...ALL_LABELS]);
    expect(menuButton(nav)).toHaveAttribute('aria-expanded', 'true');
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-133 — living in the drawer never takes a route out of the router.   */
/* ------------------------------------------------------------------------ */

describe('T-UX-133 · ui-refresh.md §6 · a drawer destination keeps its URL and its marking', () => {
  it('T-UX-133a: a direct URL to a drawer-only route still renders that route', () => {
    atPhoneWidth('/removed');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Removal history');
  });

  it('T-UX-133b: that route is marked aria-current="page" in the drawer, which opens closed', () => {
    // A deep link lands on the page, not on an open modal over it.
    const nav = atPhoneWidth('/not-interested');
    expect(screen.queryByRole('dialog')).toBeNull();

    const drawer = openDrawer(nav);
    expect(within(drawer).getByRole('link', { name: 'Not interested' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('T-UX-133c: Escape and the close button both close the drawer and return focus to Menu', () => {
    const nav = atPhoneWidth('/removed');
    const button = menuButton(nav);

    openDrawer(nav);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();

    const drawer = openDrawer(nav);
    fireEvent.click(within(drawer).getByRole('button', { name: NAV_MENU_CLOSE_LABEL }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('T-UX-133d: the Menu control has a visible, non-empty accessible name and controls the drawer', () => {
    // §7c — an undecorated `<svg>` inside a button produces an EMPTY name.
    const nav = atPhoneWidth('/');
    const button = menuButton(nav);

    expect(button.textContent?.trim()).toBe(NAV_MENU_LABEL);
    expect(button).toHaveAttribute('aria-controls', 'nav-drawer');
    expect(document.getElementById('nav-drawer')).toBeNull();

    fireEvent.click(button);
    expect(document.getElementById('nav-drawer')).toBe(screen.getByRole('dialog'));
  });

  it('T-UX-133e: every drawer destination keeps its own href', () => {
    // A real link to a real URL — not a click handler that pushes history,
    // which breaks middle-click, copy-link and Back while looking identical.
    const drawer = openDrawer(atPhoneWidth('/'));

    expect(
      within(drawer)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toStrictEqual([...ALL_HREFS]);
  });

  it('T-UX-133f: following a drawer link navigates AND closes the drawer; a child route keeps its parent marked', () => {
    const nav = atPhoneWidth('/');
    fireEvent.click(within(openDrawer(nav)).getByRole('link', { name: 'Removal history' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Removal history');
    cleanup();

    const child = atPhoneWidth('/batches/batch-1/review');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(openDrawer(child)).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-137 - the header nav is in flow; the drawer scrolls on small screens. */
/* ------------------------------------------------------------------------ */

/**
 * WHY EVERY CSS CASE HERE READS A FILE RATHER THAN THE DOM: jsdom performs no
 * layout and applies no stylesheet, so `getComputedStyle` returns initial
 * values whatever `index.css` says. Layout is measured by the e2e suite
 * (`T-NAV-002`).
 */
/**
 * Declarations only — comments removed.
 *
 * ⚠ A RULE BODY INCLUDES ITS COMMENTS, AND THAT MAKES NEGATIVE ASSERTIONS
 * LIE. `T-UX-137d` asserts the panel does NOT carry `top: 100%`, and the
 * comment above the rule explains the desktop behaviour by naming
 * `top: 100%` — so the case failed against correct CSS. Left unstripped, the
 * alternative is a rule nobody may explain in prose.
 */
function declarations(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The existing `ruleBody` returns `string | undefined`; every case below needs
 * a definite string, and an `undefined` flowing into `toMatch` reports a type
 * error rather than the missing rule that actually caused it.
 */
function baseRuleBody(selector: string): string {
  const body = ruleBody(selector);
  expect(body, `no top-level rule for ${selector}`).toBeDefined();
  return declarations(body ?? '');
}

/** The body of `selector` as it appears INSIDE the `--bp-sm` media query. */
function wideRuleBody(selector: string): string {
  const query = CSS.indexOf(`@media (min-width: ${String(BP_SM)}px)`);
  expect(query, 'no --bp-sm media query').toBeGreaterThan(-1);
  const at = CSS.indexOf(`\n  ${selector} {`, query);
  expect(at, `${selector} is not reset above --bp-sm`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  return declarations(CSS.slice(open + 1, close));
}

function allRuleBodies(selector: string): string[] {
  const bodies: string[] = [];
  const pattern = new RegExp(`(^|\\n)\\s*\\${selector}\\s*\\{([^}]*)\\}`, 'g');
  for (const match of CSS.matchAll(pattern)) bodies.push(declarations(match[2] ?? ''));
  return bodies;
}

describe('T-UX-137 - ui-refresh.md 6 - the header nav is in flow and the drawer scrolls', () => {
  it('T-UX-137a: the nav is no longer fixed to the bottom of the viewport', () => {
    const nav = baseRuleBody('.nav');

    expect(nav).not.toMatch(/position:\s*fixed/);
    expect(nav).not.toMatch(/\bbottom:/);
  });

  it('T-UX-137b: the bottom-bar clearance token is gone, and nothing still consumes it', () => {
    // A surviving consumer of a deleted custom property resolves to nothing —
    // `calc()` with an invalid term drops the whole declaration, silently.
    expect(declarations(CSS)).not.toMatch(/--nav-bar-height/);
  });

  it('T-UX-137c: the safe-area inset is honoured by the shell and by the drawer', () => {
    expect(baseRuleBody('.app-shell')).toContain('env(safe-area-inset-bottom)');
    expect(baseRuleBody('.dialog--drawer')).toContain('env(safe-area-inset-bottom)');
  });

  it('T-UX-137d: the drawer scrolls inside the viewport, pinned to the inline-start edge', () => {
    // Eight destinations exceed a landscape phone's height: without its own
    // scroll the last rows are unreachable behind a scroll-locked page.
    const drawer = baseRuleBody('.dialog--drawer');

    expect(drawer).toMatch(/overflow-y:\s*auto/);
    expect(drawer).toMatch(/max-block-size:\s*100%/);
    expect(drawer).toMatch(/overscroll-behavior:\s*contain/);
    expect(drawer).toMatch(/place-self:\s*stretch start/);
    expect(drawer).toMatch(/inline-size:\s*min\(/);
  });

  it('T-UX-137e: viewport-fit=cover is in the viewport meta tag', () => {
    /*
     * ⚠ THIS IS THE HALF THAT CANNOT BE SEEN IN THE CSS. `env(safe-area-inset-*)`
     * resolves to `0` on every device unless the document opts into the full
     * viewport, so `T-UX-137c` passes in full while the bar renders underneath
     * the home indicator on the one device this product is actually used on.
     */
    const html = readFileSync(join(WEB_ROOT, 'index.html'), 'utf8');
    const viewport = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html)?.[1];

    expect(viewport).toBeDefined();
    expect(viewport).toContain('viewport-fit=cover');
    // The rest of the tag is load-bearing too; a replacement is not an upgrade.
    expect(viewport).toContain('width=device-width');
  });

  it('T-UX-137f: NO rule, at any width, puts the nav back into fixed positioning', () => {
    for (const body of allRuleBodies('.nav')) {
      expect(body).not.toMatch(/position:\s*fixed/);
    }
    expect(allRuleBodies('.nav').length).toBeGreaterThan(0);
  });

  it('T-UX-137g: the desktop shell padding is the SHORTHAND, which is what drops the clearance', () => {
    /*
     * ⚠ SUBTLE, AND EASY TO UNDO WHILE TIDYING. The base `padding-bottom`
     * reserves a bar's worth of space; above `--bp-sm` there is no bar. The
     * `padding` shorthand resets all four sides and is therefore the only
     * thing removing that reservation - rewrite it as `padding-inline` plus
     * `padding-top` and every desktop page grows dead space at the bottom that
     * no rule appears to cause.
     */
    expect(wideRuleBody('.app-shell')).toMatch(/(^|\s)padding:\s*var\(--space-5\)/);
  });

  it('T-UX-137h: the Menu is present on every destination at phone width', () => {
    // ⚠ A REGRESSION GUARD: the Menu is the ONLY way to a destination on a
    // phone, so a route that failed to render it would strand the owner.
    for (const path of ALL_HREFS) {
      const nav = atPhoneWidth(path);
      expect(menuButton(nav), path).toBeTruthy();
      cleanup();
    }
  });

  it('T-UX-137i: the scroll container no longer reserves a bar height', () => {
    // `scroll-padding-bottom` reserved room under the old fixed bar; left in
    // place it would stop every browser-driven scroll short of the page foot.
    expect(declarations(baseRuleBody('html'))).not.toMatch(/scroll-padding-bottom/);
    expect(declarations(CSS)).not.toMatch(/scroll-padding-bottom/);
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-167 — at --bp-lg the sidebar lists every destination, no drawer.    */
/* ------------------------------------------------------------------------ */

/** A `matchMedia` whose sidebar answer can be flipped after mount. */
function stubSidebar(initial: boolean): (sidebar: boolean) => void {
  let sidebar = initial;
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        if (query === SIDEBAR_VIEWPORT_QUERY) return sidebar;
        return query === WIDE_VIEWPORT_QUERY;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => false,
    }),
  });
  return (next) => {
    sidebar = next;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

describe('T-UX-167 · ui-refresh.md §6 · the sidebar shows every destination', () => {
  it('T-UX-167a: at --bp-lg every destination is a link in the nav, in route order, with no Menu', () => {
    stubSidebar(true);
    const nav = renderAt('/about');
    expect(labels(nav)).toStrictEqual([...ALL_LABELS]);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toStrictEqual([...ALL_HREFS]);
    expect(within(nav).queryByRole('button', { name: NAV_MENU_LABEL })).toBeNull();
    expect(screen.queryByRole('dialog', { name: NAV_MENU_TITLE })).toBeNull();
  });

  it('T-UX-167b: the current page is marked in the sidebar, and a child route keeps its parent', () => {
    stubSidebar(true);
    const nav = renderAt('/waiting');
    expect(currentLinks(nav).map((link) => link.textContent)).toStrictEqual(['Waiting to stream']);
    cleanup();
    const nested = renderAt('/batches/b_1/review');
    expect(currentLinks(nested).map((link) => link.textContent)).toStrictEqual(['Review']);
  });

  it('T-UX-167c: every sidebar destination carries a decorative icon beside its visible label', () => {
    stubSidebar(true);
    const nav = renderAt('/');
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.querySelector('svg'), link.textContent ?? '').not.toBeNull();
      expect(link.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it('T-UX-167d: widening past --bp-lg with the drawer open closes it and shows the full list', () => {
    const setSidebar = stubSidebar(false);
    const nav = renderAt('/');
    openDrawer(nav);
    setSidebar(true);
    expect(screen.queryByRole('dialog', { name: NAV_MENU_TITLE })).toBeNull();
    expect(labels(nav)).toStrictEqual([...ALL_LABELS]);
    setSidebar(false);
    expect(labels(nav)).toStrictEqual([...BAR_LABELS]);
    expect(menuButton(nav)).toHaveAttribute('aria-expanded', 'false');
  });

  it('T-UX-167e: --bp-lg is ONE number, in :root, in the @media prelude and in TS', () => {
    expect(/--bp-lg:\s*(\d+)px/.exec(CSS)?.[1]).toBe(String(BP_LG));
    expect(CSS).toContain(`@media (min-width: ${String(BP_LG)}px)`);
    expect(SIDEBAR_VIEWPORT_QUERY).toBe(`(min-width: ${String(BP_LG)}px)`);
  });

  it('T-UX-167f: the sidebar and the page share one framed panel, split by a hairline', () => {
    const block = CSS.slice(CSS.lastIndexOf('grid-template-columns: 12rem minmax(0, 1fr)'));
    const shell = /^[^}]*/.exec(block)?.[0] ?? '';
    expect(shell).toMatch(/border:\s*1px solid var\(--color-border-soft\)/);
    expect(shell).toMatch(/border-radius:\s*var\(--radius-card\)/);
    const content = /\.app-shell__content\s*\{([^}]*)\}/.exec(block)?.[1] ?? '';
    expect(content).toMatch(/border-inline-start:\s*1px solid var\(--color-border-soft\)/);
    expect(content).not.toMatch(/(^|\s)border:/);
  });
});
