# ADR-0015 — Owner-initiated permanent delete from the Removed view

| | |
| --- | --- |
| **Status** | Accepted, 2026-10-09 (`A58`) |
| **Original date** | 2026-10-09, issue #398 |
| **Deciders** | Owner |
| **Supersedes** | The absolute form of REQ-028 / US-023 AC-1, AC-3, AC-5 and G-5 ("nothing is ever hard-deleted"). The rest of REQ-028 stands. |

## 1. Problem and owner decision

The Removed view is a permanent log (REQ-028). The owner wants to delete entries from it for **privacy: the record must be truly gone**. A reversible "dismiss" (hide) was offered and declined, because it keeps the data.

## 2. Decision

Permanent delete is added as a narrow, owner-initiated exception:

- **Only** for listings already `removed`, **only** on an explicit owner request, behind a confirmation naming what is lost.
- **Scope:** one removed listing, plus a separate *Delete all history for this work* (refused whole if any listing of the work is active).
- **Related records:** the `ExtractionCandidate` rows that produced the listing are deleted (they hold raw extracted text). `UploadBatch` rows are kept; the batch becomes non-undoable for that work and is refused through the US-033 enumeration.
- **Title:** deleted only when no listing of any state remains and nothing else references it.
- **Suppression is never deleted** (invariant 1). No tombstone: a reappearing work is a brand-new title (L1/A33).
- **Backups:** Azure SQL 7-day PITR keeps deleted data until it ages out. The confirmation says so; truly immediate erasure from backups is not offered.

## 3. What does not change

No TTL, scheduler, SQL Agent or Elastic Job (invariant 4, `T-INV-013`). Delete never runs without an owner request. `T-INV-012` stays a ratchet: the only addition is the single-purpose module `apps/api/src/repository/purgeRemoved.ts`, allow-listed by `file::model`, modelled on `undoDiscard.ts` (SD-03).

## 4. Consequences

- US-067 / REQ-133 added; G-5 and US-023 amended in place with the old text struck through.
- Specs: `data-model.md` SD-18, I-7 and §8.5; `testing.md` `T-PURGE-*`.
- Work: TASK-276 – TASK-278.
- Accepted trade-off: a deleted record cannot be recovered, by design.
