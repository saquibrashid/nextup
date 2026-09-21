# Where the false titles actually come from — 2026-09-21

**Finding: the offline golden harness cannot reproduce the live false-title
problem, so deterministic rules tuned against it cannot fix that problem.**

This closes the "keep shipping deterministic rules" half of the
`extraction-regression` investigation with a **negative** result, which is
worth more than the rule it was going to produce: it stops a rule being
written against a corpus that does not contain the defect.

No code changed. No metric, floor or pin moved.

## 1. The two numbers do not agree

| Source | False-title rate | Against the ≤ 0.10 ceiling |
| --- | --- | --- |
| **Offline** (recorded fixtures, `tests/extraction/golden.spec.ts`) | **0.0545** | ✅ passes, with room |
| **Live** `gpt-4.1` (`docs/evaluation/golden-2026-09-18.md`) | **0.179 / 0.132 / 0.093** | ❌ fails 2 of 3 runs |

The offline figure is **exactly 3/55**, which matches the committed pin
`FALSE_TITLE_MEASURED = 0.05454545454545454` to the last digit. That agreement
is what makes the rest of this note trustworthy: the instrumentation used here
is the same pipeline the pinned metric measures, not a re-implementation.

⚠ **So the offline corpus is already comfortably inside the ceiling the live
runs fail.** The gap is not missing post-processing. It is what the live model
emits on the day, which the pinned `llm` recordings — captured once — do not
carry. Any deterministic rule developed offline will be measured against a
0.0545 baseline and will look like it works while changing nothing live.

## 2. There are only three false titles offline, and they are not chrome

Every `title-candidate` in the corpus that is neither an expected title nor
expected chrome:

| Provider | OCR confidence | Image | Text |
| --- | --- | --- | --- |
| `llm` | 0.950 | `netflix-continue-watching-01` | `in the shadow of dante` |
| `llm` | 1.000 | `max-saved-desktop-01` | `true detective night country` |
| `ocr-only` | 0.552 | `max-saved-mobile-01` | `og studios` |

**Two of the three are the primary reader's, at confidence 0.95 and 1.00.**
`in the shadow of dante` is a misread of *In the Hand of Dante*; `true
detective night country` is a real work the answer key does not list for that
image. Neither is reachable by any chrome vocabulary, any confidence gate, or
any OCR-scoped rule — steps 3 and 4 of §3.2 are `ocr-only`-scoped precisely so
they cannot touch the primary reader.

## 3. The confidence lever was measured, and it is not worth pulling

Confidence separates cleanly at the low end. Across all 111 `ocr-only`
candidates:

| Class | n | min | p10 | median | max |
| --- | --- | --- | --- | --- | --- |
| Expected titles | 17 | **0.991** | 1.000 | 1.000 | 1.000 |
| Expected chrome | 67 | 0.632 | 0.984 | 0.994 | 0.998 |
| False titles | 27 | 0.509 | 0.611 | 0.799 | 0.998 |

**No expected `ocr-only` title sits below 0.991.** That looks like a free win,
and it is not. Sweeping a reclassification threshold across 0.60 → 0.99:

| Threshold | False `title-candidate`s caught | Expected titles lost |
| --- | --- | --- |
| 0.60, 0.65, 0.70, 0.80, 0.90, 0.95, 0.98, 0.99 | **1** | **0** |

**One title, at every threshold.** The other low-confidence false reads are
already classified `low-confidence` or `chrome-suspected`, and neither verdict
counts toward the false-title numerator. §9.7's own noise band calls a
sub-two-title delta **"no measured difference"**, so this would buy a change
that the protocol forbids reporting as an improvement — at the cost of a new
tuned constant standing between the owner and a real title forever.

⚠ **`EXTRACT_CONFIDENCE_FLOOR` must not be raised to collect that one title
either.** `thresholds.ts` states it is *"A FLAG ON A VISIBLE CANDIDATE, NEVER
AN EXCLUSION… Using it as a filter would make a heuristic silently delete real
titles, which is the single failure class this product exists to avoid."*
The one item in question, `og studios` at **0.552**, clears the existing 0.55
floor by 0.002 — it is a boundary artifact, and moving a floor to capture a
boundary artifact is tuning a constant to move a metric.

## 4. A real pattern, recorded rather than acted on

There is a `<garbage> studios` family across three different images — OCR
misreads of studio attribution painted on artwork:

| Image | Text | Current verdict |
| --- | --- | --- |
| `max-saved-mobile-01` | `og studios` | `title-candidate` ⚠ |
| `max-saved-desktop-01` | `kbs studios` | `low-confidence` |
| `rotated-01` | `co studios` | `low-confidence` |

⚠ **Do NOT add these to `chromeTerms`.** Step 3 is an exact line match by
design, and these strings are *unstable garbage* — the same pixels read `OG`,
`CO` and `KBS` on three images, and a fourth run will produce a fourth
spelling. Enumerating a misread is the one lesson `chromeTerms` already
carries twice (`my watchlist` over `watchlist`, `new season` over `new`) but in
reverse: those entries are stable UI strings, and these are not. A
`/\bstudios?\b/` substring rule is likewise excluded by the same header
warning that forbids substring tests, since it would suppress a work legitimately
named with that word.

## 5. What this means for the open work

1. **`extraction-regression` — the deterministic-rule half is answered: there
   is no rule to write here.** Two of three offline false titles are the
   primary reader's own output at ≥ 0.95 confidence, and the offline rate
   already passes the ceiling. Effort belongs on the live/model side, which is
   the bake-off's open owner decision
   (`docs/evaluation/model-bakeoff-2026-09-21.md`).
2. **`metric-band` is strengthened, and its scope is now evidenced.** An exact
   pin against recorded fixtures tracks the recordings, not the product: the
   pin reads 0.0545 while live reads 0.093–0.179. That is the argument for a
   tolerance band, and it should be re-scoped with the owner around this gap
   rather than around pin brittleness alone.
3. **The recordings are stale relative to live behaviour** and nothing
   currently detects that. Re-recording the `llm` fixtures would move the
   offline metrics toward live — and would also rewrite the baseline the pins
   protect, so it is an owner decision, not a maintenance step.
