"""Import content bundles into the database.

    python -m scripts.import_content ../../content/canonical/chapters.json
    python -m scripts.import_content ../../content --all
    python -m scripts.import_content ../../content --all --dry-run

The import runs in one transaction per bundle. If a bundle produces errors,
nothing from it is committed - a half-imported chapter is worse than no chapter.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from gita_ingestion import BundleError, ContentImporter, load_bundle

from gita_api.db.session import session_scope

logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")
logger = logging.getLogger("import")

# Order matters: sources and chapters must exist before verses reference them,
# and verses before topics and plans point at them.
BUNDLE_ORDER = [
    "canonical/chapters.json",
    "canonical/verses.dev-placeholder.json",
    "canonical/verses.json",
    "canonical/transliteration.json",
    "translations",
    "commentaries",
    "glossary/glossary.json",
    "topics/topics.json",
    "canonical/related-verses.json",
    "canonical/reading-plans.json",
    "canonical/audio.json",
]


def discover(root: Path) -> list[Path]:
    """Collect bundles in dependency order, skipping what does not exist yet."""
    found: list[Path] = []
    for entry in BUNDLE_ORDER:
        path = root / entry
        if path.is_file():
            found.append(path)
        elif path.is_dir():
            found.extend(sorted(path.glob("*.json")))
    return found


def import_one(path: Path, *, editor: str, reason: str, dry_run: bool) -> bool:
    try:
        bundle = load_bundle(path)
    except (BundleError, ValueError) as exc:
        logger.error("%s: %s", path.name, exc)
        return False

    with session_scope() as db:
        importer = ContentImporter(db, editor_email=editor, reason=reason)
        report = importer.run(bundle)

        for warning in report.warnings:
            logger.warning("%s: %s", path.name, warning)
        for error in report.errors:
            logger.error("%s: %s", path.name, error)

        if report.errors:
            db.rollback()
            logger.error("%s: rolled back, nothing imported", path.name)
            return False

        if dry_run:
            db.rollback()
            logger.info("%s (dry run, rolled back) %s", path.name, report.summary())
            return True

        logger.info("%s %s", path.name, report.summary())
        if not report.authoritative:
            logger.info(
                "  ^ bundle is not authoritative: every record imported as draft and "
                "cannot be published until its source is verified"
            )
        if report.changes_logged:
            logger.info("  %d change-log entries written", report.changes_logged)
        return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Gita content bundles")
    parser.add_argument(
        "path", type=Path, help="A bundle file, or the content directory with --all"
    )
    parser.add_argument(
        "--all", action="store_true", help="Import every bundle under the directory"
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate and roll back")
    parser.add_argument("--editor", default="importer@local", help="Recorded in the change log")
    parser.add_argument("--reason", default="Content import", help="Recorded in the change log")
    args = parser.parse_args()

    if args.all:
        if not args.path.is_dir():
            logger.error("--all needs a directory, got %s", args.path)
            return 2
        paths = discover(args.path)
        if not paths:
            logger.error("No bundles found under %s", args.path)
            return 2
    else:
        if not args.path.is_file():
            logger.error("%s is not a file", args.path)
            return 2
        paths = [args.path]

    failures = 0
    for path in paths:
        if not import_one(path, editor=args.editor, reason=args.reason, dry_run=args.dry_run):
            failures += 1

    if failures:
        logger.error("%d of %d bundles failed", failures, len(paths))
        return 1
    logger.info("Imported %d bundle(s)", len(paths))
    logger.info("Next: python -m scripts.reindex_search")
    return 0


if __name__ == "__main__":
    sys.exit(main())
