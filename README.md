# nextup

> Sign in as the owner, upload screenshots of your Netflix and Max saved lists
> in append-only or full-update mode, confirm what was read from them, and see
> one deduplicated combined list — one row per title, a badge per service —
> that you can filter and sort and that never loses anything without asking you
> first.

[![CI](https://github.com/nextup/nextup/actions/workflows/ci.yml/badge.svg)](https://github.com/nextup/nextup/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What it does

Your saved watchlists are trapped inside separate streaming apps, so answering
*"what have I saved that I could watch right now?"* means opening several apps
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

v1 is single-user, mobile-first responsive web, federated sign-in, **Netflix
and Max only**, hosted on Azure at ≈$11–14/month, with **no credentials, no
scraping, no scheduled jobs, and no telemetry**. It's a personal,
non-commercial project; it exists to test one premise: that a combined list is
worth the price of feeding it by hand.

## Status

🚧 **Pre-alpha** — scaffolded from specs, not yet implemented.

**Next up:** `TASK-001` — *npm-workspaces monorepo scaffold* (`package.json`
workspaces, root `tsconfig.base.json`, per-workspace configs, lint/format).
See [docs/backlog.md](docs/backlog.md).

## Quick start

> The install command is **not run for you**. Run it yourself.

### Prerequisites

- **Node 20** (see [`.nvmrc`](.nvmrc); `nvm use`)
- **Docker** — for the local SQL Server test container
  (`mcr.microsoft.com/mssql/server:2022-latest`) and Azurite blob emulator
- An Azure subscription **only** for deploying (not for local dev): Azure SQL
  Database Basic, Container Apps, Blob Storage, Azure OpenAI `gpt-4.1`, Azure AI
  Vision Read F0. See [docs/architecture.md](docs/architecture.md).

### Install

```bash
npm ci
cp .env.example .env   # then fill in the placeholders
```

### Run

```bash
npm run dev            # Vite dev server (apps/web), proxying /api to the API
```

### Test

```bash
npm run test:unit      # Vitest — pure domain logic
npm run test:int       # Vitest — API surface against the mssql + Azurite containers
npm run test:web       # Vitest + Testing Library — component/screen states
npm run test:e2e       # Playwright — the value loop and the irreversible paths
```

The integration suite expects a SQL Server 2022 container and Azurite; CI wires
them as service containers (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
and [specs/testing.md](specs/testing.md) §3.3a).

## Project structure

```
nextup/
├── apps/
│   ├── api/            Node + Express API; in prod also serves the built SPA
│   └── web/            React + Vite single-page app
├── packages/
│   └── domain/         Shared, pure TypeScript domain (types, identity, rules)
├── infra/              Bicep skeletons — Azure SQL, Blob, Container Apps (ghcr.io)
├── tests/              Cross-cutting unit / integration / e2e / infra tests + fixtures
├── docs/               BRD, PRD, architecture, backlog, roadmap, ADRs, diagrams
└── specs/              Implementation specs incl. the AC → named-test mapping
```

## Documentation

| Document | What's in it |
|---|---|
| [PRD](docs/PRD.md) | User stories and the 230 acceptance criteria |
| [Architecture](docs/architecture.md) | System design, the locked stack, and the cost model |
| [Specs](specs/specs.md) | Implementation detail; [testing.md](specs/testing.md) carries the AC → named-test mapping |
| [Backlog](docs/backlog.md) | What to build, in order (the work order) |
| [Roadmap](docs/roadmap.md) | Sequencing and milestones |
| [ADRs](docs/adr/) | Why the load-bearing decisions are what they are |
| [BRD](docs/BRD.md) | The (personal, non-commercial) business case |
| [Review report](docs/review-report.md) | Known open items from the pre-build review |

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
