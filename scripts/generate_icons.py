from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "icons"


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def blend(c1: tuple[int, int, int], c2: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))


def make_base(size: int = 512) -> Image.Image:
    # Background gradient.
    bg1 = (30, 58, 138)   # #1E3A8A
    bg2 = (37, 99, 235)   # #2563EB

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            r, g, b = blend(bg1, bg2, t)
            pixels[x, y] = (r, g, b, 255)

    draw = ImageDraw.Draw(img)

    # Rounded square mask effect by painting corners with background color + alpha.
    # (Cheaper than creating a mask and pasting; good enough for icons.)
    corner_r = int(size * 0.16)
    mask = Image.new("L", (size, size), 0)
    m = ImageDraw.Draw(mask)
    m.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner_r, fill=255)
    img.putalpha(mask)

    # Document shadow.
    doc = [int(size * 0.26), int(size * 0.20), int(size * 0.74), int(size * 0.79)]
    shadow = [doc[0] + int(size * 0.02), doc[1] + int(size * 0.02), doc[2] + int(size * 0.02), doc[3] + int(size * 0.02)]
    draw.rounded_rectangle(shadow, radius=int(size * 0.06), fill=(0, 0, 0, 60))

    # Document.
    draw.rounded_rectangle(doc, radius=int(size * 0.06), fill=(255, 255, 255, 245))

    # Folded corner (top-right).
    fold = int(size * 0.11)
    x2, y1 = doc[2], doc[1]
    fold_poly = [(x2 - fold, y1), (x2, y1), (x2, y1 + fold)]
    draw.polygon(fold_poly, fill=(229, 231, 235, 255))  # #E5E7EB
    draw.line([(x2 - fold, y1), (x2, y1 + fold)], fill=(209, 213, 219, 255), width=int(size * 0.008))  # #D1D5DB

    # Form lines.
    line_color = (156, 163, 175, 255)  # #9CA3AF
    left = doc[0] + int(size * 0.06)
    right = doc[2] - int(size * 0.06)
    y = doc[1] + int(size * 0.20)
    h = int(size * 0.045)
    widths = [0.88, 0.78, 0.72, 0.58]
    for w in widths:
        xr = left + int((right - left) * w)
        draw.line([(left, y), (xr, y)], fill=line_color, width=int(size * 0.014))
        y += h

    # Buddy badge (green circle + check).
    cx = int(size * 0.71)
    cy = int(size * 0.73)
    r = int(size * 0.12)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(34, 197, 94, 255))  # #22C55E
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 220), width=int(size * 0.012))

    # Checkmark.
    w = int(size * 0.02)
    p1 = (cx - int(r * 0.42), cy - int(r * 0.02))
    p2 = (cx - int(r * 0.12), cy + int(r * 0.30))
    p3 = (cx + int(r * 0.50), cy - int(r * 0.34))
    draw.line([p1, p2, p3], fill=(255, 255, 255, 255), width=w, joint="curve")

    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    base = make_base(512)
    (OUT_DIR / "icon512.png").write_bytes(b"")  # touch for deterministic ordering on some filesystems
    base.save(OUT_DIR / "icon512.png", format="PNG", optimize=True)

    for target in (128, 48, 16):
        resized = base.resize((target, target), resample=Image.Resampling.LANCZOS)
        resized.save(OUT_DIR / f"icon{target}.png", format="PNG", optimize=True)

    print(f"Wrote icons to {OUT_DIR}")


if __name__ == "__main__":
    main()

