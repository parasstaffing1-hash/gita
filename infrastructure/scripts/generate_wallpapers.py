"""Generate the starter wallpaper set.

A thousand licensed photographs is a procurement job, not a coding one. This
produces a real, usable library in the meantime: original artwork the project
owns outright, drawn in the product's own palette.

That is also a design argument, not just a licensing one. A calm reading
product is better served by restrained grounds — a gradient, a silhouette, a
little grain — than by busy stock photography that fights the Devanagari for
attention. These are meant to be looked *through*, at the verse.

    python infrastructure/scripts/generate_wallpapers.py --out media-src/wallpapers

Each image is 4K, carries a deliberate calm band for type, and is written with
a manifest the importer can read.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PORTRAIT = (2160, 3840)
LANDSCAPE = (3840, 2160)

# Gradient stops, top to bottom, sampled from the product palette rather than
# invented per image — so the library reads as one set.
PALETTES: dict[str, tuple[str, list[str]]] = {
    "dawn": ("dawn", ["#161A34", "#4C3A5E", "#B06A54", "#E6A877"]),
    "dusk": ("dusk", ["#241827", "#5C3648", "#A8553A", "#D98A57"]),
    "night": ("night", ["#05060C", "#0D1428", "#1A2740", "#243352"]),
    "sky": ("sky", ["#16324F", "#2F6890", "#7FB0CC", "#BFD9E6"]),
    "sand": ("texture", ["#2E241B", "#6E5540", "#A98A66", "#D6BE9C"]),
    "forest": ("forest", ["#08150F", "#16301F", "#2F4E33", "#54724A"]),
    "river": ("river", ["#0C1A23", "#1A3A4A", "#3E7288", "#87AFBE"]),
    "ink": ("minimal", ["#08080A", "#131317", "#1F1F25", "#2C2C34"]),
    "saffron": ("flame", ["#210F06", "#5E2C0C", "#A85A18", "#D98A32"]),
    "lotus": ("lotus", ["#241029", "#4E2244", "#8E4763", "#C08194"]),
    "stone": ("temple", ["#1A1713", "#332B22", "#544737", "#7D6A52"]),
    "mist": ("sky", ["#1C2026", "#39424C", "#697682", "#9DA9B3"]),
    # Court colours. Each runs from a deep ground to a warm light, so gold sits
    # in the gradient itself rather than being painted on top of it.
    "royal": ("temple", ["#0B0A1F", "#241C4A", "#5A3F6E", "#C9A227"]),
    "maroon": ("flame", ["#1A0407", "#4A0F16", "#8C2A20", "#D4A24C"]),
    "emerald": ("forest", ["#03120E", "#0C3327", "#1F5C46", "#C2A96B"]),
    "amber": ("flame", ["#180B02", "#4A1F05", "#96500E", "#E8B75C"]),
}

# Each motif is a way of filling the half of the frame the verse does not use.
# `zone` is the third that stays calm, and `mood` is the extra tag the motif
# earns beyond its palette's own - so someone looking for a temple finds one
# whatever colour it is drawn in.
MOTIFS: dict[str, dict[str, str]] = {
    "plain":     {"zone": "bottom", "mood": "minimal"},
    "glow":      {"zone": "bottom", "mood": "sky"},
    "mountains": {"zone": "bottom", "mood": "mountains"},
    "water":     {"zone": "bottom", "mood": "river"},
    "dunes":     {"zone": "bottom", "mood": "texture"},
    "temple":    {"zone": "bottom", "mood": "temple"},
    "ghats":     {"zone": "top",    "mood": "river"},
    "banyan":    {"zone": "bottom", "mood": "forest"},
    "diyas":     {"zone": "bottom", "mood": "flame"},
    "rays":      {"zone": "bottom", "mood": "flame"},
    "clouds":    {"zone": "bottom", "mood": "sky"},
    "birds":     {"zone": "bottom", "mood": "sky"},
    "stars":     {"zone": "bottom", "mood": "night"},
    "lotus":     {"zone": "top",    "mood": "lotus"},
    "arcs":      {"zone": "top",    "mood": "abstract"},
    "chakra":    {"zone": "top",    "mood": "abstract"},
    "mandala":   {"zone": "top",    "mood": "abstract"},
    "feather":   {"zone": "top",    "mood": "abstract"},
    "arch":      {"zone": "middle", "mood": "temple"},
    "ripples":   {"zone": "middle", "mood": "river"},
    # The Gita's own scene, and the objects that name its speakers.
    "chariot":   {"zone": "top",    "mood": "temple"},
    "army":      {"zone": "top",    "mood": "temple"},
    "bow":       {"zone": "top",    "mood": "abstract"},
    "flute":     {"zone": "top",    "mood": "lotus"},
    # Regalia.
    "chhatra":   {"zone": "bottom", "mood": "temple"},
    "torana":    {"zone": "middle", "mood": "temple"},
    "crown":     {"zone": "top",    "mood": "temple"},
}

# Motifs whose composition is driven by the random seed - ridge lines, tree
# shapes, star fields, lamp counts. Re-rolling these produces a genuinely
# different picture.
#
# Everything else (lotus, arcs, chakra, mandala, feather, arch, plain) is fixed
# geometry: a second seed would give the same image with a different filename,
# which is padding, not a library. Those are generated once per palette.
VARIABLE_MOTIFS = frozenset({
    "glow", "mountains", "water", "dunes", "temple", "ghats", "banyan",
    "diyas", "rays", "clouds", "birds", "stars", "ripples",
    "chariot", "army",
})


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.lstrip("#")
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))


@dataclass
class Recipe:
    slug: str
    palette: str
    motif: str
    size: tuple[int, int]
    mood: str
    # Which third stays calm, so the importer's measurement agrees with intent.
    text_zone: str
    # Nth re-roll of the same palette and motif. 1 is the only one for motifs
    # whose composition does not depend on the seed.
    variant: int = 1


def build_gradient(size: tuple[int, int], stops: list[str], flip: bool) -> Image.Image:
    """Render the gradient small and scale it up.

    A vertical gradient has no detail to lose, so painting 270x480 and resizing
    is indistinguishable from painting 4K directly and roughly a hundred times
    faster.
    """
    width, height = size
    small_h = 512
    small = Image.new("RGB", (2, small_h))
    pixels = small.load()

    colors = [hex_to_rgb(s) for s in (reversed(stops) if flip else stops)]
    segments = len(colors) - 1

    for y in range(small_h):
        t = y / (small_h - 1)
        scaled = t * segments
        index = min(int(scaled), segments - 1)
        local = scaled - index
        # Smoothstep, so the bands meet without a visible seam.
        local = local * local * (3 - 2 * local)
        a, b = colors[index], colors[index + 1]
        rgb = tuple(int(a[i] + (b[i] - a[i]) * local) for i in range(3))
        pixels[0, y] = rgb
        pixels[1, y] = rgb

    return small.resize((width, height), Image.BICUBIC)


def add_glow(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A soft light source. Placed away from the calm band so it never sits
    behind the type."""
    width, height = image.size
    radius = int(min(width, height) * rng.uniform(0.22, 0.34))
    cx = int(width * rng.uniform(0.3, 0.7))
    cy = int(height * (0.22 if recipe.text_zone == "bottom" else 0.74))

    glow = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(glow)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=190)
    glow = glow.filter(ImageFilter.GaussianBlur(radius * 0.55))

    tint = Image.new("RGB", (width, height), hex_to_rgb("#F7E3C0"))
    image.paste(Image.blend(image, tint, 0.5), (0, 0), glow)


def add_disc(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A sun or moon. One clean circle; no lens flare, no rays."""
    width, height = image.size
    r = int(min(width, height) * rng.uniform(0.045, 0.075))
    cx = int(width * rng.uniform(0.25, 0.75))
    cy = int(height * (0.2 if recipe.text_zone == "bottom" else 0.78))

    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    color = (250, 233, 205, 210) if recipe.palette in ("dawn", "dusk", "saffron") else (226, 232, 240, 170)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.06))
    image.paste(layer, (0, 0), layer)


def add_mountains(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Layered ridges, back to front, each darker and sharper than the last."""
    width, height = image.size
    base = height * (0.62 if recipe.text_zone == "top" else 0.78)
    layers = 3

    for layer_index in range(layers):
        depth = layer_index / max(1, layers - 1)
        y_base = base + height * 0.07 * layer_index
        amplitude = height * (0.10 - 0.02 * layer_index)

        points = [(0, height)]
        peaks = rng.randint(3, 6)
        step = width / peaks
        for peak in range(peaks + 1):
            x = peak * step
            jitter = rng.uniform(-0.35, 0.35)
            y = y_base - abs(math.sin(peak * 1.7 + layer_index)) * amplitude - amplitude * jitter * 0.5
            points.append((x, y))
        points.append((width, height))

        shade = int(28 + 22 * (1 - depth))
        layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        ImageDraw.Draw(layer).polygon(points, fill=(shade, shade - 4, shade - 8, int(150 + 80 * depth)))
        if layer_index < layers - 1:
            # Aerial perspective: distant ridges are hazier.
            layer = layer.filter(ImageFilter.GaussianBlur(width * 0.002 * (layers - layer_index)))
        image.paste(layer, (0, 0), layer)


def add_water(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A reflective band: the image mirrored, blurred, and streaked."""
    width, height = image.size
    top = int(height * (0.55 if recipe.text_zone == "top" else 0.70))

    # A shoreline first. Without a hard edge the mirrored band just looks like
    # a blurred copy of the sky rather than like water starting somewhere.
    _silhouette(image, [(0, top), (width, top), (width, top + height * 0.006), (0, top + height * 0.006)], 24, 190)

    band = image.crop((0, max(0, top - (height - top)), width, top)).transpose(Image.FLIP_TOP_BOTTOM)
    band = band.filter(ImageFilter.GaussianBlur(width * 0.005))

    # Highlights, not stripes. They cluster near the horizon and thin out
    # toward the viewer, which is how a lit water surface actually falls off -
    # an even spread reads as corduroy.
    streaks = Image.new("L", band.size, 0)
    draw = ImageDraw.Draw(streaks)
    band_h = band.size[1]
    for _ in range(150):
        bias = rng.random() ** 2.2  # crowd the far edge
        y = int(bias * (band_h - 1))
        x0 = rng.randint(-int(width * 0.25), width)
        length = rng.randint(int(width * 0.06), int(width * 0.34))
        draw.line(
            (x0, y, x0 + length, y),
            fill=int(rng.randint(30, 90) * (1 - bias * 0.55)),
            width=max(1, int(width * rng.uniform(0.0006, 0.0020))),
        )
    streaks = streaks.filter(ImageFilter.GaussianBlur(width * 0.005))
    band.paste(Image.new("RGB", band.size, (255, 250, 240)), (0, 0), streaks)

    image.paste(Image.blend(image.crop((0, top, width, height)), band, 0.58), (0, top))


def add_lotus(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A faint geometric bloom. Line work only, held at low opacity — a motif,
    not an illustration."""
    width, height = image.size
    cx = width // 2
    cy = int(height * (0.30 if recipe.text_zone == "bottom" else 0.70))
    radius = int(min(width, height) * 0.30)

    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    petals = 12
    for ring, scale in enumerate((1.0, 0.72, 0.46)):
        r = int(radius * scale)
        offset = (math.pi / petals) * ring
        for petal in range(petals):
            angle = (2 * math.pi / petals) * petal + offset
            px = cx + math.cos(angle) * r * 0.5
            py = cy + math.sin(angle) * r * 0.5
            draw.ellipse(
                (px - r * 0.45, py - r * 0.45, px + r * 0.45, py + r * 0.45),
                outline=(255, 240, 214, 52 - ring * 10),
                width=max(3, int(width * 0.0016)),
            )
    image.paste(layer, (0, 0), layer)


def add_arcs(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Concentric arcs, like the rings of a temple plan."""
    width, height = image.size
    cx = width // 2
    cy = int(height * (0.28 if recipe.text_zone == "bottom" else 0.72))
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for ring in range(7):
        r = int(min(width, height) * (0.10 + ring * 0.055))
        draw.ellipse(
            (cx - r, cy - r, cx + r, cy + r),
            outline=(255, 238, 210, 40),
            width=max(3, int(width * 0.0013)),
        )
    image.paste(layer, (0, 0), layer)


# --- Scenes -----------------------------------------------------------------
#
# Everything below draws in silhouette or in thin line work, never in full
# colour. That is the constraint that keeps a library this size coherent: the
# gradient carries the colour, the motif carries the shape, and the verse still
# reads over both. An illustration that competes with the Devanagari is a
# failure however good it looks on its own.


def _quiet_center(recipe: Recipe, near: float = 0.28, far: float = 0.72) -> float:
    """A y fraction in the busy half, so the motif never lands under the type."""
    return near if recipe.text_zone == "bottom" else far


def _silhouette(image: Image.Image, points, shade: int, alpha: int, blur: float = 0.0) -> None:
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(points, fill=(shade, shade - 3, shade - 7, alpha))
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
    image.paste(layer, (0, 0), layer)


def add_temple(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A skyline of shikharas.

    Each tower is a stack of narrowing tiers topped with a kalasha finial - the
    profile is what makes it read as a temple rather than as hills, so the
    curve of the taper matters more than any detail on it.
    """
    width, height = image.size
    ground = height * (0.60 if recipe.text_zone == "top" else 0.80)
    count = rng.randint(3, 5)

    for index in range(count):
        cx = width * (index + rng.uniform(0.25, 0.75)) / count
        tower_h = height * rng.uniform(0.10, 0.19)
        half = width * rng.uniform(0.045, 0.085)

        points = [(cx - half, ground)]
        tiers = rng.randint(4, 6)
        for tier in range(1, tiers + 1):
            t = tier / tiers
            # Curve inward rather than taper straight: a straight taper reads
            # as a pyramid, the curve reads as a shikhara.
            w = half * (1 - t) ** 0.62
            points.append((cx - w, ground - tower_h * t))
        points.append((cx, ground - tower_h * 1.06))
        for tier in range(tiers, 0, -1):
            t = tier / tiers
            w = half * (1 - t) ** 0.62
            points.append((cx + w, ground - tower_h * t))
        points.append((cx + half, ground))

        _silhouette(image, points, 22, 210)

        # Kalasha: a small pot and spire on the summit.
        finial = Image.new("RGBA", image.size, (0, 0, 0, 0))
        fd = ImageDraw.Draw(finial)
        r = width * 0.006
        top = ground - tower_h * 1.06
        fd.ellipse((cx - r, top - r * 2, cx + r, top), fill=(22, 19, 15, 210))
        fd.line(
            (cx, top - r * 2, cx, top - r * 5),
            fill=(22, 19, 15, 210),
            width=max(2, int(width * 0.0018)),
        )
        image.paste(finial, (0, 0), finial)

    _silhouette(image, [(0, ground), (width, ground), (width, height), (0, height)], 18, 220)


def add_ghats(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """River steps running down to the water, seen straight on."""
    width, height = image.size
    # The far bank sits on the horizon; the steps come down from it toward the
    # viewer, and the water fills whatever is left below.
    bank = height * (0.44 if recipe.text_zone == "top" else 0.66)
    steps = rng.randint(9, 13)
    step_h = height * 0.020

    # A thin far bank on the horizon. Kept to a strip: any thicker and it
    # reads as a wall standing behind the steps.
    far = [(0, bank)]
    for index in range(9):
        far.append((width * index / 8, bank - height * rng.uniform(0.0, 0.018)))
    far += [(width, bank), (width, bank + height * 0.006), (0, bank + height * 0.006)]
    _silhouette(image, far, 26, 200)

    # Then the flight of steps, widening evenly toward the viewer. The even
    # widening is what reads as perspective; anything else reads as a vessel.
    for index in range(steps):
        y = bank + height * 0.006 + index * step_h
        inset = width * 0.22 * (1 - index / steps)
        _silhouette(
            image,
            [(inset, y), (width - inset, y), (width - inset, y + step_h * 0.80), (inset, y + step_h * 0.80)],
            36 - index * 2,
            190,
        )

    # The water below is the sky above, mirrored, so the reflection is honest.
    base = int(bank + height * 0.006 + steps * step_h)
    if base < height - 8:
        mirror = image.crop((0, max(0, base - (height - base)), width, base))
        mirror = mirror.transpose(Image.FLIP_TOP_BOTTOM).filter(
            ImageFilter.GaussianBlur(width * 0.006)
        )
        image.paste(Image.blend(image.crop((0, base, width, height)), mirror, 0.62), (0, base))


def add_banyan(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A spreading tree with aerial roots - the asvattha of 15.1."""
    width, height = image.size
    ground = height * (0.58 if recipe.text_zone == "top" else 0.86)
    cx = width * rng.uniform(0.3, 0.7)
    trunk_w = width * 0.035

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    ink = (20, 17, 13, 215)

    crown_y = ground - height * 0.17
    draw.polygon(
        [
            (cx - trunk_w, ground),
            (cx - trunk_w * 0.5, crown_y),
            (cx + trunk_w * 0.5, crown_y),
            (cx + trunk_w, ground),
        ],
        fill=ink,
    )

    # Canopy as overlapping blobs; a single ellipse reads as a balloon.
    for _ in range(rng.randint(16, 22)):
        # Wide, and domed rather than flat: a banyan spreads, but the crown
        # still falls away at the edges. Blobs of one size in a straight line
        # gave a slab.
        spread = rng.uniform(-1, 1)
        bx = cx + spread * width * 0.36
        edge = 1 - abs(spread)
        by = crown_y - edge * height * 0.075 + rng.uniform(-1, 1) * height * 0.012
        br = width * (0.045 + 0.075 * edge) * rng.uniform(0.8, 1.15)
        draw.ellipse((bx - br, by - br * 0.62, bx + br, by + br * 0.62), fill=ink)

    # Aerial roots: many thin verticals hanging from the canopy, none of them
    # quite reaching the ground. Thin is the whole point - thick ones looked
    # like scribble.
    for _ in range(rng.randint(18, 28)):
        rx = cx + rng.uniform(-1, 1) * width * 0.32
        top = crown_y + rng.uniform(0, height * 0.015)
        length = rng.uniform(0.15, 0.70) * (ground - top)
        draw.line(
            (rx, top, rx + rng.uniform(-width * 0.004, width * 0.004), top + length),
            fill=(20, 17, 13, rng.randint(120, 210)),
            width=max(1, int(width * 0.0011)),
        )

    image.paste(layer, (0, 0), layer)
    _silhouette(image, [(0, ground), (width, ground), (width, height), (0, height)], 17, 215)


def add_diyas(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A row of oil lamps, all of them out of focus."""
    width, height = image.size
    row_y = height * _quiet_center(recipe, 0.34, 0.72)
    lamps = rng.randint(6, 10)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for index in range(lamps):
        # Depth: nearer lamps sit lower and burn larger, which is what turns a
        # row of identical dots into a row of lamps receding.
        depth = abs(math.sin(index * 2.1))
        x = width * (index + 0.5) / lamps + rng.uniform(-1, 1) * width * 0.035
        y = row_y + depth * height * 0.06 + rng.uniform(-1, 1) * height * 0.012
        r = width * (0.020 + 0.030 * depth)
        draw.ellipse((x - r * 0.7, y - r * 1.6, x + r * 0.7, y + r * 1.6), fill=(255, 216, 146, 225))
        # The clay lamp under the flame, barely lit from above.
        draw.ellipse((x - r * 1.5, y + r * 1.2, x + r * 1.5, y + r * 2.4), fill=(120, 74, 40, 170))
    # One blur for the whole row: sharp flames against a soft gradient look
    # pasted on.
    layer = layer.filter(ImageFilter.GaussianBlur(width * 0.006))

    halo = layer.filter(ImageFilter.GaussianBlur(width * 0.03))
    image.paste(halo, (0, 0), halo)
    image.paste(layer, (0, 0), layer)


def add_feather(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """The eye of a peacock feather, drawn as nested ovals and radiating barbs."""
    width, height = image.size
    cx = width * 0.5
    cy = height * _quiet_center(recipe, 0.30, 0.70)
    r = min(width, height) * 0.16

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for scale, alpha in ((1.0, 34), (0.72, 44), (0.46, 58), (0.24, 76)):
        rr = r * scale
        draw.ellipse(
            (cx - rr, cy - rr * 1.25, cx + rr, cy + rr * 1.25),
            outline=(255, 240, 214, alpha),
            width=max(3, int(width * 0.0016)),
        )
    for index in range(120):
        angle = math.pi * 2 * index / 120
        inner = r * 1.15
        outer = inner + r * rng.uniform(0.35, 0.75)
        draw.line(
            (
                cx + math.cos(angle) * inner,
                cy + math.sin(angle) * inner * 1.25,
                cx + math.cos(angle) * outer,
                cy + math.sin(angle) * outer * 1.25,
            ),
            fill=(255, 240, 214, 20),
            width=max(2, int(width * 0.0009)),
        )
    image.paste(layer, (0, 0), layer)


def add_chakra(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A spoked wheel - the chakra, and the wheel of 3.16 that keeps turning."""
    width, height = image.size
    cx = width * 0.5
    cy = height * _quiet_center(recipe, 0.29, 0.71)
    r = min(width, height) * 0.19
    line = max(3, int(width * 0.0018))
    gold = (255, 236, 200, 58)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for scale in (1.0, 0.93, 0.34, 0.12):
        rr = r * scale
        draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=gold, width=line)
    spokes = 24
    for index in range(spokes):
        angle = math.pi * 2 * index / spokes
        draw.line(
            (
                cx + math.cos(angle) * r * 0.12,
                cy + math.sin(angle) * r * 0.12,
                cx + math.cos(angle) * r * 0.93,
                cy + math.sin(angle) * r * 0.93,
            ),
            fill=gold,
            width=line,
        )
    image.paste(layer, (0, 0), layer)


def add_mandala(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Dense concentric geometry, held very faint - a texture, not a subject."""
    width, height = image.size
    cx = width * 0.5
    cy = height * _quiet_center(recipe, 0.30, 0.70)
    r = min(width, height) * 0.30
    line = max(2, int(width * 0.0011))

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for ring in range(6):
        rr = r * (0.24 + ring * 0.152)
        petals = 8 + ring * 4
        draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=(255, 240, 216, 26), width=line)
        for index in range(petals):
            angle = math.pi * 2 * index / petals + ring * 0.2
            px = cx + math.cos(angle) * rr
            py = cy + math.sin(angle) * rr
            pr = rr * math.pi / petals * 0.9
            draw.ellipse((px - pr, py - pr, px + pr, py + pr), outline=(255, 240, 216, 22), width=line)
    image.paste(layer, (0, 0), layer)


def add_stars(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A night sky. Most stars are barely there; a handful carry the picture."""
    width, height = image.size
    start = height * (0.0 if recipe.text_zone == "bottom" else 0.30)
    limit = height * (0.94 if recipe.text_zone == "bottom" else 1.0)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    unit = width / 2160  # every size below is quoted against a 2160px frame

    # A diagonal band of dust across the frame.
    for _ in range(4200):
        t = rng.random()
        bx = width * t
        by = start + (limit - start) * (0.34 + 0.30 * t) + rng.gauss(0, height * 0.035)
        if not (start <= by <= limit):
            continue
        rr = rng.uniform(1.0, 2.4) * unit
        draw.ellipse((bx - rr, by - rr, bx + rr, by + rr), fill=(255, 250, 240, rng.randint(16, 60)))

    for _ in range(700):
        sx = rng.uniform(0, width)
        sy = rng.uniform(start, limit)
        rr = rng.uniform(1.4, 4.0) * unit
        draw.ellipse((sx - rr, sy - rr, sx + rr, sy + rr), fill=(255, 252, 245, rng.randint(55, 175)))

    image.paste(layer.filter(ImageFilter.GaussianBlur(max(0.6, 1.4 * unit))), (0, 0), layer)


def add_birds(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A flight of birds. Two strokes each, fainter and smaller with distance."""
    width, height = image.size
    cy = height * _quiet_center(recipe, 0.24, 0.70)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for _ in range(rng.randint(14, 24)):
        depth = rng.random()
        bx = rng.uniform(width * 0.08, width * 0.92)
        by = cy + rng.gauss(0, height * 0.05) - depth * height * 0.04
        span = width * (0.012 + 0.020 * (1 - depth))
        alpha = int(70 + 120 * (1 - depth))
        stroke = max(2, int(width * 0.0016 * (1 - depth) + 2))
        draw.line((bx - span, by, bx - span * 0.2, by - span * 0.45), fill=(24, 21, 17, alpha), width=stroke)
        draw.line((bx + span, by, bx + span * 0.2, by - span * 0.45), fill=(24, 21, 17, alpha), width=stroke)
    image.paste(layer, (0, 0), layer)


def add_dunes(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Long sand curves. Each crest is a sine, so the ridge stays smooth at 4K."""
    width, height = image.size
    base = height * (0.55 if recipe.text_zone == "top" else 0.74)

    for index in range(4):
        y0 = base + height * 0.065 * index
        amp = height * (0.045 - 0.008 * index)
        phase = rng.uniform(0, math.pi * 2)
        freq = rng.uniform(0.8, 1.8)
        points = [(0, height)]
        for step in range(0, width + 1, max(1, width // 220)):
            t = step / width
            points.append((step, y0 - math.sin(phase + t * math.pi * freq) * amp))
        points.append((width, height))
        _silhouette(image, points, 34 + index * 7, 130 + index * 22)


def add_arch(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A cusped arch framing the calm zone, drawn as a hole in a dark surround -
    so the type sits inside the doorway."""
    width, height = image.size
    top = height * (0.10 if recipe.text_zone == "top" else 0.30)
    bottom = height * (0.62 if recipe.text_zone == "top" else 0.90)
    left, right = width * 0.16, width * 0.84
    span = (right - left) / 2
    cx = width / 2

    mask = Image.new("L", image.size, 255)
    draw = ImageDraw.Draw(mask)
    points = [(left, bottom), (left, top + span)]
    for step in range(0, 181):
        angle = math.radians(180 - step)
        # A scalloped semicircle: the cusping is what makes it read Indian
        # rather than Roman.
        scallop = 1 + 0.055 * math.sin(math.radians(step) * 10)
        points.append(
            (cx + math.cos(angle) * span * scallop, top + span - math.sin(angle) * span * scallop)
        )
    points.append((right, bottom))
    draw.polygon(points, fill=0)
    mask = mask.filter(ImageFilter.GaussianBlur(width * 0.004))

    surround = Image.new("RGB", image.size, (16, 14, 11))
    image.paste(Image.blend(image, surround, 0.74), (0, 0), mask)


def add_rays(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Light spreading from a single point."""
    width, height = image.size
    cx = width * rng.uniform(0.35, 0.65)
    cy = height * _quiet_center(recipe, 0.30, 0.72)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    reach = max(width, height) * 1.4
    count = rng.randint(11, 17)
    for index in range(count):
        angle = math.pi * 2 * index / count + rng.uniform(-0.05, 0.05)
        spread = math.radians(rng.uniform(1.6, 4.5))
        draw.polygon(
            [
                (cx, cy),
                (cx + math.cos(angle - spread) * reach, cy + math.sin(angle - spread) * reach),
                (cx + math.cos(angle + spread) * reach, cy + math.sin(angle + spread) * reach),
            ],
            fill=(255, 240, 208, 30),
        )
    layer = layer.filter(ImageFilter.GaussianBlur(width * 0.012))
    image.paste(layer, (0, 0), layer)
    add_disc(image, recipe, rng)


def add_ripples(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Rings spreading on still water, seen at a shallow angle.

    Flattening the ellipses is the whole trick: perfect circles read as a
    target painted on the surface, squashed ones read as a plane you are
    looking across.
    """
    width, height = image.size
    surface = height * 0.62
    cx = width * rng.uniform(0.35, 0.65)
    cy = surface + height * 0.14

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for ring in range(9):
        rr = width * (0.05 + ring * 0.075)
        flatten = 0.22
        draw.ellipse(
            (cx - rr, cy - rr * flatten, cx + rr, cy + rr * flatten),
            outline=(255, 246, 228, max(8, 62 - ring * 6)),
            width=max(2, int(width * 0.0016)),
        )
    layer = layer.filter(ImageFilter.GaussianBlur(width * 0.0015))
    image.paste(layer, (0, 0), layer)

    _silhouette(image, [(0, surface), (width, surface), (width, surface + height * 0.004), (0, surface + height * 0.004)], 26, 150)


def add_clouds(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Flat cloud bands, blurred hard so they stay atmosphere."""
    width, height = image.size
    top = height * (0.04 if recipe.text_zone == "bottom" else 0.36)
    depth = height * 0.34

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for _ in range(rng.randint(16, 26)):
        by = top + rng.random() * depth
        bx = rng.uniform(-width * 0.1, width * 1.1)
        bw = width * rng.uniform(0.18, 0.46)
        bh = height * rng.uniform(0.012, 0.030)
        draw.ellipse((bx - bw, by - bh, bx + bw, by + bh), fill=(255, 246, 232, rng.randint(24, 52)))
    layer = layer.filter(ImageFilter.GaussianBlur(width * 0.014))
    image.paste(layer, (0, 0), layer)


# --- Mahabharata ------------------------------------------------------------


def add_chariot(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """The rath halted between the armies.

    Drawn from the side and flat black, because that is the shape people know:
    wheel, curved body, a team of horses, a banner. No faces - the two figures
    are posture only, one standing at the reins and one seated with a bow, and
    at this scale posture is what reads anyway.
    """
    width, height = image.size
    # Low. The subject is the sky the chariot stands against; a horizon at mid
    # frame turns the lower half into a black slab and the picture into a
    # letterbox.
    ground = height * (0.72 if recipe.text_zone == "top" else 0.86)
    unit = width * 0.40
    # Roughly centred, with only enough drift to keep the set from looking
    # stamped. Pushed to one edge it reads as a crop rather than a composition.
    left = width * 0.5 - unit * 0.52 + rng.uniform(-1, 1) * width * 0.02

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    ink = (18, 16, 12, 235)
    stroke = max(2, int(width * 0.0026))

    wheel_r = unit * 0.16
    wheel_cx = left + unit * 0.20
    wheel_cy = ground - wheel_r

    # Body: a curved car sitting over the axle, higher at the back than the front.
    body = [
        (left, ground - wheel_r * 0.6),
        (left + unit * 0.06, ground - wheel_r * 2.15),
        (left + unit * 0.34, ground - wheel_r * 2.35),
        (left + unit * 0.44, ground - wheel_r * 1.5),
        (left + unit * 0.44, ground - wheel_r * 0.55),
    ]
    draw.polygon(body, fill=ink)

    # Wheel: rim, hub, spokes. The spokes are what stop it reading as a disc.
    draw.ellipse(
        (wheel_cx - wheel_r, wheel_cy - wheel_r, wheel_cx + wheel_r, wheel_cy + wheel_r),
        outline=ink,
        width=max(3, int(width * 0.0034)),
    )
    for index in range(12):
        angle = math.pi * 2 * index / 12
        draw.line(
            (
                wheel_cx,
                wheel_cy,
                wheel_cx + math.cos(angle) * wheel_r * 0.92,
                wheel_cy + math.sin(angle) * wheel_r * 0.92,
            ),
            fill=ink,
            width=stroke,
        )

    # Yoke pole running forward to the team.
    pole_y = ground - wheel_r * 0.9
    draw.line(
        (left + unit * 0.44, pole_y, left + unit * 0.98, ground - wheel_r * 1.15),
        fill=ink,
        width=max(3, int(width * 0.0030)),
    )

    # Four horses, overlapped so they read as a team rather than a queue.
    for index in range(4):
        offset = index * unit * 0.055
        depth = index / 3
        _horse(
            draw,
            x=left + unit * (0.62 + offset / unit),
            ground=ground - depth * height * 0.004,
            size=unit * (0.30 - depth * 0.012),
            ink=(18, 16, 12, int(235 - depth * 45)),
            stroke=stroke,
        )

    # Two figures. Standing at the reins, and seated behind with a bow.
    _figure(draw, left + unit * 0.34, ground - wheel_r * 2.3, unit * 0.20, ink, stroke, seated=False)
    _figure(draw, left + unit * 0.12, ground - wheel_r * 2.15, unit * 0.19, ink, stroke, seated=True)

    # Banner on a staff above the car - the chariot's standard.
    staff_x = left + unit * 0.05
    staff_top = ground - wheel_r * 4.4
    draw.line((staff_x, ground - wheel_r * 2.0, staff_x, staff_top), fill=ink, width=stroke)
    draw.polygon(
        [
            (staff_x, staff_top),
            (staff_x + unit * 0.13, staff_top + unit * 0.035),
            (staff_x, staff_top + unit * 0.075),
        ],
        fill=ink,
    )

    image.paste(layer, (0, 0), layer)
    _silhouette(image, [(0, ground), (width, ground), (width, height), (0, height)], 17, 220)


def _horse(draw, x: float, ground: float, size: float, ink, stroke: int) -> None:
    """A horse in profile, stylised. Body, arched neck, head, four legs."""
    body_w, body_h = size * 0.62, size * 0.34
    body_y = ground - size * 0.62
    draw.ellipse((x - body_w / 2, body_y - body_h / 2, x + body_w / 2, body_y + body_h / 2), fill=ink)

    # The arched neck is the line that makes it a horse rather than a dog.
    neck = [
        (x + body_w * 0.30, body_y - body_h * 0.30),
        (x + body_w * 0.66, ground - size * 1.02),
        (x + body_w * 0.86, ground - size * 1.02),
        (x + body_w * 0.56, body_y + body_h * 0.10),
    ]
    draw.polygon(neck, fill=ink)
    draw.polygon(
        [
            (x + body_w * 0.64, ground - size * 1.04),
            (x + body_w * 1.02, ground - size * 1.00),
            (x + body_w * 0.96, ground - size * 0.88),
            (x + body_w * 0.62, ground - size * 0.92),
        ],
        fill=ink,
    )

    for offset in (-0.26, -0.10, 0.16, 0.30):
        lx = x + body_w * offset
        draw.line((lx, body_y + body_h * 0.2, lx + size * 0.03, ground), fill=ink, width=max(2, stroke + 1))

    # Tail.
    draw.line(
        (x - body_w * 0.48, body_y - body_h * 0.1, x - body_w * 0.72, ground - size * 0.18),
        fill=ink,
        width=max(2, stroke + 1),
    )


def _figure(draw, x: float, top: float, size: float, ink, stroke: int, seated: bool) -> None:
    """A person, as posture only. No features - at this size none would read,
    and inventing a face for either of these two would be presumptuous."""
    head_r = size * 0.15
    draw.ellipse((x - head_r, top - head_r * 2, x + head_r, top), fill=ink)

    if seated:
        draw.polygon(
            [
                (x - size * 0.16, top),
                (x + size * 0.16, top),
                (x + size * 0.20, top + size * 0.52),
                (x - size * 0.20, top + size * 0.52),
            ],
            fill=ink,
        )
        # A bow held low, unstrung - Arjuna at the moment he sets it down.
        draw.arc(
            (x - size * 0.62, top + size * 0.10, x - size * 0.06, top + size * 0.92),
            start=250,
            end=110,
            fill=ink,
            width=max(2, stroke + 1),
        )
    else:
        draw.polygon(
            [
                (x - size * 0.15, top),
                (x + size * 0.15, top),
                (x + size * 0.19, top + size * 0.78),
                (x - size * 0.19, top + size * 0.78),
            ],
            fill=ink,
        )
        # Arms forward on the reins.
        draw.line(
            (x + size * 0.10, top + size * 0.22, x + size * 0.62, top + size * 0.34),
            fill=ink,
            width=max(2, stroke + 1),
        )


def add_army(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Kurukshetra: two hosts drawn up facing each other.

    Spears and pennants only. A field of raised spear points reads as an army
    at any size, and it keeps the eye on the horizon rather than on any figure.
    """
    width, height = image.size
    ground = height * (0.74 if recipe.text_zone == "top" else 0.86)

    for rank in range(3):
        depth = rank / 2
        base = ground - height * 0.012 * (2 - rank)
        alpha = int(90 + 120 * (1 - depth))
        spear_h = height * (0.055 - 0.012 * depth)
        count = int(26 + rank * 10)

        layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        for index in range(count):
            x = width * (index + rng.uniform(0.2, 0.8)) / count
            lean = rng.uniform(-0.035, 0.035) * spear_h
            top = base - spear_h * rng.uniform(0.85, 1.15)
            draw.line((x, base, x + lean, top), fill=(20, 18, 14, alpha), width=max(1, int(width * 0.0012)))
            # Every few spears carries a pennant, which is what turns a picket
            # fence into a host.
            if index % 5 == 0:
                draw.polygon(
                    [
                        (x + lean, top),
                        (x + lean + width * 0.012, top + height * 0.006),
                        (x + lean, top + height * 0.012),
                    ],
                    fill=(20, 18, 14, alpha),
                )
        if rank < 2:
            layer = layer.filter(ImageFilter.GaussianBlur(width * 0.0012 * (2 - rank)))
        image.paste(layer, (0, 0), layer)

        # No bar under each rank: a hard horizontal edge per row reads as three
        # walls. The spears stand on the one ground line drawn below.

    _silhouette(image, [(0, ground), (width, ground), (width, height), (0, height)], 18, 220)


def add_bow(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """Gandiva drawn.

    Two limbs curving away from a central grip, not one closed arc - a single
    ellipse reads as an almond, and the recurve is the whole silhouette of a
    bow.
    """
    width, height = image.size
    cx = width * 0.52
    cy = height * _quiet_center(recipe, 0.30, 0.70)
    span = min(width, height) * 0.26
    line = max(4, int(width * 0.0026))
    ink = (255, 238, 210, 66)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    def limb(sign: int) -> list[tuple[float, float]]:
        points = []
        for step in range(41):
            t = step / 40
            # Belly bulging forward, then the tip curving back the other way.
            y = cy + sign * span * t
            x = cx + span * (0.42 * math.sin(t * math.pi * 0.92) - 0.30 * t**3)
            points.append((x, y))
        return points

    upper, lower = limb(-1), limb(1)
    draw.line(upper, fill=ink, width=line, joint="curve")
    draw.line(lower, fill=ink, width=line, joint="curve")

    # String from tip to tip, pulled back to the nock.
    tip_up, tip_down = upper[-1], lower[-1]
    nock = (cx - span * 0.46, cy)
    draw.line((*tip_up, *nock), fill=ink, width=max(2, line - 2))
    draw.line((*nock, *tip_down), fill=ink, width=max(2, line - 2))

    # Arrow along the draw, with fletching at the nock end.
    draw.line((nock[0] - span * 0.12, cy, cx + span * 0.62, cy), fill=ink, width=max(2, line - 1))
    for sign in (-1, 1):
        draw.line(
            (nock[0] - span * 0.12, cy, nock[0] + span * 0.06, cy + sign * span * 0.09),
            fill=ink,
            width=max(2, line - 1),
        )
    image.paste(layer, (0, 0), layer)


def add_flute(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A bansuri with a peacock feather standing behind it.

    Krishna named by his two objects rather than by his face. The feather is
    the taller of the two and carries the eye; the flute is what makes it his
    rather than decoration.
    """
    width, height = image.size
    cx = width * 0.5
    cy = height * _quiet_center(recipe, 0.34, 0.68)
    span = min(width, height) * 0.26
    line = max(3, int(width * 0.0020))
    ink = (255, 240, 216, 70)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    # The feather: a long spine, an eye near the top, and barbs down its length.
    fx = cx + span * 0.34
    tip_y = cy - span * 1.05
    root_y = cy + span * 0.75
    draw.line((fx, tip_y, fx - span * 0.06, root_y), fill=ink, width=line)

    eye_y = tip_y + span * 0.30
    for scale, alpha in ((1.0, 44), (0.66, 58), (0.34, 78)):
        rr = span * 0.15 * scale
        draw.ellipse((fx - rr, eye_y - rr * 1.35, fx + rr, eye_y + rr * 1.35),
                     outline=(255, 240, 214, alpha), width=line)

    # Barbs sweep up toward the tip, not straight out. Horizontal barbs are why
    # a drawn feather reads as a fish skeleton.
    for index in range(30):
        t = index / 29
        y = eye_y + span * 0.24 + t * (root_y - eye_y - span * 0.24)
        reach = span * 0.26 * (1 - t * 0.55)
        x = fx - span * 0.06 * t
        for sign in (-1, 1):
            draw.line(
                (x, y, x + sign * reach, y - span * 0.13),
                fill=(255, 240, 214, int(34 * (1 - t * 0.45))),
                width=max(2, line - 1),
            )

    # The flute sits below the feather rather than across it: crossing the
    # spine reads as one object with a stick through it.
    x0, y0 = cx - span * 1.00, cy + span * 1.02
    x1, y1 = cx + span * 0.62, cy + span * 0.72
    thickness = max(7, int(width * 0.0105))
    draw.line((x0, y0, x1, y1), fill=(255, 244, 224, 92), width=thickness)
    # A darker mouth-end band and the finger holes: without these it is a stick.
    for index in range(6):
        t = 0.36 + index * 0.095
        hx, hy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        rr = thickness * 0.26
        draw.ellipse((hx - rr, hy - rr, hx + rr, hy + rr), fill=(70, 52, 34, 150))
    draw.line((x0 + (x1 - x0) * 0.12, y0 + (y1 - y0) * 0.12,
               x0 + (x1 - x0) * 0.18, y0 + (y1 - y0) * 0.18),
              fill=(70, 52, 34, 150), width=thickness)

    image.paste(layer, (0, 0), layer)


# --- Regalia ----------------------------------------------------------------


def add_chhatra(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """The royal parasol.

    Held over a king, a deity or a shrine, and the one object in the set that
    means rank on sight. Three tiers with a finial: a single dome reads as an
    umbrella, and the tiers are what make it a chhatra.
    """
    width, height = image.size
    cx = width * 0.5
    top = height * (0.18 if recipe.text_zone == "bottom" else 0.46)
    span = min(width, height) * 0.30
    line = max(3, int(width * 0.0022))
    gold = (232, 196, 120, 78)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    y = top
    for tier, scale in enumerate((1.0, 0.70, 0.44)):
        half = span * scale
        # Deep enough to dome. A shallow canopy reads as a crossbar, and three
        # crossbars on a pole read as an aerial rather than a parasol.
        depth = span * 0.34 * scale
        # A shallow canopy: sampled cosine rather than an arc, so the eaves
        # flick up at the ends the way a stretched fabric one does.
        canopy = [(cx - half, y)]
        for step in range(41):
            t = step / 40
            x = cx - half + half * 2 * t
            canopy.append((x, y - math.cos((t - 0.5) * math.pi) * depth))
        canopy.append((cx + half, y))
        draw.line(canopy, fill=gold, width=line, joint="curve")

        # Drops hanging from the rim.
        for index in range(9):
            t = (index + 0.5) / 9
            dx = cx - half + half * 2 * t
            drop = span * 0.035 * scale
            draw.line((dx, y, dx, y + drop), fill=(232, 196, 120, 54), width=max(2, line - 1))

        y += span * 0.26 * scale

    # Staff and finial.
    draw.line((cx, top - span * 0.16, cx, top + span * 0.86), fill=gold, width=line)
    rr = span * 0.035
    draw.ellipse((cx - rr, top - span * 0.16 - rr * 2, cx + rr, top - span * 0.16), outline=gold, width=line)
    image.paste(layer, (0, 0), layer)


def add_torana(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A carved gateway, framing the verse the way a doorway frames a shrine.

    Unlike `arch`, which cuts a hole in a dark surround, this is drawn - two
    pillars and a tiered lintel in thin gold, so the photograph behind stays
    visible through the opening.
    """
    width, height = image.size
    line = max(3, int(width * 0.0024))
    gold = (232, 196, 120, 70)

    left, right = width * 0.14, width * 0.86
    base = height * (0.90 if recipe.text_zone == "top" else 0.94)
    top = height * (0.16 if recipe.text_zone == "top" else 0.26)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    for x in (left, right):
        draw.line((x, base, x, top + height * 0.06), fill=gold, width=line)
        # Banded shafts, the way a stone pillar is dressed.
        for index in range(7):
            y = top + height * 0.06 + (base - top - height * 0.06) * (index / 7)
            draw.line((x - width * 0.018, y, x + width * 0.018, y), fill=(232, 196, 120, 44), width=line)
        # Capital and base.
        for y, w in ((top + height * 0.06, 0.030), (base, 0.034)):
            draw.line((x - width * w, y, x + width * w, y), fill=gold, width=line + 1)

    # Lintel: three tiers, each a touch wider than the one above.
    for tier, (dy, over) in enumerate(((0.0, 0.020), (0.026, 0.036), (0.052, 0.052))):
        y = top + height * (0.06 - dy)
        draw.line(
            (left - width * over, y, right + width * over, y),
            fill=(232, 196, 120, 70 - tier * 12),
            width=line,
        )

    # A makara-tail curl at each end of the top tier, which is what makes it a
    # torana rather than a doorframe.
    for sign, x in ((-1, left - width * 0.052), (1, right + width * 0.052)):
        y = top + height * 0.008
        draw.arc(
            (x - width * 0.030, y - height * 0.026, x + width * 0.030, y + height * 0.026),
            start=200 if sign < 0 else 340,
            end=340 if sign < 0 else 200,
            fill=gold,
            width=line,
        )
    image.paste(layer, (0, 0), layer)


def add_crown(image: Image.Image, recipe: Recipe, rng: random.Random) -> None:
    """A mukut, in outline.

    Tiered and tapering to a finial, with a jewelled band - the crown of a
    deity rather than a European circlet. Drawn rather than filled, so it reads
    as an emblem above the verse instead of a solid object in front of it.
    """
    width, height = image.size
    cx = width * 0.5
    cy = height * _quiet_center(recipe, 0.30, 0.70)
    span = min(width, height) * 0.19
    line = max(3, int(width * 0.0024))
    gold = (232, 196, 120, 76)

    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    band_y = cy + span * 0.52
    draw.line((cx - span * 0.72, band_y, cx + span * 0.72, band_y), fill=gold, width=line + 1)
    draw.line(
        (cx - span * 0.66, band_y - span * 0.20, cx + span * 0.66, band_y - span * 0.20),
        fill=gold,
        width=line,
    )
    for index in range(7):
        t = (index + 0.5) / 7
        jx = cx - span * 0.66 + span * 1.32 * t
        rr = span * 0.035
        draw.ellipse((jx - rr, band_y - span * 0.13 - rr, jx + rr, band_y - span * 0.13 + rr),
                     outline=gold, width=max(2, line - 1))

    # The dome: a tapering outline, not a triangle.
    dome = []
    for step in range(41):
        t = step / 40
        x = cx - span * 0.66 + span * 1.32 * t
        lift = math.sin(t * math.pi) ** 0.7
        dome.append((x, band_y - span * 0.20 - lift * span * 0.86))
    draw.line(dome, fill=gold, width=line, joint="curve")

    # Finial and a single upright feather, which is what marks it as Krishna's.
    draw.line((cx, band_y - span * 1.06, cx, band_y - span * 1.42), fill=gold, width=line)
    rr = span * 0.05
    draw.ellipse((cx - rr, band_y - span * 1.42 - rr * 2, cx + rr, band_y - span * 1.42),
                 outline=gold, width=line)
    for scale in (1.0, 0.6):
        er = span * 0.09 * scale
        draw.ellipse(
            (cx - er, band_y - span * 1.70 - er * 1.3, cx + er, band_y - span * 1.70 + er * 1.3),
            outline=(232, 196, 120, 60),
            width=max(2, line - 1),
        )
    image.paste(layer, (0, 0), layer)


def add_grain(image: Image.Image, strength: float = 5.0) -> Image.Image:
    """Fine noise.

    Two reasons, both practical: it breaks up the banding an 8-bit gradient
    shows on a good screen, and it gives the flat colour a printed texture
    instead of a rendered one.
    """
    array = np.asarray(image).astype(np.int16)
    noise = np.random.default_rng(abs(hash(image.size)) % (2**32)).normal(0, strength, array.shape)
    return Image.fromarray(np.clip(array + noise, 0, 255).astype(np.uint8))


def add_vignette(image: Image.Image, amount: float = 0.22) -> Image.Image:
    width, height = image.size
    y, x = np.ogrid[:height, :width]
    cx, cy = width / 2, height / 2
    distance = np.sqrt(((x - cx) / cx) ** 2 + ((y - cy) / cy) ** 2)
    mask = np.clip(1 - amount * np.clip(distance - 0.45, 0, None) / 0.8, 0, 1)
    array = np.asarray(image).astype(np.float32) * mask[..., None]
    return Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))


def render(recipe: Recipe, rng: random.Random) -> Image.Image:
    mood_key, stops = PALETTES[recipe.palette]
    # Flip the ramp when type sits at the top, so the calm band is the light one.
    image = build_gradient(recipe.size, stops, flip=recipe.text_zone == "top")

    # A motif is a short recipe of passes rather than one call, because the
    # good ones are combinations: a temple needs a light source behind it or
    # the silhouette has nothing to sit against.
    passes = {
        "plain":     (),
        "glow":      (add_glow, add_disc),
        "mountains": (add_glow, add_disc, add_mountains),
        "water":     (add_glow, add_water),
        "dunes":     (add_glow, add_disc, add_dunes),
        "temple":    (add_glow, add_disc, add_temple),
        "ghats":     (add_glow, add_ghats),
        "banyan":    (add_glow, add_banyan),
        "diyas":     (add_diyas,),
        "rays":      (add_rays,),
        "clouds":    (add_clouds, add_disc),
        "birds":     (add_glow, add_clouds, add_birds),
        "stars":     (add_stars, add_disc),
        "lotus":     (add_lotus,),
        "arcs":      (add_arcs,),
        "chakra":    (add_chakra,),
        "mandala":   (add_mandala,),
        "feather":   (add_feather,),
        "arch":      (add_glow, add_arch),
        "ripples":   (add_glow, add_ripples),
        "chariot":   (add_glow, add_disc, add_chariot),
        "army":      (add_glow, add_disc, add_army),
        "bow":       (add_bow,),
        "flute":     (add_flute,),
        "chhatra":   (add_glow, add_chhatra),
        "torana":    (add_glow, add_disc, add_torana),
        "crown":     (add_glow, add_crown),
    }[recipe.motif]

    for step in passes:
        step(image, recipe, rng)

    image = add_grain(image)
    return add_vignette(image)


def build_recipes(variants: int = 1) -> list[Recipe]:
    """Every palette crossed with every motif, portrait and landscape.

    The cross product is the point: a reader looking for a night sky and a
    reader looking for a temple should both find one in the colour they want,
    and the composer's mood filter is only useful if each mood has more than a
    couple of entries behind it.

    `variants` re-rolls the motifs whose composition comes from the seed. It
    does not touch the fixed-geometry ones, because a second copy of the same
    drawing is not a second wallpaper.
    """
    recipes: list[Recipe] = []

    def rolls(motif: str) -> int:
        return variants if motif in VARIABLE_MOTIFS else 1

    def name(palette: str, motif: str, variant: int, suffix: str = "") -> str:
        stem = f"{palette}-{motif}{suffix}"
        return stem if variant == 1 else f"{stem}-{variant}"

    for palette, (palette_mood, _) in PALETTES.items():
        for motif, spec in MOTIFS.items():
            for variant in range(1, rolls(motif) + 1):
                recipes.append(
                    Recipe(
                        slug=name(palette, motif, variant),
                        palette=palette,
                        motif=motif,
                        size=PORTRAIT,
                        mood=palette_mood,
                        text_zone=spec["zone"],
                        variant=variant,
                    )
                )

    # Landscape cuts. Not every motif survives the aspect change - a tall
    # shikhara in a 16:9 frame is a smudge on the horizon - so this is the
    # subset that still reads wide.
    wide_motifs = (
        "plain", "glow", "mountains", "water", "dunes", "stars",
        "clouds", "rays", "arcs", "mandala", "ripples", "birds",
        "chariot", "army",
    )
    for palette, (palette_mood, _) in PALETTES.items():
        for motif in wide_motifs:
            for variant in range(1, rolls(motif) + 1):
                recipes.append(
                    Recipe(
                        slug=name(palette, motif, variant, suffix="-wide"),
                        palette=palette,
                        motif=motif,
                        size=LANDSCAPE,
                        mood=palette_mood,
                        text_zone=MOTIFS[motif]["zone"],
                        variant=variant,
                    )
                )

    return recipes


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate starter wallpapers")
    parser.add_argument("--out", type=Path, default=Path("media-src/wallpapers"))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Leave images already on disk alone (resume a long run, or extend a set)",
    )
    parser.add_argument(
        "--variants",
        type=int,
        default=1,
        help="Re-rolls per palette and motif, for the motifs the seed changes",
    )
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    recipes = build_recipes(variants=max(1, args.variants))
    if args.limit:
        recipes = recipes[: args.limit]

    entries: dict[str, dict] = {}
    skipped = 0
    for index, recipe in enumerate(recipes, start=1):
        destination = args.out / f"{recipe.slug}.jpg"

        # The manifest is still written for every recipe, skipped or not: it
        # describes the set on disk, and half a manifest would make the whole
        # directory unimportable.
        if args.skip_existing and destination.exists():
            skipped += 1
        else:
            rng = random.Random(f"{args.seed}:{recipe.slug}")
            render(recipe, rng).save(
                destination, "JPEG", quality=92, optimize=True, progressive=True
            )

        entries[destination.name] = {
            "title": recipe.slug.replace("-wide", "").replace("-", " ").title(),
            "variant": recipe.variant,
            # Two tags: what it is made of, and what it is a picture of.
            "moods": sorted({recipe.mood, MOTIFS[recipe.motif]["mood"]}),
        }
        if not (args.skip_existing and destination.exists()) or index % 50 == 0:
            print(f"[{index}/{len(recipes)}] {destination.name}  {recipe.size[0]}x{recipe.size[1]}", flush=True)

    manifest = {
        "license": {
            "code": "gita-inhouse-artwork",
            "name": "In-house artwork (project owned)",
            "redistributable": True,
            "requiresAttribution": False,
            "commercialUseAllowed": True,
            "notes": (
                "Generated for this project from its own palette. Owned outright, so it "
                "carries no third-party rights. Replace or supplement with licensed "
                "photography as it is cleared."
            ),
        },
        "defaults": {"photographer": None, "sourceUrl": None, "attribution": None},
        "images": entries,
    }
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"\n{len(recipes)} wallpapers written to {args.out}")
    print(f"Manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
