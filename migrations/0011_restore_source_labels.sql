-- Restore viewer-facing names while preserving custom provider labels.
UPDATE search_providers SET label = 'Source 1'
WHERE id = 'flixbaba-default' AND label = 'Flixbaba';

UPDATE search_providers SET label = 'Source 2'
WHERE id = 'soap2day-default' AND label = 'Soap2Day';
