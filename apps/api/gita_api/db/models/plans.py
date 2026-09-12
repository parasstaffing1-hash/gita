"""Reading plans and the daily verse.

Daily verses are scheduled editorially (a row per calendar date), not chosen at
random at request time, so every device shows the same verse and the reflection
can be written and reviewed in advance.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gita_api.db.base import Base, RevisionMixin, TimestampMixin, UUIDMixin

PLAN_LEVELS = ("beginner", "intermediate", "advanced")


class ReadingPlan(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "reading_plans"

    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    title_hindi: Mapped[str | None] = mapped_column(String(200))
    subtitle: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="beginner")
    cover_image_url: Mapped[str | None] = mapped_column(String(1000))
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    verification_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )

    days: Mapped[list[ReadingPlanDay]] = relationship(
        back_populates="plan", order_by="ReadingPlanDay.day_number", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(f"level IN {PLAN_LEVELS}", name="plan_level_valid"),
        CheckConstraint("duration_days >= 1", name="plan_duration_positive"),
    )


class ReadingPlanDay(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "reading_plan_days"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reading_plans.id", ondelete="CASCADE"), nullable=False
    )
    day_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    intro: Mapped[str | None] = mapped_column(Text)
    # Verse refs kept denormalised ("2.47") so a plan day survives content
    # re-imports that regenerate verse UUIDs.
    verse_refs: Mapped[list[str]] = mapped_column(
        ARRAY(String(16)), nullable=False, default=list, server_default="{}"
    )
    reflection: Mapped[str | None] = mapped_column(Text)
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=10)

    plan: Mapped[ReadingPlan] = relationship(back_populates="days")

    __table_args__ = (
        UniqueConstraint("plan_id", "day_number", name="uq_reading_plan_days_plan_id_day_number"),
        CheckConstraint("day_number >= 1", name="day_number_positive"),
    )


class UserPlanProgress(Base, UUIDMixin, TimestampMixin, RevisionMixin):
    __tablename__ = "user_plan_progress"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reading_plans.id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_days: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), nullable=False, default=list, server_default="{}"
    )
    current_day: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    plan: Mapped[ReadingPlan] = relationship()

    __table_args__ = (
        UniqueConstraint("user_id", "plan_id", name="uq_user_plan_progress_user_id_plan_id"),
    )


class DailyVerse(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "daily_verses"

    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="RESTRICT"), nullable=False
    )
    # Written and reviewed by an editor. Never model output.
    reflection: Mapped[str | None] = mapped_column(Text)
    reflection_hindi: Mapped[str | None] = mapped_column(Text)
    audio_track_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("audio_tracks.id", ondelete="SET NULL")
    )
    related_verse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="SET NULL")
    )
    verification_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )

    __table_args__ = (Index("ix_daily_verses_date", "scheduled_date"),)
