# Bundled service marks — attribution and terms

The five SVG paths in this directory are **vendored**, not authored here, and
not fetched at runtime. See `docs/adr/ADR-0014-service-marks.md` for the
decision; this file is the record of _what_ was taken and _from where_.

## Source

|                            |                                                                           |
| -------------------------- | ------------------------------------------------------------------------- |
| **Project**                | [Simple Icons](https://github.com/simple-icons/simple-icons)              |
| **Licence of the project** | CC0 1.0 Universal (public domain dedication)                              |
| **Pinned commit**          | `f2365d33171bd1897a41aaae6c0b6e795bcc0483` (2026-09-17)                   |
| **Taken**                  | `icons/<slug>.svg` path data only, verbatim                               |
| **Disclaimer read**        | <https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md> |

## What is bundled

| Component           | Slug            | Title upstream | Brand source recorded upstream         |
| ------------------- | --------------- | -------------- | -------------------------------------- |
| `NetflixMark`       | `netflix`       | Netflix        | the Netflix brand-assets site          |
| `HboMaxMark`        | `hbomax`        | HBO Max        | the Max 2025 logo on Wikimedia Commons |
| `AppleTvMark`       | `appletv`       | Apple TV       | the Apple TV logo file on Wikipedia    |
| `ParamountPlusMark` | `paramountplus` | Paramount+     | the Paramount brand site               |
| `StarzMark`         | `starz`         | STARZ          | the STARZ site                         |

⚠ **The upstream `source` URLs are described, not linked, on purpose.** Three of
the five point at a streaming service's own domain, and `T-SEC-001` fails the
build on a streaming-service host appearing anywhere in the tree — the gate that
keeps this product from ever addressing a streaming service (NFR-010, product
invariant 10). The exact URLs live in the pinned upstream `_data/simple-icons.json`
and are recoverable from the commit above; putting them back here trips the gate
and, worse, teaches the next reader that the rule has exceptions.

> ⚠ **The `max` slug upstream is Cycling '74 Max, the music software — not HBO
> Max.** The slug that matches this product's `max` service is **`hbomax`**.
> The names collide exactly where a careless vendoring would not notice, and
> the wrong glyph would have shipped looking perfectly deliberate.

## What is deliberately NOT bundled

**Prime Video, Disney+ and Peacock have no mark**, and that is a decision.
Their logos are absent from the CC0 source: Amazon and Disney are among the
brands removed from it through its published removal process. Re-drawing them
from a press kit would take on precisely the risk that source declined to
carry. Those three services render their **word mark**, which is what all eight
rendered before this change.

## Terms, stated plainly

- **CC0 covers the SVG files.** It does not, and cannot, transfer any rights in
  the underlying trademarks.
- **The marks remain the property of their respective owners.** They are used
  here **nominatively** — to identify which streaming service a title is saved
  on, in a private single-owner watchlist. No affiliation, sponsorship or
  endorsement is claimed or implied.
- **Rendering is monochrome and inherits `currentColor`.** No brand colour is
  reproduced, and the marks are never used as a logo of this product.
- **Nothing is ever fetched from a streaming service** (product invariant 10).
  The paths are compiled into the bundle; the app makes no request for them, at
  build time or at run time.
- Should a brand ask for its mark not to be used here, deleting its component
  and its `SERVICE_MARKS` entry is sufficient — the word-mark fallback then
  renders, and nothing else changes.
