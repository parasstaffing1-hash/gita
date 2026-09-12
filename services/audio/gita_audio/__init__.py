"""Audio catalogue helpers.

Object-key conventions live here so the importer, the API and the download
manager all agree on where a file is without passing paths around.
"""

from gita_audio.keys import (
    chapter_audio_key,
    parse_audio_key,
    reflection_audio_key,
    verse_audio_key,
)

__all__ = [
    "chapter_audio_key",
    "parse_audio_key",
    "reflection_audio_key",
    "verse_audio_key",
]
