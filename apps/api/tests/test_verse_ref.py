"""Verse reference parsing.

These fixtures are shared with the TypeScript implementation
(packages/shared-utils). Both parsers must agree on every case here, because
they are the same feature running on two runtimes.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from gita_api.utils.verse_ref import (
    CHAPTER_VERSE_COUNTS,
    TOTAL_VERSES,
    next_verse,
    parse_verse_ref,
    previous_verse,
    verse_ordinal,
)

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "verse_refs.json").read_text(encoding="utf-8")
)


def test_the_gita_has_seven_hundred_verses():
    assert TOTAL_VERSES == 700
    assert len(CHAPTER_VERSE_COUNTS) == 18


@pytest.mark.parametrize("case", FIXTURES["valid"], ids=lambda c: c["input"])
def test_parses_valid_references(case):
    parsed = parse_verse_ref(case["input"])
    assert parsed is not None, f"{case['input']!r} should parse"
    assert parsed.chapter == case["chapter"]
    assert parsed.verse == case["verse"]


@pytest.mark.parametrize("value", FIXTURES["invalid"])
def test_rejects_non_references(value):
    # A text query must not be mistaken for a reference, or search silently
    # collapses to a single verse.
    assert parse_verse_ref(value) is None


def test_rejects_out_of_range_verses():
    # Chapter 2 has 72 verses; 2.73 does not exist.
    assert parse_verse_ref("2.73") is None
    assert parse_verse_ref("19.1") is None
    assert parse_verse_ref("0.1") is None


def test_ordinal_is_contiguous_across_the_whole_text():
    assert verse_ordinal(1, 1) == 1
    assert verse_ordinal(2, 1) == 48
    assert verse_ordinal(18, 78) == 700

    seen = set()
    for chapter, count in enumerate(CHAPTER_VERSE_COUNTS, start=1):
        for verse in range(1, count + 1):
            ordinal = verse_ordinal(chapter, verse)
            assert ordinal is not None
            assert ordinal not in seen, f"duplicate ordinal at {chapter}.{verse}"
            seen.add(ordinal)
    assert len(seen) == 700


def test_navigation_crosses_chapter_boundaries():
    assert next_verse(1, 47) == parse_verse_ref("2.1")
    assert previous_verse(2, 1) == parse_verse_ref("1.47")
    # The ends of the text have no neighbour.
    assert next_verse(18, 78) is None
    assert previous_verse(1, 1) is None


def test_walking_forwards_from_the_start_reaches_the_end():
    chapter, verse, count = 1, 1, 1
    while (nxt := next_verse(chapter, verse)) is not None:
        chapter, verse = nxt.chapter, nxt.verse
        count += 1
    assert (chapter, verse) == (18, 78)
    assert count == 700
