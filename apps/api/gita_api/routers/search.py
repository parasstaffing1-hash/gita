"""Search and Ask the Gita endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from gita_api.config import settings
from gita_api.db.models import AiAnswer, User
from gita_api.db.session import get_db
from gita_api.schemas.search import (
    AskFeedbackRequest,
    AskRequest,
    AskResponse,
    SearchResponse,
)
from gita_api.security.auth import get_optional_user
from gita_api.security.rate_limit import limiter
from gita_api.services import ask as ask_service
from gita_api.services import search as search_service

router = APIRouter(prefix="/v1", tags=["search"])


@router.get("/search", response_model=SearchResponse)
@limiter.limit(settings.rate_limit_search)
def search(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    language: Annotated[str | None, Query(max_length=10)] = None,
    semantic: Annotated[bool, Query()] = True,
) -> SearchResponse:
    """Hybrid search.

    Handles references ("2.47"), Devanagari, IAST, Hinglish, plain English and
    natural-language questions through the same entry point.
    """
    return search_service.search(db, q, limit=limit, language=language, semantic=semantic)


@router.post("/ask", response_model=AskResponse)
@limiter.limit(settings.rate_limit_ai)
def ask(
    request: Request,
    response: Response,
    payload: AskRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_optional_user)] = None,
) -> AskResponse:
    """Answer a question, grounded in verified verses.

    Guests may ask. Nothing about the question is attached to an identity
    unless the caller is signed in.
    """
    client = "mobile" if "okhttp" in request.headers.get("user-agent", "").lower() else "web"
    session_header = request.headers.get("x-session-id")
    session_id: uuid.UUID | None = None
    if session_header:
        try:
            session_id = uuid.UUID(session_header)
        except ValueError:
            session_id = None

    return ask_service.ask(
        db,
        payload,
        user_id=user.id if user else None,
        session_id=session_id,
        client=client,
    )


@router.post("/ask/{answer_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
def submit_feedback(
    answer_id: uuid.UUID,
    payload: AskFeedbackRequest,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Record a thumbs up/down.

    Only the rating is stored — no free text, so a user cannot accidentally
    send private reflections into the review queue.
    """
    answer = db.execute(select(AiAnswer).where(AiAnswer.id == answer_id)).scalar_one_or_none()
    if answer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Answer not found")
    answer.user_feedback = payload.rating
    if payload.rating < 0 and answer.review_status == "unreviewed":
        # A negative rating puts the answer in front of an editor.
        answer.review_status = "flagged"
