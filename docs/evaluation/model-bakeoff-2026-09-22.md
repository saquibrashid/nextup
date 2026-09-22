# Model bake-off — 2026-09-22

> **Outcome: no change. `gpt-4.1` remains the primary reader.**
>
> ⚠ **THIS TIME THE RULE ACTUALLY DECIDED IT.** `model-bakeoff-2026-09-21.md`
> recorded "no change" because `chooseReader.ts` refused `gpt-6-astra` at
> Stage 0 on a rule §9.7 had already deleted, and it closed by demanding *"a
> fresh, complete run"* before the incumbent could be considered safe. This is
> that run. Both arms were re-measured against the live providers on
> 2026-09-21/22, both emit the full Stage 3 metric set, and the verdict below
> is `chooseReader`'s own output — not a reading of the tables.
>
> ⚠ **AND IT IS A MUCH CLOSER CALL THAN "NO CHANGE" SOUNDS.**
> `probe-gpt-6-astra` **wins four rows measurably, ties three, and loses
> exactly one** — fabrication rate, 0.0482 vs 0.0247. §9.7 Stage 3 requires a
> challenger to win or tie on *every* row, so one regression is decisive and
> the incumbent stays. That is the rule working as pre-committed, and it must
> not be talked around. But the honest summary is **"the challenger was
> stopped by one row"**, not "the challenger was not good enough".

Required by `specs/ai.md` §9.7 ("**including when the decision is 'no change',
which is a result worth recording and not a wasted run**").

---

## 1. Arms measured

Both are real, billed runs of `npm run golden:live` over the 11-image golden
corpus, 3 runs each, through the real `EXTRACTION_SYSTEM_PROMPT`, real
`TILE_SCHEMA`, real `detail: 'high'`. Reports and `.metrics.json` companions
committed alongside this one.

| Arm | Report | Notes |
| --- | --- | --- |
| `gpt-4.1` (incumbent) | `golden-2026-09-21.md` | `temperature: 0`, `seed`, `max_tokens` |
| `probe-gpt-6-astra` (challenger) | `golden-2026-09-22-probe-gpt-6-astra-t1.md` | **`temperature: 1`** — it accepts no other value; `max_completion_tokens` |

⚠ **The incumbent baseline was re-run first, and that mattered.** The previous
bake-off compared against `golden-2026-09-18.md`, which predated `recently
added` entering `chromeTerms`. Re-measuring moved the incumbent's L5 from
0.1786 / 0.1321 / 0.0926 to 0.1020 / 0.1296 / 0.0926 and made a class of
truncation defects disappear entirely. Judging a challenger against the stale
figures would have overstated its margin on exactly the row it wins most.

## 2. The decision, as `chooseReader` returned it

`outcome: "incumbent-stays"`, `primaryReader: "gpt-4.1"`,
`costIsNeverDecisive: true`.

| Row | Incumbent `gpt-4.1` | Challenger `gpt-6-astra` | Status | Δ titles |
| --- | --- | --- | --- | --- |
| Omission recovery | 0.5000 | **1.0000** | tied¹ | 0 |
| Fabrication rate | **0.0247** | 0.0482 | ⛔ **worse-than-incumbent** | 1.57 |
| Title recall (aggregate) | 0.9104 | **1.0000** | better-measurably | 6.00 |
| Artwork-only recall | 0.8571 | **1.0000** | better-measurably | 9.57 |
| False-title rate | 0.1020 | **0.0645** | better-measurably | 2.51 |
| Chrome rejection | 0.8354 | **0.8987** | tied² | 0 |
| Run-to-run stability (Jaccard) | 0.7949 | **0.9032** | better-measurably | 7.26 |
| L3 unstable titles | 0.0000 | 0.0000 | tied | 0 |

¹ Scored `tied` because the row is a REQ-012 floor at exactly 1.0, not an
incumbent comparison. ⚠ **The incumbent sits at 0.5 on it.** That is not a
challenger problem and it is not gated here, but it should not pass unnoticed:
the one §9.7 row with *no trade and no exception* is half-met by the reader
that ships.

² Chrome rejection has a floor but no incumbent comparison in §9.7.

**Reasons returned:**

1. `probe-gpt-6-astra does not win or tie on every row, so the incumbent stays (§9.7 Stage 3).`
2. `Fabrication rate is worse than the incumbent (0.0482 vs 0.0247). A mixed result means the incumbent stays.`

## 3. What the challenger would have bought

Recorded because a future bake-off should not have to re-derive it, and because
the margin is large enough that the single blocking row is worth attacking
directly.

- **`netflix-continue-watching-01` recall 0.000 → 1.000.** The incumbent misses
  `in the hand of dante` in every run on every image it appears on, and emits
  `in the shadow of dante` in its place. The challenger reads it.
- **`max-saved-desktop-01` `true detective`** — missed 3 of 3 by the incumbent,
  found by the challenger.
- **L2 stability 0.7949 → 0.9032**, with one pair at 1.0000.
- **L5 0.1020 → 0.0645**, clearing a ceiling the incumbent breaches on two of
  three runs.

⚠ **The challenger reintroduces the truncation stumps.** `dr strangelove or how
i lear` and `hitchhiker s guide to the` appear in 3 of 3 challenger runs — with
`truncated-titles-01` at recall **1.000**, so they sit *alongside* the full
titles, not instead of them. It also merges two tiles into one row (`lord of
the rings the fell everything everywhere all at o`). This is precisely the
shape `T-AI-059` pins: these are real extra junk rows and must not be excused
as double counts.

## 4. Cost

| Arm | L7 figure | Basis |
| --- | --- | --- |
| `gpt-4.1` | $0.2053 | its own list price |
| `probe-gpt-6-astra` | $0.3808 | ⚠ `gpt-4.1` rates on `gpt-6-astra` tokens |

⚠ **$0.3808 is NOT what `gpt-6-astra` costs**, and the ratio is not a cost
multiple — L7 prices every arm at the incumbent's card so the figure tracks
*token volume*, which is what drift detection needs. The challenger used 1.45×
the prompt tokens and 2.39× the completion tokens. Its real price is still
unmeasured. Per §9.7 and NFR-012a this is moot for the decision —
`costIsNeverDecisive: true` — and it is recorded only so nobody reads the
larger number as the reason for "no change". **It was not the reason.**

## 5. Follow-ups this run opens

1. **Fabrication is the only thing between the challenger and promotion.**
   0.0482 also sits under 5 % of margin on the L4 ceiling of 0.05, so it is
   thin in absolute terms as well as relative. A prompt or cross-check change
   that lowers it would flip this decision on the next run.
2. **The incumbent's omission recovery is 0.5** against a REQ-012 floor of 1.0.
3. **The incumbent's L5 still breaches on runs 1 and 2** (0.1020, 0.1296), and
   four of its eight named false titles are near-variants of a title missed on
   the same image in the same run — the open double-count question recorded in
   `bandAchievability.spec.ts`.
