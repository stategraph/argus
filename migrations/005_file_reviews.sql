-- Migration: File Reviews
-- Tracks which files a user has reviewed in a PR
-- Invalidates when file changes (new head SHA)

CREATE TABLE IF NOT EXISTS file_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    reviewed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, owner, repo, pr_number, file_path, head_sha)
);

CREATE INDEX IF NOT EXISTS idx_file_reviews_lookup
    ON file_reviews(user_id, owner, repo, pr_number, head_sha);
