"""R2 object-key conventions for audio.

Zero-padded so a plain lexicographic listing of the bucket is also the reading
order, which makes bulk uploads and spot checks straightforward:

    audio/sa/verse/02/047.mp3
    audio/sa/chapter/02.mp3
    audio/en/reflection/2026-09-04.mp3
"""

from __future__ import annotations

import re

_VERSE_KEY = re.compile(
    r"^audio/(?P<lang>[\w-]+)/verse/(?P<chapter>\d{2})/(?P<verse>\d{3})\.(?P<ext>\w+)$"
)
_CHAPTER_KEY = re.compile(r"^audio/(?P<lang>[\w-]+)/chapter/(?P<chapter>\d{2})\.(?P<ext>\w+)$")


def verse_audio_key(chapter: int, verse: int, *, language: str = "sa", ext: str = "mp3") -> str:
    return f"audio/{language}/verse/{chapter:02d}/{verse:03d}.{ext}"


def chapter_audio_key(chapter: int, *, language: str = "sa", ext: str = "mp3") -> str:
    return f"audio/{language}/chapter/{chapter:02d}.{ext}"


def reflection_audio_key(date_key: str, *, language: str = "en", ext: str = "mp3") -> str:
    return f"audio/{language}/reflection/{date_key}.{ext}"


def parse_audio_key(key: str) -> dict[str, str | int] | None:
    """Inverse of the builders above; used when reconciling a bucket listing."""
    if match := _VERSE_KEY.match(key):
        return {
            "kind": "verse",
            "language": match.group("lang"),
            "chapter": int(match.group("chapter")),
            "verse": int(match.group("verse")),
        }
    if match := _CHAPTER_KEY.match(key):
        return {
            "kind": "chapter",
            "language": match.group("lang"),
            "chapter": int(match.group("chapter")),
        }
    return None
