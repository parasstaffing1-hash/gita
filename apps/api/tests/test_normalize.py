"""Query normalisation.

The single most important property: every common spelling of a name must fold
to the same skeleton, because that skeleton is what both the index writer and
the query path use. If these drift, fuzzy search stops matching and nothing
fails loudly.
"""

from __future__ import annotations

import pytest

from gita_api.utils.normalize import (
    detect_query_language,
    detect_script,
    looks_hinglish,
    slugify,
    strip_diacritics,
    transliteration_skeleton,
)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("Kṛṣṇa", "Krsna"),
        ("ātman", "atman"),
        ("mokṣa", "moksa"),
        ("yajña", "yajna"),
        ("śraddhā", "sraddha"),
        ("Bhagavad Gītā", "Bhagavad Gita"),
    ],
)
def test_strips_diacritics(value, expected):
    assert strip_diacritics(value) == expected


KRISHNA_SPELLINGS = ["Krishna", "Kṛṣṇa", "Krsna", "Krishn", "krishna", "KRISHNA", "कृष्ण"]


def test_every_spelling_of_krishna_folds_together():
    skeletons = {transliteration_skeleton(s) for s in KRISHNA_SPELLINGS}
    assert len(skeletons) == 1, f"spellings did not agree: {skeletons}"


@pytest.mark.parametrize(
    "group",
    [
        ["karma", "karm", "कर्म"],
        ["dharma", "dharm", "धर्म"],
        ["atman", "ātman", "आत्मन्"],
        ["moksha", "moksh", "mokṣa"],
    ],
)
def test_common_term_variants_fold_together(group):
    skeletons = {transliteration_skeleton(s) for s in group}
    assert len(skeletons) == 1, f"{group} produced {skeletons}"


def test_distinct_terms_do_not_collide():
    # Folding is lossy on purpose, but it must not merge unrelated words.
    assert transliteration_skeleton("dharma") != transliteration_skeleton("karma")
    assert transliteration_skeleton("moksha") != transliteration_skeleton("maya")


@pytest.mark.parametrize(
    "value,expected",
    [
        ("कर्म", "devanagari"),
        ("karma", "latin"),
        ("karma कर्म", "mixed"),
        ("2.47", "unknown"),
    ],
)
def test_detects_script(value, expected):
    assert detect_script(value) == expected


@pytest.mark.parametrize(
    "value",
    ["failure ka dar", "gussa kaise control kare", "mann ko kaise shant kare"],
)
def test_recognises_hinglish(value):
    assert looks_hinglish(value)


@pytest.mark.parametrize(
    "value",
    ["what does the gita say about duty", "how do i deal with anger", "karma yoga"],
)
def test_plain_english_is_not_hinglish(value):
    assert not looks_hinglish(value)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("क्रोध को कैसे नियंत्रित करें", "hi"),
        ("failure ka dar", "hi-Latn"),
        ("how do I deal with failure", "en"),
    ],
)
def test_routes_answer_language(value, expected):
    assert detect_query_language(value) == expected


def test_slugify_produces_url_safe_ascii():
    assert slugify("Kṛṣṇa & Arjuna") == "krsna-arjuna"
    assert slugify("The Yoga of Action") == "the-yoga-of-action"
    assert "/" not in slugify("a/b")
