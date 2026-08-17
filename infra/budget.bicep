// infra/budget.bicep — subscription budget and its two alert thresholds.
//
// TASK-142. Converts RSK-029 ("real but unverified spend") from an unmonitored
// risk into a monitored one. Costs nothing.
//
// WHY THIS IS A SEPARATE TEMPLATE AND NOT PART OF main.bicep
// A budget is a SUBSCRIPTION-scoped resource. `main.bicep` targets a resource
// group, and Bicep cannot deploy a module upward from a resource group to its
// subscription — the scope nesting only goes the other way. So this is its own
// `az deployment sub create`, which is also the right order of operations: the
// budget should exist BEFORE the first billable resource, not alongside it.
//
// ⚠ NO AUTOMATED REMEDIATION. EVER.
// Azure budget notifications can invoke action groups, and an action group can
// run a runbook that stops or deletes resources. That is forbidden here: an
// automated action against this subscription could take the product offline
// or, worse, delete something — and REQ-028 says deletion is never automatic.
// The notifications carry `contactEmails` ONLY. `T-INFRA-009e` fails if an
// action group, a webhook or any other actionable target is ever added.
//
// The alert TELLS THE OWNER. The owner decides. Same posture as the freshness
// strip: show the fact, never act on the owner's behalf.

targetScope = 'subscription'

metadata description = 'nextup cost guardrail — one budget, two notification thresholds, zero automation.'

@description('''
The published monthly total from docs/architecture.md §Cost summary, in USD.

This is the TOP of the as-designed Variant A band ($11-13), not the midpoint:
a budget anchored to the optimistic end of a band would alert on ordinary
variation, and an alert that cries wolf is worse than no alert because it
trains the owner to ignore it.
''')
@minValue(1)
param monthlyTotalUsd int = 13

@description('Where both notifications are emailed. No default: a budget nobody is told about is not a control.')
param ownerEmail string

@description('''
Budget anchor. Must be the first day of a month.

Defaults to the first of the current month via utcNow(), which is only legal
as a parameter default -- do not move this expression into the resource body.
''')
param budgetStartDate string = utcNow('yyyy-MM-01')

// One budget, two thresholds. NOT two budgets: Azure evaluates each budget's
// notifications against that budget's own amount, so a single amount with
// percentage thresholds keeps 1.0x and 1.5x arithmetically tied to ONE number.
// Two budgets would let the pair drift apart silently.
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'nextup-monthly'
  properties: {
    category: 'Cost'
    timeGrain: 'Monthly'
    amount: monthlyTotalUsd
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      // 1.0x -- INFORMATIONAL. This is expected to fire in a bulk-import month
      // (~$12-14) and after the pre-authorised memory up-size (~$15-18). Both
      // are legitimate, which is exactly why this threshold is informational
      // and why no automation hangs off it.
      informational: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [ownerEmail]
        locale: 'en-us'
      }
      // 1.5x -- ACTION REQUIRED. Nothing in the design reaches this figure,
      // including the up-size remedy, so this firing means something is wrong:
      // a runaway extraction loop, a SKU changed by hand, or a resource nobody
      // meant to create.
      actionRequired: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 150
        thresholdType: 'Actual'
        contactEmails: [ownerEmail]
        locale: 'en-us'
      }
    }
  }
}

@description('The budget resource id, so a deployment can be verified without a portal visit.')
output budgetId string = budget.id

@description('''
What the two thresholds mean, for the deployment log.

⚠ Reported as the base amount plus PERCENTAGES, not as computed dollar
figures. Bicep integer division truncates, so `13 * 3 / 2` renders as 19 when
the threshold Azure actually evaluates is $19.50 — an output that understates
the real alert point by 50 cents is worse than no output, because it is the
number a reader would quote.
''')
output thresholds object = {
  baseAmountUsd: monthlyTotalUsd
  informationalPercent: 100
  actionRequiredPercent: 150
}
