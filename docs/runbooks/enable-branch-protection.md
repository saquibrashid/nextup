# Runbook — enable branch protection on `main`

**Status: BLOCKED on an account decision. Nothing in this repo can unblock it.**

GitHub returns `403 — Upgrade to GitHub Pro or make this repository public to
enable this feature` for **both** the classic branch-protection API and the
newer rulesets API, because `saquibrashid/nextup` is a **private repo on a free
plan**. Verified against both endpoints:

```
gh api repos/saquibrashid/nextup/branches/main/protection -X PUT ...   # 403
gh api repos/saquibrashid/nextup/rulesets -X POST ...                  # 403
```

## What this means today

The twelve CI jobs **report but do not block.** A red run does not stop a merge,
and `main` can be force-pushed or deleted. This directly weakens the project's
own rule that *"CI is the only gate"* (`.github/copilot-instructions.md` §6) —
right now CI is an advisory signal, not a gate.

## Choose one

| Option | Cost | Trade-off |
|---|---|---|
| **GitHub Pro** | ~$4/month | Repo stays private. |
| **Make the repo public** | free | The corpus is product specs for a personal watchlist — no credentials and no owner data — but it does expose the design publicly. |
| **Accept it** | free | `main` stays unprotected. Acceptable only while this is a single-owner repo with no other contributors. |

## Applying it once unblocked

`branch-ruleset.json` in this directory is ready to apply as-is:

```bash
gh api repos/saquibrashid/nextup/rulesets -X POST \
  --input docs/runbooks/branch-ruleset.json
```

It sets, on the default branch:

- **`deletion`** and **`non_fast_forward`** — `main` cannot be deleted or
  force-pushed. These two are the reason the warning appears and they cost
  nothing in workflow terms.
- **`required_status_checks`** — all twelve CI jobs must pass. Note this
  applies to **direct pushes as well as PRs**, so adopting it means moving to a
  branch-and-PR flow for feature work. That is why a **bypass actor for the
  admin role (`actor_id: 5`) is included**: it keeps you able to push directly
  to `main` in an emergency without deleting and recreating the ruleset.
  Remove that bypass if you want the gate to bind unconditionally.
- `strict_required_status_checks_policy` is **`false`** — branches do not have
  to be rebased onto the tip of `main` before merging. With ten concurrent
  Dependabot PRs, `true` would force a re-run of all twelve jobs on every PR
  after each merge, serialising the queue for no safety gain on a
  single-owner repo.

## Keeping the check list correct

The `required_status_checks` contexts are the **job `name:` values** from
`.github/workflows/ci.yml` (`1 · lint` … `12 · build`), not the job **ids**.
A required context that never reports blocks every PR forever, so if a job is
renamed, this file must be updated and re-applied in the same change.
