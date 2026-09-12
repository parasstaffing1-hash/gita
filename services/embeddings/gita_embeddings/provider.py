"""Embedding providers.

Default is a local open-source multilingual sentence-transformer, so a running
instance needs no API key and no per-query cost. A deterministic hashing
embedder stands in for tests and CI, where downloading a 400 MB model would be
absurd.

Vectors are L2-normalised, so cosine distance in pgvector is a plain dot
product and the HNSW index behaves predictably.
"""

from __future__ import annotations

import hashlib
import logging
import math
from abc import ABC, abstractmethod
from collections.abc import Sequence
from functools import lru_cache

logger = logging.getLogger(__name__)


class EmbeddingProvider(ABC):
    """Anything that can turn text into a fixed-size vector."""

    name: str
    model_name: str
    dimensions: int

    @abstractmethod
    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Embed a batch. Order of results matches order of inputs."""

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]

    def health_check(self) -> bool:
        try:
            vector = self.embed_one("dharma")
            return len(vector) == self.dimensions
        except Exception:  # pragma: no cover
            logger.exception("Embedding provider %s failed its health check", self.name)
            return False


def _normalise(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return vector
    return [v / norm for v in vector]


class HashingEmbeddingProvider(EmbeddingProvider):
    """Deterministic bag-of-character-ngrams embedder.

    Not semantic — it is a stand-in that keeps the whole pipeline (indexing,
    pgvector storage, retrieval, reranking) exercisable in tests and on a
    laptop without downloading a model. It still produces useful *lexical*
    similarity, so retrieval tests are meaningful rather than random.
    """

    name = "hashing-stub"

    def __init__(self, dimensions: int = 384, model_name: str = "hashing-stub-v1") -> None:
        self.dimensions = dimensions
        self.model_name = model_name

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._embed_single(text) for text in texts]

    def _embed_single(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        cleaned = " ".join(text.lower().split())
        tokens = cleaned.split()
        grams: list[str] = list(tokens)
        for token in tokens:
            padded = f"^{token}$"
            grams.extend(padded[i : i + 3] for i in range(max(1, len(padded) - 2)))
        for gram in grams:
            digest = hashlib.blake2b(gram.encode("utf-8"), digest_size=8).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[index] += sign
        return _normalise(vector)


class SentenceTransformerProvider(EmbeddingProvider):
    """Local multilingual embeddings.

    The default model handles Devanagari, IAST and Latin script in one space,
    which is exactly what a Sanskrit/Hindi/English corpus needs.
    """

    name = "sentence-transformers"

    def __init__(self, model_name: str, dimensions: int) -> None:
        self.model_name = model_name
        self.dimensions = dimensions
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model %s", self.model_name)
            self._model = SentenceTransformer(self.model_name)
            actual = self._model.get_sentence_embedding_dimension()
            if actual != self.dimensions:
                raise ValueError(
                    f"Model {self.model_name} produces {actual}-dimensional vectors but the "
                    f"database column is {self.dimensions}-dimensional. Update "
                    "EMBEDDING_DIMENSIONS and re-run the embeddings migration."
                )
        return self._model

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        model = self._load()
        vectors = model.encode(
            list(texts), normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False
        )
        return [list(map(float, v)) for v in vectors]


@lru_cache(maxsize=4)
def get_embedding_provider(
    provider: str = "sentence-transformers",
    model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    dimensions: int = 384,
    use_stub: bool = False,
) -> EmbeddingProvider:
    """Resolve the configured provider.

    Falls back to the hashing stub if the real model cannot be imported, so a
    missing optional dependency degrades search quality instead of taking the
    API down.
    """
    if use_stub or provider in ("stub", "hashing"):
        return HashingEmbeddingProvider(dimensions=dimensions)
    if provider == "sentence-transformers":
        try:
            import sentence_transformers  # noqa: F401
        except ImportError:
            logger.warning(
                "sentence-transformers is not installed; falling back to the hashing "
                "embedder. Install the 'embeddings' extra for semantic search."
            )
            return HashingEmbeddingProvider(dimensions=dimensions)
        return SentenceTransformerProvider(model_name=model_name, dimensions=dimensions)
    raise ValueError(f"Unknown embedding provider: {provider}")


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)
