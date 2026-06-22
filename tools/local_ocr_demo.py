#!/usr/bin/env python3
"""Local OCR demo for learning with ddddocr.

This script is intentionally standalone. It reads a local image path and prints
the recognized text. It is not wired into any login or browser automation flow.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path
from typing import Optional


DEFAULT_EXPECTED_LENGTH = 4


class OcrDemoError(Exception):
    """Raised when the local OCR demo cannot complete."""


def load_ddddocr():
    try:
        import ddddocr  # type: ignore
    except ImportError as exc:
        raise OcrDemoError(
            "ddddocr is not installed. Install it with: python3 -m pip install ddddocr"
        ) from exc
    return ddddocr


def normalize_digits(text: str) -> str:
    return "".join(re.findall(r"\d", text or ""))


def longest_runs(indices: list[int]) -> list[tuple[int, int]]:
    if not indices:
        return []
    runs: list[tuple[int, int]] = []
    start = indices[0]
    previous = indices[0]
    for index in indices[1:]:
        if index == previous + 1:
            previous = index
            continue
        runs.append((start, previous + 1))
        start = index
        previous = index
    runs.append((start, previous + 1))
    return sorted(runs, key=lambda run: run[1] - run[0], reverse=True)


def detect_dark_captcha_crop(image_path: Path) -> Optional[tuple[int, int, int, int]]:
    try:
        from PIL import Image
    except ImportError:
        return None

    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    if width < 30 or height < 20:
        return None

    pixels = image.load()

    def is_dark(x: int, y: int) -> bool:
        red, green, blue = pixels[x, y]
        return (red + green + blue) / 3 < 80

    column_threshold = max(6, int(height * 0.05))
    dark_columns = [
        x for x in range(width)
        if sum(1 for y in range(height) if is_dark(x, y)) >= column_threshold
    ]
    column_runs = [
        run for run in longest_runs(dark_columns)
        if run[1] - run[0] >= max(24, int(width * 0.12))
    ]
    if not column_runs:
        return None

    x1, x2 = column_runs[0]
    crop_width = x2 - x1
    row_threshold = max(6, int(crop_width * 0.20))
    dark_rows = [
        y for y in range(height)
        if sum(1 for x in range(x1, x2) if is_dark(x, y)) >= row_threshold
    ]
    row_runs = [
        run for run in longest_runs(dark_rows)
        if run[1] - run[0] >= max(16, int(height * 0.20))
    ]
    if not row_runs:
        return None

    y1, y2 = row_runs[0]
    padding = 4
    return (
        max(0, x1 - padding),
        max(0, y1 - padding),
        min(width, x2 + padding),
        min(height, y2 + padding),
    )


def read_ocr_image_bytes(image_path: Path) -> tuple[bytes, Optional[tuple[int, int, int, int]]]:
    crop_box = detect_dark_captcha_crop(image_path)
    if not crop_box:
        return image_path.read_bytes(), None

    try:
        from PIL import Image
    except ImportError:
        return image_path.read_bytes(), None

    image = Image.open(image_path).convert("RGB")
    cropped = image.crop(crop_box)
    buffer = io.BytesIO()
    cropped.save(buffer, format="PNG")
    return buffer.getvalue(), crop_box


def recognize_image(
    image_path: Path,
    *,
    digits_only: bool = True,
    expected_length: Optional[int] = DEFAULT_EXPECTED_LENGTH,
) -> dict:
    if not image_path.exists():
        raise OcrDemoError(f"Image not found: {image_path}")
    if not image_path.is_file():
        raise OcrDemoError(f"Image path is not a file: {image_path}")

    ddddocr = load_ddddocr()
    ocr = ddddocr.DdddOcr(show_ad=False)
    image_bytes, crop_box = read_ocr_image_bytes(image_path)
    raw_text = str(ocr.classification(image_bytes) or "").strip()
    code = normalize_digits(raw_text) if digits_only else raw_text
    length_ok = expected_length is None or len(code) == expected_length

    return {
        "image": str(image_path),
        "crop_box": crop_box,
        "raw": raw_text,
        "code": code,
        "digits_only": digits_only,
        "expected_length": expected_length,
        "length_ok": length_ok,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Recognize a local 4-digit image with ddddocr.",
    )
    parser.add_argument("image", help="Path to the local image file.")
    parser.add_argument(
        "--keep-raw",
        action="store_true",
        help="Print raw OCR text instead of filtering to digits.",
    )
    parser.add_argument(
        "--expected-length",
        type=int,
        default=DEFAULT_EXPECTED_LENGTH,
        help="Expected code length. Use 0 to disable length checking.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a JSON result object instead of only the code.",
    )
    parser.add_argument(
        "--allow-short",
        action="store_true",
        help="Exit 0 even when the recognized code length is different.",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    expected_length = None if args.expected_length == 0 else args.expected_length

    try:
        result = recognize_image(
            Path(args.image).expanduser(),
            digits_only=not args.keep_raw,
            expected_length=expected_length,
        )
    except OcrDemoError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result["code"])

    if not args.allow_short and not result["length_ok"]:
        print(
            f"recognized length {len(result['code'])}, expected {expected_length}",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
