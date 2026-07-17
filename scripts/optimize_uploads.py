from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
UPLOADS_DIR = ROOT / "assets" / "uploads"
SUPPORTED = {".jpg", ".jpeg", ".png", ".webp"}
MAX_PIXELS = 2400
JPEG_QUALITY = 82
WEBP_QUALITY = 80


def optimize_image(path: Path) -> bool:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED or not path.is_file():
        return False

    original_bytes = path.read_bytes()
    original_size = len(original_bytes)

    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

        if max(image.size) > MAX_PIXELS:
            image.thumbnail((MAX_PIXELS, MAX_PIXELS), Image.Resampling.LANCZOS)

        output = BytesIO()
        save_kwargs: dict[str, object]

        if suffix in {".jpg", ".jpeg"}:
            if image.mode != "RGB":
                image = image.convert("RGB")
            save_kwargs = {
                "format": "JPEG",
                "quality": JPEG_QUALITY,
                "optimize": True,
                "progressive": True,
            }
        elif suffix == ".png":
            save_kwargs = {
                "format": "PNG",
                "optimize": True,
                "compress_level": 9,
            }
        else:
            save_kwargs = {
                "format": "WEBP",
                "quality": WEBP_QUALITY,
                "method": 6,
            }

        image.save(output, **save_kwargs)

    optimized_bytes = output.getvalue()
    if len(optimized_bytes) >= original_size:
        return False

    path.write_bytes(optimized_bytes)
    return True


def main() -> None:
    if not UPLOADS_DIR.exists():
        print("No uploads directory found.")
        return

    changed = 0
    for path in sorted(UPLOADS_DIR.rglob("*")):
        if optimize_image(path):
            changed += 1
            print(f"optimized {path.relative_to(ROOT)}")

    print(f"optimized_files={changed}")


if __name__ == "__main__":
    main()
