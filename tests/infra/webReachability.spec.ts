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

/**
 * Optional props a component declares AND uses, which no caller ever supplies.
 *
 * ⚠ **A RATCHET, NOT A PERMISSION**, and every entry states why it is not a
 * defect. An entry whose justification you cannot write is a defect.
 *
 * Deliberate override seams — a real runtime default, overridable for tests:
 * - `ImageDropzone.touch` — defaults to the `isTouchDevice()` probe. The prop's
 *   own doc records that an EARLIER version had no probe and the iOS paste hint
 *   therefore "rendered only in tests"; the probe is the fix, this is the seam.
 * - `PasteCapture.target` — defaults to the real `document`.
 * - `ReviewPage.storage` — defaults to real session storage.
 * - `TmdbAttribution.disclaimer`, `.logoPath`, `.omdbDisclaimer` — the
 *   attribution copy and asset are fixed by TMDB's terms; the props exist so a
 *   test can assert the exact required strings rather than restate them.
 *
 * Genuinely unwired, each a separately-tracked gap — NOT permission for a
 * fifth:
 * - `ImageDropzone.onPasteFailed` — forwarded to `PasteButton` but supplied by
 *   no container, so a clipboard-read failure is silent in the SPA.
 * - `RemovalConfirmDialog.submitting` — the confirm/cancel buttons never
 *   disable while the removal is in flight. On the IRREVERSIBLE full-update
 *   path this is a double-submit waiting to happen.
 * - `BatchStatusPage.offline` — the offline banner never renders, so a poll
 *   that has stopped because the device dropped off the network is
 *   indistinguishable from one that is merely slow.
 * - `RefusalPage.signedInEmail` — the refusal screen never says WHICH account
 *   was refused, which is precisely the information needed when a personal and
 *   a work identity both resolve through the same `/common` issuer.
 */
const BASELINE_UNSUPPLIED = new Set([
  'apps/web/src/components/ImageDropzone.tsx ImageDropzone.onPasteFailed',
  'apps/web/src/components/ImageDropzone.tsx ImageDropzone.touch',
  'apps/web/src/components/PasteCapture.tsx PasteCapture.target',
  'apps/web/src/components/RemovalConfirmDialog.tsx RemovalConfirmDialog.submitting',
  'apps/web/src/components/TmdbAttribution.tsx TmdbAttribution.disclaimer',
  'apps/web/src/components/TmdbAttribution.tsx TmdbAttribution.logoPath',
  'apps/web/src/components/TmdbAttribution.tsx TmdbAttribution.omdbDisclaimer',
  'apps/web/src/pages/BatchStatusPage.tsx BatchStatusPage.offline',
  'apps/web/src/pages/RefusalPage.tsx RefusalPage.signedInEmail',
  'apps/web/src/pages/ReviewPage.tsx ReviewPage.storage',
]);

/**
 * The body of a `<Name ...>` opening tag, honouring nesting and strings.
 *
 * ⚠ Ending at the first `>` is WRONG and inverts the result: an arrow-function
 * prop contains a `>`, so every attribute after it reads as never-supplied.
 */
function openingTagBodies(text: string, name: string): string[] {
  const bodies: string[] = [];
  for (const m of text.matchAll(new RegExp(`<${name}(?=[\\s/>])`, 'g'))) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    let i = start;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote !== null) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    bodies.push(text.slice(start, i));
  }
  return bodies;
}

/** Optional member names of an interface body, at depth 0 only. */
function optionalPropsOf(interfaceSource: string): string[] {
  const body = /\{([\s\S]*)\n?\}/.exec(interfaceSource);
  if (body === null) return [];
  const names: string[] = [];
  let depth = 0;
  for (const line of body[1].split('\n')) {
    if (depth === 0) {
      const p = /^\s*(?:readonly\s+)?(\w+)\?:/.exec(line);
      if (p?.[1] !== undefined) names.push(p[1]);
    }
    for (const ch of line) {
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
    }
  }
  return names;
}

function componentFiles(): string[] {
  return FILES.filter((f) => /[\\/](components|pages)[\\/]/.test(f));
}

/** Synthetic single-case driver, for the parser guards in `h`. */
function unsuppliedIn(iface: string, component: string, prop: string, callSite: string): boolean {
  let mounted = false;
  for (const body of openingTagBodies(callSite, component)) {
    mounted = true;
    if (new RegExp(`\\b${prop}\\s*=`).test(body) || /\{\s*\.\.\./.test(body)) return false;
  }
  return mounted && optionalPropsOf(iface).includes(prop);
}

function neverSuppliedProps(): string[] {
  const found: string[] = [];
  for (const file of componentFiles()) {
    const text = TEXT.get(file);
    if (text === undefined) continue;

    for (const m of text.matchAll(/interface\s+(\w+)Props\s*\{([\s\S]*?)\n\}/g)) {
      const component = m[1];
      if (component === undefined) continue;

      for (const prop of optionalPropsOf(`{${m[2]}\n}`)) {
        // Declared and destructured but otherwise unused is a dormant prop,
        // not a broken feature: there is no behaviour behind it to be dead.
        const uses = (text.match(new RegExp(`\\b${prop}\\b`, 'g')) ?? []).length;
        if (uses < 2) continue;

        let mounted = false;
        let supplied = false;
        for (const [, other] of TEXT) {
          for (const body of openingTagBodies(other, component)) {
            mounted = true;
            if (new RegExp(`\\b${prop}\\s*=`).test(body) || /\{\s*\.\.\./.test(body)) {
              supplied = true;
            }
          }
        }
        if (mounted && !supplied) {
          found.push(`${path.relative(ROOT, file).replace(/\\/g, '/')} ${component}.${prop}`);
        }
      }
    }
  }
  return found.sort();
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

  it('T-INFRA-013f: every optional prop a component USES is supplied by some caller', () => {
    // ⚠ THE FOURTH INSTANCE OF THIS DEFECT, AND THE FIRST THIS FILE COULD NOT
    // SEE. `b` proves a client method is called; `d` proves a module is
    // mounted. Neither can see a component that IS mounted, by a caller that
    // simply never passes one of its props — the prop defaults, the branch
    // guarded by it is dead, and the component's own test supplies the prop
    // itself and goes green. That is disguise #1, the `T-PASTE-002i` shape.
    //
    // It was live in two places at once, both on the fabrication-review path
    // that RSK-028 depends on: `CandidateCard.thumbnailUrl` (the tile the
    // owner is supposed to verify an uncorroborated model guess against — a
    // `must` in `specs/ui.md` §5.3a, never rendered) and
    // `CandidateCard.unidentified` (the "not identified" chip, never shown).
    // Both had passing component tests.
    const offenders = neverSuppliedProps();
    const unexpected = offenders.filter((o) => !BASELINE_UNSUPPLIED.has(o));
    expect(unexpected).toEqual([]);
  });

  it('T-INFRA-013g: a baselined prop that has since been wired must leave the baseline', () => {
    // The same discipline as `c`. Without it the ratchet loosens by one entry
    // every time a gap is closed, and the list decays into a permission slip.
    const offenders = new Set(neverSuppliedProps());
    const stale = [...BASELINE_UNSUPPLIED].filter((entry) => !offenders.has(entry));
    expect(stale).toEqual([]);
  });

  it('T-INFRA-013h: the prop sweep discriminates — its parser is guarded in both directions', () => {
    // ⚠ NON-VACUITY PLUS THREE PARSER TRAPS, EACH OF WHICH MADE THIS SWEEP
    // REPORT THE OPPOSITE OF THE TRUTH WHILE IT WAS BEING BUILT. A detector
    // that silently returns [] satisfies `f` perfectly and measures nothing.
    expect(componentFiles().length).toBeGreaterThan(10);
    expect(BASELINE_UNSUPPLIED.size).toBeGreaterThan(0);

    // Trap 1 — a JSX tag body cannot be matched up to the first `>`, because
    // `onContinue={() => {...}}` contains one. Truncating there reported
    // `BatchStatusPage.onContinue` and `RemovedPage.onRestore` as unsupplied
    // when both are wired by their containers.
    const arrow = "<Thing onContinue={() => { go(); }} onRestore={(a) => f(a)} />";
    expect(openingTagBodies(arrow, 'Thing')).toHaveLength(1);
    expect(/\bonRestore\s*=/.test(openingTagBodies(arrow, 'Thing')[0] ?? '')).toBe(true);

    // Trap 2 — a prop whose TYPE is a function signature spans lines and
    // carries its own optional parameters. A line-wise scan read `opts?:`
    // inside `onRestore`'s type as a prop of the page.
    expect(optionalPropsOf(['interface XProps {', '  readonly onR?: (', '    o?: number,', '  ) => void;', '}'].join('\n')).sort()).toEqual(['onR']);

    // Trap 3 — a file exports several components and each props interface
    // belongs to ITS OWN one. Matching every interface to the file's basename
    // asked `<FilterBar>` about a prop of `<ZeroMatch>`, and reported two
    // correctly-wired controls as dead.
    expect(openingTagBodies('<ZeroMatch onClear={c} />', 'FilterBar')).toEqual([]);

    // The positive control: a component mounted without a prop it uses IS
    // reported, and supplying that prop silences it.
    expect(unsuppliedIn('interface WProps { readonly hint?: string }', 'W', 'hint', '<W />')).toBe(
      true,
    );
    expect(
      unsuppliedIn('interface WProps { readonly hint?: string }', 'W', 'hint', '<W hint={x} />'),
    ).toBe(false);
    // A spread counts as supplying: `{...props}` may carry it and a gate that
    // ignored that would fail on correct code and get deleted.
    expect(
      unsuppliedIn('interface WProps { readonly hint?: string }', 'W', 'hint', '<W {...rest} />'),
    ).toBe(false);
  });
});
