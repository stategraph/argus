CREATE TABLE IF NOT EXISTS notification_dismissals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pr_key TEXT NOT NULL,
    dismissed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, pr_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_dismissals_user ON notification_dismissals(user_id);
