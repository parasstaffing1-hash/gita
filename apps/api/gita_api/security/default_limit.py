"""The app-wide request ceiling.

`slowapi` ships middleware for exactly this, and it does nothing here. Both of
its middlewares resolve the route handler by walking `app.routes` for a full
match carrying an `.endpoint`; since Starlette 1.6 an included router stays a
`_IncludedRouter` wrapper that matches the path but exposes neither an endpoint
nor its children. The handler resolves to `None`, `None` is treated as exempt,
and every request skips the check. `RATE_LIMIT_DEFAULT` was protecting nothing,
silently, while the setting sat in `.env` looking like it was.

So the ceiling is applied here instead, against `limits` directly — the library
`slowapi` itself wraps. The per-route `@limiter.limit(...)` decorators are
unaffected and still apply their own tighter buckets on top of this one; a
request has to satisfy both.
"""

from __future__ import annotations

import secrets

from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from gita_api.config import settings
from gita_api.security.rate_limit import identify, limiter


class DefaultRateLimitMiddleware:
    """One shared bucket per caller across every HTTP route.

    A moving window rather than a fixed one: a fixed window lets a caller spend
    a full allowance at 59 seconds and another at 61, which is twice the limit
    in two seconds and exactly the burst this is meant to stop.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.item = parse(settings.rate_limit_default)
        self.limiter = MovingWindowRateLimiter(MemoryStorage())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # `limiter.enabled` is the single switch the test suite flips, so the
        # ceiling honours it too rather than inventing a second one.
        if scope["type"] != "http" or not limiter.enabled:
            await self.app(scope, receive, send)
            return

        # Never ration the liveness probe: a rate-limited health check reads as
        # an outage to whatever is watching it.
        #
        # Nor the media mount. It is a static file server that happens to share
        # a process with the API, and one screen of the wallpaper picker is
        # sixty thumbnails — counting those against an API budget means opening
        # the picker once spends most of a reader's minute, and paging through
        # the library locks them out of the API entirely. In production these
        # files come from R2 and never reach this process at all.
        path = scope.get("path") or ""
        if path == "/health" or path.startswith("/media/"):
            await self.app(scope, receive, send)
            return

        # This deployment's own renderer is not a public caller. A single build
        # prerenders every verse page from one address, which is
        # indistinguishable from abuse by source alone - and in production the
        # same happens on every ISR revalidation. The secret is compared in
        # constant time and an unset secret exempts nobody.
        if settings.internal_api_token and _is_internal(scope):
            await self.app(scope, receive, send)
            return

        key = identify(scope)
        if not self.limiter.hit(self.item, key):
            await _too_many(send)
            return

        window = self.limiter.get_window_stats(self.item, key)

        async def with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers.append((b"x-ratelimit-limit", str(self.item.amount).encode()))
                headers.append((b"x-ratelimit-remaining", str(window.remaining).encode()))
                headers.append((b"x-ratelimit-reset", str(int(window.reset_time)).encode()))
            await send(message)

        await self.app(scope, receive, with_headers)


def _is_internal(scope: Scope) -> bool:
    for name, value in scope.get("headers") or ():
        if name == b"x-internal-token":
            return secrets.compare_digest(
                value.decode("latin-1"), settings.internal_api_token
            )
    return False


async def _too_many(send: Send) -> None:
    """The same envelope the app's other errors use, written directly because a
    middleware sits outside FastAPI's exception handlers."""
    body = b'{"error":{"code":"rate_limited","message":"Too many requests. Please slow down."}}'
    await send(
        {
            "type": "http.response.start",
            "status": 429,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
