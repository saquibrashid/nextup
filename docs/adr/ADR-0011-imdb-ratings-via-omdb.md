# ADR-0011 — IMDb ratings via OMDb, keyed on `imdb_id`, cached and lazily refreshed

| | |
|---|---|
| **Status** | **Accepted** (scoped to v1.1 — specified now, built after the v1 value loop closes) |
| **Date** | 2026-08-21 |
| **Deciders** | owner (`A50` — the requirement, the source choice and the surface choice), coordinator |
| **Forced by** | **`A50`**, REQ-088…REQ-093, NFR-004, NFR-010, NFR-013, NFR-014, ADR-0007, ADR-0010 |
| **Supersedes** | Nothing. |

### Requirements defined here

⚠ Same caveat as ADR-0010: **there is no authoritative REQ register above
REQ-076**, so this ADR defines its own ids in full. REQ-082 – REQ-087 are
ADR-0010's; this file starts at **REQ-088** and the whole tree was grepped for
collisions before numbering (ADR-0010 was numbered twice for exactly this
reason).

| REQ | Statement |
|---|---|
| **REQ-088** | Every surface that lists a work — the combined list, the waiting view (ADR-0010), and review passes — may display that work's **IMDb rating**. |
| **REQ-089** | Ratings are read from **OMDb**, keyed on the **`imdb_id` already obtained from TMDB**. A rating is **never** looked up by title text. |
| **REQ-090** | A rating is **cached** on the work with the timestamp it was fetched, and refreshed **lazily on access** once older than `IMDB_RATING_MAX_AGE_DAYS`. No scheduler, no job, no backfill sweep. |
| **REQ-091** | "No rating" is a **first-class, rendered state**. A work with no IMDb rating is never shown as `0`, `0.0`, or an empty star row. |
| **REQ-092** | The owner can **look up any title by name** and see its IMDb rating **without adding it to any list**. The lookup writes nothing. |
| **REQ-093** | Rating retrieval respects OMDb's **free-tier daily budget**. Exhausting it degrades to the cached or absent state; it never fails the page, and it never triggers a bulk backfill. |

## Context

The owner asked, verbatim (`A50`):

> *"I'd like to add additional features. I'd like to be able to query a movie
> and check its imdb rating."*

Two clarifications were taken before any design was written, because the
request is ambiguous in two independent ways and guessing either one wrong
produces a materially different product:

- **Which rating?** The owner chose **OMDb — the real IMDb number** — over
  TMDB's `vote_average`, in full knowledge that OMDb is unofficial and adds a
  second API key.
- **Which surface?** The owner chose **both**: a rating on existing list rows,
  *and* a lookup box for titles not in any list.

### Why this is not simply "read the rating from IMDb"

**IMDb has no free API.** This is the load-bearing external fact, and it is not
obvious — it is reasonable to assume a site that famous exposes ratings.

| Source | Verdict |
|---|---|
| **IMDb official API** (AWS Data Exchange, GraphQL) | Real IMDb data, sanctioned. **~$150,000/year**, enterprise contract. Not viable for a single-owner personal app. |
| **IMDb bulk datasets** (`title.ratings.tsv`, free, daily) | Official and free for non-commercial use — but ingesting it requires a **scheduled job**, and `T-CI-005` caps this repo at exactly **two** non-owner processes. **Rejected on architecture, not on cost.** |
| **TMDB `vote_average`** | Free, already integrated, no new key. But it is *TMDB's* rating and diverges noticeably from IMDb's. **Rejected by the owner** — the ask was specifically IMDb. |
| **OMDb API** | Genuinely IMDb's number. Free tier 1,000 req/day. Unofficial and not IMDb-sanctioned. **Chosen.** |
| **Scraping IMDb** | Forbidden. Prohibited by IMDb's terms and against this project's standing no-scraping rule. **Never an option.** |

The bulk-dataset rejection deserves emphasis because it is the one a
cost-conscious reader would otherwise reach for: it is *free and official*, and
it still loses. A daily TSV ingest is a third background process, and the
two-process ceiling is an invariant with a test behind it.

## Decisions

### D-1 — OMDb is the source, and its unofficial status is recorded, not hidden

OMDb is a third-party republisher. It is not endorsed by IMDb, its data can lag,
and its free tier is a courtesy. That is an accepted trade, made by the owner
with the alternative (TMDB's own rating, free and already wired) placed
alongside it.

⚠ **The free tier is licensed for personal use.** This app is single-owner and
private, which is squarely inside that. If nextup ever became a product, this
decision must be revisited before launch, not after.

### D-2 — Look up by `imdb_id`, never by title text

OMDb accepts both `?t=<title>` and `?i=<imdb_id>`. **Only `?i=` may be used.**

TMDB already gives us `imdb_id` for every matched work, so the identifier is
free. A title-text lookup would reintroduce fuzzy matching *after* the pipeline
has already done the hard work of resolving a canonical work — and would do it
against a different vendor's index, with different normalisation. The failure
mode is silent and awful: a plausible rating attached to the wrong film.

**Corollary:** a work with no `imdb_id` from TMDB has **no rating**, and that is
REQ-091's rendered state — not an invitation to fall back to a title search.

### D-3 — Lazy refresh on access, with its own constant

Ratings are cached on the work alongside a fetch timestamp and refreshed on
access once stale, exactly like TMDB metadata (NFR-014). This keeps the feature
inside the permitted *form* of background-ish work: metadata-only, access-
triggered, never scheduled.

⚠ **It does NOT come for free against `T-CI-005`.** ADR-0010 established the
governing precedent: its watch-provider refresh is *also* metadata-only and
*also* access-triggered, and Epic L still records it as a **third**
non-owner-initiated process requiring US-036 AC-2 and `T-CI-005` to be amended
in the same change. By that precedent the rating refresh is **one more again**.
See "Required amendment" below. An earlier draft of this ADR asserted the
opposite — that no process was added — which is exactly the error Epic L's note
predicts will otherwise surface as a red `T-CI-005` at the end of the build.

A **new** constant is introduced:

```ts
export const IMDB_RATING_MAX_AGE_DAYS = 14;
```

⚠ **It must never be unified with, or derived from, either existing constant.**
The repo already carries a hard rule that `IMAGE_RETENTION_DAYS = 30` and
`TMDB_METADATA_MAX_AGE_DAYS = 183` are two separate things that must not be
merged. This is now a **third** member of that family and the same rule applies
to it. `14` is deliberately *not* another "30-ish" number, so that a future
reader cannot mistake it for the retention constant at a glance.

Why shorter than metadata's 183 days: a film's title, year and poster are
effectively immutable, whereas a rating moves — fastest in the weeks after
release, which is precisely the window ADR-0010's rental-discovery flow cares
about.

⚠ **"Stale" is overloaded in this repo.** `metadataStale` (TMDB, 183 days) and
rating staleness (14 days) are different flags with different horizons. Do not
collapse them because they share a word.

### D-4 — "No rating" is a state, not a zero

A large share of works legitimately have no IMDb rating: unreleased titles,
obscure titles, and anything TMDB matched without an `imdb_id`. Rendering `0.0`
would state that the film is *terrible* when the truth is that we *don't know* —
an actively false claim, and the worst available failure mode for a feature
whose entire purpose is to inform a watch decision.

### D-5 — The lookup surface writes nothing

REQ-092's lookup resolves through TMDB search → `imdb_id` → OMDb, and returns.
It creates no `Title`, no `ServiceListing`, no `WatchIntent`, no `Suppression`.

This matters because the lookup is the one surface where the owner types an
arbitrary title, and every other write path in nextup is deliberately gated
behind a review pass. A lookup that quietly created records would be a second,
unreviewed ingest route.

### D-6 — Budget guard, and degrade rather than fail

1,000 requests/day sounds generous and is not, on a first render: a list of
several hundred titles with a cold cache could consume most of a day's budget
in one page load.

Therefore:
- ratings are fetched **only for works actually being rendered**, never for the
  whole table;
- a **serial**, bounded fetch path is used, consistent with the existing
  image-processing discipline;
- on budget exhaustion or any OMDb error, the surface renders the **cached or
  absent** state (REQ-091) and the page still loads.

A rating is an enhancement to a list; it is never a reason the list fails to
appear.

## Consequences

**Zero new runtime dependencies.** OMDb is reached with native `fetch`, mirroring
`tmdbClient.ts`, so NFR-004's justification burden is met by adding nothing.

**One new secret.** `OMDB_API_KEY` becomes a Container Apps secret and must be
confined to a single client file — `omdbClient.ts` — exactly as `TMDB_API_KEY`
is confined to `tmdbClient.ts` today. `infra/aca.bicep` is a contended file;
that edit is a coordination point, not a free-for-all.

**One new outbound host.** `omdbapi.com` joins `api.themoviedb.org` as a
permitted egress target. The supply-chain gate must be checked, not assumed.

## Required amendment when this epic is promoted

⚠ **`T-CI-005` and US-036 AC-2 must be incremented in the same change**, naming
the rating refresh explicitly and recording that it is metadata-only and
access-triggered.

⚠ **Do not hard-code the new number in advance.** US-036 AC-2 says "exactly
two" today; ADR-0010 already claims a third for its availability refresh. The
correct instruction is therefore **"increment the current count by one"**, not
"change it to three" or "to four" — the right value depends on whether Epic L
has been promoted first, and writing a literal here would be wrong under one of
the two merge orders. Read the current assertion, then raise it by one.

This is part of the epic, not a follow-up.

## Open questions for the owner

**OQ-A — Sorting by rating vs invariant 5.** If the list can be *sorted* by
rating, then a lazy refresh that changes a rating changes **list ordering** —
which is user-visible list state. Invariant 5 forbids a *scheduler* from doing
that; lazy-refresh-on-access is explicitly permitted, so this is arguably
compliant. But it is close enough to the line that it should be an explicit
owner decision rather than a coordinator's reading. **Not resolved here.**
Displaying a rating raises no such question; only sorting by it does.

**OQ-B — Ratings for TV.** IMDb rates a series and each episode separately.
nextup's works include series. Which number is shown for a series is
undecided; OMDb returns the series-level rating for a series `imdb_id`, which
is the assumed default but has not been confirmed.
