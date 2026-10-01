-- Resolution pointers expire; public subtitle assets keep their original contents.
ALTER TABLE subtitle_cache ADD COLUMN metadata TEXT;

CREATE TABLE subtitle_selections (
  key TEXT PRIMARY KEY,
  subtitle_id TEXT,
  metadata TEXT,
  expires_at INTEGER NOT NULL
);
