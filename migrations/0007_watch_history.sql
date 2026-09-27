-- Per-account watch history so progress and watched flags follow the viewer
-- across devices. Rows are last-write-wins on updated_at.
CREATE TABLE watch_history (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entry_key TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  media_id INTEGER NOT NULL CHECK (media_id > 0),
  season_number INTEGER,
  episode_number INTEGER,
  watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  position REAL,
  duration REAL,
  watch_seconds REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, entry_key)
);

CREATE INDEX watch_history_account_updated_idx ON watch_history(account_id, updated_at DESC);

-- The latest activity per title; drives Continue Watching. dismissed is a
-- tombstone so removing a title on one device is not undone by another.
CREATE TABLE watch_titles (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  media_id INTEGER NOT NULL CHECK (media_id > 0),
  season_number INTEGER,
  episode_number INTEGER,
  item TEXT,
  dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, media_type, media_id)
);

CREATE INDEX watch_titles_account_updated_idx ON watch_titles(account_id, updated_at DESC);
