CREATE TABLE stream_resolution_cache (
  source_url TEXT PRIMARY KEY,
  extracted_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX stream_resolution_cache_expiry_idx ON stream_resolution_cache(expires_at);
