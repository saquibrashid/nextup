// @nextup/domain — shared, pure TypeScript domain.
//
// Imported verbatim by `apps/api` and `apps/web` (ADR-0004). Everything here is
// pure: no I/O, no Prisma, no Express, no React.

export * from './attribution.js';
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
// TASK-036 — the list ordering rule (US-020), stated once so the SQL
// `ORDER BY` has something to be checked against.
export * from './ordering.js';
// TASK-145 — the pure half of the pre-decode pixel guard (`specs/api.md`
// §5.0.1). Pure so the decision table can be tested without a container, a
// fixture or a decoder; the header read is in `apps/api/src/images`.
export * from './pastedFileName.js';
export * from './pixelGuard.js';
export * from './schemas.js';
export * from './types.js';
