/**
 * ⚠ TYPES ONLY — the implementation is `egress-guard.mjs` and stays plain JS.
 *
 * The guard is loaded by Vitest's `setupFiles` and by `tools/` scripts, both
 * of which run untranspiled; converting it to TypeScript would mean building
 * it before any test could run. This declaration is what lets the specs that
 * import it be typechecked under `tsconfig.tests.json` (TASK-193) without
 * paying that cost.
 *
 * Keep it in step with the module. A drifted declaration is worse than none:
 * it would typecheck the specs against a fiction.
 */

export declare const LOOPBACK_HOSTS: ReadonlySet<string>;

export declare function registerMockedHost(host: string): void;
export declare function unregisterMockedHost(host: string): void;
export declare function clearMockedHosts(): void;
export declare function isMockedHost(host: string): boolean;
export declare function isLoopback(host: string): boolean;
export declare function hostOf(target: unknown, options?: unknown): string | null;

export declare class EgressBlockedError extends Error {
  constructor(host: string, target: unknown);
  readonly host: string;
  readonly target: unknown;
}

export interface EgressAttempt {
  host: string;
  target: unknown;
  outcome: 'blocked' | 'mocked' | 'allowed';
}

export declare function egressAttempts(): readonly EgressAttempt[];
export declare function blockedAttempts(): readonly EgressAttempt[];
export declare function mockedAttempts(): readonly EgressAttempt[];
export declare function resetEgressAttempts(): void;

export declare function installEgressGuard(options?: { allow?: readonly string[] }): void;
export declare function uninstallEgressGuard(): void;
export declare function isEgressGuardInstalled(): boolean;
