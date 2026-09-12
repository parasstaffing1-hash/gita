"""Grounding and citation validation.

These cover the guarantee the Ask feature is built on: a model may explain, but
it may not supply scripture, and it may not cite a verse that was not retrieved.
"""

from __future__ import annotations

import pytest
from gita_ai import (
    ContextPassage,
    EchoProvider,
    GenerationRequest,
    GroundedContext,
    Message,
    build_prompt,
    create_provider,
    extract_refs,
    guard_generated_scripture,
    insufficient_evidence_answer,
    validate_citations,
)


def passage(ref: str, score: float = 0.9, commentary: str | None = None) -> ContextPassage:
    return ContextPassage(
        ref=ref,
        verse_id=f"id-{ref}",
        sanskrit="कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।",
        transliteration="karmaṇy evādhikāras te mā phaleṣu kadācana",
        translation="You have a claim on the action alone, never on its fruits.",
        translation_language="en",
        commentary=commentary,
        commentator_name="Test Commentator" if commentary else None,
        source_name="Test source",
        score=score,
    )


@pytest.fixture
def context() -> GroundedContext:
    return GroundedContext(passages=[passage("2.47"), passage("3.35", 0.7)], language="en")


# --- Reference extraction -------------------------------------------------


def test_extracts_bracketed_and_bare_references():
    text = "See [2.47] and also 3.35 for the same idea."
    assert extract_refs(text) == ["2.47", "3.35"]


def test_ignores_impossible_chapter_numbers():
    # 19 is not a chapter, so "19.4" must not be treated as a citation.
    assert extract_refs("compare [19.4] with [2.47]") == ["2.47"]


def test_deduplicates_repeated_references():
    assert extract_refs("[2.47] ... [2.47] ... 2.47") == ["2.47"]


# --- Citation validation --------------------------------------------------


def test_answer_citing_only_retrieved_verses_is_grounded(context):
    result = validate_citations("The point is made in [2.47] and [3.35].", context)
    assert result.grounding_status == "grounded"
    assert result.cited_refs == ["2.47", "3.35"]
    assert result.rejected_refs == []


def test_citation_outside_the_context_is_rejected_and_stripped(context):
    # 18.66 is real scripture, but it was not retrieved — so it must not appear
    # as a source the reader could click through to.
    answer = "This is addressed in [2.47], and also in [18.66]."
    result = validate_citations(answer, context)

    assert result.rejected_refs == ["18.66"]
    assert "18.66" not in result.answer
    assert "2.47" in result.answer
    assert result.grounding_status == "partially_grounded"


def test_thin_retrieval_produces_a_refusal_not_an_answer():
    weak = GroundedContext(passages=[passage("2.47", score=0.01)], language="en")
    assert not weak.is_sufficient
    result = validate_citations("Some confident-sounding answer about [2.47].", weak)
    assert result.grounding_status == "insufficient_evidence"


def test_empty_retrieval_is_insufficient():
    empty = GroundedContext(passages=[], language="en")
    assert not empty.is_sufficient
    result = validate_citations("Anything at all.", empty)
    assert result.grounding_status == "insufficient_evidence"


def test_an_answer_with_no_citations_is_not_reported_as_grounded(context):
    result = validate_citations("A general answer with no references.", context)
    assert result.grounding_status == "partially_grounded"
    assert result.cited_refs == []


# --- Generated-scripture guard --------------------------------------------


def test_devanagari_copied_from_the_context_is_kept(context):
    answer = "The verse reads:\nकर्मण्येवाधिकारस्ते मा फलेषु कदाचन।\nwhich means the following."
    cleaned, removed = guard_generated_scripture(answer, context)
    assert not removed
    assert "कर्मण्येवाधिकारस्ते" in cleaned


def test_devanagari_the_model_invented_is_removed(context):
    # A plausible-looking line that is not in the context. This is the exact
    # failure mode the product must never show: fabricated scripture.
    answer = "The verse says:\nयोगः कर्मसु कौशलम् इति मिथ्या वचनम्\nand therefore ..."
    cleaned, removed = guard_generated_scripture(answer, context)
    assert removed
    assert "मिथ्या" not in cleaned
    assert "and therefore" in cleaned


def test_answers_without_devanagari_pass_through_untouched(context):
    answer = "A plain English explanation with no Sanskrit at all."
    cleaned, removed = guard_generated_scripture(answer, context)
    assert not removed
    assert cleaned == answer


# --- Prompt construction --------------------------------------------------


def test_prompt_forbids_generating_verse_text(context):
    messages = dict(build_prompt("What is karma yoga?", context))
    system = messages["system"]
    assert "Never write, translate, complete or alter Sanskrit verse text" in system
    assert "ONLY from the passages in the CONTEXT block" in system


def test_prompt_carries_every_retrieved_reference(context):
    _, user = build_prompt("What is karma yoga?", context)[1]
    assert "[2.47]" in user
    assert "[3.35]" in user
    assert "What is karma yoga?" in user


def test_anchor_verse_is_named_in_the_prompt(context):
    _, user = build_prompt("Explain this", context, anchor_ref="2.47")[1]
    assert "currently looking at verse 2.47" in user


@pytest.mark.parametrize(
    "mode", ["simple", "deep", "beginner", "sources_only", "compare_interpretations"]
)
def test_each_mode_changes_the_instruction(mode, context):
    context.mode = mode
    system = dict(build_prompt("q", context))["system"]
    assert len(system) > len("x")
    default_context = GroundedContext(passages=context.passages, mode="default")
    assert system != dict(build_prompt("q", default_context))["system"]


@pytest.mark.parametrize(
    "language,marker", [("hi", "हिन्दी"), ("hi-Latn", "Hinglish"), ("en", "English")]
)
def test_answer_language_is_requested_explicitly(language, marker, context):
    context.language = language
    system = dict(build_prompt("q", context))["system"]
    assert marker in system


# --- Providers ------------------------------------------------------------


def test_unknown_provider_falls_back_to_the_offline_one():
    # The API must start even when AI_PROVIDER is nonsense — it degrades to
    # "cannot answer confidently" rather than failing to boot.
    assert create_provider("not-a-real-provider").name == "echo"
    assert create_provider("").name == "echo"


@pytest.mark.parametrize(
    "name,expected",
    [
        ("openai", "openai"),
        ("anthropic", "anthropic"),
        ("gemini", "gemini"),
        ("groq", "groq"),
        ("openrouter", "openrouter"),
        ("ollama", "ollama"),
    ],
)
def test_every_documented_provider_can_be_constructed(name, expected):
    provider = create_provider(name, api_key="test-key", model="test-model")
    assert provider.name == expected
    assert provider.model == "test-model"


def test_offline_provider_refuses_without_context():
    provider = EchoProvider()
    result = provider.generate(
        GenerationRequest(messages=[Message("user", "CONTEXT:\n<<<\n>>>\nQUESTION: anything")])
    )
    assert "could not find enough" in result.text.lower()


def test_offline_provider_only_cites_supplied_references():
    provider = EchoProvider()
    result = provider.generate(
        GenerationRequest(
            messages=[Message("user", "CONTEXT: [2.47] karma\n>>>\nQUESTION: what is duty?")]
        )
    )
    assert extract_refs(result.text) == ["2.47"]


@pytest.mark.parametrize("language", ["en", "hi", "hi-Latn"])
def test_refusal_message_exists_in_every_supported_language(language):
    message = insufficient_evidence_answer(language)
    assert message
    assert message != insufficient_evidence_answer("xx") or language == "en"
