// infra/storage.bicep — Azure Blob screenshot storage (TASK-006, Variant A / A40).
//
// Private screenshot storage with a 30-day lifecycle purge (NFR-019, REQ-041).

metadata description = 'Private screenshot blob storage with a 30-day lifecycle purge.'

@description('Deployment environment: prod or staging.')
@allowed(['prod', 'staging'])
param environmentName string

@description('Azure region for all resources.')
param location string

@description('Globally-unique storage account name (computed by main.bicep).')
param storageAccountName string

// IMAGE_RETENTION_DAYS (NFR-019). This is the SCREENSHOT retention constant.
// It is NOT the TMDB metadata refresh age (TMDB_METADATA_MAX_AGE_DAYS = 183,
// NFR-014) and the two must never be merged into one value — see
// .github/copilot-instructions.md invariant 8 and T-INV-008. There is no
// list-staleness constant; do not add one (invariant 8a).
@description('Screenshot retention in days (NFR-019). Do NOT reuse for TMDB metadata age.')
param imageRetentionDays int = 30

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    // T-INFRA-002: the container must never be publicly reachable.
    allowBlobPublicAccess: false
    // Managed identity only. No account key, no SAS (specs/security.md).
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

// ---------------------------------------------------------------------------
// BLOB SERVICE PROPERTIES — the T-INFRA-002 trap.
//
// Blob soft delete, container soft delete, versioning, change feed and PITR
// are ALL explicitly DISABLED. Enabling ANY of them silently retains
// screenshots beyond 30 days and breaks NFR-019 invisibly: the lifecycle rule
// would still "delete" the blob, but a soft-deleted or versioned blob remains
// recoverable and is therefore still retained. Do not "improve" these on.
//
// Declared unconditionally (not per-environment) because they are
// account-level singletons: a per-environment declaration would let whichever
// environment deployed last silently overwrite the other's settings.
// ---------------------------------------------------------------------------
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: false
    }
    containerDeleteRetentionPolicy: {
      enabled: false
    }
    isVersioningEnabled: false
    changeFeed: {
      enabled: false
    }
    restorePolicy: {
      enabled: false
    }
  }
}

// Both containers are declared unconditionally for the same singleton-safety
// reason as the lifecycle policy below: the purge rule must cover both, and it
// must not reference a container the other deployment creates conditionally.
// Blob path is {ownerId}/{batchId}/{imageId}.
resource prodContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'screenshots'
  properties: {
    publicAccess: 'None'
  }
}

resource stagingContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'screenshots-staging'
  properties: {
    publicAccess: 'None'
  }
}

// ---------------------------------------------------------------------------
// LIFECYCLE PURGE (T-INFRA-004, NFR-019, REQ-041).
//
// Exactly ONE rule, whose only action is delete-at-30-days, and whose
// prefixMatch is restricted to the two screenshot containers so it can never
// purge anything else. This is one of only two permitted non-owner background
// processes (the other is metadata-only lazy refresh on access) — see
// copilot-instructions invariant 5 and T-CI-005.
//
// Declared unconditionally: managementPolicies is an account-level singleton
// named 'default'. If prod declared a rule for 'screenshots' and staging
// declared one for 'screenshots-staging', the second deployment would silently
// delete the first's rule and screenshots would be retained forever.
// ---------------------------------------------------------------------------
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'purge-screenshots-30d'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['screenshots/', 'screenshots-staging/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: imageRetentionDays
                }
              }
            }
          }
        }
      ]
    }
  }
}

@description('The storage account name.')
output accountName string = storage.name

@description('The blob container this environment writes to.')
output containerName string = environmentName == 'prod' ? prodContainer.name : stagingContainer.name

@description('The blob service endpoint.')
output blobEndpoint string = storage.properties.primaryEndpoints.blob
