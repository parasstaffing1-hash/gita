"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from gita_api.config import settings
from gita_api.db.session import check_extensions, get_session_factory
from gita_api.routers import admin, auth, content, daily, search, sync, wallpapers
from gita_api.schemas.common import (
    AiProviderStatus,
    ExtensionStatus,
    HealthResponse,
)
from gita_api.security.content_guard import CanonicalWriteError
from gita_api.security.default_limit import DefaultRateLimitMiddleware
from gita_api.security.rate_limit import limiter

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
)
logger = logging.getLogger("gita_api")


def _init_sentry() -> None:
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        # User notes and AI questions are private; never ship request bodies.
        send_default_pii=False,
        max_request_body_size="never",
    )
    logger.info("Sentry initialised for %s", settings.environment)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_sentry()
    # The canonical write guard is installed by `get_session_factory()` itself,
    # so it is already active here and in every script that opens a session.
    get_session_factory()
    logger.info(
        "Gita API %s starting (env=%s, ai=%s, embeddings=%s)",
        settings.api_version,
        settings.environment,
        settings.ai_provider,
        "stub" if settings.embedding_use_stub else settings.embedding_model,
    )
    yield
    logger.info("Gita API shutting down")


app = FastAPI(
    title="Bhagavad Gita API",
    version=settings.api_version,
    description=(
        "Read-only canonical scripture, hybrid search, and grounded answers. "
        "Canonical content is never generated: every AI answer cites verses "
        "stored in this database."
    ),
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.state.limiter = limiter
# Not `SlowAPIMiddleware`: it cannot see past Starlette 1.6's included-router
# wrappers, so it exempts every request. See `security/default_limit`.
app.add_middleware(DefaultRateLimitMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Token", "X-Session-Id"],
    max_age=600,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if settings.is_production:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
        )
    return response


# --- Error shape ----------------------------------------------------------
# One envelope for every failure, matching ApiErrorBody in @gita/types.


def _error(code: str, message: str, status_code: int, details=None) -> JSONResponse:
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=body)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
    return _error("http_error", str(exc.detail), exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    return _error(
        "validation_error",
        "The request did not pass validation.",
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        details=exc.errors(),
    )


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(_request: Request, exc: RateLimitExceeded):
    return _error(
        "rate_limited",
        "Too many requests. Please slow down.",
        status.HTTP_429_TOO_MANY_REQUESTS,
    )


@app.exception_handler(CanonicalWriteError)
async def canonical_write_handler(_request: Request, exc: CanonicalWriteError):
    # This should be unreachable. If it fires, something tried to write
    # scripture from the AI path — loud, not silent.
    logger.error("Blocked a canonical write: %s", exc)
    return _error("canonical_write_blocked", str(exc), status.HTTP_403_FORBIDDEN)


@app.exception_handler(Exception)
async def unhandled_handler(_request: Request, exc: Exception):
    logger.exception("Unhandled error")
    return _error(
        "internal_error",
        "Something went wrong on our side.",
        status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


# --- Health ---------------------------------------------------------------


@app.get("/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    database_ok = True
    extensions = {"vector": False, "pg_trgm": False, "unaccent": False}
    try:
        session = get_session_factory()()
        try:
            session.execute(text("SELECT 1"))
            extensions = check_extensions(session)
        finally:
            session.close()
    except Exception:
        logger.warning("Health check could not reach the database", exc_info=True)
        database_ok = False

    provider_healthy = False
    provider_name = settings.ai_provider
    try:
        from gita_api.services.ask import get_provider

        provider = get_provider()
        provider_name = provider.name
        # Only the offline provider is probed on every health check; probing a
        # paid provider here would bill a token for every uptime ping.
        provider_healthy = provider.name == "echo" or bool(settings.ai_api_key)
    except Exception:
        logger.warning("AI provider is unavailable", exc_info=True)

    healthy = database_ok and all(extensions.values())
    return HealthResponse(
        status="ok" if healthy else "degraded",
        version=settings.api_version,
        database=database_ok,
        extensions=ExtensionStatus(**extensions),
        ai_provider=AiProviderStatus(name=provider_name, healthy=provider_healthy),
    )


app.include_router(content.router)
app.include_router(search.router)
app.include_router(daily.router)
app.include_router(auth.router)
app.include_router(sync.router)
# Development-only static mount, so the quote maker has images to compose
# with before R2 exists. Guarded twice: never in production, and never when R2
# is configured, so it cannot silently shadow real storage.
if not settings.is_production and not settings.r2_configured:
    import mimetypes

    from fastapi.staticfiles import StaticFiles

    # Windows in particular has no registry entry for these, and a wallpaper
    # served as application/octet-stream will not decode in a canvas.
    mimetypes.add_type("image/webp", ".webp")
    mimetypes.add_type("image/avif", ".avif")

    settings.local_media_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/media",
        StaticFiles(directory=str(settings.local_media_dir)),
        name="media",
    )
    logger.info("Serving local media from %s (R2 is not configured)", settings.local_media_dir)

app.include_router(wallpapers.router)
app.include_router(admin.router)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {
        "name": "Bhagavad Gita API",
        "version": settings.api_version,
        "docs": "/docs" if not settings.is_production else "disabled",
    }
