# Runbook — branch protection on `main`

**Status: ACTIVE.** Applied 2026-08-12, once the repository was made public.

Protection was previously impossible: GitHub returned
`403 — Upgrade to GitHub Pro or make this repository public` for **both** the
classic branch-protection API and the rulesets API, because the repo was
private on a free plan. Making it public removed that restriction.

## What is enforced

Two rulesets, deliberately split, because they need **different bypass rules**.

### 1. `main: history integrity` — no bypass, binds everyone

| Rule | Effect |
| --- | --- |
| `non_fast_forward` | `main` cannot be force-pushed. |
| `deletion` | `main` cannot be deleted. |

`bypass_actors` is **empty on purpose** (`current_user_can_bypass: never`).
Neither operation is ever legitimate on `main`, including for the owner, and
both destroy history that CI cannot recover.

> This split exists because of a real failure, not a hypothetical one. The
> first attempt put all three rules in **one** ruleset with an admin bypass, on
> the theory that the bypass only mattered in emergencies. A force-push test
> then printed `Bypassed rule violations` and **rolled `main` back a commit** —
> the protection was decorative for the only person who normally pushes. Always
> test a protection rule by attempting the thing it forbids.

### 2. `main: required status checks` — admin bypass retained

All twelve CI jobs (`1 · lint` … `12 · build`) must pass before a pull request
can merge.

`bypass_actors` keeps the **admin role (`actor_id: 5`)**, so the owner can
still push directly to `main`. That is a deliberate trade-off for a
single-owner repo: required checks apply to direct pushes as well as PRs, so a
no-bypass version would force every change — including a one-line typo fix —
through a branch, a PR, and a full twelve-job run. Outside contributions arrive
as PRs and are gated normally.

**To make the gate bind unconditionally** (recommended the moment anyone else
commits, or if direct pushes stop being the working model): re-apply
`branch-ruleset-checks.json` with `bypass_actors` set to `[]`.

`strict_required_status_checks_policy` is **`false`** — branches need not be
rebased onto the tip of `main` before merging. With several concurrent
Dependabot PRs, `true` re-runs all twelve jobs on every PR after each merge,
serialising the queue for no safety gain here.

## Also enabled with the move to public

- **Secret scanning** and **push protection** — free on public repos. Push
  protection rejects a commit containing a recognised credential _at push
  time_, which is the only point at which a leak is still cheap to fix. This
  complements the `2 · secrets` CI job rather than replacing it: CI scans full
  history on every run, push protection stops the write.
- **Dependabot alerts** and **automated security fixes**.

## Re-applying

```bash
# History integrity (no bypass)
gh api repos/saquibrashid/nextup/rulesets -X POST \
  --input docs/runbooks/branch-ruleset.json

# Required status checks (admin bypass)
gh api repos/saquibrashid/nextup/rulesets -X POST \
  --input docs/runbooks/branch-ruleset-checks.json
```

Verify, rather than assuming, with the operations the rules forbid:

```bash
gh api repos/saquibrashid/nextup/rules/branches/main --jq '.[].type'
git push --force origin HEAD~1:main   # MUST be rejected: GH013
```

## Keeping the check list correct

The `required_status_checks` contexts are the **job `name:` values** from
`.github/workflows/ci.yml` (`1 · lint` … `12 · build`), not the job **ids**. A
required context that never reports blocks every PR forever, so if a job is
renamed, `branch-ruleset-checks.json` must be updated and re-applied in the
same change.
