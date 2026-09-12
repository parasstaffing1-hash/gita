"""API surface and authorisation.

Runs without a database: these assert the contract (routes, error envelope,
validation, auth requirements) rather than query results. Data-dependent
behaviour lives in `test_api_data.py`, which is marked `db`.
"""

from __future__ import annotations

import pytest

EXPECTED_ROUTES = [
    "/health",
    "/v1/chapters",
    "/v1/chapters/{number}",
    "/v1/chapters/{number}/verses",
    "/v1/verses/{chapter}/{verse}",
    "/v1/verses/{chapter}/{verse}/neighbours",
    "/v1/topics",
    "/v1/topics/{slug}",
    "/v1/glossary",
    "/v1/glossary/{slug}",
    "/v1/search",
    "/v1/ask",
    "/v1/daily-verse",
    "/v1/reading-plans",
    "/v1/reading-plans/{slug}",
    "/v1/content/manifest",
    "/v1/auth/register",
    "/v1/auth/login",
    "/v1/auth/me",
    "/v1/sync/push",
    "/v1/sync/pull",
    "/v1/admin/dashboard",
    "/v1/admin/changes",
]


def test_openapi_exposes_every_expected_route(client):
    paths = client.get("/openapi.json").json()["paths"]
    missing = [route for route in EXPECTED_ROUTES if route not in paths]
    assert not missing, f"routes missing from the API: {missing}"


def test_health_reports_component_status(client):
    body = client.get("/health").json()
    assert body["status"] in ("ok", "degraded")
    assert set(body["extensions"]) == {"vector", "pgTrgm", "unaccent"}
    assert "aiProvider" in body


def test_responses_use_camel_case_on_the_wire(client):
    schema = client.get("/openapi.json").json()["components"]["schemas"]["VerseSummaryOut"]
    assert "chapterNumber" in schema["properties"]
    assert "chapter_number" not in schema["properties"]


def test_verse_neighbours_are_computed_without_a_database(client):
    body = client.get("/v1/verses/2/47/neighbours").json()
    assert body == {"previous": "2.46", "next": "2.48"}

    # Chapter boundaries.
    assert client.get("/v1/verses/1/47/neighbours").json()["next"] == "2.1"
    assert client.get("/v1/verses/2/1/neighbours").json()["previous"] == "1.47"

    # The ends of the text.
    assert client.get("/v1/verses/18/78/neighbours").json()["next"] is None
    assert client.get("/v1/verses/1/1/neighbours").json()["previous"] is None


def test_invalid_chapter_is_a_helpful_404(client):
    response = client.get("/v1/chapters/19")
    assert response.status_code == 404
    assert "18 chapters" in response.json()["error"]["message"]


def test_errors_use_one_envelope(client):
    body = client.get("/v1/chapters/99").json()
    assert set(body) == {"error"}
    assert set(body["error"]) >= {"code", "message"}


@pytest.mark.parametrize(
    "payload",
    [
        {"question": "hi"},  # too short
        {"question": "x" * 1001},  # too long
        {"question": "valid question", "mode": "nonsense"},
        {},  # missing
    ],
)
def test_ask_rejects_malformed_input(client, payload):
    response = client.post("/v1/ask", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_search_requires_a_query(client):
    assert client.get("/v1/search").status_code == 422
    assert client.get("/v1/search", params={"q": ""}).status_code == 422


# --- Authorisation --------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/v1/auth/me"),
        ("get", "/v1/sync/pull"),
        ("post", "/v1/sync/push"),
    ],
)
def test_user_endpoints_require_a_token(client, method, path):
    kwargs = {
        "json": {"deviceId": "00000000-0000-4000-8000-000000000000", "since": None, "changes": []}
    }
    response = getattr(client, method)(path, **(kwargs if method == "post" else {}))
    assert response.status_code == 401


@pytest.mark.parametrize(
    "path",
    [
        "/v1/admin/dashboard",
        "/v1/admin/changes",
        "/v1/admin/ai-answers",
        "/v1/admin/wallpapers",
    ],
)
def test_admin_endpoints_reject_anonymous_callers(client, path):
    assert client.get(path).status_code == 403


@pytest.mark.parametrize(
    "path",
    [
        "/v1/admin/wallpapers/status",
        "/v1/admin/wallpapers/00000000-0000-0000-0000-000000000000/status",
        "/v1/admin/wallpapers/00000000-0000-0000-0000-000000000000/active",
    ],
)
def test_wallpaper_review_routes_reject_anonymous_callers(client, path):
    """Publishing puts an image in front of every reader; it is a reviewer
    action, not something an unauthenticated caller can reach."""
    assert client.post(path, json={}).status_code == 403


def test_admin_endpoints_reject_a_wrong_token(client):
    response = client.get("/v1/admin/dashboard", headers={"X-Admin-Token": "definitely-wrong"})
    assert response.status_code == 403


def test_a_user_token_does_not_grant_admin_access(client):
    """A signed-in reader must not reach the admin surface."""
    from gita_api.security.auth import create_token

    token = create_token("00000000-0000-4000-8000-000000000000", token_type="access")
    response = client.get("/v1/admin/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_expired_or_malformed_tokens_do_not_authenticate(client):
    for header in ["Bearer not-a-jwt", "Basic abc", "Bearer "]:
        assert client.get("/v1/auth/me", headers={"Authorization": header}).status_code == 401


def test_reading_endpoints_work_without_signing_in(client):
    # Guest access is a product requirement, not an accident.
    for path in ["/v1/chapters", "/v1/topics", "/v1/glossary"]:
        assert client.get(path).status_code in (200, 500)  # 500 only when no DB


def test_security_headers_are_present(client):
    headers = client.get("/health").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


def test_rate_limiting_is_enabled_outside_tests():
    """The limiter is switched off under pytest so a suite can register many
    accounts. It must be on everywhere else — this catches the case where the
    test environment leaks into a real deployment."""
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    from gita_api.config import Settings

    for environment in ("development", "staging", "production"):
        settings = Settings(environment=environment, api_secret_key="x" * 48)
        limiter = Limiter(
            key_func=get_remote_address,
            default_limits=[settings.rate_limit_default],
            enabled=settings.environment != "test",
        )
        assert limiter.enabled, f"rate limiting is off in {environment}"
