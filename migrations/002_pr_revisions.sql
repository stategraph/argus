-- PR Revisions (track head SHAs over time, including force pushes)
CREATE TABLE IF NOT EXISTS pr_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    head_sha TEXT NOT NULL,
    head_ref TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    seen_at TEXT DEFAULT (datetime('now')),
    UNIQUE(owner, repo, pr_number, head_sha)
);

CREATE INDEX IF NOT EXISTS idx_pr_revisions_lookup ON pr_revisions(owner, repo, pr_number);
CREATE INDEX IF NOT EXISTS idx_pr_revisions_seen_at ON pr_revisions(owner, repo, pr_number, seen_at DESC);
