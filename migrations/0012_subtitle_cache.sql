-- The English subtitle chosen for each title or episode played through Source 1.
-- `id` is the public handle in /api/subtitles/<id>.vtt and survives a re-pick.
-- A row holds the converted WebVTT `body`, or the `url` of a track bundled with
-- the release, or neither when nothing usable was found (a cached miss).
CREATE TABLE subtitle_cache (
  key TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  body TEXT,
  url TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
