// infra/ai.bicep — the extraction services (TASK-010, ADR-0001 Rev 2).
//
// Two accounts, because the pipeline is deliberately TWO independent readers
// that cross-check each other (specs/ai.md §2.2):
//   - Azure OpenAI `gpt-4.1` vision   -> the primary reader
//   - Azure AI Vision Read           -> the deterministic OCR cross-check
//
// Both are SHARED between prod and staging, exactly like the storage account
// and the SQL logical server: one account, one deployment, per-environment
// role assignments. Splitting them per environment would double a per-account
// quota for no isolation benefit — the isolation that matters here is the blob
// container, which IS split (main.bicep).
//
// ⚠ THE ROLE ASSIGNMENTS ARE NOT HERE, they are in csrbac.bicep. This module
// must deploy BEFORE the container app, because the app needs these endpoints
// as environment variables; the grants must deploy AFTER it, because they need
// its managed identity. Putting both in one module makes that a cycle. This is
// the same three-step shape as storage -> aca -> blobRbac.
//
// KEY-BASED AUTH IS DISABLED ON BOTH (`disableLocalAuth: true`). This is not
// belt-and-braces: specs/security.md §6 and `T-INFRA-001` prohibit account
// keys, and a custom subdomain plus Entra token auth is the only supported way
// to reach these endpoints with a managed identity. There is therefore no key
// to leak, rotate, or accidentally commit.

metadata description = 'Azure OpenAI + Azure AI Vision accounts and the gpt-4.1 vision deployment.'

@description('Azure region for both accounts.')
param location string

@description('Azure OpenAI account name. Globally unique.')
param openAiAccountName string

@description('Azure AI Vision account name. Globally unique.')
param visionAccountName string

// ⚠ PIN THE MODEL VERSION. `versionUpgradeOption: OnceNewDefaultVersionAvailable`
// is the Azure DEFAULT, and it silently swaps the model underneath a running
// deployment. For nextup that is not a convenience, it is an unreviewed change
// to the component every extraction result depends on: the golden corpus
// (specs/ai.md §9) would drift with no commit, no PR and no test run to point
// at. NoAutoUpgrade makes a model change a deliberate edit to this file.
@description('Azure OpenAI model name for the primary vision reader.')
param openAiModelName string = 'gpt-4.1'

@description('Pinned model version. Never "latest", never auto-upgraded.')
param openAiModelVersion string = '2025-04-14'

@description('Deployment (deployment name) the app addresses via NEXTUP_AOAI_DEPLOYMENT.')
param openAiDeploymentName string = 'gpt-4.1'

// ⚠ GlobalStandard, NOT Standard. Verified against this subscription on
// 2026-08-18: `az cognitiveservices usage list -l eastus2` offers
// `OpenAI.GlobalStandard.gpt4.1` (limit 1000, used 0) and there is NO
// `OpenAI.Standard.gpt4.1` entry at all — the regional Standard SKU has no
// quota here, so a Standard deployment would fail at write time. Note the
// quota key spells the model `gpt4.1` with no hyphen while the model itself is
// `gpt-4.1`; grepping the quota list for `gpt-4.1` finds nothing and looks
// exactly like "the model is unavailable".
@description('Deployment SKU. GlobalStandard is the only Standard-family SKU with quota for gpt-4.1 in eastus2.')
param openAiSkuName string = 'GlobalStandard'

@description('Rate limit in thousands of tokens per minute. Pay-per-token: capacity costs nothing, it only caps the rate.')
param openAiCapacity int = 50

// ⚠ F0 IS ONE-PER-SUBSCRIPTION-PER-KIND. If another ComputerVision F0 already
// exists anywhere in the subscription this deployment fails. Left as a
// parameter so the fallback (S1, which is NOT free) is a deliberate, visible
// choice recorded in a .bicepparam rather than an edit to this file under
// deployment pressure. ADR-0001 Rev 2 pins F0 for cost.
@description('Azure AI Vision SKU. F0 is free and limited to one account per subscription.')
@allowed(['F0', 'S1'])
param visionSkuName string = 'F0'

@description('Provision the Vision account. Off allows an AOAI-only deployment while the F0 conflict is unresolved.')
param deployVision bool = true

// ⚠ RE-USING AN EXISTING VISION ACCOUNT (owner decision, 2026-08-19).
//
// F0 is one-per-subscription-per-kind and this subscription's slot is already
// held by `vision-f4n7ptoeq44pk` in `rg-coffee-dev` — a DIFFERENT project's
// resource group. Rather than delete another project's resource or pay for S1,
// the owner chose to re-use it: `deployVision = false` plus this endpoint.
//
// Verified before adopting it (2026-08-19): kind `ComputerVision`, sku `F0`,
// location `eastus2` (same as ours), and — decisively — it HAS a custom
// subdomain (`vision-f4n7ptoeq44pk`). Without one, an account is reachable
// only at the shared regional endpoint, which accepts KEYS ONLY; Entra token
// auth would have been impossible and the whole secretless design (§6,
// `T-INFRA-001`) would have quietly needed a key. Do not point this at an
// account without checking that first.
//
// ⚠ THE ROLE ASSIGNMENT FOR THIS ACCOUNT IS NOT IN ANY TEMPLATE, DELIBERATELY.
// The deploy service principal is Owner on `nextup-rg` ONLY. Granting the app
// a role on a resource in `rg-coffee-dev` from this pipeline would require
// giving that principal RBAC-write over another project's resource group —
// permanently, to re-assert a one-time fact. It is done out-of-band by the
// subscription owner instead; see `docs/runbooks/vision-account-reuse.md`.
//
// ⚠ SHARED F0 QUOTA. 5,000 transactions/month and 20/minute are now shared
// with whatever else uses that account. `specs/ai.md` §2.2 already treats OCR
// as a leg that may be unavailable (`crossCheck: 'ocr-unavailable'`), so
// throttling degrades rather than breaks — but it is a real coupling to
// another project, and it is why this is a parameter and not a hard-coded URL.
@description('Endpoint of a pre-existing Vision account to re-use. Used only when deployVision is false.')
param existingVisionEndpoint string = ''

// ── The bake-off challenger (TASK-168, `specs/ai.md` §9.7) ──────────────────
//
// §9.7 requires both arms to differ in ONE respect only: the deployment name.
// Same prompt, same schema, same `detail`, same `max_tokens`, same seed. That
// is only achievable if both models are deployments on the SAME account, which
// is what this second resource provides.
//
// ⚠ THIS DOES NOT CHANGE THE PRIMARY READER. `openAiDeploymentName` above is
// still what the app addresses. Deploying a challenger makes it *measurable*;
// §9.7's pre-committed decision rule is the only thing that may promote it,
// and promotion additionally requires an ADR-0001 revision. Pointing
// NEXTUP_AOAI_DEPLOYMENT at the challenger because it is cheaper is precisely
// the cost-motivated downgrade NFR-012a calls non-compliance.
//
// ⚠ STAGE 0 IS NOT YET DISCHARGED. §9.7 disqualifies a candidate outright if it
// lacks vision, strict Structured Outputs, `temperature: 0` or `seed`. Several
// GPT-5-family reasoning models reject `temperature` and `seed` entirely. If
// gpt-5.4-mini does, it fails Stage 0 and no images are spent on it — that is
// a valid, cheap outcome, not a bug in this deployment.
@description('Deploy a second model as the bake-off challenger. Does NOT change the primary reader.')
param deployBakeOffModel bool = false

@description('Challenger model for the §9.7 bake-off.')
param bakeOffModelName string = 'gpt-5.4-mini'

@description('Pinned challenger version. Verified available in eastus2 on 2026-08-19.')
param bakeOffModelVersion string = '2026-03-17'

@description('Challenger deployment name — the ONLY permitted difference between bake-off arms.')
param bakeOffDeploymentName string = 'gpt-5-4-mini'

// Verified 2026-08-19: `OpenAI.GlobalStandard.gpt-5.4-mini` = 10 used / 1000
// limit in eastus2, and `OpenAI.DataZoneStandard.gpt-5.4-mini` has a limit of
// ZERO. GlobalStandard is the only usable family here, as with gpt-4.1. Note
// this quota key DOES hyphenate the version (`gpt-5.4-mini`) where gpt-4.1's
// does not (`gpt4.1`) — the two families spell their keys differently.
@description('Challenger SKU. GlobalStandard is the only family with non-zero quota for gpt-5.4-mini in eastus2.')
param bakeOffSkuName string = 'GlobalStandard'

@description('Challenger rate limit, thousands of tokens/minute. Pay-per-token: capacity caps rate, not cost.')
param bakeOffCapacity int = 50

// Cognitive Services OpenAI User — inference only. Deliberately NOT
// "Cognitive Services OpenAI Contributor", which can create and delete model
// deployments; the app never needs to. Consumed by csrbac.bicep.

resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAiAccountName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // Required for Entra token auth. Without it the account is only reachable
    // at the shared regional endpoint, which accepts keys only.
    customSubDomainName: openAiAccountName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource openAiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAi
  name: openAiDeploymentName
  sku: {
    name: openAiSkuName
    capacity: openAiCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiModelName
      version: openAiModelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

// ⚠ `dependsOn` IS LOad-BEARING, not tidiness. Azure serialises deployment
// writes on a Cognitive Services account; two model deployments created in
// parallel routinely fail with a conflict on the parent account. Bicep infers
// no dependency here because neither resource references the other, so it
// would otherwise issue both at once.
resource bakeOffDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (deployBakeOffModel) {
  parent: openAi
  name: bakeOffDeploymentName
  dependsOn: [openAiDeployment]
  sku: {
    name: bakeOffSkuName
    capacity: bakeOffCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: bakeOffModelName
      version: bakeOffModelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

resource vision 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (deployVision) {
  name: visionAccountName
  location: location
  kind: 'ComputerVision'
  sku: {
    name: visionSkuName
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: visionAccountName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

// Scoped to the ACCOUNT rather than the deployment: unlike the blob container,
// there is nothing per-environment inside these accounts to scope to. Both
// environments legitimately call the same model. See csrbac.bicep.

@description('NEXTUP_AOAI_ENDPOINT.')
output openAiEndpoint string = openAi.properties.endpoint

@description('NEXTUP_AOAI_DEPLOYMENT.')
output openAiDeploymentName string = openAiDeployment.name

@description('NEXTUP_VISION_ENDPOINT. Falls back to a re-used pre-existing account when we do not provision one.')
output visionEndpoint string = deployVision ? vision!.properties.endpoint : existingVisionEndpoint

@description('The bake-off challenger deployment name, or empty. Consumed by the §9.7 harness, never by the app.')
output bakeOffDeploymentName string = deployBakeOffModel ? bakeOffDeployment!.name : ''

@description('Account name, for the role assignment module.')
output openAiAccountName string = openAi.name

@description('Account name, for the role assignment module.')
output visionAccountName string = deployVision ? vision!.name : ''

