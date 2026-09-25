/**
 * `AppShell` (TASK-025) - the frame every screen sits inside (`specs/ui.md` §1).
 *
 * Renders the header, the nav and the global footer, and nothing else: the
 * routed screen goes in the `<main>` via `<Outlet />`.
 *
 * The landmark structure is load-bearing, not decoration. `specs/ui.md` §10.2
 * requires `<header>`, `<nav>`, `<main>` and `<footer>` to appear EXACTLY ONCE
 * per page (`T-A11Y-004`), which is why they live here and must not be
 * repeated by an individual page.
 *
 * ⚠ THAT "EXACTLY ONCE" IS WHY THERE IS NO SEPARATE PHONE `<nav>`. The
 * idiomatic way to build REQ-117 is a second, bottom-fixed `<nav>` shown only
 * below `--bp-sm` - and it fails `T-UI-023c`/`T-A11Y-004` on every route at
 * once. One `<nav>` changes its CONTENTS instead; `useWideViewport` decides
 * which contents.
 *
 * The footer is where TMDB attribution goes (`specs/ui.md` §8) - it is a
 * compliance obligation that must be present, as visible text, on every one of
 * the nine routes. TASK-026 mounts `<TmdbAttribution />` here; the sentence
 * itself is deliberately NOT hard-coded in this file, because US-011 AC-2
 * requires it verbatim and `T-ATTR-001` asserts one string flows constant ->
 * API -> DOM. A literal here would be a second source of truth that can
 * silently diverge.
 *
 * ---
 *
 * TASK-211 - the navigation (REQ-116/REQ-117, `specs/ui-refresh.md` §6).
 *
 * ⚠ THE `<nav>`, `<ul>` AND `<li>` CARRIED NO `className` AT ALL, which is why
 * the application rendered as a wrapped column of blue browser-default links.
 * React Router was already supplying `isActive` and NOTHING CONSUMED IT: there
 * was no way to tell, from the navigation, which page you were on.
 *
 * ⚠ THE ACTIVE CUE IS NEVER COLOUR ALONE (`specs/ui.md` §10.2, `T-UX-117`).
 * `.nav__link--active` carries a weight change AND a rule, and
 * `aria-current="page"` carries it to assistive technology. A colour-only
 * indicator is invisible to roughly one man in twelve, and to anyone in bright
 * sunlight - which is where a phone is used.
 *
 * ⚠ HIDING A ROUTE FROM THE BAR MUST NEVER HIDE IT FROM THE ROUTER
 * (`T-UX-133`). The Menu drawer (issue 369) lists EVERY destination as a real
 * link over the SAME route table, so each keeps its own URL, is reachable by
 * direct link, and is marked `aria-current` in the drawer. It replaced the
 * `More` overflow: nothing is nested behind a second disclosure.
 */

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type RefObject,
} from 'react';
import { NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';

import { ErrorBoundary } from './ErrorBoundary';
import { OfflineBanner } from './OfflineBanner';
import { TmdbAttribution } from './TmdbAttribution';
import { CaptureResume } from './CaptureResume';
import { LibraryNavigation } from './LibraryNavigation';
// ⚠ THROUGH THE BARREL, NOT THE INDIVIDUAL FILES. `components/icons/index.ts`
// is the REGISTER that makes REQ-124's set closed; importing a drawing
// directly bypasses it, and an unregistered icon could then ship without ever
// meeting `T-UI-030`'s count.
import {
  BrandIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  FilterIcon,
  HistoryIcon,
  InfoIcon,
  ListIcon,
  MenuIcon,
  RatingIcon,
  SearchIcon,
  SuppressedIcon,
  UploadIcon,
} from './icons';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { useOnline } from '../lib/useOnline';
import { useSidebarViewport, useWideViewport } from '../lib/useWideViewport';
import {
  NAV_MENU_CLOSE_LABEL,
  NAV_MENU_LABEL,
  NAV_MENU_TITLE,
  NAV_TAB_FILTERS_LABEL,
  NAV_TAB_FILTERS_NAME,
  NAV_TAB_SEARCH_LABEL,
  NAV_TAB_SEARCH_NAME,
  signedInAsLabel,
} from '../copy';
import {
  LibraryCommandContext,
  type LibraryCommand,
  type LibraryCommandKind,
} from '../lib/libraryCommand';
import { OwnerNameContext, ownerInitial } from '../lib/ownerContext';
import { ROUTES, type RouteDefinition } from '../routes';

type NavRoute = RouteDefinition & { readonly navLabel: string };

const NAV_ITEMS: readonly NavRoute[] = ROUTES.filter(
  (route): route is NavRoute => route.navLabel !== null,
);

/**
 * The owner's hybrid navigation (issue 369): at and above `--bp-sm` the bar
 * shows the three destinations of the value loop — Library, Import, Review —
 * beside a Menu button; below it the bar is the Menu button alone. At and
 * above `--bp-lg` the header is a sidebar with room for every destination,
 * so it lists them all directly and there is no Menu button or drawer.
 */
const BAR_PATHS: readonly string[] = ['/', '/upload', '/batches'];

/** Reuse only icons whose meaning matches the destination; labels remain visible. */
const BAR_ICONS: Record<string, ComponentType<{ readonly label?: string | undefined }>> = {
  '/': ListIcon,
  '/upload': UploadIcon,
  '/batches': CheckIcon,
  '/removed': HistoryIcon,
  '/not-interested': SuppressedIcon,
  '/waiting': ClockIcon,
  '/about': InfoIcon,
  '/rating': RatingIcon,
};

/**
 * Whether `pathname` is inside `routePath`, using React Router's OWN matcher.
 *
 * ⚠ `end` IS THE WHOLE SUBTLETY, AND `/` IS THE CASE IT RUINS. `matchPath`
 * with `end: false` compiles `/` to a prefix that matches EVERY path in the
 * application, so without this guard the *Library* destination reports itself
 * active on all eleven routes - and the styling would highlight every
 * destination at once. `T-UX-117d` fails the moment the guard is removed.
 *
 * ⚠ `<NavLink>` DOES NOT HAVE THE SAME BUG, AND THAT ASYMMETRY IS THE TRAP.
 * NavLink's own `isActive` additionally requires the next character to be a
 * `/`, so `to="/"` is already exact for it with or without `end`. That means
 * the two matchers DISAGREE by default: drop `end` from `isRouteActive` and
 * the class says active while `aria-current` says nothing. The `end` prop
 * passed to each `NavLink` below is therefore not redundant defensiveness -
 * it is the statement that both mechanisms are being fed the same rule, and
 * `T-UX-117b` asserts the two land on the same element.
 *
 * ⚠ EVERY OTHER ROUTE WANTS `end: false`, so `/batches/:id/review` keeps
 * *Review* marked. That is the point of a prefix match, and the reason this
 * is not simply `pathname === routePath`.
 */
function isRouteActive(pathname: string, routePath: string): boolean {
  return matchPath({ path: routePath, end: routePath === '/' }, pathname) !== null;
}

/*
 * ⚠ THE LITERAL CLASS MAPS. `T-CSS-001c` permits a `className` that is a
 * string literal, or a lookup from a LOCAL, NON-EXPORTED const object of
 * string literals, and nothing else - no template literal, no `clsx`, no
 * conditional concatenation. A class assembled at runtime is invisible to
 * `T-CSS-001`'s both-directions scan, which then reports the active variant as
 * dead CSS and invites someone to delete it.
 */
type ActiveKey = 'active' | 'inactive';

const NAV_LINK_CLASS: Record<ActiveKey, string> = {
  active: 'nav__link nav__link--active tap-target',
  inactive: 'nav__link tap-target',
};

function activeKey(active: boolean): ActiveKey {
  return active ? 'active' : 'inactive';
}

/** A text destination - the wide bar, and every row of the Menu drawer. */
function NavTextLink({
  route,
  active,
  onNavigate,
}: {
  readonly route: NavRoute;
  readonly active: boolean;
  readonly onNavigate?: () => void;
}): JSX.Element {
  const key = activeKey(active);
  const Icon = BAR_ICONS[route.path];
  return (
    <NavLink
      to={route.path}
      end={route.path === '/'}
      className={NAV_LINK_CLASS[key]}
      onClick={onNavigate}
    >
      {Icon ? <Icon /> : null}
      {route.navLabel}
    </NavLink>
  );
}

/**
 * The Menu drawer: every destination, directly, in route order.
 *
 * ⚠ BUILT ON THE `Dialog` PRIMITIVE, NOT A SECOND FOCUS IMPLEMENTATION. The
 * drawer covers the page, so it is modal: focus moves in and is trapped,
 * Escape and the backdrop close it, the background is inert and cannot scroll,
 * and focus returns to the Menu button — all owned by `Dialog` and asserted by
 * `T-A11Y-006` / `T-UI-031f` already.
 *
 * ⚠ A LINK CLOSES THE DRAWER BEFORE IT NAVIGATES. Closing afterwards, from a
 * location effect, would restore focus to the Menu button AFTER the route had
 * moved focus into the new page. Following the link to the page you are
 * already on closes it too, which a location effect alone never sees.
 */
function NavDrawer({
  pathname,
  onClose,
  returnFocus,
}: {
  readonly pathname: string;
  readonly onClose: () => void;
  readonly returnFocus: RefObject<HTMLButtonElement | null>;
}): JSX.Element {
  const headingId = useId();
  return (
    <Dialog
      variant="drawer"
      id="nav-drawer"
      aria-labelledby={headingId}
      onDismiss={onClose}
      returnFocus={returnFocus}
      data-testid="nav-drawer"
    >
      <div className="panel-head">
        <h2 id={headingId}>{NAV_MENU_TITLE}</h2>
        <Button variant="ghost" aria-label={NAV_MENU_CLOSE_LABEL} onClick={onClose}>
          <CloseIcon />
        </Button>
      </div>
      <ul className="nav-drawer__list">
        {NAV_ITEMS.map((route) => (
          <li key={route.path} className="nav__item">
            <NavTextLink
              route={route}
              active={isRouteActive(pathname, route.path)}
              onNavigate={onClose}
            />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function AppShell(): JSX.Element {
  const online = useOnline();
  const location = useLocation();
  const wide = useWideViewport();
  const sidebar = useSidebarViewport();
  const mainRef = useRef<HTMLElement>(null);
  const captureRoute = location.pathname === '/upload' || location.pathname.startsWith('/batches/');

  useEffect(() => {
    if (location.pathname.startsWith('/titles/')) {
      mainRef.current?.focus();
      return;
    }
    if (location.pathname === '/upload' || /^\/batches(?:\/|$)/.test(location.pathname)) {
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [location.pathname]);

  const barItems = sidebar
    ? NAV_ITEMS
    : wide
      ? NAV_ITEMS.filter((route) => BAR_PATHS.includes(route.path))
      : [];
  const libraryRoute = NAV_ITEMS.find((route) => route.path === '/');
  /*
   * TASK-255 — the owner's mobile mockup puts a bottom tab bar under the
   * library. ⚠ NOT ON THE CAPTURE ROUTES: /upload and a batch's review own
   * a sticky bottom action (Continue, Start extraction, Apply) that a fixed
   * bar would sit on top of, and the mockup's import screens show no bar.
   * There the phone nav is the Menu button alone, as issue 369 left it.
   */
  const tabBar = !wide && !captureRoute && libraryRoute !== undefined;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const ownerName = useContext(OwnerNameContext);
  const initial = ownerInitial(ownerName);
  const [command, setCommand] = useState<LibraryCommand | null>(null);
  const consume = useCallback((seq: number) => {
    setCommand((current) => (current?.seq === seq ? null : current));
  }, []);
  const searchTabRef = useRef<HTMLButtonElement>(null);
  const filtersTabRef = useRef<HTMLButtonElement>(null);
  const channel = useMemo(
    () => ({ command, consume, tabs: { search: searchTabRef, filters: filtersTabRef } }),
    [command, consume],
  );
  const request = (kind: LibraryCommandKind): void => {
    setCommand((current) => ({ kind, seq: (current?.seq ?? 0) + 1 }));
    // Remembered library choices are restored by LibraryNavigation.
    if (location.pathname !== '/') navigate('/');
  };

  // Phone-scoped styles key off the ROOT element because dialogs portal to
  // <body>, outside .app-shell, and the filters sheet is one of them.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.layout = wide ? 'wide' : 'phone';
    return () => {
      delete root.dataset.layout;
    };
  }, [wide]);

  // Back/Forward while the drawer is open closes it too.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Widening into the sidebar closes the drawer, so narrowing again finds it closed.
  useEffect(() => {
    if (sidebar) setMenuOpen(false);
  }, [sidebar]);

  return (
    <div className="app-shell" data-tab-bar={tabBar || undefined}>
      <header className="app-shell__header">
        <NavLink to="/" className="app-shell__logo">
          <BrandIcon />
          <span>
            next<span className="app-shell__wordmark-accent">up</span>
          </span>
        </NavLink>
        {!wide && initial !== null && ownerName !== null && (
          <span className="app-shell__avatar" role="img" aria-label={signedInAsLabel(ownerName)}>
            {initial}
          </span>
        )}
        <nav aria-label="Primary" className="nav" data-tabs={tabBar || undefined}>
          <ul className="nav__list">
            {barItems.map((route) => (
              <li key={route.path} className="nav__item">
                <NavTextLink route={route} active={isRouteActive(location.pathname, route.path)} />
              </li>
            ))}
            {tabBar && (
              <>
                <li className="nav__item">
                  <NavTextLink
                    route={libraryRoute}
                    active={isRouteActive(location.pathname, libraryRoute.path)}
                  />
                </li>
                <li className="nav__item">
                  <Button
                    variant="ghost"
                    ref={searchTabRef}
                    aria-label={NAV_TAB_SEARCH_NAME}
                    data-testid="tab-search"
                    onClick={() => request('search')}
                  >
                    <SearchIcon />
                    <span>{NAV_TAB_SEARCH_LABEL}</span>
                  </Button>
                </li>
                <li className="nav__item">
                  <Button
                    variant="ghost"
                    ref={filtersTabRef}
                    aria-label={NAV_TAB_FILTERS_NAME}
                    data-testid="tab-filters"
                    onClick={() => request('filters')}
                  >
                    <FilterIcon />
                    <span>{NAV_TAB_FILTERS_LABEL}</span>
                  </Button>
                </li>
              </>
            )}
            {!sidebar && (
              <li className="nav__menu">
                <Button
                  ref={menuButtonRef}
                  variant="ghost"
                  aria-expanded={menuOpen}
                  aria-controls="nav-drawer"
                  aria-haspopup="dialog"
                  onClick={() => setMenuOpen(true)}
                >
                  <MenuIcon />
                  <span>{NAV_MENU_LABEL}</span>
                </Button>
              </li>
            )}
          </ul>
        </nav>
      </header>
      {menuOpen && !sidebar && (
        <NavDrawer
          pathname={location.pathname}
          onClose={() => setMenuOpen(false)}
          returnFocus={menuButtonRef}
        />
      )}

      <div className="app-shell__content">
        <OfflineBanner offline={!online} />
        {!captureRoute && <CaptureResume key={location.pathname} />}

        <main ref={mainRef} tabIndex={-1}>
          <ErrorBoundary resetKey={location.pathname}>
            <LibraryCommandContext.Provider value={channel}>
              <LibraryNavigation>
                <Outlet />
              </LibraryNavigation>
            </LibraryCommandContext.Provider>
          </ErrorBoundary>
        </main>

        <footer data-testid="app-footer">
          <TmdbAttribution />
        </footer>
      </div>
    </div>
  );
}
