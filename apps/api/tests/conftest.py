"""Test fixtures.

Tests that need only pure logic (parsing, normalisation, hashing, grounding)
run everywhere with no services. Tests that need PostgreSQL are marked
`@pytest.mark.db` and skip automatically when no database is reachable, so
`pytest` is always runnable on a fresh checkout.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parent.parent

# Make the API and the local service packages importable without an install.
for path in [
    API_ROOT,
    REPO_ROOT / "services" / "search",
    REPO_ROOT / "services" / "ai",
    REPO_ROOT / "services" / "embeddings",
    REPO_ROOT / "services" / "ingestion",
    REPO_ROOT / "services" / "audio",
]:
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

# Deterministic, offline defaults so a test run never calls a paid API or
# downloads a model.
os.environ.setdefault("AI_PROVIDER", "echo")
os.environ.setdefault("EMBEDDING_USE_STUB", "1")
os.environ.setdefault("ENVIRONMENT", "test")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "db: requires a reachable PostgreSQL instance")


def _database_available() -> bool:
    try:
        from sqlalchemy import text

        from gita_api.db.session import get_engine

        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def database_available() -> bool:
    return _database_available()


@pytest.fixture(autouse=True)
def _skip_db_tests(request: pytest.FixtureRequest) -> None:
    if request.node.get_closest_marker("db") and not request.getfixturevalue("database_available"):
        pytest.skip("No PostgreSQL reachable at DATABASE_URL")


@pytest.fixture
def db_session():
    from gita_api.db.session import get_session_factory

    session = get_session_factory()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from gita_api.main import app

    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
