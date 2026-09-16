# ADR-0011 — IMDb ratings via OMDb, keyed on `imdb_id`, cached and lazily refreshed

| | |
|---|---|
| **Status** | **Accepted, and REVISED on 2026-09-14 (`A53`).** OQ-B stands as resolved. ⚠ **OQ-A has been REOPENED AND REVERSED by the owner** — see *Revision 1* immediately below. |
| **Date** | 2026-08-21. **Revision 1: 2026-09-14.** |
| **Deciders** | owner (`A50` — the requirement, the source choice and the surface choice; ~~`A51` — display-only, no sort by rating~~ **superseded by `A53`, see Revision 1**), coordinator |
| **Forced by** | **`A50`**, REQ-088…REQ-093, NFR-004, NFR-010, NFR-013, NFR-014, ADR-0007, ADR-0010 |
| **Supersedes** | Nothing. |
| **Revised by** | **`A53`** (2026-09-14, Epic P / `specs/ui-refresh.md` §7a) — rating becomes a sort key. |

## Revision 1 — the rating IS a sort key, and the refresh becomes synchronous (`A53`, 2026-09-14)

⚠ **This reverses `A51`, and it does so deliberately.** The closing warning of
OQ-A below — *"do not add a rating sort as a convenience later without
reopening this"* — did its job: the question was put back to the owner, with
the invariant-5 argument restated, and the owner changed their mind knowing
what it costs. This section is that reopening. **It is not a convenience edit,
and the warning it answers is retained verbatim rather than deleted.**

### R1-1 — What changed

| | |
|---|---|
| **Was** (`A51`) | The IMDb rating is display-only. It is not a sort key and no `sort=rating` option exists. |
| **Now** (`A53`) | `sort=rating` **exists**. The rating is an ordering alongside date-added, name, release year and runtime (`specs/ui-refresh.md` §5b). |

### R1-2 — ⚠ Why this is NOT a one-line requirement flip

`REQ-095` was **load-bearing for REQ-041 compliance**, not a taste preference,
and `specs/api.md` said so outright:

> *"`imdbRating` is **display-only**: it is not a sort key and no `sort=rating`
> option exists (REQ-095, ADR-0011 OQ-A). **That is precisely what keeps the
> refresh legal under REQ-041** — a background write that changed the list's
> ORDER would not be."*

The mechanism is specific, and it is the whole reason this revision needs more
than a struck sentence. **The two lazy refreshes in this repo are not alike:**

| Refresh | When it writes | Why it was legal |
|---|---|---|
| **TMDB metadata** (§6.4, REQ-076) | **Synchronously, inside the request** | *"This is not a background job. It is synchronous within an owner-initiated request, which is precisely why REQ-041 is satisfied."* |
| **IMDb rating** (REQ-090, REQ-093) | **After the response** — *"ratings appear on the next render"* | Legal **only** because a display-only field cannot change membership, ordering or badges |

So simply adding `sort=rating` to the existing implementation would take a
post-response write and make it **reorder the owner's list between renders**,
with nothing having asked it to. That is squarely what product invariant 5
forbids. **An agent that strikes REQ-095 and stops has shipped the defect.**

### R1-3 — Decision: the rating refresh becomes synchronous when it is the sort key

**Chosen by the owner at `A53`**, from four options put to them with this
trade-off stated:

> *Fetch ratings synchronously when sorting by rating — the same proven pattern
> as the TMDB refresh, REQ-041 untouched, costs a little latency on that one
> sort.*

`sort=rating` therefore adopts **§6.4's shape, not REQ-090's**: the refresh is
performed **before the response is composed**, inside the owner-initiated
request, and the ordering is computed from the refreshed values. REQ-041 is
then satisfied for exactly the reason §6.4 already is, and the word
"arguably" — which OQ-A rightly refused to accept as a standard — no longer
appears anywhere in the argument. **This is a stronger compliance position
than `A51` produced, not a weaker one.**

⚠ **The refresh must precede the ORDERING, not merely the response.** Refreshing
only the page that a *stale* ordering selected produces a page ordered by old
values and rendered with new ones — a row showing `8.4` sitting below one
showing `7.1`. The sweep is over the **sortable set**, and the sort runs after.

### R1-4 — ⚠ This amends D-6, and the amendment is the point

D-6 states ratings are fetched *"only for works actually being rendered, **never
for the whole table**"*. R1-3 requires the opposite for this one ordering,
because a value you have not fetched cannot be sorted on. **D-6 is therefore
amended, not quietly contradicted:**

> **D-6 as amended.** Ratings are fetched only for works being rendered,
> **except under `sort=rating`, where the stale ratings of the sortable set are
> swept before ordering, under a bounded budget.** Every other surface keeps
> the original per-page rule unchanged.

The cost is not symmetric across time, and the asymmetry is what makes this
safe. `IMDB_RATING_MAX_AGE_DAYS = 14`, so in steady state only a handful of
rows are stale on any given day and the sweep is a few requests. The expensive
case is the **first ever** `sort=rating` against a cold cache: several hundred
OMDb calls out of a 1,000/day free tier.

### R1-5 — Budget and degrade (chosen by the owner at `A53`)

The sweep is bounded by **both** a request cap and a time budget, and a title
not refreshed within them **keeps its cached-or-absent value and is ordered on
that**. The page still renders; the remainder refresh on a later view.

This mirrors §6.4's existing, already-proven posture verbatim — *"items not
refreshed within it are returned stale-flagged and retried on the next view"* —
and it is the same degrade-never-fail rule D-6 and REQ-093 already impose.
**A rating is an enhancement to a list; it is never a reason the list fails to
appear**, and that sentence survives this revision intact.

### R1-6 — ⚠ The residual: ordering drift only in the degraded case

Because the sweep covers the **whole sortable set** rather than one page, it is
self-limiting: after the first page's sweep there is nothing left stale, so
subsequent pages in the same pagination session perform **no writes** and the
ordering cannot drift underneath the cursor.

That leaves exactly one residual, and it is worth naming because it is the only
way a title can be silently skipped: **if the sweep exhausts its budget**, some
rows are still stale, a later page's sweep may refresh them, and a keyset
cursor over a *mutable* key can then step past a row that moved. It is bounded
to the degraded case the owner explicitly accepted at `A53`. The available
remedy, if it is ever observed, is to suppress the sweep whenever a `cursor` is
present — freezing the ordering for the session. **That remedy is recorded here
so a future reader does not have to re-derive it; it is not built in v1.**

⚠ **Rating is the ONLY mutable sort key.** Date-added is owner-supplied and
immutable once captured (OQ-A already made this point), and name, release year
and runtime are properties of the work. This hazard therefore does not
generalise to the other four orderings and must not be "fixed" for them.

### R1-7 — What this revision does NOT change

- **REQ-091 stands.** `null` is still a first-class rendered state and still
  never `0`. Under `sort=rating` unrated titles sort **last in both
  directions** (`A48`'s NULLs-last rule) — they never lead *"Highest first"*,
  and a `0` would put every unrated film at the bottom of *"Lowest first"* as
  a confident claim that it is terrible.
- **D-2 stands.** Lookup is by `imdb_id` only. A sort key changes nothing about
  where the number comes from.
- **The process count stands.** The refresh is still access-triggered and still
  metadata-only; making it synchronous moves it *further* inside the
  owner-initiated request, so `T-CI-005`'s permitted-process count does **not**
  increment. ⚠ **Do not raise it "to be safe"** — the count's value is that it
  is exact.
- **The `0004_title_imdb_rating` migration is NOT edited.** Applied migrations
  are immutable and `T-MIG-001` guards them. Its comment declining an index
  *"because the rating is display-only"* is now stale reasoning; at the owner's
  scale (low hundreds of rows on a 5-DTU database) the sort needs no index, so
  no follow-up migration is required either. **Correct the comment nowhere —
  record it here.**

### Requirements defined here

⚠ Same caveat as ADR-0010: **there is no authoritative REQ register above
REQ-076**, so this ADR defines its own ids in full. REQ-082 – REQ-087 are
ADR-0010's; this file runs **REQ-088 – REQ-095** and the whole tree was grepped
for collisions before numbering (ADR-0010 was numbered twice for exactly this
reason).

| REQ | Statement |
|---|---|
| **REQ-088** | Every surface that lists a work — the combined list, the waiting view (ADR-0010), and review passes — may display that work's **IMDb rating**. |
| **REQ-089** | Ratings are read from **OMDb**, keyed on the **`imdb_id` already obtained from TMDB**. A rating is **never** looked up by title text. |
| **REQ-090** | A rating is **cached** on the work with the timestamp it was fetched, and refreshed **lazily on access** once older than `IMDB_RATING_MAX_AGE_DAYS`. No scheduler, no job, no backfill sweep. |
| **REQ-091** | "No rating" is a **first-class, rendered state**. A work with no IMDb rating is never shown as `0`, `0.0`, or an empty star row. |
| **REQ-092** | The owner can **look up any title by name** and see its IMDb rating **without adding it to any list**. The lookup writes nothing. |
| **REQ-093** | Rating retrieval respects OMDb's **free-tier daily budget**. Exhausting it degrades to the cached or absent state; it never fails the page, and it never triggers a bulk backfill. |
| **REQ-094** | A matched work's **`imdb_id` is captured at match time**, from the TMDB detail response the metadata read already makes (`append_to_response=external_ids`), and stored on the work. It is **never** fetched per render, and **never** obtained by a second TMDB call. |
| **REQ-095** | ⚠ **REVISED at `A53` (2026-09-14) — see Revision 1.** The IMDb rating **is** an available sort key, and `sort=rating` exists. Under that ordering the rating refresh runs **synchronously, before the ordering is computed**, so REQ-041 is satisfied on §6.4's terms. `NULL`s sort last in both directions. ~~Superseded, and it was the owner's own earlier decision: "The IMDb rating is **display-only**. It is not a sort key, and no sort option for it exists (`A51`, OQ-A)."~~ |

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

A title-text lookup would reintroduce fuzzy matching *after* the pipeline has
already done the hard work of resolving a canonical work — and would do it
against a different vendor's index, with different normalisation. The failure
mode is silent and awful: a plausible rating attached to the wrong film.

**Corollary:** a work with no `imdb_id` from TMDB has **no rating**, and that is
REQ-091's rendered state — not an invitation to fall back to a title search.

#### D-2a — Where `imdb_id` actually comes from (measured, not assumed)

⚠ **`imdb_id` is NOT already available, and an earlier revision of this ADR
asserted that it was.** It appears nowhere in `prisma/schema.prisma`, nowhere in
`packages/domain`, and nowhere in `apps/api` — the `Title` model stores
`tmdbId`, `tmdbMediaType`, `tmdbName`, `tmdbReleaseYear` and friends, and no
IMDb identifier at all. TMDB's **search** endpoints never return one.

The following was measured against the live TMDB API using the production key,
rather than reasoned about:

| Call | `imdb_id` |
|---|---|
| `GET /3/movie/{id}` | ✅ `"tt1375666"` — **top level** |
| `GET /3/movie/{id}?append_to_response=external_ids` | ✅ top level *and* `external_ids.imdb_id` |
| `GET /3/tv/{id}` | ❌ **absent** |
| `GET /3/tv/{id}?append_to_response=external_ids` | ✅ `external_ids.imdb_id` = `"tt0903747"` |

Two things follow, and both are load-bearing.

**First, the identifier is obtainable at zero additional API calls — but only
via `append_to_response`.** `TmdbClient.getWork` already issues
`GET /3/{movie|tv}/{id}` for the REQ-029 metadata read. Adding
`append_to_response=external_ids` to *that existing call* yields `imdb_id` for
both media types without a second request, so the original claim's *conclusion*
(the identifier is effectively free) survives — its *premise* did not. A
separate `/external_ids` call, or a per-render lookup, would double TMDB traffic
for no reason and must not be written.

**Second, `/tv/{id}` alone silently omits the field.** A movie-first
implementation that reads `body.imdb_id` and is then pointed at a series gets
`undefined` — indistinguishable, at the call site, from a work IMDb has genuinely
never heard of. Every series would render REQ-091's "no rating" state and look
like correct behaviour. **Read `external_ids.imdb_id` for both media types**,
falling back to the top-level field only as a belt-and-braces second choice.

**Consequence:** `Title` gains an `imdbId` column, populated at match time from
the same detail response that already fills the other `tmdb*` fields.

~~Superseded, and it was false: "TMDB already gives us `imdb_id` for every
matched work, so the identifier is free."~~

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
  whole table — ⚠ **AMENDED at `A53`: this now has exactly one exception,
  `sort=rating`, which sweeps the sortable set under a bounded budget before
  ordering. See Revision 1 §R1-4. Every other surface keeps this rule as
  written;**
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

## Open questions — OQ-B resolved; OQ-A resolved, then reversed at `A53`

**OQ-A — Sorting by rating vs invariant 5. Resolved at `A51`, then REOPENED AND
REVERSED at `A53`. ⚠ READ REVISION 1 AT THE TOP OF THIS FILE — the text below
records the *original* decision and the reasoning that produced it, and is
retained because Revision 1 is an answer to it.**

The owner chose **no sort by rating** in v1.1. The rating is rendered on list
rows and on the lookup surface; it is **not** a sort key and no
`SortControl` option is added for it.

This settles the question the ADR raised rather than merely satisfying it: if
the list could be *sorted* by rating, a lazy refresh that changed a rating would
change **list ordering**, which is user-visible list state. Invariant 5 forbids
a *scheduler* from doing that and explicitly permits lazy-refresh-on-access, so
sorting was arguably compliant — but "arguably" is the wrong standard for the
invariant that protects the list. Display-only keeps the feature entirely
outside the argument.

⚠ **Do not add a rating sort as a convenience later without reopening this.**
The trade-off is recorded here precisely so that a future edit cannot make it
by accident. Note also that this is *not* symmetric with REQ-038's date sort:
the sort date is owner-supplied and immutable once captured, whereas a rating
is vendor-supplied and moves on its own.

> ✅ **This warning worked exactly as designed, and that is worth recording.**
> On 2026-09-14 a rating sort was proposed as part of the Epic P visual
> refresh. This paragraph is what forced it back to the owner as a decision
> rather than letting it land as a menu item — and the reopening surfaced that
> `specs/api.md` had since made REQ-095 load-bearing for REQ-041 in a way this
> section never claimed. The owner reversed the decision **with that cost
> stated**, and Revision 1 pays it by making the refresh synchronous. The
> asymmetry with REQ-038 noted above is still true, and Revision 1 §R1-6 turns
> it into a concrete rule: **rating is the only mutable sort key**, so its
> pagination hazard must not be generalised to the other four orderings.

**OQ-B — Ratings for TV. RESOLVED by measurement: the series-level rating.**
IMDb rates a series and each episode separately, so which number a series shows
had to be pinned. `GET /3/tv/1396?append_to_response=external_ids` returns
`external_ids.imdb_id = "tt0903747"`, which is *Breaking Bad the series* — not a
season and not an episode. OMDb keyed on that id therefore returns the
series-level rating, which is the number the owner is choosing a watch from.

The ADR previously called this "the assumed default … not confirmed". It is now
confirmed against the live API, and the assumption was correct. Episode-level
ratings are **out of scope**: nextup's unit of work is the title, and a rating
per episode has nothing to attach to.
