"""Search index tables.

Everything stays inside PostgreSQL: `tsvector` for full-text, `pg_trgm` for
fuzzy transliteration matching, and `pgvector` for semantic retrieval. No
Elasticsearch, no separate vector database.

`search_documents` is a denormalised projection of canonical content. It is
rebuilt by services/search; it is never a source of truth.
"""

from __future__ import annotations

import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from gita_api.config import settings
from gita_api.db.base import Base, TimestampMixin, UUIDMixin

DOCUMENT_KINDS = ("verse", "translation", "commentary", "glossary", "topic", "chapter")


class SearchDocument(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "search_documents"

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    verse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE")
    )
    # Pointer for non-verse documents (glossary term, topic, chapter).
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    language_code: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    title: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Diacritic-free, transliteration-folded text. This is what pg_trgm matches,
    # which is why "krsna", "krishn" and "Kṛṣṇa" all find the same rows.
    search_key: Mapped[str] = mapped_column(Text, nullable=False)
    tsv: Mapped[str | None] = mapped_column(TSVECTOR)
    # Editorial boost, e.g. key verses rank above incidental mentions.
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    # Only published/verified content is retrievable by the AI pipeline.
    verification_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )

    __table_args__ = (
        CheckConstraint(f"kind IN {DOCUMENT_KINDS}", name="search_document_kind_valid"),
        # NULLS NOT DISTINCT matters: a "verse" document has a NULL entity_id,
        # and with the default NULL semantics every re-index would insert a new
        # row instead of updating the existing one.
        Index(
            "uq_search_documents_identity",
            "kind",
            "verse_id",
            "entity_id",
            "language_code",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_search_documents_tsv", "tsv", postgresql_using="gin"),
        Index(
            "ix_search_documents_search_key_trgm",
            "search_key",
            postgresql_using="gin",
            postgresql_ops={"search_key": "gin_trgm_ops"},
        ),
        Index("ix_search_documents_kind_language", "kind", "language_code"),
        Index("ix_search_documents_verse", "verse_id"),
    )


class Embedding(Base, UUIDMixin, TimestampMixin):
    """Vector for one search document.

    Dimensions come from settings, so swapping the embedding model is a config
    change plus a re-index rather than a schema migration. Vectors from
    different models are not comparable, which is why `model_name` is part of
    the uniqueness key and every query filters on it.
    """

    __tablename__ = "embeddings"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("search_documents.id", ondelete="CASCADE"), nullable=False
    )
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    dimensions: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(
        Vector(settings.embedding_dimensions), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("document_id", "model_name", name="uq_embeddings_document_id_model_name"),
        Index("ix_embeddings_model", "model_name"),
    )
