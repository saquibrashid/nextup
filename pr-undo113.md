## TASK-113 — `laterOwnerEdits` detection → refusal rather than a partial undo

A creates-only batch whose created titles the owner has **since** suppressed or
fix-matched is now **refused** — `409 BATCH_NOT_CREATES_ONLY` with
`details.reason: 'later-owner-edits'` — fully enumerated, writing nothing.

### Why this could not be a provenance predicate

Suppress and un-suppress write **no `batch_change` row at all** (US-031 AC-5,
proven by `T-PROV-013`), and fix-match is an out-of-batch edit. So a batch whose
created titles the owner has since re-decided still reads as **perfectly
creates-only** to `isCreatesOnly` — and SD-03 then **DISCARDS** those rows
outright. That is a hard delete of a decision the batch has no record of, no
soft-deleted copy of, and no ledger entry to replay. The evidence has to come
from the **current rows**, which is why `detectLaterOwnerEdits` takes them as
arguments rather than taking provenance.

### The two detectors, and why each is sound

- **Suppressed** — an _active_ `Suppression` on a created title's current work
  identity. Sound **without a timestamp**: a suppressed work is filtered out
  _before_ any Title is created (REQ-071, US-009 AC-4), so the batch cannot have
  created a title for an already-suppressed identity; the suppression can only
  have arrived afterwards.
- **Fix-matched** — the title's current `workIdentity` no longer equals the
  `extraction_candidate.resolvedWorkIdentity` the batch resolved. ⚠ `matchState`
  **cannot** substitute: close writes `'matched'` for every matched creation and
  fix-match writes the same value.

**Fix-match is reported in preference to suppression** when both apply — SD-06
_migrates_ the suppression onto the new identity (TASK-110), so reporting both
would describe one owner action as two. A title with **no** current identity is
**not** an edit: it is gone or unreadable, and refusing an undo on the strength
of a failed read would strand the owner.

### No new error code

`specs/data-model.md` §8.4 and `specs/api.md` §6.25 keep the code as
`BATCH_NOT_CREATES_ONLY` and vary only `details.reason`, and
`UndoRefusalReason` already carried the `'later-owner-edits'` literal — so
`packages/domain/src/enums.ts` (a contended shared file) is untouched. The
enumeration is deliberately the _same_ builder: whichever way the undo was
refused, the owner needs the same actionable list.

### Gate order (contractual)

`BATCH_ALREADY_UNDONE` → `BATCH_NOT_APPLIED` → `provenance-unavailable` →
`isCreatesOnly` → **later-owner-edits** → plan. `T-UNDO-014g/h` pin the two
refusals that outrank the new one.

### Tests

| Id           | Where                                         | Cases                                   |
| ------------ | --------------------------------------------- | --------------------------------------- |
| `T-UNDO-013` | `apps/api/test/unit/undo.spec.ts`             | 10 — the pure detector                  |
| `T-UNDO-014` | `apps/api/test/unit/batchUndoRoute.spec.ts`   | 8 — the real route, no store            |
| `T-UNDO-004` | `apps/api/test/integration/batchUndo.spec.ts` | 4 — closed through the real close route |

`T-UNDO-004` also covers the two ways the gate could **over**-refuse: an
**inactive** (un-suppressed) row, and a suppression on a work the batch did not
create.

### Mutation testing

10 mutations, each killed by the **named** test, comment-only negative control
survived:

| Mutation                                  | Killed by                                   |
| ----------------------------------------- | ------------------------------------------- |
| detector returns `[]` always              | `T-UNDO-013b`, `T-UNDO-014a`–`d`            |
| drop the unknown-current guard            | `T-UNDO-013f`                               |
| suppression outranks fix-match            | `T-UNDO-013d`                               |
| absent candidate counts as a move         | `T-UNDO-013g`                               |
| no dedupe of a repeated `titleId`         | `T-UNDO-013h`                               |
| gate removed                              | `T-UNDO-014a`–`d`                           |
| `reasonOverride` dropped at the call site | `T-UNDO-014a`, `b`                          |
| `reasonOverride` ignored in the builder   | `T-UNDO-014a`, `b`                          |
| reason always `'later-owner-edits'`       | `T-UNDO-014h`, `T-UNDO-003l`, `T-UNDO-007a` |
| detector fires on **every** created title | `T-UNDO-014e`, `f` + 8 existing             |

That last one is also the **non-vacuity proof for `T-UNDO-014g`**: with the
detector forced to fire on everything, the already-undone batch still reported
`BATCH_ALREADY_UNDONE`, so the ordering is real and not an artefact of the
fixture.

### Ratchet

`T-UNDO-004` was a **declared gap** in `tests/meta/acCoverage.spec.ts`
(`KNOWN_PHANTOM_CITATIONS`). It leaves that list by being **implemented**, not
reclassified — the list is now empty, and a note records that re-adding an id
needs the same justification as any first entry.

### ⚠ Verification caveat

There is **no local Docker**, so the `integration` Vitest project cannot run on
this machine. **`T-UNDO-004` is CI-verified only** (job `5 · test:int`). The
unit, meta, infra, lint, format, coverage, `check:test-ids` and
`check:test-locations` gates were all run locally and pass.
