"""Wallpaper catalogue endpoints.

Read-only and cacheable. The picker is the one screen in the product that
fetches hundreds of rows at a time, so this returns thumbnails and the two
measurements the composer needs — never the full-resolution file, which the
client only requests at export.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from gita_api.config import settings
from gita_api.db.models import Wallpaper
from gita_api.db.models.wallpapers import WALLPAPER_MOODS
from gita_api.db.session import get_db
from gita_api.schemas.common import ApiModel, Paginated
from gita_api.security.rate_limit import limiter
from gita_api.services.media import resolve_audio_url

router = APIRouter(prefix="/v1/wallpapers", tags=["wallpapers"])

CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"

# Popularity in coarse steps rather than exact counts. `log` compresses the tail
# so the gap between 10 and 20 uses still matters while the gap between 5,000
# and 10,000 barely does, and the floor keeps an unused wallpaper out of
# negative territory.
POPULARITY_TIER = func.floor(func.log(10, func.greatest(Wallpaper.use_count, 1)))


def _asset_cache() -> str:
    """Cache-Control for the responses that carry image URLs.

    With a public CDN domain the URLs never expire and the catalogue can be
    cached for as long as it is worth caching. Without one, `resolve_audio_url`
    signs each key for `r2_signed_url_ttl_seconds`, and a response cached past
    that hands every later reader links that are already dead — so the whole
    cache window, stale serving included, has to close before the signature
    does.
    """
    if settings.r2_public_base_url or not settings.r2_configured:
        return CACHE
    # A quarter each for fresh and stale leaves the response unusable well
    # before its links expire, with room for the shelf life already spent
    # between signing and the first store.
    window = max(1, settings.r2_signed_url_ttl_seconds // 4)
    return (
        f"public, max-age={window}, s-maxage={window}, stale-while-revalidate={window}"
    )


class WallpaperOut(ApiModel):
    id: uuid.UUID
    slug: str
    title: str | None
    width: int
    height: int
    orientation: str
    # Where the image is calmest, so the composer can place type before the
    # reader touches anything.
    text_zone: str
    luminance: float | None
    dominant_color: str | None
    moods: list[str]
    # The grid uses `thumbUrl` and the composer `previewUrl`. `fullUrl` is only
    # ever wanted by an export, so a listing leaves it null and the caller asks
    # for the one image it is about to render - see `_to_out`.
    thumb_url: str | None
    preview_url: str | None
    full_url: str | None
    attribution: str | None
    photographer: str | None
    source_url: str | None
    license_code: str | None
    verification_status: str


def _to_out(wallpaper: Wallpaper, *, with_full: bool = False) -> WallpaperOut:
    """A catalogue row.

    `with_full` is off for listings. Every URL here may be a presigned R2 link,
    so a 60-row page costs a signature per URL: including the original makes
    that 180 signatures to render a grid of thumbnails, and hands out sixty
    full-resolution links to a reader who will export at most one of them.
    """
    return WallpaperOut(
        id=wallpaper.id,
        slug=wallpaper.slug,
        title=wallpaper.title,
        width=wallpaper.width,
        height=wallpaper.height,
        orientation=wallpaper.orientation,
        text_zone=wallpaper.text_zone,
        luminance=wallpaper.luminance,
        dominant_color=wallpaper.dominant_color,
        moods=list(wallpaper.moods or []),
        thumb_url=resolve_audio_url(wallpaper.thumb_key),
        preview_url=resolve_audio_url(wallpaper.preview_key),
        full_url=resolve_audio_url(wallpaper.object_key) if with_full else None,
        attribution=wallpaper.attribution,
        photographer=wallpaper.photographer,
        source_url=wallpaper.source_url,
        license_code=wallpaper.license.code if wallpaper.license else None,
        verification_status=wallpaper.verification_status,
    )


def _visible():
    """Outside production the seeded library is still draft, or the picker
    would be empty in development."""
    statuses = ("published",) if settings.is_production else ("published", "verified", "review", "draft")
    return (Wallpaper.is_active.is_(True), Wallpaper.verification_status.in_(statuses))


@router.get("", response_model=Paginated[WallpaperOut])
def list_wallpapers(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    orientation: Annotated[str | None, Query()] = None,
    mood: Annotated[str | None, Query()] = None,
    text_zone: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 48,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Paginated[WallpaperOut]:
    """Browse the library.

    Filters are the ones a person composing actually reaches for: the shape of
    the canvas they are filling, the mood they want, and — for a long verse —
    where the image leaves room for type.
    """
    conditions = list(_visible())
    if orientation:
        conditions.append(Wallpaper.orientation == orientation)
    if mood:
        conditions.append(Wallpaper.moods.any(mood))
    if text_zone:
        conditions.append(Wallpaper.text_zone == text_zone)

    total = db.execute(
        select(func.count()).select_from(Wallpaper).where(*conditions)
    ).scalar_one()

    rows = (
        db.execute(
            select(Wallpaper)
            .where(*conditions)
            # Most-used first: the library is large and the good ones should
            # surface without anyone curating a front page by hand.
            #
            # Bucketed, though, because `use_count` is the one column an
            # unauthenticated caller can move. Ranking on the raw number makes
            # position one purchasable with a loop; ranking on the bucket means
            # the most anyone can buy is entry to a tier, and inside that tier
            # the editorial `sort_order` decides. It also stops early leaders
            # compounding — top placement drives exports, which drive count —
            # so the ordering does not ossify within weeks of launch.
            .order_by(
                POPULARITY_TIER.desc(),
                Wallpaper.sort_order,
                Wallpaper.slug,
            )
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )

    response.headers["Cache-Control"] = _asset_cache()
    return Paginated(
        items=[_to_out(w) for w in rows], total=int(total), limit=limit, offset=offset
    )


@router.get("/moods", response_model=list[str])
def list_moods(response: Response) -> list[str]:
    """The controlled vocabulary, so the UI never invents a filter that
    matches nothing."""
    response.headers["Cache-Control"] = CACHE
    return list(WALLPAPER_MOODS)


@router.get("/{slug}", response_model=WallpaperOut)
def get_wallpaper(
    slug: str, response: Response, db: Annotated[Session, Depends(get_db)]
) -> WallpaperOut:
    wallpaper = db.execute(
        select(Wallpaper).where(Wallpaper.slug == slug, *_visible())
    ).scalar_one_or_none()
    if wallpaper is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wallpaper not found")
    response.headers["Cache-Control"] = _asset_cache()
    return _to_out(wallpaper, with_full=True)


@router.post("/{slug}/used", status_code=status.HTTP_204_NO_CONTENT)
# The one public write in the catalogue, and it moves the picker's ordering.
# An export is a deliberate human action seconds apart, so the bucket sits well
# below the read allowance; the middleware's default limits never reach a route
# handler under Starlette 1.6, so the decorator is the only real protection.
@limiter.limit("30/minute")
def record_use(
    slug: str,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Count an export.

    Only a counter, and only on the wallpaper — nothing about which verse was
    chosen or who chose it is recorded. It exists so the picker can lead with
    what people actually use.

    A use is only counted for a wallpaper the caller could actually have used.
    Carrying `_visible()` into the UPDATE settles existence and the increment in
    one statement, and leaves everything else a 404 — the same answer, and the
    same disclosure, as `GET /{slug}`. Without it the counter is a free lever on
    the ordering every reader sees, on rows no reader can even reach.
    """
    updated = db.execute(
        Wallpaper.__table__.update()
        .where(Wallpaper.slug == slug, *_visible())
        .values(use_count=Wallpaper.use_count + 1)
    ).rowcount
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wallpaper not found")
