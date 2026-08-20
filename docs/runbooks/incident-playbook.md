---
createdAt: 2026-08-20T14:55:00-04:00
createdBy: solution-architect
phase: 8
revision: 1
status: active
appliesTo: nextup production Container App (ca-nextup-prod, resource group nextup-rg)
forcedBy: TASK-133 (R6) — production readiness
verifiedAgainst: live Azure, eastus2, 2026-08-20 (read-only)
---

# PLAYBOOK — when nextup is broken

> **Read this if:** something is wrong in production and you need to know
> which of the existing runbooks to open.
>
> **This document routes. It does not duplicate.** Every remedy below
> lives in its own runbook, verified against live Azure. Copying their
> steps here would create a second copy that drifts — and the copy you
> reach for mid-incident would be the stale one.

---

## 0. Scale and posture

This is a **single-owner** product. There is no on-call, no SLA, no
paging, and no user waiting on the other end. **Nothing here is urgent
enough to justify skipping a step**, and the two fastest remedies below
are both one-command switches that are *silently wrong* if you run them
out of order.

There is also **no telemetry and no analytics** — deliberately. Your
evidence is: Azure Monitor / `log-nextup`, container logs, revision state,
and the app's own error envelope. That is all there is, and it is enough.

---

## 1. Route by symptom

| Symptom | It is | Go to |
| --- | --- | --- |
| An upload of one large image fails, message names **memory** and links a runbook | **A decided remedy, not an incident** | §2 |
| A deploy landed and the app is broken — 5xx, wrong behaviour, bad migration effects | Rollback | `docs/runbooks/rollback.md` |
| Deployed, "healthy", but nothing works once signed in | **Not configured** | `docs/runbooks/config-checklist.md` §0 |
| The owner cannot sign in / everyone gets 403 | Allow-list | `config-checklist.md` §1.1 |
| **The "Paste screenshot" button is missing** and there is no error | HTTPS lost | `config-checklist.md` §4 — read it before debugging the SPA |
| Extraction returns nothing, or Azure OpenAI is down/over quota | One-value revert | `config-checklist.md` §3 |
| Image pull fails on a new revision | Someone added a registry credential | `config-checklist.md` §1.6, `docs/ghcr-pat.md` |
| A whole upload batch failed together | See §3 — this is a real bug |

---

## 2. Out-of-memory on image decode — a DECIDED remedy

🛑 **Do not debug this. Do not treat it as an incident. Do not
"investigate the memory leak".**

The container runs at **0.25 vCPU / 0.5 GiB** with
`NEXTUP_MAX_DECODE_PIXELS=25000000` because the owner **chose** to start
small and up-size **reactively** once it actually bit, having already seen
the priced risk (`A43`, `RSK-016`). An OOM on a large image is therefore
the **anticipated trigger of a pre-authorised change**, not a surprise.

**The response is: `docs/runbooks/scale-up-memory.md`. Follow it.**

That runbook owns the procedure, the exact permitted value pair, the
traffic shift, the deactivation step and the rollback. It costs about
**\$4/month**. Nothing about it is reproduced here on purpose.

Two things worth knowing *before* you open it, because they change what
you should expect:

1. **A memory failure must fail ONE IMAGE, never the batch**
   (`REQ-080`/`REQ-081`). If a single oversized image took down an entire
   upload batch, that is a **genuine bug** — go to §3 — not a reason to
   up-size.
2. **There are two failure paths and only one of them raises an error.**
   A catchable WASM `RangeError` leaves the container running; a **kernel
   OOM kill restarts the container and never raises anything**. If you see
   a restart with no error, you are in the second case, and it is still
   this section.

⚠ **Up-sizing is not owner-approved in advance as a standing licence.**
It is pre-authorised as the response *to an actual OOM*. Do not raise the
memory pre-emptively "to be safe" — and never move the memory without
moving `NEXTUP_MAX_DECODE_PIXELS` in the same commit
(`config-checklist.md` §2, `T-INFRA-005`).

---

## 3. A whole batch failed — this one IS a bug

`REQ-080`/`REQ-081` require per-image failure isolation: no partial
commit, the rest of the batch still processes, and the failed file stays
retryable.

If an entire batch failed together, do **not** work around it by
up-sizing or by asking the owner to upload fewer images. Capture the batch
id and the failing image, and raise it. Widening the memory would hide the
defect and leave the isolation guarantee untested in the one situation it
exists for.

⚠ Check the error code before concluding it was memory: the message for a
memory failure **names memory and links the runbook**; the separate
corrupt-file code deliberately mentions **neither**. If a corrupt-file
error appears where memory is the real cause, that is itself the finding.

---

## 4. Before you change anything

**Read which revision is actually serving traffic.** Production runs
`activeRevisionsMode: Multiple` with traffic pinned to a named revision,
so the app-level template shows the *newest* revision, not the *serving*
one:

```bash
REV=$(az containerapp ingress traffic show -n ca-nextup-prod -g nextup-rg \
        --query "[?weight>\`0\`].revisionName | [0]" -o tsv)
echo "serving: $REV"
```

Everything you inspect — env vars, image tag, resources — should be read
from `az containerapp revision show --revision "$REV"`. Reading the
app-level template instead is how a check reports success on exactly the
failure it was written to detect (`scale-up-memory.md` §3a).

⚠ **`az containerapp update` does not reach production here.** In Multiple
mode with a named-revision traffic pin it builds a new revision at **0%
traffic**, reachable only on its own per-revision FQDN. The traffic shift
is a separate, explicit step.

⚠ **`az containerapp revision list` hides the revision you need** — pass
`--all`. And **shifting traffic to a deactivated revision exits 0, prints
the new weight table, and then serves 404.** Both are documented, both
were verified on live Azure, and both are in `docs/runbooks/rollback.md`.
Read it before any revision switch, including one you are doing for
configuration reasons.

---

## 5. What is NOT an incident

| Not an incident | Why |
| --- | --- |
| An OOM on a large image | §2 — a decided, priced, pre-authorised remedy. |
| The list "going out of date" | There is **no** staleness nudge and none may be added (`A46`). `FreshnessStrip` states the fact; it never nags. |
| A title reappearing as a new row dated today | Correct behaviour (`L1`/`A33`). The removed view is a **log**, not a recycle bin. |
| Search being slow or missing typos | Accepted (`NFR-018`). `LIKE '%term%'` is exact-substring and not index-backed — `specs/data-model.md` §16.6. |
| Staging being cold | Staging is serverless and auto-pauses. Nobody judges staging's cold start. Production runs `minReplicas = 1` and is always warm. |

---

## 6. What you must never do to make a symptom go away

| Never | Why |
| --- | --- |
| Add `/api/*` to Easy Auth `excludedPaths` | It publishes the owner's list to the internet. `T-SMOKE-001` exists to catch exactly this — a 401 **with a body and no platform headers** is the signature. |
| Downgrade the model or the extractor for cost | `NFR-012a` non-compliance, not an optimisation (`config-checklist.md` §3). |
| Add a TTL, retention job or scheduled delete | The **absence** of one *is* `REQ-028`. Soft delete forever. |
| Add a background process that changes list state | Only two non-owner processes may exist: lazy metadata refresh on access, and the 30-day blob purge (`T-CI-005`). |
| Restore data by "un-removing" rows automatically | Restore is an explicit user action only, never a consequence of reconciliation. |
| Hand-edit `docs/status.md` | It is generated. Run `npm run status`. |

---

## 7. Related

- **`docs/runbooks/config-checklist.md`** — every setting, and what breaks.
- **`docs/runbooks/scale-up-memory.md`** — the OOM remedy (§2).
- **`docs/runbooks/rollback.md`** — reverting a deploy; the two silent traps.
- **`docs/runbooks/deployment-identity.md`** — CI's Azure identity.
- **`docs/runbooks/vision-account-reuse.md`** — Azure AI Vision account reuse.
- **`docs/ghcr-pat.md`** — why there is no registry credential.
