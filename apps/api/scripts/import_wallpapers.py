"""Bulk-import wallpapers for the quote maker.

    python -m scripts.import_wallpapers ../../wallpapers --manifest ../../wallpapers/manifest.json
    python -m scripts.import_wallpapers ../../wallpapers --manifest ... --dry-run
    python -m scripts.import_wallpapers ../../wallpapers --manifest ... --no-upload

Designed for a thousand-image run:

  * Resumable. An image whose checksum already matches a catalogue row is
    skipped, so re-running after an interruption costs a hash per file.
  * Per-image failure. A corrupt file is reported and the batch continues.
  * Local-first. `--no-upload` writes derivatives and catalogue rows without
    touching R2, so the pipeline can be exercised before credentials exist.

Every image needs a licence. There is no flag to bypass that.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from gita_audio.wallpaper_keys import full_key, preview_key, thumb_key
from gita_ingestion.wallpapers import (
    MIN_LONG_EDGE,
    WallpaperReport,
    analyse_image,
    build_derivatives,
    checksum,
    discover_images,
    load_manifest,
    slugify_filename,
)
from sqlalchemy import text

from gita_api.db.models.wallpapers import WALLPAPER_MOODS
from gita_api.db.session import session_scope
from gita_api.services.media import upload_bytes

logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")
logger = logging.getLogger("wallpapers")

MIME_BY_SUFFIX = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def ensure_license(db, block: dict) -> str:
    """Upsert the licence the manifest declares and return its id."""
    return db.execute(
        text(
            """
            INSERT INTO content_licenses
                (id, code, name, url, redistributable, requires_attribution,
                 commercial_use_allowed, notes, created_at, updated_at)
            VALUES (gen_random_uuid(), :code, :name, :url, :redistributable,
                    :attribution, :commercial, :notes, now(), now())
            ON CONFLICT (code) DO UPDATE SET
                name = EXCLUDED.name,
                url = EXCLUDED.url,
                redistributable = EXCLUDED.redistributable,
                requires_attribution = EXCLUDED.requires_attribution,
                commercial_use_allowed = EXCLUDED.commercial_use_allowed,
                updated_at = now()
            RETURNING id::text
            """
        ),
        {
            "code": block["code"],
            "name": block.get("name", block["code"]),
            "url": block.get("url"),
            "redistributable": bool(block.get("redistributable", False)),
            "attribution": bool(block.get("requiresAttribution", True)),
            "commercial": bool(block.get("commercialUseAllowed", False)),
            "notes": block.get("notes"),
        },
    ).scalar_one()


def existing_row(db, slug: str) -> tuple[str, str] | None:
    """The checksum and review status of a slug already in the catalogue."""
    return db.execute(
        text("SELECT checksum_sha256, verification_status FROM wallpapers WHERE slug = :slug"),
        {"slug": slug},
    ).first()


# Statuses that mean a person looked at this image and said yes.
REVIEWED = ("verified", "published")


def main() -> int:
    parser = argparse.ArgumentParser(description="Import wallpapers")
    parser.add_argument("directory", type=Path, help="Directory of source images")
    parser.add_argument("--manifest", type=Path, required=True, help="Licensing manifest JSON")
    parser.add_argument("--derivatives", type=Path, default=None, help="Where to write preview/thumb")
    parser.add_argument("--dry-run", action="store_true", help="Analyse and report, write nothing")
    parser.add_argument("--no-upload", action="store_true", help="Skip R2; still write the catalogue")
    parser.add_argument("--limit", type=int, default=None, help="Stop after N images")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=25,
        help="Commit every N images so an interrupted run keeps its progress (0 = one transaction)",
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help="Deactivate catalogue rows whose image is not in this run",
    )
    args = parser.parse_args()

    if not args.directory.is_dir():
        logger.error("%s is not a directory", args.directory)
        return 2

    try:
        manifest = load_manifest(args.manifest)
    except (OSError, ValueError) as exc:
        logger.error("%s", exc)
        return 2

    try:
        import PIL  # noqa: F401
    except ImportError:
        logger.error(
            "Pillow is required to import wallpapers (it measures the image so the "
            "composer can place type). Install it with: pip install Pillow"
        )
        return 2

    images = discover_images(args.directory)
    if args.limit:
        images = images[: args.limit]
    if not images:
        logger.error("No images found under %s", args.directory)
        return 2

    derivatives_dir = args.derivatives or (args.directory / "_derivatives")
    entries = manifest.get("images", {})
    defaults = manifest.get("defaults", {})
    report = WallpaperReport()

    # Every row and all three R2 keys are derived from the slug, and
    # `slugify_filename` is lossy: it flattens the directory a file sits in and
    # truncates to the 32-char slug column. So `nature/dawn.jpg` and
    # `temples/dawn.jpg`, or two stock names sharing a long prefix, claim the
    # same slug - and the second would overwrite the first in storage and in the
    # catalogue with both counted as imported, losing a photograph silently.
    # The first file to claim a slug keeps it and the rest are failed by name,
    # because the fix is for a person to rename one of them: a suffix invented
    # here would end up inside shared links pointing at the wrong picture.
    claimed: dict[str, Path] = {}

    with session_scope() as db:
        license_id = ensure_license(db, manifest["license"])
        logger.info("Licence %s -> %s", manifest["license"]["code"], license_id)

        for index, path in enumerate(images, start=1):
            report.scanned += 1
            slug = slugify_filename(path.stem)
            entry = {**defaults, **entries.get(path.name, {})}

            # Reported relative to the scanned directory: colliding files often
            # share a base name, so `path.name` alone would name them both the
            # same thing and tell the reader nothing about which two to look at.
            relative = path.relative_to(args.directory)
            first_claim = claimed.get(slug)
            if first_claim is not None:
                logger.error(
                    "%s: slug '%s' is already taken by %s - rename one of them",
                    relative, slug, first_claim,
                )
                report.failed += 1
                report.errors.append(
                    f"{relative}: slug '{slug}' collides with {first_claim}; "
                    "rename one of them so each wallpaper has its own slug"
                )
                continue
            claimed[slug] = relative

            # A mood the API does not know about is a tag nobody can filter on:
            # /v1/wallpapers/moods serves the fixed vocabulary, so an invented
            # one would be silently unreachable. Fail the image, not the run.
            unknown = sorted(set(entry.get("moods") or []) - set(WALLPAPER_MOODS))
            if unknown:
                logger.error(
                    "%s: unknown mood(s) %s - allowed: %s",
                    path.name,
                    ", ".join(unknown),
                    ", ".join(WALLPAPER_MOODS),
                )
                report.failed += 1
                continue

            # A savepoint per image, so a failure rolls back that image
            # alone. Without one, the first error aborts the transaction and
            # every image after it fails too - the opposite of isolation.
            try:
                with db.begin_nested():
                    digest = checksum(path)
                    existing = existing_row(db, slug)
                    if existing and existing[0] == digest:
                        report.skipped += 1
                        continue

                    # The file behind this slug has changed. If someone had already
                    # approved the old one, what they approved is not what readers
                    # would now get.
                    replaced_reviewed = bool(existing and existing[1] in REVIEWED)

                    analysis = analyse_image(path)
                    long_edge = max(analysis.width, analysis.height)
                    if long_edge < MIN_LONG_EDGE:
                        # Upscaling to reach "4K" would be a lie told in pixels.
                        report.skipped += 1
                        report.warnings.append(
                            f"{path.name}: {analysis.width}x{analysis.height} is below the "
                            f"{MIN_LONG_EDGE}px long edge required for a 4K wallpaper"
                        )
                        continue

                    if args.dry_run:
                        logger.info(
                            "[%d/%d] %s %sx%s %s zone=%s lum=%.2f %s",
                            index, len(images), slug, analysis.width, analysis.height,
                            analysis.orientation, analysis.text_zone, analysis.luminance,
                            analysis.dominant_color,
                        )
                        report.imported += 1
                        continue

                    # The digest, not the file's timestamp, decides whether the
                    # preview and thumbnail on disk were made from this image:
                    # a restored or checked-out file has new bytes and an old
                    # mtime, and reusing its derivatives would leave the picker
                    # showing the photograph this one replaced.
                    made = build_derivatives(path, derivatives_dir, slug, digest)
                    suffix = path.suffix.lower()
                    keys = {
                        # Keyed on the content, so replacing an image writes a
                        # new object rather than swapping the bytes under a URL
                        # readers and CDNs are already holding. What a reviewer
                        # approved stays exactly where it was approved.
                        "full": full_key(
                            slug, digest, suffix.lstrip(".").replace("jpeg", "jpg")
                        ),
                        "preview": preview_key(slug, digest),
                        "thumb": thumb_key(slug, digest),
                    }

                    if not args.no_upload:
                        uploads = (
                            (keys["full"], path, MIME_BY_SUFFIX.get(suffix, "image/jpeg")),
                            (keys["preview"], made["preview"], "image/webp"),
                            (keys["thumb"], made["thumb"], "image/webp"),
                        )
                        # A catalogue row is a promise that the object is there.
                        # Storage that declined the write - an unconfigured R2 in
                        # production, say - has to fail the image, or the run
                        # ends with a complete-looking library whose files 404.
                        for key, source, content_type in uploads:
                            if not upload_bytes(key, source.read_bytes(), content_type):
                                raise RuntimeError(f"upload failed for {key}")

                    db.execute(
                        text(
                            """
                            INSERT INTO wallpapers
                                (id, slug, title, object_key, preview_key, thumb_key, width, height,
                                 size_bytes, mime_type, checksum_sha256, orientation, luminance,
                                 text_zone, dominant_color, moods, license_id, attribution,
                                 source_url, photographer, verification_status, is_active,
                                 sort_order, use_count, created_at, updated_at)
                            VALUES (gen_random_uuid(), :slug, :title, :object_key, :preview_key,
                                    :thumb_key, :width, :height, :size_bytes, :mime, :checksum,
                                    :orientation, :luminance, :text_zone, :dominant,
                                    CAST(:moods AS varchar[]), CAST(:license_id AS uuid),
                                    :attribution, :source_url, :photographer, 'draft', true,
                                    100, 0, now(), now())
                            ON CONFLICT (slug) DO UPDATE SET
                                title = EXCLUDED.title,
                                object_key = EXCLUDED.object_key,
                                preview_key = EXCLUDED.preview_key,
                                thumb_key = EXCLUDED.thumb_key,
                                width = EXCLUDED.width,
                                height = EXCLUDED.height,
                                size_bytes = EXCLUDED.size_bytes,
                                checksum_sha256 = EXCLUDED.checksum_sha256,
                                orientation = EXCLUDED.orientation,
                                luminance = EXCLUDED.luminance,
                                text_zone = EXCLUDED.text_zone,
                                dominant_color = EXCLUDED.dominant_color,
                                moods = EXCLUDED.moods,
                                license_id = EXCLUDED.license_id,
                                attribution = EXCLUDED.attribution,
                                source_url = EXCLUDED.source_url,
                                photographer = EXCLUDED.photographer,
                                updated_at = now()
                            """
                        ),
                        {
                            "slug": slug,
                            "title": entry.get("title") or path.stem.replace("-", " ").title(),
                            "object_key": keys["full"],
                            "preview_key": keys["preview"],
                            "thumb_key": keys["thumb"],
                            "width": analysis.width,
                            "height": analysis.height,
                            "size_bytes": path.stat().st_size,
                            "mime": MIME_BY_SUFFIX.get(suffix, "image/jpeg"),
                            "checksum": digest,
                            "orientation": analysis.orientation,
                            "luminance": analysis.luminance,
                            "text_zone": analysis.text_zone,
                            "dominant": analysis.dominant_color,
                            "moods": entry.get("moods", []),
                            "license_id": license_id,
                            "attribution": entry.get("attribution"),
                            "source_url": entry.get("sourceUrl"),
                            "photographer": entry.get("photographer"),
                        },
                    )
                    if replaced_reviewed:
                        db.execute(
                            text(
                                """
                                UPDATE wallpapers
                                   SET verification_status = 'review', updated_at = now()
                                 WHERE slug = :slug
                                """
                            ),
                            {"slug": slug},
                        )
                        db.execute(
                            text(
                                """
                                INSERT INTO content_change_log
                                    (id, table_name, record_id, record_ref, action, field_name,
                                     previous_value, new_value, editor_email, reason, review_status)
                                SELECT gen_random_uuid(), 'wallpapers', id, slug, 'update',
                                       'verification_status',
                                       jsonb_build_object(
                                           'verification_status', CAST(:previous AS text)
                                       ),
                                       jsonb_build_object('verification_status', 'review'),
                                       'wallpaper-importer',
                                       'Image file replaced; sent back for review.',
                                       'pending'
                                  FROM wallpapers WHERE slug = :slug
                                """
                            ),
                            {"slug": slug, "previous": existing[1]},
                        )
                        report.warnings.append(
                            f"{path.name}: image changed under a {existing[1]} wallpaper; "
                            "moved back to review"
                        )

                    report.imported += 1

            except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
                report.failed += 1
                report.errors.append(f"{path.name}: {exc}")
                logger.warning("%s failed: %s", path.name, exc)

            # Both of these sit outside the savepoint: committing the outer
            # transaction while a savepoint is open is not something Postgres
            # allows, and the count is only meaningful once the image is done.
            if args.batch_size and not args.dry_run and index % args.batch_size == 0:
                db.commit()

            if index % 25 == 0:
                logger.info("[%d/%d] %s", index, len(images), report.summary())

        if args.prune and not args.limit and report.failed == 0:
            # Regenerating a library renames things. Without this, a slug that
            # no longer exists stays in the picker forever, pointing at an
            # object that was overwritten or never written.
            #
            # Skipped when anything failed: a run that could not read half its
            # images has no business deciding what is missing.
            #
            # Deactivated, not deleted: a wallpaper someone has already put on
            # a card should stop being offered, not start 404ing. `--limit`
            # makes this unsafe by definition, so the two do not combine.
            # Slugs, not file names: a row is keyed by `slugify_filename`, so
            # comparing against the raw stem would deactivate every image whose
            # name is not already a slug - `IMG_2043.JPG` is stored `img-2043`.
            seen = [slugify_filename(path.stem) for path in images]
            pruned = db.execute(
                text(
                    """
                    UPDATE wallpapers
                       SET is_active = false, updated_at = now()
                     WHERE is_active = true
                       AND slug <> ALL(CAST(:seen AS text[]))
                    """
                ),
                {"seen": seen},
            ).rowcount
            if pruned:
                logger.info("Deactivated %d wallpaper(s) no longer in the source set", pruned)

        if args.dry_run:
            db.rollback()

    for warning in report.warnings[:20]:
        logger.warning("%s", warning)
    for error in report.errors[:20]:
        logger.error("%s", error)

    if args.prune and report.failed:
        logger.warning("Skipped --prune: %d image(s) failed, so the source set is unknown.", report.failed)

    logger.info("Done. %s", report.summary())
    if args.no_upload:
        logger.info("R2 upload skipped; catalogue rows point at keys that are not populated yet.")
    logger.info("Wallpapers import as draft. Publish them from the admin panel once reviewed.")
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
