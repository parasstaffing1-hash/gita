"""Shared response primitives.

Field names are camelCase on the wire to match packages/gita-types, while the
Python side stays snake_case. `alias_generator` does the conversion in one
place so no endpoint has to remember.
"""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

T = TypeVar("T")


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        ser_json_timedelta="iso8601",
        # `model_provider` / `model_name` are legitimate field names here.
        protected_namespaces=(),
    )


class Paginated(ApiModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class ErrorDetail(ApiModel):
    code: str
    message: str
    details: object | None = None


class ErrorResponse(ApiModel):
    error: ErrorDetail


class ExtensionStatus(ApiModel):
    vector: bool
    pg_trgm: bool
    unaccent: bool


class AiProviderStatus(ApiModel):
    name: str
    healthy: bool


class HealthResponse(ApiModel):
    status: str
    version: str
    database: bool
    extensions: ExtensionStatus
    ai_provider: AiProviderStatus
