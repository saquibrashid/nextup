// infra/storage.bicep — Azure Blob (SKELETON, TASK-006).
//
// Skeleton only. Private screenshot storage with a 30-day lifecycle purge.

@allowed(['prod', 'staging'])
param environmentName string
param location string = resourceGroup().location

// --- Intent ------------------------------------------------------------------
//
// resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
//   properties: {
//     allowBlobPublicAccess: false      // T-INFRA-002
//     allowSharedKeyAccess: false       // MI only; no account key, no SAS
//     minimumTlsVersion: 'TLS1_2'
//   }
//   // BLOB SOFT DELETE, CONTAINER SOFT DELETE, VERSIONING and PITR are all
//   // DISABLED — enabling any silently retains screenshots past 30 days and
//   // breaks NFR-019 invisibly. This is the trap T-INFRA-002 guards.
// }
//
// Container 'screenshots' (prod) / 'screenshots-staging' (staging), private,
// with ONE lifecycle rule: action = delete at 30 days, targeting only the
// screenshots container (T-INFRA-004). Blob path is {ownerId}/{batchId}/{imageId}.
