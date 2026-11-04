CREATE TABLE undo_records (
 token TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 label TEXT NOT NULL,
 payload TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX undo_expiry ON undo_records(expires_at);
