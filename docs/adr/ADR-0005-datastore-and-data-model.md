# ADR-0005 — Datastore and data model

> ## ⚠ REVISION 3 — 2026-08-10T22:40 — **the owner selected the cheaper relational store. Azure Database for PostgreSQL Flexible Server → Azure SQL Database, Basic.**
>
> **Revisions 2 (PostgreSQL) and 1 (Cosmos DB) are retained verbatim
> below.** Nothing is deleted. This revision changes the *product* only:
> the store is still relational, still always-warm, still enforces the
> product's invariants as real database constraints, and the migration
> tooling and ORM are unchanged in principle. What changed is *which*
> managed relational engine, and it changed because the owner reacted to
> the published cost table.
>
> ### R3.0 What changed in the inputs
>
> Revision 2 published a per-component cost table (`architecture.md`
> §Cost summary) with the PostgreSQL design at **~$30/month** and three
> named leaner variants. The table was, per `A41`, the mechanism for
> closing `OQ-026`. **At `A40` the owner answered "2" — Variant A, the
> "middle" ~$11–13/month option** — which this ADR published itself. That
> answer **closes `OQ-026`** and selects exactly three changes; the one
> this ADR owns is:
>
> > *"**Azure SQL Database Basic** (5 DTU, 2 GB) instead of PostgreSQL
> > B1ms — saves ~$10. Still relational, still always-warm, still
> > constraint-enforcing, still 7-day PITR. You lose the best-documented
> > ORM path (`Prisma + PostgreSQL`), `pg_trgm` search for the removed
> > view, and the fastest CI container. This is a real option and the
> > smallest sacrifice on the list."*
>
> The other two Variant A changes (registry → ghcr.io; compute →
> 0.25 vCPU / 0.5 GiB) are owned by **ADR-0003 Revision 3**.
>
> ### R3.1 What is retained, and is non-negotiable
>
> The whole reason Revision 2 left Cosmos survives this change intact:
>
> | Property (from Revision 2) | Survives on Azure SQL Basic? |
> |---|---|
> | Always-warm, no auto-pause on the value loop | **YES.** Basic (DTU model) does not auto-pause. `RSK-023` stays closed via ADR-0003. |
> | The three highest-risk invariants are **database constraints**, not tests | **YES.** Azure SQL supports **filtered unique indexes** (`CREATE UNIQUE INDEX … WHERE`), which is exactly how I-1, I-9 and I-2 are enforced. Each is re-verified in §16.4 / data-model §16. |
> | Batch close is **one transaction** | **YES.** No operation cap; `BEGIN…COMMIT` is unchanged. |
> | Referential integrity, real migrations, a staging environment | **YES.** Foreign keys, Prisma Migrate (`sqlserver` provider), and a staging database (ADR-0003 R3) all remain. |
> | Secretless database credential | **PREFERRED, but now conditional** — see R3.4. |
>
> ### R3.2 What is given up — named plainly, not glossed
>
> | Give-up | Consequence | Where it is handled |
> |---|---|---|
> | **The best-documented ORM path.** `Prisma + PostgreSQL` is the single most-travelled relational stack for an autonomous agent; `Prisma + Azure SQL / SQL Server` is GA but thinner. | A direct `NFR-004` (autonomous-implementability) concern. | **New risk `RSK-031`**, with a real mitigation (§R3.3). |
> | **`pg_trgm` fuzzy search** for the removed view (`NFR-018`). | Azure SQL Basic has no trigram index. Substring search becomes `LIKE N'%…%'` with a case-insensitive collation — **exact substring only, no typo tolerance**, and not index-backed. | data-model §16.6. Full-Text Search is the named escalation. |
> | **The fast, reliable CI container.** `postgres:16-alpine` (~2 s, a few hundred MB) becomes `mcr.microsoft.com/mssql/server:2022-latest` (~2 GB RAM, `ACCEPT_EULA`, a ~10–30 s health wait). | A real `NFR-003` cost — CI is the implementer's only feedback loop. | Confirmed workable in GitHub Actions with an exact service + wait config: `specs/testing.md` §3.3. |
> | **35-day PITR → 7-day PITR** (Azure SQL Basic maximum). | For a store that by design **never hard-deletes** (`REQ-028`) and is irreplaceable, the recoverable window shrinks 5×. A corruption or bad migration not noticed within 7 days is unrecoverable by PITR. | §R3.5; `OQ-025` **re-widens**; the user-controlled export (`TASK-131`) is recommended to be pulled forward. |
>
> ### R3.3 The ORM decision — Prisma STANDS, argued not assumed
>
> The instruction was to decide honestly whether Prisma remains right, or
> whether Drizzle or `mssql`+Kysely is better documented for SQL Server.
> **Decision: keep Prisma.** Reasoning, on the same `NFR-004` criterion
> that drove every stack choice in this project:
>
> - **Training-data mass.** Prisma is the most-represented TypeScript ORM
>   by a wide margin, and its `sqlserver` provider is GA. Drizzle's
>   SQL Server (`mssql`) dialect is comparatively new and thinly
>   travelled; Kysely's `MssqlDialect` is solid but far less represented
>   than Prisma overall. Switching ORM to chase a marginally better
>   SQL-Server-specific trail would trade a large, well-known surface for
>   a small, obscure one — the wrong `NFR-004` bet.
> - **The destructive-migration gate is load-bearing.** `T-MIG-001`
>   (`TASK-144`) greps `prisma/migrations/**` for destructive DDL and is
>   the single most valuable test protecting `REQ-028`. Prisma Migrate
>   produces exactly the reviewable, greppable SQL artefact that test
>   depends on. Re-inventing it under another tool is pure cost.
> - **The SQL-Server-specific bits live in raw migration SQL anyway.**
>   The DDL in data-model §16 is normative and the Prisma schema is
>   generated to match; the filtered unique indexes and `CHECK`
>   constraints are applied as raw SQL inside Prisma migrations, so
>   Prisma's thinner SQL-Server modelling of those features is not on the
>   critical path.
>
> **Mitigation for the residual (`RSK-031`):** pin
> `provider = "sqlserver"` and a Prisma version in `package.json`; name
> the exact connection-string form (§R3.4); and require a **smoke
> migration in M0** — apply the full schema plus the three filtered
> indexes against a real Azure SQL Basic database and assert all three
> constraints reject a duplicate — **before any feature work begins**.
> `RSK-031` is closed only when that smoke migration is green.
>
> ### R3.4 Database authentication — prefer managed identity, with a defined fallback
>
> Revision 2 reached PostgreSQL with an **Entra token** from the managed
> identity (secretless), and named token refresh as `TASK-141`. Azure SQL
> **also** supports Entra / managed-identity auth, so the *preference* is
> unchanged: **keep the database credential secretless.**
>
> The wrinkle is `NFR-004`-shaped, not security-shaped: **Prisma's
> `sqlserver` connector does not have well-established managed-identity /
> access-token support.** Its first-class path is SQL authentication
> (user + password). This is a genuine open question, and it is decided
> the honest way — by the M0 smoke migration, not by assumption:
>
> - **Preferred:** the app acquires an Entra access token via
>   `@azure/identity` and presents it to Azure SQL; **no credential is
>   stored.** `TASK-141` is **reshaped** from "Postgres token refresh" to
>   "prove and, if viable, implement Prisma + Azure SQL managed-identity
>   token auth (acquire + refresh) in M0".
> - **Defined fallback, if Prisma + MI proves unworkable in M0:** SQL
>   authentication with the password held in **Key Vault** and surfaced
>   as a **Key Vault-referenced Container Apps secret** — never in source,
>   never in plain config. This reintroduces a database credential, but
>   it is **not a silent time bomb**: a SQL login password does not
>   auto-expire (unlike a PAT), and it is read via managed identity rather
>   than pasted into config. The connection-string form is then:
>   `sqlserver://<server>.database.windows.net:1433;database=nextup;user=nextup_app;password=<kv-ref>;encrypt=true;trustServerCertificate=false;connectionLimit=5`.
>
> Either way the **registry** credential (the ghcr.io PAT, ADR-0003 R3)
> returns and *does* expire quietly — that one is unavoidable under
> Variant A and is named there. Secret count under Variant A: **TMDB key
> + ghcr PAT** (+ the Azure SQL password **only if** the MI path fails in
> M0) = **2, possibly 3**, versus 1 in the Revision 2 design. Stated, not
> hidden.
>
> ### R3.5 Backup — 7-day PITR, and the honest consequence
>
> Azure SQL Basic's maximum point-in-time-restore retention is **7 days**
> (PostgreSQL B1ms offered up to 35). `REQ-028` makes the store
> append-mostly and irreplaceable: nothing is ever hard-deleted and there
> is no TTL anywhere. A 7-day window means **a corruption or a bad
> migration that is not noticed within a week cannot be recovered by
> PITR** — a real reduction in the safety net for exactly the data that
> can never be regenerated.
>
> Responses, in order of preference:
> 1. **The user-controlled export (`TASK-131`, `OQ-025`) is now more
>    important, not less.** Under Revision 2, 35-day PITR let `OQ-025`
>    narrow toward closing; on 7-day PITR it **re-widens**, and the export
>    is recommended for early promotion rather than deferred.
> 2. **Long-term retention (LTR)** is available on Azure SQL (weekly
>    backups, small extra cost) and is the escalation if 7 days proves too
>    thin. Not bought now — it is a Bicep property, decided on evidence.
>
> ### R3.6 DECISION (Revision 3)
>
> **We will use Azure SQL Database, Basic (5 DTU, 2 GB, single database
> `nextup`), with a separate auto-pausing serverless staging database
> `nextup_staging`.** Access is through **Prisma** (`sqlserver` provider)
> from the single owner-scoped repository module, unchanged in shape from
> Revision 2. Authentication prefers managed identity (secretless) with
> the Key-Vault SQL-auth fallback of §R3.4, resolved by the M0 smoke
> migration. Everything carried forward unchanged from Revision 2 —
> `owner_id` first, the three invariants as constraints, one-transaction
> close, no hard delete except creates-only undo, full provenance,
> `tmdb_fetched_at` — stays carried forward. The full physical schema is
> **data-model §16 (Azure SQL, authoritative)**, which supersedes §15's
> PostgreSQL-specific physical detail while keeping §15 visible.
>
> ### R3.7 Consequences (Revision 3)
>
> **Positive**
> - **~$10/month saved** on the largest single line; total falls from
>   ~$30 to ~$11–13 (the owner's selected figure).
> - Everything that made the relational move worth it — constraints,
>   one-transaction close, real migrations, staging — is retained.
>
> **Negative — named, not hidden**
> - Prisma + SQL Server is a less-travelled path (`RSK-031`).
> - `LIKE` search loses `pg_trgm`'s fuzzy/typo tolerance (data-model §16.6).
> - The CI container is heavier and slower (`NFR-003` cost).
> - PITR halves-and-more, 35 → 7 days, for irreplaceable data (§R3.5).
> - The secretless-database property is now conditional on an M0 result.
>
> ### R3.8 Reversal (Revision 3)
>
> | | |
> |---|---|
> | One-way door? | **No.** Prisma abstracts the dialect; the DDL is standard. The most likely reversal is *back up* to PostgreSQL B1ms if the owner later wants `pg_trgm` or the faster CI back — a provider change plus dialect fixes, no data loss at this size. |
> | Cost to reverse | Low. Tier changes are a Bicep property; provider changes are a Prisma edit plus the raw-SQL dialect deltas already isolated in migrations. |
> | Trigger to revisit | (a) Prisma + Azure SQL proves too painful in M0 → escalate ORM or store; (b) removed-view search quality becomes a real complaint → Full-Text Search or back to `pg_trgm`; (c) 7-day PITR judged too thin → LTR or export-first. |
>
> ⚠ **Pricing provenance:** Azure SQL Basic (~$4.9), the serverless
> staging floor (~$0.10–0.50 when auto-paused) and the ~$10 saving are
> Azure list figures recalled from model knowledge and are **unverified**
> (`RSK-029`). `TASK-010` re-verifies them.

> ## ⚠ REVISION 2 — 2026-08-10T21:45 — **the datastore changed. Cosmos DB → Azure Database for PostgreSQL Flexible Server.**
>
> **Revision 1 is retained verbatim below.** Its Cosmos-specific
> mechanics (partition key, `TransactionalBatch`, document types) are
> superseded; its *domain* reasoning — suppression keyed on work identity,
> nothing ever hard-deleted, provenance sufficient for `REQ-075` — is
> store-agnostic, survived the re-argument intact, and is carried forward
> unchanged.
>
> ### R2.0 What changed in the inputs
>
> Constraint change **A41 / CC-002** relaxed `NFR-012` **system-wide**
> from a hard MUST to a SHOULD, with **quality and reliability outranking
> raw cost**. Revision 1's decision turned on a single objection to the
> relational option, and that objection was an artefact of a *free offer*:
>
> > *"**Auto-pause is disqualifying for the value loop.** The free offer
> > relies on serverless auto-pause to stay within its vCore-second
> > grant; a resume from paused takes tens of seconds."*
>
> A paid database tier does not auto-pause. The objection does not
> survive the constraint change — **it was never a property of relational
> stores, only of the free tier of one**. Revision 1 said as much in its
> own decision paragraph: *"Azure SQL is the better modelling substrate
> and the better fit for `NFR-004`, and this ADR concedes that plainly."*
>
> ### R2.1 The honest re-argument — what actually held Cosmos in place
>
> Revision 1 rested on four claims. Three are now dead or inverted.
>
> | # | Revision 1 claim | Status after A41 |
> |---|---|---|
> | 1 | **$0 forever, no time limit** | **DEAD.** Cost is no longer a gate, and `NFR-012` explicitly permits "a real managed database rather than contorting the data model into a free tier". |
> | 2 | **No auto-pause — always warm, no resume on the value loop** | **DEAD as a differentiator.** Any paid tier is always warm. This was the *deciding* argument and it was purchased entirely with the free tier's constraints. |
> | 3 | **The domain is genuinely document-shaped** | **WEAK, and partly inverted** — see R2.2. |
> | 4 | **`TransactionalBatch` gives ACID within the owner's partition** | **INVERTED** — see R2.3. |
>
> Against those, Revision 1 recorded two give-ups in its own *Negative
> consequences* section, and **both are still live, with nothing left
> outweighing them**:
>
> > *"**No schema, no constraints, no referential integrity.** … here it
> > is an application invariant that must be asserted by tests.
> > **This is a real give-up and it is the main cost of this
> > decision.**"*
>
> > *"**Cosmos document modelling is less represented in training data
> > than SQL + ORM code**, which is a direct tension with `NFR-004`."*
>
> A decision whose stated main cost is unmitigated and whose deciding
> benefit has been repealed is not a decision that stands.
>
> ### R2.2 Was the document model shaped by the free tier? Partly — and where it was, relational expresses it better
>
> The instruction to this revision was to check whether the document
> model was contorted to fit free-tier limits. Honestly assessed:
>
> - **Embedded `listings[]`: NOT a free-tier artefact.** It was argued on
>   single-document atomicity, and that argument is real. But relational
>   gives the same guarantee *more* naturally: a `title` + `listing`
>   update is one transaction, with no denormalisation and no derived-field
>   drift risk (Revision 1's `I-4` invariant exists only because
>   `title.state` is a denormalised roll-up of the embedded array; in SQL
>   it can be a **generated/derived read** or a constraint-checked column,
>   and the drift class shrinks).
> - **`provenance` as three JSON arrays on the batch document: a document-store
>   accommodation.** Relationally this is one `batch_change` table with a
>   `kind` discriminator, and `REQ-075`'s refusal enumeration becomes a
>   `GROUP BY` instead of array juggling. It is also *queryable* — "what
>   touched this title, ever" is currently unanswerable without scanning
>   every batch document.
> - **Suppression as `id = supp:<workIdentity>`: a key-uniqueness trick.**
>   It works, and it was clever. Relationally it is a `UNIQUE
>   (owner_id, work_identity)` constraint — the same guarantee, stated as
>   what it is, and legible to a reviewer who does not know Cosmos id
>   semantics.
> - **Invariant `I-1` ("at most one non-removed, visible `Title` per
>   `(ownerId, workIdentity)`") is a partial unique index in any
>   relational store.** It is currently a test and a hope. This is the
>   single most valuable thing the move buys: **the product's highest-risk
>   silent-failure class becomes a constraint violation instead of a
>   quiet duplicate.**
>
> ### R2.3 The batch-atomicity machinery is a Cosmos workaround, and it can now be deleted
>
> Revision 1 could not wrap batch close in a transaction because
> **`TransactionalBatch` caps at 100 operations / 2 MB** and a first
> import creates several hundred titles. So it invented the
> visibility protocol: `visible: false` → chunked idempotent writes → one
> atomic status flip → a follow-up pass to flip visibility, **plus** a
> query predicate that every list query must remember (`visible = true OR
> createdByBatchId IN (appliedBatchIds)`). Revision 1 flagged the hazard
> itself: *"an implementer who forgets the `visible`/`status` filter on a
> query will leak an in-flight batch into the combined list — a silent
> violation of REQ-005."*
>
> PostgreSQL has no 100-operation limit. A batch close of a few hundred
> rows is **one `BEGIN … COMMIT`**. `REQ-005`/`REQ-006` stop being a
> protocol an implementer must not forget and become the database's
> default behaviour.
>
> **The `visible` column is retained anyway** (see R2.6) — but demoted
> from load-bearing correctness machinery to a belt-and-braces flag,
> and the "or its batch is applied" clause of the query predicate is
> **deleted**. That is a net reduction in moving parts, which is the
> `A41` right-sizing test applied honestly: *this change removes
> complexity, it does not add it.*
>
> ### R2.4 Which relational store — and why not the cheaper one
>
> Three candidates, all always-warm, all managed, all with
> point-in-time restore:
>
> | Option | ~$/month | Verdict |
> |---|---|---|
> | **Azure Database for PostgreSQL Flexible Server, B1ms burstable, 32 GiB** | **~$15** | **SELECTED** |
> | Azure SQL Database, Basic (5 DTU, 2 GB) | ~$5 | Rejected — see below. **Named as the cost-down lever.** |
> | Azure SQL Database, GP serverless with auto-pause **disabled** | ~$190 | Rejected. Billing a 0.5-vCore floor continuously is an order of magnitude more money for no benefit at this size. |
>
> Azure SQL Basic is cheaper and technically adequate — 2 GB is enormous
> for a few thousand small rows that will never be deleted. It is
> rejected on the **same criterion that motivated leaving Cosmos in the
> first place**, which is the only intellectually consistent way to
> decide it:
>
> - **`NFR-004` / training-data mass.** The implementer is an autonomous
>   agent writing TypeScript. `Node + Prisma + PostgreSQL` is the
>   single most-represented relational stack in that ecosystem by a wide
>   margin. Prisma's SQL Server provider is GA but comparatively thinly
>   travelled, with its own quirks. Choosing the less-documented
>   relational store would undercut the whole reason for the move.
> - **`NFR-003` / CI reliability.** `postgres:16-alpine` is the most
>   common CI service container in existence: a few hundred MB, ready in
>   seconds, deterministic. It replaces the **Cosmos DB Linux emulator**,
>   which is heavyweight, slow to become healthy, and a well-known source
>   of flaky CI — and CI is *load-bearing* here (`NFR-003`). The
>   `mssql/server` image is heavier and slower than Postgres. **This is a
>   reliability win, not a preference.**
> - **`NFR-018` / removed-view search.** `pg_trgm` and `tsvector` give a
>   real, indexable substring/fuzzy search over a monotonically growing
>   removed view. Revision 1's `CONTAINS(LOWER(...))` is a scan whose cost
>   was bounded only by paging.
> - **`jsonb` where a document genuinely helps** — `extraction_candidate.match_candidates`,
>   `bounding_boxes`, `extraction_stats` stay JSON. We keep the document
>   model exactly where it earns its place and use columns and
>   constraints everywhere it does not.
>
> The ~$10/month difference is real and is **published as a lever** in
> `architecture.md` §Cost summary, so the owner can take the money back
> and accept a less-travelled ORM path if they prefer.
>
> ### R2.5 The counter-arguments, stated fairly
>
> 1. **Churn.** This invalidates a substantial part of
>    `specs/data-model.md` and touches `api.md`, `testing.md`,
>    `security.md` and two diagrams. That is real work.
>    **But: no code exists yet.** Document churn now is the cheapest this
>    change will ever be; the same change after implementation is a
>    migration plus a query-layer rewrite. Deciding to keep Cosmos to
>    avoid editing documents would be optimising the wrong budget.
> 2. **More tables ≠ more moving parts?** Eight tables instead of six
>    document types, in one database, behind one repository module and
>    one ORM. The *deployed* resource count is unchanged (one managed
>    data store), and R2.3 deletes a bespoke consistency protocol. Net
>    complexity is down.
> 3. **A schema means migrations.** True, and it is a *feature* here:
>    Prisma Migrate produces a reviewable, testable, replayable artefact,
>    which Revision 1's §13 ("Zod is the schema", hand-run backfill
>    scripts) explicitly did not have.
> 4. **Cost goes from $0 to ~$15/month.** Named, published, and the
>    lever back to ~$5 (Azure SQL Basic) or ~$0 (Cosmos free tier) is in
>    the cost table.
> 5. **Burstable B1ms can throttle under sustained CPU.** One user, a few
>    hundred rows, one bulk import. If it ever throttles, the fix is a
>    tier change with no schema impact.
>
> ### R2.6 DECISION (Revision 2)
>
> **We will use Azure Database for PostgreSQL Flexible Server —
> B1ms burstable, 32 GiB storage, single zone, no HA replica, no read
> replica, Entra ID (managed identity) authentication, 35-day
> point-in-time restore — with two databases on the one server:
> `nextup` (production) and `nextup_staging`.**
>
> Access is through **Prisma** from a single repository module. Every
> repository function keeps `ownerId` as its **first positional
> parameter** and every query filters on `owner_id` (`NFR-008`) — the
> discipline Revision 1 got from the partition key is now an explicit,
> testable convention plus a row-level `owner_id` index.
>
> Carried forward **unchanged** from Revision 1:
> `workIdentity` as the single opaque identity key (ADR-0007 / SD-01,
> SD-05, SD-06); suppression evaluated against the **work**, never the
> row; three states kept structurally distinct; nothing ever
> hard-deleted except creates-only undo (SD-03); full reversal provenance
> (`REQ-068`) sufficient for `REQ-075`'s enumerated refusal; `tmdb_fetched_at`
> as a modelled attribute for `NFR-014`/`REQ-076`.
>
> **`SD-04` is restated in relational terms and is *strengthened*:** there
> is no TTL, no `pg_cron`, no scheduled job, no partition-drop policy and
> no `DELETE` statement anywhere in the codebase except the creates-only
> undo path. `T-INV-013` is repointed from "no Cosmos TTL" to
> "no scheduled deletion mechanism exists in the database or the
> infrastructure, and `DELETE` appears in exactly one module".
>
> ### R2.7 Consequences (Revision 2)
>
> **Positive**
> - **`I-1` becomes a partial unique index**, not a test:
>   `UNIQUE (owner_id, work_identity) WHERE state <> 'removed' AND visible`.
>   The product's highest-risk silent defect is now a constraint
>   violation. `I-2` likewise (`UNIQUE (title_id, service)`), and
>   suppression uniqueness likewise.
> - **Batch close is one transaction.** The chunked-write + visibility
>   protocol and its easily-forgotten query predicate are gone
>   (`REQ-005`, `REQ-006`).
> - Referential integrity by foreign key; provenance becomes queryable.
> - Migrations are a first-class reviewable artefact (`NFR-003`).
> - Faster, more reliable CI (`postgres:16-alpine` in place of the Cosmos
>   emulator), and local development that matches production exactly.
> - `NFR-004` satisfied rather than conceded — Revision 1's one
>   acknowledged deviation from it is retired.
> - **35-day point-in-time restore** materially improves the backup story
>   for a store that by design never deletes anything (`OQ-025` narrows;
>   it does not close — PITR is not a user-controlled export).
>
> **Negative — named, not hidden**
> - **~$15/month where there was $0.** The largest single line in the
>   cost table.
> - **Document churn:** `specs/data-model.md` gains a full relational
>   chapter that supersedes its physical-layout sections; `api.md`'s
>   cursor definition changes; `testing.md`'s store fixture changes.
> - **A connection now exists.** Postgres needs a connection pool and has
>   a connection *limit* (B1ms is small). A serverless-style store had
>   neither. One pool, `max = 5`, in one place.
> - **Entra-token authentication to Postgres needs periodic token
>   refresh** in the connection factory — a small, real piece of code
>   that managed-identity-to-Cosmos did not require. It must be written
>   once and tested; a naive implementation works for an hour and then
>   fails, which is a nasty shape. Named as `TASK-141`.
> - **Burstable tier**: no SLA-grade performance guarantee. Correct for
>   one user; wrong the moment that stops being true.
> - **The database is a single point of failure with no HA replica.**
>   Deliberate. Zone-redundant HA roughly doubles the price to protect a
>   single-user watchlist against an event that would be a few hours of
>   inconvenience.
>
> ### R2.8 Reversal (Revision 2)
>
> | | |
> |---|---|
> | One-way door? | **No.** Standard PostgreSQL. `pg_dump`/`pg_restore` moves it anywhere, including to a container or to another cloud. This is *less* locked-in than Revision 1. |
> | Cost to reverse | Low-to-moderate. Tier changes are a Bicep property. Moving to Azure SQL is a Prisma provider change plus dialect fixes. Moving *back* to Cosmos would be a rewrite and is not contemplated. |
> | Trigger to revisit | (a) the owner wants the ~$10/month back → Azure SQL Basic; (b) sustained CPU throttling on B1ms → next tier up; (c) the product stops being single-user at a scale where a burstable tier is wrong. |
>
> ⚠ **Pricing provenance:** B1ms compute (~$12.4), 32 GiB storage
> (~$3.3), Azure SQL Basic (~$4.9) are Azure list prices recalled from
> model knowledge and are **unverified** — web retrieval is unavailable
> to this role. **`TASK-010` is extended** to re-verify PostgreSQL
> Flexible Server B1ms pricing, storage and backup-retention charges, and
> regional availability, before the Bicep is finalised.

---

# ADR-0005 (Revision 1, superseded and retained verbatim) — Azure Cosmos DB for NoSQL, free tier, one logical partition per owner

| | |
|---|---|
| **Status** | **SUPERSEDED by Revision 2 above** (was: Accepted) |
| **Date** | 2026-08-10 |
| **Deciders** | solution-architect (phase 7), autonomous |
| **Forced by** | **NFR-012**, NFR-001, NFR-008, NFR-014, NFR-018, REQ-005, REQ-006, REQ-024…REQ-028, REQ-036, REQ-041, REQ-062…REQ-068, REQ-070…REQ-076 |
| **Recommends on** | OQ-013, **OQ-015** (see also ADR-0007) |

## Context

The data model carries most of nextup's hard-won semantics, and several
of them fail *silently* if the store is modelled naively. The store must
support, as first-class properties rather than conventions:

1. **Nothing is ever hard-deleted** (REQ-028) — no purge, no expiry, no
   retention cutoff over any `Title` or `ServiceListing`, ever. The
   removed view grows monotonically forever (REQ-062) and must stay
   searchable at any size (NFR-018).
2. **Three distinct title states** — `active`, `removed`, `suppressed` —
   which "MUST NOT be collapsed into one flag in the data model or the
   UI" (`requirements.md` §1.7).
3. **Suppression is keyed on canonical work identity, not on a row**
   (REQ-071). This is the single most likely place in the product for a
   feature to appear to work and then quietly stop: under REQ-065 a
   reappearing work is created as a **brand-new row**, so a row-scoped
   flag is bypassed on the very next capture.
4. **A batch is transactional** (REQ-005, REQ-006): no title or listing
   may exist in the combined list until the owner submits and closes the
   batch, and reconciliation happens exactly once against the whole
   batch.
5. **Reversal provenance sufficient to undo a batch** (REQ-068): what it
   created, what it modified *with the pre-batch value of each modified
   attribute*, and what it transitioned to `removed`. v1 undo is
   creates-only (REQ-067) and a mixed batch is refused **with a full
   enumeration of what it touched** (REQ-075) — so the provenance is
   required in full even though the undo is restricted.
6. **TMDB metadata carries an age** and must be refreshed on access past
   6 months (NFR-014, REQ-076), which means a fetched-at timestamp is a
   modelled attribute, not a cache implementation detail.
7. **Owner scoping from day one** (NFR-001, NFR-008) for a future of
   fewer than 20 allow-listed identities.
8. **$0** (NFR-012), with **no cold resume on the value loop** — the
   store is read on the one path that must feel fast (ADR-0003).

Volume is tiny and will stay tiny: a few hundred `Title` documents, at
most two `ServiceListing`s each, a handful of batches a month, growing to
low thousands of documents over years.

## Options considered

### Option A — Azure Cosmos DB for NoSQL, free tier

| | |
|---|---|
| Summary | Document store. One container, partition key `/ownerId`, documents discriminated by a `type` field. Free tier: 1,000 RU/s provisioned throughput and 25 GB storage, **free forever**, one account per subscription. |
| Pros | **$0 forever, with no time limit and no auto-pause** — the store is always warm, so the value loop never pays a database resume. `TransactionalBatch` gives ACID across documents **within one logical partition**, and because every owner's data is one logical partition, batch close is genuinely atomic. The data is naturally document-shaped: a combined-list row is one document. First-party SDK, managed identity, RBAC. Free-tier capacity (1,000 RU/s, 25 GB) exceeds projected need by roughly three orders of magnitude. |
| Cons | Not relational: no joins across documents, no foreign keys, no schema enforcement — invariants are ours to maintain. Less represented in training data than SQL/ORM code, and document modelling is where an agent is most likely to produce something subtly wrong (NFR-004 tension). Free tier must be enabled **at account creation** and is limited to one account per subscription. `TransactionalBatch` caps at 100 operations / 2 MB. |
| Cost | **$0/month.** Fallback if the free tier is unavailable: Cosmos **serverless**, ~$0.05/month at this volume, consumption-billed. |
| Reversal cost | Moderate — a document→relational migration of a few thousand small documents is a script, but every query is rewritten. |

### Option B — Azure SQL Database, free offer (General Purpose serverless)

| | |
|---|---|
| Summary | Relational. Free offer: a monthly grant of serverless vCore-seconds plus 32 GB storage, free forever, with auto-pause. |
| Pros | **The most agent-friendly option by a distance** (NFR-004): relational modelling, SQL, EF Core or Prisma, migrations, referential integrity, real transactions across everything, and `CHECK`/unique constraints that can enforce the model's invariants — including "at most one non-removed Title per (owner, workIdentity)" as a filtered unique index, which is exactly the kind of guarantee that otherwise fails silently. Schema migrations are a first-class, testable artifact. |
| Cons | **Auto-pause is disqualifying for the value loop.** The free offer relies on serverless auto-pause to stay within its vCore-second grant; a resume from paused takes tens of seconds. The one path that must feel fast (`J-1`, `SUC-001`) would intermittently stall — and stacked on top of ADR-0003's container cold start, the worst case is a genuinely bad first impression. Raising the auto-pause delay to avoid it burns the grant faster. And the behaviour on exhausting the monthly grant (the database is paused for the remainder of the month, or billing begins) is a **cliff**, not a gradient. |
| Cost | $0 within the grant; a hard behavioural cliff at the boundary. |
| Reversal cost | Moderate. |

### Option C — Azure Table Storage / Cosmos DB Table API

| | |
|---|---|
| Summary | Key-value/wide-column store on top of Azure Storage. |
| Pros | Almost free (cents), always warm, trivially simple, and the account already exists for screenshots (ADR-0006). |
| Cons | No secondary indexes, no rich queries, no transactions beyond a single partition batch of limited scope, no aggregation. The removed view's search-and-filter obligation (REQ-064, **NFR-018 — must stay usable at any size**) would have to be built by hand. Modelling this domain on Table Storage is niche work with thin documentation — the direct opposite of NFR-004. |
| Cost | ~$0.02/month. |
| Reversal cost | Moderate. |

### Option D — PostgreSQL Flexible Server

Rejected: the free offer is a **12-month trial**, after which the
cheapest burstable tier is a fixed ~$13/month charge. That is a fixed
monthly commitment and breaches NFR-012 outright. Technically the best
relational fit; economically not available.

### Option E — SQLite on an Azure Files volume mounted into the container

Rejected: SQLite over SMB has well-documented locking and corruption
failure modes, and it ties the data's durability to the compute's
storage mount on a **scale-to-zero** container (ADR-0003). Cheap and
wrong.

## Decision

**We will use Azure Cosmos DB for NoSQL on the free tier: one database,
one container, partition key `/ownerId`, with document types
discriminated by a `type` field.**

The trade against Option B was decided by `ADR-0003`'s value-loop
constraint. Azure SQL is the better modelling substrate and the better
fit for `NFR-004`, and this ADR concedes that plainly — but its free
offer is built on auto-pause, and a tens-of-seconds database resume on
the one screen that must feel fast is a direct attack on `SUC-001`, the
product's primary success signal. Cosmos is always warm, has no monthly
grant cliff, and — decisively — the domain is genuinely document-shaped:
a combined-list row *is* a document, and every owner's entire dataset
fits in one logical partition, which is what makes `TransactionalBatch`
give us real atomicity for batch close (REQ-005/REQ-006).

### Container and partition design

| | |
|---|---|
| Database | `nextup` |
| Container | `owner-data` |
| Partition key | `/ownerId` |
| Throughput | Free-tier 1,000 RU/s provisioned, shared |
| Consistency | Session (default) — single-writer, single-reader; strong is unnecessary and costs RU |

**All of one owner's data lives in one logical partition.** With fewer
than 20 owners (NFR-001) and a few thousand small documents each, this is
far inside the 20 GB / 10,000 RU-per-partition limits, and it buys the
single most valuable property available: cross-document ACID transactions
for batch close.

### Document types

| `type` | id | Purpose |
|---|---|---|
| `title` | ULID | One canonical work as one combined-list row. **Embeds its `ServiceListing`s.** |
| `suppression` | `supp:<workIdentity>` | One suppressed work. Keyed on identity by construction. |
| `uploadBatch` | ULID | One upload event, its mode, its service, its status, and its reversal provenance. |
| `uploadedImage` | ULID | One screenshot: blob reference, format, `uploadedAt`, `retainUntil`. |
| `extractionCandidate` | ULID | One extracted candidate: raw text, source image, match result, review disposition. |
| `serviceState` | `svcstate:<service>` | Per-service last-completed-batch date, for REQ-039 freshness. |

### `Title` — the central document

```jsonc
{
  "id": "01J...ULID",
  "type": "title",
  "ownerId": "own_...",                 // NFR-008, NFR-001
  "workIdentity": "tmdb:movie:438631",  // canonical identity — see ADR-0007
  "state": "active",                    // active | removed   (suppressed is NOT here)
  "createdByBatchId": "01J...",
  "visible": true,                      // false until its creating batch reaches `applied`
  "listings": [                         // embedded ServiceListings — REQ-025
    {
      "listingId": "01J...",
      "service": "netflix",
      "state": "active",                // active | removed
      "dateAdded": "2026-08-10",        // REQ-030 — capture date, never read from the image
      "dateAddedEdited": false,         // REQ-059/060 (v1.1), modelled now
      "removedAt": null,                // REQ-062 — per-listing removal date
      "createdByBatchId": "01J..."
    }
  ],
  "tmdb": {                             // REQ-029
    "tmdbId": 438631, "mediaType": "movie", "name": "Dune",
    "releaseYear": 2021, "runtimeMinutes": 155,
    "genres": ["Science Fiction", "Adventure"],
    "posterPath": "/d5NXS...jpg",
    "fetchedAt": "2026-08-10T19:00:00Z" // NFR-014 / REQ-076 age test
  },
  "sortDateAdded": "2026-08-10",        // REQ-036 — derived: earliest dateAdded over non-removed listings
  "_ts": 0
}
```

**Why listings are embedded rather than separate documents.** A title
holds at most two listings in v1 (nine at full vision), the combined-list
row needs all of them together, and every mutation that touches a listing
also touches its title's derived `state` and `sortDateAdded`. Embedding
makes those updates a single-document atomic write — which removes an
entire class of "title says active, listing says removed" inconsistency
that no test would reliably catch. Listings keep their own stable
`listingId` so `UploadBatch` provenance can reference them precisely
(REQ-068).

### The three states, kept structurally distinct

`requirements.md` §1.7 forbids collapsing the three states into one flag.
The model enforces this by putting them in **different places**, so
collapsing them is not merely discouraged, it is awkward:

| State | Where it lives | Rolled up how |
|---|---|---|
| `active` / `removed` **per listing** | `title.listings[].state` | — |
| `active` / `removed` **per title** | `title.state` | Derived: `removed` iff every listing is `removed` (REQ-028) |
| `suppressed` | **A separate `suppression` document keyed on `workIdentity`** | Never on the title. Evaluated against the work, not the row. |

**`Suppression` cannot be a field on `Title`.** Under REQ-065 a
reappearing work becomes a *new* `Title` document, so a field would be
bypassed on the next capture. Because the suppression document's `id` is
`supp:<workIdentity>`, the suppression check during extraction is a
direct point-read on a known key — the cheapest possible operation — and
uniqueness per work is guaranteed by the store rather than by our code.
This is REQ-071 implemented as a data-model property.

### Batch atomicity — how REQ-005/REQ-006 are guaranteed

`TransactionalBatch` is limited to 100 operations, and a first import can
create several hundred titles. The batch boundary is therefore enforced
by **visibility**, not by one giant transaction:

1. Documents created by a batch are written with `visible: false` and
   `createdByBatchId`.
2. Writes proceed in idempotent chunks; each created document's id is
   derived deterministically from `(batchId, candidateId)`, so a retry
   after a crash re-writes rather than duplicates.
3. **A single final single-document write flips
   `uploadBatch.status` to `applied`.** That write is atomic by
   definition.
4. **Every list query filters on the batch status** — a document is part
   of the combined list only if its creating batch is `applied`.

The result: a partially-written batch is *invisible*, a crashed batch is
*resumable*, and there is no intermediate state in which the owner sees
half a batch. `REQ-005` ("MUST NOT create, modify or delete any title or
service listing in the combined list until the owner has explicitly
submitted the upload batch") is satisfied by construction rather than by
careful sequencing.

### `UploadBatch` — provenance for REQ-068 / REQ-075

```jsonc
{
  "id": "01J...", "type": "uploadBatch", "ownerId": "own_...",
  "service": "netflix",
  "mode": "full-update",                 // append-only | full-update
  "status": "applied",                   // draft|submitted|extracting|extraction-failed|in-review|applied|undone
  "submittedAt": "...", "completedAt": "...",
  "provenance": {
    "created":  [{ "ref": "title:01J...", "listingId": "01J..." }],
    "modified": [{ "ref": "title:01J...", "attr": "listings[0].dateAdded", "before": "2026-05-01" }],
    "removed":  [{ "ref": "title:01J...", "listingId": "01J...", "beforeState": "active" }]
  }
}
```

`REQ-067`'s creates-only test is then a pure data question —
`provenance.modified.length === 0 && provenance.removed.length === 0` —
rather than an inference over history. When it fails, `REQ-075`'s refusal
enumeration is **read straight out of `provenance`**: the three arrays
are exactly "what it created, what it modified, what it removed", which
is why REQ-068 survives in full even though REQ-069 was deferred.

### Indexing and NFR-018

Cosmos indexes every property by default, which is fine at this size.
The removed view (REQ-062/064) queries within one partition on
`type = 'title'` and listing state, with a `CONTAINS` on the title name
and an equality filter on service. Because the query is
**partition-scoped, filtered and paginated by continuation token**, its
cost is bounded by the page size rather than by the size of the removed
set — which is the scale-invariance `NFR-018` asks for, expressed as a
property of the query rather than as a promise. A composite index on
`(type, state, sortDateAdded)` supports the default ordering (REQ-038).

### Screenshot retention without a database writer

`NFR-019` is implemented entirely in the storage layer (ADR-0006):
`uploadedImage.retainUntil` is written **once, at upload**, and the
application derives availability from it. The blob lifecycle rule
deletes the bytes. **No process writes to Cosmos on a timer**, which is
the strongest available reading of `REQ-041`.

## Consequences

### Positive
- **$0/month, forever, with no cliff and no auto-pause** (NFR-012), and
  no database resume on the value loop.
- Batch close is genuinely atomic-by-visibility; there is no state in
  which the owner sees half a batch (REQ-005, REQ-006).
- **REQ-071 is enforced by a document key, not by application
  discipline** — the highest-risk silent-failure mode in the product is
  closed structurally.
- A combined-list row is one document read; the whole list is one
  partition-scoped query of a few hundred small documents (tens of RUs).
- Soft delete forever is the natural shape: a state field on a document
  nothing ever deletes (REQ-028).
- `tmdb.fetchedAt` makes NFR-014/REQ-076 a queryable property rather
  than a cache-invalidation problem.
- Scaling to the NFR-001 <20 owners is free: the partition key already
  separates them, and every read is already owner-filtered (NFR-008).

### Negative
- **No schema, no constraints, no referential integrity.** Azure SQL
  could have enforced "at most one non-removed Title per (owner,
  workIdentity)" as a filtered unique index; here it is an application
  invariant that must be asserted by tests (NFR-003). **This is a real
  give-up and it is the main cost of this decision.**
- **Cosmos document modelling is less represented in training data than
  SQL + ORM code**, which is a direct tension with `NFR-004`. Mitigated
  by keeping the model deliberately dull — one container, one partition
  key, a `type` discriminator, no cross-partition queries, no stored
  procedures, no change feed — and by concentrating all data access in a
  single repository module with Zod parsing at the boundary (ADR-0004).
- **`TransactionalBatch`'s 100-operation limit** means the visibility
  mechanism above is required rather than optional. It is more moving
  parts than "wrap it in a transaction", and an implementer who forgets
  the `visible`/`status` filter on a query will leak an in-flight batch
  into the combined list — a silent violation of REQ-005. This must have
  a named test.
- **Free tier is one account per subscription and must be enabled at
  creation.** If it is unavailable, the fallback is Cosmos serverless at
  roughly $0.05/month — still NFR-012-compliant, but "$0" becomes a
  configuration property rather than a guarantee.
- **Derived fields (`title.state`, `title.sortDateAdded`) are
  denormalised** and can drift from `listings[]`. Mitigated by computing
  them in exactly one place — the repository's write path — and by an
  invariant test.
- Local development requires the Cosmos DB emulator (or an accepted
  dependency on the cloud account), which is a heavier local dependency
  than SQLite would have been.

### Neutral / follow-on work required
- **`specs/data-model.md` owes** the full document schemas, the derived
  field rules, the invariant list, and the entity names used in
  `diagrams/data-model-erd.md` — which MUST match exactly.
- **`OQ-013` recommendation** (intra-batch overlap dedup, not closed
  here): collapse extraction candidates within a batch on resolved
  `workIdentity` after matching — retaining the first occurrence and
  recording every source image id on it — with a cheap pre-match pass
  collapsing identical normalised text. Overlapping scroll captures
  produce the same work, so identity is the right key and no new
  mechanism is needed.
- **`OQ-015`** is addressed by the `workIdentity` scheme; see
  **ADR-0007**, which is `Proposed` rather than `Accepted` because that
  question is not the architect's to close.

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **Partially.** The store is replaceable; the query layer is not free to rewrite. |
| **Cost to reverse** | A few days. The dataset is small enough to export and re-import in one script. The domain types (ADR-0004 `packages/domain`) are store-agnostic, and all data access is behind one repository module, so a move to Azure SQL is a repository rewrite plus a migration script — bounded, but not trivial. |
| **Trigger to revisit** | (a) the Cosmos free tier becomes unavailable *and* serverless pricing changes materially; (b) invariant drift shows up in production, i.e. the lack of database-enforced constraints is actually biting; (c) the removed view's queries stop meeting NFR-018 at real volume; (d) a requirement appears that needs cross-entity relational querying. |

## Compliance and security implications

- **NFR-008 / NFR-001:** `ownerId` is the partition key, so an
  owner-scoped read is the *only* efficient read. Cross-owner leakage
  would require a deliberate cross-partition query — the model makes the
  right thing the cheap thing.
- **NFR-014:** `tmdb.fetchedAt` makes the 6-month TMDB ceiling
  enforceable and testable; REQ-076 refreshes on access.
- **REQ-028 / REQ-041:** no TTL is configured on the container, no
  change feed processor exists, and no scheduled writer exists. The
  absence of a purge is structural.
- **RSK-022 (TMDB AI clause):** TMDB-derived fields live only in Cosmos
  and are never transmitted to any AI or vision service; matching is
  deterministic string matching, never model-assisted.
- Authentication to Cosmos uses the Container App's system-assigned
  managed identity with a data-plane RBAC role assignment. **No
  connection string or account key is stored anywhere.**
- Encryption at rest is service-managed and on by default; transport is
  TLS.

## References

- `Context/requirements.md` §1.4, §1.7, §3 (domain entities), REQ-005,
  REQ-006, REQ-024…REQ-028, REQ-036, REQ-041, REQ-062…REQ-068,
  REQ-070…REQ-076, NFR-001, NFR-008, NFR-012, NFR-014, NFR-018
- `artifacts/PRD.md` §7.1 (title states and transitions), §7.3, §7.4
- ADR-0003 (hosting), ADR-0006 (image storage), ADR-0007 (work identity)

---

## Addendum — 2026-08-17: live pricing verification (TASK-010)

Read from the **Azure Retail Prices API** for **`eastus2`** on **2026-08-17**,
plus `az sql db list-editions` against the live subscription.

### Azure SQL Basic still exists, and it is still ~$5

R4 flagged a specific worry: *"verify it is a flat ~$5/mo and that Basic still
exists (Microsoft has signalled DTU-model changes)"*. Both hold.

| Item | Published | Verified `eastus2`, 2026-08-17 |
|---|---|---|
| **SQL Database Single Basic** (`B`, 5 DTU, 2 GB) | ~$5.00 | **$0.161/day → $4.90/month** |
| Basic edition offered in region | assumed | ✅ `az sql db list-editions --edition Basic` returns `Basic` |
| Staging: GP_S serverless Gen5 compute | ~$0.50 | **$0.521758 / vCore-hour** when *active*; **$0 compute while auto-paused** |

**The staging figure depends entirely on auto-pause actually pausing.** At the
0.5-vCore serverless minimum, staging costs about **$0.26 per active hour**, so
the published ~$0.50/month assumes roughly **two hours of use per month** plus
storage. That is realistic for a rehearsal environment, but it is an
*assumption about behaviour*, not a list price: a staging database left
un-paused for a month would cost **~$190**, which is 16× the entire system.

⚠ **This is the one line in the model that can run away**, and it is the reason
`autoPauseDelay` in `infra/sqldb.bicep` is load-bearing rather than a tuning
detail. The budget alert deployed by TASK-142 is the backstop: at $19.50 the
owner hears about it within a day or so, long before a month of un-paused
serverless compute accrues.

### Prod is flat, and that is the point

Basic is a **fixed daily rate** — it does not vary with query volume, so no
usage pattern can make the production database surprise anyone. Combined with
`REQ-028` (no scheduled deletion, no jobs), the production database has no
mechanism by which its cost can change without a visible Bicep diff pinned by
`T-INFRA-005`.
