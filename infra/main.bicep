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

@description('Client secret of the Easy Auth app registration. Supplied at deploy time.')
@secure()
param entraClientSecret string

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

// Storage Blob Data Contributor. The app reads and writes screenshots; it must
// not be able to manage the account itself.
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

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
