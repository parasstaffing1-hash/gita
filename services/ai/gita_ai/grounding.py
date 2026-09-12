"""Grounding: context assembly, prompts, and the citation validator.

The rule this module enforces: the model may explain, but it may not supply
scripture. Verse text always comes out of the database. Every reference the
model emits is checked against the retrieved context, and anything that does
not match is stripped from the answer and recorded as a rejected citation.

Pipeline position:

    retrieve -> rerank -> [build_context] -> [build_prompt] -> LLM
             -> [validate_citations] -> answer + exact sources
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

GroundingStatus = Literal["grounded", "partially_grounded", "insufficient_evidence"]

# Retrievers whose match is positive evidence that the corpus actually
# contains something on the subject. Each of them can return nothing.
CORROBORATING_RETRIEVERS = frozenset({"reference", "fulltext", "fuzzy", "topic"})

MIN_CONTEXT_PASSAGES = 1
# How strong a corroborated match must be. Deliberately low: a curated topic
# match on a long question dilutes as the query grows, and the corroboration
# requirement is already doing most of the filtering.
MIN_CORROBORATED_RELEVANCE = 0.10
# Semantic similarity on its own is not evidence. Vector search always returns
# its k nearest neighbours, so "who won the World Cup in 1998" comes back with
# confident-looking numbers against a corpus that says nothing about football.
# Semantic alone therefore has to clear a much higher bar.
MIN_SEMANTIC_ONLY_RELEVANCE = 0.55

REF_PATTERN = re.compile(r"\[?\b(\d{1,2})\.(\d{1,3})\b\]?")


@dataclass
class ContextPassage:
    """One retrieved, verified passage offered to the model."""

    ref: str
    verse_id: str
    sanskrit: str | None
    transliteration: str | None
    translation: str | None
    translation_language: str | None
    commentary: str | None
    commentator_name: str | None
    source_name: str | None
    source_url: str | None = None
    license_code: str | None = None
    # Normalised match strength, 0..1.
    score: float = 0.0
    # Which retrievers found this passage. The grounding gate reads this.
    matched_by: list[str] = field(default_factory=list)

    def render(self, *, include_commentary: bool = True) -> str:
        lines = [f"[{self.ref}]"]
        if self.sanskrit:
            lines.append(f"Sanskrit: {self.sanskrit}")
        if self.transliteration:
            lines.append(f"Transliteration: {self.transliteration}")
        if self.translation:
            label = f"Translation ({self.translation_language or 'en'})"
            lines.append(f"{label}: {self.translation}")
        if include_commentary and self.commentary:
            who = self.commentator_name or "Commentary"
            # Commentary can be long; the context budget is finite.
            lines.append(f"{who}: {self.commentary[:1200]}")
        if self.source_name:
            lines.append(f"Source: {self.source_name}")
        return "\n".join(lines)


@dataclass
class GroundedContext:
    passages: list[ContextPassage] = field(default_factory=list)
    language: str = "en"
    mode: str = "default"

    @property
    def refs(self) -> set[str]:
        return {p.ref for p in self.passages}

    @property
    def is_sufficient(self) -> bool:
        """Is there enough here to answer, or should the pipeline decline?

        Answering badly is worse than declining, so this errs towards
        declining. A passage counts when a retriever that can say "no" found
        it; a passage found only by vector similarity counts only if that
        similarity is high.
        """
        if len(self.passages) < MIN_CONTEXT_PASSAGES:
            return False

        corroborated = [
            p.score for p in self.passages if CORROBORATING_RETRIEVERS.intersection(p.matched_by)
        ]
        if max(corroborated, default=0.0) >= MIN_CORROBORATED_RELEVANCE:
            return True

        best = max((p.score for p in self.passages), default=0.0)
        return best >= MIN_SEMANTIC_ONLY_RELEVANCE

    def render(self) -> str:
        include_commentary = self.mode in ("deep", "compare_interpretations", "default")
        return "\n\n---\n\n".join(
            p.render(include_commentary=include_commentary) for p in self.passages
        )


# --- Prompts --------------------------------------------------------------

BASE_SYSTEM_PROMPT = """\
You are a careful study companion for the Bhagavad Gita.

Absolute rules:
1. Answer ONLY from the passages in the CONTEXT block. You have no other source.
2. Never write, translate, complete or alter Sanskrit verse text. The
   application inserts verse text from its own database. If you want to point at
   a verse, cite it as [chapter.verse], for example [2.47].
3. Cite only references that appear in the CONTEXT block. Do not cite a verse
   that is not there, even if you believe it is relevant.
4. If the CONTEXT does not contain enough to answer, say so plainly in one
   short paragraph and stop. Do not fill the gap from memory.
5. Distinguish what the text says from what a commentator concluded. Attribute
   interpretation to the named commentator.
6. Do not give medical, legal, or crisis advice. If someone appears to be in
   distress, gently suggest speaking to someone they trust or a professional.
7. Be calm and plain. No exclamation marks, no flattery, no invented anecdotes.
"""

MODE_INSTRUCTIONS: dict[str, str] = {
    "default": "Write 2-4 short paragraphs. Lead with the direct answer.",
    "simple": (
        "Explain in plain, everyday language. Short sentences. Avoid Sanskrit terms "
        "unless you immediately define them. Aim for 150 words."
    ),
    "deep": (
        "Give a fuller treatment: the direct answer, how the cited verses build on "
        "one another, and what the commentators add. Attribute every interpretive "
        "claim. Aim for 400-600 words."
    ),
    "beginner": (
        "Assume the reader has never opened the Gita. Set the scene in one sentence "
        "before answering. Define every Sanskrit term on first use. Do not assume "
        "any prior knowledge of Hindu philosophy."
    ),
    "sources_only": (
        "Do not interpret. For each cited verse, state in one sentence what it "
        "addresses, and nothing more."
    ),
    "compare_interpretations": (
        "Where the cited commentators differ, lay out each reading separately and "
        "name whose it is. Do not resolve the disagreement or declare a winner."
    ),
}

LANGUAGE_INSTRUCTIONS: dict[str, str] = {
    "en": "Answer in English.",
    "hi": "उत्तर हिन्दी में दें। संस्कृत शब्दों को देवनागरी में ही रखें।",
    "hi-Latn": (
        "Answer in Hinglish — natural conversational Hindi written in Latin script, "
        "the way an Indian friend would explain it. Keep Sanskrit terms in their "
        "usual Latin spelling."
    ),
}


def build_prompt(
    question: str, context: GroundedContext, *, anchor_ref: str | None = None
) -> list[tuple[str, str]]:
    """Return [(role, content)] ready to hand to any provider adapter."""
    mode_note = MODE_INSTRUCTIONS.get(context.mode, MODE_INSTRUCTIONS["default"])
    language_note = LANGUAGE_INSTRUCTIONS.get(context.language, LANGUAGE_INSTRUCTIONS["en"])

    system = f"{BASE_SYSTEM_PROMPT}\n{mode_note}\n{language_note}"

    anchor_note = ""
    if anchor_ref:
        anchor_note = (
            f"\nThe reader is currently looking at verse {anchor_ref}. "
            f"Centre the answer there, and use the other passages as support.\n"
        )

    user = (
        f"CONTEXT (the only material you may use):\n"
        f"<<<\n{context.render()}\n>>>\n"
        f"{anchor_note}\n"
        f"QUESTION: {question}"
    )
    return [("system", system), ("user", user)]


# --- Citation validation --------------------------------------------------


@dataclass
class ValidationResult:
    answer: str
    cited_refs: list[str]
    rejected_refs: list[str]
    grounding_status: GroundingStatus


def extract_refs(text: str) -> list[str]:
    """Every chapter.verse reference the model produced, in order."""
    found: list[str] = []
    for match in REF_PATTERN.finditer(text):
        chapter, verse = int(match.group(1)), int(match.group(2))
        if not (1 <= chapter <= 18):
            continue
        ref = f"{chapter}.{verse}"
        if ref not in found:
            found.append(ref)
    return found


def contains_devanagari(text: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in text)


def validate_citations(
    answer: str, context: GroundedContext, *, strip_unknown: bool = True
) -> ValidationResult:
    """Check the model's references against the retrieved context.

    Anything the model cited that was not in the context is removed from the
    prose and reported. That is the hallucination guard: an unsupported
    reference cannot survive into a rendered citation card.
    """
    allowed = context.refs
    produced = extract_refs(answer)
    cited = [ref for ref in produced if ref in allowed]
    rejected = [ref for ref in produced if ref not in allowed]

    cleaned = answer
    if strip_unknown and rejected:
        for ref in rejected:
            # Remove the bracketed marker and any bare mention, leaving the
            # surrounding sentence readable.
            cleaned = re.sub(rf"\s*\[{re.escape(ref)}\]", "", cleaned)
            cleaned = re.sub(rf"\b(?:BG\s*)?{re.escape(ref)}\b", "that passage", cleaned)
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()

    if not context.is_sufficient or not context.passages:
        status: GroundingStatus = "insufficient_evidence"
    elif rejected or not cited:
        status = "partially_grounded"
    else:
        status = "grounded"

    return ValidationResult(
        answer=cleaned,
        cited_refs=cited,
        rejected_refs=rejected,
        grounding_status=status,
    )


def guard_generated_scripture(answer: str, context: GroundedContext) -> tuple[str, bool]:
    """Strip Devanagari the model produced itself.

    Verse text is rendered by the application from the database. If a model
    emits Devanagari that is not a substring of the supplied context, it was
    generated — and generated scripture is exactly what this product must never
    show. Returns the cleaned answer and whether anything was removed.
    """
    if not contains_devanagari(answer):
        return answer, False

    context_text = context.render()
    lines = answer.splitlines()
    kept: list[str] = []
    removed = False
    for line in lines:
        if contains_devanagari(line):
            stripped = line.strip().strip("।॥ ")
            if stripped and stripped not in context_text:
                removed = True
                continue
        kept.append(line)
    return "\n".join(kept).strip(), removed


INSUFFICIENT_EVIDENCE_ANSWERS: dict[str, str] = {
    "en": (
        "I could not find enough verified material in this library to answer that "
        "with confidence. Rather than guess at what the Gita says, I would rather "
        "tell you that plainly. Try rephrasing the question, or browse the topics "
        "and chapters directly."
    ),
    "hi": (
        "इस प्रश्न का विश्वासपूर्वक उत्तर देने के लिए इस संग्रह में पर्याप्त सत्यापित "
        "सामग्री नहीं मिली। अनुमान लगाने के बजाय यह स्पष्ट कहना उचित है। प्रश्न को "
        "दूसरे शब्दों में पूछें, या विषय और अध्याय सीधे देखें।"
    ),
    "hi-Latn": (
        "Is sawaal ka confidently jawaab dene ke liye is library mein kaafi verified "
        "material nahin mila. Andaaza lagane se behtar hai seedha bata dena. Sawaal "
        "ko thoda alag tarah se poochhein, ya topics aur chapters seedhe dekhein."
    ),
}


def insufficient_evidence_answer(language: str) -> str:
    return INSUFFICIENT_EVIDENCE_ANSWERS.get(language, INSUFFICIENT_EVIDENCE_ANSWERS["en"])


DISCLAIMERS: dict[str, str] = {
    "en": (
        "This explanation is generated from the cited verses and commentaries. "
        "The verse text itself is unmodified and comes from the sources shown."
    ),
    "hi": (
        "यह व्याख्या उद्धृत श्लोकों और भाष्यों से बनाई गई है। श्लोक का पाठ अपरिवर्तित है "
        "और दिखाए गए स्रोतों से लिया गया है।"
    ),
    "hi-Latn": (
        "Yeh explanation cited verses aur commentaries se banaayi gayi hai. Verse ka "
        "text bilkul unmodified hai aur dikhaaye gaye sources se aaya hai."
    ),
}


def disclaimer_for(language: str) -> str:
    return DISCLAIMERS.get(language, DISCLAIMERS["en"])
