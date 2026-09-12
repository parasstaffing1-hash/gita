"""Ask the Gita: the grounded answer pipeline.

    question
      -> normalise + detect language
      -> hybrid retrieval (services/search)
      -> load verified verses and approved commentary
      -> rerank
      -> build a constrained context
      -> LLM generates the explanation only
      -> strip any scripture the model produced itself
      -> validate every citation against the retrieved context
      -> persist the query, the answer and its validated sources
      -> return the answer with exact sources

If retrieval comes back thin, the pipeline answers "I cannot ground this"
instead of asking a model to fill the gap. That refusal is a feature.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from gita_api.config import settings
from gita_api.db.models import AiAnswer, AiAnswerSource, AiQuery, Commentary, Verse
from gita_api.schemas.content import VerseSummaryOut
from gita_api.schemas.search import AskCitationOut, AskRequest, AskResponse
from gita_api.security.content_guard import ai_actor
from gita_api.services.content import verse_summary, visible_statuses
from gita_api.services.search import search as run_search
from gita_api.utils.normalize import detect_query_language, normalize_query
from gita_api.utils.verse_ref import parse_verse_ref

logger = logging.getLogger(__name__)

# How many retrieved verses go into the model's context. Enough to answer a
# thematic question, small enough that every passage stays legible to a reader
# checking the sources.
MAX_CONTEXT_PASSAGES = 6

FOLLOW_UPS: dict[str, list[str]] = {
    "en": [
        "Explain this more simply",
        "What do the commentators say?",
        "Show me related verses",
    ],
    "hi": [
        "इसे और सरल भाषा में समझाइए",
        "भाष्यकार क्या कहते हैं?",
        "संबंधित श्लोक दिखाइए",
    ],
    "hi-Latn": [
        "Ise aur simple bhasha mein samjhaiye",
        "Commentators kya kehte hain?",
        "Related verses dikhaiye",
    ],
}


@lru_cache(maxsize=1)
def get_provider():
    from gita_ai import create_provider

    return create_provider(
        settings.ai_provider,
        api_key=settings.ai_api_key,
        model=settings.ai_model,
        base_url=settings.ai_base_url,
        timeout=float(settings.ai_timeout_seconds),
    )


@dataclass
class _Passage:
    ref: str
    verse: Verse
    summary: VerseSummaryOut
    commentary: Commentary | None
    score: float
    matched_by: list[str] = dataclass_field(default_factory=list)


def ask(
    db: Session,
    request: AskRequest,
    *,
    user_id: uuid.UUID | None = None,
    session_id: uuid.UUID | None = None,
    client: str = "web",
) -> AskResponse:
    from gita_ai import (
        ContextPassage,
        GenerationRequest,
        GroundedContext,
        Message,
        ProviderError,
        build_prompt,
        disclaimer_for,
        guard_generated_scripture,
        insufficient_evidence_answer,
        validate_citations,
    )

    started = time.perf_counter()
    question = normalize_query(request.question)
    language = request.language or detect_query_language(question)
    anchor_ref = _normalise_anchor(request.verse_ref)

    # --- retrieve ---------------------------------------------------------
    search_result = run_search(db, question, limit=MAX_CONTEXT_PASSAGES * 2, language=language)
    refs = [hit.verse.ref for hit in search_result.hits]
    if anchor_ref and anchor_ref not in refs:
        refs.insert(0, anchor_ref)

    passages = _load_passages(db, refs[: MAX_CONTEXT_PASSAGES + 2], language=language)
    # `relevance`, not `score`: the fusion score only orders results, whereas
    # the grounding gate needs to know whether anything genuinely matched.
    scores = {hit.verse.ref: hit.relevance for hit in search_result.hits}
    matched_by = {hit.verse.ref: hit.matched_by for hit in search_result.hits}
    for passage in passages:
        passage.score = scores.get(passage.ref, 1.0 if passage.ref == anchor_ref else 0.0)
        # An anchor verse ("ask about this verse") is corroborated by the fact
        # that the reader is looking at it.
        passage.matched_by = matched_by.get(
            passage.ref, ["reference"] if passage.ref == anchor_ref else []
        )
    passages.sort(key=lambda p: p.score, reverse=True)
    passages = passages[:MAX_CONTEXT_PASSAGES]

    context = GroundedContext(
        passages=[
            ContextPassage(
                ref=p.ref,
                verse_id=str(p.verse.id),
                sanskrit=p.summary.sanskrit,
                transliteration=p.summary.transliteration,
                translation=p.summary.translation_english
                if language != "hi"
                else (p.summary.translation_hindi or p.summary.translation_english),
                translation_language="hi"
                if language == "hi" and p.summary.translation_hindi
                else "en",
                commentary=p.commentary.text if p.commentary else None,
                commentator_name=(
                    p.commentary.commentator.name
                    if p.commentary and p.commentary.commentator
                    else None
                ),
                source_name=None,
                score=p.score,
                matched_by=p.matched_by,
            )
            for p in passages
        ],
        language=language,
        mode=request.mode,
    )

    query_row = AiQuery(
        user_id=user_id,
        session_id=session_id,
        conversation_id=request.conversation_id,
        question=request.question,
        normalized_question=question,
        detected_language=language,
        mode=request.mode,
        anchor_verse_id=next((p.verse.id for p in passages if p.ref == anchor_ref), None),
        retrieved_document_ids=[],
        retrieval_debug={
            "hit_count": len(search_result.hits),
            "took_ms": search_result.took_ms,
            "matched_by": {h.verse.ref: h.matched_by for h in search_result.hits[:10]},
        },
        client=client,
    )

    # --- generate ---------------------------------------------------------
    provider = get_provider()
    rejected: list[str] = []

    if not context.is_sufficient:
        # Refuse rather than guess. This is the whole point of the product.
        answer_text = insufficient_evidence_answer(language)
        grounding = "insufficient_evidence"
        cited_refs: list[str] = []
        provider_name, model_name = provider.name, provider.model
    else:
        prompt = build_prompt(question, context, anchor_ref=anchor_ref)
        generation = GenerationRequest(
            messages=[Message(role=role, content=content) for role, content in prompt],
            max_output_tokens=settings.ai_max_output_tokens,
        )
        try:
            result = provider.generate(generation)
            raw_answer = result.text
            provider_name, model_name = result.provider, result.model
            query_row.retrieval_debug["prompt_tokens"] = result.prompt_tokens
        except ProviderError:
            logger.exception("AI provider failed; returning the ungrounded-refusal answer")
            raw_answer = insufficient_evidence_answer(language)
            provider_name, model_name = provider.name, provider.model

        # A model must never author scripture. Anything Devanagari it produced
        # that is not verbatim from the context is removed before validation.
        cleaned, removed_scripture = guard_generated_scripture(raw_answer, context)
        if removed_scripture:
            logger.warning("Stripped model-generated Devanagari from an answer")
            query_row.retrieval_debug["stripped_generated_scripture"] = True

        validation = validate_citations(cleaned, context)
        answer_text = validation.answer
        grounding = validation.grounding_status
        cited_refs = validation.cited_refs
        rejected = validation.rejected_refs

    # --- persist ----------------------------------------------------------
    # The AI actor context makes any accidental write to a canonical table fail
    # loudly rather than silently corrupting scripture.
    with ai_actor():
        db.add(query_row)
        db.flush()

        answer_row = AiAnswer(
            query_id=query_row.id,
            answer=answer_text,
            grounding_status=grounding,
            model_provider=provider_name,
            model_name=model_name or "unknown",
            latency_ms=int((time.perf_counter() - started) * 1000),
            rejected_citations=rejected,
            follow_up_suggestions=FOLLOW_UPS.get(language, FOLLOW_UPS["en"]),
        )
        db.add(answer_row)
        db.flush()

        # A refusal has no sources. Listing the nearest verses under an "I
        # cannot answer this" would read as if they supported a claim.
        citations = (
            []
            if grounding == "insufficient_evidence"
            else _build_citations(passages, cited_refs, language=language)
        )
        for position, (passage, citation) in enumerate(citations):
            db.add(
                AiAnswerSource(
                    answer_id=answer_row.id,
                    verse_id=passage.verse.id,
                    verse_ref=passage.ref,
                    quoted_field=citation.quoted_field,
                    quoted_text=citation.quoted_text,
                    commentary_id=passage.commentary.id if passage.commentary else None,
                    relevance_score=passage.score,
                    position=position,
                    validated=True,
                )
            )

    return AskResponse(
        id=answer_row.id,
        question=request.question,
        normalized_question=question,
        detected_language=language,
        mode=request.mode,
        answer=answer_text,
        grounding_status=grounding,
        citations=[citation for _, citation in citations],
        rejected_citations=rejected,
        follow_up_suggestions=answer_row.follow_up_suggestions,
        disclaimer=disclaimer_for(language) if grounding != "insufficient_evidence" else None,
        model_provider=provider_name,
        model_name=model_name or "unknown",
        took_ms=int((time.perf_counter() - started) * 1000),
        created_at=answer_row.created_at,
    )


def _normalise_anchor(raw: str | None) -> str | None:
    if not raw:
        return None
    parsed = parse_verse_ref(raw)
    if parsed is None or parsed.verse is None:
        return None
    return f"{parsed.chapter}.{parsed.verse}"


def _load_passages(db: Session, refs: list[str], *, language: str) -> list[_Passage]:
    """Load verified verses and their approved commentary.

    `approved_for_ai` is the editorial gate: a commentary must be explicitly
    approved before a model is allowed to read it, so an unreviewed import
    cannot leak into an answer.
    """
    if not refs:
        return []
    pairs = []
    for ref in refs:
        parsed = parse_verse_ref(ref)
        if parsed and parsed.verse is not None:
            pairs.append((parsed.chapter, parsed.verse))
    if not pairs:
        return []

    from sqlalchemy import and_, or_

    statuses = visible_statuses()
    clauses = [and_(Verse.chapter_number == c, Verse.number == v) for c, v in pairs]
    verses = (
        db.execute(
            select(Verse)
            .options(
                selectinload(Verse.text_versions),
                selectinload(Verse.transliterations),
                selectinload(Verse.translations),
                selectinload(Verse.commentaries).selectinload(Commentary.commentator),
            )
            .where(or_(*clauses), Verse.verification_status.in_(statuses))
        )
        .scalars()
        .all()
    )

    by_ref = {f"{v.chapter_number}.{v.number}": v for v in verses}
    passages: list[_Passage] = []
    for ref in refs:
        verse = by_ref.get(ref)
        if verse is None:
            continue
        commentary = next(
            (
                c
                for c in verse.commentaries
                if c.approved_for_ai
                and c.origin != "ai_generated"
                and (c.language_code == language or c.language_code == "en")
            ),
            None,
        )
        passages.append(
            _Passage(
                ref=ref,
                verse=verse,
                summary=verse_summary(verse, language=language),
                commentary=commentary,
                score=0.0,
                matched_by=[],
            )
        )
    return passages


def _build_citations(
    passages: list[_Passage], cited_refs: list[str], *, language: str
) -> list[tuple[_Passage, AskCitationOut]]:
    """Turn validated references into citation cards.

    `quoted_text` is read out of the stored row here — the model contributed
    only the reference. If the model cited nothing (a plain, correct answer with
    no bracket markers) the top retrieved passages are shown instead, so a
    reader always has sources to check.
    """
    order = cited_refs or [p.ref for p in passages[:3]]
    by_ref = {p.ref: p for p in passages}

    results: list[tuple[_Passage, AskCitationOut]] = []
    for ref in order:
        passage = by_ref.get(ref)
        if passage is None:
            continue
        translation = (
            passage.summary.translation_hindi
            if language == "hi" and passage.summary.translation_hindi
            else passage.summary.translation_english
        )
        quoted_text = translation or passage.summary.sanskrit or ""
        quoted_field = "translation" if translation else "sanskrit"
        results.append(
            (
                passage,
                AskCitationOut(
                    verse=passage.summary,
                    quoted_text=quoted_text,
                    quoted_field=quoted_field,
                    translation_language="hi"
                    if quoted_field == "translation" and language == "hi"
                    else "en",
                    commentator_name=(
                        passage.commentary.commentator.name
                        if passage.commentary and passage.commentary.commentator
                        else None
                    ),
                    source_name=None,
                    source_url=None,
                    license_code=None,
                ),
            )
        )
    return results
