# Contributing to nextup

nextup is a personal, single-owner project, but it is built to be implemented by
an autonomous coding agent from the specs. These conventions keep that possible.

## The one rule that matters most

**Work is driven by [docs/backlog.md](docs/backlog.md), in order.** Each task is
self-contained and names the files it touches. Every acceptance criterion maps
to a **named test** in [specs/testing.md](specs/testing.md); that mapping is the
definition of done. A change with no passing named test is not done.

Read [`.github/copilot-instructions.md`](.github/copilot-instructions.md) before
writing code — it states the stack, the load-bearing invariants, and how to read
the revision banners in the docs.

## Setup

```bash
nvm use            # Node 20 (see .nvmrc)
npm ci
npx prisma generate --schema prisma/schema.prisma
cp .env.example .env
```

> ⚠ **`npx prisma generate` is a SEPARATE step and it is not optional.** `npm ci`
> deletes `node_modules/.prisma`, and nothing in the install regenerates it.
> **Run it again after every `npm ci`, and after any rebase that moves the
> lockfile.** The symptom looks nothing like the cause: `tsc` fails with
> `TS2694`/`TS7006` deep inside `apps/api` (`ownerData.ts`, `titles.ts`,
> `batchLifecycle.ts`) complaining about the `Prisma` namespace, in files you
> did not touch. Two people have lost a debugging cycle to this.

> ⚠ **A local integration database MUST be created with
> `COLLATE Latin1_General_100_BIN2`.** Without it, every Prisma `create()` dies
> with `Msg 468` (_"Cannot resolve the collation conflict"_) and you get a wall
> of dozens of identical failures that look like a code defect. It is not —
> **fix the database, not the code.** CI gets this right in
> `.github/workflows/ci.yml`; a hand-rolled local container does not, because
> the SQL Server image defaults to `SQL_Latin1_General_CP1_CI_AS`. The
> collation is required by `specs/data-model.md` §16: canonical identity
> comparison must be byte-exact, and a case-insensitive collation would
> silently merge two distinct works.

Run the suite locally against the SQL Server 2022 container and Azurite (see
[specs/testing.md](specs/testing.md) §3.3a). No network egress is required or
permitted for unit/integration tests.

## Branching

- Branch off `main`. Suggested name: `task/TASK-00N-short-slug` for backlog
  tasks, or `fix/short-slug` for bugs.
- Keep a branch to one task where you can — tasks are sized for a single unit of
  work.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`.
- Reference the task or issue: `feat(api): upload batch route (TASK-0NN)`.

## Pull requests

Fill in [the PR template](.github/PULL_REQUEST_TEMPLATE.md). A PR must:

- Map every touched acceptance criterion to a named test that passes.
- Add no telemetry/analytics dependency (the allow-list forbids it, TASK-004).
- Leak no secret, connection string, blob URL, or SAS anywhere.
- Contain no destructive migration (`T-MIG-001`).
- Add no scheduler, TTL, Azure SQL Agent job, or Elastic Job (REQ-028, REQ-041).

## What CI enforces

On every push to `main` and every PR (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)): **install → lint →
typecheck → unit → integration → web component → build**. CI is the only gate.
It does not deploy — deployment is a separate workflow (TASK-007).

## Editing the docs (the F-001 rule)

Where a document's text is an **instruction a machine executes top-to-bottom**,
correct it **in place** and put any superseded version **below** it, struck
through. A banner at the top pointing elsewhere is for _rationale and design
narrative only_ — never for an executable instruction. Several docs carry
revision banners (the datastore changed Cosmos → PostgreSQL → Azure SQL); always
treat the latest revision section as authoritative and struck-through text as
dead.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
