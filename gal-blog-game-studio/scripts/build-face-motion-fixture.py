#!/usr/bin/env python3
"""Build the deterministic, no-image-API face-motion MVP fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageStat


@dataclass(frozen=True)
class FaceConfig:
    key: str
    source: Path
    eye_rect: tuple[int, int, int, int]
    eye_boxes: tuple[tuple[int, int, int, int], tuple[int, int, int, int]]
    lid_anchors: tuple[tuple[int, int, int, int, int], tuple[int, int, int, int, int]]
    eye_skin_sample: tuple[int, int]
    mouth_rect: tuple[int, int, int, int]
    mouth_center: tuple[int, int]
    mouth_angle: float


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rect_dict(rect: tuple[int, int, int, int]) -> dict[str, int]:
    x0, y0, x1, y1 = rect
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}


def quadratic_points(x0: int, y0: int, x1: int, y1: int, bend: int, count: int = 28) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    control_x = (x0 + x1) / 2
    control_y = (y0 + y1) / 2 + bend
    for index in range(count):
        t = index / (count - 1)
        mt = 1 - t
        x = mt * mt * x0 + 2 * mt * t * control_x + t * t * x1
        y = mt * mt * y0 + 2 * mt * t * control_y + t * t * y1
        points.append((x, y))
    return points


def ellipse_mask(size: tuple[int, int], inset: int = 0, blur: float = 2) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((inset, inset, size[0] - inset - 1, size[1] - inset - 1), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur))


def skin_color(base: Image.Image, x: int, y: int, radius: int = 5) -> tuple[int, int, int, int]:
    sample = base.crop((x - radius, y - radius, x + radius + 1, y + radius + 1)).convert("RGB")
    mean = ImageStat.Stat(sample).mean
    return (round(mean[0]), round(mean[1]), round(mean[2]), 255)


def skin_fill(base: Image.Image, box: tuple[int, int, int, int], sample: tuple[int, int]) -> Image.Image:
    x0, y0, x1, y1 = box
    width, height = x1 - x0, y1 - y0
    color = skin_color(base, sample[0], sample[1])
    result = Image.new("RGBA", (width, height), color)
    pixels = result.load()
    for y in range(height):
        shift = round((y / max(1, height - 1) - 0.5) * 5)
        for x in range(width):
            pixels[x, y] = (
                max(0, min(255, color[0] + shift)),
                max(0, min(255, color[1] + shift)),
                max(0, min(255, color[2] + shift)),
                255,
            )
    return result.filter(ImageFilter.GaussianBlur(0.7))


def rounded_mask(size: tuple[int, int], blur: float = 2.5) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((1, 1, size[0] - 2, size[1] - 2), radius=max(5, size[1] // 3), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur))


def build_eye_patch(base: Image.Image, config: FaceConfig, state: str) -> Image.Image:
    working = base.copy()
    draw = ImageDraw.Draw(working)
    for box, anchors in zip(config.eye_boxes, config.lid_anchors, strict=True):
        x0, y0, x1, y1 = box
        replacement = skin_fill(base, box, config.eye_skin_sample)
        working.paste(replacement, (x0, y0), rounded_mask((x1 - x0, y1 - y0)))
        ax0, ay0, ax1, ay1, bend = anchors
        if state == "half":
            draw = ImageDraw.Draw(working)
            upper = quadratic_points(ax0, ay0, ax1, ay1, bend - 2)
            lower = [(x, y + 6) for x, y in reversed(upper)]
            draw.polygon([*upper, *lower], fill=(245, 239, 235, 255))
            iris_x = round((ax0 + ax1) / 2)
            iris_y = round((ay0 + ay1) / 2 + bend / 2 + 3)
            draw.ellipse((iris_x - 5, iris_y - 5, iris_x + 5, iris_y + 5), fill=(39, 90, 139, 255))
            draw.line(upper, fill=(67, 48, 58, 255), width=3, joint="curve")
        else:
            draw.line(quadratic_points(ax0, ay0, ax1, ay1, bend), fill=(72, 49, 57, 255), width=3, joint="curve")
    return working.crop(config.eye_rect)


def rotated_mouth_layer(size: tuple[int, int], center: tuple[int, int], aperture: tuple[int, int], angle: float) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy = center
    width, height = aperture
    box = (cx - width // 2, cy - height // 2, cx + width // 2, cy + height // 2)
    draw.ellipse(box, fill=(130, 61, 78, 255), outline=(101, 61, 68, 255), width=1)
    if height >= 12:
        draw.arc((box[0] + 3, box[1] + height // 2, box[2] - 3, box[3] - 2), 15, 165, fill=(219, 118, 130, 230), width=2)
    if angle:
        layer = layer.rotate(angle, resample=Image.Resampling.BICUBIC, center=center)
    return layer


def build_mouth_patch(base: Image.Image, config: FaceConfig, state: str) -> Image.Image:
    x0, y0, x1, y1 = config.mouth_rect
    crop = base.crop(config.mouth_rect)
    if state == "closed":
        return crop
    local_center = (config.mouth_center[0] - x0, config.mouth_center[1] - y0)
    color = skin_color(base, config.mouth_center[0], y0 - 9, radius=5)
    clean = Image.new("RGBA", crop.size, color).filter(ImageFilter.GaussianBlur(0.7))
    result = crop.copy()
    mouth_mask = Image.new("L", crop.size, 0)
    md = ImageDraw.Draw(mouth_mask)
    radius_x = 17 if state == "open" else 15
    radius_y = 10 if state == "open" else 8
    md.ellipse((local_center[0] - radius_x, local_center[1] - radius_y, local_center[0] + radius_x, local_center[1] + radius_y), fill=255)
    mouth_mask = mouth_mask.filter(ImageFilter.GaussianBlur(2.0))
    result.paste(clean, (0, 0), mouth_mask)
    aperture = (20, 9) if state == "open" else (18, 5)
    result.alpha_composite(rotated_mouth_layer(result.size, local_center, aperture, config.mouth_angle))
    return result


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def build_expression(config: FaceConfig, output: Path) -> dict:
    base = Image.open(config.source).convert("RGBA")
    base.load()
    if base.size != (1024, 1536):
        raise SystemExit(f"{config.source} 必须是 1024x1536 RGBA PNG")
    base_path = output / "expressions" / f"{config.key}-base.png"
    save_png(base, base_path)

    parts: dict[str, Path] = {}
    for state in ("open", "half", "closed"):
        target = output / "parts" / f"{config.key}-eye-{state}.png"
        image = base.crop(config.eye_rect) if state == "open" else build_eye_patch(base, config, state)
        save_png(image, target)
        parts[f"eye-{state}"] = target
    for state in ("closed", "half", "open"):
        target = output / "parts" / f"{config.key}-mouth-{state}.png"
        save_png(build_mouth_patch(base, config, state), target)
        parts[f"mouth-{state}"] = target

    eye_rect = rect_dict(config.eye_rect)
    mouth_rect = rect_dict(config.mouth_rect)
    part_ref = lambda key, rect: {"file": f"parts/{parts[key].name}", "rect": rect, "sha256": sha256(parts[key])}
    return {
        "label": "说明手势" if config.key == "guide" else "迎接姿势",
        "base": f"expressions/{base_path.name}",
        "sourceSha256": sha256(base_path),
        "eyes": {
            "open": part_ref("eye-open", eye_rect),
            "half": part_ref("eye-half", eye_rect),
            "closed": part_ref("eye-closed", eye_rect),
        },
        "mouth": {
            "closed": part_ref("mouth-closed", mouth_rect),
            "half": part_ref("mouth-half", mouth_rect),
            "open": part_ref("mouth-open", mouth_rect),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--guide", type=Path, required=True)
    parser.add_argument("--welcome", type=Path, required=True)
    parser.add_argument("--voice", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    output = args.output.resolve()
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    configs = (
        FaceConfig(
            key="guide",
            source=args.guide.resolve(),
            eye_rect=(432, 280, 578, 360),
            eye_boxes=((441, 291, 481, 346), (505, 296, 568, 354)),
            lid_anchors=((445, 309, 478, 316, 6), (510, 315, 562, 324, 8)),
            eye_skin_sample=(493, 343),
            mouth_rect=(458, 360, 530, 390),
            mouth_center=(493, 366),
            mouth_angle=-5,
        ),
        FaceConfig(
            key="welcome",
            source=args.welcome.resolve(),
            eye_rect=(408, 286, 594, 390),
            eye_boxes=((418, 305, 493, 380), (516, 302, 585, 378)),
            lid_anchors=((424, 329, 487, 326, 8), (521, 325, 580, 328, 8)),
            eye_skin_sample=(512, 377),
            mouth_rect=(474, 391, 550, 435),
            mouth_center=(512, 407),
            mouth_angle=0,
        ),
    )
    expressions = {config.key: build_expression(config, output) for config in configs}
    voice_path = output / "voice.wav"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(args.voice.resolve()), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(voice_path)],
        check=True,
    )

    manifest = {
        "schema": "galgame-face-motion/v2",
        "canvas": {"width": 1024, "height": 1536},
        "expressions": expressions,
        "profile": {
            "mouth": {
                "windowMs": 24,
                "noiseFloorPercentile": 0.15,
                "peakPercentile": 0.92,
                "attackMs": 45,
                "releaseMs": 110,
                "minHoldMs": 80,
                "closeThreshold": 0.18,
                "openThreshold": 0.58,
                "hysteresis": 0.07,
                "mergeGapMs": 60,
            },
            "blink": {
                "minIntervalMs": 2200,
                "medianIntervalMs": 4300,
                "maxIntervalMs": 8500,
                "halfMs": 45,
                "closedMs": 75,
                "doubleBlinkChance": 0.08,
                "phraseBoundaryBias": 0.35,
                "suppressAroundSwapMs": 250,
                "seed": 12345,
            },
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "expressions": list(expressions), "voice": str(voice_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
