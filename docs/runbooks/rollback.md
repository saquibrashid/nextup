---
createdAt: 2026-08-18T22:05:00-04:00
createdBy: solution-architect
phase: 8
revision: 1
status: active
appliesTo: nextup production Container App (ca-nextup-prod, resource group nextup-rg)
forcedBy: TASK-133 — cited by .github/workflows/deploy.yml and infra/aca.bicep, previously missing
verifiedAgainst: live Azure, eastus2, 2026-08-18 (rehearsed end-to-end on ca-nextup-staging)
---

# RUNBOOK — Roll production back to the previous revision

> **Read this if:** a deploy reached production and the app is broken —
> wrong behaviour, 5xx, a bad migration's application-side effects, or a
> smoke test that only failed once real traffic hit it.
>
> **Time to recover: about one minute.** Rollback is a *revision switch*,
> not a rebuild: every previously deployed image is still present as a
> deactivated revision, so there is nothing to build, push or migrate.
>
> ⚠ **Two commands, in this order — never one.** See §1. Running only the
> traffic command is the documented way to turn a broken deploy into a
> **total outage**, and Azure will tell you it succeeded.

---

## 0. The two facts that make this runbook necessary

Both were verified against live Azure on 2026-08-18, by rehearsing the
whole procedure on `ca-nextup-staging` (which runs `minReplicas = 0`, so
the rehearsal is free and nobody is watching). **Neither is intuitive and
both are silent.**

### 0.1 `az containerapp revision list` HIDES the revision you need

The default listing shows **only active revisions**. Production has
exactly one of those — the one that is currently broken.

```bash
az containerapp revision list -n ca-nextup-prod -g nextup-rg -o table
#   1 revision.  Looks like there is nothing to roll back to.

az containerapp revision list -n ca-nextup-prod -g nextup-rg --all -o table
#   13 revisions.  Twelve of them are your rollback targets.
```

**Always pass `--all`.** Measured on 2026-08-18: 13 revisions existed, 1
active. An operator who omits `--all` mid-incident will reasonably
conclude that rollback is impossible and start rebuilding — the slowest
possible response to the fastest possible fix.

### 0.2 Shifting traffic to a DEACTIVATED revision succeeds, then serves 404

This is the dangerous one, because it is exactly the situation you are in:
`deploy.yml` **deactivates the superseded revision** after every
successful traffic shift (it must — prod runs `minReplicas = 1`, so every
active revision bills a replica for ever). So the revision you want to
roll back to is, by design, **inactive**.

Rehearsed on staging, in order:

| Step                                                     | Result                    |
| -------------------------------------------------------- | ------------------------- |
| `ingress traffic set` → a **deactivated** revision        | **Exit 0. Prints the new weight table. No warning.** |
| `GET /api/health`                                         | **HTTP 404**              |
| `revision activate`, then re-probe                        | HTTP 200                  |

Azure accepts the assignment, reports success, and routes 100 % of traffic
to a revision that has no replicas. **The CLI's success is not evidence
that the rollback worked.** Activate first; verify health; then shift.

---

## 1. The procedure

### 1a. Find the revision to roll back to

```bash
az containerapp revision list -n ca-nextup-prod -g nextup-rg --all \
  --query "[].{rev:name,active:properties.active,health:properties.healthState,created:properties.createdTime}" \
  -o table
```

Pick the newest revision that is **not** the current one and that you
believe was good. The image tag on each revision is the **commit sha**, so
you can map a revision to a commit directly:

```bash
az containerapp revision show -n ca-nextup-prod -g nextup-rg \
  --revision <REV> --query "properties.template.containers[0].image" -o tsv
# ghcr.io/saquibrashid/nextup:<40-char sha>
```

Export it once so the rest of this runbook is copy-paste:

```bash
REV=ca-nextup-prod--0000011   # ← the KNOWN-GOOD one, not the broken one
```

### 1b. Activate it — **first**

```bash
az containerapp revision activate -n ca-nextup-prod -g nextup-rg --revision "$REV"

az containerapp revision show -n ca-nextup-prod -g nextup-rg \
  --revision "$REV" --query "{active:properties.active,health:properties.healthState}" -o json
```

**Do not continue until this prints `"active": true` and
`"health": "Healthy"`.** Skipping or racing this step is §0.2 — an
outage that reports success.

### 1c. Shift 100 % of traffic to it

```bash
az containerapp ingress traffic set -n ca-nextup-prod -g nextup-rg \
  --revision-weight "$REV=100"

az containerapp ingress traffic show -n ca-nextup-prod -g nextup-rg -o json
```

Expect exactly one entry: `{ "revisionName": "<REV>", "weight": 100 }`.
Takes roughly 30 seconds to apply.

### 1d. Verify against the real endpoint, not the control plane

```bash
FQDN=$(az containerapp show -n ca-nextup-prod -g nextup-rg \
  --query "properties.configuration.ingress.fqdn" -o tsv)
curl -sS -o /dev/null -w '%{http_code}\n' "https://$FQDN/api/health"
```

**Expect `200`.** The response body will be a Microsoft login redirect —
that is Easy Auth doing its job (`ADR-0002`), not a failure. A `404` here
means §0.2 happened: go back to §1b.

### 1e. Deactivate the bad revision — only after §1d passes

```bash
az containerapp revision deactivate -n ca-nextup-prod -g nextup-rg \
  --revision <THE-BROKEN-ONE>
```

Prod runs `minReplicas = 1`, so a revision left active bills a replica
indefinitely — this step is what stops each incident from permanently
raising the floor of the monthly bill. It is **last** on purpose: while
the rollback is unproven, the broken revision is still your only fallback.
Deactivating does **not** delete it; it stays listed under `--all` and can
be reactivated, which is what makes this whole procedure reversible.

---

## 2. After the rollback

Production is now serving old code, and **`main` still contains the broken
commit**. `deploy.yml` triggers on push to `main`, so *the next merge to
`main` will redeploy the bug and silently undo this rollback.*

Do one of these before anything else lands:

1. **Revert the commit** (`git revert <sha>`) and let the pipeline deploy
   the revert. Preferred — it keeps `main` and production in agreement.
2. **Fix forward**, if the fix is genuinely small and you can test it.
3. If neither is possible immediately, **say so in the repo** (an issue or
   a line in `docs/status.md`). A rolled-back production that nobody has
   recorded looks exactly like a healthy one.

**A rollback is not a fix.** The revision switch buys time; it does not
change the code.

---

## 3. What this runbook does NOT cover

- **Database migrations.** A rollback moves the *application* back; it does
  not undo a schema change. This is survivable by construction rather than
  by luck: `T-MIG-001` forbids destructive DDL in `prisma/migrations/**`
  (`DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `DROP CONSTRAINT`,
  `TRUNCATE`, column `sp_rename`), so an older application binary meets a
  schema that is only ever additive. If you are here because a migration
  itself failed, this is the wrong runbook — the database has 7-day
  point-in-time restore (`ADR-0005`), and PITR is a **last resort that
  loses data written since the restore point**.
- **Data loss.** Nothing in nextup deletes user data (`REQ-028`, soft
  delete forever), so a rollback cannot resurrect deleted rows — there are
  none.
- **An up-size.** If the symptom is `IMAGE_DECODE_OOM` or a replica
  restart, you want `docs/runbooks/scale-up-memory.md`, not this.

---

## 4. Environment differences — staging is NOT shaped like production

Rehearsing on staging is encouraged (that is how this runbook was
verified), but **the first command differs** and the difference is easy to
miss:

| | `ca-nextup-prod` | `ca-nextup-staging` |
| --- | --- | --- |
| `activeRevisionsMode` | `Multiple` | `Multiple` |
| Traffic pinned to | a **named revision** | **`latestRevision: true`** |
| `minReplicas` | `1` | `0` |
| Superseded revisions deactivated by the pipeline | **yes** | **no** |

On staging, traffic follows whatever deployed last, so pinning a named
revision *overrides* that and it stays overridden. **Restore it
afterwards** or every later staging deploy will build a revision that
serves nobody:

```bash
az containerapp ingress traffic set -n ca-nextup-staging -g nextup-rg \
  --revision-weight latest=100
```

⚠ Because staging never deactivates anything, it accumulates active
revisions — **16 revisions, 13 of them active** on 2026-08-18, one per
push. At `minReplicas = 0` this costs nothing, but Container Apps caps
revisions per app, so this will eventually start failing staging deploys.
Tracked as a finding, not fixed here.

---

## 5. Provenance

Every command above was executed against live Azure on 2026-08-18 during
a full rehearsal on `ca-nextup-staging`: traffic pinned to an older
revision, a revision deactivated while serving 100 % traffic (producing
the 404 in §0.2), reactivated, and staging returned to
`latestRevision: true` with `/api/health` back to `200`. **Production
state was not modified.**

Consequently §0.2 also corrects a comment in
`.github/workflows/deploy.yml`, which described rollback as "this same
command naming the old revision". It is two commands, and the order is
load-bearing.
