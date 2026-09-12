"""One-off setup: languages, and the first admin account.

    python -m scripts.bootstrap
    python -m scripts.bootstrap --admin-email you@example.com

Idempotent: safe to re-run.
"""

from __future__ import annotations

import argparse
import getpass
import logging
import sys

from sqlalchemy import select

from gita_api.db.models import AdminUser, Language
from gita_api.db.session import session_scope
from gita_api.security.auth import hash_password

logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")
logger = logging.getLogger("bootstrap")

LANGUAGES = [
    # code, name, native, script, ui, content, order
    ("sa", "Sanskrit", "संस्कृतम्", "devanagari", False, True, 1),
    ("hi", "Hindi", "हिन्दी", "devanagari", True, True, 2),
    ("en", "English", "English", "latin", True, True, 3),
    # Hinglish: Hindi in Latin script. Always manually authored and marked as
    # such - never presented as canonical scripture.
    ("hi-Latn", "Hinglish", "Hinglish", "latin", False, True, 4),
    # Prepared for, not yet shipped. Rows exist so content can be attached
    # before the UI bundle is ready.
    ("bn", "Bengali", "বাংলা", "bengali", False, False, 10),
    ("mr", "Marathi", "मराठी", "devanagari", False, False, 11),
    ("gu", "Gujarati", "ગુજરાતી", "gujarati", False, False, 12),
    ("ta", "Tamil", "தமிழ்", "tamil", False, False, 13),
    ("te", "Telugu", "తెలుగు", "telugu", False, False, 14),
    ("kn", "Kannada", "ಕನ್ನಡ", "kannada", False, False, 15),
    ("ml", "Malayalam", "മലയാളം", "malayalam", False, False, 16),
    ("pa", "Punjabi", "ਪੰਜਾਬੀ", "gurmukhi", False, False, 17),
    ("or", "Odia", "ଓଡ଼ିଆ", "odia", False, False, 18),
    ("as", "Assamese", "অসমীয়া", "bengali", False, False, 19),
    ("ne", "Nepali", "नेपाली", "devanagari", False, False, 20),
]


def seed_languages(db) -> int:
    created = 0
    for code, name, native, script, ui, content, order in LANGUAGES:
        existing = db.execute(select(Language).where(Language.code == code)).scalar_one_or_none()
        if existing is not None:
            existing.name, existing.native_name = name, native
            existing.script, existing.sort_order = script, order
            existing.is_ui_language, existing.is_content_language = ui, content
            continue
        db.add(
            Language(
                code=code,
                name=name,
                native_name=native,
                script=script,
                direction="ltr",
                is_ui_language=ui,
                is_content_language=content,
                sort_order=order,
            )
        )
        created += 1
    return created


def create_admin(db, email: str, password: str, name: str) -> bool:
    existing = db.execute(select(AdminUser).where(AdminUser.email == email)).scalar_one_or_none()
    if existing is not None:
        logger.info("Admin %s already exists", email)
        return False
    db.add(
        AdminUser(
            email=email,
            display_name=name,
            password_hash=hash_password(password),
            role="admin",
            is_active=True,
        )
    )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap the database")
    parser.add_argument("--admin-email", default=None)
    parser.add_argument("--admin-name", default="Administrator")
    parser.add_argument(
        "--admin-password",
        default=None,
        help="Omit to be prompted. Never pass a real password on a shared shell.",
    )
    args = parser.parse_args()

    with session_scope() as db:
        created = seed_languages(db)
        logger.info("Languages: %d added, %d total", created, len(LANGUAGES))

        if args.admin_email:
            password = args.admin_password or getpass.getpass("Admin password: ")
            if len(password) < 12:
                logger.error("Use at least 12 characters for an admin password.")
                return 2
            if create_admin(db, args.admin_email.lower(), password, args.admin_name):
                logger.info("Created admin %s", args.admin_email)
        else:
            logger.info(
                "No admin created. Pass --admin-email to create one, or use the "
                "ADMIN_API_TOKEN bootstrap token for scripted access."
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
