"""Cloudflare R2 access.

Audio, share images and downloadable bundles live in R2. Public assets are
served from a CDN domain; anything not public gets a short-lived signed URL.

No R2 credential ever reaches a client: the app asks this API for a URL.
"""

from __future__ import annotations

import functools
import logging

from gita_api.config import settings

logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1)
def _client():
    """Lazily build the S3-compatible client.

    Returns None when R2 is unconfigured, which is the normal state in local
    development — the app then falls back to whatever public base URL is set.
    """
    if not settings.r2_configured:
        return None
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    )


def resolve_audio_url(object_key: str | None) -> str | None:
    """A URL the client can actually fetch, whatever the storage situation is.

    In order: the CDN domain, a signed R2 URL, or - only while R2 is
    unconfigured - the API's own local media mount. The object key is the same
    in all three cases, so moving to R2 changes credentials and nothing else.
    """
    if not object_key:
        return None
    if settings.r2_public_base_url:
        return f"{settings.r2_public_base_url.rstrip('/')}/{object_key.lstrip('/')}"
    if settings.r2_configured:
        return signed_url(object_key)
    return local_media_url(object_key)


def local_media_url(object_key: str) -> str | None:
    """Development fallback. Returns None in production, where a missing R2
    configuration is a deployment error and must not be papered over."""
    if settings.is_production:
        return None
    candidate = settings.local_media_dir / object_key
    if not candidate.exists():
        return None
    return f"{settings.local_media_base_url.rstrip('/')}/{object_key.lstrip('/')}"


def signed_url(object_key: str, *, expires_in: int | None = None) -> str | None:
    client = _client()
    if client is None:
        # TODO: requires R2 credentials. Until they exist, audio endpoints
        # report no URL rather than returning a broken link.
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.r2_bucket, "Key": object_key},
            ExpiresIn=expires_in or settings.r2_signed_url_ttl_seconds,
        )
    except Exception:  # pragma: no cover - network/credential failure
        logger.exception("Failed to sign R2 URL for %s", object_key)
        return None


def upload_bytes(object_key: str, data: bytes, content_type: str) -> bool:
    """Store an object. Used by the admin panel and the importers, never by a client.

    Falls back to the local media directory when R2 is unconfigured, using the
    same key as the object path. That makes the import pipeline exercisable end
    to end before credentials exist, and means switching to R2 moves the same
    keys rather than reorganising anything.
    """
    client = _client()
    if client is not None:
        client.put_object(
            Bucket=settings.r2_bucket, Key=object_key, Body=data, ContentType=content_type
        )
        return True

    if settings.is_production:
        # In production an unconfigured R2 is a deployment error. Writing to
        # local disk there would look like success and lose the file on the
        # next deploy.
        logger.error("R2 is not configured; refusing to write %s to local disk", object_key)
        return False

    destination = settings.local_media_dir / object_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return True


def object_exists(object_key: str) -> bool:
    client = _client()
    if client is None:
        return False
    try:
        client.head_object(Bucket=settings.r2_bucket, Key=object_key)
        return True
    except Exception:
        return False
