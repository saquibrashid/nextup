// The extraction contract's own barrel (TASK-055).
//
// `packages/domain/src/index.ts` re-exports this directory. It is a separate
// file so the contract can grow (crossCheck.ts, cleanup.ts — TASK-056c/057)
// without another edit to the root barrel each time.

export * from './TitleExtractor.js';
export * from './degraded.js';
export * from './crossCheck.js';
export * from './jaroWinkler.js';
export * from './thresholds.js';
export * from './chromeTerms.js';
export * from './cleanup.js';
