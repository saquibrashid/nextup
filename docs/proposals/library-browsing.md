# Library browsing continuity

Owner work order, 2026-09-21: #328 first, then #326, each in a separate PR.
The owner explicitly chose persistence **across browser restarts**.

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

Retain search functionality, but put the input behind a visibly labelled
Search disclosure. Active URL search stays visible and clearable. Preserve
keyboard focus, URL history, filters, sorting, Compact/Grid and phone layouts.
Do not introduce a second query model or change list membership/order.
