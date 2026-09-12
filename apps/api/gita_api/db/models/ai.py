"""Ask the Gita: question log, answers and their validated citations.

Every answer row records exactly which canonical rows were in its context and
which citations survived validation. That is what makes an answer auditable
after the fact and what the admin AI-review queue reads.

The AI service has read-only access to canonical tables. It writes only here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gita_api.db.base import Base, TimestampMixin, UUIDMixin

GROUNDING_STATUSES = ("grounded", "partially_grounded", "insufficient_evidence")
ASK_MODES = ("default", "simple", "deep", "beginner", "sources_only", "compare_interpretations")


class AiQuery(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ai_queries"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # Anonymous questions are allowed; the session id is rotating and not tied
    # to an identity.
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    question: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_question: Mapped[str] = mapped_column(Text, nullable=False)
    detected_language: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="default")
    anchor_verse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="SET NULL")
    )
    retrieved_document_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )
    retrieval_debug: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    client: Mapped[str] = mapped_column(String(16), nullable=False, default="web")

    answers: Mapped[list[AiAnswer]] = relationship(
        back_populates="query", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(f"mode IN {ASK_MODES}", name="ask_mode_valid"),
        Index("ix_ai_queries_conversation", "conversation_id"),
        Index("ix_ai_queries_created", "created_at"),
    )


class AiAnswer(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ai_answers"

    query_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_queries.id", ondelete="CASCADE"), nullable=False
    )
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    grounding_status: Mapped[str] = mapped_column(String(24), nullable=False)
    model_provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    # Citations the validator stripped because they were not in the retrieved
    # context. A non-empty list is a hallucination signal worth reviewing.
    rejected_citations: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    follow_up_suggestions: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    # Editorial review state for the admin AI-answer queue.
    review_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unreviewed", server_default="unreviewed"
    )
    reviewer_note: Mapped[str | None] = mapped_column(Text)
    user_feedback: Mapped[int | None] = mapped_column(Integer)

    query: Mapped[AiQuery] = relationship(back_populates="answers")
    sources: Mapped[list[AiAnswerSource]] = relationship(
        back_populates="answer", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(f"grounding_status IN {GROUNDING_STATUSES}", name="grounding_status_valid"),
        CheckConstraint(
            "review_status IN ('unreviewed','approved','flagged','rejected')",
            name="ai_review_status_valid",
        ),
        CheckConstraint(
            "user_feedback IS NULL OR user_feedback IN (-1, 1)", name="user_feedback_valid"
        ),
        Index("ix_ai_answers_review", "review_status", "created_at"),
    )


class AiAnswerSource(Base, UUIDMixin, TimestampMixin):
    """One validated citation.

    `quoted_text` is copied verbatim out of the stored canonical row at build
    time — the model never supplies verse text, only the reference. If the
    validator cannot match a reference back to the retrieved context, no row is
    written here and the reference is recorded in `rejected_citations` instead.
    """

    __tablename__ = "ai_answer_sources"

    answer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_answers.id", ondelete="CASCADE"), nullable=False
    )
    verse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("verses.id", ondelete="RESTRICT"), nullable=False
    )
    verse_ref: Mapped[str] = mapped_column(String(16), nullable=False)
    quoted_field: Mapped[str] = mapped_column(String(24), nullable=False)
    quoted_text: Mapped[str] = mapped_column(Text, nullable=False)
    translation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("translations.id", ondelete="SET NULL")
    )
    commentary_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("commentaries.id", ondelete="SET NULL")
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_sources.id", ondelete="SET NULL")
    )
    relevance_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    validated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    answer: Mapped[AiAnswer] = relationship(back_populates="sources")

    __table_args__ = (
        CheckConstraint(
            "quoted_field IN ('sanskrit','transliteration','translation','commentary')",
            name="quoted_field_valid",
        ),
        Index("ix_ai_answer_sources_answer", "answer_id", "position"),
        Index("ix_ai_answer_sources_verse", "verse_id"),
    )
