-- TASK-085 — the owner's tick/untick decisions on a batch's proposed removals
-- (US-015, REQ-021, REQ-055).
--
-- ── Additive only (§16.8, `T-MIG-001`) ──────────────────────────────────────
--
-- One CREATE TABLE. Nothing is dropped, renamed, rewritten or backfilled, and
-- no existing row changes meaning: the absence of a row in this table is the
-- default the product already had (every proposed removal arrives ticked).

-- ⚠ THE ABSENCE OF A ROW MEANS TICKED, AND THAT ASYMMETRY IS THE DESIGN.
--
-- A batch's removal set is RECOMPUTED from the screenshots on every read, so a
-- row per proposal would have to be created, reconciled and cleaned up as that
-- set changed — and every gap in that bookkeeping presents to the owner as a
-- removal they never ticked. Storing only "the owner said no to this one"
-- cannot drift, because the only thing that writes it is the owner saying no.
--
-- The consequence to keep in mind: a row here is NOT evidence that the listing
-- was ever proposed. It records a decision; whether it still applies is
-- decided by intersecting it with the live removal set at read time.
CREATE TABLE [removal_decision] (
  [owner_id]   NVARCHAR(200) NOT NULL,
  [batch_id]   NVARCHAR(200) NOT NULL,
  [listing_id] NVARCHAR(200) NOT NULL,
  [ticked]     BIT           NOT NULL CONSTRAINT [df_removal_decision_ticked] DEFAULT 1,
  [decided_at] DATETIME2     NOT NULL CONSTRAINT [df_removal_decision_decided] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_removal_decision] PRIMARY KEY ([owner_id], [batch_id], [listing_id])
);

-- ⚠ The key is (owner, BATCH, listing) — not (owner, listing).
--
-- Unticking a removal is a decision about THIS batch's evidence. Keyed on the
-- listing alone it would become a standing exemption, and a later full-update
-- with fresh evidence that the title really is gone would silently decline to
-- propose it. That is a removal-shaped hole in the list the owner is never
-- told about, which is the same class of defect as product invariant 2.

-- The batch FK keeps a decision from outliving the batch it belongs to.
-- NO ACTION on both edges, matching every other FK in this schema: a cascading
-- delete is a hard-delete mechanism, and REQ-028 does not permit one.
ALTER TABLE [removal_decision]
  ADD CONSTRAINT [fk_removal_decision_batch]
  FOREIGN KEY ([batch_id]) REFERENCES [upload_batch]([id]) ON UPDATE NO ACTION ON DELETE NO ACTION;

-- ⚠ NO FOREIGN KEY TO `service_listing`, AND ITS ABSENCE IS DELIBERATE.
--
-- A decision records what the owner said, and it must survive whatever happens
-- to the listing afterwards — including the removal itself, which rewrites
-- that listing's state in the very transaction this table informs. An FK here
-- would make the batch history's account of a close depend on the close not
-- having happened yet.

-- Reads are always "every decision in this batch", intersected with the
-- freshly computed removal set. The primary key's leading (owner, batch)
-- columns already serve that, so there is no second index here: an index that
-- serves no query is a cost on every write and an invitation to write the
-- query it implies.
