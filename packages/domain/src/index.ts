// @nextup/domain — shared, pure TypeScript domain.
//
// Imported verbatim by `apps/api` and `apps/web` (ADR-0004). Everything here is
// pure: no I/O, no Prisma, no Express, no React.

export * from './attribution.js';
// TASK-064 — new vs already-present, PER SERVICE (`specs/ai.md` §6.1, REQ-010).
export * from './classify.js';
export * from './copy.js';
export * from './derive.js';
export * from './enums.js';
export * from './errorCodes.js';
// TASK-055 — the stage-1 extraction contract (`specs/ai.md` §2.3). The
// subdirectory has its own barrel so it can grow (crossCheck.ts, cleanup.ts)
// without another edit here.
export * from './extraction/index.js';
export * from './freshness.js';
export * from './identity.js';
export * from './ids.js';
export * from './logEvents.js';
// TASK-060 — deterministic TMDB match scoring (`specs/ai.md` §4). Its own
// barrel, following the `extraction/` precedent.
export * from './matching/index.js';
// TASK-036 — the list ordering rule (US-020), stated once so the SQL
// `ORDER BY` has something to be checked against.
export * from './ordering.js';
// TASK-063 — intra-batch overlap collapse (SD-02, `specs/data-model.md` §7.4).
export * from './overlap.js';
// TASK-145 — the pure half of the pre-decode pixel guard (`specs/api.md`
// §5.0.1). Pure so the decision table can be tested without a container, a
// fixture or a decoder; the header read is in `apps/api/src/images`.
export * from './pastedFileName.js';
export * from './pixelGuard.js';
// TASK-066 — the pure half of the candidate PATCH and confirm-all bodies
// (`specs/api.md` §6.18, §6.19): what the owner is allowed to have meant.
export * from './candidatePatch.js';
export * from './close.js';
// TASK-074 — provenance (REQ-068, US-031): how stored `batch_change` rows
// fold back into the §3.7 three-array shape a batch undo reads.
export * from './provenance.js';
// TASK-116 — the §8.4 undo-refusal contract, shared so the SPA's refusal panel
// renders the SAME shape the API produces rather than a hand-copied twin.
export * from './undoRefusal.js';
// TASK-065 — the pure half of the review response (`specs/api.md` §6.17):
// section routing, the mode contract and removal withholding.
export * from './review.js';
// TASK-083 — full-update removal computation (US-014). Pure: it decides WHAT
// disappeared; `review.ts` decides whether the owner may see it.
export * from './removals.js';
// TASK-073 — batch reconciliation, run ONCE over the union of every image in
// the batch (US-005 AC-2, REQ-006). There is deliberately no per-image entry
// point: reconciling per image proposes removing everything not photographed
// on that one screenshot.
export * from './reconcile.js';
// TASK-085 — the tick/untick body grammar for `PATCH …/removals` (§6.21).
export * from './removalPatch.js';
export * from './schemas.js';
// TASK-061 — the TMDB storage allow-list POLICY (US-007 AC-6, REQ-029): an
// unlisted field is rejected, never stripped. Also a Rule A defence.
export * from './tmdbStorage.js';
export * from './types.js';
export * from './undo.js';
