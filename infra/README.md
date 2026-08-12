# Infrastructure — nextup

Built to **Variant A** (owner decision A40) by **TASK-006**. Everything lives
in **one resource group** — ADR-0003 R2.4: _"no second resource group… no
separate Log Analytics workspace"_.

| Concern            | Choice                                                                                                                                        | File            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Compute            | Azure Container Apps, **0.25 vCPU / 0.5 GiB**, `minReplicas = 1` (always warm), `maxReplicas = 2` for revision transitions, **no scale rule** | `aca.bicep`     |
| Database (prod)    | **Azure SQL Database, Basic** (5 DTU, 2 GB, 7-day PITR) on an Azure SQL logical server                                                        | `sqldb.bicep`   |
| Database (staging) | a **separate serverless auto-paused** database (`nextup_staging`) — billed per-database, ≈$0.50/mo                                            | `sqldb.bicep`   |
| Screenshots        | Azure Blob, private containers `screenshots` / `screenshots-staging`, **30-day lifecycle purge**, soft-delete/versioning/PITR **DISABLED**    | `storage.bicep` |
| Registry           | **`ghcr.io`** — there is **NO** Azure Container Registry resource, no `AcrPull`                                                               | (external)      |
| Blob RBAC          | Storage Blob Data Contributor scoped to a **single container**, never the account                                                             | `rbac.bicep`    |
| Composition        | Log Analytics, identities, module wiring                                                                                                      | `main.bicep`    |

## Deployment shape

`main.bicep` builds **one target** (prod or staging), selected by the
`.bicepparam` file, into the shared resource group:

- **Shared, declared unconditionally** and identical in both deployments —
  Log Analytics, the storage account, the SQL logical server, the Container
  Apps managed environment. Deploying either target is therefore idempotent.
- **Per-environment, conditional** — the database (`nextup` Basic vs
  `nextup_staging` serverless), the Container App, and the blob RBAC grant.

Two account-level singletons are deliberately **unconditional**: the blob
service properties and the lifecycle management policy. If each environment
declared only its own, whichever deployed last would silently delete the
other's — and screenshots would be retained forever.

## Hard rules encoded here (do not "improve" them away)

- **No Azure SQL Agent job, no Elastic Job, no delete trigger, no scheduled
  job, no TTL property anywhere** (REQ-028; `T-INV-013`). Their **absence is
  the requirement**.
- Blob **soft delete, container soft delete, versioning, change feed and PITR
  are OFF**. Enabling any of them looks like good practice and would silently
  retain screenshots past 30 days _while every other test still passed_
  (`T-INFRA-002` is the tripwire).
- **The compute/decode-guard PAIR**: `cpu: json('0.25')` / `memory: '0.5Gi'` /
  `NEXTUP_MAX_DECODE_PIXELS = '25000000'` are **one setting in three places**.
  The allowed combinations are a closed set — `(0.25, 0.5Gi, 25000000)` or
  `(0.5, 1.0Gi, 50000000)`. Change them together via
  `docs/runbooks/scale-up-memory.md` (TASK-156), never independently.
- The **database collation stays case-insensitive**. Identity columns declare
  `COLLATE Latin1_General_100_BIN2` **per column** in the migration DDL, while
  search columns rely on the DB default — see `specs/data-model.md` §16.2.
- Blob RBAC is scoped to a **container**, so "staging has no grant on the
  production container" is true by construction rather than by convention.
- SKUs are **pinned** (`T-INFRA-005`, TASK-008): any change must be a visible
  Bicep diff.

## The compiled template

`infra/main.json` is **generated — do not hand-edit.**

The `T-INFRA-*` tests assert against this compiled ARM rather than the Bicep
source, because the compiled template is what actually deploys; a regex over
`.bicep` could pass while the emitted template said something else. Compiling
inside the tests would make them all depend on the Bicep CLI, so the artifact
is committed and a drift gate keeps it honest.

```bash
npm run infra:build   # regenerate infra/main.json
npm run check:infra   # fail if it no longer matches infra/main.bicep
```

The comparison strips Bicep's `metadata._generator` stamp (version +
templateHash) and compares structurally, so CI/local compiler skew is not
mistaken for drift.

## Parameters and secrets

`main.prod.bicepparam` and `main.staging.bicepparam`, one per environment.

Secrets are read from the environment with **no default**, so a missing
variable fails loudly instead of silently deploying a weak credential:

| Variable                       | Purpose                                  |
| ------------------------------ | ---------------------------------------- |
| `NEXTUP_GHCR_TOKEN`            | ghcr.io fine-grained PAT (TASK-146)      |
| `NEXTUP_SQL_ADMIN_PASSWORD`    | SQL login — the documented fallback path |
| `NEXTUP_ENTRA_ADMIN_LOGIN`     | Entra SQL administrator UPN              |
| `NEXTUP_ENTRA_ADMIN_OBJECT_ID` | Entra SQL administrator object id        |
| `NEXTUP_IMAGE`                 | image tag; defaults to a bootstrap image |

## Not built here, deliberately

| Concern                                        | Owner    |
| ---------------------------------------------- | -------- |
| Easy Auth (`authConfigs`)                      | TASK-027 |
| Managed-identity DB user + smoke migration     | TASK-141 |
| Budget alerts (1.0× informational + 1.5×)      | TASK-142 |
| OOM/restart alert rules (`infra/alerts.bicep`) | TASK-157 |
| ghcr.io PAT issue and rotation                 | TASK-146 |

## Deploy path

GitHub Actions (`.github/workflows/deploy.yml`, **TASK-007**): build → push to
`ghcr.io` → deploy to **staging** → `prisma migrate deploy` → staging smoke →
prod (new revision at 0% traffic → smoke → shift to 100%). `azd` is **not**
used, so there is no `azure.yaml`.
