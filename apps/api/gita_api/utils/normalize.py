"""Query and term normalisation.

Python mirror of packages/shared-utils/src/normalize.ts. This is what makes
"Krishna", "Kṛṣṇa", "Krsna", "Krishn" and "कृष्ण" reach the same rows.

Nothing here ever touches stored canonical text — folding is for matching only.
"""

from __future__ import annotations

import re
import unicodedata

_EXTRA_FOLDS = {
    "ḷ": "l",
    "ḹ": "l",
    "ṝ": "r",
    "ऽ": "",
}

# Applied in order. Longer digraphs first so "sh" is folded before "s".
_TRANSLIT_FOLDS: tuple[tuple[str, str], ...] = (
    ("sh", "s"),
    ("ch", "c"),
    ("kh", "k"),
    ("gh", "g"),
    ("jh", "j"),
    ("th", "t"),
    ("dh", "d"),
    ("ph", "f"),
    ("bh", "b"),
    ("ri", "r"),
    ("ee", "i"),
    ("oo", "u"),
    ("aa", "a"),
    ("w", "v"),
    ("z", "j"),
)

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_LATIN = re.compile(r"[A-Za-z]")
_DOUBLED = re.compile(r"([bcdfgjklmnpqrstvx])\1+")
_NON_WORD = re.compile(r"[^a-z0-9\s]")
_WS = re.compile(r"\s+")
# Word-final schwa, dropped so "karm" and "karma" agree. Guarded to words of
# three characters or more so short words are not reduced to nothing.
_TRAILING_SCHWA = re.compile(r"(?<=[a-z]{2})a\b")

# Devanagari to Latin skeleton. Deliberately coarse: it only needs to put
# "कृष्ण" in the same bucket as "krsna", not to be a real transliterator.
_DEVA_CONSONANTS = {
    "क": "k",
    "ख": "k",
    "ग": "g",
    "घ": "g",
    "ङ": "n",
    "च": "c",
    "छ": "c",
    "ज": "j",
    "झ": "j",
    "ञ": "n",
    "ट": "t",
    "ठ": "t",
    "ड": "d",
    "ढ": "d",
    "ण": "n",
    "त": "t",
    "थ": "t",
    "द": "d",
    "ध": "d",
    "न": "n",
    "प": "p",
    "फ": "f",
    "ब": "b",
    "भ": "b",
    "म": "m",
    "य": "y",
    "र": "r",
    "ल": "l",
    "व": "v",
    "श": "s",
    "ष": "s",
    "स": "s",
    "ह": "h",
}

_DEVA_VOWELS = {
    "अ": "a",
    "आ": "a",
    "इ": "i",
    "ई": "i",
    "उ": "u",
    "ऊ": "u",
    "ऋ": "r",
    "ॠ": "r",
    "ए": "e",
    "ऐ": "ai",
    "ओ": "o",
    "औ": "au",
}

# Dependent vowel signs (matras). Their presence suppresses the inherent "a".
_DEVA_MATRAS = {
    "ा": "a",
    "ि": "i",
    "ी": "i",
    "ु": "u",
    "ू": "u",
    "ृ": "r",
    "ॄ": "r",
    "े": "e",
    "ै": "ai",
    "ो": "o",
    "ौ": "au",
}

_VIRAMA = "्"
_DEVA_SIGNS = {"ं": "m", "ः": "h", "ँ": "m", "़": "", "ऽ": ""}


def devanagari_to_latin_skeleton(value: str) -> str:
    """Rough Devanagari -> Latin folding.

    The one thing it must get right is the inherent vowel: a bare consonant
    carries an "a" unless a virama or a matra follows it. Without that,
    "आत्मन्" folds to "atmn" and never matches "atman".
    """
    out: list[str] = []
    chars = list(value)
    for index, char in enumerate(chars):
        if char in _DEVA_CONSONANTS:
            out.append(_DEVA_CONSONANTS[char])
            following = chars[index + 1] if index + 1 < len(chars) else ""
            if following != _VIRAMA and following not in _DEVA_MATRAS:
                out.append("a")
        elif char in _DEVA_VOWELS:
            out.append(_DEVA_VOWELS[char])
        elif char in _DEVA_MATRAS:
            out.append(_DEVA_MATRAS[char])
        elif char in _DEVA_SIGNS:
            out.append(_DEVA_SIGNS[char])
        elif char == _VIRAMA:
            continue
        elif _DEVANAGARI.match(char):
            continue  # unmapped Devanagari (rare conjunct forms, digits)
        else:
            out.append(char)
    return "".join(out)


def strip_diacritics(value: str) -> str:
    """Kṛṣṇa -> Krsna, ātman -> atman."""
    for src, dst in _EXTRA_FOLDS.items():
        value = value.replace(src, dst)
    decomposed = unicodedata.normalize("NFD", value)
    without_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return unicodedata.normalize("NFC", without_marks)


def transliteration_skeleton(value: str) -> str:
    """Fold a term to the matching skeleton used by `search_key` columns.

    Both the index writer and the query path call this, so any change here
    requires a re-index. The final step drops a word-final "a": Hindi deletes
    the inherent schwa in speech, so people write "karm" as often as "karma",
    and both must reach the same rows.
    """
    text = devanagari_to_latin_skeleton(value)
    text = strip_diacritics(text).lower()
    text = _NON_WORD.sub(" ", text)
    for src, dst in _TRANSLIT_FOLDS:
        text = text.replace(src, dst)
    text = re.sub(r"y\b", "i", text)
    text = _DOUBLED.sub(r"\1", text)
    text = _TRAILING_SCHWA.sub("", text)
    return _WS.sub(" ", text).strip()


def detect_script(value: str) -> str:
    has_deva = bool(_DEVANAGARI.search(value))
    has_latin = bool(_LATIN.search(value))
    if has_deva and has_latin:
        return "mixed"
    if has_deva:
        return "devanagari"
    if has_latin:
        return "latin"
    return "unknown"


HINGLISH_MARKERS = frozenset(
    [
        "ka",
        "ke",
        "ki",
        "ko",
        "se",
        "me",
        "mein",
        "par",
        "hai",
        "hain",
        "ho",
        "hota",
        "hoti",
        "kya",
        "kyu",
        "kyun",
        "kaise",
        "kaisa",
        "nahi",
        "nahin",
        "karna",
        "karne",
        "karo",
        "kar",
        "liye",
        "sath",
        "bina",
        "bhi",
        "aur",
        "lekin",
        "magar",
        "apna",
        "apne",
        "mera",
        "mere",
        "tera",
        "tumhara",
        "hum",
        "humko",
        "mujhe",
        "tumhe",
        "jeevan",
        "zindagi",
        "dar",
        "gussa",
        "dukh",
        "shanti",
        "mann",
        "man",
        "kaam",
        "dharm",
        "karm",
    ]
)


def looks_hinglish(value: str) -> bool:
    """Latin script carrying Hindi function words.

    A routing hint for answer language, not a linguistic claim.
    """
    if detect_script(value) != "latin":
        return False
    words = [w for w in re.split(r"[^a-z]+", value.lower()) if w]
    if not words:
        return False
    hits = sum(1 for w in words if w in HINGLISH_MARKERS)
    return hits / len(words) >= 0.25 or hits >= 2


def detect_query_language(value: str) -> str:
    """Returns 'en', 'hi' or 'hi-Latn'."""
    script = detect_script(value)
    if script in ("devanagari", "mixed"):
        return "hi"
    if looks_hinglish(value):
        return "hi-Latn"
    return "en"


def normalize_query(value: str) -> str:
    return _WS.sub(" ", value).strip()


def slugify(value: str) -> str:
    text = strip_diacritics(devanagari_to_latin_skeleton(value)).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:96]


# Function words carried by questions in English, Hindi and Hinglish. The
# `gita_simple` text search configuration is built on `simple`, which has no
# stopword dictionary, so these have to be removed here or they become
# retrievable terms and every sentence matches every document.
QUESTION_STOPWORDS = frozenset(
    [
        "a",
        "an",
        "the",
        "this",
        "that",
        "these",
        "those",
        "there",
        "here",
        "is",
        "am",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "do",
        "does",
        "did",
        "doing",
        "done",
        "have",
        "has",
        "had",
        "having",
        "will",
        "would",
        "shall",
        "should",
        "can",
        "could",
        "may",
        "might",
        "must",
        "of",
        "in",
        "on",
        "at",
        "to",
        "for",
        "from",
        "by",
        "with",
        "about",
        "into",
        "over",
        "under",
        "between",
        "and",
        "or",
        "but",
        "if",
        "then",
        "than",
        "so",
        "as",
        "such",
        "not",
        "no",
        "nor",
        "too",
        "very",
        "just",
        "only",
        "also",
        "even",
        "what",
        "which",
        "who",
        "whom",
        "whose",
        "when",
        "where",
        "why",
        "how",
        "whats",
        "i",
        "me",
        "my",
        "mine",
        "you",
        "your",
        "yours",
        "he",
        "him",
        "his",
        "she",
        "her",
        "hers",
        "it",
        "its",
        "we",
        "us",
        "our",
        "ours",
        "they",
        "them",
        "their",
        "theirs",
        "one",
        "ones",
        "something",
        "anything",
        "everything",
        "nothing",
        "say",
        "says",
        "said",
        "tell",
        "tells",
        "told",
        "mean",
        "means",
        "meaning",
        "explain",
        "explains",
        "gita",
        "bhagavad",
        "bhagwad",
        "geeta",
        "shloka",
        "verse",
        "chapter",
        "kya",
        "kaise",
        "kaisa",
        "kyu",
        "kyun",
        "hai",
        "hain",
        "ho",
        "hota",
        "hoti",
        "ka",
        "ke",
        "ki",
        "ko",
        "se",
        "me",
        "mein",
        "par",
        "kare",
        "karein",
        "karna",
        "karne",
        "karo",
        "kar",
        "liye",
        "sath",
        "bina",
        "bhi",
        "aur",
        "lekin",
        "magar",
        "mujhe",
        "tumhe",
        "hum",
        "humko",
        "apna",
        "apne",
        "mera",
        "mere",
    ]
)


def content_terms(value: str) -> str:
    """Drop function words, keeping the terms actually worth searching for.

    Returns a space-joined string; empty when the query was nothing but
    function words, in which case the caller should skip full-text entirely.
    """
    words = [w for w in re.split(r"\W+", value.lower(), flags=re.UNICODE) if w]
    kept = [w for w in words if w not in QUESTION_STOPWORDS and len(w) > 1]
    # A query made entirely of stopwords ("what is it?") still deserves its
    # words rather than nothing at all.
    return " ".join(kept or words)
