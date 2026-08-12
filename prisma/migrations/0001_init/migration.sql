-- nextup initial schema (TASK-017).
--
-- SOURCE OF TRUTH: `specs/data-model.md` §16.3/§16.4, Revision 5. This file is
-- the authoritative DDL; `prisma/schema.prisma` is the client-generation view
-- of it. Everything below that Prisma cannot express is here BY DESIGN:
-- BIN2 collation, CHECK constraints, ISJSON, and the FILTERED unique indexes
-- that ARE invariants I-1, I-2 and I-9.
--
-- ⚠ THREE THINGS THAT LOOK COSMETIC AND ARE NOT. Each was reproduced against
-- `mcr.microsoft.com/mssql/server:2022-latest`; see
-- `docs/task-017-schema-findings.md`.
--
--   1. TABLE ORDER IS LOAD-BEARING. Each table references only tables above
--      it. Alphabetising this file makes it fail with Msg 1767 and create
--      NOTHING.
--   2. EVERY `*_id` COLUMN CARRIES `COLLATE Latin1_General_100_BIN2`. Omitting
--      it on one side of a foreign key fails with Msg 1757.
--   3. `ISJSON(x, VALUE)` ON `batch_change.prev_value`/`next_value`. Plain
--      `ISJSON(x)` returns 0 for a JSON scalar, and those columns hold scalars.
--
-- ⚠ ADDITIVE ONLY. `T-MIG-001` fails this repository on `DROP TABLE`,
-- `ALTER TABLE ... DROP COLUMN`, `DROP INDEX`, `DROP CONSTRAINT`, `TRUNCATE`
-- or an `sp_rename` column rename, in any migration, forever. Soft delete is
-- forever (REQ-028) and a migration is the one place data is lost quietly.

CREATE TABLE [upload_batch] (
    [id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [mode] NVARCHAR(16) NOT NULL,
    [service] NVARCHAR(16) NOT NULL,
    [status] NVARCHAR(24) NOT NULL,
    [derived_from_batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [submitted_at] DATETIME2(3),
    [extraction_started_at] DATETIME2(3),
    [completed_at] DATETIME2(3),
    [undone_at] DATETIME2(3),
    [extraction_stats] NVARCHAR(MAX),
    [extraction_error_code] NVARCHAR(32),
    [extraction_error_message] NVARCHAR(MAX),
    [extraction_error_at] DATETIME2(3),
    [degraded_extraction] BIT NOT NULL CONSTRAINT [df_batch_degraded] DEFAULT 0,
    [low_yield] BIT NOT NULL CONSTRAINT [df_batch_low_yield] DEFAULT 0,
    [cross_check] NVARCHAR(20),
    [created_at] DATETIME2(3) NOT NULL CONSTRAINT [df_batch_created] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [upload_batch_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ck_batch_mode] CHECK ([mode] IN ('append-only','full-update')),
    CONSTRAINT [ck_batch_service] CHECK ([service] IN ('netflix','max')),
    CONSTRAINT [ck_batch_status] CHECK ([status] IN ('draft','submitted','extracting','extraction-failed','in-review','applied','undone','discarded')),
    CONSTRAINT [ck_batch_stats_json] CHECK ([extraction_stats] IS NULL OR ISJSON([extraction_stats]) = 1),
    CONSTRAINT [ck_batch_err_code] CHECK ([extraction_error_code] IS NULL OR [extraction_error_code] IN ('EXTRACTOR_UNAVAILABLE','EXTRACTOR_ERROR','IMAGES_PURGED')),
    CONSTRAINT [ck_batch_cross_check] CHECK ([cross_check] IS NULL OR [cross_check] IN ('ok','ocr-unavailable','llm-unavailable')),
    CONSTRAINT [ck_batch_error_coherent] CHECK (
        ([extraction_error_code] IS NULL AND [extraction_error_at] IS NULL)
     OR ([extraction_error_code] IS NOT NULL AND [extraction_error_at] IS NOT NULL)
    )
);

-- Self-reference, so the FK is added after the table exists (US-034 AC-3).
ALTER TABLE [upload_batch] ADD CONSTRAINT [fk_batch_derived_from]
    FOREIGN KEY ([derived_from_batch_id]) REFERENCES [upload_batch]([id]);

CREATE TABLE [title] (
    [id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [work_identity] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    -- '' = not an acknowledged duplicate. NEVER NULL: SQL Server treats two
    -- NULLs as EQUAL in a unique index, so a nullable column here would
    -- silently reject the second row it exists to permit.
    [duplicate_ack_seq] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [df_title_dup_seq] DEFAULT '',
    [state] NVARCHAR(16) NOT NULL,
    [match_state] NVARCHAR(16) NOT NULL,
    [raw_extracted_text] NVARCHAR(MAX),
    [normalised_text] NVARCHAR(MAX),
    [created_by_batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [sort_date_added] DATE,
    [tmdb_id] INT,
    [tmdb_media_type] NVARCHAR(16),
    [tmdb_name] NVARCHAR(500),
    [tmdb_release_year] INT,
    [tmdb_runtime_minutes] INT,
    [tmdb_genres] NVARCHAR(MAX) NOT NULL CONSTRAINT [df_title_genres] DEFAULT '[]',
    [tmdb_poster_path] NVARCHAR(400),
    [tmdb_fetched_at] DATETIME2(3),
    [created_at] DATETIME2(3) NOT NULL CONSTRAINT [df_title_created] DEFAULT SYSUTCDATETIME(),
    [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [df_title_updated] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [title_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [fk_title_created_by_batch] FOREIGN KEY ([created_by_batch_id]) REFERENCES [upload_batch]([id]),
    CONSTRAINT [ck_title_state] CHECK ([state] IN ('active','removed')),
    CONSTRAINT [ck_title_match_state] CHECK ([match_state] IN ('matched','unmatched')),
    CONSTRAINT [ck_title_media_type] CHECK ([tmdb_media_type] IS NULL OR [tmdb_media_type] IN ('movie','tv')),
    CONSTRAINT [ck_title_genres_json] CHECK (ISJSON([tmdb_genres]) = 1),
    CONSTRAINT [title_match_coherent] CHECK (
        ([match_state] = 'matched' AND [tmdb_id] IS NOT NULL
            AND [work_identity] LIKE 'tmdb:%' AND [raw_extracted_text] IS NULL)
     OR ([match_state] = 'unmatched' AND [tmdb_id] IS NULL
            AND [work_identity] NOT LIKE 'tmdb:%' AND [raw_extracted_text] IS NOT NULL)
    )
);

CREATE TABLE [removal_group] (
    [id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [undone_at] DATETIME2(3),
    [created_at] DATETIME2(3) NOT NULL CONSTRAINT [df_group_created] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [removal_group_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [fk_group_batch] FOREIGN KEY ([batch_id]) REFERENCES [upload_batch]([id])
);

CREATE TABLE [service_listing] (
    [listing_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [title_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [service] NVARCHAR(16) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    -- WRITE-ONCE, REQ-030.
    [date_added] DATE NOT NULL,
    [date_added_edited] BIT NOT NULL CONSTRAINT [df_listing_edited] DEFAULT 0,
    [removed_at] DATETIME2(3),
    [removed_by_batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [removed_by_group_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [created_by_batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    CONSTRAINT [service_listing_pkey] PRIMARY KEY CLUSTERED ([listing_id]),
    CONSTRAINT [fk_listing_title] FOREIGN KEY ([title_id]) REFERENCES [title]([id]) ON DELETE CASCADE,
    CONSTRAINT [fk_listing_removed_by_batch] FOREIGN KEY ([removed_by_batch_id]) REFERENCES [upload_batch]([id]),
    CONSTRAINT [fk_listing_removed_by_group] FOREIGN KEY ([removed_by_group_id]) REFERENCES [removal_group]([id]),
    CONSTRAINT [fk_listing_created_by_batch] FOREIGN KEY ([created_by_batch_id]) REFERENCES [upload_batch]([id]),
    CONSTRAINT [ck_listing_service] CHECK ([service] IN ('netflix','max')),
    CONSTRAINT [ck_listing_state] CHECK ([state] IN ('active','removed')),
    CONSTRAINT [listing_removal_coherent] CHECK (
        ([state] = 'removed' AND [removed_at] IS NOT NULL)
     OR ([state] = 'active' AND [removed_at] IS NULL)
    )
);

CREATE TABLE [batch_change] (
    [id] BIGINT IDENTITY(1,1) NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [kind] NVARCHAR(24) NOT NULL,
    [title_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [listing_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [attr] NVARCHAR(100),
    -- ⚠ ISJSON(x, VALUE), not ISJSON(x): these hold JSON SCALARS such as a
    -- previous workIdentity string, and plain ISJSON returns 0 for those.
    -- Batch close is one transaction, so a rejection here rolled back the
    -- entire close.
    [prev_value] NVARCHAR(MAX),
    [next_value] NVARCHAR(MAX),
    [created_at] DATETIME2(3) NOT NULL CONSTRAINT [df_change_created] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [batch_change_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [fk_change_batch] FOREIGN KEY ([batch_id]) REFERENCES [upload_batch]([id]),
    CONSTRAINT [fk_change_title] FOREIGN KEY ([title_id]) REFERENCES [title]([id]),
    CONSTRAINT [fk_change_listing] FOREIGN KEY ([listing_id]) REFERENCES [service_listing]([listing_id]),
    CONSTRAINT [ck_change_kind] CHECK ([kind] IN ('title_created','listing_added','listing_removed','attr_modified')),
    CONSTRAINT [ck_change_prev_json] CHECK ([prev_value] IS NULL OR ISJSON([prev_value], VALUE) = 1),
    CONSTRAINT [ck_change_next_json] CHECK ([next_value] IS NULL OR ISJSON([next_value], VALUE) = 1)
);

CREATE TABLE [uploaded_image] (
    [id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [blob_path] NVARCHAR(400) NOT NULL,
    -- DISPLAY ONLY (A45). NEVER used to compose blob_path.
    [file_name] NVARCHAR(255) NOT NULL,
    -- HOW the bytes arrived (A45). 'upload' is the backfill default because
    -- every row predating A45 did arrive that way — a true statement about
    -- history, not a convenience.
    [ingest_source] NVARCHAR(16) NOT NULL CONSTRAINT [df_image_ingest_source] DEFAULT 'upload',
    [uploaded_format] NVARCHAR(8) NOT NULL,
    [format] NVARCHAR(8) NOT NULL,
    [byte_size] BIGINT NOT NULL,
    [width] INT,
    [height] INT,
    [uploaded_at] DATETIME2(3) NOT NULL CONSTRAINT [df_image_uploaded] DEFAULT SYSUTCDATETIME(),
    -- Set ONCE at upload, NEVER updated (NFR-019). Identical for pasted images.
    [retain_until] DATETIME2(3) NOT NULL,
    -- NULL (not extracted) and 0 (extracted, found nothing) are DIFFERENT.
    [candidate_count] INT,
    CONSTRAINT [uploaded_image_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [fk_image_batch] FOREIGN KEY ([batch_id]) REFERENCES [upload_batch]([id]),
    CONSTRAINT [ck_image_file_name] CHECK (LEN(LTRIM(RTRIM([file_name]))) > 0),
    CONSTRAINT [ck_image_ingest_source] CHECK ([ingest_source] IN ('paste','upload','drop')),
    CONSTRAINT [ck_image_uploaded_format] CHECK ([uploaded_format] IN ('png','jpeg','heic','heif')),
    CONSTRAINT [ck_image_format] CHECK ([format] IN ('png','jpeg')),
    CONSTRAINT [ck_image_byte_size] CHECK ([byte_size] > 0),
    CONSTRAINT [ck_image_candidate_count] CHECK ([candidate_count] IS NULL OR [candidate_count] >= 0)
);

CREATE TABLE [extraction_candidate] (
    [id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [raw_text] NVARCHAR(MAX) NOT NULL,
    [inferred_title] NVARCHAR(500),
    [basis] NVARCHAR(16) NOT NULL,
    [ocr_support] NVARCHAR(16) NOT NULL,
    [provider] NVARCHAR(16) NOT NULL,
    -- BIN2 because this is a GROUPING KEY for intra-batch collapse, never a
    -- search target. Under a case-insensitive collation, two texts that must
    -- stay distinct would silently merge.
    [normalised_text] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
    -- MATCH HINT ONLY, never enters identity (SD-05).
    [extracted_year] INT,
    [bounding_boxes] NVARCHAR(MAX),
    [box_source] NVARCHAR(8) NOT NULL,
    [ocr_confidence] FLOAT,
    [cleanup_verdict] NVARCHAR(24) NOT NULL,
    [match_candidates] NVARCHAR(MAX),
    [resolved_work_identity] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [resolved_title_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [classification] NVARCHAR(40),
    -- 'pending' by default: there is NO accept-by-inaction (REQ-014).
    [review_disposition] NVARCHAR(16) NOT NULL CONSTRAINT [df_cand_disposition] DEFAULT 'pending',
    [corrected_to_tmdb_id] INT,

    -- SD-02 intra-batch overlap collapse: the loser survives as a row with
    -- review_disposition='discarded' pointing at the survivor that absorbed
    -- it. NOT a foreign key -- a self-referencing FK on this table gives SQL
    -- Server a cascade path it rejects, and the pointer is only dereferenced
    -- within an already-loaded batch. See specs/data-model.md 7.4, T-AI-007.
    [collapsed_into_candidate_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    [created_at] DATETIME2(3) NOT NULL CONSTRAINT [df_candidate_created] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [extraction_candidate_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [fk_cand_batch] FOREIGN KEY ([batch_id]) REFERENCES [upload_batch]([id]),
    CONSTRAINT [fk_cand_resolved_title] FOREIGN KEY ([resolved_title_id]) REFERENCES [title]([id]),
    CONSTRAINT [ck_cand_basis] CHECK ([basis] IN ('text','artwork','both','unknown')),
    CONSTRAINT [ck_cand_ocr_sup] CHECK ([ocr_support] IN ('exact','partial','none','not-checked')),
    CONSTRAINT [ck_cand_provider] CHECK ([provider] IN ('llm','ocr-only')),
    CONSTRAINT [ck_cand_box_source] CHECK ([box_source] IN ('ocr','llm')),
    CONSTRAINT [ck_cand_boxes_json] CHECK ([bounding_boxes] IS NULL OR ISJSON([bounding_boxes]) = 1),
    CONSTRAINT [ck_candidate_json] CHECK ([match_candidates] IS NULL OR ISJSON([match_candidates]) = 1),
    CONSTRAINT [ck_cand_confidence] CHECK ([ocr_confidence] IS NULL OR ([ocr_confidence] >= 0 AND [ocr_confidence] <= 1)),
    CONSTRAINT [ck_cand_verdict] CHECK ([cleanup_verdict] IN ('title-candidate','low-confidence','inferred-unverified','unreadable-tile','chrome-suspected')),
    CONSTRAINT [ck_cand_classification] CHECK ([classification] IS NULL OR [classification] IN ('new','already-present-for-this-service')),
    CONSTRAINT [ck_cand_disposition] CHECK ([review_disposition] IN ('pending','confirmed','corrected','discarded','unresolved'))
);

-- Candidate -> image is MANY-TO-MANY after intra-batch collapse (SD-02).
-- ⚠ Surrogate PK: the natural triple is 1200 bytes, over the 900-byte
-- CLUSTERED key cap. It would create with only a warning, then fail at INSERT.
-- The nonclustered cap is 1700 bytes, so the natural key is a UNIQUE
-- NONCLUSTERED constraint instead.
CREATE TABLE [candidate_source_image] (
    [id] BIGINT IDENTITY(1,1) NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [candidate_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [image_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [ordinal] INT NOT NULL,
    CONSTRAINT [pk_candidate_source_image] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [fk_csi_candidate] FOREIGN KEY ([candidate_id]) REFERENCES [extraction_candidate]([id]) ON DELETE CASCADE,
    CONSTRAINT [fk_csi_image] FOREIGN KEY ([image_id]) REFERENCES [uploaded_image]([id]),
    CONSTRAINT [uq_candidate_source_image] UNIQUE NONCLUSTERED ([owner_id], [candidate_id], [image_id])
);

CREATE TABLE [service_state] (
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [service] NVARCHAR(16) NOT NULL,
    -- NULL === "never updated" (US-022 AC-3). REQ-039 / FreshnessStrip reads
    -- both columns. Show the fact; never nag about it (A46).
    [last_completed_batch_at] DATETIME2(3),
    [last_completed_batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    CONSTRAINT [pk_service_state] PRIMARY KEY CLUSTERED ([owner_id], [service]),
    CONSTRAINT [fk_state_batch] FOREIGN KEY ([last_completed_batch_id]) REFERENCES [upload_batch]([id]),
    CONSTRAINT [ck_state_service] CHECK ([service] IN ('netflix','max'))
);

CREATE TABLE [suppression] (
    [id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    -- REQ-071: keyed on canonical WORK IDENTITY, never on a row id.
    [work_identity] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [df_suppression_active] DEFAULT 1,
    [suppressed_at] DATETIME2(3) NOT NULL CONSTRAINT [df_suppression_created] DEFAULT SYSUTCDATETIME(),
    [unsuppressed_at] DATETIME2(3),
    -- SD-06: the previous workIdentity if migrated by fix-match.
    [migrated_from] NVARCHAR(200) COLLATE Latin1_General_100_BIN2,
    -- SuppressionDisplaySnapshot, flattened, so the suppressed view renders
    -- WITHOUT a title row (US-029 AC-1).
    [display_name] NVARCHAR(500) NOT NULL,
    [display_release_year] INT,
    [display_media_type] NVARCHAR(16),
    [display_poster_path] NVARCHAR(400),
    CONSTRAINT [suppression_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ck_suppression_media_type] CHECK ([display_media_type] IS NULL OR [display_media_type] IN ('movie','tv'))
);

-- ---------------------------------------------------------------------------
-- INVARIANTS AS FILTERED UNIQUE INDEXES (§16.4)
--
-- ⚠ These three indexes ARE invariants I-1, I-2 and I-9. They are not
-- performance tuning and must never be dropped or unfiltered.
--
-- ⚠ Creating a filtered index requires QUOTED_IDENTIFIER ON. The Prisma/TDS
-- client sets it ON, but `sqlcmd` defaults it OFF and fails with Msg 1934 —
-- and the failure is easy to miss, because later inserts then succeed
-- precisely because the index enforcing them does not exist. Any tool that
-- applies this file must pass `-I`. `T-INV-017` asserts the indexes exist
-- rather than assuming they do.
-- ---------------------------------------------------------------------------

-- I-1: at most one ACTIVE title per (owner, work, duplicate-ack).
-- The predicate is `= 'active'`, not `<> 'removed'`: filtered-index predicates
-- allow `=` and disallow `<>`, and the two are equivalent under ck_title_state.
CREATE UNIQUE INDEX [title_one_active_per_work]
    ON [title] ([owner_id], [work_identity], [duplicate_ack_seq]) WHERE [state] = 'active';

-- I-2: at most one ACTIVE listing per (owner, title, service).
-- ⚠ MUST BE FILTERED. Unfiltered, a soft-deleted row occupies the pair
-- forever, so a work removed from a service could NEVER reappear on it — both
-- the re-add path and the new-title path are blocked. Verified.
CREATE UNIQUE INDEX [listing_one_per_service]
    ON [service_listing] ([owner_id], [title_id], [service]) WHERE [state] = 'active';

-- I-9: at most one ACTIVE suppression per (owner, work identity).
CREATE UNIQUE INDEX [suppression_one_active]
    ON [suppression] ([owner_id], [work_identity]) WHERE [active] = 1;

-- ---------------------------------------------------------------------------
-- Access-path indexes. NFR-008: every index leads with owner_id.
-- ---------------------------------------------------------------------------

CREATE INDEX [upload_batch_owner_service_status] ON [upload_batch] ([owner_id], [service], [status]);
CREATE INDEX [title_owner_state_sortdate] ON [title] ([owner_id], [state], [sort_date_added]);
CREATE INDEX [service_listing_owner_service_state] ON [service_listing] ([owner_id], [service], [state]);
CREATE INDEX [service_listing_title] ON [service_listing] ([title_id]);
CREATE INDEX [service_listing_removed_by_batch] ON [service_listing] ([removed_by_batch_id]);
CREATE INDEX [service_listing_removed_by_group] ON [service_listing] ([removed_by_group_id]);
CREATE INDEX [service_listing_created_by_batch] ON [service_listing] ([created_by_batch_id]);
CREATE INDEX [batch_change_owner_batch] ON [batch_change] ([owner_id], [batch_id]);
CREATE INDEX [batch_change_title] ON [batch_change] ([title_id]);
CREATE INDEX [batch_change_listing] ON [batch_change] ([listing_id]);
CREATE INDEX [removal_group_owner_batch] ON [removal_group] ([owner_id], [batch_id]);
CREATE INDEX [uploaded_image_owner_batch] ON [uploaded_image] ([owner_id], [batch_id]);
-- The 30-day purge scans this (NFR-019). It is the ONE background job that may
-- touch rows, and it touches no LIST state.
CREATE INDEX [uploaded_image_retain_until] ON [uploaded_image] ([retain_until]);
CREATE INDEX [extraction_candidate_owner_batch_disposition] ON [extraction_candidate] ([owner_id], [batch_id], [review_disposition]);
CREATE INDEX [extraction_candidate_resolved_title] ON [extraction_candidate] ([resolved_title_id]);
CREATE INDEX [candidate_source_image_owner_image] ON [candidate_source_image] ([owner_id], [image_id]);
CREATE INDEX [candidate_source_image_candidate] ON [candidate_source_image] ([candidate_id]);
CREATE INDEX [suppression_owner_work] ON [suppression] ([owner_id], [work_identity]);
CREATE INDEX [title_created_by_batch] ON [title] ([created_by_batch_id]);
CREATE INDEX [upload_batch_derived_from] ON [upload_batch] ([derived_from_batch_id]);
CREATE INDEX [service_state_last_batch] ON [service_state] ([last_completed_batch_id]);
