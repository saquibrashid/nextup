# Current release and documentation boundaries

Reconciled on 2026-09-17 against `main` at `7f72025`, then rebased onto
`6473571` before PR preparation, with the owner's subsequent decisions recorded
below. This page is a navigation and decision index, not a
replacement for the PRD's acceptance criteria. Task completion lives in [status.md](status.md), generated
from [backlog.md](backlog.md); completion counts are not release acceptance.

## Current scope

| Capability | Current contract and source |
|---|---|
| Saved lists | Eight services: Netflix, Max, Prime Video, Disney+, Apple TV+, Paramount+, Starz and Peacock. Use `SERVICES` / `SERVICE_LABELS`; Hulu is not a separate service. PRD US-061 / REQ-127. |
| Capture | Paste, file selection and drag-and-drop feed the same pipeline. PNG, JPEG and HEIC/HEIF remain accepted. Service batches support append-only or full-update; removal requires owner review. PRD US-003 through US-016. |
| Discovery | Waiting to stream is **in v1**, promoted at A52. Discovery is append-only, creates watch intents rather than service listings, and refreshes availability lazily. ADR-0010; data-model section 17; PRD US-040 through US-043. |
| Ratings | IMDb ratings and lookup are implemented. A53 supersedes the display-only decision: rating is a sort key, with refresh ordered before the rating-sorted query. ADR-0011 Revision 1; PRD US-044 through US-046 and US-057. |
| Library and recovery | Runtime filtering, multi-key sorting, manual add/remove, visual refresh and compact controls are in scope. PRD US-047 through US-061, excluding the deliberately unpromoted US-053 reservation. |
| Still deferred | Editing date-added and mixed-changeset batch undo (REQ-059 / REQ-069), multi-account access, and an export UI. The owner export script already exists. PRD section 11; `restore.md`. |
| Runtime | Node 22, matching `.nvmrc`, workspace engines and the Dockerfile. The earlier Node 20 finding concerned an older branch and is not an outstanding upgrade on this baseline. |

One row per canonical work is the normal list shape, **with acknowledged
duplicates permitted after explicit restore/fix-match confirmation** (US-025
AC-5 / US-030 AC-4). Suppression is still keyed on canonical work identity,
including those duplicates.

There are **four** permitted non-owner processes: TMDB metadata refresh,
screenshot retention purge, IMDb rating refresh, and waiting-view availability
refresh. Their access-trigger and mutation restrictions remain those in PRD
US-036 and section 7.4; this reconciliation authorizes no additional process.

## Where to read

| Question | Source |
|---|---|
| What should be built or accepted? | PRD story/AC rows and section 11; explicit subsequent owner decisions in ADRs |
| What does a requirement ID mean? | [Requirement index](requirement-index.md): source-backed definitions, current amendments and corrected legacy references |
| What is implemented or awaiting the owner? | Backlog section 1.2 and generated status; not README prose or old review reports |
| What evidence checks an AC? | `specs/testing.md`, including its manual exceptions, and the named test's actual assertions |
| How is it implemented? | Current sections of the implementation specs; later revisions supersede historical designs |
| How do I operate it? | Getting-started and the applicable runbook; deployed state must be checked before an operational change |

`Context/requirements.md`, `Context/mvp-definition.md` and other `Context/`
citations refer to the original authoring tree, **not files supplied in this
repository**. Do not invent their contents or treat an unavailable citation as
proof of a new approval. Keep the recorded decision identifiers for history;
when a conflict affects behavior, record it and obtain a decision.

## Owner decisions applied on 2026-09-17

| Topic | Owner decision and application | Boundary |
|---|---|---|
| Service links | **No links; the owner opens the streaming app independently.** PRD US-018 AC-5 and US-038 AC-3 are corrected in place without removing their IDs. Current UI behavior is retained. | Neither service-home links nor direct-title links are in scope. Internal nextup navigation and required TMDB/JustWatch attribution remain. |
| Requirement identifiers | **Reconcile from available approved documents, preserving IDs and asking about ambiguities.** The owner additionally confirmed the BRD's explicit definitions for REQ-042 through REQ-054, with later scope amendments applied. See [requirement-index.md](requirement-index.md). | No wholesale renumbering or reconstruction of missing `Context/` records. REQ-127, not REQ-053, governs the current eight-service boundary. |
| Model tie-breaking | **Retain the incumbent when quality is equivalent or inconclusive.** AI section 9.7 removes cost as a tie-breaker; its existing quality floors and meaningful-improvement rule remain. | No paid evaluation or deployed-model change. Cost is reported, not decisive. |
| Recovery objectives | **Backup-only disaster recovery may lose up to seven days of changes, supported by a weekly off-Azure export. Restore within 24 hours after recovery work begins.** The [restore runbook](restore.md) defines the rehearsal and evidence. | Targets, not measured guarantees. No scheduled export, paid upgrade, automatic LTR or zero-loss promise is authorized. |

**Still to demonstrate:** a usable weekly off-Azure backup and a timed restore
rehearsal meeting those recovery targets. The normal seven-day PITR retention
window is distinct from the backup-only acceptable-loss target. A missed or
unusable export means the target is not being met; do not silently widen it.

**Historical context:** before these decisions, service-link ACs contradicted
the BRD, model-selection prose called cost a tie-breaker, and recovery targets
had not been selected. Those conflicts are resolved as above, not left as
instructions for a later implementer to decide again.

Discovery discard already means **global not-interested**, not merely "skip this
feed item" (REQ-085). It can hide the work from subsequent saved-list imports.
That is the recorded behavior, not a new decision here; changing it requires
an explicit amendment rather than a quieter label with unchanged semantics.

## Evidence and readiness

At this baseline the PRD has **367 distinct story/AC keys across 60 stories**,
and all 367 have mapping rows. `KNOWN_UNMAPPED` and
`KNOWN_PHANTOM_CITATIONS` in `tests/meta/acCoverage.spec.ts` are empty. Earlier
findings about 28 unmapped rental criteria and the missing undo test are closed
on this branch. Use the parsers/gates rather than maintaining new count targets.

Mapping proves that a named check is connected to a requirement; it does not
prove assertion quality, deployed configuration or real-device usability.
`T-E2E-001` exercises the real SPA with a stateful replacement backend. Real
database invariants are checked by integration tests; provider quality needs
the manual live suite. A full assembled API/SPA journey with only external
providers faked is recommended additional evidence, not a test claimed to
exist here or an implicitly added backlog task.

The ledger currently leaves the live quality baseline, modified abuse-monitoring
approval, and physical-iOS paste check with the owner. Consult the live ledger
before acting; this page does not run paid probes, submit approvals, or declare
those items complete. The original BRD checkpoint remains anchored on the first
completed import of both Netflix and Max; service expansion does not silently
move that measurement to all eight services.

## Cost baseline

The last documented price verification is 2026-08-17 in architecture's cost
summary: **$11.77/month** as designed, **$17.69/month** after the approved
memory upsize, a **$5.92/month** difference. These are dated estimates, not a
current bill or a new quotation. The upsize stays reactive and keeps memory
and the pixel guard paired. Additional services, live evaluation and activity
can change the volume assumptions; measure actual spend before claiming the
expanded release still costs precisely the original total.
