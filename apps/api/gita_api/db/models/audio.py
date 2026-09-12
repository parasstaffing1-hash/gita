"""Audio tracks and per-user download bookkeeping.

Files live in Cloudflare R2; the database stores only the object key plus
metadata. `is_synthetic` is mandatory and surfaced in the UI — synthesised
speech is never presented as canonical recitation.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gita_api.db.base import Base, TimestampMixin, UUIDMixin

AUDIO_KINDS = ("verse", "chapter", "reflection", "intro")


class AudioTrack(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "audio_tracks"

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    verse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="CASCADE")
    )
    chapter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chapters.id", ondelete="CASCADE")
    )
    chapter_number: Mapped[int | None] = mapped_column(Integer)
    verse_number: Mapped[int | None] = mapped_column(Integer)
    language_code: Mapped[str] = mapped_column(String(16), nullable=False, default="sa")
    reciter: Mapped[str | None] = mapped_column(String(200))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Key inside the R2 bucket, e.g. "audio/sa/verse/02/047.mp3".
    object_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False, default="audio/mpeg")
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    license_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_licenses.id", ondelete="RESTRICT")
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="RESTRICT")
    )
    verification_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )

    downloads: Mapped[list[AudioDownload]] = relationship(
        back_populates="track", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(f"kind IN {AUDIO_KINDS}", name="audio_kind_valid"),
        CheckConstraint(
            "(kind <> 'verse') OR (verse_id IS NOT NULL)", name="verse_audio_needs_verse"
        ),
        CheckConstraint(
            "(kind <> 'chapter') OR (chapter_id IS NOT NULL)", name="chapter_audio_needs_chapter"
        ),
        Index("ix_audio_tracks_chapter_verse", "chapter_number", "verse_number"),
        Index("ix_audio_tracks_kind_language", "kind", "language_code"),
    )


class AudioDownload(Base, UUIDMixin, TimestampMixin):
    """What a device has cached locally, so the app can show storage usage and
    resume interrupted chapter downloads."""

    __tablename__ = "audio_downloads"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    device_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    audio_track_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("audio_tracks.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    bytes_downloaded: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    track: Mapped[AudioTrack] = relationship(back_populates="downloads")

    __table_args__ = (
        UniqueConstraint(
            "device_id", "audio_track_id", name="uq_audio_downloads_device_id_audio_track_id"
        ),
        CheckConstraint(
            "status IN ('pending','downloading','complete','failed')", name="download_status_valid"
        ),
        Index("ix_audio_downloads_user", "user_id"),
    )
