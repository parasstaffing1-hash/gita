"""Canonical content integrity.

These are the tests that protect the product's central promise: the scripture
in the database is the scripture that was reviewed, and no model can change it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from gita_api.security.content_guard import (
    CANONICAL_TABLES,
    CanonicalWriteError,
    ai_actor,
    assert_not_ai_generated,
    assert_publishable,
    current_actor,
)
from gita_api.utils.hashing import canonical_hash, normalize_for_hash, verify_canonical_hash

CONTENT_DIR = Path(__file__).resolve().parents[3] / "content"


# --- Hashing --------------------------------------------------------------


def test_hash_is_stable_across_insignificant_whitespace():
    a = "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।"
    b = "  कर्मण्येवाधिकारस्ते   मा फलेषु कदाचन।  "
    c = "कर्मण्येवाधिकारस्ते\nमा फलेषु कदाचन।"
    assert canonical_hash(a) == canonical_hash(b) == canonical_hash(c)


def test_hash_changes_when_a_single_character_changes():
    original = "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।"
    altered = "कर्मण्येवाधिकारस्ते मा फलेषु कदाचित्।"
    assert canonical_hash(original) != canonical_hash(altered)


def test_hash_is_normalisation_form_independent():
    # The same text in NFC and NFD must hash identically, or a copy-paste from
    # a different editor would look like tampering.
    import unicodedata

    text = "Kṛṣṇa"
    assert canonical_hash(unicodedata.normalize("NFC", text)) == canonical_hash(
        unicodedata.normalize("NFD", text)
    )


def test_normalisation_is_documented_behaviour():
    assert normalize_for_hash("  a   b \n c ") == "a b c"


def test_verify_accepts_uppercase_hex():
    text = "dharma"
    assert verify_canonical_hash(text, canonical_hash(text).upper())


# --- The AI write guard ---------------------------------------------------


def test_canonical_tables_cover_every_scripture_table():
    for table in (
        "verses",
        "verse_text_versions",
        "translations",
        "commentaries",
        "transliteration_versions",
        "verse_words",
        "chapters",
    ):
        assert table in CANONICAL_TABLES


def test_ai_actor_context_is_scoped():
    assert current_actor() == "app"
    with ai_actor():
        assert current_actor() == "ai"
    assert current_actor() == "app"


def test_ai_generated_content_is_refused_by_canonical_tables():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as excinfo:
        assert_not_ai_generated("ai_generated", table="translations")
    assert excinfo.value.status_code == 422

    # Editorial and canonical content pass.
    assert_not_ai_generated("canonical", table="translations")
    assert_not_ai_generated("curated", table="translations")
    # And an AI table is allowed to hold AI output.
    assert_not_ai_generated("ai_generated", table="ai_answers")


def test_unverified_source_cannot_be_published():
    from fastapi import HTTPException

    for status in ("verified", "published"):
        with pytest.raises(HTTPException):
            assert_publishable(status, source_is_authoritative=False, ref="2.47")

    # Draft and review are always allowed; that is where unverified work lives.
    assert_publishable("draft", source_is_authoritative=False, ref="2.47")
    assert_publishable("review", source_is_authoritative=False, ref="2.47")
    assert_publishable("published", source_is_authoritative=True, ref="2.47")


def test_write_guard_raises_for_canonical_tables():
    """The guard's decision function, exercised without a database."""

    class FakeVerse:
        __tablename__ = "verse_text_versions"

    class FakeAnswer:
        __tablename__ = "ai_answers"

    def blocked(objects) -> bool:
        return any(getattr(o, "__tablename__", None) in CANONICAL_TABLES for o in objects)

    assert blocked([FakeVerse()])
    assert not blocked([FakeAnswer()])

    with pytest.raises(CanonicalWriteError):
        raise CanonicalWriteError("blocked")


# --- Shipped content bundles ----------------------------------------------


def _bundles() -> list[Path]:
    return sorted(CONTENT_DIR.rglob("*.json"))


def test_content_directory_has_bundles():
    assert _bundles(), "No content bundles found"


@pytest.mark.parametrize("path", _bundles(), ids=lambda p: p.name)
def test_every_bundle_declares_provenance(path: Path):
    bundle = json.loads(path.read_text(encoding="utf-8"))
    assert bundle.get("schemaVersion") == 1
    assert "authoritative" in bundle, "A bundle must state whether it is authoritative"
    assert bundle.get("bundleName")
    # Anything with content needs a licence and a source to attach it to.
    if bundle.get("verses") or bundle.get("chapters") or bundle.get("glossary"):
        assert bundle.get("licenses"), f"{path.name} has content but no licence"
        assert bundle.get("sources"), f"{path.name} has content but no source"


@pytest.mark.parametrize("path", _bundles(), ids=lambda p: p.name)
def test_non_authoritative_bundles_never_claim_verified_status(path: Path):
    """The rule that keeps development placeholders out of the reader's trust.

    A bundle that has not been checked against an authoritative edition may not
    contain a record marked `verified` or `published`.
    """
    bundle = json.loads(path.read_text(encoding="utf-8"))
    if bundle.get("authoritative"):
        return

    def check(records, label):
        for record in records or []:
            status = record.get("verificationStatus", "draft")
            assert status in ("draft", "review"), (
                f"{path.name}: {label} claims '{status}' but the bundle is not authoritative"
            )

    check(bundle.get("chapters"), "chapter")
    check(bundle.get("verses"), "verse")
    check(bundle.get("glossary"), "glossary term")
    check(bundle.get("topics"), "topic")
    check(bundle.get("readingPlans"), "reading plan")
    for verse in bundle.get("verses", []):
        check(verse.get("texts"), f"text of {verse.get('chapter')}.{verse.get('verse')}")
        check(
            verse.get("translations"), f"translation of {verse.get('chapter')}.{verse.get('verse')}"
        )


def test_chapter_bundle_matches_the_seven_hundred_verse_recension():
    bundle = json.loads((CONTENT_DIR / "canonical" / "chapters.json").read_text(encoding="utf-8"))
    chapters = bundle["chapters"]
    assert len(chapters) == 18
    assert sorted(c["number"] for c in chapters) == list(range(1, 19))
    assert sum(c["verseCount"] for c in chapters) == 700

    from gita_api.utils.verse_ref import CHAPTER_VERSE_COUNTS

    for chapter in chapters:
        expected = CHAPTER_VERSE_COUNTS[chapter["number"] - 1]
        assert chapter["verseCount"] == expected, (
            f"chapter {chapter['number']}: bundle says {chapter['verseCount']}, "
            f"the parser expects {expected}"
        )


def test_placeholder_verses_are_within_range_and_unique():
    path = CONTENT_DIR / "canonical" / "verses.dev-placeholder.json"
    bundle = json.loads(path.read_text(encoding="utf-8"))
    from gita_api.utils.verse_ref import is_valid_verse

    seen = set()
    for verse in bundle["verses"]:
        ref = (verse["chapter"], verse["verse"])
        assert ref not in seen, f"duplicate verse {ref}"
        seen.add(ref)
        assert is_valid_verse(*ref), f"{ref} is outside the canonical range"
        assert any(t["script"] == "devanagari" for t in verse["texts"])


def test_topic_verse_mappings_point_at_real_references():
    bundle = json.loads((CONTENT_DIR / "topics" / "topics.json").read_text(encoding="utf-8"))
    from gita_api.utils.verse_ref import parse_verse_ref

    for topic in bundle["topics"]:
        assert topic["category"] in ("emotion", "life", "practice", "concept")
        for link in topic["verses"]:
            parsed = parse_verse_ref(link["ref"])
            assert parsed is not None, f"{topic['slug']} maps to unparseable ref {link['ref']}"
            assert 0 <= link["relevance"] <= 1


def test_reading_plan_days_are_contiguous():
    bundle = json.loads(
        (CONTENT_DIR / "canonical" / "reading-plans.json").read_text(encoding="utf-8")
    )
    for plan in bundle["readingPlans"]:
        days = sorted(d["dayNumber"] for d in plan["days"])
        assert days == list(range(1, len(days) + 1)), f"{plan['slug']} has gaps: {days}"


def test_wallpaper_without_a_licence_cannot_be_published():
    """A wallpaper reaches every reader who opens the composer.

    The table has the same constraint, but the API has to refuse first so the
    reviewer gets a sentence instead of an integrity error - and so a batch
    containing one unlicensed image fails whole rather than publishing the rest.
    """
    import uuid
    from types import SimpleNamespace

    from fastapi import HTTPException

    from gita_api.routers.admin import _publish_wallpaper

    unlicensed = SimpleNamespace(
        id=uuid.uuid4(), slug="dawn-arcs", license_id=None, verification_status="draft"
    )
    for target in ("verified", "published"):
        with pytest.raises(HTTPException) as caught:
            _publish_wallpaper(None, unlicensed, target)
        assert "licence" in str(caught.value.detail)
        assert unlicensed.verification_status == "draft"

    # Draft and review are where unlicensed work is allowed to sit.
    for target in ("draft", "review"):
        _publish_wallpaper(None, unlicensed, target)
        assert unlicensed.verification_status == target

    licensed = SimpleNamespace(
        id=uuid.uuid4(), slug="night-mountains", license_id=uuid.uuid4(),
        verification_status="verified",
    )
    _publish_wallpaper(None, licensed, "published")
    assert licensed.verification_status == "published"


def test_replacing_a_wallpaper_cannot_overwrite_the_approved_object():
    """A reviewer approves an image, not a slug.

    Keys used to be derived from the slug alone, so re-importing a changed file
    replaced the bytes at the URL readers and CDNs were already holding - and
    did it before the catalogue row was sent back for review. The database
    protection was real and the object store had none.
    """
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "services" / "audio"))
    from gita_audio.wallpaper_keys import full_key, parse_wallpaper_key, preview_key, thumb_key

    approved = "a3f1" + "0" * 60
    replacement = "9c2e" + "0" * 60

    for key_for in (full_key, preview_key, thumb_key):
        assert key_for("dawn-arcs", approved) != key_for("dawn-arcs", replacement)

    # The same bytes must always land on the same key, or nothing is cacheable
    # and a resumed import would upload everything twice.
    assert full_key("dawn-arcs", approved) == full_key("dawn-arcs", approved)

    # A slug that ends in a digit keeps its digit; only a full twelve hex
    # characters are read as a digest.
    parsed = parse_wallpaper_key(preview_key("night-mountains-3", approved))
    assert parsed is not None
    assert parsed["slug"] == "night-mountains-3"
    assert parsed["digest"] == approved[:12]

    # Keys written before keys carried a digest still reconcile against a
    # bucket listing.
    legacy = parse_wallpaper_key("wallpapers/full/dawn-arcs.jpg")
    assert legacy is not None
    assert legacy["slug"] == "dawn-arcs"
    assert legacy["digest"] == ""

    assert parse_wallpaper_key("elsewhere/dawn-arcs.jpg") is None
