#!/usr/bin/env python3
"""One-off script: generates simple PNG app icons for the PWA manifest
without any image-library dependency (pure stdlib PNG writer).

Draws a flat rounded-square background with a simple flashcard + cloud
glyph. Run manually if the icon design needs to change.
"""
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "icons"

BG = (26, 26, 26)       # --background (dark theme)
ACCENT = (160, 160, 160)  # --primary (dark theme)
CARD = (245, 245, 245)  # --card (light theme)


def rounded_square_mask(size, radius):
    def inside(x, y):
        cx = min(max(x, radius), size - 1 - radius)
        cy = min(max(y, radius), size - 1 - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
    return inside


def draw_icon(size):
    pixels = [[BG for _ in range(size)] for _ in range(size)]
    mask = rounded_square_mask(size, size // 6)

    # Card glyph: a light rounded rectangle roughly centered, with an
    # orange accent bar, evoking a flashcard.
    card_w, card_h = size * 0.62, size * 0.44
    cx0, cy0 = (size - card_w) / 2, (size - card_h) / 2 - size * 0.03
    cx1, cy1 = cx0 + card_w, cy0 + card_h
    card_radius = size * 0.06

    def in_rounded_rect(x, y, x0, y0, x1, y1, r):
        if x0 + r <= x <= x1 - r and y0 <= y <= y1:
            return True
        if y0 + r <= y <= y1 - r and x0 <= x <= x1:
            return True
        for cx, cy in [(x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)]:
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                return True
        return False

    bar_h = card_h * 0.22

    for y in range(size):
        for x in range(size):
            if not mask(x, y):
                continue
            if in_rounded_rect(x, y, cx0, cy0, cx1, cy1, card_radius):
                if y <= cy0 + bar_h:
                    pixels[y][x] = ACCENT
                else:
                    pixels[y][x] = CARD

    return pixels


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # no filter
        for r, g, b in row:
            raw.extend((r, g, b))
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        pixels = draw_icon(size)
        out = OUT_DIR / f"icon-{size}.png"
        write_png(out, pixels)
        print(f"Wrote {out}")


if __name__ == "__main__":
    main()
