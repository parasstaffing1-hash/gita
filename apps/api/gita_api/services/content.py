"""Read-side queries for canonical content.

Kept separate from the routers so the same query logic serves the public API,
the offline-bundle builder and the search indexer without duplication.

Visibility rule: public endpoints only ever return `published` content. In
development the fixture data is `draft`, so `include_unpublished` exists and is
gated on the environment — never on a request parameter a client can set.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from gita_api.config import settings
from gita_api.db.models import (
    AudioTrack,
    Chapter,
    Commentary,
    GlossaryTerm,
    RelatedVerse,
    Topic,
    Translation,
    TransliterationVersion,
    Verse,
    VerseTextVersion,
    VerseTopic,
)
from gita_api.schemas.content import (
    AudioTrackOut,
    ChapterOut,
    CommentaryOut,
    CommentatorOut,
    ContentLicenseOut,
    ContentSourceOut,
    GlossaryTermOut,
    RelatedVerseOut,
    TopicOut,
    TopicSummaryOut,
    TopicVerseOut,
    TranslationOut,
    TransliterationOut,
    VerseOut,
    VerseRefOut,
    VerseSummaryOut,
    VerseTextVersionOut,
    VerseWordOut,
)
from gita_api.utils.verse_ref import parse_verse_ref

# Statuses a reader is allowed to see.
PUBLIC_STATUSES = ("published",)
# Outside production the seeded development content is still `draft`, so the
# reader would otherwise see an empty app.
DEV_STATUSES = ("published", "verified", "review", "draft")


def visible_statuses() -> tuple[str, ...]:
    return PUBLIC_STATUSES if settings.is_production else DEV_STATUSES


def _status_filter(column) -> object:
    return column.in_(visible_statuses())


# --- Chapters -------------------------------------------------------------


def list_chapters(db: Session) -> list[ChapterOut]:
    stmt = (
        select(Chapter).where(_status_filter(Chapter.verification_status)).order_by(Chapter.number)
    )
    chapters = db.execute(stmt).scalars().all()
    audio_by_chapter = _chapter_audio_map(db, [c.id for c in chapters])
    return [_chapter_out(c, audio_by_chapter.get(c.id)) for c in chapters]


def get_chapter(db: Session, number: int) -> ChapterOut | None:
    stmt = select(Chapter).where(
        Chapter.number == number, _status_filter(Chapter.verification_status)
    )
    chapter = db.execute(stmt).scalar_one_or_none()
    if chapter is None:
        return None
    audio = _chapter_audio_map(db, [chapter.id]).get(chapter.id)
    return _chapter_out(chapter, audio)


def _chapter_audio_map(db: Session, chapter_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    if not chapter_ids:
        return {}
    stmt = select(AudioTrack.chapter_id, AudioTrack.id).where(
        AudioTrack.kind == "chapter",
        AudioTrack.chapter_id.in_(chapter_ids),
        _status_filter(AudioTrack.verification_status),
    )
    return {chapter_id: track_id for chapter_id, track_id in db.execute(stmt) if chapter_id}


def _chapter_out(chapter: Chapter, audio_track_id: uuid.UUID | None) -> ChapterOut:
    key_verses = []
    for ref in chapter.key_verse_refs:
        parsed = parse_verse_ref(ref)
        if parsed and parsed.verse is not None:
            key_verses.append(
                VerseRefOut(chapter=parsed.chapter, verse=parsed.verse, verse_end=parsed.verse_end)
            )
    return ChapterOut(
        id=chapter.id,
        number=chapter.number,
        slug=chapter.slug,
        name_sanskrit=chapter.name_sanskrit,
        name_transliteration=chapter.name_transliteration,
        name_english=chapter.name_english,
        name_hindi=chapter.name_hindi,
        verse_count=chapter.verse_count,
        summary=chapter.summary,
        summary_hindi=chapter.summary_hindi,
        major_teachings=list(chapter.major_teachings or []),
        key_concepts=list(chapter.key_concepts or []),
        key_verses=key_verses,
        audio_track_id=audio_track_id,
        verification_status=chapter.verification_status,
    )


# --- Verses ---------------------------------------------------------------


def _verse_summary_query() -> Select:
    return (
        select(Verse)
        .options(
            selectinload(Verse.text_versions),
            selectinload(Verse.transliterations),
            selectinload(Verse.translations),
        )
        .where(_status_filter(Verse.verification_status))
    )


def list_chapter_verses(
    db: Session, chapter_number: int, *, limit: int = 100, offset: int = 0, language: str = "en"
) -> tuple[list[VerseSummaryOut], int]:
    base = _verse_summary_query().where(Verse.chapter_number == chapter_number)
    total = db.execute(
        select(func.count())
        .select_from(Verse)
        .where(
            Verse.chapter_number == chapter_number,
            _status_filter(Verse.verification_status),
        )
    ).scalar_one()
    verses = db.execute(base.order_by(Verse.number).limit(limit).offset(offset)).scalars().all()
    return [verse_summary(v, language=language) for v in verses], int(total)


def get_verse(db: Session, chapter: int, number: int, *, language: str = "en") -> VerseOut | None:
    stmt = (
        select(Verse)
        .options(
            selectinload(Verse.text_versions).selectinload(VerseTextVersion.source),
            selectinload(Verse.transliterations).selectinload(TransliterationVersion.source),
            selectinload(Verse.translations).selectinload(Translation.source),
            selectinload(Verse.commentaries).selectinload(Commentary.commentator),
            selectinload(Verse.commentaries).selectinload(Commentary.source),
            selectinload(Verse.words),
        )
        .where(
            Verse.chapter_number == chapter,
            Verse.number == number,
            _status_filter(Verse.verification_status),
        )
    )
    verse = db.execute(stmt).scalar_one_or_none()
    if verse is None:
        return None

    summary = verse_summary(verse, language=language)
    statuses = visible_statuses()

    audio = (
        db.execute(
            select(AudioTrack).where(
                AudioTrack.verse_id == verse.id,
                AudioTrack.verification_status.in_(statuses),
            )
        )
        .scalars()
        .all()
    )
    topics = db.execute(
        select(Topic, VerseTopic.relevance)
        .join(VerseTopic, VerseTopic.topic_id == Topic.id)
        .where(
            VerseTopic.verse_id == verse.id,
            Topic.verification_status.in_(statuses),
        )
        .order_by(VerseTopic.relevance.desc())
    ).all()
    related = _related_verses(db, verse.id, language=language)

    return VerseOut(
        **summary.model_dump(by_alias=False),
        text_versions=[_text_version_out(t) for t in verse.text_versions],
        transliterations=[_transliteration_out(t) for t in verse.transliterations],
        translations=[_translation_out(t) for t in verse.translations],
        commentaries=[_commentary_out(c) for c in verse.commentaries],
        words=[VerseWordOut.model_validate(w) for w in verse.words],
        audio_tracks=[_audio_out(a) for a in audio],
        topics=[_topic_summary_out(t, 0) for t, _ in topics],
        related_verses=related,
        speaker=verse.speaker,
        verification_status=verse.verification_status,
        canonical_hash=_primary_hash(verse),
        updated_at=verse.updated_at,
    )


def get_verses_by_refs(
    db: Session, refs: Sequence[str], *, language: str = "en"
) -> dict[str, VerseSummaryOut]:
    """Resolve a batch of "2.47"-style references in one query."""
    pairs: list[tuple[int, int]] = []
    for ref in refs:
        parsed = parse_verse_ref(ref)
        if parsed and parsed.verse is not None:
            pairs.append((parsed.chapter, parsed.verse))
    if not pairs:
        return {}

    clauses = [
        and_(Verse.chapter_number == chapter, Verse.number == verse) for chapter, verse in pairs
    ]
    stmt = _verse_summary_query().where(or_(*clauses))
    verses = db.execute(stmt).scalars().all()
    return {f"{v.chapter_number}.{v.number}": verse_summary(v, language=language) for v in verses}


def verse_summary(verse: Verse, *, language: str = "en") -> VerseSummaryOut:
    sanskrit = _pick_text_version(verse, "devanagari")
    translit = verse.transliterations[0].text if verse.transliterations else None
    return VerseSummaryOut(
        id=verse.id,
        chapter_number=verse.chapter_number,
        verse_number=verse.number,
        verse_number_end=verse.number_end,
        ref=f"{verse.chapter_number}.{verse.number}",
        slug=verse.slug,
        sanskrit=sanskrit,
        transliteration=translit,
        translation_english=_pick_translation(verse, "en"),
        translation_hindi=_pick_translation(verse, "hi"),
    )


def _pick_text_version(verse: Verse, script: str) -> str | None:
    candidates = [t for t in verse.text_versions if t.script == script]
    if not candidates:
        return None
    primary = next((t for t in candidates if t.is_primary), None)
    return (primary or candidates[0]).text


def _primary_hash(verse: Verse) -> str | None:
    for text in verse.text_versions:
        if text.script == "devanagari" and text.is_primary:
            return text.canonical_hash
    return verse.text_versions[0].canonical_hash if verse.text_versions else None


def _pick_translation(verse: Verse, language_code: str) -> str | None:
    candidates = [t for t in verse.translations if t.language_code == language_code]
    if not candidates:
        return None
    # Prefer canonical (published translator) over curated simplifications.
    canonical = [t for t in candidates if t.origin == "canonical"]
    return (canonical or candidates)[0].text


def _related_verses(db: Session, verse_id: uuid.UUID, *, language: str) -> list[RelatedVerseOut]:
    stmt = (
        select(RelatedVerse, Verse)
        .join(Verse, Verse.id == RelatedVerse.to_verse_id)
        .options(
            selectinload(Verse.text_versions),
            selectinload(Verse.transliterations),
            selectinload(Verse.translations),
        )
        .where(
            RelatedVerse.from_verse_id == verse_id,
            _status_filter(Verse.verification_status),
        )
        .order_by(RelatedVerse.weight.desc(), Verse.ordinal)
        .limit(12)
    )
    return [
        RelatedVerseOut(
            verse=verse_summary(target, language=language),
            relation_type=rel.relation_type,
            note=rel.note,
        )
        for rel, target in db.execute(stmt).all()
    ]


# --- Mappers --------------------------------------------------------------


def _source_out(source) -> ContentSourceOut | None:
    if source is None:
        return None
    return ContentSourceOut(
        id=source.id,
        name=source.name,
        source_url=source.source_url,
        author=source.author,
        publication=source.publication,
        publication_year=source.publication_year,
        license=(
            ContentLicenseOut.model_validate(source.license) if source.license is not None else None
        ),
        copyright_status=source.copyright_status,
        date_accessed=source.date_accessed.isoformat() if source.date_accessed else None,
        reviewer=source.reviewer,
        verification_notes=source.verification_notes,
    )


def _text_version_out(text: VerseTextVersion) -> VerseTextVersionOut:
    return VerseTextVersionOut(
        id=text.id,
        script=text.script,
        text=text.text,
        canonical_hash=text.canonical_hash,
        source=_source_out(text.source),
        version=text.version,
        verification_status=text.verification_status,
        is_primary=text.is_primary,
    )


def _transliteration_out(item: TransliterationVersion) -> TransliterationOut:
    return TransliterationOut(
        id=item.id,
        scheme=item.scheme,
        text=item.text,
        source=_source_out(item.source),
        version=item.version,
        verification_status=item.verification_status,
    )


def _translation_out(item: Translation) -> TranslationOut:
    return TranslationOut(
        id=item.id,
        language_code=item.language_code,
        text=item.text,
        translator_name=item.translator_name,
        style=item.style,
        source=_source_out(item.source),
        version=item.version,
        verification_status=item.verification_status,
        origin=item.origin,
    )


def _commentary_out(item: Commentary) -> CommentaryOut:
    return CommentaryOut(
        id=item.id,
        commentator=(CommentatorOut.model_validate(item.commentator) if item.commentator else None),
        language_code=item.language_code,
        text=item.text,
        source=_source_out(item.source),
        version=item.version,
        verification_status=item.verification_status,
        origin=item.origin,
    )


def _audio_out(track: AudioTrack) -> AudioTrackOut:
    from gita_api.services.media import resolve_audio_url

    return AudioTrackOut(
        id=track.id,
        kind=track.kind,
        chapter_number=track.chapter_number,
        verse_number=track.verse_number,
        language_code=track.language_code,
        reciter=track.reciter,
        is_synthetic=track.is_synthetic,
        duration_seconds=track.duration_seconds,
        size_bytes=track.size_bytes,
        mime_type=track.mime_type,
        url=resolve_audio_url(track.object_key),
        license=None,
        verification_status=track.verification_status,
    )


def _topic_summary_out(topic: Topic, verse_count: int) -> TopicSummaryOut:
    return TopicSummaryOut(
        id=topic.id,
        slug=topic.slug,
        name=topic.name,
        name_hindi=topic.name_hindi,
        category=topic.category,
        short_description=topic.short_description,
        verse_count=verse_count,
        icon=topic.icon,
    )


# --- Topics ---------------------------------------------------------------


def list_topics(db: Session, category: str | None = None) -> list[TopicSummaryOut]:
    counts = (
        select(VerseTopic.topic_id, func.count().label("verse_count"))
        .group_by(VerseTopic.topic_id)
        .subquery()
    )
    stmt = (
        select(Topic, func.coalesce(counts.c.verse_count, 0))
        .outerjoin(counts, counts.c.topic_id == Topic.id)
        .where(_status_filter(Topic.verification_status))
        .order_by(Topic.sort_order, Topic.name)
    )
    if category:
        stmt = stmt.where(Topic.category == category)
    return [_topic_summary_out(topic, int(count)) for topic, count in db.execute(stmt).all()]


def get_topic(db: Session, slug: str, *, language: str = "en") -> TopicOut | None:
    topic = db.execute(
        select(Topic).where(Topic.slug == slug, _status_filter(Topic.verification_status))
    ).scalar_one_or_none()
    if topic is None:
        return None

    rows = db.execute(
        select(VerseTopic, Verse)
        .join(Verse, Verse.id == VerseTopic.verse_id)
        .options(
            selectinload(Verse.text_versions),
            selectinload(Verse.transliterations),
            selectinload(Verse.translations),
        )
        .where(
            VerseTopic.topic_id == topic.id,
            _status_filter(Verse.verification_status),
        )
        .order_by(VerseTopic.relevance.desc(), Verse.ordinal)
    ).all()

    related_topics: list[TopicSummaryOut] = []
    if topic.related_topic_slugs:
        related = (
            db.execute(
                select(Topic).where(
                    Topic.slug.in_(topic.related_topic_slugs),
                    _status_filter(Topic.verification_status),
                )
            )
            .scalars()
            .all()
        )
        related_topics = [_topic_summary_out(t, 0) for t in related]

    return TopicOut(
        **_topic_summary_out(topic, len(rows)).model_dump(by_alias=False),
        introduction=topic.introduction,
        introduction_hindi=topic.introduction_hindi,
        related_concepts=list(topic.related_concepts or []),
        related_topics=related_topics,
        verses=[
            TopicVerseOut(
                verse=verse_summary(verse, language=language),
                relevance=link.relevance,
                note=link.note,
            )
            for link, verse in rows
        ],
    )


# --- Glossary -------------------------------------------------------------


def list_glossary(db: Session) -> list[GlossaryTermOut]:
    terms = (
        db.execute(
            select(GlossaryTerm)
            .where(_status_filter(GlossaryTerm.verification_status))
            .order_by(GlossaryTerm.term_transliteration)
        )
        .scalars()
        .all()
    )
    return [_glossary_out(term, []) for term in terms]


def get_glossary_term(db: Session, slug: str, *, language: str = "en") -> GlossaryTermOut | None:
    term = db.execute(
        select(GlossaryTerm).where(
            GlossaryTerm.slug == slug, _status_filter(GlossaryTerm.verification_status)
        )
    ).scalar_one_or_none()
    if term is None:
        return None
    verses = get_verses_by_refs(db, term.related_verse_refs or [], language=language)
    ordered = [verses[ref] for ref in (term.related_verse_refs or []) if ref in verses]
    return _glossary_out(term, ordered)


def _glossary_out(term: GlossaryTerm, verses: list[VerseSummaryOut]) -> GlossaryTermOut:
    return GlossaryTermOut(
        id=term.id,
        slug=term.slug,
        term_sanskrit=term.term_sanskrit,
        term_transliteration=term.term_transliteration,
        term_english=term.term_english,
        simple_definition=term.simple_definition,
        detailed_definition=term.detailed_definition,
        variants=list(term.variants or []),
        synonyms=list(term.synonyms or []),
        related_term_slugs=list(term.related_term_slugs or []),
        related_verses=verses,
        sources=[],
        verification_status=term.verification_status,
    )
