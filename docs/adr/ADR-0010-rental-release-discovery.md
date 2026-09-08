# ADR-0010 — Rental-release discovery as a non-service source, with TMDB watch-provider availability

| | |
|---|---|
| **Status** | **Accepted** (scoped to v1.1 — specified now, built after the v1 value loop closes) |
| **Date** | 2026-08-20 |
| **Deciders** | owner (`A48` — the requirement and both design choices), coordinator |
| **Forced by** | **`A48`**, REQ-082…REQ-087, REQ-041, REQ-070/071/073, REQ-048, NFR-010, NFR-013, NFR-014, ADR-0007 |
| **Supersedes** | Nothing. **Does NOT implement REQ-048** — see the trap in §5. |

### Requirements defined here

⚠ **There is no authoritative REQ register above REQ-076.** `BRD.md` §6.1 stops
before it; REQ-077 – REQ-081 exist only as citations scattered through
`specs/**` and `.github/copilot-instructions.md`. This ADR therefore **defines
its own ids in full**, and the next author should do the same. During drafting
this ADR was numbered REQ-081 – REQ-086 and **collided with the existing
REQ-080/081 pair** (fail one image, never the batch) — a collision only caught
by grepping the whole tree, because no table would have shown it.

| REQ | Statement |
|---|---|
| **REQ-082** | The owner can capture a **discovery source** — a browsed, editorially-curated page such as a rental storefront's new-release list — through the existing ingest, extraction, cross-check and TMDB-matching pipeline. No parallel pipeline is built. |
| **REQ-083** | A discovery-source batch is **append-only by construction**. `full-update` is refused at the API boundary, and reconciliation never runs for such a batch. Absence of a title from a later capture carries no meaning and can never propose a removal. |
| **REQ-084** | Confirmed discovery candidates become **`WatchIntent`** records, shown in a **separate waiting view**. They create no `ServiceListing`, no service badge, and no row in the combined list. |
| **REQ-085** | **Discarding** a candidate during a discovery review pass creates a **`Suppression`** on canonical work identity, so a rotating feed never re-presents it. |
| **REQ-086** | Availability is read from **TMDB watch-provider data**, for the owner's region (**`US`** — `ASM-059`, confirmed at `A49`; stored and passed explicitly, never hard-coded), refreshed **lazily on access only** and limited to availability metadata. A work found streaming on a service in `SERVICES` is **flagged with an invitation**; list state is never mutated automatically. |
| **REQ-087** | Any surface rendering availability carries the **JustWatch attribution** TMDB requires for watch-provider data — a condition of use, stricter than NFR-013's general TMDB attribution. |

## Context

The owner stated a second, distinct tracking need at `A48`, verbatim:

> *"Not only would I like to track movies/shows already saved in watchlists
> across the various streaming apps, I'd also like to track movies / shows
> that are just released for rent. What I often do is wait for them to be
> available via one of the streaming apps. But sometimes I lose track of what
> I wanted to watch as these movies drop off of the recent rent movies list
> and I don't always see them and able to connect them to the streaming apps.
> I usually use fandango stream for this tracking. And in this case, it's not
> a formal list or app capability/feature that I use. Instead, I just peruse
> the list and make a mental list."*

Two separate failures are described, and conflating them produces the wrong
product:

- **F-1, the memory failure.** A title seen on the new-release rental page is
  forgotten once it rotates off that page. There is no record anywhere.
- **F-2, the connection failure.** Months later the title lands on Netflix or
  Max and the owner never notices, because nothing connects the remembered
  intent to the subscription catalogue.

F-1 alone is solved by a durable list. **F-2 is the one that makes the
feature worth building**, and it is the one that requires a decision, because
nextup is forbidden from asking a streaming service anything (NFR-010).

### Why the existing model does not already cover this

nextup's entire feeder is *"screenshot a saved list you curated"*. Every
mechanism downstream assumes that:

| Assumption of the existing model | True of a Netflix/Max saved list | True of the Fandango at Home new-release page |
|---|---|---|
| The capture reflects **the owner's** intent | Yes — they saved each item | **No** — it is an editorial feed, identical for every visitor |
| A title's presence means "I chose this" | Yes | **No** — it means "this released for rent recently" |
| A title's **absence** can mean "I removed it" | Yes, in full-update mode | **Never** — it means "it is no longer new" |
| A badge means "saved on this service" | Yes | **No** — at most "rentable here", which is availability, not intent |
| The set is small and stable between captures | Yes | **No** — it rotates continuously and is mostly noise |

Every row of that table is a reason the two sources cannot share a mechanism.

## Decision

**D-1 — A rental storefront is a DISCOVERY SOURCE, not a service.** It gets
no member in `SERVICES`, no badge in the combined list, and no
`ServiceListing`. `SERVICES` continues to mean *"a subscription service whose
saved list the owner captures"*, and its two members remain Netflix and Max.

**D-2 — Discovery captures are structurally append-only.** `full-update` is
not merely discouraged for this source, it is **refused at the API boundary**.
A rotating editorial feed reconciled as a full update would propose the
entire waiting list for removal on the second capture, every time.

**D-3 — Availability comes from TMDB watch providers, lazily, on access.**
The owner chose this at `A48`. It is a metadata read from a vendor nextup
already depends on, not a request to a streaming service, so NFR-010 is
untouched. It is refreshed **on access only** — never on a timer — which is
what keeps it inside REQ-041's permitted set (see §4).

**D-4 — Waiting titles live in their own view, not the combined list.** The
combined list keeps its meaning: *"works saved on my services, one row per
work, a badge per service."* A waiting title is by definition on none of
them. When TMDB reports it on a service the owner has, nextup **flags it and
invites the owner to add it there** — it does not silently inject it into the
combined list.

**D-5 — Discarding a discovery candidate SUPPRESSES the work.** For a curated
saved list, "discard" means *"do not add this"* and re-review next time is
harmless because the list barely changes. For an editorial feed, that same
behaviour re-presents the same ~35 rejects on every single capture, and the
review pass becomes unusable within about three captures. Suppression already
does exactly the right thing — it is keyed on canonical work identity
(REQ-071) and filters **before** record creation (US-028 AC-2), so a rejected
title never returns no matter how many times the feed shows it again.

## Consequences

### The loop, end to end

1. Owner captures the rental storefront's new-release page. Mode is forced to
   append-only (D-2).
2. Extraction and TMDB matching run **unchanged** — this reuses the entire
   existing pipeline, which is most of why this feature is cheap.
3. Review pass: every extracted title is shown. Default disposition stays
   `pending` (REQ-014 — no accept-by-inaction), so **nothing enters the
   waiting list without an explicit tap**. Discard suppresses (D-5).
4. Confirmed works become `WatchIntent` rows: *"I want this, it is not on my
   services yet."*
5. On each open of the waiting view, works whose availability is older than
   `WATCH_PROVIDER_MAX_AGE_DAYS` are refreshed from TMDB (D-3).
6. A work TMDB reports as `flatrate` on Netflix or Max is flagged **"Now on
   Netflix — add it to your list"**, with a deep link.
7. The owner adds it in the real app; the next Netflix capture picks it up and
   it enters the combined list through the ordinary path. The `WatchIntent` is
   then satisfied and drops out of the waiting view.

Step 7 is the whole point: **the waiting view is a staging area that feeds the
existing loop, not a second parallel list.**

### What this costs

TMDB's `/watch/providers` endpoint is part of the same free non-commercial
tier already used for metadata, so the marginal monetary cost is zero. The
marginal request cost is bounded by the size of the waiting list and the
refresh age, not by the size of the library.

### Attribution

Watch-provider data is **JustWatch-sourced and TMDB requires it to be
attributed as such** — this is a stricter obligation than the general TMDB
attribution in NFR-013, and it is a condition of use rather than a courtesy.
Any surface rendering availability must carry it (REQ-087).

## §4 — Why the lazy refresh does not violate REQ-041

REQ-041 permits exactly one class of non-owner-initiated work over records:
**metadata-only lazy refresh on access** (as reworded at `A37`). The
availability refresh qualifies **only** while all three of these hold, and
each is separately asserted:

1. **On access, never on a timer.** No scheduler, no job, no queue. If the
   owner never opens the waiting view, no request is ever made.
2. **It changes availability metadata only.** It must never create, delete or
   re-state a `Title`, a `ServiceListing` or a `Suppression`; never alter
   membership or ordering of the combined list; and never satisfy a
   `WatchIntent` on its own.
3. **Graduation is an owner action.** Discovering that a work is streamable
   produces a *flag and an invitation*, never a mutation of list state.

⚠ **The tempting defect is to "just add it to the list automatically" once
TMDB says it is streamable.** That is a scheduler-driven change to
user-visible list state via the back door, it is wrong on the merits (the
work is still not in the owner's Netflix list, so the next full-update
capture would immediately propose removing it), and it is forbidden by
REQ-041 and product invariant 5.

### The count changes from two to three — amend it deliberately

**`PRD.md` US-036 AC-2 states that exactly two non-owner-initiated processes
exist** (the lazy TMDB metadata refresh and the 30-day image purge), product
invariant 5 repeats it, and **`T-CI-005` asserts the number**. The
availability refresh is a **third**.

This is a real widening of REQ-041 and must be taken as one: promoting this
epic **requires amending US-036 AC-2, product invariant 5 and `T-CI-005` to
three in the same change**, naming the availability refresh and recording that
it is metadata-only and access-triggered. Doing it deliberately at the start is
the difference between an amendment and a red `T-CI-005` at the end of the
build that an implementer is tempted to "fix" by weakening the gate.

## §5 — Traps

**⚠ TRAP 1 — This is NOT REQ-048, and implementing it as REQ-048 breaks it.**
`BRD.md` §6.2 already lists *"Fandango at Home"* among the seven non-spine
**services** deferred to v2. That row describes adding it to `SERVICES` as an
eighth capture surface with a saved list, badges and full-update
reconciliation. **This ADR requires the opposite treatment of the same brand
name.** An implementer who sees "Fandango at Home" in the backlog and reaches
for the REQ-048 pattern will produce a service whose "saved list" is an
editorial feed — and the first full-update capture will propose deleting the
owner's entire waiting list. The two remain independent: if Fandango at Home
is *also* added as a service in v2, it would be a genuinely separate
capability from this one.

**⚠ TRAP 2 — "It's just another service with a different badge" is wrong.**
See the table in §Context. Five distinct assumptions break, not one.

**⚠ TRAP 3 — Do not reuse `ServiceListing` for the waiting state.** A
`ServiceListing` asserts *"this work is on this service's saved list, added on
this date"*. A `WatchIntent` asserts *"the owner wants this and it is on no
service of theirs"* — it has no service, and its date is a discovery date, not
a date-added. Overloading the entity would put rows into the combined list's
own query path, and the badge count (REQ-025) would start counting things that
are not badges.

**⚠ TRAP 4 — Availability is a cache, not a fact.** TMDB/JustWatch data lags
reality and is region-specific. The UI must say when it was last checked, and
an availability miss must never be presented as "this is not streaming
anywhere" — only as "not seen on your services as of <date>".

**⚠ TRAP 5 — `metadataStale` is not `availabilityStale`.** The corpus already
has one 183-day TMDB lazy-refresh age (`TMDB_METADATA_MAX_AGE_DAYS`, NFR-014)
and one 30-day image retention constant (`IMAGE_RETENTION_DAYS`, NFR-019),
which `T-INV-008` forces to stay separate precisely because they look alike.
`WATCH_PROVIDER_MAX_AGE_DAYS` is a **third** such constant and must be
declared independently of both. Availability changes far faster than
descriptive metadata; binding it to the 183-day age would make the entire
feature inert.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Add Fandango at Home to `SERVICES` (i.e. REQ-048) | Breaks five assumptions at once (§Context). Full-update against an editorial feed is a data-loss mechanism. |
| Manual only — no availability signal | Solves F-1 and leaves **F-2**, the failure the owner actually described, entirely unaddressed. Owner rejected at `A48`. |
| Scheduled availability polling with notifications | Violates REQ-041 and product invariant 5. Also needs a notification channel that does not exist and telemetry-shaped infrastructure that NFR-005 forbids. |
| Scrape or query the streaming services directly | Prohibited outright by NFR-010. Never considered seriously; recorded so the question is closed. |
| Put waiting titles in the combined list with a "rent only" badge | Destroys the combined list's one-sentence promise by mixing *watchable now* with *cannot watch yet*. Owner rejected at `A48`. |
| Import the whole feed without review | The feed is mostly noise. Without the review pass as the curation step, the waiting list is unusable by the second capture. |

---
## 6. Test ids — MOVED to `specs/testing.md` §38 at `A52`

**Epic L was promoted to v1 by the owner on 2026-09-08 (`A52`), and the `T-WAIT-*`
and `T-AVAIL-*` tables that used to sit here have MOVED to `specs/testing.md`
§38** — in the same change that added `TASK-183` – `TASK-189` to
`docs/backlog.md`, exactly as the instruction below required.

**`specs/testing.md` §38 is now the authoritative copy, and the only one any
gate reads. Do not restore a second copy here.** A duplicated id table drifts
silently: `check:orphans` and `check-test-ids` both parse `specs/testing.md`
alone, so a table here that disagreed with §38 would look authoritative to a
human and be invisible to CI.

Requirements **REQ-082 – REQ-087**; stories **PRD Epic L / US-040 – US-043**;
data model `specs/data-model.md` §17.

~~"⚠️ These ids are reserved and specified; no test implements them yet, and no
v1 backlog task may cite them. They are recorded here rather than in
`specs/testing.md` deliberately... **Move these tables into `specs/testing.md`
in the same change that adds the Epic L tasks to `docs/backlog.md`, never
before.**"~~
*(Superseded at `A52` — the move has been carried out. Retained because the
REASONING is still correct and still binding on the next epic that gets
specified ahead of its schedule: defining an id in `testing.md` that no task
owns manufactures the exact state where every gate passes and the behaviour is
absent. It was right not to define them early, and it is right to define them
now that tasks own them.)*

### 6.3 The gate that must be amended, not weakened

⚠️ **CORRECTED IN PLACE at `A52` — the count in the superseded text below is
two revisions out of date and following it would set the gate to the wrong
number.**

**`T-CI-005g` today asserts that exactly THREE non-owner-initiated processes
exist:** the lazy TMDB metadata refresh, the screenshot purge, and the IMDb
rating refresh that **Epic M** added after this ADR was written. The
availability refresh is therefore a **FOURTH**, not a third.

`T-CI-005` will go red the moment the refresh is built. **That is by design and
it is a trip-wire, not an accident** — see `specs/testing.md` §33.1, which is
the authoritative statement of both the count and the sequencing. In short:

- the amendment is **not** part of the promotion, and was deliberately not made
  when the backlog rows were written — raising the count while nothing
  implements the fourth process would leave `PERMITTED_BACKGROUND_PROCESSES`
  naming a process that does not exist, and the gate loose by one named slot
  for as long as the epic takes to build;
- it is owned by **`TASK-187`**, the task that builds the refresh, and lands in
  that same commit: `PERMITTED_BACKGROUND_PROCESSES`, `T-CI-005g`, `PRD.md`
  US-036 AC-2 and product invariant 5, **all four together**;
- the owner has already approved the invariant change (`A52`), so `TASK-187`
  executes it rather than re-escalating it.

**The wrong response is to relax the gate into counting nothing in
particular.** Its value is entirely in the number being exact and small; a
`T-CI-005` that permits "some" background processes asserts nothing at all.

~~"⚠️ `T-CI-005` asserts that exactly TWO non-owner-initiated processes exist.
The availability refresh is a third, so `T-CI-005` will go red the moment this
epic lands... the correct response is to **amend it to three** in the same
change."~~
*(Superseded at `A52`. The count was two when this ADR was written; Epic M
raised it to three. The availability refresh makes four. The PRINCIPLE —
amend deliberately, never weaken — is unchanged and is why this paragraph is
retained rather than deleted.)*
