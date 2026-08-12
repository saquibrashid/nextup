// infra/rbac.bicep — least-privilege role assignment (TASK-006).
//
// Exists as a separate module for a mechanical reason: a roleAssignment `name`
// must be calculable at the START of a deployment, so it cannot be built from
// another module's output in main.bicep (Bicep BCP120). Passing the principal
// id INTO a module turns it into a deployment-time parameter of that nested
// deployment, which is calculable.

metadata description = 'Grants a principal a role scoped to a single blob container.'

@description('Storage account holding the container.')
param storageAccountName string

@description('The blob container to scope the grant to — NOT the whole account.')
param blobContainerName string

@description('Principal id of the system-assigned managed identity.')
param principalId string

@description('Role definition guid to grant.')
param roleDefinitionId string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storageAccount
  name: 'default'
}

resource blobContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: blobService
  name: blobContainerName
}

// Scoped to the CONTAINER, not the account. This is what makes "the staging
// identity has NO grant on the production blob container" true by
// construction: an account-scoped grant would silently hand staging
// read/write access to every production screenshot.
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: blobContainer
  name: guid(blobContainer.id, principalId, roleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
