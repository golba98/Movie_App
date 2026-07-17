CREATE TABLE media_sources (
  id TEXT PRIMARY KEY,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
  season_number INTEGER NOT NULL DEFAULT 0 CHECK (season_number >= 0),
  episode_number INTEGER NOT NULL DEFAULT 0 CHECK (episode_number >= 0),
  label TEXT NOT NULL,
  source_url TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('video/mp4', 'video/webm')),
  rights_basis TEXT NOT NULL CHECK (rights_basis IN ('owned', 'licensed', 'public-domain')),
  rights_note TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (media_type = 'movie' AND season_number = 0 AND episode_number = 0) OR
    (media_type = 'tv' AND season_number > 0 AND episode_number > 0)
  ),
  UNIQUE (media_type, tmdb_id, season_number, episode_number)
);

CREATE INDEX media_sources_lookup_idx
  ON media_sources(media_type, tmdb_id, is_active, season_number, episode_number);

CREATE INDEX media_sources_updated_idx ON media_sources(updated_at DESC);
