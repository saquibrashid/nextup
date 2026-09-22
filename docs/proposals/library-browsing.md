# Library browsing continuity

Owner work order, 2026-09-21: #328 first, then #326, each in a separate PR.
The owner explicitly chose persistence **across browser restarts**.

## Header spacing and layout memory (owner follow-up, 2026-09-22)

- The unfinished-capture banner must have at least 16px of separation from
  the library heading and its Service updates/Add title actions, including
  when controls wrap on phones. Keep the status and library actions in
  normal document flow.
- Remember Grid/Compact across navigation, reload and browser restarts.
  Reuse the browser-local browsing-memory boundary, with a separately
  validated `nextup.library.layout.v1` value (`grid` or `compact`).
  Grid remains the first-use default. Invalid values reset with the existing
  unsupported-choice notice; blocked storage retains in-app state and shows
  the existing persistence limitation.
- Layout remains presentation-only: it does not change the URL, API query,
  loaded pages, order, filters or search. Explicit filter links and
  Back/Forward keep their URL semantics without resetting the layout.
- `T-LIB-003` covers persistent layout and unchanged requests; `T-LIB-004`
  measures real banner/action spacing at phone, tablet and desktop widths.

## #328: remembered browsing destination

- Remember the last library filters, search, sort field and direction in
  browser-local storage (`nextup.library.v1`). No server preference, account
  data, title rows, cursor, credentials or review decisions are stored.
- On a fresh bare `/` visit, or an application return from another route to
  bare `/`, restore that destination **before mounting the list container**.
  This covers navigation, the logo, receipt links and Apply/discard redirects.
  Preserve navigation state, including the Apply receipt and Undo information.
- Explicit query links replace the saved destination, never merge with it.
  Back/Forward restore their own exact URLs, including an unfiltered `/`.
  In-place Clear filters/search changes must not resurrect the previous query.
- Controls and requests still derive exclusively from the resulting URL.
  Missing direction means that field's default. The former direction-only
  session fallback is superseded: it rewrote older history entries using newer
  choices. Persisted destinations now contain both field and direction.
- Strip cursors and unknown parameters from remembered destinations. Validate
  enum choices with existing filter/sort helpers. Keep valid genre selections
  even if current rows no longer supply them: show the chip/empty result and
  allow clearing it, rather than silently broadening the list.
- Unsupported saved values produce an explanatory status and supported
  defaults. Storage failures show a status; in-app return memory still works,
  but persistence beyond the current page lifetime cannot be promised.
- Preferences are local to this browser profile and origin, not synchronized
  across devices. The app is single-owner. Clearing site data clears them.

## #326: compact search, separate slice

Retain search functionality instead of removing it. Put a labelled Search
disclosure beside Compact/Grid, below the primary filter/count/sort row.
The initial unsearched page has no full-width input.

Opening focuses the labelled input. Enter explicitly submits; typing never
requests data. Escape, Close search and the disclosure itself close the form
and return focus without clearing the submitted query; an unsubmitted draft
is discarded. Active search remains visible as both "Search active" and the
existing independently clearable query chip. Explicit URL/history changes
with a query reveal the form without stealing focus from navigation.

Clear search removes only search/cursor, retains filters/order, keeps the
form open and restores input focus. The URL remains the only submitted state.
Preserve Compact/Grid, metadata, actions, oldest-first and phone target floors.
`T-LIB-002` adds real geometry, focus, overflow and accessibility evidence.
