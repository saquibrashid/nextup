// infra/csrbac.bicep — least-privilege grant on ONE Cognitive Services account.
//
// A separate module for the same mechanical reason as rbac.bicep: a
// roleAssignment `name` must be calculable at the START of a deployment, so it
// cannot be built from another module's output in main.bicep (Bicep BCP120).
// Passing the principal id INTO a module turns it into a deployment-time
// parameter of that nested deployment, which is calculable.
//
// It is also what breaks the ai <-> aca cycle: the accounts must exist before
// the container app (which needs their endpoints as environment variables),
// and the grants can only be issued after it (they need its managed identity).

metadata description = 'Grants a principal a role scoped to a single Cognitive Services account.'

@description('The Cognitive Services account to scope the grant to — NOT the resource group.')
param accountName string

@description('Principal id of the system-assigned managed identity.')
param principalId string

@description('Role definition guid to grant.')
param roleDefinitionId string

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: accountName
}

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, principalId, roleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
