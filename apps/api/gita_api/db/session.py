"""Engine and session management.

Synchronous SQLAlchemy on purpose. FastAPI runs `def` endpoints in a worker
threadpool, which is more than adequate at this scale and avoids the async
driver footguns (and the sentence-transformers sync boundary) entirely.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from gita_api.config import settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(
            settings.database_url,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_pre_ping=True,
            echo=settings.db_echo,
            future=True,
            # Fail fast when the database is unreachable. Without this the
            # driver's default TCP timeout leaves a request (and the test
            # suite) hanging for minutes on a database that is simply not up.
            connect_args={"connect_timeout": settings.db_connect_timeout_seconds},
        )
        _register_pgvector(_engine)
    return _engine


def _register_pgvector(engine: Engine) -> None:
    """Teach psycopg how to adapt the `vector` type on every new connection."""

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):
        try:
            from pgvector.psycopg import register_vector

            register_vector(dbapi_connection)
        except Exception:  # pragma: no cover - extension not installed yet
            # Migrations create the extension; the first connection during a
            # fresh bootstrap legitimately has no `vector` type yet.
            pass


def get_session_factory() -> sessionmaker[Session]:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False
        )
        # Installed here rather than at application startup so that every
        # session is guarded - including the ones opened by the import script,
        # the reindexer and any background job, none of which run the web app's
        # lifespan. A protection you have to remember to switch on is not one.
        from gita_api.security.content_guard import install_canonical_write_guard

        install_canonical_write_guard(_SessionLocal)
    return _SessionLocal


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for scripts and background jobs."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_extensions(session: Session) -> dict[str, bool]:
    """Report which required extensions are installed, for /health."""
    rows = session.execute(text("SELECT extname FROM pg_extension")).scalars().all()
    installed = set(rows)
    return {name: name in installed for name in ("vector", "pg_trgm", "unaccent")}
