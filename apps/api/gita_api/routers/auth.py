"""Authentication endpoints.

Email + password today. Google and Apple sign-in drop in by adding a route that
verifies the provider's id token and then calls `_issue_tokens` with a user
resolved through `auth_provider` / `auth_provider_subject` — no schema change,
no change to any client-side session handling.

Nothing here is required to read, search, listen or bookmark locally. Accounts
exist for cross-device sync.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import EmailStr, Field
from sqlalchemy.orm import Session

from gita_api.config import settings
from gita_api.db.models import Collection, NotificationPreferences, Profile, User
from gita_api.db.session import get_db
from gita_api.schemas.common import ApiModel
from gita_api.security.auth import (
    create_token,
    decode_token,
    find_user_by_email,
    hash_password,
    require_user,
    verify_password,
)
from gita_api.security.rate_limit import limiter

router = APIRouter(prefix="/v1/auth", tags=["auth"])

# Collections every account starts with, so "add to collection" is useful
# immediately instead of asking the reader to invent structure first.
DEFAULT_COLLECTIONS = ("Favorites", "Memorize")


class RegisterRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)
    ui_language: str = Field(default="en", max_length=10)


class LoginRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(ApiModel):
    refresh_token: str


class TokenResponse(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class ProfileOut(ApiModel):
    id: str
    email: str | None
    display_name: str | None
    avatar_url: str | None
    ui_language: str
    content_languages: list[str]
    timezone: str
    reader_preferences: dict
    current_streak: int
    longest_streak: int


def _issue_tokens(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_token(str(user.id), token_type="access"),
        refresh_token=create_token(str(user.id), token_type="refresh"),
        expires_in=settings.access_token_ttl_minutes * 60,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(
    request: Request,
    response: Response,
    payload: RegisterRequest,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    email = payload.email.lower().strip()
    if find_user_by_email(db, email) is not None:
        # Deliberately the same shape as a validation error rather than
        # confirming which addresses are registered.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email cannot be registered.",
        )

    user = User(email=email, password_hash=hash_password(payload.password), is_active=True)
    db.add(user)
    db.flush()

    db.add(
        Profile(
            user_id=user.id,
            display_name=payload.display_name,
            ui_language=payload.ui_language,
            content_languages=[payload.ui_language],
        )
    )
    db.add(NotificationPreferences(user_id=user.id))
    for index, name in enumerate(DEFAULT_COLLECTIONS):
        db.add(Collection(user_id=user.id, name=name, is_system=True, sort_order=index))

    return _issue_tokens(user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    user = find_user_by_email(db, payload.email)
    # Verify against a dummy hash when the user is unknown so the response time
    # does not reveal whether the address exists.
    stored = user.password_hash if user and user.password_hash else hash_password("not-a-password")
    valid = verify_password(payload.password, stored)

    if user is None or not valid or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
        )

    user.last_seen_at = datetime.now(UTC)
    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Annotated[Session, Depends(get_db)]) -> TokenResponse:
    claims = decode_token(payload.refresh_token, expected_type="refresh")
    import uuid as _uuid

    try:
        user_id = _uuid.UUID(str(claims.get("sub")))
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account unavailable")
    return _issue_tokens(user)


@router.get("/me", response_model=ProfileOut)
def me(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_user)],
) -> ProfileOut:
    profile = user.profile
    return ProfileOut(
        id=str(user.id),
        email=user.email,
        display_name=profile.display_name if profile else None,
        avatar_url=profile.avatar_url if profile else None,
        ui_language=profile.ui_language if profile else "en",
        content_languages=list(profile.content_languages) if profile else ["en"],
        timezone=profile.timezone if profile else "Asia/Kolkata",
        reader_preferences=dict(profile.reader_preferences) if profile else {},
        current_streak=profile.current_streak if profile else 0,
        longest_streak=profile.longest_streak if profile else 0,
    )


class PreferencesUpdate(ApiModel):
    ui_language: str | None = Field(default=None, max_length=10)
    content_languages: list[str] | None = None
    timezone: str | None = Field(default=None, max_length=64)
    reader_preferences: dict | None = None


@router.patch("/me", response_model=ProfileOut)
def update_me(
    payload: PreferencesUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_user)],
) -> ProfileOut:
    profile = user.profile
    if profile is None:
        profile = Profile(user_id=user.id)
        db.add(profile)
        db.flush()

    if payload.ui_language is not None:
        profile.ui_language = payload.ui_language
    if payload.content_languages is not None:
        profile.content_languages = payload.content_languages
    if payload.timezone is not None:
        profile.timezone = payload.timezone
    if payload.reader_preferences is not None:
        profile.reader_preferences = payload.reader_preferences

    db.flush()
    return me(db=db, user=user)
