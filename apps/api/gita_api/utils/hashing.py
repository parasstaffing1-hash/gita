"""Canonical hashing.

Mirror of packages/shared-utils/src/canonical-hash.ts. Normalisation must match
exactly or the drift detector produces false positives:

  1. Unicode NFC
  2. collapse whitespace runs to a single space
  3. strip
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

_WS = re.compile(r"\s+")


def normalize_for_hash(text: str) -> str:
    return _WS.sub(" ", unicodedata.normalize("NFC", text)).strip()


def canonical_hash(text: str) -> str:
    """Hex SHA-256 of the normalised text."""
    return hashlib.sha256(normalize_for_hash(text).encode("utf-8")).hexdigest()


def verify_canonical_hash(text: str, expected: str) -> bool:
    return canonical_hash(text) == expected.lower()
