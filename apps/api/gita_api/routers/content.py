"""Canonical content endpoints.

All read-only, all cacheable. These are the routes the website statically
renders from and the mobile app seeds its local database from, so they set
explicit cache headers rather than relying on client guesswork.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from gita_api.db.session import get_db
from gita_api.schemas.common import Paginated
from gita_api.schemas.content import (
    ChapterOut,
    GlossaryTermOut,
    TopicOut,
    TopicSummaryOut,
    VerseOut,
    VerseSummaryOut,
)
from gita_api.services import content as content_service
from gita_api.utils.verse_ref import (
    CHAPTER_VERSE_COUNTS,
    is_valid_chapter,
    next_verse,
    previous_verse,
)

router = APIRouter(prefix="/v1", tags=["content"])

# Canonical text does not change often; a long shared cache with
# stale-while-revalidate keeps the CDN and the reader fast.
CANONICAL_CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"


@router.get("/chapters", response_model=list[ChapterOut])
def list_chapters(response: Response, db: Annotated[Session, Depends(get_db)]) -> list[ChapterOut]:
    response.headers["Cache-Control"] = CANONICAL_CACHE
    return content_service.list_chapters(db)


@router.get("/chapters/{number}", response_model=ChapterOut)
def get_chapter(
    number: int, response: Response, db: Annotated[Session, Depends(get_db)]
) -> ChapterOut:
    if not is_valid_chapter(number):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The Bhagavad Gita has 18 chapters.",
        )
    chapter = content_service.get_chapter(db, number)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")
    response.headers["Cache-Control"] = CANONICAL_CACHE
    return chapter


@router.get("/chapters/{number}/verses", response_model=Paginated[VerseSummaryOut])
def list_chapter_verses(
    number: int,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    language: Annotated[str, Query(max_length=10)] = "en",
) -> Paginated[VerseSummaryOut]:
    if not is_valid_chapter(number):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")
    items, total = content_service.list_chapter_verses(
        db, number, limit=limit, offset=offset, language=language
    )
    response.headers["Cache-Control"] = CANONICAL_CACHE
    return Paginated(items=items, total=total, limit=limit, offset=offset)


@router.get("/verses/{chapter}/{verse}", response_model=VerseOut)
def get_verse(
    chapter: int,
    verse: int,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    language: Annotated[str, Query(max_length=10)] = "en",
) -> VerseOut:
    result = content_service.get_verse(db, chapter, verse, language=language)
    if result is None:
        detail = "Verse not found"
        if is_valid_chapter(chapter):
            detail = (
                f"Chapter {chapter} has {CHAPTER_VERSE_COUNTS[chapter - 1]} verses in this edition."
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    response.headers["Cache-Control"] = CANONICAL_CACHE
    return result


@router.get("/verses/{chapter}/{verse}/neighbours")
def get_verse_neighbours(chapter: int, verse: int) -> dict[str, str | None]:
    """Previous/next references.

    Pure arithmetic over the canonical verse counts, so the reader can prefetch
    the next verse without a database round trip.
    """
    previous = previous_verse(chapter, verse)
    following = next_verse(chapter, verse)
    return {
        "previous": f"{previous.chapter}.{previous.verse}" if previous else None,
        "next": f"{following.chapter}.{following.verse}" if following else None,
    }


@router.get("/topics", response_model=list[TopicSummaryOut])
def list_topics(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    category: Annotated[str | None, Query(max_length=16)] = None,
) -> list[TopicSummaryOut]:
    response.headers["Cache-Control"] = CANONICAL_CACHE
    return content_service.list_topics(db, category)


@router.get("/topics/{slug}", response_model=TopicOut)
def get_topic(
    slug: str,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    language: Annotated[str, Query(max_length=10)] = "en",
) -> TopicOut:
    topic = content_service.get_topic(db, slug, language=language)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")
    response.headers["Cache-Control"] = CANONICAL_CACHE
    return topic


@router.get("/glossary", response_model=list[GlossaryTermOut])
def list_glossary(
    response: Response, db: Annotated[Session, Depends(get_db)]
) -> list[GlossaryTermOut]:
    response.headers["Cache-Control"] = CANONICAL_CACHE
    return content_service.list_glossary(db)


@router.get("/glossary/{slug}", response_model=GlossaryTermOut)
def get_glossary_term(
    slug: str,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    language: Annotated[str, Query(max_length=10)] = "en",
) -> GlossaryTermOut:
    term = content_service.get_glossary_term(db, slug, language=language)
    if term is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Glossary term not found")
    response.headers["Cache-Control"] = CANONICAL_CACHE
    return term
