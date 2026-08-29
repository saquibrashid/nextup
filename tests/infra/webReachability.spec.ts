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
 * ⚠ **BOTH MATCHERS ARE DELIBERATELY LOOSE.** A method referenced anywhere
 * under `src` — called, aliased, or passed as a prop reference — counts as
 * reached, and a module imported by any other `src` module counts as mounted.
 * The gate must not produce a single false positive: a reachability gate that
 * cries wolf gets a baseline entry added to silence it, and then it protects
 * nothing. It is a smoke alarm, not a proof of liveness.
 *
 * ⚠ **AND THE LOOSENESS COST US ONE, EXACTLY AS DESCRIBED ABOVE.** The note
 * below was accurate and its consequence was a shipped dead feature:
 * `undoBatch` and `undoRemovalGroup` were mentioned only in the PROP
 * DECLARATIONS of `ListPage` and `BatchAppliedNotice`, which satisfied this
 * matcher while nothing ever called them — `ReviewRoute` threw the close
 * result away and `ListRoute` passed neither handler. `T-DATA-011`
 * (`apps/web/test/appliedUndoWiring.spec.tsx`) is the assertion that can see
 * that, because it drives the real containers end to end. **The generalisable
 * lesson: this gate proves a NAME IS MENTIONED, never that a CHAIN IS
 * CONNECTED. Do not read a green run here as evidence a feature is live.**
 * Both methods are now genuinely called from `ListRoute`.
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

  it('T-INFRA-013b: every client method is reached from somewhere in the SPA', () => {
    const unreached = clientMethods().filter((method) => {
      const reference = new RegExp(`\\b${method}\\b`);
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
      const reference = new RegExp(`\\b${method}\\b`);
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
});
