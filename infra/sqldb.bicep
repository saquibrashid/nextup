// infra/sqldb.bicep — Azure SQL (TASK-006, Variant A / A40).
//
// The datastore is Azure SQL Database. This file REPLACES the superseded
// infra/postgres.bicep (review finding F-006), which must not exist.

metadata description = 'Azure SQL logical server with a Basic prod database and a serverless staging database.'

@description('Deployment environment: prod or staging.')
@allowed(['prod', 'staging'])
param environmentName string

@description('Azure region for all resources.')
param location string

@description('Globally-unique Azure SQL logical server name (computed by main.bicep).')
param sqlServerName string

@description('SQL administrator login for the documented fallback auth path (TASK-141).')
param sqlAdminLogin string

@description('SQL administrator password. Supplied at deploy time; never stored in the repo.')
@secure()
param sqlAdminPassword string

@description('Entra ID object id of the SQL Entra administrator.')
param entraAdminObjectId string

@description('Entra ID display name / UPN of the SQL Entra administrator.')
param entraAdminLogin string

@description('Entra tenant id.')
param tenantId string = subscription().tenantId

// ---------------------------------------------------------------------------
// LOGICAL SERVER.
//
// Azure SQL bills PER DATABASE — the logical server itself costs nothing, so
// prod and staging share one server while remaining separately-billed,
// separately-sized databases (ADR-0003 Rev 3).
//
// Auth: an Entra administrator is set so managed-identity (secretless) access
// is the preferred path. azureADOnlyAuthentication is deliberately NOT enabled
// because the SQL login is the DEFINED FALLBACK (TASK-006, TASK-141); turning
// Entra-only on would remove that fallback.
// ---------------------------------------------------------------------------
resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'User'
      login: entraAdminLogin
      sid: entraAdminObjectId
      tenantId: tenantId
      azureADOnlyAuthentication: false
    }
  }
}

// "Allow Azure services" only. No VNet, no private endpoint (ADR-0003 R2.5).
// The 0.0.0.0 start/end pair is the Azure-services rule, not "allow the world".
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ---------------------------------------------------------------------------
// DATABASE COLLATION — Latin1_General_100_BIN2, and it is REQUIRED.
//
// ⚠ Corrected 2026-08-12 by execution. See specs/data-model.md §16.2.1.
//
// This is not a preference; Prisma does not work without it. Prisma's create()
// emits `DECLARE @generated_keys table([id] NVARCHAR(200))` and then joins that
// table variable back to the inserted row on [t].[id] = [g].[id]. A table
// variable takes the DATABASE DEFAULT collation, so on a CI_AS database that
// join compares CI_AS against the BIN2 [id] column and fails with Msg 468,
// "Cannot resolve the collation conflict ... in the equal to operation".
// Every single row insert fails. Measured: 24 of 25 integration tests failed
// on the default collation and all passed on BIN2.
//
// The forgiving removed-view search is NOT lost. specs/data-model.md §16.2.1
// already specifies that search columns are searched with an explicit
// per-query COLLATE Latin1_General_100_CI_AI — that per-query collation is now
// load-bearing rather than cosmetic, and it is what keeps search case- and
// accent-insensitive on a binary-collated database.
//
// ~~Superseded: "The database keeps the default case-INSENSITIVE collation on
// purpose ... Making the DATABASE binary-collated would break the forgiving
// removed-view search." That was written from the spec before the spec had
// been executed. It is wrong: with a CI database, nothing writes at all.~~
// ---------------------------------------------------------------------------
var databaseCollation = 'Latin1_General_100_BIN2'

// prod: Basic — 5 DTU, 2 GB, 7-day PITR. NOT Standard/GeneralPurpose, not
// zone-redundant, no failover group (T-INFRA-005 pins this).
resource prodDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = if (environmentName == 'prod') {
  parent: sqlServer
  name: 'nextup'
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    collation: databaseCollation
    maxSizeBytes: 2147483648
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
  }
}

// Basic tier's short-term retention is 7 days; declared explicitly so a change
// is a visible Bicep diff rather than a silent portal edit.
resource prodBackupRetention 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01-preview' = if (environmentName == 'prod') {
  parent: prodDb
  name: 'default'
  properties: {
    retentionDays: 7
  }
}

// staging: serverless General Purpose, auto-paused. Billed per-database at
// roughly $0.50/month because it is paused almost all the time. Nobody judges
// staging's cold start (ADR-0003 R2.4).
resource stagingDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = if (environmentName == 'staging') {
  parent: sqlServer
  name: 'nextup_staging'
  location: location
  sku: {
    name: 'GP_S_Gen5_1'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    collation: databaseCollation
    autoPauseDelay: 60
    minCapacity: json('0.5')
    maxSizeBytes: 2147483648
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
  }
}

// ---------------------------------------------------------------------------
// HARD RULES (REQ-028, T-INV-013, T-MIG-001).
//
// Soft delete is FOREVER. There is NO TTL, NO scheduled deletion and NO
// retention job anywhere in this file, and the ABSENCE of such a mechanism IS
// the requirement. Specifically prohibited, and asserted absent by T-INV-013:
//   - Azure SQL Agent jobs
//   - Elastic Job agents (Microsoft.Sql/jobAgents)
//   - delete triggers, scheduled jobs, any TTL property
// Destructive migrations are separately blocked by T-MIG-001.
// ---------------------------------------------------------------------------

@description('The Azure SQL logical server name.')
output serverName string = sqlServer.name

@description('The fully-qualified SQL server hostname.')
output serverFqdn string = sqlServer.properties.fullyQualifiedDomainName

@description('The database this environment uses.')
output databaseName string = environmentName == 'prod' ? 'nextup' : 'nextup_staging'
