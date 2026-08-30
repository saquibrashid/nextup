# ADR-0001 — Title extraction from screenshots

> **This ADR has two revisions. Revision 2 supersedes Revision 1's
> decision. Revision 1 is retained below, verbatim and unedited, because
> the record of why a decision was made matters as much as the decision
> — and because most of Revision 1's reasoning survived and is still
> load-bearing.**

| | |
|---|---|
| **Status** | **Accepted (Revision 2)** — supersedes Revision 1 ("Accepted", 2026-08-10T19:23) |
| **Rev 2 date** | 2026-08-10T21:07-04:00 |
| **Deciders** | solution-architect, autonomous — no user interaction available in either revision |
| **Forced by (rev 2)** | **NFR-012a (new, A40)**, NFR-012 (as amended), REQ-008, REQ-012, REQ-058, REQ-074, RSK-021, NFR-002, NFR-003, NFR-004 |
| **Decision (rev 1)** | Azure AI Vision `Read` OCR (F0) as the **sole** extractor. $0.00/month. |
| **Decision (rev 2)** | **Azure OpenAI `gpt-4.1` multimodal vision as the PRIMARY extractor, with Azure AI Vision `Read` OCR retained as a MANDATORY deterministic cross-check on every image.** ~**$0.50–$0.70/month** steady state. |
| **Closes** | **OQ-005** (re-priced) |
| **Changes** | **RSK-021 High → Low.** Raises **RSK-028** (fabrication). Reframes **OQ-024**. |

---

# ══════════ REVISION 2 — 2026-08-10T21:07 ══════════

## R2.1 What changed

`A40`, verbatim (`Context/qa-log.md`, 2026-08-10T21:05:35):

> "for vision/ocr, some cost is okay, near zero is not required. but it
> should be as low as reasoanable without degrading quality."

Recorded as `ASM-056` and `constraintChanges[CC-001]`. `NFR-012` now
carries an explicit carve-out and **`NFR-012a`** states that extraction
is exempt from the near-zero-cost constraint, that **quality outranks
cost for this component**, and that *choosing a lower-quality extractor
in order to save money is explicit non-compliance*.

## R2.2 The honest framing — what this constraint change does and does **not** do

**Revision 1 was not a cost decision.** This must be stated plainly
before anything else, because the lazy reading of A40 is "cost is
allowed now, therefore switch to the LLM", and that reading is wrong.
Revision 1 examined six options and found **every one of them under
$1/month**. It said so explicitly: *"Cost is therefore not the
discriminator; input class, failure mode and operational complexity
are."* The three reasons it actually decided on were:

| # | Revision 1's reason | Does A40 touch it? | Verdict in Revision 2 |
|---|---|---|---|
| R1 | The input is pixel-perfect native screenshots — the easiest case OCR has, so the LLM's robustness-to-degraded-imagery advantage attacks a problem A15 excluded | **No** | **Still true.** And still not a reason to prefer an LLM. Revision 2 does not rest on it. |
| R2 | The owner reviews every candidate, so OCR's *visible* failures beat an LLM's *fluent, plausible, confident* fabrications | **No** | **Still true, and it is the strongest argument against this revision.** Revision 2 does not dismiss it — it engineers around it (R2.5). |
| R3 | A free allowance that cannot be exhausted beats metered at any price, because `NFR-012` cares about the *shape* of the cost | **Yes — directly.** `NFR-012a` repeals precisely this reason for this component. | **Withdrawn.** This reason no longer exists. |

So A40 removes exactly one of Revision 1's three pillars. Had the
analysis ended there, Revision 1 would stand — two of three reasons
intact, and a bare cost permission is not a reason to spend.

**It does not end there.** Re-opening the decision on *quality* grounds
— which is what `NFR-012a` actually demands — surfaces four questions
that Revision 1 under-weighted because `NFR-012`'s cost-shape argument
(R3) was doing so much of the work that the quality comparison never had
to be won on its own terms. Those four questions are R2.3. Three of them
favour the LLM. The fourth is decisive.

## R2.3 The quality re-argument

### (a) Layout understanding — **favours the LLM, moderately**

A saved-list surface is a **grid or carousel of tiles**, not a document.
`Read` returns lines with bounding boxes in a reading order computed for
prose. Revision 1 accepted this and pushed the reassembly into our code
— and `specs/ai.md` §3.2 step 1 is the result:

> *"Sort items by `(round(y*40), x)`. Merge two items into one candidate
> when their vertical centres differ by < 40 % of the taller box's
> height **and** their horizontal gap is < 3 % of image width."*

Three magic numbers — `40`, `0.40`, `0.03` — **calibrated against no
data whatsoever**, because no real capture has ever been run through
this pipeline. That is a fragile heuristic sitting on the critical path
of the product's only feeder loop, and every one of its failure modes
(two adjacent tiles' titles merged into one string; one wrapped title
split into two) produces a *plausible-looking wrong candidate* — the
exact failure class R2 was invoked to avoid. A multimodal model groups a
tile's text natively because it can see the tile.

This is real but not decisive on its own: the heuristics could be
calibrated after the first real capture.

### (b) Title fidelity feeding a load-bearing matcher — **favours the LLM, strongly**

`specs/ai.md` §4.2 matches with Jaro-Winkler at
`MATCH_AUTO_THRESHOLD = 0.92` / `MATCH_REVIEW_FLOOR = 0.70`, and
**matching quality is load-bearing in a way extraction quality alone is
not**: `workIdentity` is the key for dedup (data-model §7.4) *and* for
suppression (`REQ-071`). A wrong match merges two distinct works; a
missed match splits one; and a suppression keyed on a mis-resolved
identity silently fails to suppress. These are not review-pass
annoyances, they are data-model corruptions that the owner cannot see
and that persist.

OCR feeds that matcher **raw glyphs**: mixed case, soft hyphens,
stylised ligatures, colon/dash variants, and — critically —
**ellipsised titles**. Tile UIs truncate: `"The Lord of the Ri…"`,
`"Everything Everywhere All a…"`. Jaro-Winkler on a truncated prefix
against the full TMDB name degrades roughly with the fraction truncated;
a 30 % truncation lands well under 0.70 and the candidate resolves to
`unmatched:<hash>` — which then becomes **its own suppression and dedup
key**, permanently distinct from the correct one.

A vision model returns the **identified work**, not the visible glyphs,
and can complete a truncated title from artwork plus partial text. That
is not a convenience; it is a direct, measurable improvement in the
input quality of the one component whose errors are invisible and
durable.

### (c) RSK-021 — artwork-only tiles — **decisive**

This is the single strongest argument and it is entirely a
capability argument, not a cost one.

`RSK-021` is recorded in `architecture.md` as **High** severity and in
`backlog.md` as *"the largest residual product risk"*. Its statement:
the capture surface may render titles as **box artwork with the title
baked in as a stylised logotype**, which defeats *any* OCR engine.
`TASK-011` exists solely to have the owner check this in ten minutes,
and `backlog.md` says outright that if the answer is bad, *"the OCR
extraction pipeline in M3 is built on sand."*

**A multimodal model can identify a work from its poster art with no
legible text at all.** That is not a marginal improvement over OCR on
this input class — it is a capability OCR categorically does not have.
Choosing the LLM primary **substantially de-risks, and plausibly
eliminates, the largest open risk in the architecture**, and it does so
*before* `TASK-011` reports rather than as a reaction to it.

Revision 1 handled `RSK-021` by documenting an escalation (Option E) and
declining to build it, on the explicit ground that it was *"the option
that is cheapest to add later"*. Under `NFR-012` R3 that was correct.
Under `NFR-012a` it is not: the thing that made "later" acceptable was
that spending was gated. It no longer is, and the risk is still there.

### (d) Semantic filtering — favours the LLM, mildly

`Read` returns every string on screen; `specs/ai.md` §3.2 filters with a
26-entry hard-coded `CHROME_TERMS` list. That list is a per-service,
per-redesign maintenance liability that also cannot generalise past
Netflix and Max — while `REQ-009`/Rule B forbid service-specific logic.
A model distinguishes a tile title from a rail heading without a
vocabulary list.

### (e) The case **against** — taken seriously

| Objection | Weight | Answer |
|---|---|---|
| **Hallucination.** An LLM will emit a fluent, plausible, wrong title, and it looks exactly like a right one in a review pass. This was Revision 1's reason R2 and it is a genuinely good reason. | **High** | **Not dismissed — engineered against.** The mandatory OCR cross-check (R2.5) makes every unsupported title *visibly* unsupported, which converts an invisible failure into a flagged one. That, plus deterministic TMDB matching as an independent plausibility filter, plus a measured fabrication-rate gate in the golden suite, restores the property R2 was protecting. |
| **Non-determinism breaks the golden fixtures.** `specs/testing.md` gates determinism at *"exactly 1.0, non-negotiable"*. | **High** | Real, and it is the thing an autonomous implementer will get wrong. Resolved precisely in R2.6: stages 2–5 remain byte-deterministic and CI is unchanged in character; only stage 1's *live* evaluation moves to band assertions. |
| **Latency.** 3–8 s/image vs 0.5–1.5 s. A 40-image batch goes from ~1 min to ~3 min. | Low | Extraction is already asynchronous with client polling (`NFR-010` explicitly excludes it from the value loop). The batch ceiling rises 10 → 15 min. |
| **Prompt and model-version drift.** A silent provider-side model update changes behaviour. | Medium | Deployment pins an explicit model *version*, not `latest`. Drift shows up as a golden-suite metric drop on the next manual refresh — the same early-warning mechanism Revision 1 relied on. |
| **`REQ-058` — the extractor must not infer the service.** A model with broad visual understanding *could*. | Medium | Enforced structurally and unchanged: strict JSON Schema with `additionalProperties: false` and no service field, plus an explicit negative instruction, plus the existing `T-AI-011` grep. The type system still makes it unrepresentable. |
| **`RSK-022` — TMDB's AI clause.** | **Must be read correctly — see R2.4** | It binds **TMDB content**, not screenshot pixels. It does not prohibit vision extraction. |
| **Azure OpenAI abuse-monitoring retention.** | Medium | A **genuine new give-up** — see R2.7. |
| Extra provisioning: an Azure OpenAI resource plus model quota, with no free tier. | Low | One Bicep resource, one deployment, managed identity. `NFR-012a` makes the absence of a free tier a non-issue. |

## R2.4 RSK-022 — the necessary clarification

**`RSK-022` binds TMDB content, not the owner's pixels.**

TMDB's terms restrict use *"in connection with … a machine learning or
artificial intelligence based Application"*. The binding architectural
rule this ADR established, and which **Revision 2 keeps completely
unchanged**, is:

> **No TMDB content — titles, ids, overviews, genres, poster paths,
> search results, match candidates — is ever placed in a prompt, an
> embedding request, a re-ranking request, or any other model call.
> Title→work matching is deterministic string comparison in our own
> process, never model-assisted.**

A screenshot the owner took of their own saved list **is not TMDB
content**. Sending it to a vision model transmits nothing licensed from
TMDB. The pipeline order is what enforces this and it is unchanged:
extraction sees only the owner's image and emits only strings; TMDB is
reached **afterwards**, by deterministic search; the two never meet.

Revision 1 listed "keeps nextup furthest from the TMDB AI clause" as a
supporting argument for plain OCR. That was a *distance* argument, not a
compliance argument — a preference for standing further from a line
neither option crosses. It is not a reason to accept a measurably worse
extractor, and **`NFR-012a`'s quality-first ordering settles it.** The
structural enforcement (`T-AI-012`, `T-AI-013`, the ESLint import ban)
is *strengthened* in Revision 2, not weakened: `T-AI-013`'s
network-shaped assertion now covers the Azure OpenAI host as well as the
vision host.

**Do not read this ADR as prohibiting vision extraction. It never did,
and Revision 2 makes that explicit.**

## R2.5 The decision

> **Primary extractor: Azure OpenAI `gpt-4.1` (multimodal vision),
> deployed in the same region, one call per image, `temperature: 0`,
> `seed` pinned, strict JSON Schema Structured Outputs.**
>
> **Mandatory deterministic cross-check: Azure AI Vision `Read` OCR
> (F0) runs on every image, in parallel, and its output is used to
> corroborate, flag and supplement the model's output. It is not a
> fallback that sits idle — it runs every time.**

Both live behind the **unchanged** `TitleExtractor` interface
(`US-006 AC-1`). The composite is `apps/api/src/extraction/
hybridExtractor.ts`, selected by `NEXTUP_EXTRACTOR='hybrid'` (the new
default). `azure-vision-read`, `llm-vision` and `stub` remain
individually selectable.

**Why a mandatory cross-check rather than plain LLM-primary, and why not
Revision 1's Option E (OCR-first with escalation):**

- **Option E is now the wrong shape.** Escalation fires on *low yield*.
  But failure modes (a), (b) and (d) — mis-grouped tiles, truncated
  titles, chrome misclassification — produce *plenty* of candidates that
  are subtly wrong, and therefore **never trigger escalation**. Option E
  catches only `RSK-021` and misses everything else the quality
  re-argument identified. Under a quality-first ordering, the
  higher-quality extractor must be the *primary*, not the exception
  handler.
- **The cross-check is what preserves Revision 1's reason R2.** It
  closes the loop in both directions:

| Cross-check finding | What it means | What the owner sees |
|---|---|---|
| Model title has a strong OCR line behind it (`ocrSupport: 'exact'`) | Corroborated by an independent deterministic reader | Normal candidate |
| Model title has a partial OCR match (`'partial'`) — e.g. OCR saw the truncated form | Consistent with a completed truncation | Normal candidate |
| Model title has **no** OCR support (`'none'`) | Read from artwork — **or fabricated** | Flagged **"read from artwork — check this"**, in the main list, never hidden |
| An OCR line survives the chrome/length gates but **no** model item corresponds to it | **The model dropped a title OCR could see** | Emitted as an extra candidate flagged **"the text reader saw this but the tile reader did not"** — `REQ-012`'s no-silent-discard rule, now enforced against the model itself |

  The last row matters as much as the third: it means the LLM
  **cannot silently omit** a title. That is a guarantee Revision 1's
  single-provider design could not offer either, and it costs $0
  because `Read` F0 is free.

- **Geometry.** Stage 2 depends on bounding boxes. `Read`'s boxes are
  reliable; a vision model's are not. The cross-check supplies real
  geometry regardless of what the model returns.

**Model choice — and an explicit `NFR-012a` warning.** `gpt-4.1` is
selected over `gpt-4.1-mini` **on quality**, at a cost delta of roughly
**$0.40/month**. Artwork recognition (R2.3c) depends on world knowledge
about film and television poster art, which is exactly where model size
tells. `gpt-4.1-mini` remains configurable —

> ⚠ **`NFR-012a`: an implementer MUST NOT downgrade the deployment to
> `gpt-4.1-mini`, or to any other model, in order to reduce cost. The
> only admissible reason to change the model is measured quality on the
> golden suite. A cost-motivated downgrade is explicit
> non-compliance.**

## R2.6 Determinism and the test strategy — stated precisely, because this is what gets implemented wrong

The determinism gate does **not** disappear. It moves.

| Layer | Determinism | Where it runs |
|---|---|---|
| **Stages 2–5** (cleanup, cross-check merge, identity, suppression, classification) | **Byte-identical, gate 1.0, non-negotiable — unchanged** | CI, offline, every PR |
| **Stage 1 behaviour** (schema, retries, timeouts, truncation, refusals, guardrails) | **Byte-identical** — asserted against *recorded* HTTP responses via `msw` | CI, offline, every PR |
| **Stage 1 quality** (recall, fabrication, stability) | **Band assertions over N=3 live runs. Never equality.** | **Manual only**, never in CI |

The whole of CI remains offline, free and deterministic, because
`StubExtractor` still replays a recorded `ExtractionResult` keyed on the
image's sha256 — the model is never called in CI. Full specification in
`specs/ai.md` §9 and `specs/testing.md` §4/§4A.

> **The rule an implementer must not break:** *never assert exact string
> equality, exact ordering, or exact counts against a live model
> response.* Live assertions are: per-image recall floors that must hold
> in **3 of 3** runs; a cross-run set-stability floor (Jaccard ≥ 0.95);
> a fabrication-rate ceiling; and a per-run cost ceiling.

## R2.7 Consequences

### Positive
- **`RSK-021` drops from High to Low** and stops being the largest
  residual risk in the architecture. The artwork-only case moves from
  *"defeats the pipeline"* to *"a fixture with a measured recall gate"*.
- **Matching quality improves at its input**, which is where the
  durable, invisible errors (identity, dedup, suppression) originate.
- **Three fragile hand-tuned heuristics stop being load-bearing**: the
  `(40, 0.40, 0.03)` grouping constants and the 26-term chrome
  vocabulary become *corroboration* inputs rather than the primary
  reading mechanism.
- **`REQ-012` gets stronger, not weaker.** The cross-check is the first
  mechanism in the design that can detect a *silent omission* by the
  extractor. Revision 1 had no such mechanism.
- **`TASK-011` stops being a gate on M3.** It remains worth doing as
  evidence, but the extraction investment no longer rests on its answer.
- The manual-entry path (US-009) survives as a normal product feature,
  not as a contingency product. Per A40(e), the fallback-product framing
  is retired.

### Negative — named honestly
- **Fabrication is now a real failure mode where it previously was not.**
  This is the cost of the decision, and it is a genuine regression
  against Revision 1's reason R2. It is *mitigated* — flagged, measured,
  gated, human-reviewed — but it is not *eliminated*, and a fabricated
  title that happens to have a plausible OCR neighbour will slip the
  flag. New risk **`RSK-028`**, severity **Medium**.
- **Cost rises from $0.00 to ~$0.50–$0.70/month**, and it is now
  genuinely metered rather than free-allowance-bounded. A prompt bug or
  a retry loop can burn money in a way nothing else in this system can.
  Mitigated by hard per-batch image caps, concurrency 2, no scheduler,
  manual-only re-extraction, and a per-run cost assertion in the live
  suite — but the *shape* of the cost has changed and that is exactly
  what `NFR-012` (as it stood) was guarding against. `NFR-012a`
  authorises it explicitly.
- **A second inference provider exists.** Two SDKs, two failure modes,
  two sets of retries, two hosts on the outbound allow-list. Revision 1
  rejected Option E partly on this ground and that objection is
  **conceded, not refuted** — it is accepted as the price of (c).
- **Azure OpenAI abuse monitoring stores prompts (i.e. the owner's
  screenshots) for up to 30 days** and may expose them to authorised
  human reviewers, unless the modified-abuse-monitoring exemption is
  granted. Azure AI Vision `Read` has no equivalent retention. Given
  `RSK-014` (screenshots may incidentally contain a profile name or
  account email) this is a **real privacy regression** and is disclosed,
  not glossed. New task **`TASK-134`**: apply for modified abuse
  monitoring / limited-access data-processing before first real upload;
  until granted, the 30-day exposure stands and is documented in
  `specs/security.md`.
- **Latency roughly triples per image**; a 40-image batch takes ~3 min.
  Off the value loop, but the batch-status UI must not look hung.
- **Non-determinism is now a permanent property of stage 1.** Two
  identical uploads can produce slightly different candidate sets. The
  review pass absorbs this; the test suite must not pretend otherwise.
- **Model deprecation is a maintenance obligation** that `Read` did not
  impose. Azure OpenAI model versions retire on a schedule.

### Neutral
- The `TitleExtractor` interface, the review contract, the suppression
  gate, the data model, the API surface and the reconciliation logic are
  **all unchanged**. `ExtractedTextItem` gains three fields
  (`inferredTitle`, `basis`, `ocrSupport`); `ExtractionCandidate` gains
  the corresponding provenance. No migration — nothing is in production.

## R2.8 Priced comparison at the same volumes (`~50 img/mo` steady, `~150` bulk month)

Azure list prices, USD, from model knowledge. **Web retrieval is
forbidden to this role, so no figure was verified against a live pricing
page this pass** — `TASK-010` already exists to re-verify and is
re-scoped by this revision.

Per-image token model: ~1,500 input tokens for a 1080×1920 screenshot at
high detail plus ~200 prompt tokens; ~800 output tokens for ~25 tiles in
strict JSON.

| Option | Unit price | **Per image** | **50 img/mo** | **150 img/mo** | First bulk import (60) | Quality on this input class |
|---|---|---|---|---|---|---|
| **Revision 1** — Vision `Read` F0 only | free to 5,000 tx/mo | $0.0000 | **$0.00** | **$0.00** | $0.00 | Good on rendered text; **zero on artwork-only**; raw glyphs; fragile grouping |
| `gpt-4.1-mini` vision | $0.40 / $1.60 per 1M | ~$0.0019 | ~$0.10 | ~$0.29 | ~$0.11 | Good; weaker world knowledge for artwork recognition |
| `gpt-4o-mini` vision | $0.15 / $0.60 per 1M, **but ~33× image-token multiplier** | ~$0.0055 | ~$0.28 | ~$0.83 | ~$0.33 | Good; the multiplier makes it poor value |
| **`gpt-4.1` vision — SELECTED** | **$2.00 / $8.00 per 1M** | **~$0.0094** | **~$0.47** | **~$1.41** | **~$0.56** | **Best**: tile-native grouping, completed truncations, **artwork recognition** |
| `gpt-4o` vision | $2.50 / $10.00 per 1M | ~$0.0118 | ~$0.59 | ~$1.77 | ~$0.71 | Comparable to `gpt-4.1`; more expensive, no quality gain here |
| **+ mandatory `Read` F0 cross-check** | free to 5,000 tx/mo | $0.0000 | **$0.00** | **$0.00** | $0.00 | — |
| **+ `REQ-074` re-extraction allowance (×1.5)** | — | — | **+~$0.24** | **+~$0.70** | — | — |

**Selected total: ~$0.50–$0.70/month steady state; ~$1.40–$2.10 in a
bulk-import month; ~$0.56 for the one-off first import.** If `Read` F0
is unavailable and the S1 cross-check tier is used, add **$0.05–$0.23**.

**Is this "as low as reasonable without degrading quality"?** Yes, and
the arithmetic is the argument: the cheapest credible quality-adequate
configuration (`gpt-4.1-mini` + free cross-check) is ~$0.10/month; the
selected one is ~$0.50. **The entire quality premium is 40 cents a
month.** Declining to pay it to protect the largest residual risk in the
architecture would be exactly the false economy `NFR-012a` was written
to forbid. Conversely nothing more expensive buys anything: `gpt-4o` is
26 % dearer for no measurable gain on this input class, and a two-pass
or ensemble design would double cost to duplicate what the free OCR
cross-check already provides.

## R2.9 Reversal

| | |
|---|---|
| **One-way door?** | **No.** Still among the cheapest reversible decisions in the system. |
| **Cost to reverse** | Hours. `NEXTUP_EXTRACTOR='azure-vision-read'` restores Revision 1's behaviour exactly — that implementation still ships, is still tested, and now runs on every image anyway as the cross-check. No schema change, no data migration, no API change. |
| **Triggers to revisit** | (a) measured fabrication rate > 0.05 on the golden suite despite the cross-check; (b) `gpt-4.1` retired without a comparable successor; (c) modified abuse monitoring refused **and** the owner judges the 30-day screenshot retention unacceptable — in which case revert to Revision 1 and accept `RSK-021`; (d) `TASK-010` finds pricing wrong by >10× *and* the owner objects; (e) measured artwork-only recall < 0.50, which would mean the decision bought nothing. |

## R2.10 What this revision changes elsewhere

| Artifact | Change |
|---|---|
| `Context/requirements.md` | Already amended by the orchestrator: `NFR-012` carve-out, `NFR-012a` new. No further change. |
| `specs/ai.md` | §2 rewritten (hybrid pipeline, model config, cross-check), §3 verdicts extended, §7 thresholds, §8 low-yield + new degraded mode, §9 evaluation, §10 cost controls, §11 privacy |
| `specs/testing.md` | §3.1, §4, new §4A (live suite), §9 AC rows for US-006/US-013/US-014, §10 |
| `docs/architecture.md` | Headline, container table, technology table, cost model, NFR table, observability, "Where this breaks", deferred list, risk register, ADR index |
| `docs/backlog.md` | `TASK-010` re-scoped, `TASK-011` de-gated, `TASK-056` split into `TASK-056`/`TASK-056b`/`TASK-056c`, `TASK-078`/`TASK-079` extended, `TASK-122` allow-list, new `TASK-134` |
| `Context/session-state.json` | `RSK-021` High→Low, `RSK-012` closed, new `RSK-028`, `OQ-005` re-resolved, `OQ-024` reframed, `CC-001` → applied |

---
---

# ══════════ REVISION 1 — 2026-08-10T19:23 — SUPERSEDED, RETAINED VERBATIM ══════════

> **Superseded by Revision 2 above.** Everything below is the original
> record, unedited. Its reasons R1 (input class) and R2 (visible failure
> modes) remain true and are honoured by Revision 2's cross-check
> design; its reason R3 (free-allowance cost shape) was repealed by A40.
> Where the text below says "Decision", read Revision 2's.

## Original title

**ADR-0001 — Title extraction from screenshots: Azure AI Vision Read OCR**

| | |
|---|---|
| **Status** | ~~Accepted~~ **Superseded by Revision 2** |
| **Date** | 2026-08-10 |
| **Deciders** | solution-architect (phase 7), autonomous — no user interaction available |
| **Forced by** | REQ-008, REQ-012, REQ-058, REQ-074, **NFR-012 (hard MUST)**, NFR-004, NFR-005, NFR-009, NFR-010 |
| **Closes** | **OQ-005** |
| **Raises** | OQ-024 (capture-surface text legibility), RSK-021, RSK-022 |

## Context

`OQ-005` has been the only unpriced component in nextup since the A14
loop-back, and `NFR-012` — "deployable on Azure using only free-tier or
consumption-billed services, with no component requiring a fixed monthly
commitment" — is a hard MUST. Every other component of the system was
already known to sit at or near $0. The MVP lock (`mvp-definition.md`
§18) records vision/OCR inference as **the** component that could
invalidate the cut line, with the named fallback being manual entry with
TMDB search — a *different feeder loop*, which would reopen the lock.

Two clarifications materially relaxed this decision before it reached
phase 7, and both must be held in view or the choice will be
over-engineered:

1. **The input class is narrow and clean.** `ASM-021` / the A15
   correction confines input to *pixel-perfect native screenshots* —
   the service's phone app or the service's website on a laptop.
   Photographs of a television are out of scope (`§7.6` of the PRD).
   There is no glare, no keystone, no moiré, no motion blur, no
   perspective. This is machine-rendered text on a machine-rendered
   background at native resolution: the easiest possible OCR input.
2. **The accuracy bar is "reviewable", not "unattended".** `A16` /
   `OQ-006` established that there is **no auto-accept tier**: the owner
   reviews every extracted candidate (REQ-013, REQ-017), and in
   full-update mode the review pass shows *every* extracted candidate
   including already-known ones (REQ-057). Errors are visible and
   correctable at the moment they occur. The bar is therefore *"good
   enough that reviewing is not tedious"* (`OQ-011`), not
   *"good enough to trust unattended"*.

Two further constraints narrow the field:

- **`REQ-058` prohibits inferring the streaming service from image
  content.** Any model with broad visual understanding could do this
  incidentally; the extraction contract must not expose it and the
  prompt/response schema must not carry it.
- **TMDB's API terms restrict use "in connection with, including for
  training, a machine learning (ML) or artificial intelligence (AI)
  based Application"** (`evidence/technology-options.md` §5.2). The
  safe reading, and the one this architecture adopts, is that **no TMDB
  content may ever be sent to any AI or vision service, and matching
  must be deterministic rather than model-assisted.** A plain-OCR
  primary keeps nextup furthest from the aggressive reading of that
  clause; an LLM-centred pipeline sits closer to it. This is recorded
  as `RSK-022`.

### Volume assumptions (stated explicitly, as required)

These drive every figure below. There is exactly one owner
(`NFR-017` — allow-list, no self-service registration), so volume is
**structurally bounded**; it cannot grow by user acquisition.

| Scenario | Images | Frequency | Images/month |
|---|---|---|---|
| One-time bulk first import, 2 services | 10–30 per service | Once | ~40–60 (one-off) |
| Ongoing incremental top-up (append-only) | 1–5 | 2–4× / month | 4–20 |
| Periodic full update, per service | 10–30 | ~1× / quarter per service | ~7–20 amortised |
| Re-extraction retries (REQ-074) | ×1.5 multiplier on the above | — | — |
| **Planning figure — steady state** | | | **~50/month** |
| **Planning figure — worst month (bulk import month)** | | | **~150** |

## Options considered

### Option A — Azure AI Vision (Image Analysis 4.0) `Read` OCR

| | |
|---|---|
| Summary | Managed Azure OCR endpoint. Returns lines and words with bounding boxes and reading order. One HTTPS call per image; SDK `@azure-rest/ai-vision-image-analysis`. |
| Pros | **Free tier F0 = 5,000 transactions/month** (20/min), which is ~33× the worst projected month and ~100× steady state. First-class Azure resource, managed identity, no model hosting, no container weight, no cold start of our own. Purpose-built for exactly this input class (rendered UI text). Returns geometry, which makes reading-order and column grouping tractable and helps with `OQ-013` overlap detection. Well-documented, high training-data representation → satisfies `NFR-004`. |
| Cons | Reads **rendered text only**. Title text baked into poster/box artwork as a stylised logotype is artwork, not text, and OCR results on it are unreliable (see `RSK-021`). No semantic understanding — it cannot tell a title from a "Continue watching" heading; that filtering is our code's job. F0 is limited to one free resource per subscription and per region availability. |
| Cost | **$0.00/month on F0** at every projected volume. If F0 is unavailable: S1 pay-as-you-go, ~$1.00–$1.50 per 1,000 transactions → **$0.05–$0.23/month** at 50–150 images. Consumption-billed; no commitment. |
| Reversal cost | **Very low.** One implementation of the `TitleExtractor` interface (US-006 AC-1). |

### Option B — Azure AI Document Intelligence, `prebuilt-read`

| | |
|---|---|
| Summary | The document-oriented OCR model. Same underlying Read engine, richer document structure output. |
| Pros | Free tier F0 = 500 pages/month — still 3× the worst projected month. Strong layout/table output. |
| Cons | **Wrong tool class.** It is optimised for documents, forms and receipts, not application UI grids. Higher per-call latency (async poll-for-result operation, typically seconds), a more complex two-step API, and its layout intelligence buys nothing here — a watchlist grid is not a form. Strictly more operational complexity than Option A for the same underlying text. |
| Cost | $0.00 on F0; S1 ~$1.50 / 1,000 pages → **$0.08–$0.23/month**. |
| Reversal cost | Very low (same interface). |

### Option C — Self-hosted OSS OCR in the application container (Tesseract or PaddleOCR)

| | |
|---|---|
| Summary | Bundle `tesseract`/`tesseract.js` or PaddleOCR into the app container and run inference in-process. |
| Pros | **Zero marginal inference cost, forever, unmetered.** No third-party data egress at all — the owner's screenshots never leave our compute, which is the strongest privacy posture available (`RSK-014`, NFR-011). No external dependency to be unavailable (removes the US-006 AC-4 failure mode for the extraction provider itself). |
| Cons | **The cost does not disappear; it moves into compute and cold start.** Tesseract adds ~50–100 MB plus language data to the image; PaddleOCR realistically adds 500 MB–1.5 GB and a Python/PaddlePaddle or ONNX runtime, and wants ≥2 GiB RAM. On a **scale-to-zero** Container App (ADR-0003) that image weight lands directly on the cold-start path of the value loop — the one thing the architecture is explicitly told to protect. Accuracy on **light-text-on-dark-artwork** streaming UI is Tesseract's known weak spot (Otsu binarisation on low-contrast overlaid text); PaddleOCR is materially better but is the heavier of the two. It also makes the app container a polyglot build, which cuts directly against `NFR-004`/`NFR-002` (one language, boring toolchain, agent-implementable). |
| Cost | $0 inference. **+$0–$5/month** indirect: larger image, higher memory tier, longer cold start (or forcing `minReplicas=1`). Net cost is *not* lower than Option A, and the operational cost is higher. |
| Reversal cost | Low as an implementation, but the container-shape change (base image, runtime, memory) is the part that is annoying to unwind. |

### Option D — Multimodal LLM vision call (Azure OpenAI, `gpt-4o-mini` class)

| | |
|---|---|
| Summary | Send each screenshot to a vision-capable LLM with a prompt asking for a JSON array of title strings. |
| Pros | **Layout and semantic understanding.** It can distinguish list items from chrome, headings and "Continue watching" rails without hand-written heuristics; it degrades gracefully on partial text; and — decisively for `RSK-021` — it can often identify a work from **box artwork with no legible text at all**, which no OCR engine can do. It also naturally emits a clean structured list, removing a whole class of post-processing code (a real `NFR-002` benefit). |
| Cons | **Recurring per-image metered inference — the exact cost shape `NFR-012` is guarding against**, even though it is small here. Non-deterministic output requires schema validation and hallucination guards (an LLM will invent a plausible film title from an ambiguous glyph run — a *silent* wrong candidate, the failure class this project repeatedly refuses to accept, mitigated only by the review pass). Sits closest to the TMDB AI clause (`RSK-022`). Higher and more variable latency (seconds per image; 30 images serially is minutes). Requires an Azure OpenAI resource with model quota — an extra provisioning dependency with no free tier. Broad visual understanding makes accidental `REQ-058` violation possible if the schema is loose. |
| Cost | ~1,100 image tokens for a 1080×1920 screenshot at high detail. At `gpt-4o-mini` rates (with its image-token multiplier) ≈ **$0.005–$0.006/image**; at `gpt-4.1-mini` class rates ≈ **$0.001/image**. → **$0.05–$0.90/month** at 50–150 images; a one-off bulk import of 60 images ≈ **$0.36**. Consumption-billed, no commitment. |
| Reversal cost | Very low as an implementation; the provisioning (Azure OpenAI resource + quota) is the sticky part. |

### Option E — Hybrid: OCR primary, LLM escalation on low yield

| | |
|---|---|
| Summary | Run Option A. If an image yields zero or implausibly few candidates, re-send that image to Option D. |
| Pros | Cheapest common path, best worst-case accuracy. |
| Cons | **Two providers, two failure modes, two prompts, two sets of tests, and a heuristic ("implausibly few") that nobody has data to calibrate** — at the exact moment when the primary path has not yet been observed in production even once. This is premature optimisation of a component whose real-world accuracy is currently unmeasured, and it doubles the extraction surface an autonomous agent has to get right (`NFR-002`). |
| Cost | Option A cost plus a small tail of Option D. |
| Reversal cost | Low, but it is the *option that is cheapest to add later* — which is the argument for not building it now. |

## Decision *(REVISION 1 — SUPERSEDED by Revision 2; retained verbatim)*

**We will use Azure AI Vision (Image Analysis 4.0) `Read` OCR on the
free F0 tier as the sole title-extraction provider for v1, behind the
`TitleExtractor` interface mandated by US-006 AC-1.**

**Projected inference cost: $0.00/month.** Worst realistic month
(~150 images) consumes **3%** of the F0 free allowance of 5,000
transactions/month. If F0 is unavailable in the deployment region or
already consumed elsewhere in the subscription, the paid S1 fallback is
**$0.05–$0.23/month**, consumption-billed with no commitment.

**NFR-012 HOLDS.** It holds with roughly two orders of magnitude of
headroom, and — importantly — **it holds under every option evaluated.**
The worst-priced option in the field (Option D, a multimodal LLM at
`gpt-4o-mini` rates) still lands at **under $1/month**. The fallback to
manual TMDB-search entry is **not** required, the locked cut line is
**not** disturbed, and no escalation is needed.

Why Option A and not the others, in the order the reasons actually
weighed:

1. **The input is the easiest case OCR has.** Pixel-perfect,
   machine-rendered text. Option D's principal advantage — robustness to
   degraded imagery — is an advantage against a problem this project
   deliberately excluded at A15.
2. **The owner reviews everything.** OCR's failure mode (garbled or
   missing text) is *visible*; an LLM's failure mode (a fluent,
   plausible, wrong title) is *invisible until compared against the
   screenshot*. Given a mandatory review pass, the engine whose errors
   look like errors is the safer engine.
3. **Free tier with 33× headroom beats consumption-metered at any
   price.** `NFR-012`'s concern is the *shape* of the cost, not just its
   magnitude. A fixed free allowance that our volume cannot plausibly
   exhaust removes the risk entirely rather than bounding it.
4. **Option C's zero inference cost is illusory.** It relocates the
   cost onto container size and cold start, which is where the value
   loop is most sensitive, and it makes the build polyglot against
   `NFR-004`.
5. **Option E is the right *second* decision, not the first.** It stays
   documented and un-built.

## Consequences

### Priced comparison (the record `OQ-005` was opened to produce)

Volumes: **50 images/month steady state**, **150 in the worst
(bulk-import) month**. All prices are Azure list, USD, unverified this
pass — see *References*.

| # | Option | Unit price | Free allowance | **Steady state (50 img/mo)** | **Worst month (150 img)** | One-off bulk import (60 img) | Accuracy on this input class | Cold-start / latency | Ops complexity |
|---|---|---|---|---|---|---|---|---|---|
| **A** | **Azure AI Vision Read (F0)** | — | **5,000 tx/mo** | **$0.00** | **$0.00** | **$0.00** | High on rendered text; **fails on artwork-only tiles** | ~0.5–1.5 s/image, no self-hosted cold start | **Lowest** — one resource, one SDK call |
| A′ | Azure AI Vision Read (S1 paid fallback) | ~$1.00–1.50 / 1,000 tx | — | $0.05–$0.08 | $0.15–$0.23 | $0.06–$0.09 | same as A | same as A | same as A |
| B | Document Intelligence `prebuilt-read` (F0) | — | 500 pages/mo | $0.00 | $0.00 | $0.00 | same text engine; layout output unused | slower — async poll, ~2–5 s/image | Higher — two-step async API |
| B′ | Document Intelligence (S1 paid) | ~$1.50 / 1,000 pages | — | $0.08 | $0.23 | $0.09 | as B | as B | as B |
| C | Tesseract in-container | $0 inference | unlimited | **$0** direct, **+$0–$5 indirect** | same | same | **Lowest** — weak on light-on-dark, stylised type | **Worst** — adds 50–100 MB to a scale-to-zero image | High — polyglot build, own tuning |
| C′ | PaddleOCR in-container | $0 inference | unlimited | **$0** direct, **+$3–$8 indirect** (memory tier) | same | same | Good on rendered text, better than Tesseract | **Worst** — 0.5–1.5 GB image, ≥2 GiB RAM | **Highest** — Python/ONNX runtime in a Node container |
| D | Azure OpenAI `gpt-4o-mini` vision | ~$0.005–0.006 / image | none | **~$0.28** | **~$0.85** | ~$0.36 | **Highest**, incl. artwork-only tiles; but hallucinates plausible titles | 2–6 s/image, serial batches take minutes | Medium — extra resource + quota, prompt + schema tests |
| D′ | Azure OpenAI `gpt-4.1-mini` class | ~$0.001 / image | none | ~$0.05 | ~$0.15 | ~$0.06 | as D | as D | as D |
| E | Hybrid A → D escalation | A + tail of D | 5,000 tx | ~$0.00–$0.10 | ~$0.00–$0.30 | ~$0.05 | Best available | as A, with a D tail | **Two providers, two failure modes** |

**Bottom line: no option in this field breaches NFR-012.** The spread
between the cheapest and the most expensive credible option is roughly
$0.85/month. Cost is therefore *not* the discriminator; input class,
failure mode and operational complexity are — and all three point at
Option A.

### Positive
- **`OQ-005` closes at $0.00/month.** The last unpriced component in the
  system is priced, and the total architecture cost is now bounded
  (see `architecture.md` §Cost model).
- The **locked MVP cut line is undisturbed.** The manual-entry fallback
  named in `mvp-definition.md` §18 is not triggered.
- No model hosting, no GPU, no Python runtime, no prompt engineering,
  no non-determinism in v1 — a materially smaller surface for an
  autonomous implementer (`NFR-002`, `NFR-004`).
- Deterministic output makes `NFR-003` satisfiable properly: extraction
  can be unit-tested against fixture images with exact expected output,
  which is impossible with a sampled LLM.
- Keeps nextup at maximum distance from the TMDB AI-application clause
  (`RSK-022`): no TMDB content ever reaches an AI service, and matching
  stays deterministic.
- Bounding-box geometry is a free by-product and is the input to the
  recommended `OQ-013` intra-batch overlap collapse and to reading-order
  grouping.

### Negative
- **OCR cannot read a title that was never rendered as text.** Several
  streaming "My List" surfaces present a grid of **box artwork** in
  which the title is part of the image, in a stylised logotype. Against
  those captures this decision produces few or zero candidates and the
  feeder loop degrades to manual entry. **This is the single largest
  residual risk in the architecture** and it is recorded as `RSK-021`
  with `OQ-024`. It is an *accuracy and capture-surface* risk, **not a
  cost risk** — the escalation (Option D) is priced at under $1/month,
  so `NFR-012` survives the escalation too.
- **No semantic filtering.** OCR returns every string on the screen —
  navigation chrome, row headings, "Continue watching", badges, episode
  counts, durations. Our code must filter it, and every filter heuristic
  is a place where a real title is silently dropped. `REQ-012` forbids
  silent discard, so the filter must classify-and-show, never
  drop-and-hide. This is real, un-glamorous work an LLM would have
  absorbed for us.
- **Free-tier fragility.** F0 permits one free resource per subscription
  and is not offered in every region. If the owner's subscription has
  already spent its F0 elsewhere, cost moves to $0.05–$0.23/month. Small,
  but it means "$0" is a configuration property, not a guarantee.
- **Third-party data egress.** The owner's screenshots — which may
  incidentally contain a profile name or account email (`RSK-014`) —
  leave our compute and are sent to an Azure AI service. Option C would
  have avoided this entirely. Mitigated by same-region deployment,
  managed-identity auth and Azure's no-training-on-customer-data
  commitment for AI services, but it is a genuine give-up.
- **Extraction quality is unmeasured.** No candidate in this comparison
  has been tested against a real Netflix or Max screenshot. The choice
  rests on input-class reasoning, not on measurement.

### Neutral / follow-on work required
- **The `TitleExtractor` interface is mandatory, not optional**
  (US-006 AC-1). Contract: `extract(imageBytes, mimeType) →
  ExtractionCandidate[] { rawText, sourceImageId, boundingBox?,
  confidence? }`. The provider name must not appear anywhere outside its
  own module and configuration.
- **`REQ-058` guard:** the extractor's return type has no service field
  and no path by which one could be populated. An automated test must
  assert that the extraction result type carries no service attribute
  (US-038-adjacent).
- **Post-OCR filtering spec is owed to `spec-writer`** (`specs/ai.md`):
  reading-order grouping, chrome/heading rejection, minimum-length and
  glyph-class rules — all of which must *classify and surface*, never
  discard (`REQ-012`).
- **`OQ-013` recommendation** (intra-batch overlap): collapse candidates
  within a batch on resolved `workIdentity` after matching, retaining
  the first occurrence and recording every source image id. Pre-match
  collapse on normalised text is a cheap additional pass. This does not
  need a new provider.
- **`OQ-024` must be answered by the owner in ~10 minutes** — capture
  one Netflix and one Max saved-list screenshot from the phone app and
  from the laptop web app, and confirm whether title text is rendered.
  Recorded as a first-sprint verification task, not a blocker: the
  architecture works either way, only the extractor implementation
  behind the interface changes.
- **Escalation trigger, documented and un-built:** if `OQ-024` resolves
  negative, or if measured extraction yield on real captures is
  intolerable under `OQ-011`, implement Option D as a second
  `TitleExtractor` behind the same interface. Budget impact ≈
  **+$0.30–$0.90/month**. `NFR-012` still holds. No re-architecture.

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **No.** It is close to the cheapest reversible decision in the system. |
| **Cost to reverse** | Hours. One new class implementing `TitleExtractor`, one configuration value, one set of provider tests. No data migration, no schema change, no API change. `ExtractionCandidate` records already persist raw text and their source image, and `REQ-074` re-extraction lets a switched provider be re-run over retained images within the 30-day window. |
| **Trigger to revisit** | (a) `OQ-024` resolves negative — the capture surface is artwork-only; (b) measured yield on real captures makes review intolerable under `OQ-011`; (c) monthly transactions approach 5,000 (they cannot, at one owner); (d) F0 unavailable *and* S1 pricing changes by an order of magnitude; (e) a second `TitleExtractor` becomes necessary for a service beyond Netflix/Max. |

## Compliance and security implications

- **NFR-009 / NFR-010:** unaffected and reinforced. No streaming-service
  credential is involved, and no request is made to any streaming
  service — nextup only ever reads bytes the owner uploaded.
- **NFR-011 / NFR-020:** screenshot bytes are sent to Azure AI Vision
  over TLS using managed identity, from within the same subscription and
  region. They are never made retrievable by URL (see ADR-0006).
- **NFR-005:** the Vision call emits no product analytics. Only
  operational outcome (success/failure/candidate count) is logged.
- **RSK-014 (incidental personal data in screenshots):** a screenshot
  may include a profile name or account email. This is disclosed as a
  give-up above; the 30-day purge (`NFR-019`) bounds retention on our
  side, and the Vision service is not used for model training.
- **RSK-022 (TMDB AI clause):** binding architectural rule established
  by this ADR — **no TMDB content is ever transmitted to any AI or
  vision service, and title→work matching is deterministic** (normalised
  string matching against TMDB search results), never model-assisted.
  Extraction sees only the owner's own screenshot.
- **REQ-058:** enforced structurally by the extractor's return type.

## References

- `Context/open-questions.md` — OQ-005 (opened at A14; relaxed at A15,
  A16), OQ-011, OQ-013, OQ-015
- `Context/mvp-definition.md` §18 — "Unpriced: vision/OCR inference cost
  … the fallback is manual entry with TMDB search"
- `Context/requirements.md` — REQ-008, REQ-012, REQ-013, REQ-017,
  REQ-057, REQ-058, REQ-074, NFR-004, NFR-005, NFR-012
- `docs/PRD.md` §6 US-006, US-007, US-008, US-034; §12.3 R-2, R-6
- `Context/evidence/technology-options.md` §5.2 — TMDB API Terms of Use,
  including the AI-application restriction
- **Pricing provenance:** figures are Azure and Azure OpenAI list prices
  from the architect's model knowledge. **Web retrieval was not
  available to this agent** (`web_fetch`/`web_search` are forbidden for
  the solution-architect role), so no price was re-verified against a
  live pricing page this pass. The decision is robust to being wrong by
  an order of magnitude: even at 10× the quoted rates, every option in
  the field remains under $10/month and the chosen option remains $0 on
  the free tier. **A first-sprint task must re-verify the F0 allowance
  (5,000 tx/month) and regional availability before deployment.**

---

## ⚠ A41 / CC-002 re-examination — 2026-08-10T21:45 — **DECISION STANDS, unchanged**

`NFR-012` was relaxed system-wide (`A41`): quality and reliability now
outrank raw cost everywhere, not only here. This ADR was re-read for
anything decided on price.

**Nothing in Revision 2 was.** `NFR-012a` had already inverted the
ordering for extraction at `A40`, so this ADR was *already* argued
quality-first, and R2.3's four deciding findings (tile-grid layout,
title fidelity feeding a load-bearing matcher, artwork recognition
retiring `RSK-021`, semantic filtering without a chrome vocabulary) are
capability arguments that no budget change can move.

Checked explicitly, and rejected again:

- **Upgrading the model** (`gpt-4o`, an ensemble, or a two-pass read).
  R2.8 already priced these against a *repealed* cost gate and found
  they buy nothing measurable on this input class — `gpt-4o` is ~26 %
  dearer for no gain, and an ensemble duplicates what the free OCR
  cross-check already provides. **That finding was never cost-driven**:
  it was "no measurable quality gain". It stands.
- **Azure AI Vision `Read` S1 instead of F0.** F0 is not chosen for
  price *at the expense of* anything — S1 is the identical model with a
  higher quota. Staying on F0 with a priced S1 fallback is correct.
- **The `NFR-012a` warning at the point of configuration** — that a
  cost-motivated model downgrade is explicit non-compliance — is
  **strengthened**, not weakened, by A41: there is now even less reason
  to downgrade.

**Cost unchanged: ~$0.50–$0.70/month.** `RSK-028` and `TASK-134`
(abuse-monitoring exemption) are unaffected.

---

## Addendum — 2026-08-17: live pricing verification (TASK-010)

Every figure below was read from the **Azure Retail Prices API**
(`https://prices.azure.com/api/retail/prices`, `api-version=2023-01-01-preview`)
for **`eastus2`** on **2026-08-17**, and availability from `az cognitiveservices`
/ `az sql db list-editions` against the live subscription. This supersedes the
"recalled from model knowledge, UNVERIFIED" provenance note that stood before.
### Extraction — verified

| Item | Published | Verified `eastus2`, 2026-08-17 |
|---|---|---|
| `gpt-4.1` availability | assumed | ✅ `gpt-4.1` **2025-04-14**, SKUs `Standard` **and** `GlobalStandard` |
| `gpt-4.1` input tokens | — | **$0.0022 / 1K** regional (`$0.0020` global) |
| `gpt-4.1` output tokens | — | **$0.0088 / 1K** regional (`$0.0080` global) |
| Cost per screenshot | ~$0.0094 | **~$0.0070** (≈2,000 in + 300 out) |
| ~50 images/month | ~$0.47 | **~$0.35** |
| Azure AI Vision Read **F0** | free, must exist | ✅ `F0` offered for kind `ComputerVision` in `eastus2` |

**Extraction is CHEAPER than published, and `NFR-012a` is unaffected** — no
quality lever was touched to get there. `gpt-4.1` remains the primary reader on
`Standard` PAYG; nothing here justifies a downgrade.

### ⚠ Trap for whoever re-runs this

**Azure OpenAI no longer bills under `serviceName eq 'Azure OpenAI'`.** The
retail API now files these meters under **`serviceName eq 'Foundry Models'`**
with `productName eq 'Azure OpenAI'`. A verification query written against the
old service name returns **zero rows**, which reads exactly like "the model is
not available in this region" rather than "your filter is stale". That
misreading would push a future reviewer toward an unnecessary region change or
a model downgrade.
