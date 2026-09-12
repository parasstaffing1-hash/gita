"""All ORM models.

Imported for their side effect of registering with the declarative metadata,
so `Base.metadata` is complete for Alembic and for `create_all` in tests.
"""

from gita_api.db.models.admin import AdminUser, ContentChangeLog, ContentReview
from gita_api.db.models.ai import AiAnswer, AiAnswerSource, AiQuery
from gita_api.db.models.audio import AudioDownload, AudioTrack
from gita_api.db.models.content import (
    Chapter,
    Commentary,
    Commentator,
    ContentLicense,
    ContentSource,
    GlossaryTerm,
    Language,
    SanskritTerm,
    Translation,
    TransliterationVersion,
    Verse,
    VerseTextVersion,
    VerseWord,
)
from gita_api.db.models.discovery import RelatedVerse, Topic, VerseTopic
from gita_api.db.models.plans import (
    DailyVerse,
    ReadingPlan,
    ReadingPlanDay,
    UserPlanProgress,
)
from gita_api.db.models.search import Embedding, SearchDocument
from gita_api.db.models.wallpapers import Wallpaper
from gita_api.db.models.user import (
    Bookmark,
    Collection,
    CollectionItem,
    Highlight,
    MemorizationProgress,
    Note,
    NotificationPreferences,
    Profile,
    ReadingProgress,
    ReadingSession,
    User,
)

__all__ = [
    "AdminUser",
    "AiAnswer",
    "AiAnswerSource",
    "AiQuery",
    "AudioDownload",
    "AudioTrack",
    "Bookmark",
    "Chapter",
    "Collection",
    "CollectionItem",
    "Commentary",
    "Commentator",
    "ContentChangeLog",
    "ContentLicense",
    "ContentReview",
    "ContentSource",
    "DailyVerse",
    "Embedding",
    "GlossaryTerm",
    "Highlight",
    "Language",
    "MemorizationProgress",
    "Note",
    "NotificationPreferences",
    "Profile",
    "ReadingPlan",
    "ReadingPlanDay",
    "ReadingProgress",
    "ReadingSession",
    "RelatedVerse",
    "SanskritTerm",
    "SearchDocument",
    "Topic",
    "Translation",
    "TransliterationVersion",
    "User",
    "UserPlanProgress",
    "Verse",
    "VerseTextVersion",
    "VerseTopic",
    "VerseWord",
    "Wallpaper",
]
