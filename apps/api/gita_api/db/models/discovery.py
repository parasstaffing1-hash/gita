"""Topics, life situations and related-verse graph.

Topic -> verse mappings are curated editorial data, never computed at request
time. That is what makes "Explore by life situation" trustworthy: a human chose
every verse on the anger page.
"""

from __future__ import annotations

import uuid

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
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gita_api.db.base import Base, TimestampMixin, UUIDMixin

TOPIC_CATEGORIES = ("emotion", "life", "practice", "concept")
RELATION_TYPES = ("thematic", "continuation", "contrast", "reference", "parallel")


class Topic(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "topics"

    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_hindi: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(60))
    short_description: Mapped[str | None] = mapped_column(Text)
    introduction: Mapped[str | None] = mapped_column(Text)
    introduction_hindi: Mapped[str | None] = mapped_column(Text)
    related_concepts: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    related_topic_slugs: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="RESTRICT")
    )
    verification_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )

    verse_links: Mapped[list[VerseTopic]] = relationship(
        back_populates="topic", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(f"category IN {TOPIC_CATEGORIES}", name="topic_category_valid"),
        Index("ix_topics_category", "category"),
    )


class VerseTopic(Base, UUIDMixin, TimestampMixin):
    """Curated mapping between a verse and a topic."""

    __tablename__ = "verse_topics"

    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id", ondelete="CASCADE"), nullable=False
    )
    # Editorial weight, 0..1. Used to order a topic page and to boost search.
    relevance: Mapped[float] = mapped_column(Float, nullable=False, default=0.8)
    note: Mapped[str | None] = mapped_column(Text)
    curated_by: Mapped[str | None] = mapped_column(String(200))

    topic: Mapped[Topic] = relationship(back_populates="verse_links")

    __table_args__ = (
        UniqueConstraint("verse_id", "topic_id", name="uq_verse_topics_verse_id_topic_id"),
        CheckConstraint("relevance >= 0 AND relevance <= 1", name="relevance_range"),
        Index("ix_verse_topics_topic_relevance", "topic_id", "relevance"),
    )


class RelatedVerse(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "related_verses"

    from_verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    to_verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    relation_type: Mapped[str] = mapped_column(String(16), nullable=False, default="thematic")
    note: Mapped[str | None] = mapped_column(Text)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    __table_args__ = (
        UniqueConstraint(
            "from_verse_id", "to_verse_id", "relation_type", name="uq_related_verses_from_verse_id"
        ),
        CheckConstraint("from_verse_id <> to_verse_id", name="no_self_relation"),
        CheckConstraint(f"relation_type IN {RELATION_TYPES}", name="relation_type_valid"),
        Index("ix_related_verses_from", "from_verse_id"),
    )
