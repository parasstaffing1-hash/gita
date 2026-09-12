"""Search and Ask the Gita request/response models."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from gita_api.schemas.common import ApiModel
from gita_api.schemas.content import TopicSummaryOut, VerseSummaryOut

AskMode = Literal[
    "default", "simple", "deep", "beginner", "sources_only", "compare_interpretations"
]


class SearchReference(ApiModel):
    chapter: int
    verse: int | None = None


class SearchHitOut(ApiModel):
    verse: VerseSummaryOut
    # Ordering score from reciprocal rank fusion: comparable within one result
    # set, meaningless as an absolute number.
    score: float
    # Absolute match strength, 0..1. The Ask pipeline gates on this.
    relevance: float = 0.0
    matched_by: list[str] = Field(default_factory=list)
    snippet: str | None = None
    snippet_field: str | None = None


class GlossaryHintOut(ApiModel):
    id: uuid.UUID
    slug: str
    term_sanskrit: str
    term_transliteration: str
    simple_definition: str


class SearchResponse(ApiModel):
    query: str
    normalized_query: str
    detected_language: str
    reference: SearchReference | None = None
    hits: list[SearchHitOut] = Field(default_factory=list)
    topics: list[TopicSummaryOut] = Field(default_factory=list)
    glossary: list[GlossaryHintOut] = Field(default_factory=list)
    total: int
    took_ms: int


class AskRequest(ApiModel):
    question: str = Field(min_length=3, max_length=1000)
    mode: AskMode = "default"
    language: str | None = Field(default=None, max_length=10)
    verse_ref: str | None = Field(default=None, max_length=16)
    conversation_id: uuid.UUID | None = None

    @field_validator("question")
    @classmethod
    def _strip(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("Please ask a fuller question.")
        return cleaned


class AskCitationOut(ApiModel):
    verse: VerseSummaryOut
    # Copied verbatim from a stored canonical row. The model never supplies it.
    quoted_text: str
    quoted_field: str
    translation_language: str | None = None
    commentator_name: str | None = None
    source_name: str | None = None
    source_url: str | None = None
    license_code: str | None = None


class AskResponse(ApiModel):
    id: uuid.UUID
    question: str
    normalized_question: str
    detected_language: str
    mode: AskMode
    answer: str
    grounding_status: str
    citations: list[AskCitationOut] = Field(default_factory=list)
    rejected_citations: list[str] = Field(default_factory=list)
    follow_up_suggestions: list[str] = Field(default_factory=list)
    disclaimer: str | None = None
    model_provider: str
    model_name: str
    took_ms: int
    created_at: datetime


class AskFeedbackRequest(ApiModel):
    # -1 (unhelpful) or 1 (helpful). Nothing free-text is stored by default.
    rating: int = Field(ge=-1, le=1)

    @field_validator("rating")
    @classmethod
    def _nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Rating must be -1 or 1.")
        return value
