"""Verse reference parsing.

Python mirror of packages/shared-utils/src/verse-ref.ts. Both are tested
against the same fixture list (tests/fixtures/verse_refs.json) so they cannot
drift apart.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Gita Press recension: 700 verses across 18 chapters.
CHAPTER_VERSE_COUNTS: tuple[int, ...] = (
    47,
    72,
    43,
    42,
    29,
    47,
    30,
    28,
    34,
    42,
    55,
    20,
    34,
    27,
    20,
    24,
    28,
    78,
)
TOTAL_CHAPTERS = 18
TOTAL_VERSES = sum(CHAPTER_VERSE_COUNTS)

DEVANAGARI_DIGITS = "०१२३४५६७८९"
_DIGIT_MAP = {ord(ch): str(i) for i, ch in enumerate(DEVANAGARI_DIGITS)}


@dataclass(frozen=True)
class ParsedVerseRef:
    chapter: int
    verse: int | None
    verse_end: int | None = None

    def __str__(self) -> str:
        return format_verse_ref(self)


_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"^(?:bg|gita|bhagavad\s*gita|geeta|श्रीमद्भगवद्गीता|गीता)?\s*[.:]?\s*"
        r"(\d{1,2})\s*[.:\-\s]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?:chapter|ch|adhyaya|अध्याय)\s*(\d{1,2})[,\s]*"
        r"(?:verse|shloka|sloka|v|श्लोक)\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$",
        re.IGNORECASE,
    ),
    re.compile(r"^(?:chapter|ch|adhyaya|अध्याय)\s*(\d{1,2})$", re.IGNORECASE),
)


def normalize_digits(value: str) -> str:
    """Convert Devanagari digits (२.४७) to ASCII."""
    return value.translate(_DIGIT_MAP)


def is_valid_chapter(chapter: int) -> bool:
    return 1 <= chapter <= TOTAL_CHAPTERS


def is_valid_verse(chapter: int, verse: int) -> bool:
    if not is_valid_chapter(chapter):
        return False
    return 1 <= verse <= CHAPTER_VERSE_COUNTS[chapter - 1]


def parse_verse_ref(raw: str) -> ParsedVerseRef | None:
    """Parse a user string into a reference, or None when it is a text query."""
    value = re.sub(r"\s+", " ", normalize_digits(raw)).strip()
    if not value:
        return None

    for pattern in _PATTERNS:
        match = pattern.match(value)
        if not match:
            continue

        chapter = int(match.group(1))
        if not is_valid_chapter(chapter):
            return None

        groups = match.groups()
        if len(groups) < 2 or groups[1] is None:
            return ParsedVerseRef(chapter=chapter, verse=None, verse_end=None)

        verse = int(groups[1])
        if not is_valid_verse(chapter, verse):
            return None

        end = int(groups[2]) if len(groups) > 2 and groups[2] else None
        if end is not None and (end <= verse or not is_valid_verse(chapter, end)):
            end = None
        return ParsedVerseRef(chapter=chapter, verse=verse, verse_end=end)
    return None


def format_verse_ref(ref: ParsedVerseRef) -> str:
    if ref.verse is None:
        return str(ref.chapter)
    if ref.verse_end:
        return f"{ref.chapter}.{ref.verse}-{ref.verse_end}"
    return f"{ref.chapter}.{ref.verse}"


def verse_slug(chapter: int, verse: int) -> str:
    return f"{chapter}-{verse}"


def verse_ordinal(chapter: int, verse: int) -> int | None:
    """Position across the whole Gita, 1..700."""
    if not is_valid_verse(chapter, verse):
        return None
    return sum(CHAPTER_VERSE_COUNTS[: chapter - 1]) + verse


def next_verse(chapter: int, verse: int) -> ParsedVerseRef | None:
    if not is_valid_verse(chapter, verse):
        return None
    if verse < CHAPTER_VERSE_COUNTS[chapter - 1]:
        return ParsedVerseRef(chapter, verse + 1)
    if chapter < TOTAL_CHAPTERS:
        return ParsedVerseRef(chapter + 1, 1)
    return None


def previous_verse(chapter: int, verse: int) -> ParsedVerseRef | None:
    if not is_valid_verse(chapter, verse):
        return None
    if verse > 1:
        return ParsedVerseRef(chapter, verse - 1)
    if chapter > 1:
        return ParsedVerseRef(chapter - 1, CHAPTER_VERSE_COUNTS[chapter - 2])
    return None


def parse_ref_string(ref: str) -> tuple[int, int]:
    """Strict parse of a canonical "C.V" string. Raises ValueError otherwise."""
    parsed = parse_verse_ref(ref)
    if parsed is None or parsed.verse is None:
        raise ValueError(f"Not a valid verse reference: {ref!r}")
    return parsed.chapter, parsed.verse
