# ADR-0016 — Documentary as a derived display category

| | |
| --- | --- |
| **Status** | Accepted, 2026-10-22 (`A62`) |
| **Original date** | 2026-10-22, issue #456 |
| **Deciders** | Owner |
| **Supersedes** | Nothing. Extends the display category of US-062 / REQ-128. |

## 1. Problem and owner decision

The owner wants **Documentary** as another media type. Movie/TV is the canonical type that drives identity, runtime units, season logic and TMDB endpoints; the filterable axis is the separate **display category** (Movie, TV Show, Comedy Show). Documentary is added to that axis.

## 2. Decision

- `documentary` joins `TITLE_CATEGORIES`; its label lives in `TITLE_CATEGORY_LABELS`.
- **Derived at read time** from the TMDB genre names already stored in `title.tmdb_genres` (genre 99, movie and tv). **Nothing is stored**, so no existing row is rewritten and no new TMDB metadata field is added.
- Precedence: owner override, Comedy Show (explicit performance evidence), Documentary, then Movie/TV. One rule, `titleCategory`, with `EFFECTIVE_CATEGORY` mirroring it in SQL so filtering before pagination agrees with the projected value.
- The owner override accepts `documentary`. Migration `0021_documentary_category` widens the override CHECK additively: the superset is added WITH CHECK, then the 0016 constraint is set NOCHECK, never dropped. It is pinned by path and SHA-256 in `tools/check-migrations.ts`, as 0020 is.

## 3. What does not change

`mediaType`, work identity, suppression, listings and dates. No scheduler or background process (invariant 5): titles without stored genres are classified by the existing on-access metadata refresh. Soft delete forever, no TTL.

## 4. Consequences

- US-071 / REQ-137 added; US-062's category list corrected in place.
- Specs: `title-category.md`, `data-model.md`, `api.md`, `ui.md`, `testing.md` (`T-DOC-*`).
- Work: TASK-288, TASK-289.
- Trade-offs: the genre match is the English TMDB name, so a different metadata language would need the id stored; a Documentary movie and series share one category.
