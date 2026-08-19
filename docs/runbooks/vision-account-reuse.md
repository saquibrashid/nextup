# Runbook — the re-used Azure AI Vision account

**Status:** in force. Applied to **staging** on 2026-08-19. Production has not
been provisioned and does **not** yet hold this grant.

**Why this file exists:** there is one piece of nextup's live configuration
that is deliberately **not** in a Bicep template. Without this page it looks
like a missing role assignment, and the obvious "fix" — widening the pipeline's
permissions or the `visionRbac` condition in `infra/main.bicep` — is wrong in
both cases. Read §3 before changing either.

---

## 1. What was decided, and what it replaced

ADR-0001 Rev 2 requires **two independent readers**: Azure OpenAI `gpt-4.1`
vision as the primary, and Azure AI Vision **Read** as a deterministic OCR
cross-check. The OCR leg is not a nicety — it is what makes LLM fabrication
visible and silent omission structurally impossible, and dropping it ships
Revision 1 quality while claiming Revision 2 (`NFR-012a`).

Azure allows **one free F0 `ComputerVision` account per subscription**, and
this subscription's slot was already taken:

| | |
|---|---|
| Account | `vision-f4n7ptoeq44pk` |
| Resource group | `rg-coffee-dev` — **a different project of the owner's** |
| Kind / SKU / region | `ComputerVision` / `F0` / `eastus2` |

Three options were put to the owner: delete the other project's account, pay
for `S1` (~$0.05–0.23/month), or ship without the OCR leg. The owner chose a
fourth — **re-use the existing account** — which costs nothing, deletes
nothing, and keeps the cross-check.

## 2. What was verified before adopting it

Re-use is only safe because of one property that is easy to miss:

> **The account has a custom subdomain** (`vision-f4n7ptoeq44pk`).

A Cognitive Services account without one is reachable only at the shared
regional endpoint, which accepts **account keys only**. Entra token auth would
have been impossible, and the entire secretless design (`specs/security.md` §6,
`T-INFRA-001`) would have quietly required a key in a secret store. **If you
ever repoint `existingVisionEndpoint` at a different account, check this
first:**

```powershell
az cognitiveservices account show -n <account> -g <rg> `
  --query "{kind:kind,sku:sku.name,loc:location,subdomain:properties.customSubDomainName}" -o json
```

Kind must be `ComputerVision`, and `subdomain` must not be null.

## 3. ⚠ Why the role assignment is not in a template

The deploy service principal is **Owner on `nextup-rg` only** — verified
2026-08-19, it holds no subscription-level or `rg-coffee-dev` assignment.
Putting this grant in `infra/main.bicep` therefore does not merely fail; fixing
that failure means **granting the CI principal RBAC-write over another
project's resource group, permanently, to re-assert a one-time fact.** That is
a far larger security change than the thing it buys.

So the grant is issued **out-of-band by the subscription owner**, once per
environment, and recorded here.

Two related traps, both guarded by comments in the templates:

- **Do not widen `visionRbac`'s condition** in `infra/main.bicep` to "grant
  whenever there is an endpoint". `csrbac.bicep` resolves `accountName` inside
  the *current* resource group, so it would fail — or, worse, silently bind to
  a same-named account in `nextup-rg`.
- **`aiEndpoints.vision` must not be gated on `deployVision`.** It was, until
  re-use existed. With `deployVision = false` and a real re-used endpoint, that
  gate blanked the URL and silently disabled the cross-check while the account
  sat there working.

## 4. The command (per environment)

```powershell
$principal = az containerapp show -n ca-nextup-staging -g nextup-rg `
  --query "identity.principalId" -o tsv

az role assignment create `
  --assignee-object-id $principal `
  --assignee-principal-type ServicePrincipal `
  --role "Cognitive Services User" `
  --scope "/subscriptions/d2030464-c98d-4d14-acf2-378afb0bd760/resourceGroups/rg-coffee-dev/providers/Microsoft.CognitiveServices/accounts/vision-f4n7ptoeq44pk"
```

`Cognitive Services User` is the **inference-only** role — it cannot create,
modify or delete anything on the account. `--assignee-object-id` with an
explicit `--assignee-principal-type` avoids the Graph lookup that intermittently
fails for a freshly-created managed identity.

**Verify:**

```powershell
az role assignment list --scope "<the same scope>" `
  --query "[].{role:roleDefinitionName,principal:principalId}" -o table
```

Applied and verified for staging (`926bd9c1-847a-4b68-b930-28cc71299e77`) on
2026-08-19.

## 5. ⚠ Standing consequences

**The F0 quota is now shared with another project.** 5,000 transactions/month
and **20 per minute**, across both. `specs/ai.md` §2.2 already treats OCR as a
leg that may be unavailable — a throttled call yields `crossCheck:
'ocr-unavailable'`, the batch still completes, and removals are still permitted
because the primary reader worked. So throttling costs the cross-check *for
that batch*, not the batch. It is still a real coupling to a system nextup does
not control, and it is why the endpoint is a parameter rather than a constant.

**Key auth is enabled on that account** (`disableLocalAuth` is null), unlike
nextup's own accounts, which set it to `true`. We cannot change that without
altering another project's security posture. It is not a nextup exposure —
nextup holds no key for it and authenticates with its managed identity — but
`T-INFRA-001`'s "no keys" property is enforced over *our* templates and code,
and this account is outside that boundary.

**This grant is invisible to `az deployment group what-if`.** A what-if of
`main.bicep` will never show it, never propose it, and never notice it is
missing. If OCR starts failing with 401/403 after an environment is rebuilt,
this page is the first thing to check.

## 6. When production is provisioned

`infra/main.prod.bicepparam` deliberately does **not** set `deployAi`. When it
does:

1. Set `deployAi = true`, `deployVision = false`, and the same
   `existingVisionEndpoint`.
2. Re-run §4 with `-n ca-nextup-prod` — **production has its own managed
   identity and inherits nothing from staging.**
3. Note that this makes three consumers of one F0 quota.

## 7. Undoing it

If the other project's account is ever deleted, or the coupling becomes
unacceptable, revert to provisioning our own: set `deployVision = true`, clear
`existingVisionEndpoint`, and choose `visionSkuName`. `F0` only works if the
subscription's single free slot is genuinely free by then; otherwise `S1`, which
is a departure from ADR-0001 Rev 2's cost basis and should be recorded as one.
Remove the role assignment above with `az role assignment delete` using the same
scope, so another project's resource group is not left carrying a grant to an
identity that no longer needs it.
