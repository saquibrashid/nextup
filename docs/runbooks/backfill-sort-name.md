# Runbook — backfill `title.sort_name` (TASK-219)

**One-shot, per environment, after migration `0010_title_sort_name` is applied.**
CI and any freshly-created database do **not** need it — they have no rows.

## Why this is a script and not part of the migration

`sort_name` is a **derived** value: the displayed name (`tmdbName ??
rawExtractedText`), whitespace-normalised, with a leading English article
(`a`, `an`, `the`) removed, truncated to 400 characters. `specs/data-model.md`
§16 I-4 fixes the rule that a derived value has **exactly one implementation**,
and that implementation is `deriveSortName` in
`packages/domain/src/sortName.ts`.

A `T-SQL` `UPDATE` inside the migration would be a **second** implementation of
that rule — one that no unit test covers, that cannot be kept in step with the
first, and that would disagree with it at exactly the rows this feature exists
to order correctly. So migration `0010` adds the column and the index and
nothing else, and the backfill runs the real function.

## Running it

```bash
# DATABASE_URL must point at the environment you intend to change.
npm run backfill:sort-name
```

The script is **idempotent** and recomputes **every** row, not only the rows
whose key is `NULL`. That is deliberate: if `deriveSortName` ever changes — a
new article, a different truncation — re-running this is the whole migration
path, and a `WHERE sort_name IS NULL` filter would silently skip every row that
needs it most. It pages by `id` keyset, so it is safe on a Basic-tier database
and can be interrupted and re-run.

## Verifying it

`T-INV-025` asserts that every stored `sort_name` equals
`deriveSortName(row)`. It is what makes a **forgotten** backfill fail loudly.

⚠ **The symptom of skipping this step is not an error.** Rows keep a `NULL`
key, and `sort=name` puts `NULL`s last — so the list looks ordered, with an
arbitrary and growing tail of titles that simply are not in it. Run the
integration suite against the environment, or spot-check:

```sql
SELECT COUNT(*) FROM [dbo].[title] WHERE [sort_name] IS NULL;
```

A non-zero count is only correct if that many titles genuinely have **no name
at all** — a matched row whose TMDB record carries no `name`, which is rare.

## When to run it again

- After any change to `deriveSortName` or to `LEADING_ARTICLES`.
- After restoring a backup taken before `0010` was applied.

Not after ordinary writes: `withSortName` in
`apps/api/src/repository/ownerData.ts` is a choke point on `createTitle`,
`updateTitle` and `updateTitleMetadata`, so every live write maintains the key.
