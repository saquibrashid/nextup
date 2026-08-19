# Business Requirements Document — nextup

| | |
|---|---|
| **Status** | Approved (scope locked at the phase 4 gate, A32–A37) |
| **Version** | 1.0 |
| **Created** | 2026-08-10 |
| **Author** | app-builder / brd-writer |
| **Source** | `projects/nextup/` |

> **Read this first — what kind of document this is.**
> nextup is a **personal, single-user, non-commercial project**. There is
> no revenue, no market to capture, no customers, no team and no
> timeline (A19 / ASM-027). Conventional BRD machinery — TAM, pricing,
> go-to-market, ROI, headcount — does not apply, and this document says
> so explicitly in each place rather than padding the section. The
> "business" case here is **personal utility**: does nextup remove more
> friction from the owner's evening than it adds to their week?
>
> **Scope authority:** `Context/mvp-definition.md` **§15 lock addendum**,
> which overrides the body of that document wherever they disagree, plus
> `Context/requirements.md` (63 functional — **59 in v1**; REQ-035,
> REQ-037, REQ-059 and REQ-069 each deferred to v1.1 — 20 NFR, 13
> `wont-v1`). `Context/intake.md` is **partially superseded**
> and is cited here only for the problem statement and success signals,
> never for mechanism.
>
> ~~*Superseded 2026-08-18 (TASK-132): "63 functional — 62 in v1, REQ-069
> deferred". That headline subtracted only REQ-069, but REQ-035, REQ-037 and
> REQ-059 are each marked "DEFERRED TO v1.1" in their own requirement rows
> under decisions D1/D2, taken at the same phase 4 lock. The correct v1 count
> is **59**, as `docs/PRD.md` §A.1 and §A.5 have said all along — this
> document was the last place the wrong figure survived.*~~

---

## 1. Executive summary

The owner's saved watchlists are trapped inside nine separate streaming
apps, so answering *"what have I saved that I could watch right now?"*
means opening three or more apps in sequence at the exact moment they
have sat down to watch — and titles saved months ago are effectively
lost. Phase 3 research established that the obvious solution, syncing
those lists programmatically, is **not viable for anyone**: no public
API, no partner route, ToS prohibitions carrying an account-termination
remedy, and four mature competitors who all ship cross-service
watchlists and none of whom syncs a real Netflix or Max list. nextup
therefore takes the only sanctioned path left — the owner screenshots
each service's saved list, **gets those images into nextup by pasting the
screen grab straight in (the primary interaction, A45) or by uploading the
saved file**, in an explicitly declared
`append-only` or `full-update` batch, and nextup extracts the titles by
OCR/vision, matches them to TMDB, and merges them into **one
deduplicated combined list, one row per title with a badge per
service**, with every change passing through an owner review pass. v1 is
single-user, mobile-first responsive web, federated sign-in, Netflix and
Max only, hosted on Azure at **≈$11–14/month** — originally free-tier only;
the cost constraint was relaxed system-wide at **A41** in favour of quality
and reliability, and the owner then selected the middle of three published
cost variants at **A40**, with a pre-authorised **+~$4/month** step to
**≈$15–18/month** held in reserve against a memory failure (**A43**) — with no
credentials, no scraping, no scheduled jobs and no telemetry. Shipping
it proves exactly one thing: **that a combined list is worth the price
of feeding it by hand** — and that is the premise the MVP exists to
test, not one it assumes.

---

## 2. Problem statement

### 2.1 The pain

Verbatim (A1, `intake.md` §1):

> "when I sit down to watch, I usually end up opening each app on my tv,
> one at a time, go check the save list, and see what I have to watch."

Observable and specific:

| Symptom | Frequency | Consequence |
|---|---|---|
| Serial app-hopping to reconstruct "what have I saved" | Every viewing session | Friction at the worst possible moment — the owner has already sat down |
| No single view across services | Always | The question the owner actually asks cannot be answered by any app |
| Saved titles decay into invisibility | Continuous | A title saved months ago in an app the owner forgot they had is functionally lost (SUC-003) |
| Decision time inflates | Every session | "A long hunt" rather than a couple of minutes (SUC-002) |

Nine services are in the owner's full vision (ASM-003); **three or more
are opened in a typical session**. v1 addresses two of them
(Netflix + Max, REQ-048 defers the other seven).

### 2.2 The status quo

Open each streaming app on the TV, one at a time, read each saved list,
hold the union in your head. It is inadequate for three reasons that no
amount of care fixes: it is **serial** (cost grows linearly with
services), it is **memory-bound** (the union is never written down), and
it is **incurred at the point of consumption** rather than amortised.

The market does not fix it either. Reelgood, JustWatch, Likewise and
Trakt all offer a cross-service watchlist — but each is a *separate list
the user maintains by hand*, not a view of the lists the user already
has. Adopting one means abandoning the saved lists inside Netflix and
Max, which are also the lists the TV itself shows. (`research-summary.md`,
competitor finding.)

### 2.3 Cost of inaction

`TBD — needs input` in any quantified form. No baseline measurement of
minutes-per-session exists and none will be taken: NFR-005 forbids
telemetry and ASM-033 fixes self-assessment as the only measurement
method. What *is* recorded, unquantified, is the qualitative cost:
friction at the sit-down-to-watch moment (SUC-002) and permanent loss of
old saves (SUC-003).

Because this is a personal project, the cost of inaction is **not
financial**. It is that the owner keeps paying a small tax on every
viewing session, indefinitely, and keeps losing titles they meant to
watch.

---

## 3. Opportunity

### 3.1 The central strategic finding — record it so it is not reopened

**Credentialed sync of Netflix and Max saved lists is not viable. Not
hard — not viable.** This is the single most important fact in the
project's history and it is why nextup looks the way it does.

| Avenue | Netflix | Max | Evidence |
|---|---|---|---|
| Public consumer API | **None** — retired ~Nov 2014, the user "queue" was a deliberately abandoned feature | **None**, never existed | verified |
| Partner / affiliate API | Enterprise/invite-only; content fulfilment and ISP CDN peering; no subscriber data | B2B rights/screener portal only | verified |
| Statutory data export | Marginal — manual, email-delivered, ≤30 days, ~2 requests/year | **Saved list probably not included**; 45 days extendable to 90 | verified (flow); single-source (contents) |
| Unofficial internal endpoints | Prohibited by ToS §1.8(iv)/(vii); §4 termination remedy with no credit | WBD terms bar "scrape, crawl" and "data-gathering and extraction tools"; termination at sole discretion, no refund | verified, verbatim |

And the operational obstacles are independently fatal even if one
ignored the terms: **email one-time codes no 3am job can answer**,
enterprise bot management that treats headless automation as detectable
by design, undisclosed session lifetimes, and **categorical
datacenter-IP blocking that disqualifies any Azure-hosted sync worker
outright** — which also made ASM-010 (Azure hosting) and credentialed
access mutually exclusive.

**The most persuasive evidence is behavioural, not documentary.** Four
mature commercial products in exactly this category — Reelgood,
JustWatch, Likewise, Trakt — all ship a cross-service watchlist, and
**not one syncs your actual Netflix or Max list**. Every competitor with
money, incentive and legal counsel arrived at the same conclusion. When
nobody ships the one feature that would obviously win the category, that
is a wall, not a gap.

*(Source: `Context/research-summary.md`, 18 searches / 20 cited sources;
evidence files `evidence/competitors.md`, `evidence/regulatory.md`,
`evidence/failure-modes.md`. RSK-001 is recorded as **realised** — it
ceased to be a risk and became a finding.)*

**Consequence for any future reader:** do not reopen this. The A14
loop-back deleted the entire credentialed mechanism — nine integrations,
a scheduler, a credential store and a home-PC agent — and REQ-049,
REQ-050, NFR-009 and NFR-010 exist specifically to keep it deleted.

### 3.2 What is left, and why it is an opportunity rather than a consolation

The core job — *see everything I've saved in one place* — remains
genuinely unsolved by the market, **but only because the "everything
I've saved" part is unobtainable through sanctioned automation**. There
is exactly one sanctioned channel through which a user's own saved list
leaves a streaming app: **the user's own eyes, and therefore the user's
own screen**.

Screenshotting a screen you are licensed to view, for personal use,
involves no automated access, no credential storage, no bot detection
and no datacenter-IP problem (ASM-016). The legal and operational risk
that killed the original mechanism **does not merely shrink — it
disappears** (RSK-002, RSK-003, RSK-006, RSK-008 all `closed`).

Two later corrections made this cheap rather than merely legal:

- **A15-correction / ASM-021 / REQ-051** — input is restricted to
  pixel-perfect screenshots (phone app or laptop web). Photographs of a
  TV are out of scope, which eliminated glare, keystone, moiré and
  upscaling work entirely (RSK-015 `largely-eliminated`).
- **A16 / ASM-019 / REQ-013** — the owner reviews *everything* before it
  lands, so extraction never needs to be autonomously high-confidence.
  Plain OCR becomes a legitimate candidate rather than a compromise.

Together these are why a **cheap** implementation is credible, and phase 7
proved it: every extraction option priced under $1/month.

> **⚠ Superseded by A40 / A41.** The two bullets above argue that plain OCR
> suffices *because* cost was the binding constraint. **Cost is no longer
> binding** — it was relaxed for extraction (A40) and then system-wide
> (A41) — and the extractor was subsequently re-decided **on quality**, as a
> hybrid multimodal-plus-OCR pipeline (ADR-0001 Rev 2). What remains true is
> the claim about the *input*: pixel-perfect screenshots, owner reviews
> everything. What no longer holds is the *conclusion* that plain OCR is
> therefore the right choice. **OQ-005 is closed.**

### 3.3 Why now

Nothing external changed. What changed is internal: the research pass
converted an unbounded feasibility question into a settled negative, and
the delivery model (autonomous coding agent, §12) made a
several-hundred-hour personal project into one the owner can direct
rather than build.

---

## 4. Business objectives

"Business" here means **personal utility**. Each objective is measurable
by owner self-assessment only (ASM-033, NFR-005) and traces to the
metrics in §7.

| # | Objective | Measure | Target | Traces to |
|---|---|---|---|---|
| **OBJ-1** | Replace app-hopping with one combined view as the owner's first stop when deciding what to watch | M1 — "did I open nextup first?" | nextup first **most** times, at Checkpoint 1 | REQ-024, REQ-025, REQ-026, REQ-031, NFR-006, NFR-007 · SUC-001 |
| **OBJ-2** | Make the combined list trustworthy enough that the owner never re-opens a streaming app to check it | M2, M6 | **Zero** unexplained trust breaks; **zero** unrecovered losses | REQ-005, REQ-006, REQ-013, REQ-017, REQ-021, REQ-022, REQ-023, REQ-027, REQ-028, REQ-055, REQ-057, REQ-062, REQ-063, REQ-067, REQ-075 · SUC-001 |
| **OBJ-3** | Cut the time from "sitting down" to "picked something" from a hunt to a couple of minutes | M3 | Yes, typically | REQ-031, REQ-032, REQ-033, REQ-034, REQ-036, REQ-038 · SUC-002 |
| **OBJ-4** | Stop losing saved titles — old saves resurface instead of being buried | M4 | **≥ 1** forgotten title resurfaced and watched | REQ-028, REQ-030, REQ-036, REQ-061, REQ-062, REQ-063, REQ-064 · SUC-003 |
| **OBJ-5** | Keep the feeder loop cheap enough that the owner keeps feeding it | M5, M7 | "Would happily do it again this month" = **yes**; still re-capturing ≥1 service. *(**A45**: clipboard paste is now the primary way a capture enters nextup, with file upload retained in full — worth about **one tap per image** at capture time. **The target and the M5 kill criterion are unchanged**: the dominant cost in this objective is the review pass, which paste does not touch.)* | REQ-011, REQ-016, REQ-018, REQ-020, REQ-039, REQ-057, REQ-074 · RSK-011, OQ-011 |
| **OBJ-6** *(amended by A40, rewritten by **A41**, quantified by **A40/Variant A**, band widened by **A43**)* | Run at a cost that is **as low as reasonable without degrading quality** — **quality and reliability outrank raw cost, system-wide**. ~~Near-zero cost with no fixed monthly commitment~~ was repealed at A41 | M9 | **≈$11–14/month — the owner-selected figure**, and **≈$15–18/month if the pre-authorised memory remedy is taken (+~$4/month, A43)**. Both figures satisfy this objective; the step is **already approved** and is spent only in response to a real failure. Presented with three priced variants, the owner chose the middle one (`architecture.md` §Cost summary, ADR-0005 Rev 3 / ADR-0003 Rev 4). It keeps the three things the spend was buying — no cold start, DB-enforced invariants, a staging environment — and pays for them with a less-travelled ORM path (**RSK-031**), 7-day rather than 35-day PITR, and a registry PAT. Right-sized for one user: no redundancy, no multi-region, no autoscaling. ~~No budget ceiling stated~~ — **OQ-026 CLOSED** by A40; **OQ-028 CLOSED** by A43 | NFR-012 *(now a `should`)*, NFR-012a · ~~RSK-012, OQ-005, OQ-026, OQ-028~~ *(closed)* |
| **OBJ-7** | Stay legally and contractually clean — no ToS exposure, TMDB obligations honoured | Inspection at Phase 11 review; no metered breach | Zero automated requests to any streaming service; attribution present on every TMDB-bearing view | NFR-009, NFR-010, NFR-013, NFR-014, REQ-076, REQ-049 |
| **OBJ-8** | Be buildable end-to-end by an autonomous coding agent with near-zero human implementation effort | Owner accepts by *using* the app, not by reading diffs | v1 delivered without hand-written implementation | NFR-002, NFR-003, NFR-004 · ASM-028, ASM-029, RSK-016/017/018/019 |
| **OBJ-9** | Remain a private, single-owner surface with no telemetry and no personal-data sprawl | Inspection | No analytics; screenshots owner-scoped and purged at 30 days | NFR-005, NFR-008, NFR-011, NFR-015, NFR-016, NFR-017, NFR-019, NFR-020 · RSK-014 |

---

## 5. Stakeholders

There is exactly one human stakeholder. Listing more would be fiction.

| Stakeholder | Interest | Influence | What they need from this |
|---|---|---|---|
| **The owner** (sole user, product decision-maker, reviewer, and the entire feeder loop) | A list worth opening, that costs less to maintain than it saves | **Total** — every decision A1–A38 | A combined list they trust (OBJ-1/2), and a review pass they can tolerate monthly (OBJ-5) |
| **GitHub Copilot coding agent** (implementer, ASM-028) | Unambiguous, self-contained, testable artifacts | High over *outcome quality*, none over scope | Precision: under ASM-029 an unstated behaviour is not deferred, it is chosen arbitrarily (NFR-002, NFR-003) |
| **TMDB** (metadata provider, external) | Compliance with its free non-commercial terms | Binding — can withdraw access | Mandatory attribution (NFR-013) and no caching beyond 6 months (NFR-014, REQ-076) |
| **Netflix / Max** (data subjects' services, external, non-participating) | That nextup does not touch them | Binding via ToS | Zero automated access (NFR-010, REQ-049); no credentials (NFR-009) |
| **Azure** (host) | Nothing beyond normal billing | Cost ceiling | ~~Free-tier / consumption only~~ — **relaxed system-wide at A41**, then **settled at A40**: as low as reasonable without degrading quality, **≈$11–14/month, owner-selected from three priced variants**, **plus a pre-authorised +~$4/month step to ≈$15–18 if the memory remedy is triggered (A43)**. OQ-026 and OQ-028 closed |
| **Future family & friends (<20)** | Eventual access | None in v1 | Only that the data model does not preclude them (NFR-001, NFR-008) — **explicitly not v1 scope** (REQ-047) |

Not applicable for this project — no customers, no investors, no
compliance officer, no operations team, no support function.

---

## 6. Scope

Authority: `mvp-definition.md` §4/§5 as modified by **§15 lock
addendum** (L1, L2, L3, D3, D6).

### 6.1 In scope — MVP

| Capability | Requirements | Business value |
|---|---|---|
| Federated sign-in, owner allow-list, no registration surface, no passwords stored | NFR-015, NFR-016, NFR-017 | Cheapest safe posture for an internet-reachable app; removes password storage/reset — three of the highest-risk things to hand an autonomous implementer (RSK-016) |
| Owner-scoped records; owner-only access to uploaded images | NFR-001, NFR-008, NFR-011, NFR-020 | OBJ-9. Near-zero cost now, a rewrite later |
| Multi-image upload accumulated into one batch, one service per batch, explicit mode. **Images enter by clipboard paste (primary interaction, A45), file selection, or drag-and-drop — all three converge on one batch and one ingest pipeline. ⚠ This was an ADD, not a swap: file upload remains first-class and load-bearing for the laptop web-screenshot path and the iOS Photos path** | REQ-001, REQ-002, REQ-003, REQ-004, REQ-007 | Intent declared, never inferred — absence only means something where the owner said it does (OBJ-2). Paste shortens the capture step by roughly one tap (OBJ-5); it does **not** shorten the review pass |
| Nothing changes until submit; reconcile once against the whole batch | REQ-005, REQ-006 | Prevents half-a-list deletion mid-batch (OBJ-2) |
| Never infer the service from image content | REQ-058 | Deletes a vision capability *and* its worst failure: misattributed screenshot → wrong service reconciled → silent wrong removals |
| OCR/vision extraction of candidate titles | REQ-008 | The mechanism (OBJ-1) |
| TMDB matching; store type, year, runtime, genre, poster reference | REQ-009, REQ-029 | Canonical identity **is** the match — dedup is impossible without it (ASM-030/031) |
| Lazy TMDB refresh on access; attribution on every TMDB-bearing view | REQ-076, NFR-013, NFR-014 | OBJ-7. Resolves the NFR-014 × REQ-041 mutual exclusion without a background job (D6/A37) |
| Unmatched candidates never silently discarded | REQ-012 | The floor under OBJ-2; resolution behaviour is OQ-015 |
| Review pass: additions section, confirm/correct/discard, no auto-accept, legible match cards | REQ-013, REQ-014, REQ-016, REQ-017, REQ-018 | Turns extraction error (RSK-009) and wrong matches (RSK-013) from correctness problems into nuisances |
| Mode-dependent review scope | REQ-011 | Less to review in append-only — a net simplification (OBJ-5) |
| Full-update shows already-known items, pre-confirmed and visually distinct | REQ-057 | **Load-bearing.** The only thing separating "OCR missed it" from "you removed it" — without it full-update becomes a data-loss mechanism |
| Disappeared section: ticked by default, untick to rescue, single group confirm | REQ-015, REQ-019, REQ-020, REQ-021, REQ-055 | The destructive action's entire UI; the only safety net acting *before* damage |
| Prohibitions on the destructive path | REQ-022, REQ-023 | Blast-radius containment: append-only never removes; full-update touches only its own service |
| One row per canonical title; one listing per (title, service); badges only for live listings | REQ-024, REQ-025, REQ-026 | The product promise in one sentence (OBJ-1) |
| Removal as a per-service state transition; **soft delete forever, no purge ever** | REQ-027, REQ-028 | Foundation of every recovery path (OBJ-2/4) |
| Browsable removed view (historical log), restore at any time, search + service filter | REQ-062, REQ-063, REQ-064, REQ-056, NFR-018 | OBJ-4 directly; a soft delete you cannot browse is indistinguishable from a hard one |
| Reappearance creates a **new** row dated today; the removed row stays as history | REQ-065 | **L1/A33 — reverses ASM-047.** The removed view is a log, not a recycle bin |
| Per-title **not interested** suppression, keyed on canonical work identity, with a suppressed view and undo | REQ-070, REQ-071, REQ-072, REQ-073 | **L2/A34 — closes a structural gap:** before this, no requirement permitted removing a title directly, so a title still saved on Netflix could never leave the list |
| Fix match — re-point a title at a different TMDB record without removing it | REQ-066 | RSK-013's only user-facing remedy; a wrong match *merges two works into one row* |
| Date-added on every listing, never overwritten, honestly labelled | REQ-030, REQ-060, REQ-061 | Makes sort-by-date-added well-defined; prevents a permanent misreading |
| Combined list with filter by service / type / genre, sort by date added, and a default order | REQ-031, REQ-032, REQ-033, REQ-034, REQ-036, REQ-038 | **The value loop.** OBJ-1, OBJ-3 |
| Per-service last-completed-upload date | REQ-039 | Mandatory RSK-007 mitigation — a list that silently goes out of date without the owner noticing makes nextup *worse* than the status quo. (The staleness-indication concept, REQ-040, was dropped entirely at A46 — the owner's verbatim answer: "Drop the concept entirely — no staleness nudge.") |
| Screenshot retention 30 days, then automatic purge; re-extraction inside the window | NFR-019, REQ-074 | **L3/A35.** Bounds RSK-014; makes a systematic extraction failure repairable |
| Batch undo for **creates-only** batches; mixed batches refused with a full enumeration of what they touched | REQ-067, REQ-068, REQ-075 | **D3/A36.** The safety net for the first bulk import — the riskiest moment in the product's life |
| No change to list state except by an enumerated owner action; no scheduled/background/purge process over list records | REQ-041 | The guarantee that nothing happens without the owner (OBJ-2) |
| Agent-executable artifacts, automated verification, mainstream stacks | NFR-002, NFR-003, NFR-004 | OBJ-8 — the delivery model itself |
| No telemetry; 320px and 1024px viewport floors; no credentials; no automated streaming requests; free-tier Azure | NFR-005, NFR-006, NFR-007, NFR-009, NFR-010, NFR-012 | OBJ-6, OBJ-7, OBJ-9 |

**Services in v1: Netflix and Max only.** Nothing in the requirement set
is service-specific; adding a service later is a configuration entry plus
layout tolerance in extraction, not an integration.

### 6.2 Out of scope — v1.1 / v2

| Capability | Requirements | Why deferred | Revisit when |
|---|---|---|---|
| Editing a listing's date-added | REQ-059 | Serves neither loop; the field is already honest and present. Also avoids testing REQ-036's counter-intuitive consequence in v1 | The list is populated and the owner wants to correct a date more than once. **Reinstating it re-opens D3 and OQ-023** |
| Filter and sort by runtime | REQ-035, REQ-037 | TV runtime is genuinely ambiguous (episode / season / series) and the record contains no decision — shipping it means the implementer picks one arbitrarily (the ASM-029 defect). REQ-029 still stores runtime, so v1.1 needs no migration | The TV-runtime semantic is decided, ideally alongside OQ-014 |
| Mixed-changeset batch undo | REQ-069 | **D3/A36 — prohibition relaxed by explicit user decision, not agent interpretation.** Highest complexity per unit of day-one value; the exact state-reconstruction logic an autonomous agent gets 90% right and 10% catastrophically wrong. Removes OQ-023 from the v1 blocking set | v1.1, or immediately if REQ-059 is reinstated |
| The seven non-spine services (Disney+, Prime Video, Peacock, Apple TV+, Paramount+, Starz, Fandango at Home) | REQ-048 | Netflix + Max are the spine; v1 ships exactly two configured services so the "add a service" path is not built speculatively | After Checkpoint 1, if M1/M5 pass |
| Multi-account for <20 family and friends | REQ-047, NFR-001 | Non-preclusion only in v1 — an allow-list of identities, not an account system | Owner chooses to share |
| Merge/split affordance for two unmatched rows of the same work | — (OQ-015, capped at D8) | Would be new UI on the identity path, enlarging v1 materially. **Accepted limitation:** two unmatched captures with differing text will produce two rows and v1 has no merge action | v1.1, once OQ-015's fallback identity is proven in use |

### 6.3 Out of scope — cut

| Item | Why |
|---|---|
| Credentialed login or automated retrieval from any streaming service (REQ-049) | **Proven non-viable** (§3.1). ToS-prohibited with an account-termination remedy; defeated by MFA, bot management and datacenter-IP blocking |
| Scheduled / nightly / any unattended update (REQ-050) | Nothing to sync unattended. Every update is owner-initiated (ASM-014, REQ-041) |
| Import of a Netflix statutory data export (REQ-054) | Offered as option B and not chosen; also manual, ≤30-day latency and statutorily capped at ~2 requests/year |
| Photographs of a TV or other physical screen (REQ-051) | A15-correction. Removed the entire preprocessing burden (RSK-015) |
| Upload-time image-quality gating (REQ-053) | Justified only by photographed screens; unnecessary for pixel-perfect input |
| "What should I watch" picker / recommendations (REQ-042) | The job is *see everything I saved*, not *decide for me* |
| Watched-state, progress, viewing history (REQ-043) | Declined at intake |
| Deep links that launch a title in the streaming app (REQ-044) | Declined at intake |
| TV-browser support, D-pad / remote navigation (REQ-045) | Phone first, laptop supported; TV is not a target surface |
| Native iOS / Android apps (REQ-046) | Web only |
| Usage analytics, telemetry, event pipeline, usage dashboard (REQ-052) | Success is self-assessed (NFR-005, ASM-033). Also protects the near-zero-cost posture |

---

## 7. Success criteria

**Measurement method: owner self-assessment, zero instrumentation**
(A21 / ASM-033 / NFR-005 / REQ-052). Every criterion below is answerable
from memory or from what is already visible in the app. **Nothing has to
be built to measure any of it.**

**Checkpoint 1 — 30 days after the first completed import of *both*
Netflix and Max**, i.e. anchored on the list being genuinely populated,
not on deployment. A half-populated list cannot support SUC-001, so
measuring from deployment would measure the wrong thing.
**Checkpoint 2 — 6 months after Checkpoint 1**, for SUC-004 only.
*(Closes OQ-016, whose derived "one month after first real use" value is
replaced by this.)*

Baselines are `TBD — needs input` throughout: no pre-project measurement
exists and NFR-005 forbids taking one. The targets are qualitative by
design.

| # | Criterion | Metric | Baseline | Target | Measured by | When |
|---|---|---|---|---|---|---|
| **M1** | "In the last two weeks, when I sat down to watch, did I open nextup first — or did I go to the streaming apps?" | SUC-001 (primary) | `TBD — needs input` (today: always the apps) | nextup first **most** times | Self-assessment, one question | Checkpoint 1 |
| **M2** | "Did I ever open a streaming app because I did not believe nextup's list was right?" | SUC-001, trust | n/a | **Zero**, or at most once with a known cause (e.g. a service not re-captured) | Self-assessment | Checkpoint 1 |
| **M3** | "When I picked something, did it take a couple of minutes rather than a long hunt?" | SUC-002 | `TBD — needs input` | Yes, typically | Self-assessment | Checkpoint 1 |
| **M4** | "Did at least one title I had completely forgotten about resurface and get watched?" | SUC-003 | 0 | **≥ 1** | Self-assessment; the combined list is the evidence | Checkpoint 1 |
| **M5** | "Was the last full-update review tolerable enough that I would happily do it again this month?" | RSK-011 / OQ-011 — the abandonment risk | n/a | **Yes** | Self-assessment immediately after a full-update review | After each full update; reported at Checkpoint 1 |
| **M6** | "Has nextup ever removed or lost something I did not intend?" | RSK-010 residual — the trust floor | n/a | **Zero** unrecovered. If non-zero: did a safety net catch it? | Self-assessment; the removed view (REQ-062) is the evidence | Continuous; reported at Checkpoint 1 |
| **M7** | "Am I still re-capturing my lists, or have I stopped?" | SUC-001 leading indicator | n/a | Still re-capturing at least one service | Visible in-app from REQ-039's per-service last-updated dates — **no instrumentation needed** | Checkpoint 1 |
| **M8** | "Am I still using it?" | SUC-004 | n/a | Yes | Self-assessment | Checkpoint 2 |
| **M9** *(rebased by A41, set by A40, **band widened by A43**)* | Azure monthly cost | NFR-012 / OBJ-6 | $0 today | **≈$11–14/month**, or **≈$15–18/month once the pre-authorised memory remedy has been taken (A43)**. No longer "is it near zero" nor even "is it still worth it" — the owner has **seen a per-component table and chosen a figure**, so the metric is now simply *does the bill match whichever estimate is currently live*. A step to ≈$15–18 is **expected and approved** if it follows a real memory failure; unexplained drift is not. ⚠ Every line is an unverified list price (±30 %, **RSK-029**); **TASK-010** re-verifies and **TASK-142** sets a budget alert at 1.5× | Azure portal cost view | Monthly from first deployment |

**M5 and M7 are the early-warning pair.** The product does not fail
suddenly. It fails when re-capturing becomes a chore, the list quietly
goes stale, and the owner drifts back to opening the apps. M7 is free
(REQ-039 already surfaces it) and will show that drift weeks before M1
does.

### Kill / pivot criterion — stated deliberately

> **If M5 is "no" at Checkpoint 1, nextup has an ergonomics failure that
> no further feature work fixes.** The correct response is to reduce
> ingestion cost — not to add capability.

---

## 8. Cost and effort

The two costs that matter for this project are **money** (which must be
near zero and is a hard MUST) and **the owner's time** (which is the
real currency and the most likely cause of failure). Conventional
build-cost estimation does not apply: implementation is performed by an
autonomous coding agent (ASM-028), so **human implementation effort is
approximately zero by design**, and the binding ceiling is the owner's
*review* capacity (RSK-017), not developer throughput.

| Item | Estimate | Confidence | Source |
|---|---|---|---|
| Human implementation effort | **~0 hours** — code written by GitHub Copilot in autopilot mode; owner's effort goes into review and direction | High (user-stated) | ASM-028, NFR-002/003/004; A19 |
| Owner review effort during build | **The real build cost.** `TBD — needs input`; bounded only by backlog discipline (small, independently verifiable units judged by *using* the app, not reading diffs) | Low — unestimated | RSK-017; `mvp-definition.md` §12 |
| Calendar time to MVP | **Not applicable — no timeline exists** (A19 / ASM-027). No milestones or deadlines are asserted anywhere in this document | n/a | A19 |
| Monthly running cost — everything except extraction | **$0–$5/month.** Static web hosting, a consumption compute tier, a small database and blob storage all sit at or near $0 at single-user volume | Medium | `mvp-definition.md` §12; NFR-012 |
| **Monthly running cost — the pre-authorised memory step** *(new — A43)* | **+~$4/month, taking the system total from ≈$11–14 to ≈$15–18.** Not a contingency to be argued for later: the owner has **already approved it**, and it is spent **only** when a real out-of-memory failure occurs. Until then it is not spent at all | Medium — same unverified list prices, ±30 % (**RSK-029**) | **A43 / OQ-028**; `runbooks/scale-up-memory.md`; ADR-0003 Rev 4 |
| Monthly running cost — TMDB | **$0.** Free for personal non-commercial use; ~40 req/s ceiling, vastly over-provisioned for a few hundred titles | High (verified primary source) | `research-summary.md` (OQ-004) |
| Monthly running cost — vision/OCR inference | **RESOLVED — ~$0.50–$0.70/month** (~$1.40–$2.10 in a bulk-import month). Hybrid extractor: Azure OpenAI `gpt-4.1` vision primary + free-tier `Read` OCR cross-check. *(This row read "UNPRICED" when the BRD was written; priced in phase 7 and re-decided after the **A40** constraint change.)* | Medium — Azure list prices, unverified against live pages; TASK-010 re-verifies | ADR-0001 Rev 2, NFR-012a |
| **First cost cliff** *(superseded by A41)* | ~~Vision/OCR inference metering~~ — **no longer the cliff, and there is no cliff.** A41 relaxed NFR-012 system-wide, so cost gates nothing. Extraction (~$0.47/mo) is now one of the *cheapest* lines; the largest are the database (~$5, Azure SQL Basic) and always-on hosting (~$5–8), both chosen deliberately for reliability. *(Figures updated at A40/Variant A; they read ~$15 and ~$9–12 under the PostgreSQL design.)* ⚠ The live constraint is the opposite of the original one — an implementer MUST NOT downgrade quality to save money | — | **A41**; RSK-012 **closed** |

### 8.1 The cost-benefit framing that actually applies

> **Benefit = friction removed from the value loop − friction added by
> the feeder loop.**

- **Value loop** (why the product exists): sit down → open nextup →
  filter one combined list → pick → open that service. Cheap to build,
  and the entire payoff. Removes the serial app-hop.
- **Feeder loop** (the price of admission): notice a list changed → pick
  service + mode → **paste or upload the screenshots** → review → confirm. It carries
  ~80% of the requirement set, 100% of the destructive behaviour and
  100% of the cost risk.

> **A45 — how much the paste path actually buys.** The owner's stated
> capture habit is *"take a screen grab and paste it into the app directly"*,
> and clipboard paste is now the primary ingestion interaction (PRD US-004
> AC-12 … AC-17). The saving is real but **small and confined to the capture
> step — roughly one tap per image**, and only when the owner catches iOS's
> transient "Copy" prompt; otherwise the screenshot is in Photos and the
> upload path carries it, unchanged and fully supported. **It does not touch
> the review pass, which is where the feeder loop's cost actually sits.** So
> **M5 and its kill criterion are unchanged by A45**, and no objective target
> moves. Anyone reading paste as the answer to the abandonment risk
> (RSK-011 / OQ-011) is reading it wrong.

The project is worth it **if and only if** the feeder loop stays cheaper
than the app-hopping it replaces. That is not an assumption this
document makes — it is the premise M1 and M5 exist to test, and the kill
criterion in §7 is the pre-committed response to it failing.

### 8.2 ~~The one open commercial/technical risk~~ — RESOLVED, AND THE CONSTRAINT ITSELF CHANGED

> **⚠ This section was written before phase 7 and before the A40 constraint
> change. Its reasoning is retained, but its conclusion and its fallback are
> both superseded. Read this box, not the text below it.**

**Resolved twice over.** Phase 7 priced every candidate extractor under
$1/month, so NFR-012 was never actually breached. Then, at **A40**, the user
relaxed the constraint directly: *"for vision/ocr, some cost is okay, near
zero is not required. but it should be as low as reasoanable without
degrading quality."*

That carve-out is now **NFR-012a**. Extraction is exempt from near-zero cost;
**quality outranks cost for that component**, and choosing a cheaper,
lower-quality extractor is explicit non-compliance.

**The manual-entry fallback product is RETIRED.** It is no longer a
contingency, and no future reader should treat extraction cost as a live
threat to the cut line.

The final decision (ADR-0001 Revision 2) is a **hybrid**: an Azure OpenAI
`gpt-4.1` vision primary with a free-tier `Read` OCR cross-check on every
image, at ~$0.50–$0.70/month. It changed on **capability, not cost** — a
multimodal model can identify a work from box artwork with no legible text,
which OCR categorically cannot, and that retired **RSK-021**, the largest
residual product risk in the architecture.

*Superseded original text follows.*

**OQ-005 is unpriced and is not assumed to be cheap.** Two facts already
in the record make the cheap end genuinely credible and should be stated
loudly to Phase 7 so it does not over-reach: the A15 correction removed
photographed-screen robustness entirely (input is pixel-perfect), and
A16 removed the need for high-confidence autonomous extraction (the
owner reviews everything). **Plain OCR is therefore a legitimate
candidate, not a compromise.**

If Phase 7 finds **no** extraction option meeting NFR-012 at realistic
volume, the **named fallback is manual title entry with TMDB search**.
That is a *different feeder loop* and a materially different product —
it would change the cut line, and it must be surfaced as such rather
than absorbed silently.

### 8.3 TMDB — binding obligations, not preferences

| Obligation | Requirement | Nature |
|---|---|---|
| Free for personal, **non-commercial** use only; commercial use requires a separate written agreement | — (constrains the whole project) | Contractual. **Any commercialisation of nextup voids the terms this cost model rests on.** |
| **Mandatory attribution** — TMDB logo plus the verbatim TMDB-mandated disclaimer, on any view presenting TMDB-sourced metadata | **NFR-013** | **Compliance.** Non-display is a terms breach, is invisible from inside the app, and must be verified by inspection at the Phase 11 review |
| **Maximum 6-month cache** of TMDB-sourced content | **NFR-014**, satisfied by **REQ-076** lazy refresh-on-access | Data-retention constraint. Resolved against REQ-041 by D6/A37 — *both parts of that amendment had to land together or the requirement set stays contradictory* |
| ~40 requests/second rate ceiling | — | Not a constraint at this volume |

---

## 9. Risks

| # | Risk | Category | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|---|
| **RSK-011 / OQ-011** | The review pass ships **correct** and is still too slow to live with; full-update re-presents every already-known title (tension 10), so the bulk cost recurs, not just at first import | adoption | Medium | **Critical — described in the record as the single most likely cause of abandonment** | No requirement sets an interaction-cost target. Make a stated review-ergonomics target a hard entry condition for Phase 8; measure as **M5**; REQ-011 hides known items in append-only, REQ-057 de-emphasises pre-confirmed rows | Owner (spec-writer, Phase 8) |
| ~~**RSK-012 / OQ-005**~~ **CLOSED** | ~~Vision/OCR inference cost breaches NFR-012~~ | financial | — | **None — the constraint was withdrawn** | **Closed twice: phase 7 priced every option under $1/month, then A40 carved extraction out of NFR-012 entirely (NFR-012a). The manual-entry fallback is retired.** Actual: ~$0.50–$0.70/month (ADR-0001 Rev 2). Still worth measuring as **M9**, now as hygiene rather than as risk control | — |
| **RSK-028** *(new, A40/Rev 2)* | The multimodal primary extractor **fabricates** a plausible title that the owner accepts on review | operational | Medium | Medium | The honest price of choosing a vision model. Engineered against rather than accepted: the free-tier OCR leg cross-checks **every** image, an unsupported model title is marked `inferred-unverified` and shown beside its cropped tile thumbnail, and any OCR line the model missed surfaces as an orphan — making silent omission structurally impossible | Owner |
| **RSK-016** *(BRD register — **agent-code correctness**)* | Agent-generated code passes stated criteria while being subtly wrong at the edges; no developer in the loop | operational | High | High | NFR-003 automated verification, tight acceptance criteria, repo-level `copilot-instructions.md` encoding the architecture | Owner |
| **Compute memory / OOM at 0.5 GiB** *(new — A43 / OQ-028; **`architecture.md` calls this `RSK-016`** — ⚠ **not the same `RSK-016` as the row above; the two registers were numbered independently and collide on that ID. Always name the register when citing it.**)* | An upload dies on a memory limit at the as-designed 0.25 vCPU / 0.5 GiB — a very high-resolution image refused by the pre-decode guard, or a genuine out-of-memory condition during HEIC transcode | operational / financial | Medium | **Contained — and, critically, ACCEPTED BY THE OWNER.** Presented with the priced remedy and **told plainly that the failure could land mid-import**, the owner answered verbatim: **"Start at 0.5 GiB, up-size only if it OOMs."** (**A43**; **OQ-028 CLOSED, residual accepted**). No data can be lost: a batch is applied in one transaction, and one bad image never fails the rest. Business consequence is a re-attach, plus one disclosed limitation — **~48 MP camera captures are refused** (PRD §7.8 KL-1) | **The remedy is documented and PRE-AUTHORISED: no further owner approval is needed, and it is not to be spent pre-emptively.** Up-size to 0.5 vCPU / 1.0 GiB, **+~$4/month → ≈$15–18/month**, one command — `artifacts/runbooks/scale-up-memory.md`. Acceptance is **conditional** on five mitigations shipping (pixel guard, one-image blast radius, a self-explaining error, the runbook, an OOM alert so the trigger is observed rather than inferred): PRD US-004 AC-9/AC-10/AC-11 | Owner |
| **RSK-017** | Owner review capacity is the true bottleneck and scales badly — oversized tasks silently become unreviewed ones | operational | High | High | Small, independently verifiable backlog units with observable end-user behaviour, so acceptance is judged by *using* the app | Owner (backlog-planner, Phase 9) |
| **RSK-018** | Integration-level failure: extraction, matching, reconciliation and review each pass their own tests while upload→list does not work | technical | High | High | An end-to-end upload→list acceptance test as a **first-class backlog item**, not an afterthought | Owner (Phase 9) |
| **RSK-019** | Under ASM-029, artifact imprecision is a **build** defect, not a documentation defect, and surfaces late as wrong software | operational | Medium | High | Phase 11 artifact review is **mandatory**, not optional | Owner (Phase 11) |
| **RSK-009** | Extraction accuracy on stylised fonts, art-only tiles, truncated titles | technical | Medium | Medium — reduced to a nuisance, not eliminated | Full owner review (REQ-013/016/017); the A16 trade made deliberately. Feeds M5 | Owner |
| **RSK-013** | Wrong TMDB match **merges two distinct works into one row** (identity *is* the match, ASM-031) | technical | Medium | Medium | REQ-018 legible match cards (name, year, type, poster); REQ-066 fix-match without removal. Residual: owner must *notice* | Owner |
| **RSK-020 / OQ-015** | Unmatched titles have no canonical identity, so they cannot dedup (REQ-024) **and cannot be reliably suppressed** (REQ-071) — a dismissed unmatched title may be silently re-created | technical | Medium | Medium | REQ-012 sets the floor (never silently discard). D8 caps v1: fallback normalised-title identity + a visible unmatched bucket reusing REQ-066's search. **The fallback identity and the suppression key are ONE decision, not two** | Owner (Phase 8) |
| **RSK-007 residual** | The owner simply stops re-capturing; the list quietly goes stale | adoption | Medium | High (directly attacks SUC-001) | REQ-039/040 make staleness **visible**; they cannot make it not happen. **M7** is the early-warning metric | Owner |
| **RSK-014** | Screenshots incidentally capture profile names or account email; HEIC camera uploads additionally carry EXIF device model and **GPS** | compliance | Low | Low | NFR-011/NFR-020 owner-only authenticated access; NFR-019 30-day automatic purge bounds exposure to a fixed period; **EXIF/GPS stripped on ingest** (A42, PRD US-004 AC-8) removes device/location metadata before storage. **⚠ A45: the paste route arrives EXIF-free for free (WebKit strips it on clipboard read), but that covers only one of the two ingestion routes — the explicit server-side strip remains mandatory for the file-upload route** (PRD US-004 AC-17) | Owner |
| **RSK-004 residual** | Streaming apps change their saved-list screen layout, degrading extraction accuracy | technical | Medium | Low | Degrades gradually rather than breaking outright; recoverable by owner correction at review. **No unofficial endpoints to maintain** | Owner |
| **TMDB attribution omission** *(compliance dimension of NFR-013)* | Attribution silently absent from a view → terms breach that is invisible from inside the app | compliance | Low | Medium | Explicit inspection item at the Phase 11 review; treat NFR-013 as testable, not decorative | Owner |
| **The premise itself** | A two-service combined list may simply not be worth the capture effort | adoption | Unknown | Existential | **This is the premise the MVP exists to test.** M1 + M2 are that test; the §7 kill criterion is the pre-committed response | Owner |
| **RSK-001** | *Closed as a finding, not a risk* — credentialed sync proven non-viable | technical | **Realised** | Reshaped the product (A14 loop-back) | REQ-049/050, NFR-009/010 keep the dead mechanism dead. **Recorded in §3.1 so it is not reopened** | — |
| **RSK-002/003/006/008/010/015** | ToS violation · credential store · unattended MFA · home-PC dependency · capture completeness · photo preprocessing | — | **Closed** | — | Eliminated by construction, not mitigated — A14/ASM-016 removed all automated access and credentials; A15-correction removed photographed screens; A17/A18/A23 made incomplete capture visible and recoverable | — |

Categories used: technical · adoption · compliance · operational ·
financial. **Market risk is not applicable — there is no market.**

---

## 10. Assumptions

55 assumptions are on record in `Context/assumptions.md`. After A42
falsified ASM-034, **A44 confirmed ASM-035 as a user-stated fact**, and
**A46 retired ASM-038** (the list-staleness-nudge concept the owner
dropped entirely), **zero agent-sourced assumptions remain active**.
Listed below: every agent-sourced assumption of note (including the
falsified ASM-034, the retired ASM-038, and the now-confirmed
ASM-035), plus the user-stated ones that carry business consequence.

| ID | Assumption | Confidence | Invalidated if… |
|---|---|---|---|
| ~~**ASM-034**~~ **FALSIFIED — superseded by ASM-058** | ~~Accepted upload formats are PNG and JPEG only~~ → Accepts **PNG *and* JPEG *and* HEIC/HEIF**; HEIC/HEIF transcoded to PNG on ingest, EXIF/GPS stripped | **Was Medium, agent-derived, unconfirmed → falsified.** The owner stated "iOS screenshots save as heic"; the phone is the primary capture device, so as originally specified the app would have **rejected the owner's own images on first use** | **Realised.** ASM-058 supersedes it (accept all three formats, transcode on ingest) |
| ~~**ASM-035**~~ **CONFIRMED — user-stated fact at A44 (2026-08-11)** | ~~Assumed~~ Confirmed: default ordering is date-added, most recent first ("Newest-first — conventional, recent saves on top") | **High — user-stated (A44), no longer an assumption.** This is the only agent-derived inference to survive owner confirmation (1 of 6 tested; the other five — A15, ASM-047, ASM-034, ASM-012/013, ASM-038 — were all falsified or retired) | — no longer invalidatable as an assumption; see **R-14** (PRD.md) for the accepted trade-off this default creates against SUC-003 |
| ~~**ASM-038**~~ **RETIRED at A46 (2026-08-11)** | ~~A service is "stale" after 30 days without a completed upload~~ → the list-staleness-nudge concept is **dropped entirely**: no threshold, no nag, no derived "stale" state | **Retired, not confirmed or falsified as a value — the owner rejected the concept itself.** Counted as falsified for scorecard purposes | **Realised.** Owner, verbatim: "Drop the concept entirely — no staleness nudge." REQ-040 retired; REQ-039 (the factual date display) is untouched |
| ASM-012 / ASM-013 *(wording narrowed by **A45** — substance unchanged)* | **Owner-supplied screen captures** → OCR/vision → TMDB match → dedup is the ingestion mechanism. ⚠ The original wording said "screenshot **upload**"; after A45 a capture enters by **clipboard paste (primary) or file upload**, so "upload" alone is now too narrow. The substance is unchanged — captures come from the owner, nothing is retrieved automatically (NFR-009, NFR-010) | High (user, A14) | Extraction proves unusable or unaffordable (→ manual-entry fallback, §8.2) |
| ASM-016 | ToS posture is clean: screenshotting a screen you are licensed to view, for personal use, involves no automated access | High (user + research) | A provider's terms change to bar personal screenshotting |
| ASM-019 / ASM-020 | Full batch review is the **normal** path; volume is front-loaded (large first import, small top-ups) — **but only in `append-only` mode**; full-update re-presents everything | High | M5 says the review is intolerable → §7 kill criterion |
| ASM-027 | No timeline, no deadline. Scope need not be trimmed for schedule | High (user, A19) | The owner adopts a deadline |
| **ASM-028 / ASM-029** | Implementation is by GitHub Copilot in autopilot; **the artifacts ARE the implementation input**, so an unstated behaviour is not deferred — it is chosen arbitrarily by the implementer | High (user, A19) | The owner starts hand-writing code — which would change what "cost" and "cut" mean throughout this document |
| ASM-030 / ASM-031 | One row per canonical title via TMDB identity; **accurate matching is load-bearing, not a convenience** | High | TMDB matching proves too unreliable for dedup (→ RSK-013, OQ-015) |
| ASM-033 | Success is measured by owner self-assessment at a defined checkpoint. **Zero instrumentation** | High (user, A21) | The owner wants measured evidence — which NFR-005/REQ-052 currently forbid |
| ASM-046 / ASM-051 | Soft delete forever, no purge ever; a reappearing title is a **brand-new row dated today**, and the removed view is a **historical log, not a recycle bin** | High (user, A29/A33) | — **ASM-047 assumed the opposite and was falsified at A33.** REQ-065 was rewritten |
| ASM-052 | "Not interested" suppression is keyed on **canonical work identity**, not on the row | High (user, A34) | OQ-015's fallback identity proves unstable → suppression silently bypassed for unmatched titles (RSK-020) |
| ASM-053 | Screenshots retained 30 days then automatically purged; authenticated owner access only | High (user, A35) | — |
| ASM-054 | v1 batch undo is creates-only; mixed batches refused **with an enumeration of what they touched** | High (user, A36) | **REQ-059 is reinstated** — that forces D3 and OQ-023 to be revisited |
| ASM-055 | TMDB metadata refreshed lazily on access; no background job | High (user, A37) | — |

> **A note the record insists on:** **six** agent-derived inferences
> have now been put to the user and **five of the six were wrong** —
> the phone-photo-of-TV inference (A15), the reappearance-transitions-back
> inference (A33 / ASM-047), the **PNG/JPEG-only upload-format
> inference (ASM-034 / A42)**, which would have rejected the owner's own
> HEIC phone screenshots on first use had it not been caught, the
> **file-upload-only ingestion inference (ASM-012/013, narrowed at A45)**,
> where the owner stated their actual habit is to **paste a screen grab
> straight in**, and the **list-staleness-nudge inference (ASM-038,
> retired at A46)**, which the owner rejected outright — *"Drop the
> concept entirely — no staleness nudge."* Note the shape of the first
> two format/transport corrections: **both were fixed by ADDING the
> missing path, not by swapping the existing one out** — HEIC alongside
> PNG/JPEG, paste alongside upload. Deleting the incumbent path would
> have broken the laptop and iOS-Photos routes. ASM-038, by contrast,
> was not amended — the whole concept was dropped, and REQ-040 with it.
> The **sixth** — **ASM-035, the default newest-first sort order —
> was CONFIRMED at A44**, the only agent-derived inference in this
> project to survive contact with the owner. **The final scorecard is
> 6 tested, 1 confirmed, 5 falsified. Zero agent-sourced assumptions
> remain active or unconfirmed.** The owner accepted ASM-035
> **knowingly**, having been told it works against SUC-003 (see
> **R-14** in `PRD.md`).

---

## 11. Dependencies

| # | Dependency | Type | Owner | Risk if unavailable |
|---|---|---|---|---|
| D-1 | **TMDB** — canonical title identity plus type, year, runtime, genre, poster | External API, free non-commercial | TMDB | **Existential for dedup.** Identity *is* the match (ASM-031); without it there is no one-row-per-title. Alternatives (OMDb, Watchmode, JustWatch) are thinner, commercial, or answer *availability* rather than *metadata* |
| D-2 | **Vision/OCR extraction service** | External, metered | **Azure OpenAI `gpt-4.1` vision + `Read` OCR cross-check, ~$0.50–$0.70/mo (ADR-0001 Rev 2)** | ~~The only unpriced component an~~d the only one that can breach NFR-012. Fallback: manual entry with TMDB search (§8.2) |
| D-3 | **External identity provider** | External | `TBD — OQ-019, Phase 7 ADR` | No sign-in. The requirement set is deliberately provider-agnostic (NFR-015/016/017 name no provider), so nothing downstream is blocked |
| D-4 | **Azure free-tier / consumption services** | Platform | Microsoft | NFR-012 is the constraint, not the provider. Tier changes are the exposure |
| D-5 | **GitHub Copilot coding agent** | Delivery | GitHub | v1 does not get built — human implementation budget is ~zero (ASM-028) |
| D-6 *(new — A42)* | **HEIC/HEIF decode library** (`heic-convert` → `libheif-js`; optionally `sharp`) | Open-source dependency | catdad-experiments / libvips | Required to accept the owner's iPhone HEIC uploads — neither extraction service accepts HEIC, so ingest transcodes HEIC→PNG server-side. **Licence footprint ends at LGPL-3.0** (`libheif-js`, decode-only; wrappers ISC). Compatible with this MIT project **provided the LGPL-3.0 notice is retained** in NOTICE/THIRD-PARTY and the library is used unmodified; flagged for a human licence sign-off. Pure JS/WASM — no native container build |
| D-6 | **The owner's continued screenshotting habit** | Human | Owner | **The product stops working.** Nothing in v1 proves this habit will hold; M5 + M7 together are the read on it |
| D-7 | Netflix / Max saved-list screens remaining visually stable | External, passive | Providers | Gradual extraction degradation, recoverable by owner correction (RSK-004 residual). **nextup makes no request to either service** (NFR-010) |

---

## 12. Constraints

| Constraint | Value | Impact on scope |
|---|---|---|
| **Timeline** | **None** (A19 / ASM-027) | Deliberately **not** used as a cutting argument. The cut line is argued on agent error rate and feedback-loop latency, not schedule. **No milestones or deadlines appear in this document** |
| **Budget** *(rewritten — A40, A41; **band widened — A43**)* | ~~Near-zero; free-tier or consumption only; no fixed monthly commitment (hard MUST)~~ **All three clauses repealed.** A41 made NFR-012 a `should` — as low as reasonable **without degrading quality** — and A40 settled it at an owner-selected **≈$11–14/month**. **A43 adds one pre-approved variable: +~$4/month → ≈$15–18/month, spendable without further approval, but only in response to a real memory failure** | The original wording ruled out always-on tiers and fixed-fee services; **both are now deliberately in the design** (always-warm compute, a fixed-price relational database) because each buys a named reliability property. What still binds is **right-sizing**: one user, no HA, no replica, no multi-region, no autoscaling — **and the memory step is reactive, not pre-emptive**. ~~OQ-005~~, ~~OQ-026~~ and ~~OQ-028~~ all closed |
| **Team** | **One person, who does not write the code.** Implementation by autonomous agent (ASM-028); owner effort is review and direction | Inverts the normal cost of a cut: under ASM-029, cutting a requirement on a code path the MVP must touch anyway does not remove the behaviour — it makes the implementer choose it arbitrarily and silently. Real ceiling is **RSK-017 review capacity** |
| **Platform** | Responsive web, **mobile-first**; 320px and 1024px viewport floors (NFR-006, NFR-007); Azure-hosted | No native apps (REQ-046), no TV browser or D-pad navigation (REQ-045) |
| **Compliance** | **No streaming credentials, ever** (NFR-009). **No automated request to any streaming service** (NFR-010). TMDB attribution mandatory (NFR-013) and 6-month cache ceiling (NFR-014). Non-commercial use only | ToS exposure eliminated **by construction** rather than mitigated. REQ-058 additionally removes the last vision capability that could misattribute a screenshot. **No regulated data enters scope** |
| **Privacy** | No telemetry or analytics (NFR-005). Screenshots are personal data: owner-scoped (NFR-011), authenticated bytes only (NFR-020), purged at 30 days (NFR-019), **and stripped of EXIF/GPS on ingest** — an explicit commitment that matters now HEIC uploads are accepted, since a camera HEIC carries device model and GPS (A42; PRD US-004 AC-8) | Success measurement must be self-assessment (§7). Also protects the near-zero-cost posture |
| **Users** | Single owner in v1 (ASM-001, REQ-047). Federated sign-in, allow-list, no registration surface (NFR-015/016/017) | Multi-account is a **non-preclusion** constraint only (NFR-001, NFR-008) — an allow-list of identities, not an account system |
| **Services** | Netflix + Max in v1; seven more post-MVP (REQ-048) | The cheapest constraint in the set — nothing is service-specific. v1 ships exactly two configured services so the "add a service" path is not built speculatively |

---

## 13. Open questions

Mirrored from `Context/open-questions.md` (9 open). **None blocks this
BRD.** Two block implementation.

| ID | Question | Blocks | Severity if unanswered |
|---|---|---|---|
| **OQ-005** | Which vision/OCR approach, and what does it cost per upload at realistic volume? | **Implementation.** Phase 7 architecture + an ADR. **The only component that can violate NFR-012** — a hard MUST | **High.** Unbounded per-upload cost silently breaches the budget constraint. Named fallback: manual entry with TMDB search, which is a **different feeder loop and a different cut line** |
| **OQ-015** | Behaviour when a title cannot be matched to TMDB — fallback identity, unmatched bucket, merge/split, or accept duplicates? | **Implementation.** Phase 8 specs; REQ-012 completion; **REQ-071 suppression reliability** | **High.** An unmatched title cannot dedup **and cannot be reliably suppressed** — a dismissed title may be silently re-created. **Binding: the fallback identity and the suppression key are ONE decision** |
| **OQ-011** | How fast must bulk review be to stay tolerable, per item, both for new and for pre-confirmed items? | Not strictly blocking — but it is the only question that can cause the MVP to be **built correctly and still fail** | **Medium-High.** RSK-011, the most likely cause of abandonment. Recommendation: make a stated review-ergonomics target a hard entry condition for Phase 8, and treat M5 as a first-class success metric |
| **OQ-013** | Within a full-update batch, how are overlapping screenshots deduplicated? | Phase 7/8 extraction spec | Medium. Not destructive — the owner would see and discard duplicates — but corrosive to exactly the interaction cost OQ-011 worries about |
| **OQ-014** | NFR sweep: performance, availability, accessibility, internationalization. *(Data retention half is CLOSED.)* | Completeness of the NFR set; Phase 11 review | Medium. Under ASM-029, silence means the coding agent decides. **Take an explicit stance — "not applicable" is a valid answer for availability and i18n at single-user scale; silence is not** |
| **OQ-022** | What further affordances does the removed view need, now that it holds multiple rows per work (A33)? | Phase 8 UX spec | Low, strengthened at A33. REQ-064's search + service filter is already a floor, so it cannot ship as an unfiltered flat list |
| **OQ-023** | How does batch undo interact with later owner edits? | **v1.1 only** — no longer blocks v1 (D3/A36) | Medium for v1.1. **Coupling: reinstating REQ-059 returns this to blocking** |
| **OQ-019** | Which external identity provider? | Phase 7 ADR | Low. The requirement set is provider-agnostic by construction |
| **OQ-016** | Confirm the success checkpoint timing | This BRD's §7 | **Closed here.** §7 fixes it at 30 days after the first completed import of **both** Netflix and Max, anchored on a populated list rather than on deployment |

*No new open questions were raised by this document.*

---

## Appendix A — Traceability

Objectives → requirements. User stories do not yet exist (Phase 6, PRD),
so that column records the intended story area instead.

| Objective | Requirements | User story area (Phase 6) |
|---|---|---|
| **OBJ-1** Combined view replaces app-hopping | REQ-024, REQ-025, REQ-026, REQ-031, NFR-006, NFR-007 | Browse the combined list |
| **OBJ-2** Trustworthy list | REQ-005, REQ-006, REQ-013, REQ-014, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023, REQ-027, REQ-028, REQ-041, REQ-055, REQ-056, REQ-057, REQ-058, REQ-062, REQ-063, REQ-064, REQ-065, REQ-066, REQ-067, REQ-068, REQ-075, NFR-018 | Review pass; removal & restore; batch undo |
| **OBJ-3** Faster decisions | REQ-031, REQ-032, REQ-033, REQ-034, REQ-036, REQ-038 | Filter and sort |
| **OBJ-4** Stop losing titles | REQ-028, REQ-030, REQ-036, REQ-060, REQ-061, REQ-062, REQ-063, REQ-064 | Removed view; date-added |
| **OBJ-5** Feeder loop stays cheap | REQ-001, REQ-002, REQ-003, REQ-004, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-016, REQ-018, REQ-039, REQ-057, REQ-070, REQ-071, REQ-072, REQ-073, REQ-074 | Upload & review; not-interested; re-extraction |
| **OBJ-6** ~~Near-zero cost~~ → **cost as low as reasonable without degrading quality; ≈$11–14/mo owner-selected** | NFR-012 *(a `should` since A41)*, NFR-012a | *(non-functional — verified by M9)* |
| **OBJ-7** Legally and contractually clean | REQ-049, REQ-050, REQ-051, REQ-054, REQ-076, NFR-009, NFR-010, NFR-013, NFR-014 | TMDB attribution surface |
| **OBJ-8** Agent-buildable | NFR-002, NFR-003, NFR-004 | *(delivery-model — verified by Phase 9/11)* |
| **OBJ-9** Private, single-owner | REQ-052, NFR-005, NFR-008, NFR-011, NFR-015, NFR-016, NFR-017, NFR-019, NFR-020 | Sign-in; screenshot handling |

### Success signal → metric → objective

| Signal | Metric | Objective |
|---|---|---|
| SUC-001 (primary) — stops opening apps to browse | M1, M2, M7 | OBJ-1, OBJ-2, OBJ-5 |
| SUC-002 — faster decisions | M3 | OBJ-3 |
| SUC-003 — titles stop getting lost | M4 | OBJ-4 |
| SUC-004 — still in use six months later | M8 | OBJ-1, OBJ-5 |
| *(cost constraint)* | M9 | OBJ-6 |
| *(trust floor)* | M6 | OBJ-2 |

### Requirements deliberately NOT traced to an objective

`REQ-035`, `REQ-037`, `REQ-059`, `REQ-069` — deferred to v1.1 (§6.2).
`REQ-042`–`REQ-054` — the 13 `wont-v1` exclusions (§6.3).
`NFR-001` — a forward-looking non-preclusion constraint, explicitly not
MVP scope.








