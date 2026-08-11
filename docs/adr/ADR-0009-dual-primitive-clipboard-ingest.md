# ADR-0009 — Dual-primitive clipboard ingest (desktop `paste` event + iOS "Paste screenshot" button), with file upload retained

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-08-11 |
| **Deciders** | solution-architect (phase 8, R7), owner (`A45` — the interaction correction) |
| **Forced by** | **A45** (owner's stated capture interaction), REQ-004, REQ-007, **REQ-078**, NFR-006, NFR-015, NFR-002, NFR-004, ADR-0008, ADR-0006 |
| **Evidence** | `Context/evidence/clipboard-paste-support.md` (primary-source, retrieved 2026-08-11) — **authoritative for every platform fact below** |

## Context

Everything specified up to Revision 6 assumed a single ingest affordance:
`<input type="file">`. The owner corrected that at `A45`, verbatim:

> *"Also for screenshots, I'm generally expecting that I will take a screen
> grab and paste it into the app directly rather than saving it to my device
> first and then uploading it to the app."*

So **clipboard paste is the expected primary interaction**, and file upload
was never the primary one — it was an agent-derived default that nobody
tested against the owner. This is the same failure shape as `ASM-034`
(ADR-0008): an unexamined inference about how the owner actually works.

**This is an ADD, not a swap, and that is load-bearing.** Two real capture
paths still require file upload and cannot be served by paste at all:

1. **The laptop web-screenshot path**, when the owner saves rather than
   copies (and the general case where the clipboard has since been
   overwritten).
2. **The iOS Photos path.** iOS screenshots auto-save to Photos and go to
   the clipboard *only* if the owner acts on the transient screenshot
   thumbnail and taps "Copy". Miss that window — which is the common case —
   and upload is the only route. iOS *camera photos* are never on the
   clipboard at all.

Path 2 is also why **ADR-0008 must not be deleted**: the Photos upload path
still delivers raw HEIC.

The naive implementation — "add a document-level `paste` listener" — is the
wrong design on the owner's *primary* device. The research establishes that
the two platforms want **opposite primitives**, and that on iOS the
supported interaction is an explicit button, not a gesture.

## Options considered

### Option A — Document-level `paste` event listener only

| | |
|---|---|
| Summary | `document.addEventListener('paste', e => e.clipboardData.files)`. One handler, no permission surface. |
| Pros | Zero prompts. Works in **all four desktop browsers** (Chrome 41+, Edge 12+, Safari 10.1+, Firefox 22+ for `ClipboardEvent.clipboardData`). The data arrives synchronously on the event — no `clipboard.read()` call, therefore no gesture/permission gate at all. Smallest possible code. |
| Cons | **Broken on the owner's primary device.** On iOS the spec-legal listener fires only *once a paste has been initiated*, and iOS provides **no way for the user to initiate one over non-editable content**. WebKit bug 75891 (*"Safari fails to fire paste events"*) was only resolved on **2026-03-13** via PR #38127, merged 2025-01-07 — and that PR fixes **event routing**, not the **callout affordance**. Which iOS release carries it is **unknown** (no release-notes source found). Older iOS in the field certainly lacks it. The historical workaround was a hidden `contenteditable` trap — a hack that fights the platform and breaks screen readers. |
| Cost | $0. |
| Reversal cost | Trivial. |

### Option B — `navigator.clipboard.read()` from a visible "Paste screenshot" button only

| | |
|---|---|
| Summary | A real button; its click handler calls `await navigator.clipboard.read()` and pulls the `image/png` blob out of the `ClipboardItem`. |
| Pros | **The verified iOS path.** Apple designed this interaction: user taps the button → WebKit shows a native single-option paste callout → user taps "Paste" → the promise resolves. Requires **no `contenteditable`**, works on non-editable pages, and is available since **Safari 13.1 / iOS 13.4**. Discoverable — a visible button beats an invisible gesture on a touch device (`NFR-006`). |
| Cons | **Worse than Option A on desktop.** Firefox only shipped `Clipboard.read()` in **127**, and both Firefox and Chrome add a permission prompt for programmatic reads — where Ctrl/Cmd+V would have needed none. On iOS the callout is **per-invocation and never remembered**, so every screenshot costs a deliberate extra tap forever. It is **brittle**: any stray tap in the page, a tab switch, or backgrounding Safari **silently rejects the promise** with no error dialog. |
| Cost | $0. |
| Reversal cost | Trivial. |

### Option C — Build both primitives (**selected**)

| | |
|---|---|
| Summary | A document-level `paste` listener **and** a visible "Paste screenshot" button, both feeding the same `ingestImage(bytes, sniffedType)` entry point. File upload retained unchanged as the third affordance. |
| Pros | Each platform gets the primitive it actually wants, with **no prompt on desktop** and the **only reliable path on iOS**. They share a decoder, a validator and a transport — the incremental cost over either one alone is one event handler and one button. Degrades cleanly: on a browser without `navigator.clipboard` the button is hidden, not broken. |
| Cons | **Two entry points to test instead of one** (three, counting upload) — and the iOS one is only fully testable on a real device over HTTPS, which CI cannot do. Two code paths that must not diverge in validation. Slightly more UI surface on a 320px viewport. |
| Cost | $0 in services. Small, permanent test-matrix cost. |
| Reversal cost | Low — either primitive can be deleted independently; upload is the floor and always remains. |

### Option D — PWA Web Share Target (iOS Share Sheet → the app)

| | |
|---|---|
| Summary | Declare `share_target` in the web manifest so the iOS Share Sheet can send a screenshot into an installed PWA. |
| Pros | Would be the fewest taps of any option if it existed. |
| Cons | **It does not exist on the owner's device and cannot be designed around.** MDN BCD `manifests/webapp/share_target.json` records `safari: false`, `safari_ios: "mirror"` ⇒ also `false`. WebKit bug **194593** (*"Add support for Web Share Target API"*) is **still NEW**, opened 2019-02-13, last touched 2026-05-23 — seven years unimplemented. |
| Cost | n/a. |
| Reversal cost | n/a — **ruled out, not deferred.** |

### Option E — `<input type="file">` only (the status quo before this ADR)

| | |
|---|---|
| Summary | Keep upload as the sole affordance and ask the owner to save-then-upload. |
| Pros | Zero new code, one path to test, universal. |
| Cons | **It contradicts the owner's stated interaction (`A45`).** It is ~4 taps from "screenshot just taken" against ~3 for paste, on a review flow whose interaction cost is already the product's largest abandonment risk (`OQ-011`). Same class of error as Option E in ADR-0008: making the owner adapt to the app's convenience. |
| Cost | $0. |
| Reversal cost | n/a. |

## Decision

**We will build BOTH clipboard primitives and RETAIN file upload — three
ingest affordances converging on one pipeline.**

1. **Desktop: a document-level `paste` listener.** Reads
   `event.clipboardData.files` / `.items`. **No `navigator.clipboard.read()`
   call is made on this path** — the data is already handed over
   synchronously, so there is no gesture gate and no prompt in any of the
   four desktop browsers. This is the *better* primitive on desktop and
   using `clipboard.read()` there instead would be a regression.
2. **iOS: a visible "Paste screenshot" button** calling
   `navigator.clipboard.read()` **inside the click handler**. This is the
   only *verified* path on iOS for a non-editable page. **A hidden
   `contenteditable` trap is prohibited** — it is an outdated workaround
   that fights the platform and damages accessibility.
3. **File upload is retained, unchanged and fully supported**, and is the
   **only** path that serves the laptop save-then-upload case and the iOS
   Photos case. It is the floor: if both clipboard paths fail or are
   unavailable, ingest still works.
4. **All three converge on one ingest entry point.** Sniff → guard →
   conditional transcode → metadata strip → blob write → staged row. There
   is exactly one validator, one guard and one storage path (ADR-0008 R3,
   `A43-M1`).

Two consequences of verified platform facts, recorded here so they are not
mistaken for optimisations:

- **A pasted screenshot is always `image/png`.** WebKit exposes exactly four
  clipboard representations — `text/plain`, `text/html`, `text/uri-list`,
  `image/png` — so **HEIC cannot arrive by the paste path at all**.
  Therefore the ADR-0008 transcode is **conditional on the sniffed type**
  and is a no-op on paste. **This is a consequence, not an optimisation, and
  the transcode stage is not removed** — the Photos upload path still
  delivers raw HEIC (ADR-0008 Rev 3).
- **WebKit strips EXIF on clipboard read** (*"Image data read from the
  clipboard is stripped of EXIF data, which may contain details such as
  location information and names"*). ⚠ **It does NOT strip EXIF on file
  upload.** `REQ-078`'s explicit, tested metadata-strip therefore **stays on
  the upload path and stays mandatory**. The paste path's free stripping
  covers **one of three** affordances and must never be read as covering the
  control globally.

**HTTPS is mandatory.** `navigator.clipboard` is simply **absent** on
`http://`. Production already satisfies this (ACA managed certificate), but
**local-network testing from the phone over `http://<LAN-IP>:port` will show
no paste button at all** — and the failure looks like a missing feature, not
a missing certificate. See §Compliance and security implications.

## Consequences

### Positive
- **The owner's stated interaction works on their primary device**, by the
  path Apple actually supports.
- **Desktop gets the better primitive** — Ctrl/Cmd+V, no prompt, four
  browsers.
- **Marginally cheaper and faster ingest.** A pasted PNG skips the WASM HEIC
  decode entirely, which is the app's largest allocation. Every screenshot
  that arrives by paste is one that cannot trigger `RSK-016`.
- **The pre-decode pixel guard still applies to pasted images** — a pasted
  PNG is still sniffed and still dimension-checked. Nothing is trusted
  because of how it arrived.
- **Graceful degradation is structural**: three affordances, and upload
  never depends on the other two.

### Negative
- **The iOS paste is brittle and always will be.** The callout is
  per-invocation and **never remembered** — one extra deliberate tap per
  screenshot, forever. Any stray tap, tab switch or backgrounding **silently
  rejects the promise**. The UI must detect rejection and **re-offer**
  rather than appearing to hang. This is a permanent papercut on the
  primary path, accepted because the alternative is worse.
- **The owner must remember to tap "Copy"** on the transient iOS screenshot
  preview. If they miss it, they are on the upload path — which is exactly
  why upload is retained, and why paste must be described as an accelerant,
  not a replacement.
- **Two clipboard code paths to keep in step**, plus upload: three entry
  points, one validator. Divergence in validation is a real and easy defect.
- **The iOS path is not CI-testable.** It needs a real device, a real
  clipboard, real HTTPS and a human tap. CI can cover the desktop `paste`
  handler and the shared ingest entry point; the iOS callout is a **manual
  test only** — an honest hole in the automated gate that `NFR-003` would
  otherwise cover.
- **`iOS 13.4` is now a floor** for the paste button (`Clipboard.read()` /
  `ClipboardItem`, Safari 13.1 ⇒ iOS 13.4). Below that the button is hidden
  and upload is the path.
- **Local phone testing over plain HTTP silently loses the feature.**

### Neutral / follow-on work required
- Feature-detect: render the "Paste screenshot" button only when
  `navigator.clipboard?.read` exists **and** the context is secure.
  Never render a button that cannot work.
- The paste handler must ignore non-image clipboard items rather than
  erroring — a text paste is not a failure.
- Rejection handling: `clipboard.read()` rejecting is the **expected** case,
  not an exception path. Surface "Paste cancelled — tap to try again", never
  a stack trace and never a spinner.
- The shared ingest entry point takes `(bytes, sniffedType, source)` where
  `source ∈ {paste-event, paste-button, upload}` — logged for `A43-M5`
  diagnosis, **not** as product analytics (`NFR-005`: it is an operational
  attribute of a request the owner initiated, carrying no behavioural
  aggregate).
- `specs/ui.md` / `specs/ux-states.md` owe the three states: idle, awaiting
  callout, rejected-and-re-offered. *(Specs are owned by another agent;
  named here, not edited there.)*
- `specs/testing.md` owes a **manual** iOS paste case and an automated
  desktop `paste` case. **`T-SEC-032` (EXIF strip) must be asserted on the
  UPLOAD path specifically** — asserting it only on a pasted PNG would pass
  vacuously and prove nothing.

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **No.** |
| **Cost to reverse** | **Low, and asymmetric by design.** Either clipboard primitive can be deleted independently in one module; the ingest entry point, the guard, the transcode and the storage path are shared and untouched. **File upload is the floor and is never removed** — removing it would re-break the two capture paths clipboard cannot serve. |
| **Trigger to revisit** | (a) Apple ships Web Share Target (WebKit bug 194593 leaves NEW) — that would beat both paste paths on tap count and should be re-evaluated; (b) a primary source establishes whether iOS shows a paste callout over non-editable content post-PR-#38127 — if it **does**, the button could become a secondary affordance rather than the primary iOS one; (c) the per-paste callout tap proves intolerable in real use, which would mean upload is the better default on iOS after all; (d) `Clipboard.read()` gains a remembered permission on iOS. |

## Compliance and security implications

- **HTTPS is a hard functional dependency, not just a transport control.**
  `navigator.clipboard` is absent on `http://`. Prod is fine (ACA managed
  certificate). **Testing from the phone against a LAN IP over HTTP will
  show no paste button** — a self-inflicted, confusing failure. Test the
  paste path against **staging over HTTPS**, or a trusted tunnel; do not
  attempt it over `http://<LAN-IP>`.
- **`REQ-078` (metadata strip) is unchanged and stays on the upload path.**
  WebKit's EXIF strip on clipboard read is a *belt* on one of three
  affordances; the tested strip is the *braces* on all three. **The control
  is not delegated to the platform.**
- **Clipboard content is read, never written.** nextup never calls
  `clipboard.write()`, so it never places owner data on the system
  pasteboard.
- **Nothing is trusted because it was pasted.** Pasted bytes go through the
  same magic-byte sniff, the same pre-decode dimension guard (`A43-M1`) and
  the same size ceiling as an uploaded file. A `ClipboardItem` claiming
  `image/png` is a claim, not a fact.
- **No new outbound destination, no new stored data class, no new
  dependency.** Both clipboard primitives are platform APIs.
- **`REQ-041` is not engaged.** Paste is user-initiated ingest that writes no
  list state — identical in kind to upload (ADR-0008 §Decision 3).

## Residual uncertainty — stated, not smoothed over

**The researcher could not verify whether iOS displays a paste callout over
non-editable content after WebKit PR #38127.** No primary source was found
either way; the claim that it does not is `inferred`, explicitly labelled
unverified in `Context/evidence/clipboard-paste-support.md` §Q1c/Q1e-4.

**This decision is deliberately constructed so that the answer does not
matter.** The button + `clipboard.read()` path is `verified` to work
regardless, and the desktop `paste` listener is `verified` on desktop
regardless. If the answer turns out to be "yes, iOS does show a callout",
the only consequence is that the button becomes *redundant on newer iOS* —
not wrong. If it is "no", the design is already correct. **We have not bet
on the unverified fact; we have routed around it.** Recorded as `RSK-033`
in `architecture.md`, with a matching assumption entry owed to
`Context/assumptions.md` (owned by another agent — named here, not
written there).
