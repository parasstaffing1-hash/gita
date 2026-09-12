"""Admin users, editorial review, and the canonical change log.

Every canonical edit writes a `content_change_log` row holding the previous and
new value, the editor, the reason and the source. That row is what makes
rollback possible and what an auditor reads to answer "who changed 2.47, when,
and on what authority?".
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gita_api.db.base import Base, TimestampMixin, UUIDMixin

ADMIN_ROLES = ("viewer", "editor", "reviewer", "admin")
CHANGE_ACTIONS = ("create", "update", "delete", "publish", "unpublish", "rollback")
REVIEW_STATUSES = ("pending", "approved", "changes_requested", "rejected")


class AdminUser(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "admin_users"

    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (CheckConstraint(f"role IN {ADMIN_ROLES}", name="admin_role_valid"),)


class ContentChangeLog(Base, UUIDMixin, TimestampMixin):
    """Append-only audit trail for canonical content."""

    __tablename__ = "content_change_log"

    table_name: Mapped[str] = mapped_column(String(64), nullable=False)
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # Human-readable anchor, e.g. "2.47" — survives even if the row is deleted.
    record_ref: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    field_name: Mapped[str | None] = mapped_column(String(64))
    previous_value: Mapped[dict | None] = mapped_column(JSONB)
    new_value: Mapped[dict | None] = mapped_column(JSONB)
    editor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    editor_email: Mapped[str | None] = mapped_column(String(320))
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="SET NULL")
    )
    review_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending", server_default="pending"
    )
    # Points at the change this one reverted, when action = 'rollback'.
    reverted_change_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_change_log.id", ondelete="SET NULL")
    )

    editor: Mapped[AdminUser | None] = relationship()

    __table_args__ = (
        CheckConstraint(f"action IN {CHANGE_ACTIONS}", name="change_action_valid"),
        CheckConstraint("length(reason) >= 3", name="change_reason_required"),
        Index("ix_content_change_log_record", "table_name", "record_id", "created_at"),
        Index("ix_content_change_log_created", "created_at"),
    )


class ContentReview(Base, UUIDMixin, TimestampMixin):
    """A review request moving a record through draft -> review -> verified."""

    __tablename__ = "content_reviews"

    table_name: Mapped[str] = mapped_column(String(64), nullable=False)
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    record_ref: Mapped[str | None] = mapped_column(String(64))
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    notes: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(f"status IN {REVIEW_STATUSES}", name="review_status_valid"),
        Index("ix_content_reviews_status", "status", "created_at"),
        Index("ix_content_reviews_record", "table_name", "record_id"),
    )
