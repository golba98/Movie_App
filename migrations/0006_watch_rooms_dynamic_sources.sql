-- Watch rooms may reference dynamic sources (id form "dynamic:<provider>:<type>:<tmdbId>")
-- that are synthesised from search_providers at request time and never stored in
-- media_sources. The FOREIGN KEY on media_source_id therefore rejected every dynamic
-- room creation. Rebuild watch_rooms without that constraint; media_source_id validity
-- is enforced in the worker when the room is created.
PRAGMA defer_foreign_keys = true;

CREATE TABLE watch_rooms_new (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL UNIQUE,
  room_name TEXT NOT NULL,
  creator_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  host_member_id TEXT NOT NULL,
  host_name TEXT NOT NULL,
  media_source_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
  season_number INTEGER,
  episode_number INTEGER,
  media_title TEXT NOT NULL,
  poster_path TEXT,
  backdrop_path TEXT,
  privacy TEXT NOT NULL CHECK (privacy IN ('public', 'private', 'invite_only')),
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  max_participants INTEGER NOT NULL CHECK (max_participants BETWEEN 2 AND 25),
  control_mode TEXT NOT NULL CHECK (control_mode IN ('host_only', 'everyone', 'approved', 'request')),
  allow_late_join INTEGER NOT NULL DEFAULT 1 CHECK (allow_late_join IN (0, 1)),
  allow_media_change INTEGER NOT NULL DEFAULT 0 CHECK (allow_media_change IN (0, 1)),
  ready_up_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ready_up_enabled IN (0, 1)),
  start_when_everyone_ready INTEGER NOT NULL DEFAULT 0 CHECK (start_when_everyone_ready IN (0, 1)),
  pause_for_buffering INTEGER NOT NULL DEFAULT 0 CHECK (pause_for_buffering IN (0, 1)),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  invitation_version INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'expired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);

INSERT INTO watch_rooms_new SELECT * FROM watch_rooms;
DROP TABLE watch_rooms;
ALTER TABLE watch_rooms_new RENAME TO watch_rooms;

CREATE INDEX watch_rooms_code_idx ON watch_rooms(room_code, status, expires_at);
CREATE INDEX watch_rooms_creator_idx ON watch_rooms(creator_account_id, created_at DESC);
