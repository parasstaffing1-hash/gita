"""Wallpaper ingestion.

Takes a directory of images plus a manifest describing their licensing, and
turns it into catalogue rows, three R2 derivatives per image, and the two
measurements the composer needs to lay type out well.

Built for a bulk run: a thousand 4K photographs is a long job, so it is
resumable, it reports as it goes, and a single bad file is skipped with a
reason rather than aborting the batch.

Nothing is imported without a licence. A photograph whose rights are unclear is
the same problem as a translation whose rights are unclear.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}

# Below this on the long edge an image cannot honestly be offered as a 4K
# wallpaper, so it is rejected rather than upscaled.
MIN_LONG_EDGE = 2160

# How much calmer, in 8-bit grey levels of standard deviation, the quietest band
# has to be than its nearest rival before the measurement is worth acting on.
# Band stddev runs 0..~128; on a flat gradient the three bands land within a
# point or two of each other, and picking a winner there moves the reader's
# verse on the strength of noise. Four levels is about where the difference
# between two bands is something a designer would also see.
ZONE_STDDEV_MARGIN = 4.0


@dataclass
class WallpaperReport:
    scanned: int = 0
    imported: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"scanned={self.scanned} imported={self.imported} updated={self.updated} "
            f"skipped={self.skipped} failed={self.failed}"
        )


def slugify_filename(name: str) -> str:
    """The catalogue handle for a file name.

    Capped at 32 characters because that is the width of the `slug` column, and
    the slug travels inside every shared quote link. The cap means the mapping
    is lossy - two files in different subdirectories, or two stock-photo names
    sharing a long prefix, can produce the same slug - so a caller importing a
    set of files has to check the slugs it produces for collisions.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:32] or "wallpaper"


@dataclass
class ImageAnalysis:
    """What the importer learns by actually looking at the picture."""

    width: int
    height: int
    orientation: str
    dominant_color: str
    # Mean luminance of the region type will occupy, 0..1 - the calmest band,
    # or the whole frame when no band was calmer. Decides light or dark type.
    luminance: float
    # Which third of the frame is quietest, and therefore where a verse reads;
    # "any" when no third was quiet enough for the answer to mean anything.
    text_zone: str


def analyse_image(path: Path) -> ImageAnalysis:
    """Measure the things the composer cannot guess.

    The interesting part is `text_zone`. The frame is split into three
    horizontal bands and each is scored by how much its pixels vary: a band of
    open sky varies little, a band of trees varies a lot. Type goes in the
    calmest band, which is what a designer would do by eye and what stops a
    verse landing on top of the subject.

    A picture need not have a calmest band. A flat gradient or an evenly busy
    texture leaves the three scores within noise of each other, and the honest
    answer there is `any` - the composer keeps whatever layout the reader
    chose rather than being moved by a measurement that means nothing.
    """
    from PIL import Image, ImageStat

    with Image.open(path) as image:
        image = image.convert("RGB")
        width, height = image.size

        # Longer side wins, ties to portrait. Both consumers - the composer's
        # picker and the admin review list - only ever ask for portrait or
        # landscape, so a row recorded as "square" matches neither query: it
        # would import, pass review, and then be invisible for good. Portrait
        # takes the tie because the phone formats are what most cards are made
        # at, and a 1:1 image crops to them with the least loss.
        orientation = "landscape" if width > height else "portrait"

        # Work on a small copy: band statistics do not need 4K, and this keeps
        # a thousand-image run to minutes rather than hours.
        small = image.copy()
        small.thumbnail((320, 320))

        average = ImageStat.Stat(small).mean
        dominant_color = "#%02X%02X%02X" % tuple(int(c) for c in average[:3])

        grey = small.convert("L")
        band_height = max(1, grey.height // 3)
        bands: list[tuple[str, float, float]] = []
        for index, zone in enumerate(("top", "middle", "bottom")):
            box = (0, index * band_height, grey.width, min(grey.height, (index + 1) * band_height))
            band = grey.crop(box)
            stat = ImageStat.Stat(band)
            # stddev is the busyness of the band; mean is its brightness.
            bands.append((zone, stat.stddev[0], stat.mean[0] / 255.0))

        calmest, runner_up, _busiest = sorted(bands, key=lambda item: item[1])
        if runner_up[1] - calmest[1] >= ZONE_STDDEV_MARGIN:
            text_zone = calmest[0]
            luminance = round(calmest[2], 4)
        else:
            # No band earned the verse, so the brightness of one of them is not
            # the number to hand the composer either: with type free to sit
            # anywhere, the whole frame is what it has to read against.
            text_zone = "any"
            luminance = round(ImageStat.Stat(grey).mean[0] / 255.0, 4)

    return ImageAnalysis(
        width=width,
        height=height,
        orientation=orientation,
        dominant_color=dominant_color,
        luminance=luminance,
        text_zone=text_zone,
    )


def build_derivatives(
    path: Path, output_dir: Path, slug: str, source_digest: str | None = None
) -> dict[str, Path]:
    """Write the preview and thumbnail the picker and composer actually load.

    Resampling a 4K image twice is the slowest step in the import, so existing
    derivatives are reused - but only when they were made from exactly these
    bytes. Reuse is keyed on the source's content rather than its timestamp
    because the ways a library is actually updated do not advance mtime: a
    `git checkout`, an `rsync -a`, a `cp -p`, an unzipped archive, a file
    restored from a backup. A make-style rule calls those unchanged and keeps
    serving previews of the photograph that was replaced, so the grid and the
    composer show one picture while the export shows another.

    `source_digest` is the sha256 the importer has already computed. It is
    recorded in `<slug>.sha256` beside the derivatives and compared on the next
    run; anything else - a different digest, no record, a missing derivative -
    is a rebuild. Called without a digest there is nothing to compare against,
    so both derivatives are always rebuilt.
    """
    from PIL import Image

    from gita_audio.wallpaper_keys import PREVIEW_LONG_EDGE, THUMB_LONG_EDGE

    output_dir.mkdir(parents=True, exist_ok=True)
    variants = (("preview", PREVIEW_LONG_EDGE), ("thumb", THUMB_LONG_EDGE))
    made = {variant: output_dir / f"{slug}.{variant}.webp" for variant, _ in variants}
    stamp = output_dir / f"{slug}.sha256"

    if source_digest is not None and all(made[variant].exists() for variant, _ in variants):
        try:
            recorded = stamp.read_text(encoding="utf-8").strip()
        except OSError:
            recorded = ""
        if recorded == source_digest:
            return made

    # The stamp is cleared first: a run killed between the two saves must not
    # leave a digest on disk vouching for derivatives that were never finished.
    stamp.unlink(missing_ok=True)

    with Image.open(path) as image:
        image = image.convert("RGB")
        for variant, long_edge in variants:
            copy = image.copy()
            copy.thumbnail((long_edge, long_edge), Image.LANCZOS)
            # Quality 82 is where WebP stops being distinguishable from the
            # original at these sizes while staying small enough to grid.
            copy.save(made[variant], "WEBP", quality=82, method=5)

    if source_digest is not None:
        stamp.write_text(source_digest, encoding="utf-8")

    return made


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> dict[str, dict[str, Any]]:
    """Read the licensing manifest, keyed by file name.

    Format:

        {
          "license": { "code": "cc0", "name": "...", "redistributable": true },
          "defaults": { "photographer": null, "sourceUrl": null },
          "images": {
            "himalaya-dawn.jpg": {
              "title": "Dawn over the Himalaya",
              "moods": ["dawn", "mountains"],
              "photographer": "...",
              "sourceUrl": "https://...",
              "attribution": "Photo by ..."
            }
          }
        }
    """
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if "license" not in data:
        raise ValueError(
            f"{path} has no `license` block. A wallpaper without a licence cannot be imported."
        )
    return data


def discover_images(root: Path) -> list[Path]:
    """Source images under `root`, ignoring anything the pipeline itself wrote.

    The importer's derivatives land in `_derivatives/` beside the originals and
    are `.webp`, which is also a supported source suffix. Without this rule a
    second run would ingest its own 1440px previews as if they were new
    wallpapers - so any path segment starting with an underscore is treated as
    machine output and skipped.
    """
    return sorted(
        p
        for p in root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in SUPPORTED_SUFFIXES
        and not any(part.startswith("_") for part in p.relative_to(root).parts)
    )
