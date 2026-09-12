"""Pluggable LLM provider abstraction.

Business logic depends on `AIProvider`, never on a vendor SDK. Swapping
providers is an environment change (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`),
not a code change.

Every adapter speaks the same four methods:

    generate()      -> one completion
    stream()        -> token iterator
    embed()         -> vectors (delegated to services/embeddings by default)
    health_check()  -> is this provider reachable and configured?
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Message:
    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass
class GenerationRequest:
    messages: list[Message]
    max_output_tokens: int = 1200
    # Low by default: this is an explanation grounded in supplied text, not
    # creative writing. Determinism matters more than variety.
    temperature: float = 0.2
    stop: list[str] = field(default_factory=list)


@dataclass
class GenerationResult:
    text: str
    model: str
    provider: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    finish_reason: str | None = None


class ProviderError(RuntimeError):
    """Raised for any provider-side failure, so callers handle one error type."""


class AIProvider(ABC):
    name: str
    model: str

    @abstractmethod
    def generate(self, request: GenerationRequest) -> GenerationResult: ...

    @abstractmethod
    def stream(self, request: GenerationRequest) -> Iterator[str]: ...

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Embeddings default to the local open-source model.

        Keeping embeddings independent of the chat provider means switching
        chat vendors never invalidates the vector index.
        """
        from gita_embeddings import get_embedding_provider

        return get_embedding_provider().embed(texts)

    @abstractmethod
    def health_check(self) -> bool: ...


class EchoProvider(AIProvider):
    """Offline provider used in development and tests.

    It does not invent scripture: it summarises the grounded context it was
    given and points at the citations. That keeps the whole Ask pipeline —
    retrieval, prompt assembly, citation validation — testable with no API key
    and no network.
    """

    name = "echo"

    def __init__(self, model: str = "echo-1") -> None:
        self.model = model

    def generate(self, request: GenerationRequest) -> GenerationResult:
        refs = _extract_refs_from_context(request.messages)
        if not refs:
            text = (
                "I could not find enough verified material in the library to answer "
                "that with confidence."
            )
        else:
            listed = ", ".join(refs[:4])
            text = (
                f"Here is what the retrieved verses say about your question.\n\n"
                f"The passages most directly relevant are {listed}. "
                f"Read them in full below — each is quoted from the stored text, "
                f"with its translation and source.\n\n"
                f"[{refs[0]}] speaks to this most directly."
            )
        return GenerationResult(
            text=text,
            model=self.model,
            provider=self.name,
            prompt_tokens=sum(len(m.content) // 4 for m in request.messages),
            completion_tokens=len(text) // 4,
            finish_reason="stop",
        )

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        yield from self.generate(request).text.split(" ")

    def health_check(self) -> bool:
        return True


def _extract_refs_from_context(messages: Sequence[Message]) -> list[str]:
    """Pull the [C.V] markers the prompt builder put into the context block."""
    import re

    refs: list[str] = []
    for message in messages:
        for match in re.finditer(r"\[(\d{1,2}\.\d{1,3})\]", message.content):
            ref = match.group(1)
            if ref not in refs:
                refs.append(ref)
    return refs


class _HttpProvider(AIProvider):
    """Shared HTTP plumbing for the hosted providers."""

    base_url: str
    api_key: str
    timeout: float

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float = 60.0) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self.timeout)

    def health_check(self) -> bool:
        if not self.api_key:
            return False
        try:
            result = self.generate(
                GenerationRequest(messages=[Message("user", "ping")], max_output_tokens=8)
            )
            return bool(result.text)
        except Exception:  # pragma: no cover - network
            logger.warning("Health check failed for provider %s", self.name, exc_info=True)
            return False


class OpenAICompatibleProvider(_HttpProvider):
    """OpenAI Chat Completions wire format.

    Also covers OpenRouter, Groq, vLLM and any other service that speaks the
    same shape — they differ only in base URL and model id.
    """

    name = "openai"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _payload(self, request: GenerationRequest, stream: bool) -> dict:
        return {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "max_tokens": request.max_output_tokens,
            "temperature": request.temperature,
            **({"stop": request.stop} if request.stop else {}),
            "stream": stream,
        }

    def generate(self, request: GenerationRequest) -> GenerationResult:
        with self._client() as client:
            response = client.post(
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json=self._payload(request, stream=False),
            )
        if response.status_code >= 400:
            raise ProviderError(
                f"{self.name} returned {response.status_code}: {response.text[:400]}"
            )
        data = response.json()
        choice = data["choices"][0]
        usage = data.get("usage", {})
        return GenerationResult(
            text=choice["message"]["content"] or "",
            model=data.get("model", self.model),
            provider=self.name,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            finish_reason=choice.get("finish_reason"),
        )

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        with (
            self._client() as client,
            client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json=self._payload(request, stream=True),
            ) as response,
        ):
            if response.status_code >= 400:
                raise ProviderError(f"{self.name} returned {response.status_code}")
            for line in response.iter_lines():
                if not line or not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload.strip() == "[DONE]":
                    break
                try:
                    delta = json.loads(payload)["choices"][0].get("delta", {})
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if content := delta.get("content"):
                    yield content


class AnthropicProvider(_HttpProvider):
    name = "anthropic"

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def _payload(self, request: GenerationRequest, stream: bool) -> dict:
        # Anthropic takes the system prompt as a top-level field.
        system = "\n\n".join(m.content for m in request.messages if m.role == "system")
        turns = [
            {"role": m.role, "content": m.content}
            for m in request.messages
            if m.role in ("user", "assistant")
        ]
        payload: dict = {
            "model": self.model,
            "messages": turns,
            "max_tokens": request.max_output_tokens,
            "temperature": request.temperature,
            "stream": stream,
        }
        if system:
            payload["system"] = system
        if request.stop:
            payload["stop_sequences"] = request.stop
        return payload

    def generate(self, request: GenerationRequest) -> GenerationResult:
        with self._client() as client:
            response = client.post(
                f"{self.base_url}/v1/messages",
                headers=self._headers(),
                json=self._payload(request, stream=False),
            )
        if response.status_code >= 400:
            raise ProviderError(f"anthropic returned {response.status_code}: {response.text[:400]}")
        data = response.json()
        text = "".join(block.get("text", "") for block in data.get("content", []))
        usage = data.get("usage", {})
        return GenerationResult(
            text=text,
            model=data.get("model", self.model),
            provider=self.name,
            prompt_tokens=usage.get("input_tokens"),
            completion_tokens=usage.get("output_tokens"),
            finish_reason=data.get("stop_reason"),
        )

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        with (
            self._client() as client,
            client.stream(
                "POST",
                f"{self.base_url}/v1/messages",
                headers=self._headers(),
                json=self._payload(request, stream=True),
            ) as response,
        ):
            if response.status_code >= 400:
                raise ProviderError(f"anthropic returned {response.status_code}")
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "content_block_delta" and (
                    text := event.get("delta", {}).get("text")
                ):
                    yield text


class GeminiProvider(_HttpProvider):
    name = "gemini"

    def _payload(self, request: GenerationRequest) -> dict:
        system = "\n\n".join(m.content for m in request.messages if m.role == "system")
        contents = [
            {
                "role": "model" if m.role == "assistant" else "user",
                "parts": [{"text": m.content}],
            }
            for m in request.messages
            if m.role in ("user", "assistant")
        ]
        payload: dict = {
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": request.max_output_tokens,
                "temperature": request.temperature,
            },
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        return payload

    def generate(self, request: GenerationRequest) -> GenerationResult:
        url = f"{self.base_url}/v1beta/models/{self.model}:generateContent"
        with self._client() as client:
            response = client.post(url, params={"key": self.api_key}, json=self._payload(request))
        if response.status_code >= 400:
            raise ProviderError(f"gemini returned {response.status_code}: {response.text[:400]}")
        data = response.json()
        candidates = data.get("candidates", [])
        text = ""
        if candidates:
            text = "".join(p.get("text", "") for p in candidates[0]["content"].get("parts", []))
        usage = data.get("usageMetadata", {})
        return GenerationResult(
            text=text,
            model=self.model,
            provider=self.name,
            prompt_tokens=usage.get("promptTokenCount"),
            completion_tokens=usage.get("candidatesTokenCount"),
            finish_reason=candidates[0].get("finishReason") if candidates else None,
        )

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        # Gemini's streaming endpoint differs enough that a single-shot call is
        # the honest fallback until streaming is actually needed here.
        yield self.generate(request).text


class OllamaProvider(_HttpProvider):
    """Local models via Ollama or any OpenAI-compatible local server."""

    name = "ollama"

    def __init__(
        self, model: str, base_url: str = "http://localhost:11434", timeout: float = 120.0
    ):
        super().__init__(api_key="", model=model, base_url=base_url, timeout=timeout)

    def generate(self, request: GenerationRequest) -> GenerationResult:
        with self._client() as client:
            response = client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{"role": m.role, "content": m.content} for m in request.messages],
                    "stream": False,
                    "options": {
                        "temperature": request.temperature,
                        "num_predict": request.max_output_tokens,
                    },
                },
            )
        if response.status_code >= 400:
            raise ProviderError(f"ollama returned {response.status_code}")
        data = response.json()
        return GenerationResult(
            text=data.get("message", {}).get("content", ""),
            model=self.model,
            provider=self.name,
            finish_reason=data.get("done_reason"),
        )

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        with (
            self._client() as client,
            client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{"role": m.role, "content": m.content} for m in request.messages],
                    "stream": True,
                },
            ) as response,
        ):
            for line in response.iter_lines():
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if content := event.get("message", {}).get("content"):
                    yield content

    def health_check(self) -> bool:
        try:
            with self._client() as client:
                return client.get(f"{self.base_url}/api/tags").status_code == 200
        except Exception:  # pragma: no cover
            return False


# Base URL and a sensible default model per provider. Overridable by config.
_PROVIDER_DEFAULTS: dict[str, tuple[str, str]] = {
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini"),
    "anthropic": ("https://api.anthropic.com", "claude-sonnet-4-5"),
    "gemini": ("https://generativelanguage.googleapis.com", "gemini-2.0-flash"),
    "openrouter": ("https://openrouter.ai/api/v1", "openai/gpt-4o-mini"),
    "groq": ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
    "ollama": ("http://localhost:11434", "llama3.1"),
}


def create_provider(
    provider: str,
    *,
    api_key: str = "",
    model: str = "",
    base_url: str = "",
    timeout: float = 60.0,
) -> AIProvider:
    """Build the configured provider.

    An unset or unknown provider resolves to `EchoProvider` so the API always
    starts — it degrades to "cannot answer confidently" rather than crashing.
    """
    key = (provider or "echo").strip().lower()
    if key in ("", "echo", "none", "stub"):
        return EchoProvider()

    default_url, default_model = _PROVIDER_DEFAULTS.get(key, ("", ""))
    resolved_url = base_url or default_url
    resolved_model = model or default_model

    if key == "anthropic":
        return AnthropicProvider(api_key, resolved_model, resolved_url, timeout)
    if key == "gemini":
        return GeminiProvider(api_key, resolved_model, resolved_url, timeout)
    if key == "ollama":
        return OllamaProvider(resolved_model, resolved_url, timeout)
    if key in ("openai", "openrouter", "groq", "vllm", "local"):
        instance = OpenAICompatibleProvider(api_key, resolved_model, resolved_url, timeout)
        instance.name = key
        return instance

    logger.warning("Unknown AI provider %r; falling back to the offline echo provider.", provider)
    return EchoProvider()
