// infra/main.bicep — composition root (TASK-006, Variant A / A40).
//
// Builds ONE deployment target (prod or staging), selected by the .bicepparam
// file, into a SINGLE shared resource group (ADR-0003 R2.4: "no second
// resource group... no separate Log Analytics workspace").
//
// Shared resources (Log Analytics, storage account, SQL logical server,
// Container Apps managed environment) are declared UNCONDITIONALLY and are
// identical in both deployments, so deploying either target is idempotent.
// Per-environment resources (the database, the container app, the blob RBAC
// grant) are conditional.
//
// There is NO Azure Container Registry and NO PostgreSQL anywhere.

targetScope = 'resourceGroup'

metadata description = 'nextup infrastructure composition root (Variant A).'

@description('Deployment environment: prod or staging.')
@allowed(['prod', 'staging'])
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

// ⚠ SQL is regionally separable ON PURPOSE — do NOT "simplify" this back to
// `location`. Azure SQL refuses new logical servers in whole regions for
// capacity reasons, per subscription and without notice: on 2026-08-18 this
// subscription could not create a server in eastus2, eastus or westus2
// (`ProvisioningDisabled` / `RegionDoesNotAllowProvisioning`), while centralus
// and westus3 accepted. Every other resource here deployed into eastus2
// perfectly happily, so pinning the whole stack to SQL's availability would
// relocate working infrastructure to work around one service.
//
// `az deployment group validate` does NOT catch this — validation does not
// consult regional capacity, so the template validates in a region that will
// then reject the write. See docs/runbooks/deployment-identity.md.
//
// Cross-region latency is acceptable here and is NOT a silent regression: this
// is a single-owner app whose requests are dominated by vision-model calls
// measured in seconds (NFR-002 budgets the interactive path accordingly).
@description('Azure region for the SQL logical server. Separate from `location` because Azure SQL restricts new-server provisioning per region and per subscription.')
param sqlLocation string = location

@description('Fully-qualified container image in ghcr.io.')
param containerImage string

// Passed straight through to aca.bicep, where the reasoning lives. Empty on a
// first deployment; otherwise the revision that must keep serving traffic
// until the new one has passed its smoke suite.
@description('Revision to pin 100% of traffic to during a deployment. Empty on first deploy.')
param holdRevisionName string = ''

// No ghcr credential parameters: the package is public and ACA pulls it
// anonymously (TASK-146 / R8, docs/ghcr-pat.md).

@description('SQL administrator login for the documented fallback auth path.')
param sqlAdminLogin string

@description('SQL administrator password. Supplied at deploy time.')
@secure()
param sqlAdminPassword string

@description('Entra ID object id of the SQL Entra administrator.')
param entraAdminObjectId string

@description('Entra ID UPN of the SQL Entra administrator.')
param entraAdminLogin string

@description('Application (client) id of the Entra app registration used by Easy Auth (TASK-027).')
param entraClientId string

// ⚠ DEFAULTS TO FALSE ON PURPOSE — this is a safety interlock, not a feature
// flag. `deploy.yml` runs on every push to `main`, so the moment ai.bicep was
// wired in here, any lane merge would have provisioned Azure OpenAI and Azure
// AI Vision with nobody approving it. The owner has HELD provisioning pending
// the TASK-168 bake-off, so the wiring ships switched off and a deployment is
// a no-op for these resources until someone sets this to true deliberately.
@description('Provision the Azure OpenAI and Azure AI Vision accounts. Off by default; see the TASK-010 hold.')
param deployAi bool = false

// Separate from `deployAi` because the two halves are blocked by DIFFERENT
// things. Azure OpenAI is only waiting on the owner's go-ahead, while Vision
// F0 is additionally blocked by a hard Azure constraint: one F0 account per
// subscription per kind, and this subscription already holds one in an
// unrelated resource group. This switch is what makes an AOAI-only deployment
// possible — which is what the TASK-168 bake-off actually needs, since it
// cannot report without live model calls.
@description('Provision the Azure AI Vision account. Requires deployAi.')
param deployVision bool = true

// ⚠ F0 is limited to ONE ComputerVision account per SUBSCRIPTION. Verified on
// 2026-08-18: this subscription already holds `vision-f4n7ptoeq44pk` (F0,
// eastus2, resource group rg-coffee-dev) belonging to an unrelated project, so
// an F0 deployment here will be rejected until that one is removed. Exposed as
// a parameter so the fallback to S1 — which is NOT free and departs from
// ADR-0001 Rev 2 — is a recorded decision in a .bicepparam, never a quiet edit.
@description('Azure AI Vision SKU. F0 is free but one-per-subscription.')
@allowed(['F0', 'S1'])
param visionSkuName string = 'F0'

// ⚠ THE OWNER RESOLVED THE F0 CONFLICT BY RE-USE, NOT BY CREATION (2026-08-19).
// `deployVision = false` + this endpoint points the app at the pre-existing
// `vision-f4n7ptoeq44pk`. Its role assignment is issued OUT-OF-BAND by the
// subscription owner, because the deploy principal is Owner on `nextup-rg`
// only and must not be given RBAC-write over another project's resource group.
// See `infra/ai.bicep` and `docs/runbooks/vision-account-reuse.md`.
@description('Endpoint of a pre-existing Vision account to re-use when deployVision is false.')
param existingVisionEndpoint string = ''

// TASK-168, `specs/ai.md` §9.7. A second deployment on the SAME account, so
// the two bake-off arms differ only in deployment name. Does NOT change the
// primary reader — only §9.7's pre-committed rule plus an ADR-0001 revision
// can do that.
@description('Deploy the gpt-5.4-mini bake-off challenger alongside the primary reader.')
param deployBakeOffModel bool = false

@description('Client secret of the Easy Auth app registration. Supplied at deploy time.')
@secure()
param entraClientSecret string

// ── Application configuration (A48) ────────────────────────────────────────
// See the block in aca.bicep for why the TMDB key is REQUIRED (Container Apps
// rejects an empty secret, so it has no absent state) and why DATABASE_URL is
// deliberately not here at all (its shape is TASK-141's open decision, and the
// same rejection means the slot cannot be added empty and filled later).
//
// The storage pair is not a parameter because it is not a choice: it is taken
// from the storage module's own outputs below.

@description('TMDB v3 API key — NOT the v4 read access token. Held as a Container Apps secret.')
@secure()
param tmdbApiKey string

@description('Comma-separated Entra subject ids for the NFR-017 allow-list. May be empty; the allow-list fails closed.')
param allowedSubjects string = ''

// Deterministic, globally-unique names derived from the resource group id, so
// main.bicep can declare `existing` child resources for RBAC scoping without
// depending on a module output.
var suffix = uniqueString(resourceGroup().id)
var storageAccountName = 'stnextup${suffix}'
var sqlServerName = 'sql-nextup-${suffix}'
var managedEnvironmentName = 'cae-nextup'
var logAnalyticsName = 'log-nextup'
var containerAppName = 'ca-nextup-${environmentName}'
var blobContainerName = environmentName == 'prod' ? 'screenshots' : 'screenshots-staging'
var openAiAccountName = 'oai-nextup-${suffix}'
var visionAccountName = 'vis-nextup-${suffix}'

// Storage Blob Data Contributor. The app reads and writes screenshots; it must
// not be able to manage the account itself.
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

// Cognitive Services OpenAI User — inference only. Deliberately NOT
// "...OpenAI Contributor", which can create and delete model deployments.
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

// Cognitive Services User — the inference role for non-OpenAI accounts.
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

module storage 'storage.bicep' = {
  name: 'storage'
  params: {
    environmentName: environmentName
    location: location
    storageAccountName: storageAccountName
  }
}

module sqldb 'sqldb.bicep' = {
  name: 'sqldb'
  params: {
    environmentName: environmentName
    location: sqlLocation
    sqlServerName: sqlServerName
    sqlAdminLogin: sqlAdminLogin
    sqlAdminPassword: sqlAdminPassword
    entraAdminObjectId: entraAdminObjectId
    entraAdminLogin: entraAdminLogin
  }
}

module ai 'ai.bicep' = if (deployAi) {
  name: 'ai'
  params: {
    location: location
    openAiAccountName: openAiAccountName
    visionAccountName: visionAccountName
    visionSkuName: visionSkuName
    deployVision: deployVision
    existingVisionEndpoint: existingVisionEndpoint
    deployBakeOffModel: deployBakeOffModel
  }
}

// Empty when the accounts are not provisioned. The app then fails its own
// documented configuration check ("NEXTUP_AOAI_ENDPOINT is not set") at
// extraction time rather than at boot, which is the behaviour the extractor
// tests already assert — a half-configured app that looks healthy and then
// silently mis-extracts would be far worse.
//
// ⚠ `vision` is NOT gated on `deployVision`. It was, and that was wrong the
// moment re-use became an option: with `deployVision = false` and a re-used
// account the endpoint is real, and gating on the create-flag would have
// blanked it — silently disabling the OCR cross-check while the account sat
// there working. The module already returns '' when there is nothing to point
// at, so the gate belonged there, not here.
var aiEndpoints = {
  openAi: deployAi ? ai!.outputs.openAiEndpoint : ''
  deployment: deployAi ? ai!.outputs.openAiDeploymentName : ''
  vision: deployAi ? ai!.outputs.visionEndpoint : ''
}

module aca 'aca.bicep' = {
  name: 'aca'
  params: {
    environmentName: environmentName
    location: location
    managedEnvironmentName: managedEnvironmentName
    containerAppName: containerAppName
    logAnalyticsCustomerId: logAnalytics.properties.customerId
    logAnalyticsSharedKey: logAnalytics.listKeys().primarySharedKey
    containerImage: containerImage
    entraClientId: entraClientId
    entraClientSecret: entraClientSecret
    holdRevisionName: holdRevisionName
    openAiEndpoint: aiEndpoints.openAi
    openAiDeployment: aiEndpoints.deployment
    visionEndpoint: aiEndpoints.vision
    tmdbApiKey: tmdbApiKey
    allowedSubjects: allowedSubjects
    // From the storage module's own outputs, so the app can never be pointed
    // at a container that was not created here — and staging can never be
    // handed production's.
    storageBlobEndpoint: storage.outputs.blobEndpoint
    storageContainerName: storage.outputs.containerName
    // From the sqldb module's own outputs, for the same reason: the app can
    // never be pointed at a database that was not created here, and staging
    // can never be handed production's.
    sqlServerFqdn: sqldb.outputs.serverFqdn
    sqlDatabaseName: sqldb.outputs.databaseName
  }
}

// ---------------------------------------------------------------------------
// LEAST-PRIVILEGE BLOB RBAC.
//
// The grant is scoped to THIS environment's blob CONTAINER, not to the storage
// account. That is what makes "the staging identity has NO grant on the
// production blob container" true by construction rather than by convention:
// an account-scoped grant would silently give staging read/write access to
// every production screenshot.
// ---------------------------------------------------------------------------
module blobRbac 'rbac.bicep' = {
  name: 'blob-rbac-${environmentName}'
  params: {
    storageAccountName: storageAccountName
    blobContainerName: blobContainerName
    principalId: aca.outputs.principalId
    roleDefinitionId: storageBlobDataContributorRoleId
  }
  dependsOn: [storage]
}

// Issued AFTER the container app, because they need its managed identity. The
// accounts themselves are created BEFORE it, because it needs their endpoints.
//
// ⚠ The linter calls the `dependsOn` below unnecessary, and today it is right:
// ai -> aca (endpoint params) -> csrbac (principalId) already orders it. That
// chain is incidental, though. The day someone stops passing the endpoints
// through aca.bicep the grants would start racing account creation, and a
// role assignment against a not-yet-existent scope fails the deployment. The
// dependency is what we actually mean, so it stays stated.
#disable-next-line no-unnecessary-dependson
module openAiRbac 'csrbac.bicep' = if (deployAi) {
  name: 'aoai-rbac-${environmentName}'
  params: {
    accountName: openAiAccountName
    principalId: aca.outputs.principalId
    roleDefinitionId: openAiUserRoleId
  }
  dependsOn: [ai]
}

// ⚠ GATED ON `deployVision`, AND THAT IS CORRECT FOR THE RE-USE CASE TOO.
// When the app points at a pre-existing account (`existingVisionEndpoint`),
// there is NO grant here on purpose — `csrbac.bicep` resolves `accountName`
// in THIS resource group, so it would either fail or, worse, bind to the wrong
// account. Widening this condition to "grant whenever there is an endpoint"
// does not work and must not be attempted; the re-use grant is issued
// out-of-band by the subscription owner (`docs/runbooks/vision-account-reuse.md`).
#disable-next-line no-unnecessary-dependson
module visionRbac 'csrbac.bicep' = if (deployAi && deployVision) {
  name: 'vision-rbac-${environmentName}'
  params: {
    accountName: visionAccountName
    principalId: aca.outputs.principalId
    roleDefinitionId: cognitiveServicesUserRoleId
  }
  dependsOn: [ai]
}

// ---------------------------------------------------------------------------
// NOT COMPOSED HERE, deliberately:
//   - Managed-identity DB user + smoke migration -> TASK-141
//   - Budget alerts (1.0x informational + 1.5x, NO auto-remediation)
//                                      -> TASK-142
//   - ghcr.io package visibility (public, no credential) -> TASK-146
//
// And permanently absent (REQ-028, T-INV-013): any TTL, Azure SQL Agent job,
// Elastic Job agent or scheduled deletion. Their ABSENCE is the requirement.
// ---------------------------------------------------------------------------

@description('The public FQDN of the deployed app.')
output appFqdn string = aca.outputs.appFqdn

@description('The Container App name.')
output containerAppName string = aca.outputs.appName

@description('The SQL server FQDN.')
output sqlServerFqdn string = sqldb.outputs.serverFqdn

@description('The database this environment uses.')
output databaseName string = sqldb.outputs.databaseName

@description('The storage account name.')
output storageAccountName string = storage.outputs.accountName

@description('The blob container this environment writes to.')
output blobContainerName string = storage.outputs.containerName
