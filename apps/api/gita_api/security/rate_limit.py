"""Rate limiting.

In-memory limiter by default: cheap, no Redis, adequate for a single API
instance. `RATE_LIMIT_*` settings tune the buckets; the AI endpoint gets a much
tighter limit than reading, since it is the only expensive path.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from gita_api.config import settings


def _bucket(bearer: str | None, client_host: str) -> str:
    """Prefer the authenticated user, fall back to the client address.

    Signed-in users get their own bucket so one busy network (a campus, an
    office) cannot exhaust everyone else's quota.
    """
    if bearer:
        return f"token:{bearer[:32]}"
    return client_host


def _identify(request: Request) -> str:
    """Bucket key for slowapi's per-route decorators."""
    auth = request.headers.get("authorization", "")
    bearer = auth[7:] if auth.lower().startswith("bearer ") else None
    return _bucket(bearer, get_remote_address(request))


def identify(scope: Mapping[str, Any]) -> str:
    """Bucket key from a raw ASGI scope, for the app-wide ceiling.

    The same rule as `_identify`, reading the scope directly so the middleware
    does not have to build a `Request` just to hash a header.
    """
    bearer: str | None = None
    for name, value in scope.get("headers") or ():
        if name == b"authorization":
            decoded = value.decode("latin-1")
            if decoded.lower().startswith("bearer "):
                bearer = decoded[7:]
            break
    client = scope.get("client")
    return _bucket(bearer, client[0] if client else "unknown")


limiter = Limiter(
    key_func=_identify,
    default_limits=[settings.rate_limit_default],
    headers_enabled=True,
    # Off under `pytest`, where a suite legitimately registers a dozen accounts
    # in a second. `test_rate_limiting_is_enabled_outside_tests` asserts that
    # this is the only environment it is ever off in.
    enabled=settings.environment != "test",
)
