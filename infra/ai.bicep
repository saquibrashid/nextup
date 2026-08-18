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

resource vision 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
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

@description('NEXTUP_VISION_ENDPOINT.')
output visionEndpoint string = vision.properties.endpoint

@description('Account name, for the role assignment module.')
output openAiAccountName string = openAi.name

@description('Account name, for the role assignment module.')
output visionAccountName string = vision.name
