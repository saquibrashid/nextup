/**
 * `T-INFRA-013` — nothing finished is left unreachable.
 *
 * ⚠ **THIS GATE EXISTS BECAUSE THE SAME DEFECT SHIPPED THREE TIMES AND WAS
 * FOUND BY HAND EVERY TIME.** The shape is always identical: a feature is
 * built, its component test passes, its route test passes, and **no screen can
 * reach it**.
 *
 *   1. `GET /api/batches/:batchId` (TASK-076) — route built, client method
 *      absent.
 *   2. `FixMatchDialog` — component finished and fully tested, imported by
 *      nothing but its own test, so US-030 AC-1 (`must`) had no reachable
 *      implementation.
 *   3. `apiClient.fixMatch` — did not exist at all while `T-FIX-010` (the
 *      server) and `T-UI-020` (the isolated dialog) both stayed green.
 *
 * **No existing gate can see this class, and that is not a bug in them.**
 * `T-API-010` closes client → server parity **one-directionally by design**:
 * `GET /api/images/:imageId` is reached from an `<img>` href with no client
 * method at all, so a bidirectional sweep would fail on correct code. A
 * component test that mounts the component under test can never discover that
 * nothing mounts it. An a11y or tap-target sweep counts an inert button as
 * happily as a working one. Coverage counts a line reached from a test as
 * covered, whether or not any screen reaches it.
 *
 * Two properties, deliberately asymmetric:
 *
 *   **A. Every client method has a call site in `apps/web/src/**`.** A
 *      RATCHETED BASELINE, because three methods are genuinely unreached today
 *      and each is a real, separately-tracked gap — the gate's job is to stop
 *      a FOURTH, not to block on the three.
 *
 *   **B. Every component and page module is imported by another `src` module.**
 *      NO BASELINE — zero tolerance. This property was RED before PR #114 and
 *      is green now, so shipping it with an empty baseline is a statement that
 *      an unmounted screen is never acceptable.
 *
 * ⚠ **MATCHER A REQUIRES A CALL FORM (`.method(`); MATCHER B IS STILL LOOSE.**
 * A module imported by any other `src` module counts as mounted, because a
 * false positive there is worse than a miss: a reachability gate that cries
 * wolf gets a baseline entry added to silence it, and then it protects
 * nothing. But matcher A's looseness cost a shipped dead feature (below), so
 * it now demands an actual invocation. Both properties are still smoke
 * alarms, not proofs of liveness — a called method may still be called from
 * a screen the owner cannot reach.
 *
 * ~~Superseded: "**BOTH MATCHERS ARE DELIBERATELY LOOSE.** A method
 * referenced anywhere under `src` — called, aliased, or passed as a prop
 * reference — counts as reached."~~ — the exact hole that let the
 * undo-at-close defect ship.
 *
 * ⚠ **AND THE LOOSENESS COST US ONE, EXACTLY AS DESCRIBED ABOVE.** The note
 * below was accurate and its consequence was a shipped dead feature:
 * `undoBatch` and `undoRemovalGroup` were mentioned only in the PROP
 * DECLARATIONS of `ListPage` and `BatchAppliedNotice`, which satisfied the
 * old matcher while nothing ever called them — `ReviewRoute` threw the close
 * result away and `ListRoute` passed neither handler. `T-DATA-011`
 * (`apps/web/test/appliedUndoWiring.spec.tsx`) is the assertion that can see
 * that, because it drives the real containers end to end.
 *
 * **Matcher A has since been tightened to `\.method\s*\(`, and the
 * tightening was verified against the real defect: with `ListRoute`'s
 * `client.undoBatch(batchId)` replaced by a no-op, the old matcher stayed
 * GREEN and the new one reports `['undoBatch']`.** `T-INFRA-013e` guards the
 * distinction directly so it cannot quietly loosen again.
 *
 * ⚠ **The generalisable lesson survives the fix: a static gate proves a
 * CALL EXISTS IN A FILE, never that a CHAIN IS CONNECTED at runtime. Do not
 * read a green run here as evidence a feature is live.**
 *
 * ~~Superseded: "`undoBatch` and `undoRemovalGroup` are reached ONLY as prop
 * references today and the loose matcher is what keeps them honestly out of
 * the baseline."~~ — true when written, and the defect it describes has since
 * been found and fixed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'apps', 'web', 'src');
const CLIENT = path.join(SRC, 'lib', 'apiClient.ts');

/**
 * Client methods with no `src` reference today.
 *
 * ⚠ **A RATCHET, NOT A PERMISSION.** Every entry is a real gap with a real
 * owner; adding a new one to make this suite green is the exact move the file
 * exists to prevent.
 *
 * - `getTitle` — `GET /api/titles/:titleId`. The `/#title-<titleId>` deep-link
 *   target (TASK-076) resolves against the already-loaded list, so nothing
 *   fetches a single title yet.
 * - `removeBatchImage` — `DELETE /api/batches/:batchId/images/:imageId`. The
 *   upload screen's per-image remove control is not built.
 *
 * ~~`restoreListing` — the restore UI is TASK-099 and the removed view it
 * hangs off is unbuilt.~~ **DISCHARGED.** The gate was right and the diagnosis
 * was wrong: TASK-099's restore control WAS built, and `RemovedPage` was
 * mounted bare by `routes.tsx`, so nothing could reach it. `RemovedRoute` now
 * wires it (`T-DATA-002z`).
 */
const BASELINE_UNREACHED = new Set(['getTitle', 'removeBatchImage']);

/**
 * A CALL, not a mention.
 *
 * ⚠ This gate previously matched a bare `\bmethod\b` anywhere under
 * `apps/web/src`, which meant a PROP DECLARATION counted as a call. That is
 * exactly how `undoBatch`/`undoRemovalGroup` passed `T-INFRA-013b` while
 * `BatchAppliedNotice` — the undo offered at the moment of the close, a
 * `must`-level AC — had never rendered once: both names appeared in
 * `ListPage.tsx` and `BatchAppliedNotice.tsx` as prop types, and nothing
 * ever invoked them. The old matcher proved a name was MENTIONED; it never
 * proved a chain was CONNECTED.
 *
 * Every client call in this SPA goes through an instance, so `.method(` is
 * the real form. A destructured `const { getList } = client` would evade
 * this — deliberately: the gate ratchets against the call style the codebase
 * actually uses, and adopting a new one should be a conscious edit here
 * rather than a silent hole.
 */
function callForm(method: string): RegExp {
  return new RegExp(`\\.${method}\\s*\\(`);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC);
const TEXT = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));

/** The keys of the object `createApiClient` returns. */
function clientMethods(): string[] {
  const src = TEXT.get(CLIENT);
  if (src === undefined) throw new Error(`apiClient.ts not found at ${CLIENT}`);
  return [...src.matchAll(/^ {4}(\w+):\s*(?:\(|async)/gm)].map((m) => m[1] as string);
}

describe('T-INFRA-013 nothing finished is left unreachable', () => {
  it('T-INFRA-013a: the client method list is read, not assumed', () => {
    // ⚠ The guard on the guard. Both properties below are computed from a
    // regex over a source file; if the file is reformatted so the regex stops
    // matching, `clientMethods()` returns `[]` and property (b) passes
    // VACUOUSLY while asserting nothing at all. Pinning a floor and two known
    // members makes that failure loud instead of silent.
    const methods = clientMethods();
    expect(methods.length).toBeGreaterThan(20);
    expect(methods).toContain('getTitles');
    expect(methods).toContain('fixMatch');
  });

  it('T-INFRA-013b: every client method is CALLED from somewhere in the SPA', () => {
    const unreached = clientMethods().filter((method) => {
      const reference = callForm(method);
      for (const [file, text] of TEXT) {
        if (file === CLIENT) continue;
        if (reference.test(text)) return false;
      }
      return true;
    });

    expect(unreached.filter((m) => !BASELINE_UNREACHED.has(m))).toEqual([]);
  });

  it('T-INFRA-013c: the baseline has not silently grown stale', () => {
    // A method that has since been wired must LEAVE the baseline, or the
    // ratchet loosens by one every time a gap is closed.
    const methods = new Set(clientMethods());
    const stale = [...BASELINE_UNREACHED].filter((method) => {
      if (!methods.has(method)) return true;
      const reference = callForm(method);
      for (const [file, text] of TEXT) {
        if (file === CLIENT) continue;
        if (reference.test(text)) return true;
      }
      return false;
    });

    expect(stale).toEqual([]);
  });

  it('T-INFRA-013d: every component and page module is mounted by another module', () => {
    // ⚠ NO BASELINE, deliberately. This property was RED before the row menu
    // was wired: `FixMatchDialog` was imported only by its own test. An
    // unmounted screen is a feature the owner cannot reach, and there is no
    // acceptable number of those.
    const modules = FILES.filter((f) => /[\\/](components|pages)[\\/]/.test(f));
    const unmounted = modules.filter((file) => {
      const base = path.basename(file).replace(/\.tsx?$/, '');
      const imported = new RegExp(`from '[^']*/${base}'`);
      for (const [other, text] of TEXT) {
        if (other === file) continue;
        if (imported.test(text)) return false;
      }
      return true;
    });

    expect(unmounted.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('T-INFRA-013e: a prop declaration is NOT a call — the matcher itself is guarded', () => {
    // ⚠ THE GATE'S OWN REGRESSION TEST. T-INFRA-013b was green for the whole
    // life of the undo-at-close defect because its matcher was a bare
    // `\bundoBatch\b`, and `BatchAppliedNotice.tsx` DECLARES a prop by that
    // name. Loosening `callForm` back to a mention would silently restore
    // that blind spot with every other assertion in this file still passing,
    // so the distinction is asserted directly rather than left to review.
    const declarations = [
      '  readonly undoBatch?: (batchId: string) => Promise<void>;',
      '  undoBatch,',
      'onUndoBatch={handler}',
      'type X = { undoBatch: Fn };',
    ];
    for (const line of declarations) {
      expect(callForm('undoBatch').test(line)).toBe(false);
    }

    const calls = [
      'void client.undoBatch(batchId)',
      'await api.undoBatch (id)',
      'return this.undoBatch(\n  batchId,\n)',
    ];
    for (const line of calls) {
      expect(callForm('undoBatch').test(line)).toBe(true);
    }
  });
});
