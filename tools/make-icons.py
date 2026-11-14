#!/usr/bin/env python3
"""Generate the app icons: an amber metronome dot on the stage-dark background.

Standard library only. Run from the repo root:
    python3 tools/make-icons.py
"""
import os
import struct
import zlib

BG = (0x15, 0x1A, 0x24)     # stage background
AMBER = (0xF4, 0xB5, 0x3F)  # accent / metronome dot

# Dot as a fraction of the icon size. Radius 0.27 keeps it inside the
# "maskable" safe zone (a circle of radius 0.4), so one design works for both.
CX, CY, R = 0.5, 0.5, 0.27

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
SIZES = {
    "icon-32.png": 32,
    "icon-180.png": 180,           # iPad home screen (apple-touch-icon)
    "icon-192.png": 192,
    "icon-512.png": 512,
    "icon-512-maskable.png": 512,  # Android/Chrome adaptive shapes
}


def coverage(px, py, n, ss=4):
    """How much of pixel (px, py) the dot covers, 0..1, using ss x ss samples."""
    cx, cy, r = CX * n, CY * n, R * n
    # Fast path: pixel clearly inside or outside the circle.
    d = ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2) ** 0.5
    if d < r - 1:
        return 1.0
    if d > r + 1:
        return 0.0
    hits = 0
    for i in range(ss):
        for j in range(ss):
            sx = px + (i + 0.5) / ss
            sy = py + (j + 0.5) / ss
            if (sx - cx) ** 2 + (sy - cy) ** 2 <= r * r:
                hits += 1
    return hits / (ss * ss)


def render(n):
    rows = []
    for y in range(n):
        row = bytearray([0])  # PNG filter type 0 for this scanline
        for x in range(n):
            a = coverage(x, y, n)
            row += bytes(round(BG[k] + (AMBER[k] - BG[k]) * a) for k in range(3))
        rows.append(bytes(row))
    return b"".join(rows)


def png(n, raw):
    def chunk(kind, data):
        c = kind + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)  # 8-bit RGB, no alpha
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, n in SIZES.items():
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(png(n, render(n)))
        print(f"wrote icons/{name} ({n}x{n})")


if __name__ == "__main__":
    main()
