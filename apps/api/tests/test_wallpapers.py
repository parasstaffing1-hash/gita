"""The wallpaper use counter.

`use_count` is the picker's default sort key and the only column an
unauthenticated caller can move. The endpoint used to accept any string,
answer 204 and increment blind, so a loop could promote a draft or a retired
wallpaper to the front of every reader's picker — and probe which slugs exist
while doing it. These pin the counter to what the catalogue actually serves.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

pytestmark = pytest.mark.db


@pytest.fixture
def wallpaper(db_session):
    """Make throwaway wallpapers and take them back out again.

    The library on a working database is real content; these rows are created
    and deleted around one test rather than left behind in it.
    """
    created = []

    def _make(**overrides):
        from gita_api.db.models import Wallpaper

        handle = uuid.uuid4().hex[:12]
        row = Wallpaper(
            slug=f"test-{handle}",
            title="Test wallpaper",
            object_key=f"wallpapers/test/{handle}.jpg",
            width=1080,
            height=1920,
            # `draft` needs no licence on file, so a fixture cannot accidentally
            # publish an unlicensed image.
            verification_status="draft",
            **overrides,
        )
        db_session.add(row)
        db_session.commit()
        created.append(row)
        return row

    yield _make

    for row in created:
        db_session.delete(row)
    db_session.commit()


def _total_uses(db_session) -> int:
    from gita_api.db.models import Wallpaper

    total = db_session.execute(select(func.coalesce(func.sum(Wallpaper.use_count), 0)))
    return int(total.scalar_one())


def test_using_a_visible_wallpaper_counts(client, db_session, wallpaper):
    row = wallpaper()

    assert client.post(f"/v1/wallpapers/{row.slug}/used").status_code == 204

    db_session.refresh(row)
    assert row.use_count == 1


def test_using_a_deactivated_wallpaper_is_refused(client, db_session, wallpaper):
    """Deactivating a wallpaper takes it out of the picker. It must also take
    it out of reach of the counter that ranks the picker."""
    row = wallpaper(is_active=False)

    assert client.post(f"/v1/wallpapers/{row.slug}/used").status_code == 404

    db_session.refresh(row)
    assert row.use_count == 0


def test_using_an_unknown_slug_is_refused_and_writes_nothing(client, db_session):
    before = _total_uses(db_session)

    response = client.post(f"/v1/wallpapers/not-a-wallpaper-{uuid.uuid4().hex[:8]}/used")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_error"
    assert _total_uses(db_session) == before


def test_an_invisible_wallpaper_answers_the_same_way_to_both_verbs(client, wallpaper):
    """Reading and counting disclose exactly as much as each other, so the
    counter cannot be used to enumerate slugs that `GET` will not confirm."""
    row = wallpaper(is_active=False)

    assert client.get(f"/v1/wallpapers/{row.slug}").status_code == 404
    assert client.post(f"/v1/wallpapers/{row.slug}/used").status_code == 404


def test_the_use_counter_is_rate_limited(client, wallpaper):
    """The route carries its own limit: SlowAPIMiddleware never resolves a
    route handler under Starlette 1.6, so the app-wide default reaches nothing
    and a decorator is the only limit a public write actually gets.

    Switched on for the duration, because the limiter being off under pytest is
    exactly what hides a misdeclared endpoint — slowapi injects its headers into
    a `response` parameter and raises if the signature has none.
    """
    from gita_api.routers.wallpapers import record_use
    from gita_api.security.rate_limit import limiter

    name = f"{record_use.__module__}.{record_use.__name__}"
    assert name in limiter._route_limits, "POST /{slug}/used is not rate limited"

    row = wallpaper()
    limiter.enabled = True
    try:
        response = client.post(f"/v1/wallpapers/{row.slug}/used")
    finally:
        limiter.enabled = False

    assert response.status_code == 204, response.text
    assert "x-ratelimit-limit" in response.headers
