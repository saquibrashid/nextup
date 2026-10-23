# Comedy Show and Documentary categories (#364, TASK-247; #456, TASK-288)

Owner decision, 2026-09-23: Comedy Show covers stand-up specials and live comedy
performances, not ordinary comedy films or sitcoms. Metadata assigns the category;
the owner can override it or return to Automatic from title details.

Canonical `movie`/`tv` media types, work identity, matching, runtime interpretation,
suppression, services and date-added remain unchanged. The display/filter category
is separate. Existing `type=` bookmarks retain their canonical meaning; new
`category=` filters select Movie, TV Show or Comedy Show, OR within category and AND
with other filters. Filtering happens in SQL before keyset pagination.

TMDB's appended keywords provide explicit performance evidence: `stand-up comedy`,
`stand up comedy`, `stand-up special` or `live comedy` (case insensitive). Genre,
title wording, performer names and synopsis are not classification evidence.
Catalogue keyword mistakes remain possible; the owner override is authoritative.
Only the derived nullable boolean is stored, not keyword text. No inference service
receives this metadata. Missing/unreadable keywords are unknown, never a negative.

The nullable title column is populated during ordinary on-access metadata reads.
A category-filtered request first attempts a bounded classification read of up to
25 eligible unknown or metadata-expired titles, then queries the category page. Attempts
are timestamped and ordered oldest-first so missing evidence cannot starve later titles.
The selected page is served from the exact metadata SQL filtered, not reclassified
after pagination. Any remaining unknown or expired
titles are explicitly disclosed as incomplete category results; reload retries.
No scheduler, streaming-service request or unbounded catalogue sweep is added.
Existing titles are not re-dated or re-created. Failure retains cached metadata.

Overrides live on the owner/work preference row, independently of watching and
priority. They survive removal/reappearance and follow the existing explicit
destination-wins preference policy on match correction. PATCH
`/api/titles/:titleId/category` accepts exactly `{categoryOverride: null | "movie" |
"tv" | "comedy-show" | "documentary"}`. It requires an active owned title and refuses suppression;
the title is locked against concurrent identity correction. No optimistic save:
errors retain the draft, Cancel changes nothing, and offline disables saving.

## Documentary (#456, PRD `A62`, US-071, ADR-0016, TASK-288 – TASK-289)

Documentary is a fourth display category, `documentary`. It is **derived at read
time** from the TMDB genre names already stored in `title.tmdb_genres` (genre 99,
movie and tv; the stored English name is `Documentary`), never stored. Precedence:
owner override, then Comedy Show (explicit performance evidence), then Documentary,
then the catalogue Movie/TV type. `titleCategory(mediaType, comedyPerformance,
override, genres)` in `packages/domain` is the single rule; the list SQL
`EFFECTIVE_CATEGORY` mirrors it (`tmdb_genres LIKE '%"Documentary"%'`) so filtering
before pagination agrees with the projected category. The canonical `mediaType` is
unchanged everywhere it is functionally needed.

Existing titles are not rewritten. A title with stored genres is Documentary at
once; one without stored genres (a freshly closed batch) is classified when the
existing on-access metadata refresh fills `tmdb_genres`. No new scheduler or
metadata field. The override CHECK is widened by additive migration
`0021_documentary_category` (`ck_watch_preference_category_v2` WITH CHECK, then
NOCHECK on the 0016 constraint; pinned in `tools/check-migrations.ts`).
`categoryOverride` and `?category=` accept `documentary`; `?type=` remains movie/tv.
Tests: `T-DOC-001` – `T-DOC-005` (`specs/testing.md`, US-071).

Named acceptance tests: `T-CATEGORY-001` domain classification and validation;
`T-CATEGORY-002` provider metadata and refresh; `T-CATEGORY-003` real SQL
owner-scoped persistence, identity safety, filters and pagination;
`T-CATEGORY-004` editor, display and URL state; `T-CATEGORY-005` browser journey.
