using './main.bicep'

// Staging parameters (SKELETON, TASK-006). Serverless auto-paused DB,
// minReplicas=0. Staging identity gets NO grant on prod DB or blob.
param environmentName = 'staging'
// param location = 'eastus'
