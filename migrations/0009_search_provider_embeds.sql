-- Some providers render their player client-side, so their watch pages cannot
-- be scraped. A provider can instead name an embed URL to use directly.
-- Placeholders: {tmdbId}, and for TV {season} and {episode}. Empty means scrape the page.
ALTER TABLE search_providers ADD COLUMN movie_embed_pattern TEXT NOT NULL DEFAULT '';
ALTER TABLE search_providers ADD COLUMN tv_embed_pattern TEXT NOT NULL DEFAULT '';

-- Carry over the rule the Worker previously hardcoded for the two seeded providers.
UPDATE search_providers
SET movie_embed_pattern = 'https://vidsrc.to/embed/movie/{tmdbId}',
    tv_embed_pattern = 'https://vidsrc.to/embed/tv/{tmdbId}/{season}/{episode}'
WHERE base_url LIKE '%flixbaba%' OR base_url LIKE '%soap2day%';

-- Viewers saw these two providers as "Source 1" and "Source 2"; keep that
-- now that labels come from the provider settings rather than the player code.
UPDATE search_providers SET label = 'Source 1' WHERE id = 'flixbaba-default' AND label = 'Flixbaba';
UPDATE search_providers SET label = 'Source 2' WHERE id = 'soap2day-default' AND label = 'Soap2Day';
