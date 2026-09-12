"""User accounts and user-owned content.

Sign-in is optional. Everything here has a client-generated UUID primary key
and a `revision` counter so a record created offline keeps its identity when it
finally syncs, and so a stale write can be detected instead of silently winning.

Notes are private by default and are never included in AI provider requests
unless the user explicitly asks a question about a specific note.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gita_api.db.base import Base, RevisionMixin, SoftDeleteMixin, TimestampMixin, UUIDMixin

HIGHLIGHT_COLORS = ("saffron", "gold", "sage", "sky", "rose")
HIGHLIGHT_TARGETS = ("sanskrit", "transliteration", "translation", "commentary")
MEMORIZATION_STAGES = ("not_started", "learning", "reviewing", "memorized")


class User(Base, UUIDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"

    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Null for OAuth-only accounts. Argon2/bcrypt hash — never a plaintext password.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # Provider identity, e.g. ("google", "1043..."). Ready for Google/Apple sign-in.
    auth_provider: Mapped[str | None] = mapped_column(String(32))
    auth_provider_subject: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    profile: Mapped[Profile | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint(
            "auth_provider", "auth_provider_subject", name="uq_users_auth_provider_subject"
        ),
        CheckConstraint(
            "email IS NOT NULL OR auth_provider IS NOT NULL", name="user_needs_an_identity"
        ),
    )


class Profile(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    display_name: Mapped[str | None] = mapped_column(String(120))
    avatar_url: Mapped[str | None] = mapped_column(String(1000))
    ui_language: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    content_languages: Mapped[list[str]] = mapped_column(
        ARRAY(String(16)), nullable=False, default=lambda: ["en"], server_default='{"en"}'
    )
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Kolkata")
    # Reader preferences, validated against @gita/validation before write.
    reader_preferences: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_active_date: Mapped[str | None] = mapped_column(String(10))

    user: Mapped[User] = relationship(back_populates="profile")


class Bookmark(Base, UUIDMixin, TimestampMixin, SoftDeleteMixin, RevisionMixin):
    __tablename__ = "bookmarks"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("user_id", "verse_id", name="uq_bookmarks_user_id_verse_id"),
        Index("ix_bookmarks_user_updated", "user_id", "updated_at"),
    )


class Highlight(Base, UUIDMixin, TimestampMixin, SoftDeleteMixin, RevisionMixin):
    __tablename__ = "highlights"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    target: Mapped[str] = mapped_column(String(24), nullable=False, default="translation")
    start_offset: Mapped[int | None] = mapped_column(Integer)
    end_offset: Mapped[int | None] = mapped_column(Integer)
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="saffron")

    __table_args__ = (
        CheckConstraint(f"color IN {HIGHLIGHT_COLORS}", name="highlight_color_valid"),
        CheckConstraint(f"target IN {HIGHLIGHT_TARGETS}", name="highlight_target_valid"),
        CheckConstraint(
            "start_offset IS NULL OR end_offset IS NULL OR end_offset > start_offset",
            name="highlight_range_valid",
        ),
        Index("ix_highlights_user_updated", "user_id", "updated_at"),
        Index("ix_highlights_verse", "verse_id"),
    )


class Note(Base, UUIDMixin, TimestampMixin, SoftDeleteMixin, RevisionMixin):
    __tablename__ = "notes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    verse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE")
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    # Private notes are excluded from every analytics event and AI prompt.
    is_private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (
        Index("ix_notes_user_updated", "user_id", "updated_at"),
        Index("ix_notes_verse", "verse_id"),
    )


class Collection(Base, UUIDMixin, TimestampMixin, SoftDeleteMixin, RevisionMixin):
    __tablename__ = "collections"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(9))
    # System collections (Favorites, Memorize) are created for every account.
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)

    items: Mapped[list[CollectionItem]] = relationship(
        back_populates="collection", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_collections_user_id_name"),
        Index("ix_collections_user_updated", "user_id", "updated_at"),
    )


class CollectionItem(Base, UUIDMixin, TimestampMixin, SoftDeleteMixin, RevisionMixin):
    __tablename__ = "collection_items"

    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), nullable=False
    )
    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    collection: Mapped[Collection] = relationship(back_populates="items")

    __table_args__ = (
        UniqueConstraint(
            "collection_id", "verse_id", name="uq_collection_items_collection_id_verse_id"
        ),
    )


class ReadingProgress(Base, UUIDMixin, TimestampMixin, RevisionMixin):
    """Where the reader is, per chapter. One row per user per chapter."""

    __tablename__ = "reading_progress"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)
    last_verse_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    verses_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint(
            "user_id", "chapter_number", name="uq_reading_progress_user_id_chapter_number"
        ),
        CheckConstraint("chapter_number BETWEEN 1 AND 18", name="chapter_number_range"),
    )


class ReadingSession(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "reading_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verses_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="mobile")
    local_date: Mapped[str] = mapped_column(String(10), nullable=False)

    __table_args__ = (Index("ix_reading_sessions_user_date", "user_id", "local_date"),)


class MemorizationProgress(Base, UUIDMixin, TimestampMixin, RevisionMixin):
    """Memorisation state.

    The SM-2 fields (`ease_factor`, `interval_days`, `next_review_at`) exist now
    and are maintained, so full spaced repetition can be switched on later
    without a data migration.
    """

    __tablename__ = "memorization_progress"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE"), nullable=False
    )
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="learning")
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ease_factor: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # How much of the Sanskrit is currently hidden, 0..100.
    hide_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("user_id", "verse_id", name="uq_memorization_progress_user_id_verse_id"),
        CheckConstraint(f"stage IN {MEMORIZATION_STAGES}", name="memorization_stage_valid"),
        CheckConstraint("hide_level BETWEEN 0 AND 100", name="hide_level_range"),
        Index("ix_memorization_next_review", "user_id", "next_review_at"),
    )


class NotificationPreferences(Base, UUIDMixin, TimestampMixin, RevisionMixin):
    __tablename__ = "notifications_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    morning_verse_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    morning_verse_time: Mapped[str] = mapped_column(String(5), nullable=False, default="07:00")
    evening_reflection_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    evening_reflection_time: Mapped[str] = mapped_column(String(5), nullable=False, default="20:00")
    reading_plan_reminder_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    reading_plan_reminder_time: Mapped[str] = mapped_column(
        String(5), nullable=False, default="19:00"
    )
    custom_reminder_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    custom_reminder_time: Mapped[str | None] = mapped_column(String(5))
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Kolkata")
    push_tokens: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
