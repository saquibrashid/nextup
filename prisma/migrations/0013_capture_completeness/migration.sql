ALTER TABLE [upload_batch] ADD [capture_tracking] NVARCHAR(24) NOT NULL
  CONSTRAINT [df_batch_capture_tracking] DEFAULT 'unverified';

EXEC('ALTER TABLE [upload_batch] ADD CONSTRAINT [ck_batch_capture_tracking]
  CHECK ([capture_tracking] IN (''tracked'', ''unverified'', ''inherited-incomplete''))');

CREATE TABLE [capture_ingest_attempt] (
  [id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [batch_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [client_token] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [kind] NVARCHAR(24) NOT NULL,
  [state] NVARCHAR(16) NOT NULL,
  [failures] NVARCHAR(MAX) NOT NULL,
  [accepted_image_ids] NVARCHAR(MAX) NOT NULL,
  [replacement_image_ids] NVARCHAR(MAX) NOT NULL,
  [started_at] DATETIME2(3) NOT NULL CONSTRAINT [df_capture_attempt_started] DEFAULT SYSUTCDATETIME(),
  [completed_at] DATETIME2(3) NULL,
  [resolved_at] DATETIME2(3) NULL,
  CONSTRAINT [pk_capture_ingest_attempt] PRIMARY KEY ([id]),
  CONSTRAINT [fk_capture_attempt_batch] FOREIGN KEY ([batch_id])
    REFERENCES [upload_batch]([id]) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT [ck_capture_attempt_kind] CHECK ([kind] IN ('upload', 'local-refusal', 'image-removal')),
  CONSTRAINT [ck_capture_attempt_state] CHECK ([state] IN ('receiving', 'complete', 'incomplete', 'resolved')),
  CONSTRAINT [ck_capture_attempt_failures] CHECK (ISJSON([failures], ARRAY) = 1),
  CONSTRAINT [ck_capture_attempt_accepted] CHECK (ISJSON([accepted_image_ids], ARRAY) = 1),
  CONSTRAINT [ck_capture_attempt_replacements] CHECK (ISJSON([replacement_image_ids], ARRAY) = 1),
  CONSTRAINT [ck_capture_attempt_resolution] CHECK (
    ([state] = 'resolved' AND [resolved_at] IS NOT NULL)
    OR ([state] <> 'resolved' AND [resolved_at] IS NULL)
  )
);
CREATE UNIQUE NONCLUSTERED INDEX [uq_capture_attempt_token]
  ON [capture_ingest_attempt] ([owner_id], [batch_id], [client_token]);
CREATE NONCLUSTERED INDEX [ix_capture_attempt_owner_batch]
  ON [capture_ingest_attempt] ([owner_id], [batch_id]);
