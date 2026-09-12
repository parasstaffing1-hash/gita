"""Response models for canonical content."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from gita_api.schemas.common import ApiModel


class ContentLicenseOut(ApiModel):
    id: uuid.UUID
    code: str
    name: str
    url: str | None = None
    redistributable: bool
    requires_attribution: bool
    commercial_use_allowed: bool
    notes: str | None = None


class ContentSourceOut(ApiModel):
    id: uuid.UUID
    name: str
    source_url: str | None = None
    author: str | None = None
    publication: str | None = None
    publication_year: int | None = None
    license: ContentLicenseOut | None = None
    copyright_status: str | None = None
    date_accessed: str | None = None
    reviewer: str | None = None
    verification_notes: str | None = None


class VerseRefOut(ApiModel):
    chapter: int
    verse: int
    verse_end: int | None = None


class ChapterSummaryOut(ApiModel):
    id: uuid.UUID
    number: int
    slug: str
    name_sanskrit: str | None = None
    name_transliteration: str | None = None
    name_english: str
    name_hindi: str | None = None
    verse_count: int
    summary: str | None = None


class ChapterOut(ChapterSummaryOut):
    summary_hindi: str | None = None
    major_teachings: list[str] = Field(default_factory=list)
    key_concepts: list[str] = Field(default_factory=list)
    key_verses: list[VerseRefOut] = Field(default_factory=list)
    audio_track_id: uuid.UUID | None = None
    verification_status: str


class VerseTextVersionOut(ApiModel):
    id: uuid.UUID
    script: str
    text: str
    canonical_hash: str
    source: ContentSourceOut | None = None
    version: int
    verification_status: str
    is_primary: bool


class TransliterationOut(ApiModel):
    id: uuid.UUID
    scheme: str
    text: str
    source: ContentSourceOut | None = None
    version: int
    verification_status: str


class TranslationOut(ApiModel):
    id: uuid.UUID
    language_code: str
    text: str
    translator_name: str | None = None
    style: str | None = None
    source: ContentSourceOut | None = None
    version: int
    verification_status: str
    origin: str


class CommentatorOut(ApiModel):
    id: uuid.UUID
    slug: str
    name: str
    name_sanskrit: str | None = None
    tradition: str | None = None
    period: str | None = None
    bio: str | None = None


class CommentaryOut(ApiModel):
    id: uuid.UUID
    commentator: CommentatorOut | None = None
    language_code: str
    text: str
    source: ContentSourceOut | None = None
    version: int
    verification_status: str
    origin: str


class VerseWordOut(ApiModel):
    id: uuid.UUID
    position: int
    word_devanagari: str
    word_transliteration: str | None = None
    meaning_english: str | None = None
    meaning_hindi: str | None = None
    grammar_note: str | None = None
    sanskrit_term_id: uuid.UUID | None = None


class AudioTrackOut(ApiModel):
    id: uuid.UUID
    kind: str
    chapter_number: int | None = None
    verse_number: int | None = None
    language_code: str
    reciter: str | None = None
    is_synthetic: bool
    duration_seconds: int | None = None
    size_bytes: int | None = None
    mime_type: str
    url: str | None = None
    license: ContentLicenseOut | None = None
    verification_status: str


class TopicSummaryOut(ApiModel):
    id: uuid.UUID
    slug: str
    name: str
    name_hindi: str | None = None
    category: str
    short_description: str | None = None
    verse_count: int = 0
    icon: str | None = None


class VerseSummaryOut(ApiModel):
    id: uuid.UUID
    chapter_number: int
    verse_number: int
    verse_number_end: int | None = None
    ref: str
    slug: str
    sanskrit: str | None = None
    transliteration: str | None = None
    translation_english: str | None = None
    translation_hindi: str | None = None


class RelatedVerseOut(ApiModel):
    verse: VerseSummaryOut
    relation_type: str
    note: str | None = None


class VerseOut(VerseSummaryOut):
    text_versions: list[VerseTextVersionOut] = Field(default_factory=list)
    transliterations: list[TransliterationOut] = Field(default_factory=list)
    translations: list[TranslationOut] = Field(default_factory=list)
    commentaries: list[CommentaryOut] = Field(default_factory=list)
    words: list[VerseWordOut] = Field(default_factory=list)
    audio_tracks: list[AudioTrackOut] = Field(default_factory=list)
    topics: list[TopicSummaryOut] = Field(default_factory=list)
    related_verses: list[RelatedVerseOut] = Field(default_factory=list)
    speaker: str | None = None
    verification_status: str
    canonical_hash: str | None = None
    updated_at: datetime


class TopicVerseOut(ApiModel):
    verse: VerseSummaryOut
    relevance: float
    note: str | None = None


class TopicOut(TopicSummaryOut):
    introduction: str | None = None
    introduction_hindi: str | None = None
    related_concepts: list[str] = Field(default_factory=list)
    related_topics: list[TopicSummaryOut] = Field(default_factory=list)
    verses: list[TopicVerseOut] = Field(default_factory=list)


class GlossaryTermOut(ApiModel):
    id: uuid.UUID
    slug: str
    term_sanskrit: str
    term_transliteration: str
    term_english: str | None = None
    simple_definition: str
    detailed_definition: str | None = None
    variants: list[str] = Field(default_factory=list)
    synonyms: list[str] = Field(default_factory=list)
    related_term_slugs: list[str] = Field(default_factory=list)
    related_verses: list[VerseSummaryOut] = Field(default_factory=list)
    sources: list[ContentSourceOut] = Field(default_factory=list)
    verification_status: str
