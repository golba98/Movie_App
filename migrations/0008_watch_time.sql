-- Real playback time per movie or episode, counted by the player's watcher.
-- A title enters history after 5 minutes of it and is marked watched once it
-- covers 90% of the runtime.
ALTER TABLE watch_entries ADD COLUMN watch_seconds REAL NOT NULL DEFAULT 0;
