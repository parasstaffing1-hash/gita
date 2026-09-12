"""Enable PostgreSQL extensions and the accent-folding text search config.

Revision ID: 0001_extensions
Revises:
Create Date: 2026-09-04
"""

from __future__ import annotations

from alembic import op

revision = "0001_extensions"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # vector   -> semantic retrieval for Ask the Gita
    # pg_trgm  -> fuzzy transliteration matching (krsna / krishn / Kṛṣṇa)
    # unaccent -> diacritic folding inside the text search configuration
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gin")

    # A configuration that folds accents before indexing, so "Kṛṣṇa" and
    # "Krishna" produce the same lexeme. `simple` (no stemming) is deliberate:
    # English stemming would mangle transliterated Sanskrit.
    op.execute(
        """
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
        """
    )


def downgrade() -> None:
    op.execute("DROP TEXT SEARCH CONFIGURATION IF EXISTS gita_simple")
    # Extensions are intentionally left installed: other schemas in the same
    # database may depend on them.
