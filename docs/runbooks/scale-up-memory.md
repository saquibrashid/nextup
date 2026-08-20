---
createdAt: 2026-08-11T10:50:30-04:00
createdBy: solution-architect
phase: 8
revision: 2
status: active
verifiedAgainstDeployment: 2026-08-18
appliesTo: nextup production Container App
forcedBy: A43 / OQ-028 (owner accepted the reactive up-size strategy), RSK-016
---

# RUNBOOK — Up-size nextup compute: 0.25 vCPU / 0.5 GiB → 0.5 vCPU / 1.0 GiB

> **Read this if:** an import just died, or an image was refused with
> `IMAGE_TOO_LARGE_TO_DECODE` or `IMAGE_DECODE_OOM`, or the
> **`nextup-prod-replica-restart`** alert fired.
>
> ⚠ **As of 2026-08-18 that alert does not exist yet.** `TASK-157` builds the
> decode sentinel and the three alert rules (`infra/alerts.bicep`), and it is
> not done: there are **no alert rules of any kind** deployed in `nextup-rg`,
> verified with `az monitor metrics alert list`. Until it lands, the trigger
> for this runbook is the **user-visible failure** — a refused image or a dead
> import — not a notification. Nothing will page you.
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

Run **four commands**, in this order, then **commit one Bicep change** so the
next deploy does not undo it. It is four and not one because production runs
in **`Multiple` revision mode with traffic pinned to a named revision** — an
`update` alone builds a new revision that serves **nobody**. See §2.

```bash
APP=ca-nextup-prod
RG=nextup-rg

# 1. APPLY (up-sizes compute AND raises the decode guard together)
az containerapp update \
  --name "$APP" \
  --resource-group "$RG" \
  --cpu 0.5 \
  --memory 1.0Gi \
  --set-env-vars NEXTUP_MAX_DECODE_PIXELS=50000000

# 2. SHIFT TRAFFIC to the revision you just created — without this,
#    production is still served by the old 0.5 GiB revision.
NEW=$(az containerapp revision list -n "$APP" -g "$RG" \
        --query "sort_by([].{n:name,t:properties.createdTime},&t)[-1].n" -o tsv)
az containerapp ingress traffic set -n "$APP" -g "$RG" --revision-weight "$NEW=100"

# 3. CONFIRM against the SERVING revision (not the app template — see §3a)
az containerapp revision show -n "$APP" -g "$RG" --revision "$NEW" \
  --query "properties.template.containers[0].resources" -o json

# 4. DEACTIVATE the superseded revision — prod is minReplicas = 1, so every
#    revision left Active bills a replica for ever.
az containerapp revision deactivate -n "$APP" -g "$RG" --revision "<old-revision>"
```

```
# 5. THEN commit the Bicep change in §4. If you skip step 5 the next
#    CI deploy silently reverts you to 0.5 GiB and the import dies again.
```

Then **re-attach the image that failed** (see §6 — what is and is not
recoverable).

> ~~*Superseded 2026-08-18 (TASK-156, verified against the live deployment):
> "Run **one command**, wait ~60 s, run **one check**, then **commit one Bicep
> change**", against app `nextup` in resource group `rg-nextup`, confirming
> with `az containerapp show --query properties.template...`. **Every part of
> that was wrong:** neither `nextup` nor `rg-nextup` exists (the real names are
> `ca-nextup-prod` and `nextup-rg`); one command does not reach production in
> `Multiple` revision mode; and the `show` check reads the app-level template,
> which reports success even when traffic never moved.*~~

---

## 1. Preconditions

| Check | Command / how |
|---|---|
| Azure CLI signed in, right subscription | `az account show -o table` — expect **`Visual Studio Enterprise with MSDN`**, subscription `d2030464-c98d-4d14-acf2-378afb0bd760` |
| `containerapp` extension present | `az extension add --name containerapp --upgrade` (no-op if current) |
| You know the real resource names | **Verified 2026-08-18:** app **`ca-nextup-prod`**, resource group **`nextup-rg`** (`eastus2`). Confirm with `az containerapp list -o table` |
| You are targeting **prod**, not staging | Staging is a *different* Container App — **`ca-nextup-staging`**, at `minReplicas = 0` (verified). Up-sizing staging fixes nothing. |

> ⚠ **The resource group is `nextup-rg`, not `rg-nextup`.** The two are easy to
> transpose and the wrong one fails with a not-found error rather than doing
> something harmful — but under pressure that reads like the app is gone.
>
> ⚠ **Azure SQL lives in `centralus`, everything else in `eastus2`.** This
> subscription refuses SQL provisioning in `eastus2` outright
> (`ProvisioningDisabled`). Nothing in this runbook touches SQL, but do not
> "correct" the region mismatch if you notice it — see `infra/main.bicep`.

**Production runs in `Multiple` revision mode.** `activeRevisionsMode:
'Multiple'` (`infra/aca.bicep`), and ingress traffic is pinned to a **named**
revision — today `ca-nextup-prod--0000004` at weight 100. **A new revision
therefore starts at 0 % traffic and serves nobody until you shift traffic to
it.** This is deliberate: it is what makes the deploy pipeline's blue/green
gate and revision-switch rollback possible.

**No downtime is required and none is expected.** The old revision keeps
serving until you shift traffic, and the app is always-warm (`minReplicas =
1`), so this change introduces no cold start.

> ~~*Superseded 2026-08-18 (TASK-156): "Defaults assumed here: app `nextup`,
> resource group `rg-nextup`" and "in single-revision mode the old replica is
> drained after the new one is ready". The names were placeholders that never
> matched the deployment, and the mode was changed to `Multiple` when TASK-007
> introduced the traffic hold.*~~

---

## 2. Apply the change (the exact commands)

**2a. Up-size compute and the guard together:**

```bash
APP=ca-nextup-prod
RG=nextup-rg

az containerapp update \
  --name "$APP" \
  --resource-group "$RG" \
  --cpu 0.5 \
  --memory 1.0Gi \
  --set-env-vars NEXTUP_MAX_DECODE_PIXELS=50000000
```

**2b. Shift traffic to the new revision — REQUIRED, and the step most likely
to be skipped:**

```bash
NEW=$(az containerapp revision list -n "$APP" -g "$RG" \
        --query "sort_by([].{n:name,t:properties.createdTime},&t)[-1].n" -o tsv)
echo "New revision: $NEW"
az containerapp ingress traffic set -n "$APP" -g "$RG" --revision-weight "$NEW=100"
```

⚠ **Why this is not optional.** The app is in `Multiple` revision mode with
traffic pinned to a **named** revision (§1). `az containerapp update` builds a
new revision and leaves the pin exactly where it was, so the up-sized
container exists, is healthy, is billed — and receives **no requests**. The
owner keeps hitting the old 0.5 GiB revision and the image keeps failing,
while every check you are likely to run says the up-size worked. If you take
one thing from this runbook, take this step.

**2c. Deactivate the superseded revision:**

```bash
az containerapp revision deactivate -n "$APP" -g "$RG" --revision "<old-revision>"
```

Prod runs `minReplicas = 1`, so a superseded revision left **Active** bills a
replica for ever — it would double the standing compute cost of the app.
Deactivating does **not** delete it: it stays listed and reactivatable, which
is what makes rollback (§5) a revision switch.

**2d. Raise the memory-pressure alert threshold from 400 MiB to 800 MiB.**

`nextup-prod-memory-pressure` alerts on `WorkingSetBytes` **Average > 400
MiB** over 5 minutes — a leading indicator sized for a 0.5 GiB container. At
1.0 GiB that threshold is ~39 % of memory and **will fire more or less
constantly**, which trains you to ignore the one alert that warns you before
an OOM.

```bash
az monitor metrics alert update -n nextup-prod-memory-pressure -g "$RG" \
  --condition "avg WorkingSetBytes > 838860800"
```

Then change the threshold in **`infra/alerts.bicep`** in the same commit as
§4, for the same reason §4 exists at all.

> ⚠ **As of 2026-08-18 this step cannot be performed: the alert does not
> exist.** `TASK-157` creates `infra/alerts.bicep` and the three rules;
> `az monitor metrics alert list -g nextup-rg` returns empty. When TASK-157
> lands, this step becomes live and needs no further edit. Do not delete it in
> the meantime — the step is missing from the alert design's own rollout, and
> a threshold left at 400 MiB after an up-size is exactly how a leading
> indicator becomes noise.

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

⚠ **Do not use `az containerapp show` for this.** The app-level
`properties.template` reflects the **newest** revision's spec regardless of
which revision is serving traffic — they are two distinct objects (the
app-level one even carries an extra `ephemeralStorage` field). In `Multiple`
revision mode it will happily print `cpu 0.5 / 1Gi` while 100 % of traffic is
still pinned to the old 0.5 GiB revision. **It is a false green on the exact
failure this runbook exists to fix.**

Check the **serving** revision instead:

```bash
APP=ca-nextup-prod
RG=nextup-rg

SERVING=$(az containerapp ingress traffic show -n "$APP" -g "$RG" \
            --query "[?weight>\`0\`].revisionName | [0]" -o tsv)
echo "Serving: $SERVING"
az containerapp revision show -n "$APP" -g "$RG" --revision "$SERVING" \
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
is the success case. If it still says `0.5Gi`, either the update did not land
or **traffic was never shifted (§2b)**; re-read §2b before re-running §2a.

> ~~*Superseded 2026-08-18 (TASK-156): `az containerapp show -n nextup -g
> rg-nextup --query "properties.template.containers[0].resources"`, described
> as "the authoritative check". Wrong resource names, and it reads the
> app-level template rather than the serving revision.*~~

**3b. The guard value actually reached the container:**

```bash
az containerapp revision show -n "$APP" -g "$RG" --revision "$SERVING" \
  --query "properties.template.containers[0].env[?name=='NEXTUP_MAX_DECODE_PIXELS']" -o json
```

Expected `"value": "50000000"`. (Verified 2026-08-18: it currently reads
`25000000`, the as-designed value.)

**3c. The new revision is running and healthy, and owns the traffic:**

```bash
az containerapp revision list -n "$APP" -g "$RG" \
  --query "[?properties.active].{revision:name,replicas:properties.replicas,state:properties.runningState,traffic:properties.trafficWeight,created:properties.createdTime}" \
  -o table
```

Expect the up-sized revision at `traffic: 100`, `replicas: 1`, running. In
`Multiple` mode you may legitimately see **more than one** active revision —
that is why §2c exists. What must be true is that the revision carrying 100 %
of the traffic is the new one. If it is not running after ~2 minutes, read
the system logs:

```bash
az containerapp logs show -n "$APP" -g "$RG" --type system --tail 50
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

⚠ **If you performed §2d, the alert threshold belongs in this same commit** —
`nextup-prod-memory-pressure` in `infra/alerts.bicep`, 400 MiB → 800 MiB
(`419430400` → `838860800` bytes). It drifts back exactly like the compute
size does.

⚠ **Redeploying re-pins traffic, it does not shift it.** `infra/aca.bicep`
holds traffic on the revision named in `holdRevisionName`, so a CI deploy
after this change still leaves the new revision at 0 % until the pipeline's
own smoke-and-shift step runs. Nothing you commit here removes the need for
§2b when you apply the change by hand.

---

## 5. Rollback

**Preferred: switch traffic back to the previous revision.** It is already
built, already known-good, and still present — §2c deactivated it rather than
deleting it. This is the same mechanism the deploy pipeline uses for rollback
(`.github/workflows/deploy.yml`, `infra/aca.bicep`).

```bash
APP=ca-nextup-prod
RG=nextup-rg

az containerapp revision activate -n "$APP" -g "$RG" --revision "<old-revision>"
az containerapp ingress traffic set -n "$APP" -g "$RG" --revision-weight "<old-revision>=100"
az containerapp revision deactivate -n "$APP" -g "$RG" --revision "<up-sized-revision>"
```

**Alternative: re-apply the original values** — both of them, together — which
builds a further new revision and needs the same traffic shift as §2b:

```bash
az containerapp update \
  --name "$APP" --resource-group "$RG" \
  --cpu 0.25 --memory 0.5Gi \
  --set-env-vars NEXTUP_MAX_DECODE_PIXELS=25000000
# ...then §2b's traffic shift, then §2c.
```

If you performed §2d, **put the memory-pressure threshold back to 400 MiB**:

```bash
az monitor metrics alert update -n nextup-prod-memory-pressure -g "$RG" \
  --condition "avg WorkingSetBytes > 419430400"
```

Then revert the `infra/aca.bicep`, `infra/alerts.bicep` and `T-INFRA-005`
changes from §4 (`git revert` the single commit) so source and reality agree
again. Confirm with §3a — expect `"cpu": 0.25, "memory": "0.5Gi"`.

**Why you might roll back:** the up-size did not fix the failure, so the
$5.92/month is buying nothing and the real cause is elsewhere (see §7).
**Why you probably should not:** if a real OOM happened once at 0.5 GiB,
the image class that caused it still exists in the owner's camera roll.

> ~~*Superseded 2026-08-18 (TASK-156): the original §5 gave the `az
> containerapp update` form as primary and dismissed the revision switch as an
> "Alternative … revision juggling is more error-prone". In `Multiple`
> revision mode that is backwards — the revision switch is this project's
> sanctioned rollback path, named as such in `deploy.yml` and `aca.bicep`. It
> also omitted the alert-threshold revert and used the wrong resource
> names.*~~

---

## 6. What is recoverable, and what you must re-attach

This determines whether you can use `REQ-074` re-extraction or must
re-pick the file. **Nothing is ever partially committed** — a batch
becomes visible only in a single transaction at review-close
(`docs/diagrams/sequence-full-update-batch.md`), so a death during ingest or
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
   ~$19–22 total.

   🛑 **This step is NOT owner-approved and you must not take it on your own
   authority.** `A43` pre-authorises exactly one up-size — 0.5 vCPU / 1.0 GiB
   with the guard at 50 MP — and nothing beyond it. A further size is an
   unapproved recurring cost change and **requires the owner's explicit
   agreement before it is applied**. It is also blocked mechanically:
   `ALLOWED_COMPUTE_PAIRS` in `tools/check-infra.mjs` is a closed set of
   exactly two pairs, `T-INFRA-005i` asserts that it stays exactly two, and
   `T-INFRA-005h` rejects any other combination. **If you find yourself
   widening that set, stop and ask the owner** — the gate is doing its job,
   not obstructing you.

---

## 8. Related

- **`docs/architecture.md`** — Revision 6 banner (A43), §Cost summary,
  §Where this breaks, §Observability (the alert that brings you here),
  `RSK-016`.
- **`docs/adr/ADR-0003-hosting-and-compute.md`** Revision 4 — why
  0.25/0.5 is the as-designed size and 1.0 GiB is the **known remedy**
  rather than a rejected alternative.
- **`docs/adr/ADR-0008-heic-transcode-on-ingest.md`** Revision 2 —
  the pre-decode guard, per-image failure isolation, and the surfaced
  error text that points here.
- **`docs/runbooks/rollback.md`** — the general deploy rollback, delivered by
  `TASK-133`. Read it before §5 if you are rolling back for any reason other
  than memory: it documents that the rollback target is **always a deactivated
  revision** (the deploy workflow deactivates the superseded one every time,
  because `minReplicas = 1` bills every active revision for ever), and that
  shifting traffic to a deactivated revision **exits 0, prints the new weight
  table, and then serves 404**. §5 below is self-contained and already orders
  `revision activate` before the traffic shift for that reason.

> ~~*Superseded 2026-08-18 (TASK-156), corrected 2026-08-19: this entry said
> `docs/runbooks/rollback.md` "does not exist as of 2026-08-18 … `TASK-133`
> owns it". `TASK-133` has since delivered it, and it carries a silent-failure
> trap this runbook's §5 depends on, so the cross-reference is now load-bearing
> rather than a dangling link.*~~
- **`docs/runbooks/config-checklist.md`** — every production setting and
  what breaks if it is wrong. It carries the `NEXTUP_MAX_DECODE_PIXELS` /
  memory pairing rule (§2) that this runbook implements, so a reader who
  arrives there first is sent here rather than improvising an up-size.
- **`docs/runbooks/incident-playbook.md`** — symptom routing. It states
  explicitly that an OOM is **not** an incident to be debugged but a
  decided, pre-authorised remedy (`A43`), and points at this runbook.
- **`tools/check-infra.mjs`** / **`tests/infra/sku.spec.ts`** — the closed set
  of permitted compute pairs and the `T-INFRA-005` assertions you must update
  in §4.

> ~~*Superseded 2026-08-18 (TASK-156): this section linked
> `artifacts/architecture.md`, `artifacts/adr/ADR-0003-hosting-and-compute.md`
> and `artifacts/adr/ADR-0008-heic-transcode-on-ingest.md`. `artifacts/` is
> the authoring tree and does not exist in the delivered repo; all three live
> under `docs/`. It also closed with "`RSK-029` — every price on this page is
> unverified, ±30 %", which `TASK-010` superseded on 2026-08-17: the +$5.92
> figure in the header **is** verified against live Azure retail prices, and
> leaving the blanket disclaimer in place invited the reader to discount the
> one number that had been checked.*~~
