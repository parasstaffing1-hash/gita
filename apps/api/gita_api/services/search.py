"""Search orchestration.

Wires the retrievers in services/search to the API's normalisation, embeddings
and response models. The pipeline is:

    normalise -> detect language -> parse reference
              -> run retrievers (reference | fulltext | fuzzy | semantic | topic)
              -> fuse (RRF) -> rerank -> hydrate verse summaries
"""

from __future__ import annotations

import logging
from functools import lru_cache

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from gita_api.config import settings
from gita_api.db.models import GlossaryTerm, Topic, Verse, VerseTopic
from gita_api.schemas.content import TopicSummaryOut, VerseSummaryOut
from gita_api.schemas.search import (
    GlossaryHintOut,
    SearchHitOut,
    SearchReference,
    SearchResponse,
)
from gita_api.services.content import verse_summary, visible_statuses
from gita_api.utils.normalize import (
    content_terms,
    detect_query_language,
    normalize_query,
    transliteration_skeleton,
)
from gita_api.utils.verse_ref import parse_verse_ref

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_embedder():
    from gita_embeddings import get_embedding_provider

    return get_embedding_provider(
        provider=settings.embedding_provider,
        model_name=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
        use_stub=settings.embedding_use_stub,
    )


def search(
    db: Session,
    raw_query: str,
    *,
    limit: int = 20,
    language: str | None = None,
    semantic: bool = True,
) -> SearchResponse:
    from gita_search import (
        Stopwatch,
        fulltext_search,
        fuse,
        fuzzy_search,
        reference_lookup,
        rerank,
        semantic_search,
        topic_lookup,
    )

    watch = Stopwatch()
    query = normalize_query(raw_query)
    detected = language or detect_query_language(query)
    folded = transliteration_skeleton(query)
    # Full-text runs on content words only; see content_terms for why.
    terms = content_terms(query)
    include_unpublished = not settings.is_production

    parsed = parse_verse_ref(query)
    result_sets: dict[str, list] = {}

    # A direct reference is unambiguous — answer it and skip the noise.
    if parsed is not None:
        result_sets["reference"] = reference_lookup(
            db, parsed.chapter, parsed.verse, include_unpublished=include_unpublished
        )
        watch.mark("reference")

    if not parsed or not result_sets.get("reference"):
        result_sets["fulltext"] = fulltext_search(
            db, terms, limit=40, include_unpublished=include_unpublished
        )
        watch.mark("fulltext")

        if folded:
            result_sets["fuzzy"] = fuzzy_search(
                db, folded, limit=40, include_unpublished=include_unpublished
            )
            watch.mark("fuzzy")
            result_sets["topic"] = topic_lookup(
                db, folded, limit=20, include_unpublished=include_unpublished
            )
            watch.mark("topic")

        if semantic:
            try:
                embedder = get_embedder()
                vector = embedder.embed_one(query)
                result_sets["semantic"] = semantic_search(
                    db,
                    vector,
                    embedder.model_name,
                    limit=40,
                    include_unpublished=include_unpublished,
                )
            except Exception:
                # Semantic retrieval is an enhancement, not a dependency. If the
                # model or the index is unavailable, keyword search still works.
                logger.warning(
                    "Semantic retrieval unavailable; continuing without it", exc_info=True
                )
            watch.mark("semantic")

    hits = fuse(result_sets, limit=limit * 2)
    hits = rerank(hits, query_terms=query.split())[:limit]

    verses = _hydrate(db, [h.verse_id for h in hits if h.verse_id], language=detected)
    timing = watch.finish()

    return SearchResponse(
        query=raw_query,
        normalized_query=query,
        detected_language=detected,
        reference=(SearchReference(chapter=parsed.chapter, verse=parsed.verse) if parsed else None),
        hits=[
            SearchHitOut(
                verse=verses[hit.verse_id],
                score=hit.score,
                relevance=hit.relevance,
                matched_by=hit.matched_by,
                snippet=hit.snippet,
                snippet_field=hit.snippet_field,
            )
            for hit in hits
            if hit.verse_id in verses
        ],
        topics=_matching_topics(db, folded),
        glossary=_matching_glossary(db, folded),
        total=len(hits),
        took_ms=timing.total_ms,
    )


def _hydrate(db: Session, verse_ids: list[str], *, language: str) -> dict[str, VerseSummaryOut]:
    if not verse_ids:
        return {}
    rows = (
        db.execute(
            select(Verse)
            .options(
                selectinload(Verse.text_versions),
                selectinload(Verse.transliterations),
                selectinload(Verse.translations),
            )
            .where(Verse.id.in_(verse_ids))
        )
        .scalars()
        .all()
    )
    return {str(v.id): verse_summary(v, language=language) for v in rows}


def _matching_topics(db: Session, folded: str, limit: int = 4) -> list[TopicSummaryOut]:
    """Surface curated topics whose folded slug shares a token with the query."""
    if not folded:
        return []
    tokens = [t for t in folded.split() if len(t) >= 3]
    if not tokens:
        return []
    clauses = [Topic.slug.contains(token) for token in tokens]
    clauses += [Topic.name.ilike(f"%{token}%") for token in tokens]

    counts = (
        select(VerseTopic.topic_id, func.count().label("n"))
        .group_by(VerseTopic.topic_id)
        .subquery()
    )
    rows = db.execute(
        select(Topic, counts.c.n)
        .outerjoin(counts, counts.c.topic_id == Topic.id)
        .where(or_(*clauses), Topic.verification_status.in_(visible_statuses()))
        .order_by(Topic.sort_order)
        .limit(limit)
    ).all()
    return [
        TopicSummaryOut(
            id=topic.id,
            slug=topic.slug,
            name=topic.name,
            name_hindi=topic.name_hindi,
            category=topic.category,
            short_description=topic.short_description,
            verse_count=int(count or 0),
            icon=topic.icon,
        )
        for topic, count in rows
    ]


def _matching_glossary(db: Session, folded: str, limit: int = 4) -> list[GlossaryHintOut]:
    if not folded:
        return []
    tokens = [t for t in folded.split() if len(t) >= 3]
    if not tokens:
        return []

    clauses = [GlossaryTerm.search_key.contains(token) for token in tokens]
    terms = (
        db.execute(
            select(GlossaryTerm)
            .where(
                or_(*clauses),
                GlossaryTerm.verification_status.in_(visible_statuses()),
            )
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [
        GlossaryHintOut(
            id=t.id,
            slug=t.slug,
            term_sanskrit=t.term_sanskrit,
            term_transliteration=t.term_transliteration,
            simple_definition=t.simple_definition,
        )
        for t in terms
    ]
