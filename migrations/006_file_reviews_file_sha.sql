-- Add file_sha column to track blob SHA for cross-revision persistence
ALTER TABLE file_reviews ADD COLUMN file_sha TEXT;

-- Drop old index keyed on head_sha
DROP INDEX IF EXISTS idx_file_reviews_lookup;

-- New index for querying all reviews for a PR (any revision)
CREATE INDEX IF NOT EXISTS idx_file_reviews_lookup
    ON file_reviews(user_id, owner, repo, pr_number, file_path);
