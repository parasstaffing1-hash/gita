"""Canonical content guard.

The single hard rule of this product: AI output must never become scripture.
This module enforces it at the service boundary rather than trusting every call
site to remember.

Three protections:

1. `CANONICAL_TABLES` — a list of tables the AI service may only read. The
   session guard raises if a write to one of them is attempted while the
   "ai" role is active.
2. `assert_not_ai_generated` — content ingested into canonical tables must not
   carry `origin='ai_generated'`.
3. `assert_publishable` — a record may only reach `verified`/`published` if its
   source is marked authoritative.
"""

from __future__ import annotations

import contextvars
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException, status
from sqlalchemy import event
from sqlalchemy.orm import Session

# Tables that hold verified scripture and its apparatus. Read-only for AI.
CANONICAL_TABLES = frozenset(
    {
        "chapters",
        "verses",
        "verse_text_versions",
        "transliteration_versions",
        "translations",
        "commentaries",
        "commentators",
        "verse_words",
        "sanskrit_terms",
        "glossary_terms",
        "topics",
        "verse_topics",
        "related_verses",
        "content_sources",
        "content_licenses",
        "daily_verses",
        "reading_plans",
        "reading_plan_days",
        "audio_tracks",
    }
)

# Tables the AI pipeline is allowed to write.
AI_WRITABLE_TABLES = frozenset({"ai_queries", "ai_answers", "ai_answer_sources"})

_actor: contextvars.ContextVar[str] = contextvars.ContextVar("gita_actor", default="app")


class CanonicalWriteError(RuntimeError):
    """Raised when a component without canonical write rights tries to write."""


@contextmanager
def ai_actor() -> Iterator[None]:
    """Mark the current context as the AI service.

    Any attempt to flush a canonical row inside this block fails loudly.
    """
    token = _actor.set("ai")
    try:
        yield
    finally:
        _actor.reset(token)


def current_actor() -> str:
    return _actor.get()


_GUARDED: set[int] = set()


def install_canonical_write_guard(session: Session) -> None:
    """Attach the flush guard to a session factory.

    Called from `get_session_factory()`, so every session in the process is
    covered - web requests, CLI scripts and background jobs alike. It inspects
    the unit of work before it reaches the database, so the protection cannot
    be bypassed by forgetting a check inside a service function.

    Idempotent: registering the same target twice would raise on every blocked
    write twice over, and would quietly double the work on every flush.
    """
    if id(session) in _GUARDED:
        return
    _GUARDED.add(id(session))

    @event.listens_for(session, "before_flush")
    def _before_flush(sess: Session, _flush_context, _instances) -> None:
        if current_actor() != "ai":
            return
        touched = [
            obj
            for obj in list(sess.new) + list(sess.dirty) + list(sess.deleted)
            if getattr(obj, "__tablename__", None) in CANONICAL_TABLES
        ]
        if touched:
            names = sorted({obj.__tablename__ for obj in touched})
            raise CanonicalWriteError(
                "The AI service has no write access to canonical scripture. "
                f"Blocked write to: {', '.join(names)}"
            )


def assert_not_ai_generated(origin: str, *, table: str) -> None:
    """Reject AI-authored content on its way into a canonical table."""
    if origin == "ai_generated" and table in CANONICAL_TABLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Generated content cannot be stored in `{table}`. "
                "Canonical scripture is authored and reviewed by editors only."
            ),
        )


def assert_publishable(status_value: str, *, source_is_authoritative: bool, ref: str) -> None:
    """A record cannot claim verified/published status without an authoritative
    source. This is what stops a development placeholder from silently becoming
    something a reader would trust."""
    if status_value in ("verified", "published") and not source_is_authoritative:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"{ref} cannot be marked '{status_value}': its source is not marked "
                "authoritative. Verify the text against a printed edition and update "
                "the source record first."
            ),
        )
