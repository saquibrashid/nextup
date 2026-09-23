# Bundled service marks — attribution and terms

All eight marks use authentic vendored geometry, not hand-drawn approximations.
ADR-0014 Revision 3 records the owner's request to use the actual service icons.
Nothing is fetched at build time or runtime: Vite's `?inline` imports compile
the local SVGs into data URLs.

## Simple Icons: four retained marks

Project: [Simple Icons](https://github.com/simple-icons/simple-icons).
Licence: **CC0 1.0 Universal**, which covers the files, not trademark rights.
Pinned commit: `f2365d33171bd1897a41aaae6c0b6e795bcc0483`.
Source: `icons/<slug>.svg`; path data is unchanged from the previously reviewed
components. The upstream disclaimer remains applicable.

| Component           | Asset                | Slug            |
| ------------------- | -------------------- | --------------- |
| `NetflixMark`       | `netflix.svg`        | `netflix`       |
| `HboMaxMark`        | `max.svg`            | `hbomax`        |
| `ParamountPlusMark` | `paramount-plus.svg` | `paramountplus` |
| `StarzMark`         | `starz.svg`          | `starz`         |

The `hbomax` asset is the streaming Max wordmark. Simple Icons' `max` slug is
unrelated music software. Upstream streaming-service source URLs are deliberately
not reproduced: the outbound-host gate has no documentation exception.

## Wikimedia Commons: four replacement marks

Each file's Commons image-info metadata was checked on 2026-09-23:
`LicenseShortName=Public domain`, `Copyrighted=False`, category **PD-textlogo**,
and restriction **trademarked**. This records Commons' copyright assessment,
not a trademark licence or a representation that the brands endorsed this use.
Only Wikimedia hosts were contacted; no brand website or press kit was fetched.
The downloaded bytes were verified against the source SHA-1 before conversion.

| Component        | Commons file page                                                                                                                        | File revision (UTC) | Source SHA-1                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------ |
| `PrimeVideoMark` | [Prime Video logo (2024).svg](<https://commons.wikimedia.org/wiki/File:Prime_Video_logo_(2024).svg>)                                     | 2024-07-31 09:06:19 | `53e6b00e5c9b9a64871eb57217f1f52747a22a3e` |
| `DisneyPlusMark` | [Disney+ logo.svg](https://commons.wikimedia.org/wiki/File:Disney%2B_logo.svg)                                                           | 2025-05-09 23:14:55 | `7cbe03a01075d65033a465de975b61c9ce8dd87b` |
| `PeacockMark`    | [NBCUniversal Peacock Logo (2020–2026).svg](<https://commons.wikimedia.org/wiki/File:NBCUniversal_Peacock_Logo_(2020%E2%80%932026).svg>) | 2026-03-07 09:11:51 | `f56ef08a5b2f23e556c9f441911b697d64ea9f45` |
| `AppleTvMark`    | [Apple TV Plus Logo.svg](https://commons.wikimedia.org/wiki/File:Apple_TV_Plus_Logo.svg)                                                 | 2023-09-09 23:17:32 | `15156b3ef18d33361fa789beb0b2d858c5d38234` |

Prime Video, Disney+ and Peacock replace the original approximations. Apple TV+
replaces the earlier Apple TV glyph so the actual plus sign is included.
The Peacock wordmark/dots and Max wordmark follow the supplied reference; they
are recorded versions, not a claim to automatically track future rebrands.

## Presentation changes

- All path geometry is preserved. XML declarations, editor comments, redundant
  dimensions and unused namespaces are removed; SVGs retain their viewBoxes.
- Disney's script/plus, Peacock's lettering and Apple TV+ are white for the navy
  interface. Disney's original blue gradient arc and Peacock's six coloured dots
  remain. Apple's black-only style/title wrapper is removed.
- Prime Video keeps its source blue. Netflix uses red `#e50914`. Max, Paramount+
  and Starz use the reference's light-on-dark blue treatments (`#4b7bff`,
  `#4b91ff`, `#86c9ed`). These are presentation tints, not claimed official
  palette specifications or brand-approved variants.
- Max and Starz viewBoxes remove empty vertical padding without clipping paths:
  `0 8.7 24 6.6` and `0 9.2 24 5.6`. No path coordinates are changed.
- Images use `object-fit: contain`, never stretching or cropping. Brand colour
  is confined to these assets; it does not style controls, selection or text.

## Bundled SHA-256

Hashes are over UTF-8 with LF line endings. `T-BRAND-001g` pins these bytes;
changing an asset requires a provenance update, not just a new expected image.

| Asset                | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `prime-video.svg`    | `4d2874553d1df490cdec9694c761f7cb2389d7fab417466885bcdadcfcf1a49a` |
| `disney-plus.svg`    | `435b6cc464dac531962f7f098fa8ac3241e4e2ee1035645a2624337f15e59d17` |
| `peacock.svg`        | `f974ecfa0b93fdfae2629c40a797471cf6989b32d4e7bb23f5a99a21e2453a66` |
| `apple-tv-plus.svg`  | `00e64e52cc4eb88999740d5abdcdf3e413031e43da9176254ab91bc7f1ee993b` |
| `netflix.svg`        | `7160e35c5d7d90dfb9c94ce6f3ca62da154f52c90159da3eb64fb55323d1605c` |
| `max.svg`            | `347eddb7773c13331e0cc198b061db50d15e0a111b62eb3facbcf490e32164ca` |
| `paramount-plus.svg` | `cd22e71f842bc000b7a277932aae279f2824840bd70589306ffb2b6bc0703dc5` |
| `starz.svg`          | `85f8f5b6b901c789b56cafc6a66a520a89ca543cd7494a49dd702164ff87dee2` |

## Terms and removal

The marks remain their owners' trademarks. Use is nominative identification in
a private, single-owner, non-commercial watchlist. No affiliation, sponsorship
or endorsement is claimed. Copyright status does not grant trademark rights.
This is a provenance record, not legal advice.

If an asset must be withdrawn, remove its component and `SERVICE_MARKS` entry.
`ServiceMark` then displays the canonical service name, even when `nameHidden`
was requested. `T-BRAND-002c` preserves that removal path.

~~Revision 2 used five CC0 marks and three original approximations, all
monochrome. Revision 3 replaces those approximations with verified public-domain
artwork and explicitly records the presentation changes above.~~
