"""Rebuild the search index and, optionally, the embeddings.

    python -m scripts.reindex_search
    python -m scripts.reindex_search --embed
    python -m scripts.reindex_search --chapter 2 --embed

Full-text and fuzzy indexing is fast and runs by default. Embedding is opt-in
because with a real sentence-transformer model it downloads weights and takes
noticeably longer.
"""

from __future__ import annotations

import argparse
import logging
import sys

from gita_search import collect_documents, embed_documents, index_documents, prune_orphans

from gita_api.config import settings
from gita_api.db.session import session_scope
from gita_api.utils.normalize import transliteration_skeleton

logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")
logger = logging.getLogger("reindex")


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild the search index")
    parser.add_argument("--chapter", type=int, default=None, help="Limit to one chapter")
    parser.add_argument("--embed", action="store_true", help="Also (re)compute embeddings")
    parser.add_argument("--prune", action="store_true", help="Delete orphaned documents first")
    args = parser.parse_args()

    with session_scope() as db:
        if args.prune:
            removed = prune_orphans(db)
            logger.info("Pruned %d orphaned documents", removed)

        # The same folding function the query path uses. If these ever diverge,
        # fuzzy search silently stops matching - hence one shared function.
        documents = collect_documents(db, transliteration_skeleton, chapter=args.chapter)
        logger.info("Collected %d documents", len(documents))
        if not documents:
            logger.warning("Nothing to index. Have you imported content yet?")
            return 0

        stats, ids = index_documents(db, documents)
        logger.info("Indexed %d documents", stats.documents_written)

        if args.embed:
            from gita_embeddings import get_embedding_provider

            provider = get_embedding_provider(
                provider=settings.embedding_provider,
                model_name=settings.embedding_model,
                dimensions=settings.embedding_dimensions,
                use_stub=settings.embedding_use_stub,
            )
            logger.info("Embedding with %s (%s)", provider.name, provider.model_name)
            written = embed_documents(
                db, ids, provider.embed, provider.model_name, provider.dimensions
            )
            logger.info("Wrote %d embeddings", written)
        else:
            logger.info("Skipped embeddings. Pass --embed to build them.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
