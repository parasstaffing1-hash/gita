"""The wallpaper library.

Backgrounds for the quote maker. Files live in Cloudflare R2; this table holds
the catalogue plus the handful of measurements the composer needs to place type
well without downloading the full 4K image first.

Two of those measurements do real design work:

  `luminance` and `text_zone` are computed at import time by looking at the
  image itself. They let the composer pick a light or dark treatment, and place
  the verse where the picture is calmest, before the reader touches a control.

Licensing is not optional here. A wallpaper without a licence cannot be served,
for the same reason a verse without a source cannot be published.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gita_api.db.base import Base, TimestampMixin, UUIDMixin

# Where the calmest region of the image is, and therefore where type reads.
TEXT_ZONES = ("top", "middle", "bottom", "any")

ORIENTATIONS = ("portrait", "landscape", "square")

# Deliberately a small, curated vocabulary. A free-text tag field turns into
# a thousand near-duplicates the moment a bulk import runs.
WALLPAPER_MOODS = (
    "dawn",
    "dusk",
    "night",
    "mountains",
    "river",
    "forest",
    "sky",
    "temple",
    "lotus",
    "flame",
    "abstract",
    "texture",
    "minimal",
)


class Wallpaper(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "wallpapers"

    # Short, URL-safe handle. It travels inside every shared quote link, so it
    # is stable and readable rather than a raw UUID.
    slug: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    title: Mapped[str | None] = mapped_column(String(200))

    # --- Files in R2 ------------------------------------------------------
    # Three derivatives per image. The picker never loads a 4K file, and the
    # composer only fetches full resolution at export.
    object_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    preview_key: Mapped[str | None] = mapped_column(String(500))
    thumb_key: Mapped[str | None] = mapped_column(String(500))

    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False, default="image/jpeg")
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))

    orientation: Mapped[str] = mapped_column(String(16), nullable=False, default="portrait")

    # --- Measurements that drive the composer -----------------------------
    # Mean luminance, 0..1, over the region type is likely to occupy. Decides
    # light type on a dark treatment versus the reverse.
    luminance: Mapped[float | None] = mapped_column(Float)
    # Where the image is calmest, so a verse is not laid over the busiest part.
    text_zone: Mapped[str] = mapped_column(String(8), nullable=False, default="any")
    # Dominant colour, used for the loading placeholder and for tinting the
    # picker card so the grid does not flash white.
    dominant_color: Mapped[str | None] = mapped_column(String(9))

    moods: Mapped[list[str]] = mapped_column(
        ARRAY(String(24)), nullable=False, default=list, server_default="{}"
    )

    # --- Provenance -------------------------------------------------------
    license_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_licenses.id", ondelete="RESTRICT")
    )
    attribution: Mapped[str | None] = mapped_column(String(300))
    source_url: Mapped[str | None] = mapped_column(String(1000))
    photographer: Mapped[str | None] = mapped_column(String(200))

    # Editorial state, same vocabulary as the rest of the content system.
    verification_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)

    # How often it has been used, so the picker can lead with what works.
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    notes: Mapped[str | None] = mapped_column(Text)

    license = relationship("ContentLicense")

    __table_args__ = (
        CheckConstraint(f"text_zone IN {TEXT_ZONES}", name="text_zone_valid"),
        CheckConstraint(f"orientation IN {ORIENTATIONS}", name="orientation_valid"),
        CheckConstraint("width > 0 AND height > 0", name="dimensions_positive"),
        CheckConstraint(
            "luminance IS NULL OR (luminance >= 0 AND luminance <= 1)", name="luminance_range"
        ),
        # A wallpaper cannot be published without a licence on file.
        CheckConstraint(
            "verification_status = 'draft' OR license_id IS NOT NULL",
            name="published_wallpaper_needs_licence",
        ),
        Index("ix_wallpapers_browse", "is_active", "verification_status", "orientation"),
        Index("ix_wallpapers_moods", "moods", postgresql_using="gin"),
        Index("ix_wallpapers_popularity", "use_count"),
    )
