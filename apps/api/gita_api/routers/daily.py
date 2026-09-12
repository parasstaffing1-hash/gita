"""Daily verse, reading plans and the offline content manifest."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from gita_api.db.models import Chapter, DailyVerse, ReadingPlan, Verse
from gita_api.db.session import get_db
from gita_api.schemas.plans import (
    ContentBundleManifestOut,
    DailyVerseOut,
    ReadingPlanDayOut,
    ReadingPlanOut,
    ReadingPlanSummaryOut,
)
from gita_api.services.content import get_verses_by_refs, verse_summary, visible_statuses

router = APIRouter(prefix="/v1", tags=["daily"])


@router.get("/daily-verse", response_model=DailyVerseOut)
def daily_verse(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    date_param: Annotated[date | None, Query(alias="date")] = None,
) -> DailyVerseOut:
    """The scheduled verse for a date.

    Editorially scheduled rather than randomly picked, so every device shows the
    same verse and the reflection can be written and reviewed in advance.
    """
    target = date_param or date.today()
    row = db.execute(
        select(DailyVerse).where(
            DailyVerse.scheduled_date == target,
            DailyVerse.verification_status.in_(visible_statuses()),
        )
    ).scalar_one_or_none()

    if row is None:
        # Deterministic fallback so the home screen is never empty: the same
        # date always resolves to the same verse, on every device.
        verse = _deterministic_verse(db, target)
        if verse is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No verses have been published yet.",
            )
        response.headers["Cache-Control"] = "public, max-age=600"
        return DailyVerseOut(date=target, verse=verse_summary(verse))

    verse = db.execute(
        select(Verse)
        .options(
            selectinload(Verse.text_versions),
            selectinload(Verse.transliterations),
            selectinload(Verse.translations),
        )
        .where(Verse.id == row.verse_id)
    ).scalar_one()

    related = None
    if row.related_verse_id:
        related_verse = db.execute(
            select(Verse)
            .options(
                selectinload(Verse.text_versions),
                selectinload(Verse.transliterations),
                selectinload(Verse.translations),
            )
            .where(Verse.id == row.related_verse_id)
        ).scalar_one_or_none()
        if related_verse is not None:
            related = verse_summary(related_verse)

    response.headers["Cache-Control"] = "public, max-age=600"
    return DailyVerseOut(
        date=row.scheduled_date,
        verse=verse_summary(verse),
        reflection=row.reflection,
        reflection_hindi=row.reflection_hindi,
        audio_track_id=row.audio_track_id,
        related_verse=related,
    )


def _deterministic_verse(db: Session, target: date) -> Verse | None:
    total = db.execute(
        select(func.count())
        .select_from(Verse)
        .where(Verse.verification_status.in_(visible_statuses()))
    ).scalar_one()
    if not total:
        return None
    # Hash the date so consecutive days are not consecutive verses.
    digest = hashlib.sha256(target.isoformat().encode("utf-8")).digest()
    offset = int.from_bytes(digest[:4], "big") % int(total)
    return db.execute(
        select(Verse)
        .options(
            selectinload(Verse.text_versions),
            selectinload(Verse.transliterations),
            selectinload(Verse.translations),
        )
        .where(Verse.verification_status.in_(visible_statuses()))
        .order_by(Verse.ordinal)
        .offset(offset)
        .limit(1)
    ).scalar_one_or_none()


@router.get("/reading-plans", response_model=list[ReadingPlanSummaryOut])
def list_plans(
    response: Response, db: Annotated[Session, Depends(get_db)]
) -> list[ReadingPlanSummaryOut]:
    plans = (
        db.execute(
            select(ReadingPlan)
            .where(ReadingPlan.verification_status.in_(visible_statuses()))
            .order_by(ReadingPlan.sort_order, ReadingPlan.title)
        )
        .scalars()
        .all()
    )
    response.headers["Cache-Control"] = "public, max-age=3600"
    return [ReadingPlanSummaryOut.model_validate(p) for p in plans]


@router.get("/reading-plans/{slug}", response_model=ReadingPlanOut)
def get_plan(
    slug: str, response: Response, db: Annotated[Session, Depends(get_db)]
) -> ReadingPlanOut:
    plan = db.execute(
        select(ReadingPlan)
        .options(selectinload(ReadingPlan.days))
        .where(
            ReadingPlan.slug == slug,
            ReadingPlan.verification_status.in_(visible_statuses()),
        )
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reading plan not found")

    # Resolve every day's verse refs in one query rather than per day.
    all_refs = sorted({ref for day in plan.days for ref in (day.verse_refs or [])})
    verses = get_verses_by_refs(db, all_refs)

    response.headers["Cache-Control"] = "public, max-age=3600"
    return ReadingPlanOut(
        **ReadingPlanSummaryOut.model_validate(plan).model_dump(by_alias=False),
        days=[
            ReadingPlanDayOut(
                id=day.id,
                day_number=day.day_number,
                title=day.title,
                intro=day.intro,
                verses=[verses[ref] for ref in (day.verse_refs or []) if ref in verses],
                reflection=day.reflection,
                audio_track_ids=[],
                estimated_minutes=day.estimated_minutes,
            )
            for day in plan.days
        ],
    )


@router.get("/content/manifest", response_model=ContentBundleManifestOut)
def content_manifest(db: Annotated[Session, Depends(get_db)]) -> ContentBundleManifestOut:
    """Describe the offline dataset the mobile app can download.

    The manifest hash is computed from the content itself, so a device knows
    whether its local copy is stale without downloading anything.
    """
    statuses = visible_statuses()
    chapter_count = db.execute(
        select(func.count()).select_from(Chapter).where(Chapter.verification_status.in_(statuses))
    ).scalar_one()
    verse_count = db.execute(
        select(func.count()).select_from(Verse).where(Verse.verification_status.in_(statuses))
    ).scalar_one()
    latest = db.execute(
        select(func.max(Verse.updated_at)).where(Verse.verification_status.in_(statuses))
    ).scalar_one()
    published_only = db.execute(
        select(func.count()).select_from(Verse).where(Verse.verification_status != "published")
    ).scalar_one()

    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "chapters": int(chapter_count),
                "verses": int(verse_count),
                "updated": latest.isoformat() if latest else None,
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()

    return ContentBundleManifestOut(
        version=fingerprint[:12],
        generated_at=latest.isoformat() if latest else "",
        schema_version=1,
        chapter_count=int(chapter_count),
        verse_count=int(verse_count),
        languages=["sa", "en", "hi"],
        size_bytes=0,
        sha256=fingerprint,
        download_url="/v1/content/bundle",
        verified_only=int(published_only) == 0,
    )
