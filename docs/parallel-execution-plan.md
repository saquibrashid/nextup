# Parallel execution plan — running multiple coding agents on nextup

**Status:** Advisory. Not a requirement, not traced to a REQ. This plan
describes *how to schedule* the work in `backlog.md`; it does not change
what that work is. Where this document and `backlog.md` disagree about a
task's content or dependencies, **`backlog.md` wins**.

**Audience:** the owner (scheduling decisions) and each coding agent
(lane boundaries, §5).

---

## 1. The honest ceiling

Read `roadmap.md` §1 before reading this. The milestone graph is a
straight line:

```
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7
```

and the critical path in `backlog.md` §2 is **19 sequential links** deep.
`TASK-003` (the CI gate) is written as *"nothing else may start before
this is green"* — a deliberate, hard serialisation point.

**Parallel agents cannot shorten a serial chain.** They can only work on
things that are not on it. Realistic expectation:

| Stage | Parallelism available | Why |
|---|---|---|
| M0 | **None** | Everything depends on TASK-001 → 002 → 003 |
| M1 | Very little | Auth/middleware chain is strictly ordered (018→019/020→023) |
| M2 | Low | Read path is short and mostly linear |
| **M3** | **Highest** | Web ingest UI, API ingest pipeline and fixtures are separable |
| M4–M6 | Low–moderate | Each depends on the previous state machine |
| M7 | **High** | Hardening work is largely additive and independent |

Expect a **20–30% wall-clock reduction**, concentrated in M3 and M7. Not
2×, and not 3×. Anyone promising more has not read the dependency column.

---

## 2. The failure mode that costs more than it saves

Under `ASM-029` the specs **are** the implementation input, and `NFR-004`
demands internal consistency. Multiple agents starting simultaneously will
each encounter the same spec gaps and **each invent a different
resolution** — different repository idioms, different test-naming, three
shapes of the same helper.

You then pay to reconcile divergent codebases. That is strictly worse
than having run them serially.

The mitigation is **sequencing, not coordination**: establish the shared
vocabulary with one agent first, then fan out against it.

---

## 3. Stage 1 — one agent, alone, no exceptions

**Run M0 and M1 with a single agent, serially. Do not parallelise this.**

| Tasks | What they fix in place | Status |
|---|---|---|
| TASK-001, 002, 003, 005 | Monorepo layout, workspace manifests, the 12-job CI gate | ✅ done |
| TASK-006, 008 | Bicep infra, container sizing + SKU pinning | ✅ done |
| TASK-007 | Deploy workflow — **owner-gated: first Azure spend** | ⏳ owner |
| TASK-012, 013, 016 | Domain types, IDs, derivations | ✅ done |
| TASK-022 | **Error envelope + the closed error-code enum** | ✅ done |
| TASK-017 | Prisma schema, initial migration, owner-scoped repository | ⏳ next |
| TASK-018 → 023 | Principal, allow-list, owner scope, middleware order | ⏳ todo |
| TASK-025 | App shell | ✅ done |

Live status is `docs/backlog.md` §1.2 (the ledger), not this table — run
`npm run check:status` for the generated report. This column is a
navigational aid and **will** go stale; the ledger is CI-enforced.

Every one of these defines a convention that later lanes must *conform
to* rather than *invent*. `TASK-022` in particular: the closed error-code
enum is appended to by at least four later tasks (`TASK-155`, `TASK-116`,
`TASK-084`, `TASK-110`). If three agents each append to it independently,
you get three merge conflicts in the same enum and, worse, three
different naming styles inside it.

**Gate:** Stage 1 is complete when CI is green and `TASK-031`
(deployed smoke) passes. Only then fan out.

Owner-dependent M0 items — **TASK-010, 011, 134, 141, 142** — are
yours, not an agent's, and run in parallel with Stage 1 by definition.
`TASK-134` must land before the first real screenshot upload.
**TASK-146 is no longer on this list:** the design is credential-free
(a public ghcr package pulled anonymously; CI publishes with the built-in
`GITHUB_TOKEN`), so there is no PAT for you to mint — see `docs/ghcr-pat.md`.

---

## 4. Stage 2 — the lanes

### 4.1 Why the obvious lane split is wrong

The intuitive split is by *feature*: one agent on clipboard paste
(`TASK-158…165`), one on HEIC ingest (`TASK-147…153`). **This does not
work.** Checking the actual file paths in `backlog.md`:

| File | Claimed by |
|---|---|
| `apps/api/src/routes/batches.ts` | TASK-154 (HEIC) **and** TASK-158 (paste) |
| `apps/api/src/images/transcode.ts` | TASK-149, TASK-154, TASK-155 |
| `packages/domain/src/enums.ts` | TASK-158 (paste) — and the domain lane |
| `apps/api/src/middleware/errorEnvelope.ts` | TASK-155 (OOM) — and Stage 1 |
| `apps/web/src/pages/UploadPage.tsx` | TASK-049, TASK-159 |
| `apps/web/test/pasteCapture.spec.tsx` | TASK-159, 161, 162 |

Feature lanes collide because these features **share a request path**.
Lanes must therefore be drawn by **layer ownership**, not by feature.

### 4.2 The lanes

Each lane owns a set of paths **exclusively**. No other lane writes
inside them.

| Lane | Owns (exclusive write) | M3 tasks | M7 tasks |
|---|---|---|---|
| **A — critical path** | `packages/domain/**`, `apps/api/src/routes/**`, `apps/api/src/services/**`, `apps/api/src/middleware/**` | 054, 057, 060, 065, 071, 074, 148, 158 | — |
| **B — web / UI** | `apps/web/**` (including `apps/web/test/**`) | 049, 059, 069, 070, 159, 160, 161, 162, 166 | 123, 124, 125 |
| **C — image pipeline** | `apps/api/src/images/**`, `apps/api/src/jobs/**`, and the image spec FILES named in `specs/testing.md` §11 | 147, 149, 150, 152, 154, 157 | — |
| **D — infra / ops / docs** | `infra/**`, `docs/runbooks/**`, `docs/evaluation/**` | — | 131, 133, 143, 156 |
| **E — fixtures / test scaffolding** | `tests/fixtures/**`, `tests/extraction/**` | 032, 078, 079, 151 | 097, 115 |

**Lane A keeps your strongest agent and stays serial.** It is the
critical path; the other lanes exist to keep work *off* it.

### 4.2a Before spawning: compute the ready pool, don't estimate it

⚠ **A lane is only worth an agent if there is a queue of genuinely
unblocked work in its paths.** Check mechanically — parse the `Depends on`
column against the §1.2 ledger in `backlog.md` — because the intuition is
reliably wrong.

Measured on 2026-08-12, immediately after the TASK-017 spec reconciliation:

| Point | Tasks with all dependencies satisfied |
|---|---|
| That day | **11** (of which one was web, several were owner-only, and `TASK-126` only *looked* ready because its dependency reads "all feature tests") |
| After TASK-017 | 15 |
| After TASK-017 + the auth chain 018–023 | **23** |

So fanning out *before* the Stage-1 gate has 2–3 agents contending for
roughly five real tasks. **The gate in §3 is not bureaucratic — it is where
the work pool actually doubles.**

Two concrete errors that this check caught, both of which had already been
written into a draft spawn plan:

- **TASK-166 was proposed for the web lane and is not runnable.** It depends
  on TASK-036 and TASK-039 (neither done) and wires `GET /api/titles`, a
  route that does not yet exist. The lane would have stalled on its second
  task.
- **TASK-143 is not a safe early lane, and is more dangerous than it looks.**
  It is the post-revision consistency sweep over the six specs the
  PostgreSQL→Azure SQL change superseded — the same files Stage 1 is
  actively correcting. Worse: those corrections **deliberately retain**
  struck-through PostgreSQL text (`23505`, `pg_cron`, `EXPLAIN`) below the
  correction, because the F-001 rule requires a superseded *instruction* to
  stay visible. An agent sweeping for "PostgreSQL" will read that retained
  history as leftover staleness and delete it — destroying the exact artefact
  the rule exists to produce. **Whoever runs TASK-143 must be told that
  struck-through text is the deliverable, not the defect.**

### 4.3 Tasks that are not assignable to a lane

These span lanes by construction. They run **after** the lanes they
depend on have merged, executed by lane A:

| Task | Why it cannot be laned |
|---|---|
| TASK-163 | Asserts sniff/ceilings/retention hold for pasted bytes — spans B and C |
| TASK-164 | The add-not-swap regression guard — spans B and C, and its whole purpose is to observe both |
| TASK-155 | Writes `errorEnvelope.ts` (a Stage-1 shared file) *and* `transcode.ts` |
| TASK-080, 094, 108, 130 | `T-E2E-001` — end-to-end by definition |
| TASK-126, 127, 128 | Meta-gates over the whole repo |

`TASK-165` (manual iOS paste check) is **owner-dependent** and not
agent-assignable at all.

### 4.4 Off-critical-path by design

`backlog.md` §2 marks the paste tasks as deliberately off the critical
path: **file upload is a complete ingest path on its own** (US-004
AC-16). So lane B slipping costs you one tap per screenshot — not a
demo. That is what makes it a safe lane to parallelise into.

The exception is **TASK-164**, which must not be skipped: it exists to
fail if paste ever displaces upload.

---

## 5. Rules every lane agent must follow

Copy these into each agent's opening prompt. They are also recorded as
invariant 20 in `.github/copilot-instructions.md`.

1. **You own only the paths listed for your lane.** Do not create, edit
   or delete a file outside them.
2. **Shared files are a hard stop.** If your task requires changing any
   file in §6, **stop and report what change is needed**. Do not make
   it. Do not work around it by duplicating the file.
3. **Do not edit `specs/**` or `docs/**` to match your code.** The specs
   are the input. If the spec is wrong, report it — that is a finding,
   not a licence to edit.
4. **Rebase onto `main` before every push.** Never merge `main` into
   your lane branch; never rebase another lane's branch.
5. **CI is the arbiter.** A lane is done when its named tests pass, not
   when the code looks finished.
6. **If you finish early, stop.** Do not pick up work from another lane
   or from the critical path.
7. **Put every test where `specs/testing.md` §11 says, and nowhere else.**
   A `.spec.*` file in an uncollected path **never runs**, so your lane
   reports green having asserted nothing. Web tests go in
   `apps/web/test/`, **never `tests/web/`**. If your task's row in
   `backlog.md` names a path that `npm run check:test-locations`
   rejects, that is a finding to report — not a directory to create.
   Run `npm run check:test-locations` before every push.

---

## 6. Contended files — single ownership, no exceptions

Any change to these is made by **lane A only**, and only between lane
merges:

```
package.json, package-lock.json, and every workspace manifest
tsconfig*.json
.github/workflows/ci.yml
.github/copilot-instructions.md
packages/domain/src/enums.ts          ← the closed error-code enum
apps/api/src/middleware/errorEnvelope.ts
apps/api/src/app.ts                   ← middleware ORDER is load-bearing
apps/api/src/routes/batches.ts
infra/aca.bicep                       ← TASK-008, 027 and 156 all touch it
prisma/schema.prisma and prisma/migrations/**
```

`prisma/migrations/**` deserves special mention: concurrent migration
files from two lanes will apply in filename order, which is timestamp
order, which is **not** dependency order. Migrations are lane A's alone.

---

## 7. Mechanics

Use **git worktrees**, not separate clones — one branch per lane against
shared history:

```powershell
cd C:\Users\srashid\Repos\GitHub_Personal\nextup

# Stage 1 first, on main, with ONE agent. Then:
git worktree add ..\nextup-web    -b lane/web
git worktree add ..\nextup-images -b lane/images
git worktree add ..\nextup-infra  -b lane/infra
git worktree add ..\nextup-tests  -b lane/fixtures
```

Run one Copilot CLI per worktree directory. Opening prompt template:

```
You are working in lane <NAME> of the nextup project.

Read first, in order:
  .github/copilot-instructions.md      (invariants — all 20)
  docs/parallel-execution-plan.md §5   (your lane rules)
  docs/backlog.md                      (your tasks, by ID)
  specs/testing.md                     (how you know you are done)

Your tasks: <TASK-IDs>
You may write ONLY within: <paths from §4.2>

Stop and report instead of editing if you need to change any file
listed in docs/parallel-execution-plan.md §6.

Do not pick up work outside your lane, even if you finish early.
```

**Merge order into `main`:** lane A always first, then C, then B, then
E, then D. Rationale: A defines contracts; C consumes them server-side;
B consumes them client-side; E asserts over the result; D documents it.

Clean up when a lane closes: `git worktree remove ..\nextup-web`.

---

## 8. When to stop parallelising

Kill a lane and fold it back into serial work if any of these appear:

- **Two lanes report the same shared-file stop** — the boundary is drawn
  in the wrong place; redraw it before continuing.
- **Merge conflicts appear in test files.** Conflicts in source are
  normal; conflicts in tests mean two agents are asserting different
  behaviours for the same thing, which is a spec ambiguity, not a merge
  problem.
- **Review time exceeds the time saved.** You are the only reviewer. Four
  lanes producing four PRs a day is a bottleneck with your name on it.
- **You lose track of what is merged.** With no version control history
  before Stage 1 (see `README.md` status), this is the real risk.

Two lanes that you actually review is worth more than five that you
rubber-stamp.

---

## 9. Prerequisite — commit first *(satisfied)*

✅ **Done.** The repository is published at `saquibrashid/nextup` (public),
`main` is protected by two rulesets requiring twelve status contexts, and
Stage 1 work is committed. Worktrees can branch from `main` immediately.

Two things this changes for every lane:

- **Lanes push branches; they never push `main`.** `main` is protected and
  merges are the coordinator's job (merge order in §7).
- **Pushing uses a different GitHub account.** The push identity is
  `saquibrashid`, the working identity is `saquib-rashid-msft`:

  ```powershell
  gh auth switch --user saquibrashid
  git push -u origin lane/<name>
  gh auth switch --user saquib-rashid-msft
  ```

~~The repository has **never been committed**. Worktrees require a git
history to branch from, and parallel work without version control has no
undo. Before anything in this document:~~

```powershell
# SUPERSEDED — the repository is already initialised and published.
# cd C:\Users\srashid\Repos\GitHub_Personal\nextup
# git init
# git add -A
# git commit -m "Initial scaffold from nextup specs (TASK-001 next)"
```
