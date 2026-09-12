"""Conflict-safe synchronisation of user-owned data.

The contract, shared with packages/gita-types:

  * Every record is keyed by a client-generated UUID, so a bookmark created on
    a plane keeps its identity when it reaches the server.
  * Every record carries a monotonic `revision`. A push whose revision is not
    greater than the stored one is rejected as stale and the server's version is
    returned, so the client can reconcile without a full refetch.
  * Deletes are tombstones, so a deletion propagates instead of the row simply
    reappearing from another device.
  * Push and pull happen in one round trip: the response carries both the
    conflicts and everything the client had not yet seen.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from gita_api.db.models import (
    Bookmark,
    Collection,
    CollectionItem,
    Highlight,
    MemorizationProgress,
    Note,
    ReadingProgress,
    User,
)
from gita_api.db.session import get_db
from gita_api.schemas.common import ApiModel
from gita_api.security.auth import require_user

router = APIRouter(prefix="/v1/sync", tags=["sync"])

# entity name -> (model, writable columns)
ENTITY_MAP: dict[str, tuple[type, tuple[str, ...]]] = {
    "bookmarks": (Bookmark, ("verse_id", "note")),
    "highlights": (Highlight, ("verse_id", "target", "start_offset", "end_offset", "color")),
    "notes": (Note, ("verse_id", "body", "tags", "is_private")),
    "collections": (Collection, ("name", "description", "color", "sort_order")),
    "collection_items": (CollectionItem, ("collection_id", "verse_id", "position")),
    "reading_progress": (
        ReadingProgress,
        ("chapter_number", "last_verse_number", "verses_read", "completed_at"),
    ),
    "memorization_progress": (
        MemorizationProgress,
        ("verse_id", "stage", "repetitions", "last_reviewed_at", "next_review_at", "hide_level"),
    ),
}

# Entities that belong to a user through a parent row rather than a `user_id`
# column of their own.
INDIRECT_OWNERSHIP = {"collection_items"}


def _owner_id(db: Session, entity: str, row: Any) -> uuid.UUID | None:
    """Who owns this row?

    Returns None only when ownership genuinely cannot be established, which the
    caller must treat as "refuse", never as "allow".
    """
    if entity == "collection_items":
        parent = db.get(Collection, row.collection_id) if row.collection_id else None
        return parent.user_id if parent else None
    return getattr(row, "user_id", None)


def _owns_collection(db: Session, collection_id: Any, user_id: uuid.UUID) -> bool:
    try:
        resolved = (
            collection_id if isinstance(collection_id, uuid.UUID) else uuid.UUID(str(collection_id))
        )
    except (ValueError, TypeError):
        return False
    collection = db.get(Collection, resolved)
    return collection is not None and collection.user_id == user_id


class SyncChangeIn(ApiModel):
    entity: str
    client_id: uuid.UUID
    revision: int = Field(ge=1)
    updated_at: datetime
    deleted: bool = False
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncPushRequest(ApiModel):
    device_id: uuid.UUID
    since: datetime | None = None
    changes: list[SyncChangeIn] = Field(default_factory=list, max_length=500)


class SyncConflictOut(ApiModel):
    entity: str
    client_id: uuid.UUID
    reason: str
    server_state: SyncChangeIn | None = None


class SyncPushResponse(ApiModel):
    cursor: datetime
    accepted: list[uuid.UUID] = Field(default_factory=list)
    conflicts: list[SyncConflictOut] = Field(default_factory=list)
    changes: list[SyncChangeIn] = Field(default_factory=list)


class SyncPullResponse(ApiModel):
    cursor: datetime
    changes: list[SyncChangeIn] = Field(default_factory=list)
    has_more: bool = False


PULL_PAGE_SIZE = 500


@router.post("/push", response_model=SyncPushResponse)
def push(
    payload: SyncPushRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_user)],
) -> SyncPushResponse:
    accepted: list[uuid.UUID] = []
    conflicts: list[SyncConflictOut] = []

    for change in payload.changes:
        entry = ENTITY_MAP.get(change.entity)
        if entry is None:
            conflicts.append(
                SyncConflictOut(
                    entity=change.entity,
                    client_id=change.client_id,
                    reason="validation_failed",
                )
            )
            continue

        model, columns = entry
        existing = db.get(model, change.client_id)

        # Never let one account's push touch another account's row, even if it
        # somehow guessed the id. Ownership is resolved per entity, because a
        # collection item has no `user_id` of its own.
        if existing is not None and _owner_id(db, change.entity, existing) != user.id:
            conflicts.append(
                SyncConflictOut(
                    entity=change.entity, client_id=change.client_id, reason="validation_failed"
                )
            )
            continue

        # Creating a collection item means claiming a slot in a collection, so
        # the parent has to belong to the caller.
        if (
            change.entity == "collection_items"
            and existing is None
            and not _owns_collection(db, change.payload.get("collection_id"), user.id)
        ):
            conflicts.append(
                SyncConflictOut(
                    entity=change.entity,
                    client_id=change.client_id,
                    reason="validation_failed",
                )
            )
            continue

        if existing is not None and getattr(existing, "revision", 0) >= change.revision:
            conflicts.append(
                SyncConflictOut(
                    entity=change.entity,
                    client_id=change.client_id,
                    reason="stale_revision",
                    server_state=_to_change(change.entity, existing, columns),
                )
            )
            continue

        if existing is None:
            if change.deleted:
                # Deleting something the server never saw is already the
                # desired end state.
                accepted.append(change.client_id)
                continue
            existing = model(id=change.client_id)
            if hasattr(existing, "user_id"):
                existing.user_id = user.id
            db.add(existing)

        try:
            _apply(existing, columns, change.payload)
        except (TypeError, ValueError):
            conflicts.append(
                SyncConflictOut(
                    entity=change.entity, client_id=change.client_id, reason="validation_failed"
                )
            )
            continue

        existing.revision = change.revision
        if hasattr(existing, "deleted_at"):
            existing.deleted_at = change.updated_at if change.deleted else None
        accepted.append(change.client_id)

    db.flush()
    cursor = datetime.now(UTC)
    remote_changes = _collect_since(db, user, payload.since) if payload.since else []

    return SyncPushResponse(
        cursor=cursor, accepted=accepted, conflicts=conflicts, changes=remote_changes
    )


@router.get("/pull", response_model=SyncPullResponse)
def pull(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_user)],
    since: Annotated[datetime | None, Query()] = None,
) -> SyncPullResponse:
    changes = _collect_since(db, user, since)
    return SyncPullResponse(
        cursor=datetime.now(UTC),
        changes=changes[:PULL_PAGE_SIZE],
        has_more=len(changes) > PULL_PAGE_SIZE,
    )


def _collect_since(db: Session, user: User, since: datetime | None) -> list[SyncChangeIn]:
    collected: list[SyncChangeIn] = []
    for entity, (model, columns) in ENTITY_MAP.items():
        if entity in INDIRECT_OWNERSHIP:
            # Scoped through the parent collection, which is where ownership
            # actually lives.
            stmt = (
                select(model)
                .join(Collection, Collection.id == model.collection_id)
                .where(Collection.user_id == user.id)
            )
        else:
            stmt = select(model).where(model.user_id == user.id)

        if since is not None:
            stmt = stmt.where(model.updated_at > since)
        for row in db.execute(stmt.limit(PULL_PAGE_SIZE)).scalars():
            collected.append(_to_change(entity, row, columns))
    collected.sort(key=lambda c: c.updated_at)
    return collected


def _to_change(entity: str, row: Any, columns: tuple[str, ...]) -> SyncChangeIn:
    return SyncChangeIn(
        entity=entity,
        client_id=row.id,
        revision=getattr(row, "revision", 1),
        updated_at=row.updated_at,
        deleted=getattr(row, "deleted_at", None) is not None,
        payload={column: _serialise(getattr(row, column, None)) for column in columns},
    )


def _serialise(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _apply(row: Any, columns: tuple[str, ...], payload: dict[str, Any]) -> None:
    """Copy only whitelisted columns.

    A client cannot set `user_id`, `revision` or timestamps directly — that is
    what keeps a malicious payload from reassigning ownership of a row.
    """
    for column in columns:
        if column not in payload:
            continue
        value = payload[column]
        if column.endswith("_id") and isinstance(value, str) and value:
            value = uuid.UUID(value)
        if column.endswith("_at") and isinstance(value, str) and value:
            value = datetime.fromisoformat(value)
        setattr(row, column, value)
