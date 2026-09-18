# nextup

> Sign in as the owner, paste or upload screenshots of your streaming saved lists
> in append-only or full-update mode, confirm what was read from them, and see
> one deduplicated combined list — one row per title, a badge per service —
> that you can filter and sort and that never loses anything without asking you
> first.

[![CI](https://github.com/saquibrashid/nextup/actions/workflows/ci.yml/badge.svg)](https://github.com/saquibrashid/nextup/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What it does

**Supported services:** Netflix, Max, Prime Video, Disney+, Apple TV+,
Paramount+, Starz and Peacock. Imports are owner-uploaded screenshots, not
connections to streaming accounts.

Your saved watchlists are trapped inside separate streaming apps, so answering
_"what have I saved that I could watch right now?"_ means opening several apps
in sequence at the exact moment you have sat down to watch — and titles saved
months ago are effectively lost. Syncing those lists programmatically turns out
not to be viable for anyone: there is no public API, no partner route, and the
services' terms prohibit automation.

nextup takes the only sanctioned path left. You screenshot each service's saved
list, upload the images in an explicitly declared **append-only** or
**full-update** batch, and nextup extracts the titles by OCR/vision, matches
them to TMDB metadata, and merges them into **one deduplicated combined list —
one row per title, a badge per service** — with every change passing through
your review before it is applied. The list **never loses anything without
asking you first**.

The current release is single-user, mobile-first responsive web with federated
sign-in. It supports **Netflix, Max, Prime Video, Disney+, Apple TV+, Paramount+,
Starz and Peacock**, plus a separate rental-discovery waiting list and IMDb
ratings. It is hosted on Azure, with a dated baseline estimate of ≈$11–14/month
([cost assumptions](docs/current-release.md#cost-baseline)), with **no streaming credentials, no
scraping, no scheduled jobs, and no telemetry**. It's a personal,
non-commercial project; it exists to test one premise: that a combined list is
worth the price of feeding it by hand.

## Status

Feature implementation is recorded in the **[generated task status](docs/status.md)**,
including the remaining owner-dependent acceptance work. Read the
**[current release and recorded owner decisions](docs/current-release.md)** and
the **[requirement index](docs/requirement-index.md)** before using older
planning or review documents. Task completion is not a declaration
that live quality, device checks or release acceptance are complete.

## Quick start

> Full instructions, including the offline test loop, are in
> **[docs/getting-started.md](docs/getting-started.md)**.

> The install command is **not run for you**. Run it yourself.

### Prerequisites

- **Node 22** (see [`.nvmrc`](.nvmrc); `nvm use`)
- **Docker** — for the local SQL Server test container
  (`mcr.microsoft.com/mssql/server:2022-latest`) and Azurite blob emulator
- An Azure subscription **only** for deploying (not for local dev): Azure SQL
  Database Basic, Container Apps, Blob Storage, Azure OpenAI `gpt-4.1`, Azure AI
  Vision Read F0. See [docs/architecture.md](docs/architecture.md).

### Install

```bash
npm ci
npx prisma generate --schema prisma/schema.prisma
cp .env.example .env   # then fill in the placeholders
```

### Run

Follow [getting-started section 5](docs/getting-started.md#5-run-the-app-locally)
to configure and start the API **and** the SPA in separate terminals.
`npm run dev` starts only Vite; it does not start or authenticate the API.

### Test

```bash
docker compose -f docker-compose.test.yml up -d   # mssql 2022 + Azurite
npm run db:test        # create nextup_test with the REQUIRED collation, then migrate
npm run test:unit      # Vitest — pure domain logic
npm run test:int       # Vitest — API surface against the mssql + Azurite containers
npm run test:web       # Vitest + Testing Library — component/screen states
npm run build --workspace apps/web
npm run test:e2e       # Playwright — the value loop and the irreversible paths
```

> ⚠ **Do not create the test database any other way.** It must be
> `nextup_test` and it must be created with
> `COLLATE Latin1_General_100_BIN2` — which is exactly what `npm run db:test`
> does, and what CI does. A database created by any other route (a bare
> `prisma migrate deploy` against a new name, a manual `CREATE DATABASE`) gets
> the **server default**, `SQL_Latin1_General_CP1_CI_AS`, and then Prisma's
> `create()` joins its internal `@generated_keys` table variable — which takes
> the database default collation — against the `BIN2` `[id]` column. **Every
> insert fails with Msg 468.**
>
> The symptom points at the wrong layer: dozens of integration failures whose
> stacks all end in `ownerData.ts`, reading unmistakably as an application bug.
> Two people have now lost time to it. **`T-INV-018a` is the only test that
> names the real cause — if it fails, fix the database, not the code:**
>
> ```sql
> SELECT name, collation_name FROM sys.databases;   -- must read Latin1_General_100_BIN2
> ```
>
> See [specs/testing.md](specs/testing.md) §17.

Prepare the database environment and install Playwright browsers as described
in [getting-started](docs/getting-started.md) before these commands.
After the one-time dependency/browser downloads, Prisma generation and image
pulls, the deterministic suites run **offline** —
`NFR-003` makes CI the only feedback loop, so the loop must not depend on a
network. CI wires the same two containers as services (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) and
[specs/testing.md](specs/testing.md) §3.3a).

> ⚠ **HTTPS is a functional dependency, not just a security control.**
> `navigator.clipboard` does not exist on `http://`, so opening the dev server
> from a phone at `http://<LAN-IP>:5173` shows **no "Paste screenshot" button at
> all** — and it looks like a missing feature, not a missing certificate. The
> desktop `Ctrl`/`Cmd`+`V` listener is unaffected. See
> [docs/getting-started.md §6](docs/getting-started.md).

## Project structure

```
nextup/
├── apps/
│   ├── api/            Node + Express API; in prod also serves the built SPA
│   └── web/            React + Vite single-page app
├── packages/
│   └── domain/         Shared, pure TypeScript domain (types, identity, rules)
├── infra/              Bicep infrastructure — Azure SQL, Blob, Container Apps (ghcr.io)
├── tests/              Cross-cutting unit / integration / e2e / infra tests + fixtures
├── docs/               BRD, PRD, architecture, backlog, roadmap, ADRs, diagrams
└── specs/              Implementation specs incl. the AC → named-test mapping
```

## Documentation

| Document                                              | What's in it                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Getting started](docs/getting-started.md)            | Clone → install → run the whole suite offline; the HTTPS/clipboard trap                                                                                                                                                                                                                                                                                                                                                      |
| [Current release](docs/current-release.md)            | Current scope, evidence boundaries, unresolved decisions and dated cost baseline                                                                                                                                                                                                                                                                                                                                             |
| [PRD](docs/PRD.md)                                    | User stories and acceptance criteria; current scope is in section 11                                                                                                                                                                                                                                                                                                                                                         |
| [Architecture](docs/architecture.md)                  | System design, the locked stack, and the cost model                                                                                                                                                                                                                                                                                                                                                                          |
| [Specs](specs/specs.md)                               | Implementation detail; [testing.md](specs/testing.md) carries the AC → named-test mapping                                                                                                                                                                                                                                                                                                                                    |
| [Backlog](docs/backlog.md)                            | What to build, in order (the work order)                                                                                                                                                                                                                                                                                                                                                                                     |
| [Roadmap](docs/roadmap.md)                            | Sequencing and milestones                                                                                                                                                                                                                                                                                                                                                                                                    |
| [Parallel execution](docs/parallel-execution-plan.md) | How to run multiple coding agents at once, and the lane boundaries they must respect                                                                                                                                                                                                                                                                                                                                         |
| [ADRs](docs/adr/)                                     | Why the load-bearing decisions are what they are                                                                                                                                                                                                                                                                                                                                                                             |
| [Runbooks](docs/runbooks/)                            | Operational procedures — start at the [incident playbook](docs/runbooks/incident-playbook.md), which routes by symptom. Includes the [config checklist](docs/runbooks/config-checklist.md), [rollback](docs/runbooks/rollback.md), the pre-authorised [memory up-size](docs/runbooks/scale-up-memory.md) and the [re-used Vision account](docs/runbooks/vision-account-reuse.md) — one live grant that exists in no template |
| [BRD](docs/BRD.md)                                    | The (personal, non-commercial) business case                                                                                                                                                                                                                                                                                                                                                                                 |
| [Review report](docs/review-report.md)                | Historical pre-build review, not current task status                                                                                                                                                                                                                                                                                                                                                                         |

If you are a coding agent, start with
[`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branching, commits, and what
CI enforces. Work is driven by [docs/backlog.md](docs/backlog.md), in order;
every acceptance criterion maps to a named test in
[specs/testing.md](specs/testing.md) — that mapping is the definition of done.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability. nextup stores no
streaming credentials, generates no SAS URLs, and sends screenshot bytes only
to its two extraction endpoints.

## License

[MIT](LICENSE).
