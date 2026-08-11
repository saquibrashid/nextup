// infra/sqldb.bicep — Azure SQL (SKELETON, TASK-006, Variant A / A40).
//
// Skeleton only. Datastore is Azure SQL Database — this file REPLACES the
// superseded infra/postgres.bicep (which must not exist, review finding F-006).

@allowed(['prod', 'staging'])
param environmentName string
param location string = resourceGroup().location

// --- Intent ------------------------------------------------------------------
//
// resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
//   // Azure SQL LOGICAL server. Public endpoint, TLS required,
//   // "Allow Azure services" only. No VNet, no private endpoint (ADR-0003 R2.5).
//   // Entra admin set for managed-identity auth; SQL-auth login is the fallback.
// }
//
// resource prodDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = if (environmentName == 'prod') {
//   // sku: { name: 'Basic', tier: 'Basic' }  // 5 DTU, 2 GB, 7-day PITR.
//   // NOT Standard/GP, not zone-redundant, no failover group (T-INFRA-005).
// }
//
// resource stagingDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = if (environmentName == 'staging') {
//   // sku: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose' }  // serverless
//   // autoPauseDelay: 60   // auto-pause; billed per-database (~$0.50/mo).
// }
//
// HARD RULES (T-INV-013): no elasticPoolId-based job, no Azure SQL Agent job,
// no Elastic Job agent, no delete trigger, no scheduled job, no TTL — nowhere.
// Destructive migrations are separately blocked by T-MIG-001.
