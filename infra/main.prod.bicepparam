using './main.bicep'

// Production parameters (TASK-006, Variant A / A40).
//
// Secrets are read from the environment and have NO default: a missing
// variable must fail loudly rather than silently deploy a weak credential.
// CI supplies them from GitHub secrets; locally, export them before running
// `az deployment group what-if`.

param environmentName = 'prod'
param location = 'eastus2'

// TASK-007's deploy workflow overrides this with the immutable sha- tag it
// just pushed. The default is a public bootstrap image so the very first
// deployment succeeds before anything exists in ghcr.io.
param containerImage = readEnvironmentVariable(
  'NEXTUP_IMAGE',
  'mcr.microsoft.com/k8se/quickstart:latest'
)

param ghcrUsername = readEnvironmentVariable('NEXTUP_GHCR_USERNAME', 'saquibrashid')
param ghcrToken = readEnvironmentVariable('NEXTUP_GHCR_TOKEN')

param sqlAdminLogin = readEnvironmentVariable('NEXTUP_SQL_ADMIN_LOGIN', 'nextupadmin')
param sqlAdminPassword = readEnvironmentVariable('NEXTUP_SQL_ADMIN_PASSWORD')

param entraAdminLogin = readEnvironmentVariable('NEXTUP_ENTRA_ADMIN_LOGIN')
param entraAdminObjectId = readEnvironmentVariable('NEXTUP_ENTRA_ADMIN_OBJECT_ID')
