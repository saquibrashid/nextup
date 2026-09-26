# Title details (#327, TASK-238)

Approved by the owner on 2026-09-22. This is a dedicated, directly linkable
`/titles/:titleId` page, not a modal or an episode guide. Preserve the existing
library design and single-owner privacy model.

## Experience

The title name opens details without changing list state. Present artwork,
title/year/type, runtime, genres, IMDb score (not a personal rating), active
service badges, synopsis, cast with character names, and movie directors or
series creators. Cast can be expanded without truncating its stored contents.
Since #391 (TASK-259) the page also shows whatever else TMDB has — the tagline;
a *Details* list of Released (series: First aired), Status, Rated (US
certification), Seasons, Episodes and Writers, hidden when empty — and a
*Watch trailer* (or *Watch teaser*) link that opens the newest official
YouTube trailer in a new tab with `noopener noreferrer`. It is a link out,
never an embed: no third-party script, frame or cookie enters nextup, and the
CSP is unchanged. No trailer, no control. The same sections render on the
waiting details page `/waiting/:titleId` (`specs/ui.md` §7b).
Retain the existing Watching/priority, Fix match, Not interested and Remove
confirmation/undo flows. Removed and suppressed works remain directly readable;
navigation never restores them. Return to Your list preserves the exact library
query and remembered Grid/Compact choice. Direct entry falls back to the saved
library destination. Missing titles, unidentified works, missing fields,
loading, failed reads, offline use and provider outages have distinct honest
states. Shared shell attribution remains visible.

## API and storage

Extend the existing owner-scoped `GET /api/titles/:titleId` response with
`presentation: { status, data }`. Status is `available`, `stale`, `unavailable`,
or `unidentified`. Data is null or a validated display-only object containing
`tmdbId`, `mediaType`, `overview`, `cast` (name/character), `directors`,
`creators`, `fetchedAt` and, since #391, the optional `tagline`, `writers`,
`releaseDate`, `status`, `certification`, `seasons`, `episodes` and `trailer`
(`{ key, name, kind: Trailer or Teaser, publishedAt }`, the key checked as a
YouTube video id). A cached copy with no `trailer` key predates #391 and is
refetched once on access; `trailer: null` means TMDB has none. Basic detail fields and active/removed listings
retain their existing contract.

Add one nullable `title.tmdb_presentation` NVARCHAR(MAX) column with an ISJSON
constraint. Its explicit strict schema is separate from the extraction/matching
metadata allow-list: synopsis and credits are permitted ONLY in this display
cache and MUST NOT enter inference requests or broaden the original matching
DTO. No raw TMDB response or catalogue mirror is stored.

Only a detail read can fetch this cache. Use the existing TMDB client transport,
host allow-list, credentials, rate gate and retry policy. Read movie/TV details
in one request, appending `credits,videos,release_dates` (movie) or
`credits,videos,content_ratings` (TV); TV uses series cast and `created_by`, not a fabricated
series director. Reuse the existing 183-day metadata age policy. Cache entries
include provider identity; mismatches after Fix match are never rendered.
Writes are owner-, title- and current-provider-identity-scoped, metadata-only,
and cannot change membership, dates, priorities or service badges.

Failures preserve a valid cached copy and expose `stale`; no valid cache exposes
`unavailable`. Unidentified titles make no presentation-provider call. Provider
404 is not title removal. Invalid stored/provider data is logged without prose,
credentials or request URLs. An explicit retry rereads details, never mutates
the list or automatically replays an owner action.

## Acceptance mapping

| Contract | Named tests |
| --- | --- |
| Strict display schema; movie/series projection; transport failures | `T-DETAIL-001` |
| Fresh/stale/missing cache, identity correction, metadata-only owner-scoped persistence | `T-DETAIL-002`, `T-DETAIL-003` |
| Detail states, existing actions, direct links and remembered library return | `T-DETAIL-004`, `T-DETAIL-005` |
| Responsive layout, keyboard navigation, modal context and accessibility | `T-DETAIL-006` |
| Trailer choice, extra details and the pre-#391 cache refetch | `T-DETAIL-007` |
| Trailer link out, *Details* list and tagline on the page | `T-DETAIL-008` |
| The waiting details page | `T-WAIT-024`, `T-WAIT-025` |

Watched history, personal ratings, sharing, episode tracking, new providers,
streaming-service requests, new dependencies and infrastructure changes are
outside this slice. Merge/deployment requires separate owner approval.

~~Superseded at #391: "containing `tmdbId`, `mediaType`, `overview`, `cast`
(name/character), `directors`, `creators`, and `fetchedAt`"; "Read movie/TV details
with appended credits".~~
