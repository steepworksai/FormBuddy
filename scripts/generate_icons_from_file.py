from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "icons"


SPECS: list[tuple[int, str]] = [
    (512, "icon512.png"),
    (128, "icon128.png"),
    (48, "icon48.png"),
    (16, "icon16.png"),
]


def center_crop_square(img: Image.Image) -> Image.Image:
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def rounded_alpha_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/generate_icons_from_file.py /path/to/source.png")

    src_path = Path(sys.argv[1]).expanduser().resolve()
    if not src_path.exists():
        raise SystemExit(f"Source image not found: {src_path}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    src = Image.open(src_path).convert("RGBA")
    src = center_crop_square(src)

    # Keep a local copy for future edits/debug.
    out_source = OUT_DIR / "source.png"
    src.save(out_source, format="PNG", optimize=True)

    for size, filename in SPECS:
        img = src.resize((size, size), resample=Image.Resampling.LANCZOS)
        r = max(2, int(size * 0.16))  # matches Chrome-ish rounded corners
        img.putalpha(rounded_alpha_mask(size, r))
        img.save(OUT_DIR / filename, format="PNG", optimize=True)

    print(f"Wrote icons to {OUT_DIR} (source saved at {out_source})")


if __name__ == "__main__":
    main()

