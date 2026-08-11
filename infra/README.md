# Infrastructure — nextup

**Skeleton only.** Resources are declared as commented intent so the shape is
visible; the real definitions are built by **TASK-006** against **Variant A**
(owner decision A40). Do not `az deployment` this as-is.

## The target (Variant A, ~$11–14/month)

| Concern | Choice | File |
|---|---|---|
| Compute | Azure Container Apps, **0.25 vCPU / 0.5 GiB**, `minReplicas = 1` (always warm), `maxReplicas = 2` for revision transitions, **no scale rule** | `aca.bicep` |
| Database (prod) | **Azure SQL Database, Basic** (5 DTU, 2 GB, 7-day PITR) on an Azure SQL logical server | `sqldb.bicep` |
| Database (staging) | a **separate serverless auto-paused** Azure SQL database (`nextup_staging`) — billed per-database, there is **no shared server** | `sqldb.bicep` |
| Screenshots | Azure Blob, private containers `screenshots` / `screenshots-staging`, **30-day lifecycle purge**, soft-delete/versioning/PITR **DISABLED** | `storage.bicep` |
| Registry | **`ghcr.io`** — there is **NO** Azure Container Registry resource, no `AcrPull` | (external) |
| Composition | environment, identities, RBAC, Log Analytics, budget alerts | `main.bicep` |

## Hard rules encoded here (do not "improve" them away)

- **No Azure SQL Agent job, no Elastic Job, no delete trigger, no scheduled
  job, no TTL property anywhere** in the compiled ARM (REQ-028; `T-INV-013`).
- **No `infra/postgres.bicep` and no `infra/acr.bicep`** — those are superseded
  names (review finding F-006). The datastore is Azure SQL; the registry is
  `ghcr.io`.
- Blob **soft delete, container soft delete, versioning and PITR are OFF** —
  enabling any of them silently retains screenshots past 30 days and breaks
  NFR-019 invisibly (`T-INFRA-002`).
- DB auth: **managed identity preferred (secretless)**; the fallback is a
  Key-Vault SQL login surfaced as a KV-referenced Container Apps secret
  (decided at M0, TASK-141). The staging identity has **no** grant on the
  production database or blob container.
- SKUs are **pinned** (`T-INFRA-005`): any change must be a visible Bicep diff.

## Parameters

`main.prod.bicepparam` and `main.staging.bicepparam` — one per environment.

## Deploy path

GitHub Actions (`.github/workflows/deploy.yml`, **TASK-007**): build → push to
`ghcr.io` → deploy to **staging** → `prisma migrate deploy` → staging smoke →
prod (new revision at 0% traffic → smoke → shift to 100%). `azd` is **not**
used, so there is no `azure.yaml`.
