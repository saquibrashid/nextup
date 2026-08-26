// The matching module's own barrel (TASK-060).
//
// `packages/domain/src/index.ts` re-exports this directory. It is a separate
// file, following the `extraction/` precedent, so the module can grow without
// another edit to the root barrel each time.

export * from './tmdbMatcher.js';
