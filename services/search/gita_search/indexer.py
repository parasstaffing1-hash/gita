"""Search index builder.

Projects canonical content into `search_documents` and, optionally, embeds each
document into `embeddings`.

Design notes:
  * The projection is idempotent. Re-running it updates rows in place, so
    re-indexing after a content import never produces duplicates.
  * `search_key` is written by the same folding function the query path uses.
    If those two ever diverge, fuzzy search silently stops working — which is
    why both sides live behind one shared function and are covered by a test.
  * Embedding is a separate pass so a content edit can refresh full-text
    instantly and defer the (slower) vector work.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass
class IndexableDocument:
    kind: str
    verse_id: str | None
    entity_id: str | None
    language_code: str
    title: str | None
    body: str
    search_key: str
    weight: float
    verification_status: str


@dataclass
class IndexStats:
    documents_written: int = 0
    embeddings_written: int = 0
    documents_removed: int = 0


def collect_documents(
    db: Session, fold: Callable[[str], str], *, chapter: int | None = None
) -> list[IndexableDocument]:
    """Read canonical rows and turn them into indexable documents.

    One document per (verse, language, layer). A verse therefore contributes
    its Sanskrit, its transliteration, each translation and each approved
    commentary as separate documents — which lets a Hindi query match a Hindi
    translation without the English text diluting the score.
    """
    documents: list[IndexableDocument] = []
    chapter_clause = "AND v.chapter_number = :chapter" if chapter else ""
    params = {"chapter": chapter} if chapter else {}

    verse_rows = db.execute(
        text(
            f"""
            SELECT v.id::text AS verse_id,
                   v.chapter_number,
                   v.number,
                   v.verification_status,
                   COALESCE(
                       (SELECT tv.text FROM verse_text_versions tv
                        WHERE tv.verse_id = v.id AND tv.script = 'devanagari'
                        ORDER BY tv.is_primary DESC, tv.version DESC LIMIT 1), ''
                   ) AS sanskrit,
                   COALESCE(
                       (SELECT tr.text FROM transliteration_versions tr
                        WHERE tr.verse_id = v.id
                        ORDER BY tr.version DESC LIMIT 1), ''
                   ) AS translit
            FROM verses v
            WHERE TRUE {chapter_clause}
            ORDER BY v.ordinal
            """
        ),
        params,
    ).mappings()

    for row in verse_rows:
        ref = f"{row['chapter_number']}.{row['number']}"
        body_parts = [p for p in (row["sanskrit"], row["translit"]) if p]
        if not body_parts:
            continue
        body = "\n".join(body_parts)
        documents.append(
            IndexableDocument(
                kind="verse",
                verse_id=row["verse_id"],
                entity_id=None,
                language_code="sa",
                title=f"Bhagavad Gita {ref}",
                body=body,
                # The reference itself is part of the key so "2.47" fuzzy-matches too.
                search_key=fold(f"{ref} {body}"),
                weight=1.2,
                verification_status=row["verification_status"],
            )
        )

    translation_rows = db.execute(
        text(
            f"""
            SELECT t.id::text AS entity_id,
                   t.verse_id::text AS verse_id,
                   t.language_code,
                   t.text,
                   t.verification_status,
                   v.chapter_number,
                   v.number
            FROM translations t
            JOIN verses v ON v.id = t.verse_id
            WHERE TRUE {chapter_clause}
            """
        ),
        params,
    ).mappings()
    for row in translation_rows:
        ref = f"{row['chapter_number']}.{row['number']}"
        documents.append(
            IndexableDocument(
                kind="translation",
                verse_id=row["verse_id"],
                entity_id=row["entity_id"],
                language_code=row["language_code"],
                title=f"Bhagavad Gita {ref}",
                body=row["text"],
                search_key=fold(f"{ref} {row['text']}"),
                weight=1.0,
                verification_status=row["verification_status"],
            )
        )

    commentary_rows = db.execute(
        text(
            f"""
            SELECT c.id::text AS entity_id,
                   c.verse_id::text AS verse_id,
                   c.language_code,
                   c.text,
                   c.verification_status,
                   v.chapter_number,
                   v.number
            FROM commentaries c
            JOIN verses v ON v.id = c.verse_id
            WHERE c.approved_for_ai = TRUE {chapter_clause}
            """
        ),
        params,
    ).mappings()
    for row in commentary_rows:
        ref = f"{row['chapter_number']}.{row['number']}"
        # Commentary is long; index a bounded prefix so one commentary cannot
        # dominate the term statistics of the whole corpus.
        body = row["text"][:4000]
        documents.append(
            IndexableDocument(
                kind="commentary",
                verse_id=row["verse_id"],
                entity_id=row["entity_id"],
                language_code=row["language_code"],
                title=f"Commentary on {ref}",
                body=body,
                search_key=fold(body),
                weight=0.7,
                verification_status=row["verification_status"],
            )
        )

    if chapter is None:
        glossary_rows = db.execute(
            text(
                """
                SELECT id::text AS entity_id, term_sanskrit, term_transliteration,
                       term_english, simple_definition, detailed_definition,
                       variants, synonyms, verification_status
                FROM glossary_terms
                """
            )
        ).mappings()
        for row in glossary_rows:
            aliases = " ".join(list(row["variants"] or []) + list(row["synonyms"] or []))
            body = " ".join(
                filter(
                    None,
                    [
                        row["term_sanskrit"],
                        row["term_transliteration"],
                        row["term_english"],
                        row["simple_definition"],
                        (row["detailed_definition"] or "")[:2000],
                        aliases,
                    ],
                )
            )
            documents.append(
                IndexableDocument(
                    kind="glossary",
                    verse_id=None,
                    entity_id=row["entity_id"],
                    language_code="en",
                    title=row["term_transliteration"],
                    body=body,
                    search_key=fold(
                        f"{row['term_sanskrit']} {row['term_transliteration']} {aliases}"
                    ),
                    weight=0.9,
                    verification_status=row["verification_status"],
                )
            )

        topic_rows = db.execute(
            text(
                """
                SELECT id::text AS entity_id, slug, name, name_hindi,
                       short_description, introduction, related_concepts,
                       verification_status
                FROM topics
                """
            )
        ).mappings()
        for row in topic_rows:
            body = " ".join(
                filter(
                    None,
                    [
                        row["name"],
                        row["name_hindi"],
                        row["short_description"],
                        (row["introduction"] or "")[:2000],
                        " ".join(row["related_concepts"] or []),
                    ],
                )
            )
            documents.append(
                IndexableDocument(
                    kind="topic",
                    verse_id=None,
                    entity_id=row["entity_id"],
                    language_code="en",
                    title=row["name"],
                    body=body,
                    search_key=fold(f"{row['slug']} {row['name']} {row['name_hindi'] or ''}"),
                    weight=0.8,
                    verification_status=row["verification_status"],
                )
            )

    return documents


UPSERT_SQL = text(
    """
    INSERT INTO search_documents
        (id, kind, verse_id, entity_id, language_code, title, body, search_key,
         weight, verification_status, created_at, updated_at)
    VALUES
        (gen_random_uuid(), :kind, CAST(:verse_id AS uuid), CAST(:entity_id AS uuid),
         :language_code, :title, :body, :search_key, :weight, :verification_status,
         now(), now())
    ON CONFLICT (kind, verse_id, entity_id, language_code)
    DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        search_key = EXCLUDED.search_key,
        weight = EXCLUDED.weight,
        verification_status = EXCLUDED.verification_status,
        updated_at = now()
    RETURNING id::text
    """
)


def index_documents(
    db: Session, documents: Iterable[IndexableDocument]
) -> tuple[IndexStats, list[str]]:
    """Upsert documents. Returns stats and the affected document ids."""
    stats = IndexStats()
    ids: list[str] = []
    for doc in documents:
        row = db.execute(
            UPSERT_SQL,
            {
                "kind": doc.kind,
                "verse_id": doc.verse_id,
                "entity_id": doc.entity_id,
                "language_code": doc.language_code,
                "title": doc.title,
                "body": doc.body,
                "search_key": doc.search_key,
                "weight": doc.weight,
                "verification_status": doc.verification_status,
            },
        ).scalar_one()
        ids.append(row)
        stats.documents_written += 1
    return stats, ids


EMBED_UPSERT_SQL = text(
    """
    INSERT INTO embeddings (id, document_id, model_name, dimensions, embedding,
                            created_at, updated_at)
    VALUES (gen_random_uuid(), CAST(:document_id AS uuid), :model_name, :dimensions,
            CAST(:embedding AS vector), now(), now())
    ON CONFLICT (document_id, model_name)
    DO UPDATE SET embedding = EXCLUDED.embedding,
                  dimensions = EXCLUDED.dimensions,
                  updated_at = now()
    """
)


def embed_documents(
    db: Session,
    document_ids: Sequence[str],
    embed_fn: Callable[[Sequence[str]], list[list[float]]],
    model_name: str,
    dimensions: int,
    *,
    batch_size: int = 32,
) -> int:
    """Embed documents in batches and upsert the vectors."""
    written = 0
    for start in range(0, len(document_ids), batch_size):
        batch_ids = list(document_ids[start : start + batch_size])
        rows = (
            db.execute(
                text(
                    """
                SELECT id::text AS id, COALESCE(title, '') AS title, body
                FROM search_documents
                WHERE id = ANY(CAST(:ids AS uuid[]))
                """
                ),
                {"ids": batch_ids},
            )
            .mappings()
            .all()
        )
        if not rows:
            continue
        texts = [f"{r['title']}\n{r['body']}".strip() for r in rows]
        vectors = embed_fn(texts)
        for row, vector in zip(rows, vectors, strict=False):
            db.execute(
                EMBED_UPSERT_SQL,
                {
                    "document_id": row["id"],
                    "model_name": model_name,
                    "dimensions": dimensions,
                    "embedding": "[" + ",".join(f"{v:.6f}" for v in vector) + "]",
                },
            )
            written += 1
        logger.info(
            "Embedded %d/%d documents",
            min(start + batch_size, len(document_ids)),
            len(document_ids),
        )
    return written


def prune_orphans(db: Session) -> int:
    """Remove documents whose source rows are gone."""
    result = db.execute(
        text(
            """
            DELETE FROM search_documents d
            WHERE d.verse_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM verses v WHERE v.id = d.verse_id)
            """
        )
    )
    return result.rowcount or 0
