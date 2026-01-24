-- Argus Initial Schema (SQLite)

-- GitHub App installations
CREATE TABLE IF NOT EXISTS installations (
    id INTEGER PRIMARY KEY,
    account_type TEXT NOT NULL,
    account_login TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '{}',
    events TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_installations_account ON installations(account_login);

-- Repositories accessible via installations
CREATE TABLE IF NOT EXISTS repositories (
    id INTEGER PRIMARY KEY,
    installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    private INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_repositories_installation ON repositories(installation_id);
CREATE INDEX IF NOT EXISTS idx_repositories_full_name ON repositories(full_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_owner_name ON repositories(owner, name);

-- User sessions (for OAuth flow)
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    github_user_id INTEGER NOT NULL,
    github_login TEXT NOT NULL,
    github_avatar_url TEXT,
    access_token TEXT NOT NULL,
    token_expires_at TEXT,
    refresh_token TEXT,
    refresh_token_expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_github_user ON user_sessions(github_user_id);

-- Cached PR snapshots
CREATE TABLE IF NOT EXISTS pr_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    head_sha TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at TEXT DEFAULT (datetime('now')),
    UNIQUE(owner, repo, pr_number, head_sha)
);

CREATE INDEX IF NOT EXISTS idx_pr_snapshots_lookup ON pr_snapshots(owner, repo, pr_number);
CREATE INDEX IF NOT EXISTS idx_pr_snapshots_head_sha ON pr_snapshots(head_sha);

-- Cached rendered diffs per file
CREATE TABLE IF NOT EXISTS diff_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    file_path TEXT NOT NULL,
    diff_data TEXT NOT NULL,
    rendered_html TEXT,
    fetched_at TEXT DEFAULT (datetime('now')),
    UNIQUE(owner, repo, head_sha, file_path)
);

CREATE INDEX IF NOT EXISTS idx_diff_cache_lookup ON diff_cache(owner, repo, head_sha);

-- GitHub API cache (ETag-based)
CREATE TABLE IF NOT EXISTS api_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT NOT NULL UNIQUE,
    etag TEXT,
    data TEXT,
    fetched_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_cache_key ON api_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
