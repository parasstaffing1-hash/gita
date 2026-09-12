"""Admin endpoints.

Canonical edits go through here and nowhere else. Every one of them:

  * requires an editor/reviewer/admin identity,
  * writes a `content_change_log` row with the previous value, the new value,
    the editor, the reason and the source,
  * recomputes the canonical hash,
  * refuses to publish content whose source is not marked authoritative.

Rollback replays a logged change in reverse and logs *that* too, so the audit
trail stays complete.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from gita_api.db.models import (
    AdminUser,
    AiAnswer,
    Chapter,
    Commentary,
    ContentChangeLog,
    ContentReview,
    ContentSource,
    Translation,
    Verse,
    VerseTextVersion,
    Wallpaper,
)
from gita_api.db.session import get_db
from gita_api.schemas.common import ApiModel, Paginated
from gita_api.security.auth import require_admin, require_admin_role
from gita_api.security.content_guard import assert_not_ai_generated, assert_publishable
from gita_api.services.media import resolve_audio_url
from gita_api.utils.hashing import canonical_hash

router = APIRouter(prefix="/v1/admin", tags=["admin"])

# Tables an editor may modify through the generic content routes.
EDITABLE: dict[str, tuple[type, tuple[str, ...]]] = {
    "verse_text_versions": (VerseTextVersion, ("text", "script", "is_primary")),
    "translations": (Translation, ("text", "language_code", "translator_name", "style")),
    "commentaries": (Commentary, ("text", "language_code", "approved_for_ai")),
    "chapters": (
        Chapter,
        (
            "summary",
            "summary_hindi",
            "name_english",
            "name_hindi",
            "major_teachings",
            "key_concepts",
        ),
    ),
}

HASHED_TABLES = {"verse_text_versions", "translations", "commentaries"}


class DashboardOut(ApiModel):
    chapters: int
    verses: int
    translations: int
    commentaries: int
    published_verses: int
    draft_verses: int
    pending_reviews: int
    flagged_ai_answers: int
    recent_changes: int


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[AdminUser | None, Depends(require_admin)],
) -> DashboardOut:
    def count(model, *where) -> int:
        stmt = select(func.count()).select_from(model)
        for clause in where:
            stmt = stmt.where(clause)
        return int(db.execute(stmt).scalar_one())

    return DashboardOut(
        chapters=count(Chapter),
        verses=count(Verse),
        translations=count(Translation),
        commentaries=count(Commentary),
        published_verses=count(Verse, Verse.verification_status == "published"),
        draft_verses=count(Verse, Verse.verification_status == "draft"),
        pending_reviews=count(ContentReview, ContentReview.status == "pending"),
        flagged_ai_answers=count(AiAnswer, AiAnswer.review_status == "flagged"),
        recent_changes=count(ContentChangeLog),
    )


class ContentUpdateRequest(ApiModel):
    """A canonical edit. `reason` is mandatory: an unexplained change to
    scripture is not acceptable, so the API will not accept one."""

    fields: dict[str, Any]
    reason: str = Field(min_length=3, max_length=2000)
    source_id: uuid.UUID | None = None


class ChangeLogOut(ApiModel):
    id: uuid.UUID
    table_name: str
    record_id: uuid.UUID
    record_ref: str | None
    action: str
    field_name: str | None
    previous_value: dict | None
    new_value: dict | None
    editor_email: str | None
    reason: str
    review_status: str
    created_at: datetime


@router.patch("/content/{table_name}/{record_id}", response_model=list[ChangeLogOut])
def update_content(
    table_name: str,
    record_id: uuid.UUID,
    payload: ContentUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[AdminUser | None, Depends(require_admin_role("editor", "reviewer"))],
) -> list[ChangeLogOut]:
    entry = EDITABLE.get(table_name)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{table_name}' is not editable through this endpoint",
        )
    model, allowed = entry
    record = db.get(model, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    if "origin" in payload.fields:
        assert_not_ai_generated(str(payload.fields["origin"]), table=table_name)

    logs: list[ContentChangeLog] = []
    for field_name, new_value in payload.fields.items():
        if field_name not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Field '{field_name}' cannot be edited on {table_name}",
            )
        previous = getattr(record, field_name)
        if previous == new_value:
            continue

        setattr(record, field_name, new_value)
        if field_name == "text" and table_name in HASHED_TABLES:
            # The hash is derived, never supplied by the caller.
            record.canonical_hash = canonical_hash(str(new_value))
        if hasattr(record, "version"):
            record.version = (record.version or 1) + 1

        logs.append(
            _log(
                db,
                table_name=table_name,
                record_id=record_id,
                record_ref=_ref_for(db, record),
                action="update",
                field_name=field_name,
                previous={field_name: previous},
                new={field_name: new_value},
                admin=admin,
                reason=payload.reason,
                source_id=payload.source_id,
            )
        )

    db.flush()
    return [ChangeLogOut.model_validate(log) for log in logs]


class PublishRequest(ApiModel):
    verification_status: str = Field(pattern="^(draft|review|verified|published)$")
    reason: str = Field(min_length=3, max_length=2000)


@router.post("/content/{table_name}/{record_id}/status", response_model=ChangeLogOut)
def set_status(
    table_name: str,
    record_id: uuid.UUID,
    payload: PublishRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[AdminUser | None, Depends(require_admin_role("reviewer"))],
) -> ChangeLogOut:
    entry = EDITABLE.get(table_name)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown table")
    model, _ = entry
    record = db.get(model, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    ref = _ref_for(db, record) or str(record_id)
    source_authoritative = False
    source_id = getattr(record, "source_id", None)
    if source_id:
        source = db.get(ContentSource, source_id)
        source_authoritative = bool(source and source.is_authoritative)
    # A development placeholder must never be able to present itself as verified.
    assert_publishable(
        payload.verification_status, source_is_authoritative=source_authoritative, ref=ref
    )

    previous = record.verification_status
    record.verification_status = payload.verification_status

    log = _log(
        db,
        table_name=table_name,
        record_id=record_id,
        record_ref=ref,
        action="publish" if payload.verification_status == "published" else "update",
        field_name="verification_status",
        previous={"verification_status": previous},
        new={"verification_status": payload.verification_status},
        admin=admin,
        reason=payload.reason,
        source_id=None,
    )
    db.flush()
    return ChangeLogOut.model_validate(log)


@router.get("/changes", response_model=Paginated[ChangeLogOut])
def list_changes(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[AdminUser | None, Depends(require_admin)],
    table_name: Annotated[str | None, Query()] = None,
    record_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Paginated[ChangeLogOut]:
    stmt = select(ContentChangeLog).order_by(ContentChangeLog.created_at.desc())
    count_stmt = select(func.count()).select_from(ContentChangeLog)
    if table_name:
        stmt = stmt.where(ContentChangeLog.table_name == table_name)
        count_stmt = count_stmt.where(ContentChangeLog.table_name == table_name)
    if record_id:
        stmt = stmt.where(ContentChangeLog.record_id == record_id)
        count_stmt = count_stmt.where(ContentChangeLog.record_id == record_id)

    total = int(db.execute(count_stmt).scalar_one())
    rows = db.execute(stmt.limit(limit).offset(offset)).scalars().all()
    return Paginated(
        items=[ChangeLogOut.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


class RollbackRequest(ApiModel):
    reason: str = Field(min_length=3, max_length=2000)


@router.post("/changes/{change_id}/rollback", response_model=ChangeLogOut)
def rollback(
    change_id: uuid.UUID,
    payload: RollbackRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[AdminUser | None, Depends(require_admin_role("reviewer"))],
) -> ChangeLogOut:
    """Restore the previous value recorded in a change-log entry."""
    change = db.get(ContentChangeLog, change_id)
    if change is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Change not found")
    if change.previous_value is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This change created a record; there is no previous value to restore.",
        )

    entry = EDITABLE.get(change.table_name)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{change.table_name}' cannot be rolled back through this endpoint",
        )
    model, _ = entry
    record = db.get(model, change.record_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="The record no longer exists"
        )

    restored = dict(change.previous_value)
    current = {key: getattr(record, key, None) for key in restored}
    for key, value in restored.items():
        if key == "canonical_hash":
            continue
        setattr(record, key, value)
    if "text" in restored and change.table_name in HASHED_TABLES:
        record.canonical_hash = canonical_hash(str(restored["text"]))

    log = _log(
        db,
        table_name=change.table_name,
        record_id=change.record_id,
        record_ref=change.record_ref,
        action="rollback",
        field_name=change.field_name,
        previous=current,
        new=restored,
        admin=admin,
        reason=payload.reason,
        source_id=change.source_id,
    )
    log.reverted_change_id = change.id
    db.flush()
    return ChangeLogOut.model_validate(log)


class AiAnswerReviewOut(ApiModel):
    id: uuid.UUID
    answer: str
    grounding_status: str
    rejected_citations: list[str]
    review_status: str
    user_feedback: int | None
    model_provider: str
    model_name: str
    created_at: datetime


@router.get("/ai-answers", response_model=Paginated[AiAnswerReviewOut])
def list_ai_answers(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[AdminUser | None, Depends(require_admin)],
    review_status: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Paginated[AiAnswerReviewOut]:
    """Answers awaiting editorial review.

    Anything with a rejected citation or a thumbs-down lands here. A steady
    stream of rejected citations means the retrieval or the prompt needs work,
    not that the guard should be relaxed.
    """
    stmt = select(AiAnswer).order_by(AiAnswer.created_at.desc())
    count_stmt = select(func.count()).select_from(AiAnswer)
    if review_status:
        stmt = stmt.where(AiAnswer.review_status == review_status)
        count_stmt = count_stmt.where(AiAnswer.review_status == review_status)

    total = int(db.execute(count_stmt).scalar_one())
    rows = db.execute(stmt.limit(limit).offset(offset)).scalars().all()
    return Paginated(
        items=[AiAnswerReviewOut.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


class ReviewDecision(ApiModel):
    review_status: str = Field(pattern="^(unreviewed|approved|flagged|rejected)$")
    note: str | None = Field(default=None, max_length=2000)


@router.post("/ai-answers/{answer_id}/review", response_model=AiAnswerReviewOut)
def review_ai_answer(
    answer_id: uuid.UUID,
    payload: ReviewDecision,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[AdminUser | None, Depends(require_admin_role("reviewer"))],
) -> AiAnswerReviewOut:
    answer = db.get(AiAnswer, answer_id)
    if answer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Answer not found")
    answer.review_status = payload.review_status
    answer.reviewer_note = payload.note
    db.flush()
    return AiAnswerReviewOut.model_validate(answer)


# --- helpers --------------------------------------------------------------


# --- Wallpapers -------------------------------------------------------------
#
# Wallpapers are not scripture, so they do not go through `EDITABLE` and its
# canonical-hash machinery. They do share the verification lifecycle and the
# audit log, because publishing one is still a decision someone made: it puts
# an image in front of every reader, and the licence attached to it is the
# thing that makes that legal.


class WallpaperAdminOut(ApiModel):
    id: uuid.UUID
    slug: str
    title: str | None
    orientation: str
    text_zone: str
    luminance: float | None
    moods: list[str]
    thumb_url: str | None
    verification_status: str
    is_active: bool
    use_count: int
    licence_code: str | None
    attribution: str | None
    photographer: str | None


class WallpaperStatusRequest(ApiModel):
    verification_status: str = Field(pattern="^(draft|review|verified|published)$")
    reason: str = Field(min_length=3, max_length=2000)


class WallpaperActiveRequest(ApiModel):
    is_active: bool
    reason: str = Field(min_length=3, max_length=2000)


class BulkWallpaperStatusRequest(ApiModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    verification_status: str = Field(pattern="^(draft|review|verified|published)$")
    reason: str = Field(min_length=3, max_length=2000)


def _wallpaper_out(wallpaper: Wallpaper) -> WallpaperAdminOut:
    return WallpaperAdminOut(
        id=wallpaper.id,
        slug=wallpaper.slug,
        title=wallpaper.title,
        orientation=wallpaper.orientation,
        text_zone=wallpaper.text_zone,
        luminance=wallpaper.luminance,
        moods=list(wallpaper.moods or []),
        thumb_url=resolve_audio_url(wallpaper.thumb_key),
        verification_status=wallpaper.verification_status,
        is_active=wallpaper.is_active,
        use_count=wallpaper.use_count,
        licence_code=wallpaper.license.code if wallpaper.license else None,
        attribution=wallpaper.attribution,
        photographer=wallpaper.photographer,
    )


def _publish_wallpaper(db: Session, wallpaper: Wallpaper, target: str) -> None:
    """The one rule that matters: nothing reaches readers without a licence.

    The table has the same constraint, but failing here gives the reviewer a
    sentence they can act on instead of an integrity error.
    """
    if target in ("verified", "published") and wallpaper.license_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"{wallpaper.slug} has no licence recorded. Import it with a manifest "
                "that names one before publishing."
            ),
        )
    wallpaper.verification_status = target


@router.get("/wallpapers", response_model=Paginated[WallpaperAdminOut])
def list_wallpapers_for_review(
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[AdminUser | None, Depends(require_admin)],
    verification_status: Annotated[str | None, Query()] = None,
    orientation: Annotated[str | None, Query()] = None,
    is_active: Annotated[bool | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Paginated[WallpaperAdminOut]:
    """The review queue. Unlike the public route this shows every row,
    including deactivated ones, because taking something down is a decision a
    reviewer needs to be able to see and undo."""
    conditions = []
    if verification_status:
        conditions.append(Wallpaper.verification_status == verification_status)
    if orientation:
        conditions.append(Wallpaper.orientation == orientation)
    if is_active is not None:
        conditions.append(Wallpaper.is_active.is_(is_active))

    total = db.execute(
        select(func.count()).select_from(Wallpaper).where(*conditions)
    ).scalar_one()
    rows = (
        db.execute(
            select(Wallpaper)
            .where(*conditions)
            .order_by(Wallpaper.verification_status, Wallpaper.slug)
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    return Paginated(
        items=[_wallpaper_out(w) for w in rows], total=int(total), limit=limit, offset=offset
    )


@router.post("/wallpapers/{wallpaper_id}/status", response_model=WallpaperAdminOut)
def set_wallpaper_status(
    wallpaper_id: uuid.UUID,
    payload: WallpaperStatusRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[AdminUser | None, Depends(require_admin_role("reviewer"))],
) -> WallpaperAdminOut:
    wallpaper = db.get(Wallpaper, wallpaper_id)
    if wallpaper is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wallpaper not found")

    previous = wallpaper.verification_status
    _publish_wallpaper(db, wallpaper, payload.verification_status)
    _log(
        db,
        table_name="wallpapers",
        record_id=wallpaper.id,
        record_ref=wallpaper.slug,
        action="publish" if payload.verification_status == "published" else "update",
        field_name="verification_status",
        previous={"verification_status": previous},
        new={"verification_status": payload.verification_status},
        admin=admin,
        reason=payload.reason,
        source_id=None,
    )
    db.flush()
    return _wallpaper_out(wallpaper)


@router.post("/wallpapers/status", response_model=list[WallpaperAdminOut])
def set_wallpaper_status_bulk(
    payload: BulkWallpaperStatusRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[AdminUser | None, Depends(require_admin_role("reviewer"))],
) -> list[WallpaperAdminOut]:
    """Review a batch.

    A library arrives a thousand images at a time under one licence, and making
    someone click a thousand times would only teach them to stop reading what
    they are approving. Each row still gets its own audit entry, and one row
    without a licence fails the whole batch rather than quietly publishing the
    rest.
    """
    rows = (
        db.execute(select(Wallpaper).where(Wallpaper.id.in_(payload.ids))).scalars().all()
    )
    found = {row.id for row in rows}
    missing = [str(i) for i in payload.ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown wallpaper id(s): {', '.join(missing[:5])}",
        )

    for wallpaper in rows:
        previous = wallpaper.verification_status
        _publish_wallpaper(db, wallpaper, payload.verification_status)
        _log(
            db,
            table_name="wallpapers",
            record_id=wallpaper.id,
            record_ref=wallpaper.slug,
            action="publish" if payload.verification_status == "published" else "update",
            field_name="verification_status",
            previous={"verification_status": previous},
            new={"verification_status": payload.verification_status},
            admin=admin,
            reason=payload.reason,
            source_id=None,
        )

    db.flush()
    return [_wallpaper_out(w) for w in rows]


@router.post("/wallpapers/{wallpaper_id}/active", response_model=WallpaperAdminOut)
def set_wallpaper_active(
    wallpaper_id: uuid.UUID,
    payload: WallpaperActiveRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[AdminUser | None, Depends(require_admin_role("reviewer"))],
) -> WallpaperAdminOut:
    """Take a wallpaper out of the picker without deleting it.

    Deactivating rather than deleting matters here: someone may already have a
    card on this background, and the file needs to keep resolving even once the
    image stops being offered.
    """
    wallpaper = db.get(Wallpaper, wallpaper_id)
    if wallpaper is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wallpaper not found")

    previous = wallpaper.is_active
    wallpaper.is_active = payload.is_active
    _log(
        db,
        table_name="wallpapers",
        record_id=wallpaper.id,
        record_ref=wallpaper.slug,
        action="update",
        field_name="is_active",
        previous={"is_active": previous},
        new={"is_active": payload.is_active},
        admin=admin,
        reason=payload.reason,
        source_id=None,
    )
    db.flush()
    return _wallpaper_out(wallpaper)


def _log(
    db: Session,
    *,
    table_name: str,
    record_id: uuid.UUID,
    record_ref: str | None,
    action: str,
    field_name: str | None,
    previous: dict | None,
    new: dict | None,
    admin: AdminUser | None,
    reason: str,
    source_id: uuid.UUID | None,
) -> ContentChangeLog:
    log = ContentChangeLog(
        table_name=table_name,
        record_id=record_id,
        record_ref=record_ref,
        action=action,
        field_name=field_name,
        previous_value=_jsonable(previous),
        new_value=_jsonable(new),
        editor_id=admin.id if admin else None,
        editor_email=admin.email if admin else "bootstrap-token",
        reason=reason,
        source_id=source_id,
        review_status="pending",
    )
    db.add(log)
    return log


def _jsonable(value: dict | None) -> dict | None:
    if value is None:
        return None
    out: dict[str, Any] = {}
    for key, item in value.items():
        if isinstance(item, uuid.UUID):
            out[key] = str(item)
        elif isinstance(item, datetime):
            out[key] = item.astimezone(UTC).isoformat()
        else:
            out[key] = item
    return out


def _ref_for(db: Session, record: Any) -> str | None:
    """Human-readable anchor ("2.47") for the change log."""
    verse_id = getattr(record, "verse_id", None)
    if verse_id:
        verse = db.get(Verse, verse_id)
        if verse:
            return f"{verse.chapter_number}.{verse.number}"
    if isinstance(record, Chapter):
        return f"chapter {record.number}"
    return None
