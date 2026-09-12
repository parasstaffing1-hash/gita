"""Declarative base and the mixins every table shares."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, MetaData, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Explicit, predictable constraint names so Alembic can autogenerate stable
# migrations and so dropping a constraint by name is possible on any database.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    return datetime.now(UTC)


class UUIDMixin:
    """Primary keys are UUIDs.

    Records are created on-device while offline and pushed later, so the client
    must be able to mint an id that stays valid on the server.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=utcnow,
    )


class SoftDeleteMixin:
    """Sync-safe deletion.

    A row deleted on one device must be able to reach every other device, so
    deletes are tombstones. A background job hard-deletes tombstones older than
    the retention window.
    """

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class RevisionMixin:
    """Monotonic per-record counter used for last-writer-wins conflict checks."""

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
