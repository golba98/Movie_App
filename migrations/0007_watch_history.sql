PRAGMA foreign_keys = ON;

-- Watched flags and resume positions, one row per movie or episode. Keys match
-- the client's entry keys: 'movie:ID' or 'tv:ID:SEASON:EPISODE'.
CREATE TABLE watch_entries (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entry_key TEXT NOT NULL,
  watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  position REAL,
  duration REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, entry_key)
);

-- The latest activity per title; drives Continue Watching. A removed row is a
-- tombstone so dismissing a title syncs to every device.
CREATE TABLE watch_titles (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  media_id INTEGER NOT NULL CHECK (media_id > 0),
  season_number INTEGER,
  episode_number INTEGER,
  item_json TEXT,
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, media_type, media_id)
);

CREATE INDEX watch_titles_account_updated_idx ON watch_titles(account_id, updated_at DESC);
