---
createdAt: 2026-08-11T10:50:30-04:00
createdBy: solution-architect
phase: 8
revision: 1
status: active
appliesTo: nextup production Container App
forcedBy: A43 / OQ-028 (owner accepted the reactive up-size strategy), RSK-016
---

# RUNBOOK — Up-size nextup compute: 0.25 vCPU / 0.5 GiB → 0.5 vCPU / 1.0 GiB

> **Read this if:** an import just died, or an image was refused with
> `IMAGE_TOO_LARGE_TO_DECODE` or `IMAGE_DECODE_OOM`, or the
> **`nextup-prod-replica-restart`** alert fired.
>
> **You are not debugging. This is the documented remedy.** The
> architecture deliberately starts at 0.5 GiB and up-sizes *reactively*
> — that is decision **A43**, taken by the owner with this failure mode
> explicitly disclosed (`OQ-028`, closed; `RSK-016` is an
> **owner-accepted residual risk**, not a defect).
>
> **Cost of doing this: +$5.92/month** *(verified against live Azure retail
> prices for `eastus2`, 2026-08-17, TASK-010)*. Compute goes **$4.30 →
> $10.22**; the system total goes **$11.77 → $17.69/month**.
>
> ⚠ **This was published as "+~$4/month" and that was 48 % low.** The
> correction is recorded rather than quietly swapped, because the +$4 figure
> is what the owner saw when pre-authorising this remedy at `A43`. **The
> decision does not change at $5.92** — the remedy is still pre-authorised
> and still the right move when a real OOM occurs — but nobody should
> discover the true figure from a bill.
>
> ~~*Superseded 2026-08-17 by TASK-010's live verification: "**Cost of doing
> this: +~$4/month.** Compute goes ~$5–8 → ~$9–12; the system total goes
> ~$11–13 → **~$15–18/month**. ⚠ Every figure here is an unverified Azure
> list price recalled from model knowledge — **treat as ±30 % (`RSK-029`)**
> until `TASK-010` re-verifies it. The direction and the shape of the change
> are certain; the exact dollar figure is not."*~~

---

## 0. The 60-second version

Run **one command**, wait ~60 s, run **one check**, then **commit one
Bicep change** so the next deploy does not undo it.

```bash
# 1. APPLY (one command — up-sizes compute AND raises the decode guard together)
az containerapp update \
  --name nextup \
  --resource-group rg-nextup \
  --cpu 0.5 \
  --memory 1.0Gi \
  --set-env-vars NEXTUP_MAX_DECODE_PIXELS=50000000
```

```bash
# 2. CONFIRM (must print cpu 0.5 and memory "1Gi")
az containerapp show -n nextup -g rg-nextup \
  --query "properties.template.containers[0].resources" -o json
```

```
# 3. THEN commit the Bicep change in §4. If you skip step 3 the next
#    CI deploy silently reverts you to 0.5 GiB and the import dies again.
```

Then **re-attach the image that failed** (see §6 — what is and is not
recoverable).

---

## 1. Preconditions

| Check | Command / how |
|---|---|
| Azure CLI signed in, right subscription | `az account show -o table` |
| `containerapp` extension present | `az extension add --name containerapp --upgrade` (no-op if current) |
| You know the real resource names | Defaults assumed here: app **`nextup`**, resource group **`rg-nextup`**. If yours differ: `az containerapp list -o table` |
| You are targeting **prod**, not staging | Staging is a *different* Container App at `minReplicas = 0`. Up-sizing staging fixes nothing. |

**No downtime is required and none is expected.** Container Apps rolls
out a new revision; in single-revision mode the old replica is drained
after the new one is ready. The app is always-warm (`minReplicas = 1`),
so this change introduces no cold start.

---

## 2. Apply the change (the exact command)

```bash
az containerapp update \
  --name nextup \
  --resource-group rg-nextup \
  --cpu 0.5 \
  --memory 1.0Gi \
  --set-env-vars NEXTUP_MAX_DECODE_PIXELS=50000000
```

**Why the env var is in the same command, and must stay in the same
command.** The pre-decode pixel guard (ADR-0008 R2) refuses images above
`NEXTUP_MAX_DECODE_PIXELS` **before allocating any decode buffer**. Its
value is a function of the container's memory size:

| Container memory | `NEXTUP_MAX_DECODE_PIXELS` | Largest accepted image |
|---|---|---|
| **0.5 GiB** (as designed) | **25000000** (25 MP) | ~5760 × 4320 |
| **1.0 GiB** (this remedy) | **50000000** (50 MP) | ~8192 × 6144 — covers 48 MP iPhone Pro captures |

If you up-size the container but leave the guard at 25 MP, the image
that triggered this runbook **will still be refused** and you will have
spent $5.92/month for nothing. If you raise the guard without up-sizing,
you have removed the thing that was keeping a bad image from killing the
whole container. **They move together, always.**

**Valid ACA CPU/memory pairs are constrained** — memory must be
`2 × cores` GiB. `0.5` ⇄ `1.0Gi` is a valid pair; `0.5` ⇄ `0.5Gi` is not
and will be rejected by the platform.

---

## 3. Confirm it took effect

**3a. Resource sizing (the authoritative check):**

```bash
az containerapp show -n nextup -g rg-nextup \
  --query "properties.template.containers[0].resources" -o json
```

Expected:

```json
{
  "cpu": 0.5,
  "memory": "1Gi"
}
```

⚠ **Azure normalises `1.0Gi` to `1Gi`.** That is not a failure — `1Gi`
is the success case. If it still says `0.5Gi`, the update did not land;
re-run §2 and read the CLI error.

**3b. The guard value actually reached the container:**

```bash
az containerapp show -n nextup -g rg-nextup \
  --query "properties.template.containers[0].env[?name=='NEXTUP_MAX_DECODE_PIXELS']" -o json
```

Expected `"value": "50000000"`.

**3c. A new revision is running and healthy:**

```bash
az containerapp revision list -n nextup -g rg-nextup \
  --query "[?properties.active].{revision:name,replicas:properties.replicas,state:properties.runningState,created:properties.createdTime}" \
  -o table
```

Expect exactly one active revision, created within the last few minutes,
with `replicas: 1` and a running state. If it is not running after ~2
minutes, read the system logs:

```bash
az containerapp logs show -n nextup -g rg-nextup --type system --tail 50
```

**3d. End-to-end proof (do this — the CLI printing `1Gi` is not proof the
app works):** open nextup, sign in, and re-attach the single image that
failed. If it now transcodes, the remedy worked.

---

## 4. The Bicep change — **REQUIRED, not optional**

The CLI change in §2 is **configuration drift**. `infra/aca.bicep` is
the source of truth and the next `az deployment group create` — or the
next CI deploy — **will revert you to 0.25 vCPU / 0.5 GiB and the import
will die again, for no visible reason.** Also, `T-INFRA-005` asserts the
pinned SKU and **will fail CI** until the Bicep matches reality; that
failing test is a feature — it is the drift detector.

In **`infra/aca.bicep`**, in the container template:

```bicep
// AFTER — the remedy applied (A43 reactive up-size taken on <YYYY-MM-DD>)
resources: {
  cpu: json('0.5')
  memory: '1.0Gi'
}
```

```bicep
// ~~BEFORE — the as-designed size, correct until the up-size is actually taken~~
// resources: {
//   cpu: json('0.25')
//   memory: '0.5Gi'
// }
```

And the matching environment variable in the same file:

```bicep
// AFTER
{ name: 'NEXTUP_MAX_DECODE_PIXELS', value: '50000000' }
```

```bicep
// ~~BEFORE~~
// { name: 'NEXTUP_MAX_DECODE_PIXELS', value: '25000000' }
```

`cpu` **must** be written as `json('0.5')`, not a bare `0.5` — Bicep has
no decimal literal type and a bare `0.5` will not compile.

Then regenerate the compiled ARM artifact — **`npm run infra:build`** — or
`check:infra` will fail CI on drift between `infra/main.bicep` and the
committed `infra/main.json`.

Then update `T-INFRA-005`'s expected SKU (`tests/infra/sku.spec.ts`) to
`0.5` / `1.0Gi` / `50000000`. Both the pinned values (`T-INFRA-005b`,
`T-INFRA-005c`) and the single-value mutation cases (`T-INFRA-005d`–`f`,
which mutate *away* from the deployed pair) move together. Do **not** relax
`ALLOWED_COMPUTE_PAIRS` in `tools/check-infra.mjs` — `0.5` / `1.0Gi` /
`50000000` is already in the permitted set, so no change is needed there. If
you find yourself widening that set, you are taking an up-size that has not
been sanctioned.

Commit all of it together with the message
`infra: up-size ACA to 0.5 vCPU / 1.0 GiB per A43 reactive remedy`, and
deploy. The CLI change and the Bicep change now agree, and nothing will
silently revert.

---

## 5. Rollback

Rolling back is the same command with the original values — **both of
them, together**:

```bash
az containerapp update \
  --name nextup \
  --resource-group rg-nextup \
  --cpu 0.25 \
  --memory 0.5Gi \
  --set-env-vars NEXTUP_MAX_DECODE_PIXELS=25000000
```

Then revert the `infra/aca.bicep` and `T-INFRA-005` changes from §4
(`git revert` the single commit) so source and reality agree again.
Confirm with §3a — expect `"cpu": 0.25, "memory": "0.5Gi"`.

**Why you might roll back:** the up-size did not fix the failure, so the
$5.92/month is buying nothing and the real cause is elsewhere (see §7).
**Why you probably should not:** if a real OOM happened once at 0.5 GiB,
the image class that caused it still exists in the owner's camera roll.

*(Alternative: `az containerapp revision list` + `az containerapp
revision activate` can restore a previous revision, but revision juggling
is more error-prone than re-running one explicit `update` with known
values. Prefer the command above.)*

---

## 6. What is recoverable, and what you must re-attach

This determines whether you can use `REQ-074` re-extraction or must
re-pick the file. **Nothing is ever partially committed** — a batch
becomes visible only in a single transaction at review-close
(`diagrams/sequence-full-update-batch.md`), so a death during ingest or
extraction can never leave a half-applied batch.

| What failed | Was the image stored? | How to retry after up-sizing |
|---|---|---|
| **Pre-decode guard refused it** (`IMAGE_TOO_LARGE_TO_DECODE`) — no memory was ever allocated | **No.** Refused before the blob write. | **Re-attach the file.** `REQ-074` cannot help — there is no retained image to re-extract from. |
| **Decode ran out of memory during transcode** (`IMAGE_DECODE_OOM`) | **No.** The transcode is inline and precedes the blob write (ADR-0008). | **Re-attach the file.** `REQ-074` does not apply. |
| **The container was killed mid-request** (hard OOM kill) | **Possibly** — a blob may exist with no row referencing it. An orphan blob is harmless and is purged by the 30-day lifecycle rule (`NFR-019`). | **Re-attach the file.** Other images already accepted into the open batch are unaffected and still staged. |
| **Extraction OOMed on an already-stored image** | **Yes** — the derived PNG is in the blob container. | **Use `REQ-074` re-extraction** on that image. No re-attach needed. |

⚠ **The retry window is bounded by the 30-day purge (`NFR-019`).**
`REQ-074` re-extraction only works while the stored image still exists.
If an OOM is left unfixed for more than 30 days, the retained image is
gone and re-attaching from the phone becomes the only path. **Fix it in
the same session if you can.**

---

## 7. If up-sizing did not fix it

Do **not** keep climbing the SKU ladder blindly. In order:

1. **Read the surfaced error.** If it is still
   `IMAGE_TOO_LARGE_TO_DECODE` at 50 MP, the file is genuinely
   pathological — its dimensions are printed in the message. A >50 MP
   screenshot is not a normal capture.
2. **Check whether it is memory at all.** `IMAGE_DECODE_FAILED` (without
   `_OOM`) means a corrupt or truncated HEIC, which more memory will
   never fix. Re-export the image from the phone.
3. **Only then** consider 1.0 vCPU / 2.0 GiB (`--cpu 1.0 --memory 2.0Gi`,
   guard `100000000`) — roughly **+$8/month over the as-designed size**,
   ~$19–22 total. This is *not* a documented, owner-approved step; it is
   a further cost change that needs the owner's agreement.

---

## 8. Related

- **`artifacts/architecture.md`** — Revision 6 banner (A43), §Cost
  summary, §Where this breaks, §Observability (the alert that brings you
  here), `RSK-016`.
- **`artifacts/adr/ADR-0003-hosting-and-compute.md`** Revision 4 — why
  0.25/0.5 is the as-designed size and 1.0 GiB is the **known remedy**
  rather than a rejected alternative.
- **`artifacts/adr/ADR-0008-heic-transcode-on-ingest.md`** Revision 2 —
  the pre-decode guard, per-image failure isolation, and the surfaced
  error text that points here.
- **`RSK-029`** — every price on this page is unverified, ±30 %.
