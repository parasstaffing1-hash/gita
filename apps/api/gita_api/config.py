"""Application settings.

Everything the API needs comes from the environment. No secret is ever
hard-coded, and no secret is ever exposed to a client bundle: the mobile and
web apps talk only to this service, which holds the AI and R2 credentials.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", Path(".env")),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Core -------------------------------------------------------------
    environment: str = "development"
    log_level: str = "INFO"
    api_version: str = "0.1.0"

    # --- Database ---------------------------------------------------------
    database_url: str = "postgresql+psycopg://gita:gita@localhost:5433/gita"
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_echo: bool = False
    db_connect_timeout_seconds: int = 5

    # --- HTTP -------------------------------------------------------------
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_cors_origins: str = "http://localhost:3000,http://localhost:3002,http://localhost:8081"

    # --- Auth -------------------------------------------------------------
    api_secret_key: str = "dev-only-insecure-secret-change-me"
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 60
    admin_api_token: str = "dev-admin-token-change-me"

    # --- Rate limiting ----------------------------------------------------
    rate_limit_default: str = "120/minute"
    # Shared secret that identifies this deployment's own server-side renderer.
    # Empty disables the exemption entirely, which is the right default: an
    # unset secret must never mean "everyone is internal".
    internal_api_token: str = ""
    rate_limit_ai: str = "10/minute"
    rate_limit_search: str = "60/minute"

    # --- Cloudflare R2 ----------------------------------------------------
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "gita-media"
    r2_public_base_url: str = ""
    r2_signed_url_ttl_seconds: int = 3600

    # --- Local media (development only) -----------------------------------
    # Used only when R2 is unconfigured, so the quote maker and audio have real
    # files to load before credentials exist. Never mounted in production.
    local_media_dir: Path = Field(default=REPO_ROOT / "media")
    local_media_base_url: str = "http://localhost:8000/media"

    # --- AI ---------------------------------------------------------------
    ai_provider: str = "echo"
    ai_api_key: str = ""
    ai_model: str = ""
    ai_base_url: str = ""
    ai_timeout_seconds: int = 60
    ai_max_output_tokens: int = 1200

    # --- Embeddings -------------------------------------------------------
    embedding_provider: str = "sentence-transformers"
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embedding_dimensions: int = 384
    embedding_use_stub: bool = True

    # --- Speech to text ---------------------------------------------------
    stt_provider: str = "none"
    stt_api_key: str = ""

    # --- Observability ----------------------------------------------------
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.1
    posthog_key: str = ""
    posthog_host: str = "https://eu.i.posthog.com"

    # --- Content ----------------------------------------------------------
    content_dir: Path = Field(default=REPO_ROOT / "content")

    @field_validator("api_secret_key")
    @classmethod
    def _reject_default_secret_in_production(cls, value: str, info) -> str:
        env = (info.data or {}).get("environment", "development")
        if env == "production" and "change-me" in value:
            raise ValueError("API_SECRET_KEY must be set to a generated value in production.")
        return value

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def r2_configured(self) -> bool:
        return bool(self.r2_account_id and self.r2_access_key_id and self.r2_secret_access_key)

    @property
    def r2_endpoint_url(self) -> str:
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
