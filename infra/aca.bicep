// infra/aca.bicep — Azure Container Apps (SKELETON, TASK-006, Variant A / A40).
//
// Skeleton only. One Container App per environment, always warm in prod.

@allowed(['prod', 'staging'])
param environmentName string
param location string = resourceGroup().location

// --- Intent ------------------------------------------------------------------
//
// resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
//   // Log Analytics-backed environment.
// }
//
// resource app 'Microsoft.App/containerApps@2024-03-01' = {
//   properties: {
//     configuration: {
//       // ingress: external, allowInsecure=false (T-INFRA-003)
//       // registries: [{ server: 'ghcr.io', ... }]  // PAT as a secret, NOT AcrPull
//       // secrets: ghcr PAT, DB password (KV ref) IF SQL-auth fallback, TMDB key
//       // authConfigs handled by Container Apps built-in auth (Easy Auth, ADR-0002)
//     }
//     template: {
//       containers: [{
//         // resources: { cpu: json('0.25'), memory: '0.5Gi' }
//       }]
//       scale: {
//         // prod:    minReplicas: 1, maxReplicas: 2   // always warm, NO scale rule
//         // staging: minReplicas: 0
//       }
//     }
//   }
//   // System-assigned managed identity; least-privilege RBAC granted in main.bicep.
//   // Image comes from ghcr.io. There is NO AcrPull grant anywhere.
// }
