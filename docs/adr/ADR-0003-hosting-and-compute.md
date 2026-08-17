# ADR-0003 — Hosting and compute: one Azure Container App on the Consumption plan

> ## ⚠ REVISION 4 — 2026-08-11T10:50 — `OQ-028` closed: **compute STAYS at 0.25 vCPU / 0.5 GiB; 1.0 GiB becomes the pre-authorised reactive remedy**
>
> **Revisions 3, 2 and 1 are retained verbatim below.** Revision 3
> reintroduced OOM risk by dropping to 0.5 GiB on the owner's cost
> preference, and Revision 5 of `architecture.md` (the HEIC transcode)
> made that risk materially larger. The priced remedy was **surfaced to
> the owner and deliberately not decided by this ADR**. The owner has now
> decided it, verbatim:
>
> > **"Start at 0.5 GiB, up-size only if it OOMs."** — `A43`
>
> ### R4.1 The sizing decision — **CORRECTED IN PLACE, because it is an instruction**
>
> This is the value a machine provisions from. It is stated here as the
> single live instruction, with the superseded framing struck through
> beneath it, per the F-001 rule:
>
> | Parameter | **LIVE VALUE (R4, `A43`)** |
> |---|---|
> | `cpu` (Bicep) | **`json('0.25')`** |
> | `memory` (Bicep) | **`'0.5Gi'`** |
> | `minReplicas` | **`1`** (unchanged, non-negotiable) |
> | `NEXTUP_MAX_DECODE_PIXELS` | **`25000000`** — the pre-decode guard, **new at R4**, and **not optional** |
> | `T-INFRA-005` asserts | **`0.25` / `0.5Gi` / `25000000`** |
>
> ~~*Superseded framing (R5 of `architecture.md`): "0.5 GiB is the
> as-designed size and 1.0 GiB is a priced option surfaced for the owner,
> not decided."*~~ — **the owner decided; the decision is "start small,
> up-size reactively", and 1.0 GiB is now a documented remedy rather than
> an open question.**
>
> **The remedy values, for when the trigger fires** (procedure:
> `artifacts/runbooks/scale-up-memory.md`, `A43-M4`):
>
> | Parameter | **REMEDY VALUE (apply only on a real OOM)** |
> |---|---|
> | `cpu` (Bicep) | `json('0.5')` |
> | `memory` (Bicep) | `'1.0Gi'` |
> | `NEXTUP_MAX_DECODE_PIXELS` | `50000000` |
> | Cost | **+~$4/month** — compute ~$5–8 → ~$9–12; system total ~$11–13 → **~$15–18** (unverified ±30 %, `RSK-029`) |
>
> **`0.5 vCPU / 1.0 GiB` is the KNOWN REMEDY, not a rejected
> alternative.** Every place in this ADR (including Revision 3's R3.2 and
> the Revision 2 comparison table) where 1.0 GiB reads as "the option we
> gave up" must now be read as "the option we have pre-authorised and
> documented, and will take the moment it is needed". The owner does not
> need to be asked again.
>
> ### R4.2 Why this is a defensible decision and not a deferral of thinking
>
> The owner was **explicitly told the failure could land mid-import**, and
> accepted that. That is what makes this an *accepted residual risk*
> rather than an unexamined one. The reasoning that supports it:
>
> - **The expected case fits with room.** A typical iPhone capture
>   (12–15 MP) peaks around 100 MB against a ~150–200 MB Node baseline in
>   a 512 MiB container. The failure needs a *pathological but legal*
>   40–48 MP file.
> - **Paying $48/year for a failure that may never occur is worse value
>   than paying $0 and having a one-command fix.** With one user and a
>   front-loaded import, the population of images is small and knowable.
> - **The failure is now bounded and self-explaining** (R4.3), which is
>   what removes `RSK-016`'s actual sting. The complaint was never "it
>   OOMs", it was "an autonomous implementer cannot diagnose it".
> - **The reversal is minutes, with no data migration and no downtime.**
>   This is about as far from a one-way door as an infrastructure decision
>   gets.
>
> ### R4.3 The five mitigations are MANDATORY — they are the price of choosing "reactive"
>
> **A reactive strategy without these is an unmonitored bet, not a
> strategy.** They are acceptance criteria.
>
> | # | Mechanism | Detail |
> |---|---|---|
> | **A43-M1** | **Pre-decode dimension/pixel guard** | Reject `width × height > NEXTUP_MAX_DECODE_PIXELS`, or either dimension `> 16000` / `< 50`, **before allocating any decode buffer** — read from the HEIF `ispe` box / PNG IHDR / JPEG SOFn. **Retained at the owner's explicit instruction even though "mitigate and stay" was not the selected option: it is what makes the reactive option survivable.** The byte-size ceiling is *not* a substitute — HEIC compression ratio is variable and bytes do not predict raster size. Guard value **moves with container memory** (25 MP ⇄ 0.5 GiB, 50 MP ⇄ 1.0 GiB). Detail: ADR-0008 R2.1 |
> | **A43-M2** | **One-image blast radius** | Guard rejection, decode failure or OOM fails **that image only**. No partial commit, no batch corruption — guaranteed structurally by the one-transaction close, not by an error handler. Reconciled with `REQ-074` in `architecture.md` §Key flows and ADR-0008 R2.2 |
> | **A43-M3** | **Self-explaining error** | Names memory/decode as the cause and cites `runbooks/scale-up-memory.md`. **No blind debugging.** Exact text: ADR-0008 R2.3 |
> | **A43-M4** | **The runbook** | `artifacts/runbooks/scale-up-memory.md` — exact `az` command, exact `infra/aca.bicep` change, confirmation, cost delta, rollback. One step, executable by someone who is not thinking clearly |
> | **A43-M5** | **OOM/restart alert** | So the trigger is **observed, not inferred**. ⚠ **Azure Container Apps does not surface OOM-kill as a distinct signal** (no `OOMKilled` metric, no termination-reason dimension) — the design uses replica-restart count, memory-working-set pressure, system/console logs, and an **application-emitted decode begin/end sentinel that names the failing image**. Full design, confidence and the verification owed: `architecture.md` §Observability → *Knowing that it OOMed* |
>
> **Retained from R3.2 and still required:** strictly serial image
> processing (concurrency = 1), the per-image byte ceiling enforced before
> base64 expansion, and buffers released between images. The guard is
> **in addition to** these, not instead of them.
>
> ### R4.4 What did NOT change at R4
>
> `minReplicas = 1`; the registry (ghcr.io); the staging environment; one
> deployable; no scheduler; no VNet/WAF/HA/multi-region/autoscaling; and
> the R3.5 cost table below (~$5.5–8.5/month for this ADR's scope) — which
> becomes **~$9.5–12.5** if and only if the remedy is taken.
>
> ### R4.5 Consequences, including the bad ones
>
> - **An import can still die mid-run**, on a pathological image, before
>   anyone has up-sized. That is the accepted risk, in the owner's own
>   words. What is *not* accepted is it dying silently or opaquely.
> - **48 MP iPhone Pro captures are refused at 0.5 GiB** by the guard.
>   They fail cleanly with a named reason and a remedy — but they *do*
>   fail, and that is a real user-visible limitation, not a theoretical
>   one. Taking the remedy accepts them.
> - **Two values must move together forever** (memory and the guard).
>   A future editor changing one and not the other creates either a
>   pointless refusal or an unguarded crash. The runbook changes both in
>   one command; `T-INFRA-005` should assert the pair.
> - **The alert will fire on ordinary deploys** (any restart trips S2).
>   At one deploy per session that noise is cheap; a quieter rule would
>   risk missing the real event.

> ## ⚠ REVISION 3 — 2026-08-10T22:40 — the owner selected Variant A: **registry → ghcr.io, compute → 0.25 vCPU / 0.5 GiB**
>
> **Revisions 2 and 1 are retained verbatim below.** This revision applies
> two of the three Variant A changes the owner selected at `A40` ("2")
> after reacting to the Revision 2 cost table (the third — Azure SQL Basic
> — is ADR-0005 Revision 3). Both changes here **reverse a Revision 2
> decision back toward its Revision 1 position**, now on the owner's
> explicit cost preference rather than on a repealed constraint.
>
> | Sub-decision | Rev 1 | Rev 2 | **Rev 3** | Why Rev 3 |
> |---|---|---|---|---|
> | Registry | ghcr.io | ACR Basic | **ghcr.io again** | Owner took the ~$5 back. The PAT-expiry time bomb returns — named, not hidden. |
> | Container size | 0.25 / 0.5 | 0.5 / 1.0 GiB | **0.25 vCPU / 0.5 GiB again** | Owner took the ~$4 back. Reintroduces OOM risk during extraction bursts (`RSK-016`) — mitigated by serial image processing. **↳ R4/`A43`: CONFIRMED as the as-designed size after the owner saw the priced OOM risk; 1.0 GiB is now the pre-authorised reactive remedy, plus a mandatory pre-decode pixel guard.** |
> | `minReplicas` | 0 | **1 (always warm)** | **1 — UNCHANGED** | Non-negotiable in the owner's selection. `RSK-023` stays closed. |
> | Staging environment | none | exists | **exists — UNCHANGED** | Retained; its cost shape changes slightly (Azure SQL bills per database) — see R3.3. `RSK-025` stays Low. |
>
> ### R3.1 Registry: ACR Basic → **ghcr.io**. **DECISION REVERSED (to Rev 1), on owner cost preference.**
>
> Revision 2 moved to ACR to delete a secret and a PAT-expiry time bomb,
> at ~$5/month, and argued it was the most-documented ACA pull path. The
> owner has chosen to take that $5 back. The consequence is exactly what
> Revision 2 warned about and must be stated plainly, not softened:
>
> - **The ghcr.io pull credential (a PAT) returns.** It is a secret, and
>   **it expires quietly.** When it does — months later — a deployment
>   fails for a reason unrelated to the change being deployed, to an owner
>   with no operational budget and an autonomous implementer with no
>   memory of setting it up. This is the worst failure shape in the
>   project, knowingly reaccepted to save ~$5/month.
> - **Mitigations that do not cost money:** (a) create the PAT with the
>   **longest permissible expiry** and record the expiry date in
>   `docs/runbook.md`; (b) `TASK-142`'s existing owner alerting is
>   extended with a **calendar reminder task** two weeks before expiry;
>   (c) the deploy workflow surfaces a **distinguishable auth-failure
>   message** ("registry auth failed — the ghcr PAT may have expired")
>   rather than a generic pull error, so the distant failure is at least
>   self-explaining when it lands. None of this removes the time bomb; it
>   only makes it louder.
> - Secret count under Variant A returns to **at least two** (TMDB key +
>   ghcr PAT), possibly three if the Azure SQL managed-identity path fails
>   in M0 (ADR-0005 R3.4).
>
> ### R3.2 Container size: 0.5 vCPU / 1.0 GiB → **0.25 vCPU / 0.5 GiB**. **DECISION REVERSED (to Rev 1), on owner cost preference.**
>
> Revision 2 sized up to 1.0 GiB specifically to give extraction bursts
> headroom, because an OOM kill mid-batch is an *undiagnosable* failure
> shape for an autonomous implementer (`RSK-016`). Dropping back to
> 0.5 GiB to save ~$4/month **reintroduces that OOM risk**, and this ADR
> does not pretend otherwise. The mitigation is a behavioural cap in the
> worker, not more memory:
>
> - **Process images strictly serially — concurrency = 1 image in flight
>   per batch** (Revision 2 allowed 2). A 10 MB image base64-encoded into
>   a request body, plus the Node heap and static serving, fits 0.5 GiB
>   only if one image is resident at a time.
> - **Enforce the per-image size ceiling *before* base64 expansion** and
>   stream to blob rather than buffering the whole batch.
> - **Release each image's buffers before fetching the next.**
> - `RSK-016` is updated to carry this OOM sub-risk and its serial-
>   processing mitigation. If a batch still OOMs, it is resumable by
>   design (deterministic ids), and up-sizing is a one-property Bicep
>   lever — but the throughput cost of serial processing is accepted as
>   cheaper than the ~$4 and the diagnosis risk of the larger size.
>
> **↳ R4 correction, in place (this is an instruction, not narrative):**
> `T-INFRA-005` asserts **`0.25 vCPU / 0.5 GiB` *and*
> `NEXTUP_MAX_DECODE_PIXELS=25000000`** — the pre-decode pixel guard added
> at R4 is part of the pinned configuration, and the two values must
> always move together. The up-size lever is no longer merely "available":
> it is **pre-authorised and documented** in
> `artifacts/runbooks/scale-up-memory.md`.
>
> ~~`T-INFRA-005` (SKU pinning) is updated to assert `0.25 vCPU / 0.5 GiB`,
> not `0.5 / 1.0`.~~ *(R3 text, superseded by the R4 line above — the
> assertion now also covers the guard value.)*
>
> ### R3.3 Staging survives — but Azure SQL bills per database
>
> The staging environment (ADR-0003 R2.4) is retained and `RSK-025` stays
> **Low**. One honest cost correction: under PostgreSQL, staging was a
> second *database on the same server* at ≈$0. **Azure SQL Database bills
> per database**, so a second always-on Basic database would add ~$5 —
> which would blow the Variant A budget. Staging is therefore a
> **serverless Azure SQL database with auto-pause enabled** (auto-pause is
> fine for staging — nobody judges its cold start, exactly as staging runs
> at `minReplicas = 0`). Cost when paused ≈ storage only ≈ **$0.10–0.50/
> month**. So the "≈$0 staging" property is *approximately* preserved, not
> literally: staging now costs ~$0.50 and uses a slightly different SKU
> (serverless vCore) than prod (Basic DTU). Stated, not hidden.
>
> ### R3.4 What did NOT change
>
> - **`minReplicas = 1` (always warm).** Non-negotiable in the owner's
>   selection; `RSK-023` stays closed. The value loop still has no cold
>   start.
> - **One deployable, no scheduler, no VNet/WAF/HA/multi-region/
>   autoscaling.** All unchanged from Revision 2.
> - **The staging environment exists** (R3.3).
>
> ### R3.5 Revised cost for this ADR's scope
>
> | Line | Rev 2 | **Rev 3** |
> |---|---|---|
> | Compute | ~$9–12 (0.5 / 1.0, always on) | **~$5–8** (0.25 / 0.5, always on) |
> | Registry | ~$5 (ACR Basic) | **$0** (ghcr.io) |
> | Staging DB delta | ~$0 (shared PG server) | **~$0.50** (serverless auto-paused Azure SQL) |
> | **Subtotal** | **~$14–17** | **~$5.5–8.5 / month** |
>
> **↳ R4:** this subtotal **stands as the as-designed figure**. If the
> `A43` remedy is taken it becomes **~$9.5–12.5/month** for this ADR's
> scope (compute ~$9–12), and the system total ~$15–18. Add ~$0.60–1.00
> for the `A43-M5` alert rules. All unverified ±30 % (`RSK-029`).
>
> ⚠ **Unverified model-knowledge figures (`RSK-029`).** `TASK-010`
> re-verifies ACA idle billing at 0.25 vCPU / 0.5 GiB and the serverless
> staging floor.

> ## ⚠ REVISION 2 — 2026-08-10T21:45 — three sub-decisions re-argued, **two changed**
>
> **What changed in the inputs.** Constraint change **A41 / CC-002**
> relaxed `NFR-012` **system-wide** from a hard MUST to a SHOULD, with
> **quality and reliability now outranking raw cost** (`ASM-057`
> supersedes `ASM-010`). Revision 1 of this ADR rejected three things
> *specifically because they were fixed monthly charges*. That premise
> is repealed, so each is re-argued below on its own merits.
>
> **Everything in Revision 1 below this block is retained verbatim.**
> Nothing has been deleted or edited. Where a Revision 1 sentence says
> "breaches NFR-012", read it as historically accurate and now
> superseded.
>
> | Sub-decision | Rev 1 | Rev 2 | Why |
> |---|---|---|---|
> | Hosting shape (one ACA container, SPA+API+worker) | Option A | **STANDS** | Never a cost decision. Won on `NFR-002`/`NFR-004`. |
> | `minReplicas` | `0` (scale-to-zero) | **CHANGED → `1`** | Cold start attacks `SUC-001`. The only reason to accept it was price. |
> | Container size | 0.25 vCPU / 0.5 GiB | **CHANGED → 0.5 vCPU / 1.0 GiB** | Extraction burst headroom; OOM is a failure class an autonomous implementer diagnoses badly. |
> | Registry | ghcr.io | **CHANGED → Azure Container Registry, Basic** | Deletes a secret and a PAT-expiry time bomb; also the most-documented ACA path (`NFR-004`). |
> | SWA Standard (~$9/mo) | Rejected | **REJECTION STANDS** | Cost was **not** load-bearing. It loses on `NFR-002`, and `minReplicas = 1` removes the first-paint advantage that was its only real win. |
> | Staging environment | None | **CHANGED → a staging environment exists** | Its blocker was the Cosmos free-tier limit (ADR-0005 Rev 2), which no longer exists. |
>
> ---
>
> ### R2.1 `minReplicas = 0 → 1`. **DECISION CHANGED.**
>
> Revision 1 wrote the honest version of this itself: *"`minReplicas = 0`
> costs $0 and puts a 2–8 second cold start on the first request of a
> session — on the value loop. That is a real cost to `SUC-001`, and this
> ADR does not pretend otherwise."* It then accepted the harm and named
> the fix as **"one property and it is priced"** — ≈$4–6/month at the old
> size — declining it only because `NFR-012` forbade a fixed charge.
>
> Re-argued without the price gate, there is nothing left on the `0` side:
>
> - **The harm lands on the one thing the product is judged by.** `J-1`
>   is "open the list, filter, deep-link out" and `SUC-001` is "the owner
>   stops opening streaming apps and checks nextup instead". A 2–8 second
>   blank first request loses that comparison against a native app that
>   was already resident in memory. This is not a latency percentile in
>   the abstract; it is the product's primary success signal.
> - **The usage pattern is worst-case for scale-to-zero.** One user
>   checking a list a few times a week means *almost every session is a
>   cold session*. A busy app amortises cold start across users; nextup
>   cannot. Scale-to-zero is cheapest exactly where it hurts most.
> - **The counter-argument that survives, and why it is not enough.**
>   `OQ-014` sets no performance target, and Revision 1 correctly refused
>   to invent one. "Launch at 0 and escalate on evidence" was the right
>   sequencing *while escalation cost money the project did not have*.
>   It is the wrong sequencing now: the evidence-gathering exercise costs
>   the owner a bad first impression to learn something the architecture
>   already predicted, and the remedy is ~$5/month. We are still not
>   inventing an NFR — we are removing a known defect whose fix is a
>   Bicep property.
>
> **Decision: `minReplicas = 1`, `maxReplicas = 2`.** The second replica
> exists **only** so a revision transition is not a gap in service; there
> is no scale rule, no HTTP-concurrency trigger and no KEDA scaler. A
> single-user app cannot generate load, and pretending otherwise would be
> the over-build `A41` explicitly warned against.
>
> **Container size 0.25 vCPU / 0.5 GiB → 0.5 vCPU / 1.0 GiB.** With an
> always-on replica the sizing question stops being "how fast does it
> cold start" and becomes "does it survive an extraction burst". Two
> 10 MB images in flight, base64-encoded into a request body, plus a Node
> heap, plus static asset serving, fits 0.5 GiB only narrowly. An OOM
> kill mid-extraction is recoverable by design (the batch is resumable)
> but it is an *undiagnosable* failure for an autonomous implementer
> reading logs — precisely the `RSK-016` failure shape. The headroom
> costs ~$5/month and removes a whole class of confusing failure.
> Downshifting is a one-property lever if the owner would rather have the
> $5 (see `architecture.md` §Cost summary).
>
> **`RSK-023` (cold start) is CLOSED.** The mitigation is no longer a
> skeleton UI state and a priced escalation; the cause is gone.
>
> ### R2.2 ghcr.io → **Azure Container Registry, Basic (~$5/month)**. **DECISION CHANGED.**
>
> Revision 1's entire argument against ACR was one clause: *"the ACR
> Basic SKU is a fixed ~$5/month charge and therefore breaches
> NFR-012."* No technical objection was ever raised. Re-argued on
> merits, ACR wins on three counts that have nothing to do with money:
>
> 1. **It deletes a secret.** Container Apps can pull from ACR with the
>    app's **system-assigned managed identity** (`AcrPull`). The ghcr.io
>    pull credential disappears, taking the system from two secrets to
>    one (the TMDB API key). Revision 1 called this out as the give-up:
>    *"one secret where the 'all managed identity' story would otherwise
>    be clean."*
> 2. **It removes a time bomb.** A ghcr.io PAT expires. When it does,
>    deployments fail — months later, for a reason unrelated to the
>    change being deployed, to an owner with no operational budget and an
>    autonomous implementer with no memory of setting it up. A
>    credential that breaks something distant and later is the worst
>    failure shape available to this project.
> 3. **`NFR-004`.** ACA-pulls-from-ACR-with-managed-identity is the path
>    every Microsoft quickstart, sample and Bicep module takes. ghcr.io
>    into ACA is a comparatively thin trail. The same criterion that
>    picked React and Express picks ACR.
>
> **Cost:** Basic ≈ $5/month, fixed. **Consequence accepted:** GitHub
> Actions must now authenticate to Azure to push (it already does, via
> the OIDC federated credential used for the Bicep deployment), so no new
> CI secret appears. ACR Basic's 10 GiB and low throughput are irrelevant
> at one image and a handful of pushes a month; **image retention is not
> automatic on Basic**, so the workflow keeps the last 5 tags and prunes
> the rest — one step, not a policy engine.
>
> ### R2.3 Static Web Apps Standard (~$9/month). **REJECTION STANDS — and cost was not load-bearing.**
>
> Revision 1 gave two reasons: the shape doubles the deployable count,
> and the variant that fits the workload costs $9/month fixed. Only the
> second is repealed, and it was the weaker one.
>
> - **The `NFR-002` argument is untouched and still decides it.** Two
>   deployables, two hosting models, two auth surfaces and a cross-origin
>   boundary, versus one of each. For an autonomous implementer, that is
>   the difference that matters, and it does not get cheaper when the
>   $9 becomes payable.
> - **Its one genuine advantage has now evaporated.** SWA's win was CDN
>   first paint while the API was cold. With `minReplicas = 1` there is
>   no cold API. We would be paying $9/month, plus a permanent increase
>   in build and auth complexity, to fix a problem R2.1 already fixed for
>   ~$5.
> - Static assets here are a few hundred kilobytes served from the same
>   origin as the API. A CDN in front of that is optimisation theatre.
>
> ### R2.4 Staging environment. **CHANGED — a staging environment now exists.**
>
> Revision 1: *"There is no staging environment, because the Cosmos free
> tier is limited to one account per subscription and a second
> environment would consume the very free tier that makes this
> architecture $0."* Every clause of that sentence is about the free
> tier. **ADR-0005 Revision 2 removed the free tier from the design**, so
> the blocker is gone, and what remains is a straight quality question:
> *is a place to fail safely worth ~$0 and one more Bicep parameter
> file?*
>
> Yes, and specifically because of who is building this. `NFR-002` hands
> implementation to an autonomous coding agent, and `RSK-016` is that the
> agent gets something subtly wrong. An agent with no staging environment
> has exactly one place to discover an infrastructure-shaped defect: the
> owner's real, never-deleted, un-recreatable data (`REQ-028`). Emulators
> and CI cannot rehearse managed-identity RBAC, Easy Auth redirect URIs,
> ACR pull permission, or a Bicep deployment against a real subscription
> — which is the exact list of things that break on a first deploy.
>
> **Shape, deliberately minimal (this is where over-build would creep
> in):**
>
> | | |
> |---|---|
> | Compute | A **second Container App in the same Container Apps environment**, `minReplicas = 0` (staging *should* scale to zero — nobody is judging its cold start). ~$0. |
> | Database | A **second database on the same PostgreSQL Flexible Server**, not a second server. ~$0. |
> | Storage | A second blob container on the same storage account, same 30-day lifecycle rule. ~$0. |
> | Extraction | The **stub extractor** by default. Staging never receives the owner's real screenshots; the live-model path is exercised manually with synthetic fixtures. |
> | Identity | Its own Entra app registration, same allow-list mechanism. |
> | Not included | No second resource group, no second region, no second Postgres server, no second ACR, no separate Log Analytics workspace, no staging custom domain, no data copied down from production. |
>
> **Marginal cost ≈ $0.** The honest give-ups: staging shares a database
> *server* and a storage *account* with production, so a server-level
> failure or a Bicep change that targets the server rather than the
> database affects both; and there is now one more thing to keep in sync.
> Both are accepted as smaller than the risk they retire.
>
> **`RSK-025` (no staging) drops Medium → Low.**
>
> ### R2.5 What did **not** change, and why
>
> - **One deployable serving SPA + API + worker.** Not a cost decision.
> - **No scheduler, anywhere.** `REQ-041` is a requirement, not a budget
>   line. ACA Jobs remain rejected on exactly the Revision 1 grounds.
> - **No VNet, private endpoints, WAF or DDoS protection.** These are now
>   *affordable*, which is not the same as *warranted*. The data plane is
>   reachable only by managed identity, ingress is authenticated at the
>   platform edge, and there is one user. Buying network isolation here
>   would add several resources an autonomous implementer must get right
>   in exchange for no threat this system actually faces. **This is the
>   clearest example of A41 not being licence to over-build.**
> - **No multi-region, no zone redundancy, no read replica, no
>   autoscaling rules.** One user. There is no availability requirement
>   (`OQ-014`) and inventing one would violate `NFR-002`.
>
> ### R2.6 Revised cost for this ADR's scope
>
> | Line | Rev 1 | Rev 2 |
> |---|---|---|
> | Compute | $0.00 (`minReplicas=0`) | **~$9–12** (0.5 vCPU / 1 GiB, always on) |
> | Registry | $0.00 (ghcr.io) | **~$5** (ACR Basic) |
> | Staging | n/a (did not exist) | **~$0** |
> | **Subtotal** | **$0.00** | **~$14–17 / month** |
>
> ⚠ **These are Azure list prices recalled from model knowledge and are
> unverified — web retrieval is unavailable to this role.** `TASK-010` is
> extended to re-verify ACA idle-rate billing at 0.5 vCPU / 1 GiB and the
> ACR Basic price before the Bicep is finalised.

---

| | |
|---|---|
| **Status** | **Accepted (Revision 2)** — Rev 1 retained verbatim below |
| **Date** | 2026-08-10 |
| **Deciders** | solution-architect (phase 7), autonomous |
| **Forced by** | **NFR-012 (hard MUST)**, NFR-002, NFR-003, NFR-004, NFR-006, NFR-007, NFR-015, NFR-019, NFR-020, REQ-041, REQ-076 |

## Context

nextup must run on Azure using only free-tier or consumption-billed
services with **no fixed monthly commitment** (NFR-012, hard MUST). It
serves one user, from a phone, a few times a week, plus occasional
bursts of image processing.

Four constraints shape the compute decision, and they pull against each
other:

1. **The value loop must feel fast.** `J-1` — "open the list, filter,
   deep-link out" — is the reason the product exists, and `SUC-001`
   ("the owner stops opening streaming apps and checks nextup instead")
   dies if opening nextup is slower than opening Netflix. Scale-to-zero
   compute directly attacks this.
2. **No third-party call may sit on the value loop's critical path.**
   TMDB is reachable in hundreds of milliseconds on a good day and not
   at all on a bad one. `REQ-076`'s lazy refresh has to be designed so
   the common case makes zero outbound calls.
3. **`REQ-041` is a closed enumeration.** No scheduled or background
   process may change user-visible list state. Exactly two non-owner
   processes are permitted: the lazy TMDB refresh (REQ-076) and the
   30-day screenshot purge (NFR-019). The hosting shape must make it
   *hard* to add a third — an always-available scheduler is a standing
   invitation to violate this.
4. **Extraction is bursty and slow relative to a web request.** A
   30-image full-update batch is 30 sequential OCR calls at roughly
   1 second each. That does not fit a synchronous HTTP request.

## Options considered

### Option A — One Azure Container App, Consumption plan, serving SPA + API + extraction

| | |
|---|---|
| Summary | A single container image: a Node process serving the built SPA as static assets, the JSON API, and an in-process background job runner for extraction. Container Apps built-in authentication in front (ADR-0002). Image hosted on GitHub Container Registry. |
| Pros | **One deployable, one origin, one language, one CI pipeline** — the smallest possible surface for an autonomous implementer (NFR-002, NFR-004). Single origin makes Easy Auth's redirect flow work with no CORS, no cross-site cookie problems, and no token relay. Generous consumption free grant (180,000 vCPU-s + 360,000 GiB-s + 2M requests per subscription per month) means scale-to-zero costs **$0**. Scale-to-zero also means there is no idle process on which someone could hang a cron job — REQ-041 is defended by the *shape* of the deployment. Long-running extraction is fine: the batch is accepted, processed in-process, and the client polls; HTTP request timeouts are not involved. Managed TLS certificate and HTTPS redirect included. |
| Cons | **Cold start.** After the scale-to-zero cooldown, the first request of the session pays container start-up — realistically 2–8 seconds for a small Node image. That lands squarely on the value loop. Also: an in-process job runner means a replica restart mid-extraction loses the run (mitigated — the batch is resumable and nothing is visible until it completes). |
| Cost | **$0/month** at `minReplicas=0`. At `minReplicas=1`, 0.25 vCPU / 0.5 GiB: ≈ 468,000 billable vCPU-s at idle rate + 936,000 billable GiB-s ≈ **$4–6/month**, consumption-billed with no commitment. |
| Reversal cost | Low. It is a container; it runs anywhere. |

### Option B — Azure App Service Free (F1), Linux code deployment

| | |
|---|---|
| Summary | The classic free web host. Node app deployed as code (F1 Linux does not support custom containers). |
| Pros | **Genuinely $0, unconditionally** — not a consumption grant that could be exhausted, but a free SKU. Easy Auth is available here too, so ADR-0002 is unaffected. Simplest possible deployment story. |
| Cons | **Harder constraints than the free price suggests:** 60 CPU-minutes/day quota (a 30-image extraction burst is mostly I/O wait, so this probably fits — but "probably" is doing work), 1 GB storage, 1 GB RAM, shared CPU, **no Always On** so cold starts are guaranteed and are typically *worse* than a small container's, no autoscale, no SLA, and no custom-domain TLS. No container image means the build artifact and the runtime environment diverge between local development and production, which is exactly the class of "works on my machine" defect an autonomous implementer cannot diagnose (NFR-002, NFR-003). |
| Cost | $0. |
| Reversal cost | Low, but the lack of a container image means the migration is a re-platforming, not a redeploy. |

### Option C — Azure Static Web Apps (Free) for the SPA + Azure Functions (Consumption) for the API

| | |
|---|---|
| Summary | The canonical "cheap Azure web app" shape. SPA served from a global CDN; API as HTTP-triggered functions. |
| Pros | **Best possible first paint** — the SPA is CDN-served with no cold start at all, so the app shell appears instantly even when the API is cold. Free tier includes managed TLS, custom domains and built-in authentication. Functions Consumption is genuinely $0 at this volume. |
| Cons | **Two deployables, two hosting models, two auth surfaces, and a cross-origin boundary** — a materially larger surface than Option A for an autonomous implementer. SWA's free tier managed-functions have runtime and duration limits that a 30-image extraction run will exceed; "bring your own functions" (linking an external backend) requires the **Standard tier at ~$9/month**, which is a **fixed monthly commitment and therefore breaches NFR-012 outright**. Working around that means introducing a queue and a second function app — three deployables for one user. Long-running extraction pushes toward Durable Functions, which is a further framework to get right. |
| Cost | $0 at Free tier — but only for a shape that does not fit the workload. The shape that fits costs $9/month fixed. |
| Reversal cost | Moderate — splitting or re-merging deployables is real work. |

### Option D — Azure Container Apps Jobs / a scheduled worker alongside the API

| | |
|---|---|
| Summary | Separate the extraction worker from the API as an event- or schedule-triggered ACA Job. |
| Pros | Clean separation of the bursty workload; independent scaling; the API stays small and fast. |
| Cons | **Two deployables and a queue for a workload that is one user pressing "submit" a few times a month.** Worse: standing up scheduled-job infrastructure puts a loaded gun next to `REQ-041`, whose entire point is that nothing but the owner changes the list. The architecture is better off with **no scheduler in it at all**. |
| Cost | $0 within the same free grant. |
| Reversal cost | Low. |

### Option E — A virtual machine (B1s or similar)

Rejected without detailed analysis: a B-series VM is a **fixed monthly
charge** and therefore breaches NFR-012 as written, and it imports OS
patching, TLS certificate management and process supervision into a
project whose implementation budget is approximately zero.

## Decision

**We will deploy a single Azure Container App on the Consumption plan,
serving the SPA, the JSON API and the extraction worker from one
container image, fronted by Container Apps built-in authentication, with
`minReplicas = 0` at launch.**

Supporting services: **Azure Cosmos DB for NoSQL free tier**
(ADR-0005), **Azure Blob Storage** (ADR-0006), **Azure AI Vision F0**
(ADR-0001) — all accessed with the Container App's **system-assigned
managed identity**. The container image is published to **GitHub
Container Registry (ghcr.io)**, deliberately *not* Azure Container
Registry, because the ACR Basic SKU is a fixed ~$5/month charge and
therefore breaches NFR-012.

The decision between Option A and Option C came down to `NFR-002`:
Option C buys a faster first paint at the price of doubling the number
of things an autonomous agent must deploy, authenticate and test — and
the variant of Option C that actually fits a 30-image extraction run
costs $9/month **fixed**, which NFR-012 forbids outright. Option B was
rejected because its free price hides constraints (60 CPU-min/day, no
container parity between dev and prod) that would surface as
undiagnosable failures.

### The cold-start trade, stated plainly

`minReplicas = 0` costs **$0** and puts a 2–8 second cold start on the
first request of a session — on the value loop. That is a real cost to
`SUC-001`, and this ADR does not pretend otherwise.

It is mitigated, not eliminated:

- The list itself is served from Cosmos DB, which is **always warm** —
  there is no database resume stall on top of the container start
  (this is a primary reason Cosmos was chosen over a serverless SQL
  offering with auto-pause; see ADR-0005).
- The scale-to-zero cooldown is a configurable window, so repeated use
  within a session pays the cost once.
- **The escalation is one property and it is priced:**
  `minReplicas = 1` on 0.25 vCPU / 0.5 GiB removes cold start entirely
  for **≈$4–6/month**, consumption-billed with no commitment — still
  NFR-012-compliant, and within the `$0–$5/month` envelope the BRD
  already records for non-extraction infrastructure.

Launching at `0` and escalating on evidence is the right order, because
the owner's tolerance is unmeasured (`OQ-014` leaves performance targets
deliberately unspecified, and this ADR must not invent one).

### Protecting the value loop from third-party calls

- **TMDB is never called on the list-read path in the common case.**
  `REQ-076` refreshes a title's metadata only when its stored copy is
  older than the 6-month TMDB ceiling (NFR-014). The refresh is scoped
  to **the rows actually being rendered in the current page** of the
  combined list — at most a few dozen — and the stale set is empty for
  the first six months of any title's life and rare thereafter.
- **Poster images are never proxied.** The browser loads them directly
  from TMDB's image CDN using the stored poster reference, so posters
  never consume our compute, our bandwidth, or the request's latency
  budget.
- **Azure AI Vision is never called on a read path at all** — only
  during extraction, which is explicitly asynchronous.

### Background processes — exactly two, and neither writes list state

`REQ-041` permits exactly two non-owner-initiated processes. The
architecture implements both **without a scheduler**:

| Permitted process | Implementation | Why this shape |
|---|---|---|
| Lazy TMDB metadata refresh (REQ-076) | Executed inline on the read path, only for the rows being rendered, only when the stored copy exceeds the NFR-014 age. | Owner-initiated by construction. No timer exists to be mis-scoped. |
| 30-day screenshot purge (NFR-019) | An **Azure Blob Storage lifecycle-management rule** deletes image blobs 30 days after upload. The application derives availability from `retainUntil` on the `UploadedImage` record and never writes to the database as part of the purge. | **No process anywhere in nextup writes to the database on a timer.** REQ-041's prohibition is satisfied by there being no such code path at all, rather than by a code path that is careful. |

## Consequences

### Positive
- **$0/month** for compute at launch, within a consumption free grant
  that single-user volume cannot plausibly exhaust (NFR-012).
- One deployable, one origin, one language, one pipeline (NFR-002,
  NFR-004).
- Single origin makes ADR-0002's Easy Auth redirect flow work with zero
  CORS or cross-site-cookie configuration — a whole category of defects
  removed.
- **There is no scheduler in the system.** REQ-041's central guarantee is
  defended structurally rather than by discipline.
- Container image parity between local development and production, which
  is what makes `NFR-003`'s "an agent can tell whether a change worked"
  achievable.
- Managed TLS certificate, HTTPS redirect, and revision-based rollback
  come free with the platform.

### Negative
- **Cold start on the value loop at `minReplicas = 0`** — 2–8 seconds on
  the first request of a session, against the product's primary success
  signal. Accepted at launch, with a priced one-property escalation.
- **Single point of failure.** One container serves everything; a crash
  during extraction takes the UI with it. Acceptable for one user with
  no availability requirement (`OQ-014` explicitly leaves availability
  unspecified), and mitigated because extraction is resumable and
  nothing becomes visible until a batch completes (ADR-0005).
- **In-process extraction is not durable.** A revision restart mid-batch
  loses the in-flight run. Mitigated: the batch stays in
  `extracting`/`extraction failed`, the images are retained, and the
  owner retries (US-006 AC-4, US-034). No list state can be corrupted,
  because none is written until the review pass closes.
- **The container's CPU and memory ceiling is now a constraint on
  ADR-0001.** Any future self-hosted OCR (Option C in ADR-0001) would
  make the image and the cold start materially worse. This coupling is
  real and is one reason ADR-0001 chose a managed OCR service.
- **ghcr.io instead of ACR** means the registry lives outside Azure, and
  the Container App needs a registry credential in configuration — one
  secret where the "all managed identity" story would otherwise be
  clean. The alternative was a $5/month fixed charge, which NFR-012
  forbids.
- **No staging environment** (see below). Changes go from CI to
  production.

### Neutral / follow-on work required
- **Environments: one.** `prod` in Azure, plus local development against
  the Cosmos DB emulator and Azurite. There is no staging environment,
  because the Cosmos free tier is limited to one account per
  subscription and a second environment would consume the very free
  tier that makes this architecture $0. **This is a deliberate
  give-up**, and it is why `NFR-003` (automated verification sufficient
  for an agent to know a change worked) is load-bearing rather than
  nice-to-have. The compensating controls are: a full CI test suite that
  must pass before deploy, Container Apps **revision-based deployment
  with instant rollback to the previous revision**, and a post-deploy
  smoke test.
- **Region:** a single region (East US or equivalent) selected for
  simultaneous availability of the Cosmos DB free tier and the Azure AI
  Vision F0 tier. To be confirmed as a first-sprint task.
- **IaC:** Bicep, checked into the repository, deployed by GitHub
  Actions. Every resource in one resource group so the whole system can
  be destroyed and recreated.
- **Observability:** Container Apps' built-in Log Analytics workspace,
  within the 5 GB/month free ingestion grant, carrying **operational
  logs only** — request outcomes, errors, extraction results, outbound
  call outcomes. **No client-side telemetry SDK is installed and no
  product-usage events are emitted**, per NFR-005. The distinction is
  written down here because it will otherwise be re-litigated: server
  error logs are operability, not analytics.

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **No.** A container runs anywhere. |
| **Cost to reverse** | Hours to days. Moving to App Service for Containers or any other container host is a deployment change. The one sticky dependency is Easy Auth (ADR-0002): leaving Container Apps *and* App Service means implementing an OIDC client. Data is unaffected — Cosmos and Blob are independent of the compute host. |
| **Trigger to revisit** | (a) the owner reports cold start as intolerable → set `minReplicas = 1` (+$4–6/month) *before* considering re-architecture; (b) monthly consumption approaches the ACA free grant; (c) a second environment becomes necessary; (d) extraction outgrows in-process execution (it will not, at 30 images a quarter). |

## Compliance and security implications

- **NFR-015/NFR-017:** all ingress passes through Container Apps
  built-in authentication before reaching application code (ADR-0002).
- **NFR-020:** the container has no anonymous route to image bytes; blob
  access is via managed identity only, and images are streamed through
  an authenticated API route (ADR-0006).
- **NFR-012:** every component is free-tier or consumption-billed. ACR
  Basic and SWA Standard were both rejected specifically because they
  are fixed monthly charges.
- **NFR-009/NFR-010:** the only outbound destinations are TMDB and Azure
  AI Vision. No streaming service is contacted. This should be asserted
  by a test over the allow-listed outbound host set (US-038 AC-2/AC-5).
- **REQ-041:** no scheduler exists in the deployment; the only automatic
  deletion in the system is a storage-layer lifecycle rule that touches
  image bytes and nothing else.
- Secrets (the ghcr.io pull credential, the TMDB API key) are stored as
  Container Apps secrets; all Azure-to-Azure authentication uses the
  system-assigned managed identity with least-privilege RBAC.

## References

- `Context/requirements.md` — NFR-012, NFR-002, NFR-003, NFR-004,
  NFR-005, NFR-014, NFR-019, NFR-020, REQ-041, REQ-076
- `artifacts/PRD.md` §7.4 (closed enumeration), §12.2, US-036, US-039
- `artifacts/BRD.md` — "$0–$5/month … everything except extraction"
- ADR-0001 (extraction), ADR-0002 (identity), ADR-0005 (datastore),
  ADR-0006 (image storage)
- **Pricing provenance:** Azure list prices from model knowledge; web
  retrieval unavailable to this agent. Re-verify the ACA free grant,
  idle-rate billing and the SWA Standard price before deployment.

---

## Addendum — 2026-08-17: live pricing verification (TASK-010)

Every figure below was read from the **Azure Retail Prices API**
(`https://prices.azure.com/api/retail/prices`, `api-version=2023-01-01-preview`)
for **`eastus2`** on **2026-08-17**. This supersedes the "Azure list prices from
model knowledge; web retrieval unavailable" provenance note above.
### Compute — the least-certain figure in the model, resolved favourably

| Meter (`eastus2`, Consumption) | Rate |
|---|---|
| Standard vCPU **Idle** Usage | **$0.000003 / vCPU-second** |
| Standard Memory **Idle** Usage | **$0.000003 / GiB-second** |
| Standard vCPU **Active** Usage | $0.000024 / vCPU-second (8× idle) |
| Standard Memory Active Usage | $0.000003 / GiB-second |
| Requests | $0.40 / 1M |

**The free grant DOES apply to an always-on replica's idle usage.** This was
the open question — `minReplicas = 1` means the replica never scales to zero,
and the worry was that the 180,000 vCPU-second / 360,000 GiB-second monthly
grant might be reserved for active usage only. It is not: both active and idle
consumption draw down the same grant (Microsoft Learn, *Billing in Azure
Container Apps*).

| Configuration | Verified monthly |
|---|---|
| **0.25 vCPU / 0.5 GiB, `minReplicas = 1`** (as designed) | **$4.30** — *published ~$5–8, so **under*** |
| 0.5 vCPU / 1.0 GiB (the pre-authorised remedy) | **$10.22** |
| **Up-size delta** | **+$5.92** — *published **+~$4**, so **48 % low*** |

⚠ **The +$4 figure was quoted to the owner at `A43`** when the reactive up-size
was pre-authorised, and it is repeated in `docs/runbooks/scale-up-memory.md`.
Both are corrected in place. **The decision stands at $5.92** — the remedy is
still right when a real OOM occurs — but the owner should not meet the true
number on a bill.

### Registry and alerting

- **ghcr.io = $0.00** confirmed: the package is public, and GitHub does not bill
  storage or bandwidth for public packages. No ACR, no `AcrPull`, no credential.
- **Alert rules cost $1.70/month, not the published $0.60–1.00** — an overage of
  70–183 %. `eastus2` list: a metric alert rule is **$0.10/month**, but a
  **log-search** alert at **5-minute** frequency is **$1.50/month**, i.e. 15× a
  metric rule. The estimate priced the log-search rule like a metric rule.
  Dropping it to 15-minute frequency would cost $0.50 and is the available
  lever; it is **not** taken, because a 15-minute detection delay on an OOM is
  most of a batch (`A43-M5` exists to make the OOM *observed*).

### Still owed — item (h), and it is not a pricing question

Whether **`RestartCount`** and **`WorkingSetBytes`** exist as alertable metrics
for `Microsoft.App/containerApps`, and whether **any OOM-distinct signal**
exists, cannot be answered from the pricing API or from `az` without a
**deployed** container app: metric definitions are listed against a resource
id. This leg is owed the moment staging exists and is a **TASK-157 input**. The
architecture's claim that ACA does not surface OOM-kill distinctly therefore
remains **UNVERIFIED**, and is still recorded as such.

### Total

**$11.77/month verified**, against a published band of **$11–13** — inside it,
so the `OQ-026` escalation rule (verified total exceeding the published
estimate by more than 50 %) does **not** fire. ⚠ But the total is right partly
by **cancellation**: compute came in under and absorbed the alerting and
up-size overages. Two line items were individually wrong.
