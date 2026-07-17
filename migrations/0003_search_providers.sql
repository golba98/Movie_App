CREATE TABLE search_providers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  movie_url_pattern TEXT NOT NULL,
  tv_url_pattern TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO search_providers (id, label, base_url, movie_url_pattern, tv_url_pattern, is_active, created_at, updated_at)
VALUES (
  'flixbaba-default',
  'Flixbaba',
  'https://flixbaba.mov',
  '{baseUrl}/movie/{tmdbId}/{slug}/watch',
  '{baseUrl}/tv/{tmdbId}/{slug}',
  1,
  1784260242757,
  1784260242757
);

INSERT INTO search_providers (id, label, base_url, movie_url_pattern, tv_url_pattern, is_active, created_at, updated_at)
VALUES (
  'soap2day-default',
  'Soap2Day',
  'https://ww25.soap2day.day',
  '{baseUrl}/movie/{tmdbId}/{slug}',
  '{baseUrl}/tv/{tmdbId}/{slug}',
  1,
  1784260242757,
  1784260242757
);
