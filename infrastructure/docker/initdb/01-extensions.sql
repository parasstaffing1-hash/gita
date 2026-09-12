-- Extensions required by the Gita platform.
-- Runs once, on first container start (empty data directory).
--
--   vector   -> semantic retrieval for "Ask the Gita"
--   pg_trgm  -> fuzzy matching for transliteration variants (krsna / krishn / ...)
--   unaccent -> diacritic folding (Kṛṣṇa -> krsna)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- A text search configuration that folds accents before stemming, so
-- "Kṛṣṇa" and "Krishna" land in the same lexeme bucket.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'gita_simple') THEN
        CREATE TEXT SEARCH CONFIGURATION gita_simple (COPY = simple);
        ALTER TEXT SEARCH CONFIGURATION gita_simple
            ALTER MAPPING FOR hword, hword_part, word
            WITH unaccent, simple;
    END IF;
END
$$;
