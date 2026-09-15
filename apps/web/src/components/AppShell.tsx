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
 * ⚠ COLLAPSING A ROUTE OUT OF THE BAR MUST NEVER COLLAPSE IT OUT OF THE ROUTER
 * (`T-UX-133`). The destinations behind `More` keep their own URLs, are
 * reachable by direct link, and are still marked `aria-current` when open.
 * `More` is a disclosure over the SAME route table, never a second routing
 * mechanism.
 */

import { useEffect, useState, type ComponentType, type JSX } from 'react';
import { NavLink, Outlet, matchPath, useLocation } from 'react-router-dom';

import { ErrorBoundary } from './ErrorBoundary';
import { OfflineBanner } from './OfflineBanner';
import { TmdbAttribution } from './TmdbAttribution';
import { ListIcon } from './icons/ListIcon';
import { MoreIcon } from './icons/MoreIcon';
import { UploadIcon } from './icons/UploadIcon';
import { Button } from './ui/Button';
import { useOnline } from '../lib/useOnline';
import { useWideViewport } from '../lib/useWideViewport';
import { NAV_MORE_LABEL } from '../copy';
import { ROUTES, type RouteDefinition } from '../routes';

type NavRoute = RouteDefinition & { readonly navLabel: string };

const NAV_ITEMS: readonly NavRoute[] = ROUTES.filter(
  (route): route is NavRoute => route.navLabel !== null,
);

/**
 * REQ-117's two real destinations, resolved by the owner at `A53` (OQ-2).
 *
 * ⚠ TWO, PLUS OVERFLOW - AND THE SPARE-LOOKING THIRD SLOT IS NOT AN OMISSION
 * TO BE HELPFULLY CORRECTED. These two are the value loop (*see the list*,
 * *feed the list*); everything else is somewhere the owner goes deliberately,
 * not repeatedly. Promoting `/removed` or `/batches` into the third slot is
 * the obvious "improvement", and it is the thing §6 explicitly forbids.
 *
 * ⚠ THE OVERFLOW IS "EVERYTHING ELSE", NOT A SECOND HAND-WRITTEN LIST. §6
 * names `/removed`, `/not-interested` and `/batches` because those were the
 * only overflow routes when it was written; `/waiting`, `/about` and `/rating`
 * have since joined the table. Enumerating the overflow here would have left
 * three routes in neither list - silently absent from the phone entirely.
 */
const PHONE_BAR_PATHS: readonly string[] = ['/', '/upload'];

/**
 * ⚠ ICONS ARE ON THE BAR SLOTS ONLY, AND THAT IS WHY THE CLOSED SET FITS.
 * §7c's v1 set of thirteen is CLOSED, and it contains `list`, `upload` and
 * `more` - exactly the three slots REQ-117 names - but nothing that honestly
 * depicts *Waiting to stream*. Decorating the other destinations would need
 * either a fourteenth icon (forbidden) or an approximate one, and an icon that
 * means nearly the right thing is worse than no icon: it is read confidently,
 * and read wrong.
 */
const BAR_ICONS: Record<string, ComponentType<{ readonly label?: string | undefined }>> = {
  '/': ListIcon,
  '/upload': UploadIcon,
};

/**
 * Whether `pathname` is inside `routePath`, using React Router's OWN matcher.
 *
 * ⚠ `end` IS THE WHOLE SUBTLETY, AND `/` IS THE CASE IT RUINS. `matchPath`
 * with `end: false` compiles `/` to a prefix that matches EVERY path in the
 * application, so without this guard the *List* destination reports itself
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
 * *Batches* marked. That is the point of a prefix match, and the reason this
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

const NAV_SLOT_CLASS: Record<ActiveKey, string> = {
  active: 'nav__slot nav__slot--active tap-target',
  inactive: 'nav__slot tap-target',
};

function activeKey(active: boolean): ActiveKey {
  return active ? 'active' : 'inactive';
}

/** A text destination - the wide bar, and every row of the `More` panel. */
function NavTextLink({
  route,
  active,
}: {
  readonly route: NavRoute;
  readonly active: boolean;
}): JSX.Element {
  const key = activeKey(active);
  return (
    <NavLink to={route.path} end={route.path === '/'} className={NAV_LINK_CLASS[key]}>
      {route.navLabel}
    </NavLink>
  );
}

/**
 * One slot of the phone bar: icon over label.
 *
 * ⚠ THE LABEL IS ALWAYS RENDERED, SO THE ICON IS ALWAYS DECORATIVE (§7c: an
 * icon is never the sole label). An icon-only bar would also fail REQ-116's
 * sibling rule for the same reason the colour-only active cue does - the whole
 * distinction would rest on a single channel.
 */
function NavBarSlot({
  route,
  active,
}: {
  readonly route: NavRoute;
  readonly active: boolean;
}): JSX.Element {
  const Icon = BAR_ICONS[route.path];
  const key = activeKey(active);
  return (
    <NavLink to={route.path} end={route.path === '/'} className={NAV_SLOT_CLASS[key]}>
      {Icon ? <Icon /> : null}
      <span className="nav__slot-label">{route.navLabel}</span>
    </NavLink>
  );
}

export function AppShell(): JSX.Element {
  const online = useOnline();
  const location = useLocation();
  const wide = useWideViewport();

  const barItems = NAV_ITEMS.filter((route) => PHONE_BAR_PATHS.includes(route.path));
  const overflowItems = NAV_ITEMS.filter((route) => !PHONE_BAR_PATHS.includes(route.path));
  const overflowHoldsCurrent = overflowItems.some((route) =>
    isRouteActive(location.pathname, route.path),
  );

  /*
   * ⚠ `null` MEANS "THE OWNER HAS NOT DECIDED", NOT "CLOSED". The panel must
   * be open when the route you are ON lives behind it - otherwise `T-UX-133`
   * cannot hold at all: a deep link to `/removed` would render a closed
   * disclosure, and the `aria-current="page"` the requirement asks for would
   * be on an element that does not exist. A plain `useState(false)` looks
   * correct and quietly makes the requirement unsatisfiable.
   */
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);

  /*
   * ⚠ RESET ON NAVIGATION, so an override never outlives the decision that
   * produced it. Without this, opening `More`, going to `/removed` and then
   * pressing back leaves the panel forced open - or forced shut while the
   * current route is inside it, which is the failing half.
   */
  useEffect(() => {
    setOpenOverride(null);
  }, [location.pathname]);

  const expanded = openOverride ?? overflowHoldsCurrent;

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <NavLink to="/" className="app-shell__logo">
          nextup
        </NavLink>
        <nav aria-label="Primary" className="nav">
          <ul className="nav__list">
            {wide
              ? NAV_ITEMS.map((route) => (
                  <li key={route.path} className="nav__item">
                    <NavTextLink
                      route={route}
                      active={isRouteActive(location.pathname, route.path)}
                    />
                  </li>
                ))
              : barItems.map((route) => (
                  <li key={route.path} className="nav__item">
                    <NavBarSlot
                      route={route}
                      active={isRouteActive(location.pathname, route.path)}
                    />
                  </li>
                ))}

            {wide ? null : (
              <li className="nav__more">
                <Button
                  variant="ghost"
                  aria-expanded={expanded}
                  aria-controls="nav-more-panel"
                  onClick={() => setOpenOverride(!expanded)}
                >
                  <MoreIcon />
                  <span className="nav__slot-label">{NAV_MORE_LABEL}</span>
                </Button>
                {/*
                 * ⚠ NOT RENDERED WHEN CLOSED, rather than hidden with CSS. A
                 * `display: none` subtree is still in the document, so
                 * `T-UX-132`'s "reachable ONLY via More" would pass against a
                 * bar that in fact still exposed every link to anything
                 * reading the DOM - including a screen reader, on some
                 * hiding techniques.
                 */}
                {expanded ? (
                  <ul className="nav__panel" id="nav-more-panel">
                    {overflowItems.map((route) => (
                      <li key={route.path} className="nav__item">
                        <NavTextLink
                          route={route}
                          active={isRouteActive(location.pathname, route.path)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )}
          </ul>
        </nav>
      </header>

      <OfflineBanner offline={!online} />

      <main>
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <footer data-testid="app-footer">
        <TmdbAttribution />
      </footer>
    </div>
  );
}
