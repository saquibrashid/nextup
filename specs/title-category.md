# Comedy Show category (#364, TASK-247)

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
"tv" | "comedy-show"}`. It requires an active owned title and refuses suppression;
the title is locked against concurrent identity correction. No optimistic save:
errors retain the draft, Cancel changes nothing, and offline disables saving.

Named acceptance tests: `T-CATEGORY-001` domain classification and validation;
`T-CATEGORY-002` provider metadata and refresh; `T-CATEGORY-003` real SQL
owner-scoped persistence, identity safety, filters and pagination;
`T-CATEGORY-004` editor, display and URL state; `T-CATEGORY-005` browser journey.
