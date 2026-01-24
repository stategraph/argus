-- Add merge-base tracking to revisions for range-diff support
ALTER TABLE pr_revisions ADD COLUMN base_ref TEXT;
ALTER TABLE pr_revisions ADD COLUMN merge_base_sha TEXT;

-- Add index for revision ID lookups
CREATE INDEX IF NOT EXISTS idx_pr_revisions_id ON pr_revisions(id);
