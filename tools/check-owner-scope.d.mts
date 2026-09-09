/**
 * ⚠ TYPES ONLY — the implementation is `check-owner-scope.mjs` and stays
 * plain JS, because it is also a standalone CI script (`npm run check:owner-
 * scope`) that must run untranspiled.
 *
 * This declaration is what lets `apps/api/test/unit/ownerScope.spec.ts` be
 * typechecked under `tsconfig.tests.json` (TASK-193). Keep it in step with the
 * module — a drifted declaration typechecks the spec against a fiction, which
 * is worse than not checking it at all.
 */

export declare const ROOT: string;
export declare const REPOSITORY_DIR: string;
export declare const UNIQUE_SELECTOR_METHODS: readonly string[];
export declare const WHERE_METHODS: readonly string[];
export declare const CREATE_METHODS: readonly string[];

export interface OwnerScopeViolation {
  file: string;
  line: number;
  method: string;
  reason: string;
}

export declare function repositoryFiles(root?: string): string[];
export declare function ownerScopeViolations(files?: string[]): OwnerScopeViolation[];
export declare function formatViolations(violations: readonly OwnerScopeViolation[]): string;
