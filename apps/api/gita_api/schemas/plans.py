"""Reading plans, daily verse and content manifest models."""

from __future__ import annotations

import uuid
from datetime import date

from pydantic import Field

from gita_api.schemas.common import ApiModel
from gita_api.schemas.content import VerseSummaryOut


class ReadingPlanSummaryOut(ApiModel):
    id: uuid.UUID
    slug: str
    title: str
    title_hindi: str | None = None
    subtitle: str | None = None
    description: str | None = None
    duration_days: int
    level: str
    cover_image_url: str | None = None
    tags: list[str] = Field(default_factory=list)


class ReadingPlanDayOut(ApiModel):
    id: uuid.UUID
    day_number: int
    title: str
    intro: str | None = None
    verses: list[VerseSummaryOut] = Field(default_factory=list)
    reflection: str | None = None
    audio_track_ids: list[uuid.UUID] = Field(default_factory=list)
    estimated_minutes: int


class ReadingPlanOut(ReadingPlanSummaryOut):
    days: list[ReadingPlanDayOut] = Field(default_factory=list)


class DailyVerseOut(ApiModel):
    date: date
    verse: VerseSummaryOut
    reflection: str | None = None
    reflection_hindi: str | None = None
    audio_track_id: uuid.UUID | None = None
    related_verse: VerseSummaryOut | None = None


class ContentBundleManifestOut(ApiModel):
    """Describes the offline dataset the mobile app downloads."""

    version: str
    generated_at: str
    schema_version: int
    chapter_count: int
    verse_count: int
    languages: list[str]
    size_bytes: int
    sha256: str
    download_url: str
    # False while the dataset still contains development placeholder records.
    verified_only: bool
