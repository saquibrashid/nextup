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
cp .env.example .env
```

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
through. A banner at the top pointing elsewhere is for *rationale and design
narrative only* — never for an executable instruction. Several docs carry
revision banners (the datastore changed Cosmos → PostgreSQL → Azure SQL); always
treat the latest revision section as authoritative and struck-through text as
dead.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
