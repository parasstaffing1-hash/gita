"""Authentication.

Sign-in is optional throughout the product, so most dependencies here return an
optional user. Endpoints that genuinely need an identity use `require_user`.

The token format is a signed JWT with a short-lived access token and a longer
refresh token. Google and Apple sign-in slot in by populating
`users.auth_provider` / `auth_provider_subject` — no schema change needed.
"""

from __future__ import annotations

import base64
import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import bcrypt
from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from gita_api.config import settings
from gita_api.db.models import AdminUser, User
from gita_api.db.session import get_db

ALGORITHM = "HS256"


# bcrypt only reads the first 72 bytes of its input. Hashing the password first
# means the length limit can never be reached, so a long passphrase is used in
# full rather than silently truncated - and two passwords sharing a 72-byte
# prefix no longer authenticate each other.
#
# Base64 rather than hex because the digest is then 44 bytes instead of 64, and
# because a raw digest can contain a NUL byte, which bcrypt treats as a string
# terminator.
def _prepare(password: str) -> bytes:
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(password), hashed.encode("ascii"))
    except ValueError:
        # A malformed or truncated stored hash must read as "wrong password",
        # not as a 500.
        return False


def create_token(subject: str, *, token_type: str = "access", extra: dict | None = None) -> str:
    now = datetime.now(UTC)
    ttl = (
        timedelta(minutes=settings.access_token_ttl_minutes)
        if token_type == "access"
        else timedelta(days=settings.refresh_token_ttl_days)
    )
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        **(extra or {}),
    }
    return jwt.encode(payload, settings.api_secret_key, algorithm=ALGORITHM)


def decode_token(token: str, *, expected_type: str = "access") -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.api_secret_key, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        ) from exc
    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type")
    return payload


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def get_optional_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User | None:
    """Resolve the caller if they are signed in; otherwise None (guest)."""
    token = _bearer_token(authorization)
    if not token:
        return None
    try:
        payload = decode_token(token)
    except HTTPException:
        # A stale token on a guest-friendly endpoint should degrade to guest,
        # not fail the request.
        return None
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        return None
    user = db.get(User, user_id)
    if user is None or not user.is_active or user.deleted_at is not None:
        return None
    return user


def require_user(
    user: Annotated[User | None, Depends(get_optional_user)],
) -> User:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to use this feature",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_admin(
    x_admin_token: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> AdminUser | None:
    """Admin authorisation.

    Two accepted paths:
      * `X-Admin-Token` — a bootstrap token for scripts and first-run setup.
      * A bearer token belonging to an active `admin_users` row.

    Returns the AdminUser when one is identified, or None for token auth, so
    the change log can record who made an edit whenever that is known.
    """
    if x_admin_token and _constant_time_equals(x_admin_token, settings.admin_api_token):
        return None

    token = _bearer_token(authorization)
    if token:
        payload = decode_token(token)
        if payload.get("scope") == "admin":
            try:
                admin_id = uuid.UUID(str(payload.get("sub")))
            except (ValueError, TypeError):
                admin_id = None
            if admin_id is not None:
                admin = db.get(AdminUser, admin_id)
                if admin is not None and admin.is_active:
                    return admin

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin credentials required")


def require_admin_role(*roles: str):
    """Dependency factory enforcing a minimum admin role."""

    allowed = set(roles)

    def _dependency(admin: Annotated[AdminUser | None, Depends(require_admin)]) -> AdminUser | None:
        # Bootstrap token auth (admin is None) has full rights by design; it is
        # only ever issued to operators running migrations and imports.
        if admin is None:
            return None
        if admin.role == "admin" or admin.role in allowed:
            return admin
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This action requires one of: {', '.join(sorted(allowed))}",
        )

    return _dependency


def _constant_time_equals(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def find_user_by_email(db: Session, email: str) -> User | None:
    stmt = select(User).where(User.email == email.lower().strip(), User.deleted_at.is_(None))
    return db.execute(stmt).scalar_one_or_none()
