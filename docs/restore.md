# Runbook — backup and restore (TASK-131, OQ-025)

**Who runs this:** the owner. The export is a **weekly, five-minute** habit.
The restore half is read only when something has already gone wrong.

**Why this runbook exists at all:** REQ-028 is soft-delete forever — nothing in
this application is ever hard deleted, there is no TTL, and there is no sweep.
That is a deliberate safety property, and it has a consequence: the database is
**append-mostly and irreplaceable**. A title's row cannot be re-derived from
anything, because the screenshot it came from is purged 30 days after upload
(NFR-019). There is no second copy anywhere unless you make one.

---

## 0. What protects the data, and what each one does not cover

| | Window | Owner-controlled? | Survives losing the subscription? |
|---|---|---|---|
| **Azure SQL PITR** (automatic) | **7 days** | No | **No** |
| **BACPAC export to blob** (manual, §2) | As long as you keep it | Yes | Yes, if copied off Azure |
| **JSON owner export** (manual, §1) | As long as you keep it | Yes | Yes |

> ⚠ **The PITR window is 7 days, not 35.** An earlier revision of the plan
> assumed PostgreSQL Flexible Server, which gives 35. We run **Azure SQL
> Basic** (`infra/sqldb.bicep` — `sku: Basic`, `retentionDays: 7`), and A40
> corrected the plan accordingly. The practical meaning: **a corruption or a
> bad migration you do not notice within a week is unrecoverable via PITR.**
> Because the store is append-mostly, "not noticing for a week" is entirely
> plausible — a dropped column or a mis-scoped update does not announce itself.
>
> That is why the manual export in §1 is the **primary** line of defence and
> not a belt-and-braces extra.

> ⚠ **None of this is scheduled, and none of it may become scheduled.** Product
> invariant 5 permits exactly three non-owner processes and `T-CI-005` fails
> the build if a fourth appears. A weekly Azure SQL Agent job or Elastic Job
> would be a REQ-041 violation, not an improvement — the *absence* of such a
> mechanism **is** REQ-028. The weekly cadence below belongs in **your calendar**,
> which is the right place for a habit a machine must not own.

---

## 1. The weekly export (do this one)

```powershell
# From the repository root. Writes OUTSIDE the working tree — see the warning.
npm run build:scripts
node scripts/dist/export-owner-data.js --owner o_xxxxxxxxxxxxxxxx --out "$HOME\nextup-backups\owner-export-2026-09-01.json"
```

> ⚠ **Invoke `node` directly; do NOT wrap this in `npm run … -- --owner …`.**
> npm parses `--owner` and `--out` as its own config flags before the script
> ever sees them, prints `Unknown cli config "--owner"` as a *warning*, and
> passes the bare values through as positionals. The script then fails with
> `Unknown argument: o_xxxx…`, which reads as a bug in the script rather than
> in how it was called. `npm run build:scripts` compiles; `node` runs.

It prints a row count per table and a total. **Read them.** A total that has
gone *down* since last week is the signal this runbook exists to give you —
nothing in this application deletes, so a falling count is a defect, not a
change you made.

> ⚠ **Write the artefact somewhere outside this repository.** It is a complete
> copy of everything you have ever saved, and **this repository is public**.
> `.gitignore` carries `*.owner-export.json`, `owner-export-*.json` and
> `/exports/` as a backstop for the run that uses `--out .` out of habit, but
> the backstop only catches those three shapes. Keep backups in
> `$HOME\nextup-backups\` or a private cloud folder.

**Finding your owner id.** It is the `ownerId` on any of your rows, and it is
derived — `'o_' + sha256(issuer + '|' + subject).slice(0, 16)`
(`apps/api/src/auth/ownerId.ts`). The simplest source is the Portal query
editor: `SELECT DISTINCT ownerId FROM title;`.

> ⚠ **A mistyped owner id is the likeliest way this goes wrong, and it does not
> look like a failure.** Every query matches nothing, the script succeeds, and
> you get a well-formed artefact with the right shape, the right table list and
> zero rows in it — indistinguishable from a real backup until the day you try
> to restore from it. The script therefore **refuses** to write a zero-row
> export unless you pass `--allow-empty`. Do not reach for that flag to make an
> error go away; reach for it only on a genuinely empty database.

**What the artefact contains.** Every row of every table, owner-scoped, with
`formatVersion`, `exportedAt`, per-table `rowCounts`, and a `fieldTypes` map per
table. The field types are there because `BigInt` columns
(`batch_change.id`, `candidate_source_image.id`, `uploaded_image.byteSize`,
`.uploadedByteSize`) are encoded as **strings** — JSON has no bigint — and
`"12345"` would otherwise be ambiguous with a `String` id at restore time.
Dates are ISO-8601 UTC.

**What it does *not* contain: the screenshots.** Those are blobs, not rows
(ADR-0006). They are purged after 30 days regardless, so there is normally
nothing to preserve; `uploaded_image.blobPath` is exported, and a path whose
blob is gone answers 410 by design.

Two exports of an unchanged database diff clean — rows are ordered by primary
key. Keeping the last few weeks and diffing them is a cheap way to notice
something you did not do.

---

## 2. The weekly BACPAC (optional, and the better restore source)

A BACPAC is a native, self-contained schema + data package. It restores as a
whole database with one command, where the JSON export needs a person to
reconcile it. Take both if you take either — the JSON is the one you can read,
the BACPAC is the one you can restore fastest.

Portal: **SQL databases → `nextup` → Export**, target a blob container, and
supply the SQL admin login. Or:

```bash
az sql db export \
  --resource-group nextup-rg \
  --server <sql-nextup-xxxxxxxx> \
  --name nextup \
  --admin-user "$SQL_ADMIN_LOGIN" \
  --admin-password "$SQL_ADMIN_PASSWORD" \
  --storage-key-type StorageAccessKey \
  --storage-key "<key>" \
  --storage-uri "https://<account>.blob.core.windows.net/backups/nextup-2026-09-01.bacpac"
```

> ⚠ **Export runs against the live database and costs DTUs.** Basic is 5 DTU.
> Run it when you are not using the app.

---

## 3. Restoring

### 3.1 The rule that comes before every option

> ⚠ **Restore to a NEW database. Compare. Only then repoint.**
>
> Never restore over `nextup`. An in-place restore is irreversible and destroys
> the very evidence you need to work out what went wrong — and if your
> diagnosis was wrong, you have now lost both the damaged data and the good
> data. Restoring alongside costs a few pounds for a few hours and is always
> reversible.

### 3.2 Path A — PITR, if the damage is less than 7 days old

```bash
az sql db restore \
  --resource-group nextup-rg \
  --server <sql-nextup-xxxxxxxx> \
  --name nextup \
  --dest-name nextup-restored \
  --time "2026-08-30T14:00:00Z"
```

Pick a time **before** the damage. If you are not sure, pick earlier — you are
going to compare, not commit.

Then compare, from the query editor against `nextup-restored`:

```sql
SELECT 'title' t, COUNT(*) n FROM title
UNION ALL SELECT 'service_listing', COUNT(*) FROM service_listing
UNION ALL SELECT 'upload_batch',    COUNT(*) FROM upload_batch
UNION ALL SELECT 'suppression',     COUNT(*) FROM suppression;
```

against the same counts in the live database and in your most recent JSON
export. Three sources agreeing is the confirmation to act on.

### 3.3 Path B — BACPAC import, if the damage is older than 7 days

```bash
az sql db import \
  --resource-group nextup-rg \
  --server <sql-nextup-xxxxxxxx> \
  --name nextup-restored \
  --admin-user "$SQL_ADMIN_LOGIN" \
  --admin-password "$SQL_ADMIN_PASSWORD" \
  --storage-key-type StorageAccessKey \
  --storage-key "<key>" \
  --storage-uri "https://<account>.blob.core.windows.net/backups/nextup-2026-09-01.bacpac"
```

Create the target database first if the tier needs pinning; imports default to
a tier that may exceed the budget.

### 3.4 Path C — the JSON export

Use when you need **part** of the data — a table, or a handful of rows — rather
than a whole database. `tables.<name>.rows` is plain JSON; `fieldTypes` tells
you which strings to coerce back to `BigInt` and which `DateTime` values to
parse. There is deliberately **no import script**: a one-command "restore my
data" against a live database is a delete-and-replace with a friendly name on
it, and this application's whole posture is that nothing deletes. Reconciling
by hand is slower on purpose.

### 3.5 Repointing, once you are satisfied

The application reaches the database through `DATABASE_URL`, which is
credential-free and names the database (`infra/aca.bicep`). Either rename the
databases on the server so the good one is `nextup`, or change
`sqlDatabaseName` and redeploy. **Grant the managed identity on the new
database before you repoint** — `docs/runbooks/database-access.md` §1;
`CREATE USER … FROM EXTERNAL PROVIDER` is per-database, and a restored copy
does not inherit it. Skipping it presents as the container being *Healthy*
while every request that touches data fails.

---

## 4. Escalation — long-term retention

Azure SQL **long-term retention** (weekly/monthly/yearly backups kept for up to
10 years) is a policy on the database, not a job we run, so it does not engage
invariant 5. It is not enabled: it adds storage cost for a protection the
manual export already gives, and this is a single-owner application.

Enable it if the manual habit lapses — a backup you have to remember is worth
less than one you do not.

```bash
az sql db ltr-policy set \
  --resource-group nextup-rg --server <sql-nextup-xxxxxxxx> --name nextup \
  --weekly-retention P4W --monthly-retention P12M --yearly-retention P5Y --week-of-year 1
```

---

## 5. What must never be added here

- **A scheduler.** No SQL Agent job, no Elastic Job, no `schedule:` workflow, no
  timer in `apps/api/src/**`. `T-CI-005` enforces the three-process ceiling.
- **A delete path.** The export reads and only reads; §3.4 is manual for the
  same reason.
- **An automatic import.** See §3.4.
- **The artefact, committed.** See §1.
