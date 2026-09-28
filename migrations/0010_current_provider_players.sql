-- Update only the seeded configuration; preserve administrator overrides.
UPDATE search_providers
SET base_url = 'https://www.flixbaba.best',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 'flixbaba-default' AND base_url = 'https://flixbaba.mov';

-- These are the primary player URLs supplied by Flixbaba's current site.
UPDATE search_providers
SET movie_embed_pattern = 'https://vsembed.ru/embed/movie?tmdb={tmdbId}'
WHERE id = 'flixbaba-default'
  AND movie_embed_pattern = 'https://vidsrc.to/embed/movie/{tmdbId}';

UPDATE search_providers
SET tv_embed_pattern = 'https://vsembed.ru/embed/tv?tmdb={tmdbId}&season={season}&episode={episode}'
WHERE id = 'flixbaba-default'
  AND tv_embed_pattern = 'https://vidsrc.to/embed/tv/{tmdbId}/{season}/{episode}';

-- Soap2Day must resolve its own player, rather than borrowing Flixbaba's.
UPDATE search_providers SET movie_embed_pattern = ''
WHERE id = 'soap2day-default'
  AND movie_embed_pattern = 'https://vidsrc.to/embed/movie/{tmdbId}';
UPDATE search_providers SET tv_embed_pattern = ''
WHERE id = 'soap2day-default'
  AND tv_embed_pattern = 'https://vidsrc.to/embed/tv/{tmdbId}/{season}/{episode}';

UPDATE search_providers SET label = 'Flixbaba'
WHERE id = 'flixbaba-default' AND label = 'Source 1';
UPDATE search_providers SET label = 'Soap2Day'
WHERE id = 'soap2day-default' AND label = 'Source 2';

DELETE FROM stream_resolution_cache
WHERE source_url LIKE 'https://flixbaba.mov/%'
   OR source_url LIKE 'https://ww25.soap2day.day/%';
