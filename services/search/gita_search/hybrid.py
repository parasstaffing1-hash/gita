"""Hybrid retrieval, entirely inside PostgreSQL.

Four retrievers run against `search_documents` and their results are fused:

  1. reference   -> "2.47", "chapter 2 verse 47", "२.४७"  (exact, wins outright)
  2. full-text   -> ts_rank_cd over the accent-folded `gita_simple` config
  3. fuzzy       -> pg_trgm similarity on the folded `search_key`
                    (this is what makes krsna / krishn / Kṛṣṇa agree)
  4. semantic    -> pgvector cosine distance over the embedding index

Fusion is reciprocal rank fusion plus a curated-topic boost. RRF is used
because the four retrievers produce scores on incomparable scales, and RRF only
needs their orderings.

No Elasticsearch, no external vector database — one database, four indexes.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# RRF constant. 60 is the value from the original paper and behaves well when
# one retriever is much noisier than the others.
RRF_K = 60

RETRIEVER_WEIGHTS: dict[str, float] = {
    "reference": 4.0,
    "fulltext": 1.4,
    "fuzzy": 0.9,
    "semantic": 1.2,
    "topic": 1.1,
}


@dataclass
class RetrievedDocument:
    document_id: str
    verse_id: str | None
    kind: str
    ref: str | None
    title: str | None
    body: str
    language_code: str
    raw_score: float
    matched_by: list[str] = field(default_factory=list)
    weight: float = 1.0


@dataclass
class FusedHit:
    verse_id: str
    document_id: str
    ref: str | None
    # Reciprocal-rank-fusion score. Ranks results against each other; the
    # absolute value carries no meaning on its own.
    score: float
    # Strongest raw retriever score, normalised to roughly 0..1 across
    # retrievers. This is the absolute "how well did anything actually match"
    # signal, and it is what the Ask pipeline gates on.
    relevance: float
    matched_by: list[str]
    snippet: str | None
    snippet_field: str | None


# Raw retriever scores live on different scales. These bring them into a
# comparable band so `relevance` means the same thing whichever retriever won.
def _normalise_raw(retriever: str, raw: float) -> float:
    if retriever == "reference":
        return 1.0
    if retriever == "fulltext":
        # ts_rank_cd sits around 0.05-0.3 for a solid match.
        return min(1.0, raw * 4.0)
    # fuzzy (trigram similarity), semantic (cosine) and topic (curated
    # relevance x similarity) are already 0..1.
    return max(0.0, min(1.0, raw))


def _statuses(include_unpublished: bool) -> tuple[str, ...]:
    return ("published", "verified", "review", "draft") if include_unpublished else ("published",)


# --- Individual retrievers ------------------------------------------------


def fulltext_search(
    db: Session,
    query: str,
    *,
    limit: int = 40,
    languages: Sequence[str] | None = None,
    include_unpublished: bool = False,
) -> list[RetrievedDocument]:
    """PostgreSQL full-text search with accent folding.

    `query` must already have had its function words removed (see
    gita_api.utils.normalize.content_terms). The remaining terms are ORed
    rather than ANDed, so a question still matches; ts_rank_cd then ranks
    documents that match more of the terms above those that match one.

    The tsquery is produced by `plainto_tsquery` and only its operator is
    rewritten, so user input is sanitised by Postgres and never interpolated.
    """
    if not query.strip():
        return []

    sql = text(
        """
        WITH q AS (
            SELECT CAST(
                NULLIF(
                    replace(CAST(plainto_tsquery('gita_simple', :q) AS text), '&', '|'),
                    ''
                ) AS tsquery
            ) AS tsq
        )
        SELECT d.id::text          AS document_id,
               d.verse_id::text    AS verse_id,
               d.kind,
               d.title,
               d.body,
               d.language_code,
               d.weight,
               ts_rank_cd(d.tsv, q.tsq) AS score,
               v.chapter_number,
               v.number
        FROM search_documents d
        CROSS JOIN q
        LEFT JOIN verses v ON v.id = d.verse_id
        WHERE q.tsq IS NOT NULL
          AND d.tsv @@ q.tsq
          AND d.verse_id IS NOT NULL
          AND d.verification_status = ANY(CAST(:statuses AS text[]))
          AND (
            CAST(:languages AS text[]) IS NULL
            OR d.language_code = ANY(CAST(:languages AS text[]))
          )
        ORDER BY score DESC, d.weight DESC
        LIMIT :limit
        """
    )
    rows = db.execute(
        sql,
        {
            "q": query,
            "limit": limit,
            "statuses": list(_statuses(include_unpublished)),
            "languages": list(languages) if languages else None,
        },
    ).mappings()
    return [_to_document(row, "fulltext") for row in rows]


def fuzzy_search(
    db: Session,
    folded_query: str,
    *,
    limit: int = 40,
    threshold: float = 0.24,
    include_unpublished: bool = False,
) -> list[RetrievedDocument]:
    """Trigram similarity over the folded search key.

    `folded_query` must already have gone through the same normalisation as the
    stored `search_key` (gita_api.utils.normalize.transliteration_skeleton).

    Uses `similarity() >= threshold` rather than the `%` operator. At this
    corpus size (a few thousand documents) the scan costs single-digit
    milliseconds; the `%` operator is the index-backed upgrade if the corpus
    grows by an order of magnitude, e.g. when more scriptures are added.
    """
    sql = text(
        """
        SELECT d.id::text       AS document_id,
               d.verse_id::text AS verse_id,
               d.kind,
               d.title,
               d.body,
               d.language_code,
               d.weight,
               similarity(d.search_key, :q) AS score,
               v.chapter_number,
               v.number
        FROM search_documents d
        LEFT JOIN verses v ON v.id = d.verse_id
        WHERE similarity(d.search_key, :q) >= :threshold
          AND d.verse_id IS NOT NULL
          AND d.verification_status = ANY(CAST(:statuses AS text[]))
        ORDER BY score DESC
        LIMIT :limit
        """
    )
    rows = db.execute(
        sql,
        {
            "q": folded_query,
            "threshold": threshold,
            "limit": limit,
            "statuses": list(_statuses(include_unpublished)),
        },
    ).mappings()
    return [_to_document(row, "fuzzy") for row in rows]


def semantic_search(
    db: Session,
    query_vector: Sequence[float],
    model_name: str,
    *,
    limit: int = 40,
    include_unpublished: bool = False,
) -> list[RetrievedDocument]:
    """pgvector cosine search, restricted to one embedding model.

    Vectors from different models are not comparable, so mixing them would
    silently degrade recall — hence the explicit model filter.
    """
    sql = text(
        """
        SELECT d.id::text       AS document_id,
               d.verse_id::text AS verse_id,
               d.kind,
               d.title,
               d.body,
               d.language_code,
               d.weight,
               1 - (e.embedding <=> CAST(:vector AS vector)) AS score,
               v.chapter_number,
               v.number
        FROM embeddings e
        JOIN search_documents d ON d.id = e.document_id
        LEFT JOIN verses v ON v.id = d.verse_id
        WHERE e.model_name = :model
          AND d.verse_id IS NOT NULL
          AND d.verification_status = ANY(CAST(:statuses AS text[]))
        ORDER BY e.embedding <=> CAST(:vector AS vector)
        LIMIT :limit
        """
    )
    rows = db.execute(
        sql,
        {
            "vector": "[" + ",".join(f"{v:.6f}" for v in query_vector) + "]",
            "model": model_name,
            "limit": limit,
            "statuses": list(_statuses(include_unpublished)),
        },
    ).mappings()
    return [_to_document(row, "semantic") for row in rows]


def reference_lookup(
    db: Session, chapter: int, verse: int | None, *, include_unpublished: bool = False
) -> list[RetrievedDocument]:
    """Direct chapter/verse lookup. Always outranks everything else."""
    where_verse = "AND v.number = :verse" if verse is not None else ""
    sql = text(
        f"""
        SELECT d.id::text       AS document_id,
               d.verse_id::text AS verse_id,
               d.kind,
               d.title,
               d.body,
               d.language_code,
               d.weight,
               1.0 AS score,
               v.chapter_number,
               v.number
        FROM verses v
        JOIN search_documents d ON d.verse_id = v.id AND d.kind = 'verse'
        WHERE v.chapter_number = :chapter
          {where_verse}
          AND d.verse_id IS NOT NULL
          AND d.verification_status = ANY(CAST(:statuses AS text[]))
        ORDER BY v.number
        LIMIT 40
        """
    )
    params = {
        "chapter": chapter,
        "statuses": list(_statuses(include_unpublished)),
    }
    if verse is not None:
        params["verse"] = verse
    rows = db.execute(sql, params).mappings()
    return [_to_document(row, "reference") for row in rows]


def topic_lookup(
    db: Session, folded_query: str, *, limit: int = 20, include_unpublished: bool = False
) -> list[RetrievedDocument]:
    """Verses reachable through a curated topic whose name matches the query.

    This is what makes "failure ka dar" or "control mind" land on the verses an
    editor chose, instead of relying on lexical luck.
    """
    sql = text(
        """
        SELECT d.id::text       AS document_id,
               d.verse_id::text AS verse_id,
               d.kind,
               d.title,
               d.body,
               d.language_code,
               d.weight,
               vt.relevance * GREATEST(similarity(t.slug, :q), similarity(t.name, :q)) AS score,
               v.chapter_number,
               v.number
        FROM topics t
        JOIN verse_topics vt ON vt.topic_id = t.id
        JOIN verses v ON v.id = vt.verse_id
        JOIN search_documents d ON d.verse_id = v.id AND d.kind = 'verse'
        WHERE GREATEST(similarity(t.slug, :q), similarity(t.name, :q)) >= 0.2
          AND d.verse_id IS NOT NULL
          AND d.verification_status = ANY(CAST(:statuses AS text[]))
        ORDER BY score DESC
        LIMIT :limit
        """
    )
    rows = db.execute(
        sql,
        {"q": folded_query, "limit": limit, "statuses": list(_statuses(include_unpublished))},
    ).mappings()
    return [_to_document(row, "topic") for row in rows]


def _to_document(row, matched_by: str) -> RetrievedDocument:
    ref = None
    if row.get("chapter_number") is not None and row.get("number") is not None:
        ref = f"{row['chapter_number']}.{row['number']}"
    return RetrievedDocument(
        document_id=row["document_id"],
        verse_id=row["verse_id"],
        kind=row["kind"],
        ref=ref,
        title=row["title"],
        body=row["body"],
        language_code=row["language_code"],
        raw_score=float(row["score"] or 0.0),
        matched_by=[matched_by],
        weight=float(row["weight"] or 1.0),
    )


# --- Fusion + reranking ---------------------------------------------------


def fuse(result_sets: dict[str, list[RetrievedDocument]], *, limit: int = 20) -> list[FusedHit]:
    """Reciprocal rank fusion across retrievers, grouped by verse.

    Grouping by verse (not by document) matters: a verse can match through its
    Sanskrit, its English translation and a commentary at once, and the reader
    wants one result, not three.
    """
    accumulated: dict[str, dict] = {}

    for retriever, documents in result_sets.items():
        weight = RETRIEVER_WEIGHTS.get(retriever, 1.0)
        for rank, doc in enumerate(documents, start=1):
            key = doc.verse_id or doc.document_id
            entry = accumulated.setdefault(
                key,
                {
                    "verse_id": doc.verse_id,
                    "document_id": doc.document_id,
                    "ref": doc.ref,
                    "score": 0.0,
                    "relevance": 0.0,
                    "matched_by": [],
                    "best": doc,
                    "best_raw": -1.0,
                },
            )
            entry["score"] += weight * (1.0 / (RRF_K + rank)) * doc.weight
            if retriever not in entry["matched_by"]:
                entry["matched_by"].append(retriever)
            entry["relevance"] = max(entry["relevance"], _normalise_raw(retriever, doc.raw_score))
            # Keep the strongest single document for snippet rendering.
            if doc.raw_score > entry["best_raw"]:
                entry["best_raw"] = doc.raw_score
                entry["best"] = doc

    # Anything without a verse cannot be rendered as a verse hit; glossary and
    # topic matches are surfaced through their own fields on the response.
    ordered = sorted(
        (e for e in accumulated.values() if e["verse_id"]),
        key=lambda e: e["score"],
        reverse=True,
    )
    hits: list[FusedHit] = []
    for entry in ordered[:limit]:
        best: RetrievedDocument = entry["best"]
        hits.append(
            FusedHit(
                verse_id=entry["verse_id"] or "",
                document_id=entry["document_id"],
                ref=entry["ref"],
                score=round(entry["score"], 6),
                relevance=round(entry["relevance"], 6),
                matched_by=entry["matched_by"],
                snippet=_snippet(best.body),
                snippet_field=best.kind,
            )
        )
    return hits


def _snippet(body: str, *, max_chars: int = 220) -> str:
    cleaned = " ".join(body.split())
    if len(cleaned) <= max_chars:
        return cleaned
    cut = cleaned[:max_chars]
    space = cut.rfind(" ")
    return (cut[:space] if space > max_chars * 0.6 else cut).rstrip() + "…"


def rerank(
    hits: list[FusedHit],
    *,
    query_terms: Sequence[str],
    boost_refs: Sequence[str] = (),
) -> list[FusedHit]:
    """Light lexical reranking on top of fusion.

    A cross-encoder would be better and is the obvious upgrade, but it costs a
    model load per request. This pass captures most of the benefit: exact term
    overlap in the snippet, and an explicit boost for verses the caller already
    knows are relevant (the anchor verse, curated topic verses).
    """
    boost = set(boost_refs)
    terms = [t.lower() for t in query_terms if len(t) > 2]

    for hit in hits:
        bonus = 0.0
        if hit.ref and hit.ref in boost:
            bonus += 0.25
        if terms and hit.snippet:
            snippet = hit.snippet.lower()
            overlap = sum(1 for term in terms if term in snippet)
            bonus += 0.02 * overlap
        if "reference" in hit.matched_by:
            bonus += 0.5
        hit.score = round(hit.score + bonus, 6)

    return sorted(hits, key=lambda h: h.score, reverse=True)


@dataclass
class SearchTiming:
    total_ms: int
    per_retriever_ms: dict[str, int] = field(default_factory=dict)


class Stopwatch:
    """Small helper so timings end up in the response and in query logs."""

    def __init__(self) -> None:
        self._start = time.perf_counter()
        self._marks: dict[str, float] = {}

    def mark(self, name: str) -> None:
        self._marks[name] = time.perf_counter()

    def finish(self) -> SearchTiming:
        end = time.perf_counter()
        previous = self._start
        per: dict[str, int] = {}
        for name, at in self._marks.items():
            per[name] = int((at - previous) * 1000)
            previous = at
        return SearchTiming(total_ms=int((end - self._start) * 1000), per_retriever_ms=per)
