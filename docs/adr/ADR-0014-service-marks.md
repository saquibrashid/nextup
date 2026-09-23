# ADR-0014 — Authentic, locally bundled service marks

| | |
| --- | --- |
| **Status** | Accepted. **Revision 3, 2026-09-23**, owner-directed actual service icons. |
| **Original date** | 2026-09-17, issue #288 |
| **Deciders** | Owner (visual direction); implementation records asset provenance |
| **Supersedes** | Revisions 1–2's source/approximation and monochrome decisions. ADR-0013's UI icon register remains unchanged. |

## 1. Problem and owner decision

Service identity must be recognised quickly in library badges, filtering,
details and the upload chooser. The owner reviewed the drawn substitutes and
requested **“for service icons, using the actual icons from the service”**,
with a reference showing recognisable wordmarks and restrained brand colours.

This authorises the visual change, not copying assets with unknown rights.
Revision 3 replaces approximations only after verifying usable copyright
provenance through independent sources. No streaming-service domain is queried.

## 2. Closed, separate register

`apps/web/src/components/brands/` remains separate from ADR-0013's line icons.
It exports exactly eight mark components and the partial `SERVICE_MARKS` map.
The components wrap local `assets/*.svg?inline` imports with `BrandMarkBase`.
Vite embeds data URLs: no package, CDN, sprite, build-time fetch or runtime
logo request. Native SVG viewBoxes and `object-fit: contain` preserve proportions.
Embedding as images also isolates gradient IDs between repeated marks.

`T-BRAND-001` asserts the exported set, asset set, embedded artwork, provenance
hashes, absence of executable/external SVG content, and accessibility modes.
The UI icon contract and streaming-host gate are not weakened.

## 3. Sources and provenance

Four retained marks use unchanged Simple Icons geometry under **CC0 1.0
Universal**, pinned at `f2365d33171bd1897a41aaae6c0b6e795bcc0483`:
Netflix, Max (`hbomax`, not the unrelated `max` software icon), Paramount+, Starz.

Four use Wikimedia Commons files whose metadata explicitly identifies them as
public domain (**PD-textlogo**) while retaining trademark restrictions:
Prime Video, Disney+, Peacock and Apple TV+. The latter replaces Apple TV so
the plus sign is included.

`components/brands/ATTRIBUTION.md` records exact file pages, revision timestamps,
source SHA-1 checks, bundled SHA-256 hashes and all presentation changes.
Source file geometry is preserved, not redrawn or traced from screenshots.
Commons' copyright assessment is recorded as such; it is not legal clearance
from a brand, and absence from Simple Icons is not treated as permission.

## 4. Colour and sizing

Brand colour is permitted **only inside the pinned logo assets**, never as
per-service control styling or the sole signifier of service/selection/state.
The reference's coloured identities replace the former monochrome rule.
White lettering is used on navy; Disney's gradient and Peacock's coloured dots
remain. Presentation tints are documented, not represented as official palettes.

Chooser logos occupy equal bounded frames. Badges use bounded natural
proportions. No text, focus indicator or selected state inherits logo colours.
The existing contrast and 44px target requirements continue to apply to the
surrounding UI. Browser checks cover loaded artwork, bounds, names and layout.

## 5. Names and removal

Every service keeps its canonical `SERVICE_LABELS` text in the DOM. Upload and
filter choices show it; compact badges may visually hide it. The image is
decorative by default (`alt=""`, `aria-hidden`); explicitly named marks use
`role="img"` and their supplied alternative text.

If a logo is removed from `SERVICE_MARKS`, the canonical name becomes **visible**
even for a caller requesting `nameHidden`. `T-BRAND-002c` asserts this path.
It must not be deleted merely because all eight services currently have marks.

## 6. Terms and refresh

CC0/public-domain status describes copyright in the artwork, not ownership of
the brands' trademarks. Use is nominative, in a private single-owner watchlist;
no affiliation, sponsorship or endorsement is claimed. This records the
sources relied on, not legal advice.

An update requires rechecking provenance, recording the source revision and
presentation transformations, and updating the pinned hashes and browser
evidence. No automatic fetching or rebranding. A removal request is handled
by withdrawing the relevant asset and using the text fallback.

## 7. Unchanged boundaries

No streaming-service requests, new runtime dependencies, telemetry, API/schema
change, selection default, ordering change or list mutation. This is service
identification artwork only. `T-SEC-001` retains its existing host policy,
including comments and documentation; source service URLs are not copied here.

## 8. Superseded decisions

~~Revision 1 bundled five CC0 marks and left three services as plain text.~~

~~Revision 2 added original Prime Video, Disney+ and Peacock approximations and
forbade making them more faithful through tracing. It required monochrome
`currentColor` SVGs on a square 24-grid, with no brand colour.~~

The no-tracing/no-unverified-copying rationale remains. Revision 3 instead uses
independently verified public-domain artwork, records the changed provenance
explicitly, and retains the accessible-name and removal guarantees.
