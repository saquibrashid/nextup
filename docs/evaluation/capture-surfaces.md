# OQ-024 — capture-surface check (TASK-011)

**Date:** 2026-09-08
**Method:** direct inspection of seven owner captures, one per surface plus
two extra Netflix desktop captures and a Continue Watching row.
**Status:** OQ-024 **answered**. Two spec corrections and one deletion follow
from it; all three are applied.

---

## 1. The answer

| Service | Surface | Renders titles as | Evidence fixture |
| --- | --- | --- | --- |
| Netflix | mobile (iOS app) | **Text** beside artwork | `netflix-mylist-mobile-01.jpg`, `-02.jpg` |
| Netflix | desktop (web) | **ARTWORK ONLY** — no captions at all | `netflix-artwork-only-01.png`, `netflix-mylist-desktop-01.heic` |
| Max | mobile (iOS app) | **Text** beside artwork | `max-saved-mobile-01.jpg` |
| Max | desktop (web) | **Text** caption below artwork | `max-saved-desktop-01.heic` |

**Three of four surfaces render text. Exactly one does not: Netflix on the
web.** On `netflix-artwork-only-01.png` all **10** tiles are artwork with no
caption of any kind — the only text on the page is chrome ("My List", the
profile menu, navigation).

## 2. What this changes

### 2.1 RSK-021 is real, but it was attached to the wrong service

`specs/ai.md` §9.4 named `max-artwork-only-01.png` as the headline `RSK-021`
fixture and called it "the single most likely implementation error in this
revision". The risk is real and the framing was right — but **Max was the
wrong service**. Max shows a text caption on *both* of its surfaces; it is
Netflix's web player that shows none.

The fixture is renamed **`max-artwork-only-01.png` → `netflix-artwork-only-01.png`**
with `expectedTitleCount: 10`. `T-AI-035`'s ≥ 0.80 recall gate, the
`basis: 'artwork'` requirement and the `inferred-unverified` verdict are all
unchanged — only the file and the service attribution move.

⚠ **Do not "correct" this back.** A reader who knows Max's mobile app will
recognise the text captions and may assume the Netflix naming is the typo. It
is not; it is the measurement.

### 2.2 `dark-mode-01.png` is deleted, not deferred

Neither service exposes a light mode on either surface. Every capture the
owner can take is already dark, so a "dark mode" fixture would have been an
eleventh near-duplicate of the corpus rather than a variant of it — it would
have consumed a bake-off slot and ~6 vision calls per run to test nothing.

**The corpus is therefore 11 images, not 12.** That number is load-bearing in
code: `BAKEOFF_CORPUS_IMAGES` in
`packages/domain/src/extraction/chooseReader.ts` exists so that a run against
a different corpus size is flagged rather than silent. It is updated to `11`
in the same change. Had it been left at `12`, every future bake-off report
would have carried a permanent false "off-corpus" warning — which is how a
real one stops being read.

### 2.3 Two fixtures are photographs of a monitor, and that must be recorded

`netflix-mylist-desktop-01.heic` and `max-saved-desktop-01.heic` are **photos
of a screen**, not screenshots — which is why they are HEIC. They carry bezel,
glare, keystone distortion and a mouse cursor.

That is legitimate coverage of a real capture path, and it exercises the
REQ-077 HEIC transcode on genuine device files. But it means **a recall miss
on either image must be diagnosed as capture quality before it is attributed
to the reader.** For the Netflix desktop surface the clean control is
`netflix-artwork-only-01.png`, a true screenshot of the same surface; there is
no clean control for Max desktop.

## 3. Fixture provenance

All seven images below are the owner's own captures of the owner's own
accounts, and all are committed to a **public** repository.

| File | Format (magic bytes) | Capture | Notes |
| --- | --- | --- | --- |
| `netflix-mylist-mobile-01.jpg` | JPEG | iPhone screenshot | My List, page 1 |
| `netflix-mylist-mobile-02.jpg` | JPEG | iPhone screenshot | My List, page 2 |
| `netflix-mylist-desktop-01.heic` | HEIC | photo of monitor | glare, keystone, cursor |
| `netflix-continue-watching-01.jpg` | JPEG | iPhone screenshot | chrome-heavy; 1 tile |
| `max-saved-mobile-01.jpg` | JPEG | iPhone screenshot | — |
| `max-saved-desktop-01.heic` | HEIC | photo of monitor | glare, keystone |
| `netflix-artwork-only-01.png` | PNG | PC screenshot | clean; 10 artwork-only tiles |

⚠ **Formats were established by magic bytes, never by file extension.** Per
invariant 11 this is the only sound method: the owner's iPhone delivers JPEG
here even though ASM-058 originally reasoned that iOS screenshots are PNG.

### 3.1 Privacy check — performed, and it is not optional

TASK-151 previously shipped a fixture carrying **real GPS coordinates into
this public repo**; it had to be redacted in place afterwards. Both images
added at TASK-011 were therefore probed structurally with
`tests/fixtures/golden/ingest/exifProbe.ts` before being committed:

| File | GPS | EXIF/TIFF | Free-text tags | Verdict |
| --- | --- | --- | --- | --- |
| `netflix-artwork-only-01.png` | none | none | — (only a `pHYs` chunk) | clean |
| `netflix-continue-watching-01.jpg` | none | present | `ImageDescription` / `UserComment` both `"Screenshot"` | clean |

The JPEG carries no `Make` and no `Model`, and its only other content is a
capture timestamp and an ICC profile.

⚠ **One residual item, accepted by the owner:**
`netflix-continue-watching-01.jpg` shows the heading *"Continue Watching for
Let's Go!"*, where *Let's Go!* is a **Netflix profile name** — incidental
personal information (RSK-014) rendered into the pixels of a public fixture.
It is retained deliberately: that heading is exactly the chrome string the
extractor must classify as chrome rather than as a title, so redacting it
would destroy what the fixture tests.

## 4. Corpus status after this change

| # | Slot | State |
| --- | --- | --- |
| 1 | `netflix-mylist-mobile-01.jpg` | ✅ committed |
| 2 | `netflix-mylist-mobile-02.jpg` | ✅ committed |
| 3 | `netflix-mylist-desktop-01.heic` | ✅ committed |
| 4 | `netflix-continue-watching-01.jpg` | ✅ committed |
| 5 | `max-saved-mobile-01.jpg` | ✅ committed |
| 6 | `max-saved-desktop-01.heic` | ✅ committed |
| 7 | `netflix-artwork-only-01.png` | ✅ committed |
| 8 | `blank-no-content-01.png` | ⬜ TASK-078 — synthetic |
| 9 | `truncated-titles-01.png` | ⬜ TASK-078 — no source yet |
| 10 | `low-quality-jpeg-01.jpg` | ⬜ TASK-078 — derived by re-encode |
| 11 | `rotated-01.png` | ⬜ TASK-078 — derived by rotation |
| ~~12~~ | ~~`dark-mode-01.png`~~ | ❌ deleted, §2.2 |

**All seven owner captures TASK-078 needs are now in place.** The four
outstanding slots are synthetic or derived and need nothing further from the
owner:

- **`blank-no-content-01.png` should be synthetic.** The alternative is asking
  the owner to empty a real watchlist, which is destructive and irreversible.
  `manifest.json`'s `provenance` field exists precisely to record this.
- **`truncated-titles-01.png` has no natural source in the seven captures** —
  no caption in any of them is ellipsised. It drives `T-AI-043` (R2.3b),
  whose claim is about the *text* reaching the matcher, so a synthetic caption
  carrying a genuine ellipsis tests the claim honestly. Flagged here so the
  choice is visible rather than discovered later.

## 5. What OQ-024 does *not* change

Per ADR-0001 Revision 2 this check **no longer gates the extraction
investment** — the primary reader is expected to read artwork, so an
artwork-only surface was already within scope. The measurement calibrates the
§9 recall expectations and fixes the fixture naming; it does not reopen the
reader decision.
