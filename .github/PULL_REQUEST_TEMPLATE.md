## Summary

<!-- What does this change do, and why? Keep it to a few sentences. -->

## Linked issue / task

<!-- e.g. Closes #12, or "Implements TASK-001 from docs/backlog.md". -->

## Type of change

- [ ] Feature (a backlog task)
- [ ] Bug fix
- [ ] Refactor / internal
- [ ] Docs / specs
- [ ] Infrastructure (`infra/**`)

## Testing done

<!-- Which named tests from specs/testing.md cover this? Paste the relevant
     AC → test IDs. If an AC is not machine-verifiable, cite specs/testing.md §10. -->

## Checklist

- [ ] Every acceptance criterion touched maps to a **named test** that passes.
- [ ] No new telemetry/analytics dependency (dependency allow-list, TASK-004).
- [ ] No secret, credential, connection string, blob URL or SAS in code, logs, or responses.
- [ ] Any new runtime dependency is justified against NFR-004 in this description.
- [ ] Migrations contain no destructive statement (`T-MIG-001`).
- [ ] No scheduler / TTL / Agent-job / Elastic-job added (REQ-028, REQ-041).
- [ ] If I edited an executable instruction in a doc, I corrected it **in place** and struck through the superseded text (the F-001 rule).
