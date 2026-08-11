// infra/main.bicep — composition root (SKELETON, TASK-006, Variant A / A40).
//
// Skeleton only: resources are commented intent, not deployable as-is.
// Builds the whole environment for ONE deployment target (prod or staging),
// selected by the .bicepparam file. There is NO Azure Container Registry and
// NO PostgreSQL anywhere in this deployment.

targetScope = 'resourceGroup'

@description('Deployment environment: prod or staging.')
@allowed(['prod', 'staging'])
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

// --- Modules (to be authored in TASK-006) -----------------------------------
//
// module storage 'storage.bicep' = {
//   name: 'storage'
//   params: { environmentName: environmentName, location: location }
//   // Private blob, 30-day lifecycle purge, soft-delete/versioning/PITR OFF.
// }
//
// module sqldb 'sqldb.bicep' = {
//   name: 'sqldb'
//   params: { environmentName: environmentName, location: location }
//   // prod: Azure SQL Basic (5 DTU, 2 GB). staging: serverless auto-pause DB.
//   // No Agent job, no Elastic Job, no TTL.
// }
//
// module aca 'aca.bicep' = {
//   name: 'aca'
//   params: {
//     environmentName: environmentName
//     location: location
//     // Image pulled from ghcr.io with a fine-grained PAT (read:packages)
//     // held as a Container Apps secret — NOT AcrPull.
//   }
//   // 0.25 vCPU / 0.5 GiB. prod minReplicas=1; staging minReplicas=0.
//   // No scale rule.
// }
//
// Log Analytics workspace, system-assigned managed identities with
// least-privilege RBAC (staging identity gets NO grant on prod DB/blob),
// and budget alerts (TASK-142: 1.0x informational + 1.5x, NO auto-remediation)
// are composed here.
