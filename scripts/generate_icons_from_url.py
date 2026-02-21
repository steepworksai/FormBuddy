from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Tuple

import requests
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "icons"


@dataclass(frozen=True)
class IconSpec:
    size: int
    filename: str


SPECS = [
    IconSpec(512, "icon512.png"),
    IconSpec(128, "icon128.png"),
    IconSpec(48, "icon48.png"),
    IconSpec(16, "icon16.png"),
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


def fetch_image(url: str) -> Image.Image:
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    img = Image.open(BytesIO(r.content))
    return img.convert("RGBA")


def main() -> None:
    # Source URL can be edited when you want to refresh the artwork.
    url = "https://lh3.googleusercontent.com/gg/AMW1TPoI3at3SyYSbbzqti8oSykqdQpI1rwR9mY3s3R1sIwdEKqQZ4p62dZc_ue_PSGonfRdZaWK0x6ijm1zcUd9Nw50iTWBljNmYiYnDDVGsG_mtx4Ol-d-7BsX6Zx_SJBdmea_KbYxyUCvhvImRfq0nWQgGzWWQ5QZIO84Pg3CnvgYI10b13A0=s1024-rj"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    src = fetch_image(url)
    src = center_crop_square(src)

    # Keep a local copy for future edits/debug.
    src_path = OUT_DIR / "source.png"
    src.save(src_path, format="PNG", optimize=True)

    for spec in SPECS:
        img = src.resize((spec.size, spec.size), resample=Image.Resampling.LANCZOS)
        # Apply rounded corners for Chrome toolbar friendliness.
        r = max(2, int(spec.size * 0.16))
        img.putalpha(rounded_alpha_mask(spec.size, r))
        img.save(OUT_DIR / spec.filename, format="PNG", optimize=True)

    print(f"Wrote icons to {OUT_DIR} (source saved at {src_path})")


if __name__ == "__main__":
    main()

