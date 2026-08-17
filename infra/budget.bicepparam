using './budget.bicep'

// Subscription budget parameters (TASK-142).
//
// Deployed ONCE per subscription, and deliberately BEFORE the first billable
// resource — a cost guardrail added after the spend it is meant to catch is
// not a guardrail.
//
//   az deployment sub create \
//     --name nextup-budget \
//     --location eastus2 \
//     --template-file infra/budget.bicep \
//     --parameters infra/budget.bicepparam
//
// Preview it first with `az deployment sub what-if` (same arguments). The
// what-if creates nothing.

// The published Variant A total from docs/architecture.md §Cost summary.
// ⚠ If that table changes, change this — and only this. The 1.5x action
// threshold is a PERCENTAGE of this number, so the two can never drift apart.
param monthlyTotalUsd = 13

// No default anywhere in the chain: a budget nobody is told about is not a
// control, so a missing variable must fail the deployment loudly.
param ownerEmail = readEnvironmentVariable('NEXTUP_OWNER_EMAIL')
