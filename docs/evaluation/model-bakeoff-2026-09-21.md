# Model bake-off — 2026-09-21

> ⚠ **SUPERSEDED BY `model-bakeoff-2026-09-22.md`.** The fresh, complete run
> this document demanded has been done: both arms re-measured live, full
> Stage 3 metrics emitted, and the decision returned by `chooseReader` rather
> than read off a table. The outcome is unchanged (`gpt-4.1` stays) but the
> *reason* is finally the real one — `gpt-6-astra` clears Stage 0, wins four
> Stage 3 rows and loses exactly one (fabrication rate). Read this file only
> for the history of how the Stage 0 defect was found.

> **Outcome: no change. `gpt-4.1` remains the primary reader.**
>
> ⚠ **CORRECTION, 2026-09-21 (later the same day). The reason recorded below
> for "no change" was WRONG, and the conclusion is now weaker than it reads.**
> This document reported `gpt-6-astra` as disqualified at **Stage 0** on
> `temperatureZero`. That was the **stale code's** verdict, not the spec's:
> `specs/ai.md` §9.7 removed `temperature: 0` from Stage 0 on **2026-09-19**,
> two days before this run, and `chooseReader.ts` had not been updated. Under
> §9.7 **as it actually stands, `gpt-6-astra` clears Stage 0**, meets every
> quality floor, and is the most stable arm measured. The correct reading of
> this bake-off is therefore: **no eligible challenger was CARRIED to Stage 3,
> because the implementation refused one on a deleted rule** — not that none
> existed. Corrected in place per §5 of the repository instructions;
> superseded text below is struck through, not deleted.
>
> ⚠ **This does NOT promote `gpt-6-astra`.** §9.7: *"Any bake-off must still be
> run fresh, after this commit."* The arms here were run against the stale
> gate, and Stage 3 needs `omissionRecovery`, `stabilityJaccard` and
> `costUsdPerImage`, which this report still does not emit. The incumbent
> stays until a fresh, complete run says otherwise.
>
> ⚠ ~~That is not an endorsement, and this document exists mainly to say so.~~
> The incumbent **fails two of its own §9.7 quality floors**, and ~~the only arm
> that passes every floor is excluded by a **Stage 0 capability gate**, not on
> quality~~ **the arm that passes every floor was excluded by a Stage 0 gate
> §9.7 no longer contains**. "No change" here means *no eligible challenger
> reached Stage 3* — it does **not** mean the incumbent was found adequate.

Required by `specs/ai.md` §9.7 ("**including when the decision is 'no change',
which is a result worth recording and not a wasted run**"). The 2026-09-08
probe was run ad hoc and left no artefact, and §9.7 names that as the exact
failure this file prevents.

---

## 1. Arms measured

All three are real, billed runs of `npm run golden:live` over the 11-image
golden corpus, 3 runs each, through the real `EXTRACTION_SYSTEM_PROMPT`, real
`TILE_SCHEMA`, real `detail: 'high'`. Reports committed alongside this one.

| Arm | Report | Notes |
| --- | --- | --- |
| `gpt-4.1` (incumbent) | `golden-2026-09-18.md` | `temperature: 0`, `seed`, `max_tokens` |
| `gpt-5.4` | `golden-2026-09-19-probe-gpt-5-4.md` | `temperature: 0` |
| `gpt-6-astra` | `golden-2026-09-19-probe-gpt-6-astra-t1.md` | **`temperature: 1`** — it accepts no other value |

## 2. Per-run metrics, against §9.7's floors

Floors from `packages/domain/src/extraction/chooseReader.ts` (`ROWS`).

### Title recall — floor **≥ 0.95**

| Run | `gpt-4.1` | `gpt-5.4` | `gpt-6-astra` |
| --- | --- | --- | --- |
| 1 | 0.9104 ❌ | 0.9552 ✅ | 0.9851 ✅ |
| 2 | 0.9104 ❌ | 0.9552 ✅ | 0.9851 ✅ |
| 3 | 0.9254 ❌ | 0.9403 ❌ | 0.9851 ✅ |

### False-title rate — ceiling **≤ 0.10**

| Run | `gpt-4.1` | `gpt-5.4` | `gpt-6-astra` |
| --- | --- | --- | --- |
| 1 | 0.1786 ❌ | 0.1449 ❌ | 0.0952 ✅ |
| 2 | 0.1321 ❌ | 0.1061 ❌ | 0.0806 ✅ |
| 3 | 0.0926 ✅ | 0.1324 ❌ | 0.0806 ✅ |

### Fabrication rate — ceiling **≤ 0.05**

| Run | `gpt-4.1` | `gpt-5.4` | `gpt-6-astra` |
| --- | --- | --- | --- |
| 1 | 0.0253 ✅ | 0.0529 ❌ | 0.0473 ⚠ |
| 2 | 0.0125 ✅ | 0.0595 ❌ | 0.0479 ⚠ |
| 3 | 0.0127 ✅ | 0.0536 ❌ | 0.0476 ⚠ |

⚠ **`gpt-6-astra` passes this ceiling with under 5 % of margin on all three
runs.** It is a pass, and it is thin enough that it must not be reported as a
comfortable one: a corpus of 11 images cannot distinguish 0.048 from 0.052.

### Chrome rejection

| Run | `gpt-4.1` | `gpt-5.4` | `gpt-6-astra` |
| --- | --- | --- | --- |
| 1 | 0.8101 | 0.9114 | 0.9114 |
| 2 | 0.8228 | 0.9114 | 0.8987 |
| 3 | 0.8354 | 0.8987 | 0.9114 |

### `netflix-artwork-only-01` (L6)

Identical across all three arms — recall 0.800, every other figure 1.000. That
is **exactly** the §9.7 floor (0.8), passed at the boundary by all three; the
artwork-only fixture does not separate these models.

## 3. Cost

⚠ **The cost figures in all three reports use ONE price card — `gpt-4.1`'s —
and are therefore NOT comparable as money.** L7 is a regression guard on
prompt and token *growth*; holding the card fixed is what makes two reports
comparable on token volume, which is the only thing the guard can see.

| Arm | Reported | What it means |
| --- | --- | --- |
| `gpt-4.1` | $0.2024 | Real, since the card is this model's |
| `gpt-5.4` | $0.2243 | `gpt-4.1` rates on `gpt-5.4` tokens |
| `gpt-6-astra` | $0.3783 | `gpt-4.1` rates on `gpt-6-astra` tokens |

⚠ **$0.3783 against $0.2024 is NOT a 1.9× cost increase, and was read as one
during this investigation.** It is the same prices applied to more tokens —
1.45× the prompt tokens (58 161 → 84 087) and **2.44×** the completion tokens
(10 759 → 26 262), and completion is priced 4× higher, which is where the
1.87× arithmetic comes from. The true multiple is **unmeasured** and
estimated substantially
higher. `T-AI-056` now forces every report on a non-incumbent arm to say this
in the file, and the two probe reports were corrected retrospectively.

⚠ Per **NFR-012a**, cost cannot decide this anyway: *"quality outranks cost…
no model may be downgraded in order to reduce the ordinary per-image cost.
That is explicit non-compliance."* Cost is reported, never decisive.

## 4. Why the decision is "no change"

⚠ **CORRECTED 2026-09-21. The superseded reasoning is struck through below;
read this paragraph as the operative one.**

`gpt-6-astra` is the only arm meeting every floor. It was **refused by
`chooseReader.ts` at Stage 0 on `temperatureZero`** — but that key had been
removed from §9.7's Stage 0 list on **2026-09-19**, two days before this run,
and the code had not been updated (repaired 2026-09-21; guarded by
`T-AI-045x`/`y`/`z`/`aa`). **Under §9.7 as written, no capability gate excludes
it.** What actually prevents a Stage 3 decision here is narrower and entirely
procedural: the three Stage 3 inputs — `omissionRecovery`, `stabilityJaccard`
and per-image `costUsdPerImage` — are **not emitted by `golden:live`**, and
§9.7 requires any bake-off informing a change to be run **fresh, after the
2026-09-19 revision**. These arms were not. **The incumbent therefore stays by
default, not on the merits**, and this is the weakest form of "no change" the
protocol admits.

~~`gpt-6-astra` is the only arm meeting every floor, and it is **disqualified at
Stage 0** — not on quality, but on `temperatureZero`, a member of
`REQUIRED_CAPABILITIES` in `chooseReader.ts`. It accepts only
`temperature: 1`. The same gate excludes `gpt-5.6-sol` and `gpt-5.5`; of the
frontier candidates only `gpt-5.4` clears it, and `gpt-5.4` fails the
fabrication ceiling on all three runs and the recall floor on one.~~

~~So no arm reaches Stage 3, and Stage 3 is where a challenger could replace the
incumbent. Under the protocol as written, the incumbent stays.~~

⚠ The surviving half of the struck text is still true and still matters:
`gpt-5.4` **fails the fabrication ceiling on all three runs** and the recall
floor on one, so it is not a candidate on quality regardless of any gate.

## 5. Findings the owner needs, which this outcome would otherwise bury

**F1 — the incumbent fails two of its own floors.** `gpt-4.1` misses the
recall floor on **all three** runs (0.910/0.910/0.925 against ≥ 0.95) and the
false-title ceiling on **two of three** (0.179/0.132 against ≤ 0.10). "Retain
the incumbent" is therefore **not a safe status quo**, and the open
`extraction-regression` investigation should be re-framed: this may never have
been a regression at all, but floors set from a luckier sample than the corpus
now contains.

**F2 — ~~`temperatureZero` is deciding this bake-off, and it is a determinism
gate, not a quality one.~~ `temperatureZero` decided this bake-off IN THE CODE
AFTER THE OWNER HAD ALREADY REMOVED IT FROM THE SPEC.** ⚠ **Corrected
2026-09-21: the finding below framed as an "owner decision" one that had been
made two days earlier** — §9.7 demoted `temperature: 0` to a Stage 2
measurement on 2026-09-19, replacing it with a Stage 3 **L3 unstable-titles**
band, and `chooseReader.ts` kept enforcing the deleted rule. The real finding
is not about determinism policy at all; it is that **the decision function had
drifted three revisions behind the spec it claims to transcribe, and the test
suite pinned the stale values so CI stayed green on them.** That is the
defect. ~~Whether a determinism requirement should outrank a measured quality
floor is an **owner decision**, and it is the decision this bake-off actually
surfaces.~~

The measurement below stands and is now the *supporting* evidence for the
2026-09-19 revision rather than an argument for making it:

~~It exists so runs are reproducible.~~ It was ~~currently~~ excluding the only
arm that satisfies every quality floor, including a **7.5 point** recall
improvement over the incumbent — far outside §9.7's two-title noise band.

⚠ **~~But relaxing it is not free, and the data says so.~~ The stability cost
of relaxing it was measured, and it is the opposite of what was feared.**
`gpt-6-astra` at `temperature: 1` produced **intermittent misses** — `stranger
things vhs special edition` missed in 2 of 3 runs, `louis c k ridiculous` in 1
of 3. Its aggregate recall was nonetheless identical across all three runs
(0.9851 ×3), and its L3 table ("unstable titles") reads `None`. ⚠ **L3 is not
evidence of determinism here**: it reads `None` for all three arms, including
both `temperature: 0` arms, so it does not discriminate — and `gpt-4.1` and
`gpt-5.4` produced intermittent misses of their own at `temperature: 0`
anyway. ⚠ **Measured L2 (worst pairwise Jaccard, 3 runs × 11 images) DOES
discriminate, and it ranks the sampling arm FIRST:** `gpt-4.1` **0.7692** at
`temperature: 0`, `gpt-5.4` 0.8205 at 0, `gpt-6-astra` **0.8750** at forced
`temperature: 1`. §9.7's conclusion, in its own words: *"A gate cannot be
justified by a property its own subject fails and its excluded candidates
satisfy."* ~~The honest summary is that **this corpus cannot separate the arms on
run-to-run stability**, and a determinism gate being decided on non-discriminating
evidence is precisely the thing to put in front of the owner rather than
resolve here.~~

**F3 — the corpus is too small to separate close arms.** 11 images. §9.7's own
rule says any conclusion drawn from a difference smaller than two titles must
say so. F1's recall gap is well outside that band; `gpt-6-astra`'s fabrication
margin is well inside it.

**F4 — part of the false-title rate is the fixture, not the model.** All three
arms score **identically** on `truncated-titles-01` — recall 0.750, false-title
rate 1.000, on every arm. That fixture exists to present truncated on-screen
text, so every arm is penalised by the same corpus property and the
false-title comparison *between* arms is narrower than the raw aggregates
suggest. It also means the open truncated-prefix defect is **not** a
model-selection problem and will not be fixed by changing reader.

⚠ The by-name L5 lists differ between the reports here (the two truncated
strings `dr strangelove or how i lear` and `hitchhiker s guide to the` are
named in the `gpt-4.1` and `gpt-6-astra` reports but not the `gpt-5.4` one,
whose identical 1.000 rate on that image implies false titles it does not
list). **Treat the per-image rate table as authoritative and the by-name list
as indicative** until that discrepancy is explained; it is a reporting
question, not a model finding.

⚠ **The §9.7 decision function was NOT run to produce this outcome, and could
not honestly have been.** `chooseReader()` requires `omissionRecovery`,
`stabilityJaccard` and a per-image `costUsdPerImage` per arm; none of the three
is measured by the current `golden:live` report, and supplying invented values
would yield a fabricated decision carrying a function's authority. ⚠
**CORRECTED 2026-09-21: the sentence that followed said this was "moot
regardless" because Stage 0 short-circuits. It is the reverse — those three
unmeasured inputs are now the ONLY thing standing between this data and a
Stage 3 decision.** ~~It is moot regardless: the Stage 0 disqualification is
reached **before** any metric is consulted, so the outcome does not turn on the
unmeasured inputs. If §9.7 is ever amended per F2, those three fields must be
emitted by the report first.~~ §9.7 was amended on 2026-09-19, so **emitting
those three fields from `golden:live` is now on the critical path** for any
reader change, and `stabilityJaccard` is already computable from the L2 data
the report gathers.

## 6. What this does NOT change

- No quality floor, noise band or recorded result is altered here.
- The production model is unchanged; ADR-0001 needs no revision, since a
  revision is required only for a *change* of reader.
- `infra/ai.bicep` / `infra/main.bicep` still carry
  `bakeOffModelName = 'gpt-5.4-mini'`, and the `probe-gpt-6-astra` and
  `probe-gpt-5-4` deployments still exist. Reconciling or deleting them is
  outstanding and is **not** blocked on the decision above.

## 7. Open, and owner-facing

⚠ **CORRECTED 2026-09-21. Item 2 was not open — the owner closed it on
2026-09-19 and only the code disagreed. It is struck through and replaced by
the question the repair actually leaves behind.**

1. Keep `gpt-4.1` and attack the missed floors with deterministic rules?
   ⚠ **Partly answered since**: `docs/evaluation/false-title-offline-vs-live-2026-09-21.md`
   measures the offline false-title rate at **0.0545** against live
   0.179/0.132/0.093, with only 3 false titles offline — **2 of them the
   primary reader's own output at confidence 0.95 and 1.00**. The deterministic
   half has very little left to catch; the remaining mass is model-side.
2. ~~Demote `temperatureZero` from a Stage 0 disqualifier to a **reported
   property**, unblocking `gpt-6-astra` and every other frontier model?~~
   **DONE — decided by the owner 2026-09-19 in `specs/ai.md` §9.7, implemented
   in `chooseReader.ts` 2026-09-21.** The replacement question: **run a fresh
   §9.7 bake-off now that Stage 0 admits the frontier arms**, which first
   requires `golden:live` to emit `omissionRecovery`, `stabilityJaccard` and
   `costUsdPerImage`.
3. Measure `gpt-6-astra`'s real cost against its own price card before
   deciding, now that the token figures are known not to be cost figures?
   (Still open, and now blocking: it is one of the three Stage 3 inputs.)

None of these can be settled from the data; all three are recorded here so the
next run starts from the measurement rather than from the argument.
