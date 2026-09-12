"""Content importer.

Reads a bundle file matching packages/content-schema and writes it into the
database. Rules the importer enforces, because they are the ones that protect
the canon:

  * A bundle must declare `authoritative`. When it is false, no record it
    creates may be `verified` or `published`.
  * Every text row gets a canonical hash computed here, from the same
    normalisation the API and clients use.
  * Nothing is overwritten silently: when the text of an existing record
    changes, a `content_change_log` row is written with the previous value, the
    new value, the reason and the source.
  * Import is idempotent. Re-running the same bundle is a no-op.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass
class ImportReport:
    bundle_name: str = ""
    authoritative: bool = False
    licenses: int = 0
    sources: int = 0
    commentators: int = 0
    chapters: int = 0
    verses: int = 0
    translations: int = 0
    transliterations: int = 0
    commentaries: int = 0
    words: int = 0
    glossary: int = 0
    topics: int = 0
    topic_links: int = 0
    related: int = 0
    plans: int = 0
    audio: int = 0
    changes_logged: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        counted = {
            k: v
            for k, v in self.__dict__.items()
            if isinstance(v, int) and v and k not in ("changes_logged",)
        }
        parts = ", ".join(f"{k}={v}" for k, v in sorted(counted.items()))
        return f"{self.bundle_name}: {parts or 'nothing imported'}"


class BundleError(RuntimeError):
    pass


def load_bundle(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise BundleError(f"{path} does not contain a bundle object")
    if data.get("schemaVersion") != 1:
        raise BundleError(
            f"{path} declares schemaVersion {data.get('schemaVersion')!r}; this importer "
            "understands version 1"
        )
    if "authoritative" not in data:
        raise BundleError(
            f"{path} does not declare `authoritative`. Every bundle must state whether its "
            "content has been checked against an authoritative edition."
        )
    return data


def _clamp_status(status: str, authoritative: bool) -> str:
    """Development bundles cannot mint verified content."""
    if not authoritative and status in ("verified", "published"):
        return "draft"
    return status


class ContentImporter:
    def __init__(self, db: Session, *, editor_email: str = "importer@local", reason: str = ""):
        self.db = db
        self.editor_email = editor_email
        self.reason = reason or "Content import"
        self.report = ImportReport()
        self._license_ids: dict[str, str] = {}
        self._source_ids: dict[str, str] = {}
        self._commentator_ids: dict[str, str] = {}
        self._chapter_ids: dict[int, str] = {}
        self._verse_ids: dict[str, str] = {}

    # --- helpers ----------------------------------------------------------

    def _hash(self, value: str) -> str:
        from gita_api.utils.hashing import canonical_hash

        return canonical_hash(value)

    def _fold(self, value: str) -> str:
        from gita_api.utils.normalize import transliteration_skeleton

        return transliteration_skeleton(value)

    def _log_change(
        self,
        table: str,
        record_id: str,
        ref: str | None,
        action: str,
        field_name: str | None,
        previous: Any,
        new: Any,
        source_id: str | None,
    ) -> None:
        self.db.execute(
            text(
                """
                INSERT INTO content_change_log
                    (id, table_name, record_id, record_ref, action, field_name,
                     previous_value, new_value, editor_email, reason, source_id,
                     review_status, created_at, updated_at)
                VALUES
                    (gen_random_uuid(), :table, CAST(:record_id AS uuid), :ref, :action,
                     :field, CAST(:previous AS jsonb), CAST(:new AS jsonb), :editor,
                     :reason, CAST(:source_id AS uuid), 'pending', now(), now())
                """
            ),
            {
                "table": table,
                "record_id": record_id,
                "ref": ref,
                "action": action,
                "field": field_name,
                "previous": json.dumps(previous) if previous is not None else None,
                "new": json.dumps(new) if new is not None else None,
                "editor": self.editor_email,
                "reason": self.reason,
                "source_id": source_id,
            },
        )
        self.report.changes_logged += 1

    # --- import steps -----------------------------------------------------

    def run(self, bundle: dict[str, Any]) -> ImportReport:
        self.report.bundle_name = bundle.get("bundleName", "unnamed")
        self.report.authoritative = bool(bundle.get("authoritative"))

        self._import_licenses(bundle.get("licenses", []))
        self._import_sources(bundle.get("sources", []))
        self._import_commentators(bundle.get("commentators", []))
        self._import_chapters(bundle.get("chapters", []))
        self._import_verses(bundle.get("verses", []))
        self._import_glossary(bundle.get("glossary", []))
        self._import_topics(bundle.get("topics", []))
        self._import_related(bundle.get("relatedVerses", []))
        self._import_plans(bundle.get("readingPlans", []))
        self._import_audio(bundle.get("audio", []))
        return self.report

    def _import_licenses(self, rows: list[dict]) -> None:
        for row in rows:
            record_id = self.db.execute(
                text(
                    """
                    INSERT INTO content_licenses
                        (id, code, name, url, redistributable, requires_attribution,
                         commercial_use_allowed, notes, created_at, updated_at)
                    VALUES (gen_random_uuid(), :code, :name, :url, :redistributable,
                            :requires_attribution, :commercial, :notes, now(), now())
                    ON CONFLICT (code) DO UPDATE SET
                        name = EXCLUDED.name,
                        url = EXCLUDED.url,
                        redistributable = EXCLUDED.redistributable,
                        requires_attribution = EXCLUDED.requires_attribution,
                        commercial_use_allowed = EXCLUDED.commercial_use_allowed,
                        notes = EXCLUDED.notes,
                        updated_at = now()
                    RETURNING id::text
                    """
                ),
                {
                    "code": row["code"],
                    "name": row["name"],
                    "url": row.get("url"),
                    "redistributable": bool(row.get("redistributable")),
                    "requires_attribution": bool(row.get("requiresAttribution", True)),
                    "commercial": bool(row.get("commercialUseAllowed", False)),
                    "notes": row.get("notes"),
                },
            ).scalar_one()
            self._license_ids[row["code"]] = record_id
            self.report.licenses += 1

    def _import_sources(self, rows: list[dict]) -> None:
        for row in rows:
            license_id = self._license_ids.get(row.get("licenseCode", ""))
            if row.get("licenseCode") and license_id is None:
                self.report.errors.append(
                    f"source '{row['key']}' references unknown license '{row['licenseCode']}'"
                )
                continue
            record_id = self.db.execute(
                text(
                    """
                    INSERT INTO content_sources
                        (id, key, name, source_url, author, publication, publication_year,
                         license_id, copyright_status, date_accessed, reviewer,
                         verification_notes, is_authoritative, created_at, updated_at)
                    VALUES (gen_random_uuid(), :key, :name, :url, :author, :publication,
                            :year, CAST(:license_id AS uuid), :copyright,
                            CAST(:accessed AS date), :reviewer, :notes, :authoritative,
                            now(), now())
                    ON CONFLICT (key) DO UPDATE SET
                        name = EXCLUDED.name,
                        source_url = EXCLUDED.source_url,
                        author = EXCLUDED.author,
                        publication = EXCLUDED.publication,
                        publication_year = EXCLUDED.publication_year,
                        license_id = EXCLUDED.license_id,
                        copyright_status = EXCLUDED.copyright_status,
                        date_accessed = EXCLUDED.date_accessed,
                        reviewer = EXCLUDED.reviewer,
                        verification_notes = EXCLUDED.verification_notes,
                        is_authoritative = EXCLUDED.is_authoritative,
                        updated_at = now()
                    RETURNING id::text
                    """
                ),
                {
                    "key": row["key"],
                    "name": row["name"],
                    "url": row.get("sourceUrl"),
                    "author": row.get("author"),
                    "publication": row.get("publication"),
                    "year": row.get("publicationYear"),
                    "license_id": license_id,
                    "copyright": row.get("copyrightStatus", "unknown"),
                    "accessed": row.get("dateAccessed"),
                    "reviewer": row.get("reviewer"),
                    "notes": row.get("verificationNotes"),
                    "authoritative": self.report.authoritative,
                },
            ).scalar_one()
            self._source_ids[row["key"]] = record_id
            self.report.sources += 1

    def _import_commentators(self, rows: list[dict]) -> None:
        for row in rows:
            record_id = self.db.execute(
                text(
                    """
                    INSERT INTO commentators
                        (id, slug, name, name_sanskrit, tradition, period, bio,
                         sort_order, created_at, updated_at)
                    VALUES (gen_random_uuid(), :slug, :name, :name_sanskrit, :tradition,
                            :period, :bio, 100, now(), now())
                    ON CONFLICT (slug) DO UPDATE SET
                        name = EXCLUDED.name,
                        name_sanskrit = EXCLUDED.name_sanskrit,
                        tradition = EXCLUDED.tradition,
                        period = EXCLUDED.period,
                        bio = EXCLUDED.bio,
                        updated_at = now()
                    RETURNING id::text
                    """
                ),
                {
                    "slug": row["slug"],
                    "name": row["name"],
                    "name_sanskrit": row.get("nameSanskrit"),
                    "tradition": row.get("tradition"),
                    "period": row.get("period"),
                    "bio": row.get("bio"),
                },
            ).scalar_one()
            self._commentator_ids[row["slug"]] = record_id
            self.report.commentators += 1

    def _import_chapters(self, rows: list[dict]) -> None:
        from gita_api.utils.normalize import slugify

        for row in rows:
            source_id = self._source_ids.get(row.get("sourceKey", ""))
            status = _clamp_status(
                row.get("verificationStatus", "draft"), self.report.authoritative
            )
            slug = f"{row['number']}-{slugify(row['nameEnglish'])}"
            record_id = self.db.execute(
                text(
                    """
                    INSERT INTO chapters
                        (id, number, slug, name_sanskrit, name_transliteration, name_english,
                         name_hindi, verse_count, summary, summary_hindi, major_teachings,
                         key_concepts, key_verse_refs, source_id, verification_status,
                         created_at, updated_at)
                    VALUES (gen_random_uuid(), :number, :slug, :name_sanskrit, :name_translit,
                            :name_english, :name_hindi, :verse_count, :summary, :summary_hindi,
                            CAST(:teachings AS text[]), CAST(:concepts AS text[]),
                            CAST(:key_verses AS varchar[]), CAST(:source_id AS uuid), :status,
                            now(), now())
                    ON CONFLICT (number) DO UPDATE SET
                        slug = EXCLUDED.slug,
                        name_sanskrit = EXCLUDED.name_sanskrit,
                        name_transliteration = EXCLUDED.name_transliteration,
                        name_english = EXCLUDED.name_english,
                        name_hindi = EXCLUDED.name_hindi,
                        verse_count = EXCLUDED.verse_count,
                        summary = EXCLUDED.summary,
                        summary_hindi = EXCLUDED.summary_hindi,
                        major_teachings = EXCLUDED.major_teachings,
                        key_concepts = EXCLUDED.key_concepts,
                        key_verse_refs = EXCLUDED.key_verse_refs,
                        source_id = EXCLUDED.source_id,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = now()
                    RETURNING id::text
                    """
                ),
                {
                    "number": row["number"],
                    "slug": slug,
                    "name_sanskrit": row.get("nameSanskrit"),
                    "name_translit": row.get("nameTransliteration"),
                    "name_english": row["nameEnglish"],
                    "name_hindi": row.get("nameHindi"),
                    "verse_count": row["verseCount"],
                    "summary": row.get("summary"),
                    "summary_hindi": row.get("summaryHindi"),
                    "teachings": row.get("majorTeachings", []),
                    "concepts": row.get("keyConcepts", []),
                    "key_verses": row.get("keyVerses", []),
                    "source_id": source_id,
                    "status": status,
                },
            ).scalar_one()
            self._chapter_ids[row["number"]] = record_id
            self.report.chapters += 1

    def _import_verses(self, rows: list[dict]) -> None:
        from gita_api.utils.verse_ref import verse_ordinal, verse_slug

        for row in rows:
            chapter_number = row["chapter"]
            number = row["verse"]
            ref = f"{chapter_number}.{number}"
            chapter_id = self._chapter_ids.get(chapter_number) or self._lookup_chapter(
                chapter_number
            )
            if chapter_id is None:
                self.report.errors.append(
                    f"verse {ref}: chapter {chapter_number} is not in the database"
                )
                continue

            ordinal = verse_ordinal(chapter_number, number)
            if ordinal is None:
                self.report.errors.append(
                    f"verse {ref} is outside the known verse range for chapter {chapter_number}"
                )
                continue

            status = _clamp_status(
                row.get("verificationStatus", "draft"), self.report.authoritative
            )
            verse_id = self.db.execute(
                text(
                    """
                    INSERT INTO verses
                        (id, chapter_id, chapter_number, number, number_end, slug, ordinal,
                         speaker, verification_status, created_at, updated_at)
                    VALUES (gen_random_uuid(), CAST(:chapter_id AS uuid), :chapter_number,
                            :number, :number_end, :slug, :ordinal, :speaker, :status,
                            now(), now())
                    ON CONFLICT (chapter_number, number) DO UPDATE SET
                        number_end = EXCLUDED.number_end,
                        slug = EXCLUDED.slug,
                        ordinal = EXCLUDED.ordinal,
                        speaker = EXCLUDED.speaker,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = now()
                    RETURNING id::text
                    """
                ),
                {
                    "chapter_id": chapter_id,
                    "chapter_number": chapter_number,
                    "number": number,
                    "number_end": row.get("verseEnd"),
                    "slug": verse_slug(chapter_number, number),
                    "ordinal": ordinal,
                    "speaker": row.get("speaker"),
                    "status": status,
                },
            ).scalar_one()
            self._verse_ids[ref] = verse_id
            self.report.verses += 1

            self._import_verse_texts(verse_id, ref, row.get("texts", []))
            self._import_translations(verse_id, ref, row.get("translations", []))
            self._import_commentaries(verse_id, ref, row.get("commentaries", []))
            self._import_words(verse_id, row.get("words", []))

    def _lookup_chapter(self, number: int) -> str | None:
        found = self.db.execute(
            text("SELECT id::text FROM chapters WHERE number = :n"), {"n": number}
        ).scalar_one_or_none()
        if found:
            self._chapter_ids[number] = found
        return found

    def _import_verse_texts(self, verse_id: str, ref: str, rows: list[dict]) -> None:
        """Route each text row to the right table.

        Devanagari is scripture and lives in `verse_text_versions`.
        IAST/ITRANS/HK are transliterations and live in
        `transliteration_versions` - they are verified content in their own
        right, never machine-generated from the Devanagari.
        """
        for row in rows:
            if row["script"] == "devanagari":
                self._upsert_verse_text(verse_id, ref, row)
            else:
                self._upsert_transliteration(verse_id, ref, row)

    def _upsert_verse_text(self, verse_id: str, ref: str, row: dict) -> None:
        source_id = self._source_ids.get(row.get("sourceKey", ""))
        digest = self._hash(row["text"])
        status = _clamp_status(row.get("verificationStatus", "draft"), self.report.authoritative)

        existing = (
            self.db.execute(
                text(
                    """
                    SELECT id::text AS id, text, canonical_hash
                    FROM verse_text_versions
                    WHERE verse_id = CAST(:verse_id AS uuid)
                      AND script = :script
                      AND source_id IS NOT DISTINCT FROM CAST(:source_id AS uuid)
                      AND version = 1
                    """
                ),
                {"verse_id": verse_id, "script": row["script"], "source_id": source_id},
            )
            .mappings()
            .one_or_none()
        )

        if existing and existing["canonical_hash"] == digest:
            return  # unchanged; import stays idempotent

        if existing:
            record_id = existing["id"]
            self.db.execute(
                text(
                    """
                    UPDATE verse_text_versions
                    SET text = :text, canonical_hash = :hash, is_primary = :primary,
                        verification_status = :status, updated_at = now()
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {
                    "text": row["text"],
                    "hash": digest,
                    "primary": bool(row.get("isPrimary")),
                    "status": status,
                    "id": record_id,
                },
            )
            # A change to canonical scripture is always auditable.
            self._log_change(
                "verse_text_versions",
                record_id,
                ref,
                "update",
                "text",
                {"text": existing["text"], "canonical_hash": existing["canonical_hash"]},
                {"text": row["text"], "canonical_hash": digest},
                source_id,
            )
        else:
            record_id = self.db.execute(
                text(
                    """
                    INSERT INTO verse_text_versions
                        (id, verse_id, script, text, canonical_hash, source_id, version,
                         is_primary, verification_status, created_at, updated_at)
                    VALUES (gen_random_uuid(), CAST(:verse_id AS uuid), :script, :text,
                            :hash, CAST(:source_id AS uuid), 1, :primary, :status,
                            now(), now())
                    RETURNING id::text
                    """
                ),
                {
                    "verse_id": verse_id,
                    "script": row["script"],
                    "text": row["text"],
                    "hash": digest,
                    "source_id": source_id,
                    "primary": bool(row.get("isPrimary")),
                    "status": status,
                },
            ).scalar_one()
            self._log_change(
                "verse_text_versions",
                record_id,
                ref,
                "create",
                "text",
                None,
                {"text": row["text"], "canonical_hash": digest},
                source_id,
            )

    def _upsert_transliteration(self, verse_id: str, ref: str, row: dict) -> None:
        source_id = self._source_ids.get(row.get("sourceKey", ""))
        digest = self._hash(row["text"])
        status = _clamp_status(row.get("verificationStatus", "draft"), self.report.authoritative)

        existing = self.db.execute(
            text(
                """
                SELECT id::text FROM transliteration_versions
                WHERE verse_id = CAST(:verse_id AS uuid)
                  AND scheme = :scheme
                  AND source_id IS NOT DISTINCT FROM CAST(:source_id AS uuid)
                  AND version = 1
                """
            ),
            {"verse_id": verse_id, "scheme": row["script"], "source_id": source_id},
        ).scalar_one_or_none()

        if existing:
            self.db.execute(
                text(
                    """
                    UPDATE transliteration_versions
                    SET text = :text, canonical_hash = :hash, verification_status = :status,
                        updated_at = now()
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {"text": row["text"], "hash": digest, "status": status, "id": existing},
            )
        else:
            self.db.execute(
                text(
                    """
                    INSERT INTO transliteration_versions
                        (id, verse_id, scheme, text, canonical_hash, source_id, version,
                         verification_status, created_at, updated_at)
                    VALUES (gen_random_uuid(), CAST(:verse_id AS uuid), :scheme, :text,
                            :hash, CAST(:source_id AS uuid), 1, :status, now(), now())
                    """
                ),
                {
                    "verse_id": verse_id,
                    "scheme": row["script"],
                    "text": row["text"],
                    "hash": digest,
                    "source_id": source_id,
                    "status": status,
                },
            )
        self.report.transliterations += 1

    def _import_translations(self, verse_id: str, ref: str, rows: list[dict]) -> None:
        for row in rows:
            source_id = self._source_ids.get(row.get("sourceKey", ""))
            if source_id is None:
                # ON CONFLICT cannot dedupe on a NULL source_id, and unsourced
                # canonical text is not allowed in the first place.
                self.report.errors.append(
                    f"{ref}: translation references unknown source {row.get('sourceKey')!r}"
                )
                continue
            digest = self._hash(row["text"])
            status = _clamp_status(
                row.get("verificationStatus", "draft"), self.report.authoritative
            )
            origin = row.get("origin", "canonical")
            if origin == "ai_generated":
                self.report.errors.append(
                    f"{ref}: refusing to import an AI-generated translation as canonical content"
                )
                continue
            self.db.execute(
                text(
                    """
                    INSERT INTO translations
                        (id, verse_id, language_code, text, canonical_hash, translator_name,
                         style, source_id, version, origin, verification_status,
                         created_at, updated_at)
                    VALUES (gen_random_uuid(), CAST(:verse_id AS uuid), :language, :text,
                            :hash, :translator, :style, CAST(:source_id AS uuid), 1,
                            :origin, :status, now(), now())
                    ON CONFLICT (verse_id, language_code, source_id, version) DO UPDATE SET
                        text = EXCLUDED.text,
                        canonical_hash = EXCLUDED.canonical_hash,
                        translator_name = EXCLUDED.translator_name,
                        style = EXCLUDED.style,
                        origin = EXCLUDED.origin,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = now()
                    """
                ),
                {
                    "verse_id": verse_id,
                    "language": row["languageCode"],
                    "text": row["text"],
                    "hash": digest,
                    "translator": row.get("translatorName"),
                    "style": row.get("style"),
                    "source_id": source_id,
                    "origin": origin,
                    "status": status,
                },
            )
            self.report.translations += 1

    def _import_commentaries(self, verse_id: str, ref: str, rows: list[dict]) -> None:
        for row in rows:
            commentator_id = self._commentator_ids.get(row.get("commentatorSlug", ""))
            if commentator_id is None:
                commentator_id = self.db.execute(
                    text("SELECT id::text FROM commentators WHERE slug = :s"),
                    {"s": row.get("commentatorSlug")},
                ).scalar_one_or_none()
            source_id = self._source_ids.get(row.get("sourceKey", ""))
            status = _clamp_status(
                row.get("verificationStatus", "draft"), self.report.authoritative
            )
            origin = row.get("origin", "canonical")
            if origin == "ai_generated":
                self.report.errors.append(
                    f"{ref}: refusing to import AI-generated commentary as canonical content"
                )
                continue
            self.db.execute(
                text(
                    """
                    INSERT INTO commentaries
                        (id, verse_id, commentator_id, language_code, text, canonical_hash,
                         source_id, version, origin, verification_status, approved_for_ai,
                         created_at, updated_at)
                    VALUES (gen_random_uuid(), CAST(:verse_id AS uuid),
                            CAST(:commentator_id AS uuid), :language, :text, :hash,
                            CAST(:source_id AS uuid), 1, :origin, :status, :approved,
                            now(), now())
                    ON CONFLICT (verse_id, commentator_id, language_code, version)
                    DO UPDATE SET
                        text = EXCLUDED.text,
                        canonical_hash = EXCLUDED.canonical_hash,
                        origin = EXCLUDED.origin,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = now()
                    """
                ),
                {
                    "verse_id": verse_id,
                    "commentator_id": commentator_id,
                    "language": row["languageCode"],
                    "text": row["text"],
                    "hash": self._hash(row["text"]),
                    "source_id": source_id,
                    "origin": origin,
                    "status": status,
                    # Only verified commentary is eligible for AI retrieval.
                    "approved": status in ("verified", "published"),
                },
            )
            self.report.commentaries += 1

    def _import_words(self, verse_id: str, rows: list[dict]) -> None:
        for row in rows:
            self.db.execute(
                text(
                    """
                    INSERT INTO verse_words
                        (id, verse_id, position, word_devanagari, word_transliteration,
                         meaning_english, meaning_hindi, grammar_note, verification_status,
                         created_at, updated_at)
                    VALUES (gen_random_uuid(), CAST(:verse_id AS uuid), :position, :deva,
                            :translit, :en, :hi, :grammar, 'draft', now(), now())
                    ON CONFLICT (verse_id, position) DO UPDATE SET
                        word_devanagari = EXCLUDED.word_devanagari,
                        word_transliteration = EXCLUDED.word_transliteration,
                        meaning_english = EXCLUDED.meaning_english,
                        meaning_hindi = EXCLUDED.meaning_hindi,
                        grammar_note = EXCLUDED.grammar_note,
                        updated_at = now()
                    """
                ),
                {
                    "verse_id": verse_id,
                    "position": row["position"],
                    "deva": row["wordDevanagari"],
                    "translit": row.get("wordTransliteration"),
                    "en": row.get("meaningEnglish"),
                    "hi": row.get("meaningHindi"),
                    "grammar": row.get("grammarNote"),
                },
            )
            self.report.words += 1

    def _import_glossary(self, rows: list[dict]) -> None:
        for row in rows:
            status = _clamp_status(
                row.get("verificationStatus", "draft"), self.report.authoritative
            )
            self.db.execute(
                text(
                    """
                    INSERT INTO glossary_terms
                        (id, slug, term_sanskrit, term_transliteration, term_english,
                         search_key, simple_definition, detailed_definition, variants,
                         synonyms, related_term_slugs, related_verse_refs, source_ids,
                         verification_status, created_at, updated_at)
                    VALUES (gen_random_uuid(), :slug, :sanskrit, :translit, :english,
                            :search_key, :simple, :detailed, CAST(:variants AS text[]),
                            CAST(:synonyms AS text[]), CAST(:related_terms AS text[]),
                            CAST(:related_verses AS varchar[]), '{}', :status, now(), now())
                    ON CONFLICT (slug) DO UPDATE SET
                        term_sanskrit = EXCLUDED.term_sanskrit,
                        term_transliteration = EXCLUDED.term_transliteration,
                        term_english = EXCLUDED.term_english,
                        search_key = EXCLUDED.search_key,
                        simple_definition = EXCLUDED.simple_definition,
                        detailed_definition = EXCLUDED.detailed_definition,
                        variants = EXCLUDED.variants,
                        synonyms = EXCLUDED.synonyms,
                        related_term_slugs = EXCLUDED.related_term_slugs,
                        related_verse_refs = EXCLUDED.related_verse_refs,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = now()
                    """
                ),
                {
                    "slug": row["slug"],
                    "sanskrit": row["termSanskrit"],
                    "translit": row["termTransliteration"],
                    "english": row.get("termEnglish"),
                    "search_key": self._fold(
                        " ".join(
                            [
                                row["termSanskrit"],
                                row["termTransliteration"],
                                *row.get("variants", []),
                            ]
                        )
                    ),
                    "simple": row["simpleDefinition"],
                    "detailed": row.get("detailedDefinition"),
                    "variants": row.get("variants", []),
                    "synonyms": row.get("synonyms", []),
                    "related_terms": row.get("relatedTermSlugs", []),
                    "related_verses": row.get("relatedVerses", []),
                    "status": status,
                },
            )
            self.report.glossary += 1

    def _import_topics(self, rows: list[dict]) -> None:
        for row in rows:
            source_id = self._source_ids.get(row.get("sourceKey", ""))
            status = _clamp_status(
                row.get("verificationStatus", "draft"), self.report.authoritative
            )
            topic_id = self.db.execute(
                text(
                    """
                    INSERT INTO topics
                        (id, slug, name, name_hindi, category, icon, short_description,
                         introduction, introduction_hindi, related_concepts,
                         related_topic_slugs, sort_order, source_id, verification_status,
                         created_at, updated_at)
                    VALUES (gen_random_uuid(), :slug, :name, :name_hindi, :category, :icon,
                            :short, :intro, :intro_hi, CAST(:concepts AS text[]),
                            CAST(:related AS text[]), :sort, CAST(:source_id AS uuid),
                            :status, now(), now())
                    ON CONFLICT (slug) DO UPDATE SET
                        name = EXCLUDED.name,
                        name_hindi = EXCLUDED.name_hindi,
                        category = EXCLUDED.category,
                        icon = EXCLUDED.icon,
                        short_description = EXCLUDED.short_description,
                        introduction = EXCLUDED.introduction,
                        introduction_hindi = EXCLUDED.introduction_hindi,
                        related_concepts = EXCLUDED.related_concepts,
                        related_topic_slugs = EXCLUDED.related_topic_slugs,
                        source_id = EXCLUDED.source_id,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = now()
                    RETURNING id::text
                    """
                ),
                {
                    "slug": row["slug"],
                    "name": row["name"],
                    "name_hindi": row.get("nameHindi"),
                    "category": row["category"],
                    "icon": row.get("icon"),
                    "short": row.get("shortDescription"),
                    "intro": row.get("introduction"),
                    "intro_hi": row.get("introductionHindi"),
                    "concepts": row.get("relatedConcepts", []),
                    "related": row.get("relatedTopicSlugs", []),
                    "sort": row.get("sortOrder", 100),
                    "source_id": source_id,
                    "status": status,
                },
            ).scalar_one()
            self.report.topics += 1

            for link in row.get("verses", []):
                verse_id = self._resolve_verse(link["ref"])
                if verse_id is None:
                    self.report.warnings.append(
                        f"topic '{row['slug']}' maps to {link['ref']}, which is not in the database"
                    )
                    continue
                self.db.execute(
                    text(
                        """
                        INSERT INTO verse_topics
                            (id, verse_id, topic_id, relevance, note, curated_by,
                             created_at, updated_at)
                        VALUES (gen_random_uuid(), CAST(:verse_id AS uuid),
                                CAST(:topic_id AS uuid), :relevance, :note, :curator,
                                now(), now())
                        ON CONFLICT (verse_id, topic_id) DO UPDATE SET
                            relevance = EXCLUDED.relevance,
                            note = EXCLUDED.note,
                            updated_at = now()
                        """
                    ),
                    {
                        "verse_id": verse_id,
                        "topic_id": topic_id,
                        "relevance": link.get("relevance", 0.8),
                        "note": link.get("note"),
                        "curator": self.editor_email,
                    },
                )
                self.report.topic_links += 1

    def _import_related(self, rows: list[dict]) -> None:
        for row in rows:
            from_id = self._resolve_verse(row["fromRef"])
            to_id = self._resolve_verse(row["toRef"])
            if from_id is None or to_id is None:
                self.report.warnings.append(
                    f"related verses {row['fromRef']} -> {row['toRef']}: one side is missing"
                )
                continue
            pairs = [(from_id, to_id)]
            if row.get("bidirectional", True):
                pairs.append((to_id, from_id))
            for a, b in pairs:
                self.db.execute(
                    text(
                        """
                        INSERT INTO related_verses
                            (id, from_verse_id, to_verse_id, relation_type, note, weight,
                             created_at, updated_at)
                        VALUES (gen_random_uuid(), CAST(:a AS uuid), CAST(:b AS uuid),
                                :relation, :note, 1.0, now(), now())
                        ON CONFLICT (from_verse_id, to_verse_id, relation_type)
                        DO UPDATE SET note = EXCLUDED.note, updated_at = now()
                        """
                    ),
                    {"a": a, "b": b, "relation": row["relationType"], "note": row.get("note")},
                )
                self.report.related += 1

    def _import_plans(self, rows: list[dict]) -> None:
        for row in rows:
            status = _clamp_status(
                row.get("verificationStatus", "draft"), self.report.authoritative
            )
            plan_id = self.db.execute(
                text(
                    """
                    INSERT INTO reading_plans
                        (id, slug, title, title_hindi, subtitle, description, duration_days,
                         level, cover_image_url, tags, sort_order, verification_status,
                         created_at, updated_at)
                    VALUES (gen_random_uuid(), :slug, :title, :title_hi, :subtitle, :description,
                            :duration, :level, :cover, CAST(:tags AS text[]), 100, :status,
                            now(), now())
                    ON CONFLICT (slug) DO UPDATE SET
                        title = EXCLUDED.title,
                        title_hindi = EXCLUDED.title_hindi,
                        subtitle = EXCLUDED.subtitle,
                        description = EXCLUDED.description,
                        duration_days = EXCLUDED.duration_days,
                        level = EXCLUDED.level,
                        tags = EXCLUDED.tags,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = now()
                    RETURNING id::text
                    """
                ),
                {
                    "slug": row["slug"],
                    "title": row["title"],
                    "title_hi": row.get("titleHindi"),
                    "subtitle": row.get("subtitle"),
                    "description": row.get("description"),
                    "duration": len(row.get("days", [])),
                    "level": row.get("level", "beginner"),
                    "cover": row.get("coverImageUrl"),
                    "tags": row.get("tags", []),
                    "status": status,
                },
            ).scalar_one()
            self.report.plans += 1

            for day in row.get("days", []):
                self.db.execute(
                    text(
                        """
                        INSERT INTO reading_plan_days
                            (id, plan_id, day_number, title, intro, verse_refs, reflection,
                             estimated_minutes, created_at, updated_at)
                        VALUES (gen_random_uuid(), CAST(:plan_id AS uuid), :day, :title,
                                :intro, CAST(:refs AS varchar[]), :reflection, :minutes,
                                now(), now())
                        ON CONFLICT (plan_id, day_number) DO UPDATE SET
                            title = EXCLUDED.title,
                            intro = EXCLUDED.intro,
                            verse_refs = EXCLUDED.verse_refs,
                            reflection = EXCLUDED.reflection,
                            estimated_minutes = EXCLUDED.estimated_minutes,
                            updated_at = now()
                        """
                    ),
                    {
                        "plan_id": plan_id,
                        "day": day["dayNumber"],
                        "title": day["title"],
                        "intro": day.get("intro"),
                        "refs": day.get("verseRefs", []),
                        "reflection": day.get("reflection"),
                        "minutes": day.get("estimatedMinutes", 10),
                    },
                )

    def _import_audio(self, rows: list[dict]) -> None:
        for row in rows:
            license_id = self._license_ids.get(row.get("licenseCode", ""))
            verse_id = (
                self._resolve_verse(f"{row['chapter']}.{row['verse']}")
                if row.get("chapter") and row.get("verse")
                else None
            )
            chapter_id = (
                self._chapter_ids.get(row["chapter"]) or self._lookup_chapter(row["chapter"])
                if row.get("chapter")
                else None
            )
            status = _clamp_status(
                row.get("verificationStatus", "draft"), self.report.authoritative
            )
            self.db.execute(
                text(
                    """
                    INSERT INTO audio_tracks
                        (id, kind, verse_id, chapter_id, chapter_number, verse_number,
                         language_code, reciter, is_synthetic, object_key, mime_type,
                         duration_seconds, size_bytes, license_id, verification_status,
                         created_at, updated_at)
                    VALUES (gen_random_uuid(), :kind, CAST(:verse_id AS uuid),
                            CAST(:chapter_id AS uuid), :chapter_number, :verse_number,
                            :language, :reciter, :synthetic, :object_key, :mime,
                            :duration, :size, CAST(:license_id AS uuid), :status,
                            now(), now())
                    ON CONFLICT (object_key) DO UPDATE SET
                        reciter = EXCLUDED.reciter,
                        is_synthetic = EXCLUDED.is_synthetic,
                        duration_seconds = EXCLUDED.duration_seconds,
                        size_bytes = EXCLUDED.size_bytes,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = now()
                    """
                ),
                {
                    "kind": row["kind"],
                    "verse_id": verse_id,
                    "chapter_id": chapter_id,
                    "chapter_number": row.get("chapter"),
                    "verse_number": row.get("verse"),
                    "language": row.get("languageCode", "sa"),
                    "reciter": row.get("reciter"),
                    "synthetic": bool(row["isSynthetic"]),
                    "object_key": row["objectKey"],
                    "mime": row.get("mimeType", "audio/mpeg"),
                    "duration": row.get("durationSeconds"),
                    "size": row.get("sizeBytes"),
                    "license_id": license_id,
                    "status": status,
                },
            )
            self.report.audio += 1

    def _resolve_verse(self, ref: str) -> str | None:
        if ref in self._verse_ids:
            return self._verse_ids[ref]
        try:
            chapter_str, verse_str = ref.split(".", 1)
            chapter, verse = int(chapter_str), int(verse_str)
        except ValueError:
            return None
        found = self.db.execute(
            text("SELECT id::text FROM verses WHERE chapter_number = :c AND number = :v"),
            {"c": chapter, "v": verse},
        ).scalar_one_or_none()
        if found:
            self._verse_ids[ref] = found
        return found
