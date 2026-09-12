"""Canonical scripture tables.

The hard boundary in this file: nothing here is ever written by the AI service.
`origin` distinguishes canonical scripture from curated editorial text from AI
output, and the API layer refuses to persist `ai_generated` rows into any of
these tables (see gita_api.security.content_guard).
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
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

VERIFICATION_STATUSES = ("draft", "review", "verified", "published")
CONTENT_ORIGINS = ("canonical", "curated", "ai_generated")


def _verification_column(default: str = "draft") -> Mapped[str]:
    return mapped_column(String(16), nullable=False, default=default, server_default=default)


class Language(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "languages"

    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    native_name: Mapped[str] = mapped_column(String(120), nullable=False)
    script: Mapped[str] = mapped_column(String(32), nullable=False, default="latin")
    direction: Mapped[str] = mapped_column(String(3), nullable=False, default="ltr")
    is_ui_language: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_content_language: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)


class ContentLicense(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "content_licenses"

    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(String(500))
    redistributable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_attribution: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    commercial_use_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text)

    sources: Mapped[list[ContentSource]] = relationship(back_populates="license")


class ContentSource(Base, UUIDMixin, TimestampMixin):
    """Provenance for every piece of content. No source, no publication."""

    __tablename__ = "content_sources"

    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(1000))
    author: Mapped[str | None] = mapped_column(String(300))
    publication: Mapped[str | None] = mapped_column(String(300))
    publication_year: Mapped[int | None] = mapped_column(Integer)
    license_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_licenses.id", ondelete="RESTRICT")
    )
    copyright_status: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    date_accessed: Mapped[date | None] = mapped_column(Date)
    reviewer: Mapped[str | None] = mapped_column(String(200))
    verification_notes: Mapped[str | None] = mapped_column(Text)
    # False for development placeholder bundles. Records from a non-authoritative
    # source can never reach `verified`/`published`.
    is_authoritative: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    license: Mapped[ContentLicense | None] = relationship(back_populates="sources")

    __table_args__ = (
        CheckConstraint(
            "copyright_status IN "
            "('public_domain','licensed','permission_granted','proprietary','unknown')",
            name="copyright_status_valid",
        ),
    )


class Chapter(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "chapters"

    number: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    name_sanskrit: Mapped[str | None] = mapped_column(String(300))
    name_transliteration: Mapped[str | None] = mapped_column(String(300))
    name_english: Mapped[str] = mapped_column(String(300), nullable=False)
    name_hindi: Mapped[str | None] = mapped_column(String(300))
    verse_count: Mapped[int] = mapped_column(Integer, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    summary_hindi: Mapped[str | None] = mapped_column(Text)
    major_teachings: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    key_concepts: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    key_verse_refs: Mapped[list[str]] = mapped_column(
        ARRAY(String(16)), nullable=False, default=list, server_default="{}"
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="RESTRICT")
    )
    verification_status: Mapped[str] = _verification_column()

    verses: Mapped[list[Verse]] = relationship(
        back_populates="chapter", order_by="Verse.number", cascade="all, delete-orphan"
    )
    source: Mapped[ContentSource | None] = relationship()

    __table_args__ = (
        CheckConstraint("number BETWEEN 1 AND 18", name="chapter_number_range"),
        CheckConstraint(
            f"verification_status IN {VERIFICATION_STATUSES}", name="verification_status_valid"
        ),
    )


class Verse(Base, UUIDMixin, TimestampMixin):
    """One verse. `(chapter_id, number)` is unique — this is the anchor of the
    whole product, so it is enforced by the database, not by application code."""

    __tablename__ = "verses"

    chapter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False
    )
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    # Set for merged verses printed as a block, e.g. 1.32-35.
    number_end: Mapped[int | None] = mapped_column(Integer)
    slug: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    # Sequential position across the whole Gita, 1..700. Makes prev/next a
    # single indexed lookup instead of a chapter-boundary branch.
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker: Mapped[str | None] = mapped_column(String(120))
    verification_status: Mapped[str] = _verification_column()

    chapter: Mapped[Chapter] = relationship(back_populates="verses")
    text_versions: Mapped[list[VerseTextVersion]] = relationship(
        back_populates="verse", cascade="all, delete-orphan"
    )
    translations: Mapped[list[Translation]] = relationship(
        back_populates="verse", cascade="all, delete-orphan"
    )
    transliterations: Mapped[list[TransliterationVersion]] = relationship(
        back_populates="verse", cascade="all, delete-orphan"
    )
    commentaries: Mapped[list[Commentary]] = relationship(
        back_populates="verse", cascade="all, delete-orphan"
    )
    words: Mapped[list[VerseWord]] = relationship(
        back_populates="verse", order_by="VerseWord.position", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("chapter_id", "number", name="uq_verses_chapter_id_number"),
        UniqueConstraint("chapter_number", "number", name="uq_verses_chapter_number_number"),
        UniqueConstraint("ordinal", name="uq_verses_ordinal"),
        CheckConstraint("number >= 1", name="verse_number_positive"),
        CheckConstraint(
            "number_end IS NULL OR number_end > number", name="verse_number_end_after_start"
        ),
        Index("ix_verses_chapter_number_number", "chapter_number", "number"),
    )


class VerseTextVersion(Base, UUIDMixin, TimestampMixin):
    """The scripture text itself, in a given script, from a given source."""

    __tablename__ = "verse_text_versions"

    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    script: Mapped[str] = mapped_column(String(24), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # SHA-256 over NFC-normalised, whitespace-collapsed text. Drift detector.
    canonical_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verification_status: Mapped[str] = _verification_column()

    verse: Mapped[Verse] = relationship(back_populates="text_versions")
    source: Mapped[ContentSource | None] = relationship()

    __table_args__ = (
        UniqueConstraint(
            "verse_id", "script", "source_id", "version", name="uq_verse_text_versions_verse_id"
        ),
        Index("ix_verse_text_versions_hash", "canonical_hash"),
    )


class TransliterationVersion(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "transliteration_versions"

    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    scheme: Mapped[str] = mapped_column(String(16), nullable=False, default="iast")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    verification_status: Mapped[str] = _verification_column()

    verse: Mapped[Verse] = relationship(back_populates="transliterations")
    source: Mapped[ContentSource | None] = relationship()

    __table_args__ = (
        UniqueConstraint(
            "verse_id",
            "scheme",
            "source_id",
            "version",
            name="uq_transliteration_versions_verse_id",
        ),
    )


class Translation(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "translations"

    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    language_code: Mapped[str] = mapped_column(String(16), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    translator_name: Mapped[str | None] = mapped_column(String(300))
    style: Mapped[str | None] = mapped_column(String(24))
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    origin: Mapped[str] = mapped_column(
        String(16), nullable=False, default="canonical", server_default="canonical"
    )
    verification_status: Mapped[str] = _verification_column()

    verse: Mapped[Verse] = relationship(back_populates="translations")
    source: Mapped[ContentSource | None] = relationship()

    __table_args__ = (
        UniqueConstraint(
            "verse_id", "language_code", "source_id", "version", name="uq_translations_verse_id"
        ),
        CheckConstraint(f"origin IN {CONTENT_ORIGINS}", name="origin_valid"),
        Index("ix_translations_verse_language", "verse_id", "language_code"),
    )


class Commentator(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "commentators"

    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    name_sanskrit: Mapped[str | None] = mapped_column(String(300))
    tradition: Mapped[str | None] = mapped_column(String(200))
    period: Mapped[str | None] = mapped_column(String(120))
    bio: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)

    commentaries: Mapped[list[Commentary]] = relationship(back_populates="commentator")


class Commentary(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "commentaries"

    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    commentator_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("commentators.id", ondelete="SET NULL")
    )
    language_code: Mapped[str] = mapped_column(String(16), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    origin: Mapped[str] = mapped_column(
        String(16), nullable=False, default="canonical", server_default="canonical"
    )
    verification_status: Mapped[str] = _verification_column()
    # Only approved commentary is eligible for AI retrieval.
    approved_for_ai: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    verse: Mapped[Verse] = relationship(back_populates="commentaries")
    commentator: Mapped[Commentator | None] = relationship(back_populates="commentaries")
    source: Mapped[ContentSource | None] = relationship()

    __table_args__ = (
        UniqueConstraint(
            "verse_id",
            "commentator_id",
            "language_code",
            "version",
            name="uq_commentaries_verse_id",
        ),
        CheckConstraint(f"origin IN {CONTENT_ORIGINS}", name="origin_valid"),
        Index("ix_commentaries_verse", "verse_id"),
    )


class SanskritTerm(Base, UUIDMixin, TimestampMixin):
    """A Sanskrit lexeme as it appears in the text, linked from word meanings."""

    __tablename__ = "sanskrit_terms"

    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    term_devanagari: Mapped[str] = mapped_column(String(200), nullable=False)
    term_iast: Mapped[str] = mapped_column(String(200), nullable=False)
    # Diacritic-free, folded form used for fuzzy lookup (krsna, atman).
    search_key: Mapped[str] = mapped_column(String(200), nullable=False)
    root: Mapped[str | None] = mapped_column(String(200))
    part_of_speech: Mapped[str | None] = mapped_column(String(64))
    gloss_english: Mapped[str | None] = mapped_column(Text)
    gloss_hindi: Mapped[str | None] = mapped_column(Text)
    glossary_term_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("glossary_terms.id", ondelete="SET NULL")
    )

    __table_args__ = (Index("ix_sanskrit_terms_search_key", "search_key"),)


class VerseWord(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "verse_words"

    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    word_devanagari: Mapped[str] = mapped_column(String(200), nullable=False)
    word_transliteration: Mapped[str | None] = mapped_column(String(200))
    meaning_english: Mapped[str | None] = mapped_column(Text)
    meaning_hindi: Mapped[str | None] = mapped_column(Text)
    grammar_note: Mapped[str | None] = mapped_column(Text)
    sanskrit_term_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sanskrit_terms.id", ondelete="SET NULL")
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="RESTRICT")
    )
    verification_status: Mapped[str] = _verification_column()

    verse: Mapped[Verse] = relationship(back_populates="words")
    sanskrit_term: Mapped[SanskritTerm | None] = relationship()

    __table_args__ = (
        UniqueConstraint("verse_id", "position", name="uq_verse_words_verse_id_position"),
    )


class GlossaryTerm(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "glossary_terms"

    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    term_sanskrit: Mapped[str] = mapped_column(String(200), nullable=False)
    term_transliteration: Mapped[str] = mapped_column(String(200), nullable=False)
    term_english: Mapped[str | None] = mapped_column(String(200))
    search_key: Mapped[str] = mapped_column(String(200), nullable=False)
    simple_definition: Mapped[str] = mapped_column(Text, nullable=False)
    detailed_definition: Mapped[str | None] = mapped_column(Text)
    variants: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    synonyms: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    related_term_slugs: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    related_verse_refs: Mapped[list[str]] = mapped_column(
        ARRAY(String(16)), nullable=False, default=list, server_default="{}"
    )
    source_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )
    verification_status: Mapped[str] = _verification_column()

    __table_args__ = (Index("ix_glossary_terms_search_key", "search_key"),)
