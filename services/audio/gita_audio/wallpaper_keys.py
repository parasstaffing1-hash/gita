"""R2 object-key conventions for wallpapers.

Three derivatives per image, because the picker must never pull a 4K file:

    wallpapers/full/<slug>-<digest>.jpg      the original, up to 4K
    wallpapers/preview/<slug>-<digest>.webp  1440 on the long edge, for the composer
    wallpapers/thumb/<slug>-<digest>.webp     480 on the long edge, for the grid

`digest` is the first twelve hex characters of the source image's SHA-256, and
it is what makes a key immutable: the bytes at a given key never change.

That matters because a wallpaper carries a review. Keying on the slug alone
meant re-importing a changed file replaced the object *at the URL readers
already held*, and did it before the catalogue row was moved back to `review` —
so an image nobody had approved was already being served, out of CDN and
browser caches that had no reason to revalidate. The database protection was
real and the object store had none.

With the digest in the key, a replacement is a new object. The old one keeps
serving whatever was approved until someone deletes it deliberately, and the
new bytes are only reachable through a row that has been sent back for review.

A slug can still be recovered from a key for reconciling a bucket listing
against the catalogue; only the exact URL is now content-dependent.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

# The digest is optional so a bucket listing can be reconciled against a
# catalogue that still holds keys written before keys carried one. A slug may
# itself end in digits, so the digest is only read as such when it is exactly
# twelve hex characters - `night-mountains-3` keeps its 3.
_KEY = re.compile(
    r"^wallpapers/(?P<variant>full|preview|thumb)/"
    r"(?P<slug>[a-z0-9-]+?)(?:-(?P<digest>[0-9a-f]{12}))?\.(?P<ext>\w+)$"
)

# Long-edge pixel budgets. `preview` is sized so that a phone-format composer
# canvas (1080 wide) is served at 1:1 or better without fetching the original.
PREVIEW_LONG_EDGE = 1440
THUMB_LONG_EDGE = 480

# Twelve hex characters is 48 bits. A library of a million images has odds of a
# collision around one in six hundred thousand, and a collision would only mean
# two identical-looking URLs for images that also share a slug - which the
# importer already refuses.
DIGEST_CHARS = 12


def short_digest(digest: str) -> str:
    """The key fragment for a full SHA-256 hex digest."""
    return digest[:DIGEST_CHARS]


def digest_file(path: Path | str) -> str:
    """SHA-256 of a file, read in chunks so a 4K original is not held in memory."""
    hasher = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def full_key(slug: str, digest: str, ext: str = "jpg") -> str:
    return f"wallpapers/full/{slug}-{short_digest(digest)}.{ext}"


def preview_key(slug: str, digest: str, ext: str = "webp") -> str:
    return f"wallpapers/preview/{slug}-{short_digest(digest)}.{ext}"


def thumb_key(slug: str, digest: str, ext: str = "webp") -> str:
    return f"wallpapers/thumb/{slug}-{short_digest(digest)}.{ext}"


def parse_wallpaper_key(key: str) -> dict[str, str] | None:
    match = _KEY.match(key)
    if not match:
        return None
    return {
        "variant": match.group("variant"),
        "slug": match.group("slug"),
        "digest": match.group("digest") or "",
        "ext": match.group("ext"),
    }
