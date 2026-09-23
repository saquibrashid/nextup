# Requirement index and reference authority

**Owner-confirmed reconciliation: 2026-09-17.** This is the canonical navigation
index for the requirement IDs supported by the documents in this repository.
It does not reconstruct the unavailable `Context/requirements.md`, renumber
requirements, or replace the PRD's story/AC contracts and named test mapping.

## Reading rule

Use the explicit definitions below and the linked source, applying its latest
approved amendments. A historical summary or a story's mistaken parenthetical
citation cannot redefine an ID. For **REQ-042 through REQ-054**, the owner
explicitly chose **BRD sections 6.2 and 6.3** as the original definitions;
later scope approvals still apply. Preserve story, AC and test IDs when
correcting references. Return an unresolved meaning to the owner rather than
inventing it.

The four decisions applied on this date are recorded in
[current-release.md](current-release.md#owner-decisions-applied-on-2026-09-17).
The [PRD](PRD.md) defines acceptance; [testing.md](../specs/testing.md) defines
its evidence. An index entry is neither proof of implementation nor a new task.

## Original functional requirements

These groups point to the existing definitions, not newly assigned individual
meanings. Original story coverage is also recorded in PRD Appendix A.1.

| IDs | Subject and current boundary | Definition / acceptance source |
|---|---|---|
| REQ-001, REQ-002, REQ-003, REQ-004, REQ-007 | Multi-image capture into a service-scoped batch with an explicit mode; paste, file selection and drag-and-drop remain complete paths | BRD 6.1; PRD US-003, US-004; ADR-0009 |
| REQ-005, REQ-006 | Batch transaction and reconciliation boundary; **not** the one-row-per-work identity rule | BRD 6.1; PRD US-005 |
| REQ-008 | OCR/vision title extraction | BRD 6.1; PRD US-006; ADR-0001 |
| REQ-009, REQ-029 | TMDB matching and stored work metadata | BRD 6.1; PRD US-007 |
| REQ-010 | Classify candidates as new or already present for the selected service | PRD US-009 |
| REQ-011, REQ-057 | Mode-dependent review scope; full-update includes already-known titles | BRD 6.1; PRD US-013 |
| REQ-012 | Surface unmatched candidates rather than silently discard them | BRD 6.1; PRD US-008 |
| REQ-013, REQ-014, REQ-016, REQ-017, REQ-018 | Owner review of additions; explicit confirm/correct/discard, not auto-acceptance | BRD 6.1; PRD US-012 |
| REQ-015, REQ-019, REQ-020, REQ-021, REQ-055 | Propose disappeared listings, default ticks, individual rescue and group confirmation | BRD 6.1; PRD US-014, US-015 |
| REQ-022, REQ-023 | Append-only cannot remove; full-update affects only its own service | BRD 6.1; PRD US-014, US-016 |
| REQ-024, REQ-025, REQ-026 | Work identity, one listing per service and active-service badges, with explicit duplicate-confirmation exceptions | BRD 6.1; PRD US-018, US-025 AC-5, US-030 AC-4 |
| REQ-027, REQ-028 | Removal state and indefinite soft-delete retention; not an infrastructure recovery guarantee | BRD 6.1; PRD US-016, US-023; [restore runbook](restore.md) |
| REQ-030, REQ-060, REQ-061 | Record date-added once and label it honestly | BRD 6.1; PRD US-021 |
| REQ-031 | Combined-list membership and the separate removed view | BRD 6.1; PRD US-018, US-023 |
| REQ-032, REQ-033, REQ-034 | Service, type and genre filters | BRD 6.1; PRD US-019 |
| REQ-035, REQ-037 | Runtime filtering and sorting; promoted at A48, TV runtime is per episode | BRD 6.2; PRD US-055; REQ-119 |
| REQ-036, REQ-038 | Earliest-listing date sort; newest-first default and required reverse control | BRD 6.1; PRD US-020 |
| REQ-039 | Factual per-service last-updated date, with navigation to nextup's upload page | BRD 6.1; PRD US-022 |
| REQ-040 | **Retired at A46:** no list-staleness nudge, threshold or reminder | PRD US-022 and Appendix A.1 |
| REQ-041 | Closed enumeration of owner actions and four permitted non-owner processes | BRD 6.1; PRD US-036 and 7.4 |
| REQ-056 | Undo a confirmed removal group | BRD 6.1; PRD US-017 |
| REQ-058 | Service is owner-declared, never inferred from an image | BRD 6.1; PRD US-003 |
| REQ-059 | Editing date-added remains deferred; manual creation dated today does not promote date editing | BRD 6.2; PRD US-047 AC-6 and 11.2 |
| REQ-062, REQ-063, REQ-064 | Browse, search/filter and explicitly restore from the historical removed log | BRD 6.1; PRD US-024, US-025 |
| REQ-065 | Reappearance creates a new row dated today, not an automatic restore | BRD 6.1; PRD US-026 |
| REQ-066 | Fix a wrong TMDB match | BRD 6.1; PRD US-030 |
| REQ-067, REQ-068, REQ-075 | Creates-only batch undo, change provenance and explicit mixed-change refusal | BRD 6.1; PRD US-031, US-032, US-033 |
| REQ-069 | Mixed-changeset batch undo remains deferred | BRD 6.2; PRD 11.2 |
| REQ-070, REQ-071, REQ-072, REQ-073 | Not-interested suppression, canonical work identity, browsing/undo and suppression precedence | BRD 6.1; PRD US-014, US-027, US-028, US-029 |
| REQ-074 | Re-extraction inside the screenshot-retention window | BRD 6.1; PRD US-034 |
| REQ-076 | Lazy TMDB metadata refresh on access | BRD 6.1; PRD US-010 |

## Resolved legacy block: REQ-042 through REQ-054

| ID | Canonical BRD meaning | Current status and corrected reference boundary |
|---|---|---|
| REQ-042 | A "what should I watch" picker / recommendations | Excluded. Automated streaming retrieval belongs to REQ-049 / NFR-010, not this ID. |
| REQ-043 | Watched-state, progress and viewing history | Excluded. The explicit **Currently watching** preference in REQ-126 is not playback/progress tracking. |
| REQ-044 | Links that launch titles in streaming services | Excluded, reaffirmed and clarified by the owner: **no service-level or direct-title links**. PRD US-018 AC-5 / US-038 AC-3. This ID does not mean multi-user sharing. |
| REQ-045 | TV-browser support and remote/D-pad navigation | Excluded; PRD US-037 targets phone and laptop. |
| REQ-046 | Native iOS / Android applications | Excluded; responsive web only. This ID does not mean provider availability. |
| REQ-047 | Multi-account access for family and friends | Deferred; owner-only access remains current. This ID does not mean ratings or recommendations. |
| REQ-048 | Additional saved-list services | Original expansion deferral partly superseded by REQ-127's eight-service set. Fandango discovery remains distinct from a saved-list service. |
| REQ-049 | Streaming credentials or automated retrieval | Excluded; PRD US-038 / NFR-009 / NFR-010. This ID does not mean owner ratings. |
| REQ-050 | Scheduled or unattended list updates | Excluded; REQ-041 governs permitted processes. This ID does not mean native applications. |
| REQ-051 | Photographs of a TV or physical screen as supported input | Excluded by A15-correction / ASM-021. This ID does not mean notifications. |
| REQ-052 | Analytics, telemetry, event pipeline and usage dashboard | Excluded; NFR-005 remains absolute. |
| REQ-053 | Subjective upload-time image-quality gating for photographed screens | Excluded. This is **not** a service-count limit and does **not** remove format validation, metadata stripping, pixel guards or decode-error handling (REQ-007, REQ-077 through REQ-081). |
| REQ-054 | Import of a Netflix statutory data export | Excluded; not the manual owner-data backup/export described in `restore.md`. |

## Later, explicitly defined requirements

| IDs | Authority and current boundary |
|---|---|
| REQ-077, REQ-078 | [ADR-0008](adr/ADR-0008-heic-transcode-on-ingest.md) and PRD US-004: server-side lossless HEIC/HEIF transcode and metadata stripping. |
| REQ-079, REQ-080, REQ-081 | PRD US-004 AC-9 through AC-11 and [data-model.md](../specs/data-model.md): paired memory/pixel guard, one-image failure containment and memory-specific recovery guidance. |
| REQ-082 through REQ-087 | [ADR-0010](adr/ADR-0010-rental-release-discovery.md), PRD US-040 through US-043: discovery and waiting-view availability, promoted at A52. No streaming-service launch links; required JustWatch attribution remains. |
| REQ-088 through REQ-095 | [ADR-0011](adr/ADR-0011-imdb-ratings-via-omdb.md), PRD US-044 through US-046 and US-057. **Revision 1 / A53 supersedes REQ-095's original display-only restriction**; rating sorting refreshes before ordering. |
| REQ-096 through REQ-104 | [ADR-0012](adr/ADR-0012-spa-data-access.md): API-backed SPA state, typed access, auth/error handling and owner-initiated mutations. |
| REQ-105 through REQ-125 | [ui-refresh.md](../specs/ui-refresh.md), [ADR-0013](adr/ADR-0013-ui-refresh.md), PRD US-049 through US-059 excluding the deliberately unpromoted US-053 reservation. This includes REQ-119's runtime semantics. |
| REQ-126 | PRD US-060: owner-set watching and watch-priority preferences, not automatic viewing-history tracking. |
| REQ-127 | PRD US-061: the closed eight-service set. Use this ID for today's service boundary, not REQ-053. |
| REQ-128 | PRD US-062: Comedy Show display category for stand-up/live comedy, automatically assigned from explicit metadata with owner override; canonical Movie/TV identity is unchanged. |

## Non-functional requirements and remaining provenance limits

PRD Appendix A.2 indexes **NFR-001 through NFR-020**. Apply the later
**NFR-012a** quality-first extraction decision in ADR-0001 and the A41
cost-efficiency amendment to NFR-012 rather than the old absolute-free-cost
summary. The owner-approved incumbent-retention policy is in
[ai.md section 9.7](../specs/ai.md); the backup-only recovery targets are in
[restore.md](restore.md). Neither is a newly allocated requirement ID here.

No meaning is inferred for a missing source record. Other namespaces remain
separate: in particular, qualify **RSK-016** by register (architecture:
memory/OOM; BRD: agent-code correctness). This index does not renumber those
risks or claim to resolve unavailable assumption or question records.
