// infra/aca.bicep — Azure Container Apps (TASK-006, Variant A / A40).
//
// One Container Apps environment (shared) and one Container App per
// deployment environment. Prod is always warm.

metadata description = 'Container Apps environment and the per-environment app, pulling from ghcr.io.'

@description('Deployment environment: prod or staging.')
@allowed(['prod', 'staging'])
param environmentName string

@description('Azure region for all resources.')
param location string

@description('Container Apps managed environment name.')
param managedEnvironmentName string

@description('Container App name for this environment.')
param containerAppName string

@description('Log Analytics workspace customer id.')
param logAnalyticsCustomerId string

@secure()
@description('Log Analytics workspace shared key.')
param logAnalyticsSharedKey string

// The image lives in ghcr.io. There is NO Azure Container Registry and NO
// AcrPull grant anywhere (ADR-0003 Rev 3, TASK-146). The registry credential
// is a fine-grained PAT with read:packages, held as a Container Apps secret.
@description('Fully-qualified container image, e.g. ghcr.io/saquibrashid/nextup:sha-abc123.')
param containerImage string

@description('GitHub username that owns the ghcr.io fine-grained PAT.')
param ghcrUsername string

@description('ghcr.io fine-grained PAT with read:packages. Supplied at deploy time.')
@secure()
param ghcrToken string

// ---------------------------------------------------------------------------
// THE COMPUTE / DECODE-GUARD PAIR (REQ-079, A43, invariant 14).
//
// cpu / memory and NEXTUP_MAX_DECODE_PIXELS are ONE SETTING IN TWO PLACES and
// must never be changed independently:
//   - raising the guard without the memory removes the only thing stopping a
//     large image from killing the container;
//   - raising the memory without the guard buys ~$4/month of nothing.
//
// The allowed combinations are a CLOSED SET:
//   (0.25, '0.5Gi', '25000000')   <- current
//   (0.5,  '1.0Gi', '50000000')
//
// T-INFRA-005 (TASK-008) fails CI on any other combination. The sanctioned way
// to change both together is docs/runbooks/scale-up-memory.md (TASK-156).
// Do NOT pre-emptively raise the memory "to be safe" — the owner chose to
// start small and up-size reactively.
//
// The guard is a PIXEL guard read from the image header. A byte-size ceiling
// is NOT a substitute: HEIC compression varies wildly and a 6 MiB file can
// decode to 48 MP.
// ---------------------------------------------------------------------------
@description('Container CPU. Paired with containerMemory and maxDecodePixels.')
param containerCpu string = '0.25'

@description('Container memory. Paired with containerCpu and maxDecodePixels.')
param containerMemory string = '0.5Gi'

@description('Pre-decode pixel guard. Paired with containerCpu and containerMemory.')
param maxDecodePixels string = '25000000'

var isProd = environmentName == 'prod'

// Shared across both environments — one managed environment, one Log Analytics
// workspace (ADR-0003 R2.4: "no separate Log Analytics workspace").
resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  // System-assigned managed identity. RBAC is granted least-privilege in
  // main.bicep, scoped to THIS environment's blob container only — the staging
  // identity gets no grant on the production database or blob container.
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        // T-INFRA-003. HTTPS is also a FUNCTIONAL dependency, not merely a
        // security one: navigator.clipboard is absent on http://, so the
        // paste ingest affordance (REQ-001/REQ-004) simply would not exist.
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: 'ghcr.io'
          username: ghcrUsername
          passwordSecretRef: 'ghcr-token'
        }
      ]
      secrets: [
        {
          name: 'ghcr-token'
          value: ghcrToken
        }
      ]
      // Easy Auth (authConfigs) is NOT configured here — it is TASK-027,
      // which depends on TASK-006 and TASK-019. Zero auth code in the app
      // (ADR-0002).
    }
    template: {
      containers: [
        {
          name: 'nextup'
          image: containerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            {
              name: 'NEXTUP_MAX_DECODE_PIXELS'
              value: maxDecodePixels
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'NEXTUP_ENVIRONMENT'
              value: environmentName
            }
          ]
        }
      ]
      scale: {
        // prod is ALWAYS WARM (minReplicas = 1). maxReplicas = 2 exists only
        // so a revision transition can overlap; there is deliberately NO
        // scale rule. staging scales to zero — nobody judges its cold start.
        minReplicas: isProd ? 1 : 0
        maxReplicas: isProd ? 2 : 1
      }
    }
  }
}

@description('The Container App name.')
output appName string = app.name

@description('System-assigned managed identity principal id, for RBAC in main.bicep.')
output principalId string = app.identity.principalId

@description('The public FQDN of the app.')
output appFqdn string = app.properties.configuration.ingress.fqdn
