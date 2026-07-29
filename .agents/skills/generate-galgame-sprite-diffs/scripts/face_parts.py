#!/usr/bin/env python3
"""Create face-region masks and force model candidates into approved sprite bases."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ELLIPSE = re.compile(
    r"^\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*,\s*"
    r"(0(?:\.\d+)?|1(?:\.0+)?)\s*,\s*"
    r"(0(?:\.\d+)?|1(?:\.0+)?)\s*,\s*"
    r"(0(?:\.\d+)?|1(?:\.0+)?)\s*$"
)
SIZE = re.compile(r"^([1-9][0-9]*)x([1-9][0-9]*)$")


def parse_ellipse(value: str) -> tuple[float, float, float, float]:
    match = ELLIPSE.fullmatch(value)
    if not match:
        raise argparse.ArgumentTypeError("椭圆须为归一化 cx,cy,rx,ry，四项都在 0 到 1")
    cx, cy, rx, ry = (float(item) for item in match.groups())
    if rx <= 0 or ry <= 0:
        raise argparse.ArgumentTypeError("rx 与 ry 必须大于 0")
    if cx - rx < 0 or cy - ry < 0 or cx + rx > 1 or cy + ry > 1:
        raise argparse.ArgumentTypeError("椭圆不可越出画布")
    return cx, cy, rx, ry


def parse_size(value: str) -> tuple[int, int]:
    match = SIZE.fullmatch(value)
    if not match:
        raise argparse.ArgumentTypeError("尺寸须为 WIDTHxHEIGHT")
    return int(match.group(1)), int(match.group(2))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path | None, data: dict) -> None:
    encoded = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(encoded, encoding="utf-8")
    print(json.dumps(data, ensure_ascii=False))


def load_rgba(path: Path) -> Image.Image:
    if not path.is_file():
        raise SystemExit(f"找不到图片: {path}")
    try:
        with Image.open(path) as image:
            rgba = image.convert("RGBA")
            rgba.load()
            return rgba
    except OSError as exc:
        raise SystemExit(f"图片无法完整读取 {path}: {exc}") from exc


def mask_bbox(mask: np.ndarray, threshold: int = 1) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask > threshold)
    if not len(xs):
        raise SystemExit("蒙版没有许可像素")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def build_allow_mask(
    size: tuple[int, int],
    ellipses: list[tuple[float, float, float, float]],
    feather: float,
) -> Image.Image:
    width, height = size
    yy, xx = np.indices((height, width), dtype=np.float32)
    allow = np.zeros((height, width), dtype=np.uint8)
    for cx, cy, rx, ry in ellipses:
        inside = (
            ((xx - cx * width) / (rx * width)) ** 2
            + ((yy - cy * height) / (ry * height)) ** 2
        ) <= 1.0
        allow[inside] = 255
    image = Image.fromarray(allow, mode="L")
    if feather > 0:
        image = image.filter(ImageFilter.GaussianBlur(radius=feather))
    return image


def command_mask(args: argparse.Namespace) -> None:
    base = load_rgba(args.base)
    allow = build_allow_mask(base.size, args.ellipse, args.feather)
    allow_array = np.asarray(allow, dtype=np.uint8)
    bbox = mask_bbox(allow_array)

    args.allow_out.parent.mkdir(parents=True, exist_ok=True)
    allow.save(args.allow_out, format="PNG")

    api_array = np.full((base.height, base.width, 4), 255, dtype=np.uint8)
    api_array[..., 3] = 255 - allow_array
    api_image = Image.fromarray(api_array, mode="RGBA")
    args.api_out.parent.mkdir(parents=True, exist_ok=True)
    api_image.save(args.api_out, format="PNG")

    base_array = np.asarray(base, dtype=np.uint8).copy()
    weight = (allow_array.astype(np.float32) / 255.0 * 0.48)[..., None]
    tint = np.zeros_like(base_array[..., :3], dtype=np.float32)
    tint[..., 0] = 255
    tint[..., 1] = 48
    tint[..., 2] = 96
    blended = (
        base_array[..., :3].astype(np.float32) * (1.0 - weight)
        + tint * weight
    )
    overlay_array = base_array.copy()
    overlay_array[..., :3] = np.rint(np.clip(blended, 0, 255)).astype(np.uint8)
    overlay = Image.fromarray(overlay_array, mode="RGBA")
    args.overlay_out.parent.mkdir(parents=True, exist_ok=True)
    overlay.save(args.overlay_out, format="PNG")

    write_json(
        args.json,
        {
            "operation": "mask",
            "base": str(args.base),
            "size": list(base.size),
            "ellipses_normalized": [list(value) for value in args.ellipse],
            "feather_px": args.feather,
            "bbox": list(bbox),
            "allow_mask": str(args.allow_out),
            "api_edit_mask": str(args.api_out),
            "overlay": str(args.overlay_out),
            "allow_mask_sha256": sha256(args.allow_out),
            "api_edit_mask_sha256": sha256(args.api_out),
        },
    )


def command_compose(args: argparse.Namespace) -> None:
    base = load_rgba(args.base)
    candidate = load_rgba(args.candidate)
    if candidate.size != base.size:
        raise SystemExit(
            f"候选尺寸 {candidate.width}x{candidate.height} 与母版 "
            f"{base.width}x{base.height} 不一致"
        )
    if not args.mask.is_file():
        raise SystemExit(f"找不到许可蒙版: {args.mask}")
    with Image.open(args.mask) as image:
        allow = image.convert("L")
        allow.load()
    if allow.size != base.size:
        raise SystemExit("许可蒙版与母版尺寸不一致")

    frame = Image.composite(candidate, base, allow)
    args.frame.parent.mkdir(parents=True, exist_ok=True)
    frame.save(args.frame, format="PNG")

    allow_array = np.asarray(allow, dtype=np.uint8)
    bbox = mask_bbox(allow_array)
    base_array = np.asarray(base, dtype=np.uint8)
    candidate_array = np.asarray(candidate, dtype=np.uint8)
    frame_array = np.asarray(frame, dtype=np.uint8)

    outside = allow_array == 0
    outside_changed = int(
        np.count_nonzero(np.any(base_array[outside] != frame_array[outside], axis=1))
    )
    inside = allow_array > 127
    inside_changed = int(
        np.count_nonzero(np.any(base_array[inside] != frame_array[inside], axis=1))
    )
    delta = np.abs(
        base_array[..., :3].astype(np.int16) - frame_array[..., :3].astype(np.int16)
    )
    inside_mean_delta = float(delta[inside].mean()) if np.any(inside) else 0.0

    part_sha = None
    if args.part is not None:
        part_array = candidate_array.copy()
        part_array[..., 3] = (
            part_array[..., 3].astype(np.uint16)
            * allow_array.astype(np.uint16)
            // 255
        ).astype(np.uint8)
        part = Image.fromarray(part_array, mode="RGBA").crop(bbox)
        args.part.parent.mkdir(parents=True, exist_ok=True)
        part.save(args.part, format="PNG")
        part_sha = sha256(args.part)

    failures: list[str] = []
    if outside_changed:
        failures.append("许可蒙版外发生像素变化")
    if inside_changed < args.min_inside_changed_pixels:
        failures.append("许可区域内变化像素过少，候选可能没有完成指定状态")
    report = {
        "operation": "forced-local-composite",
        "status": "fail" if failures else "pass",
        "base": str(args.base),
        "candidate": str(args.candidate),
        "mask": str(args.mask),
        "frame": str(args.frame),
        "part": str(args.part) if args.part is not None else None,
        "size": list(base.size),
        "mask_bbox": list(bbox),
        "outside_mask_changed_pixels": outside_changed,
        "inside_mask_changed_pixels": inside_changed,
        "inside_mask_rgb_mean_delta": round(inside_mean_delta, 6),
        "base_sha256": sha256(args.base),
        "candidate_sha256": sha256(args.candidate),
        "mask_sha256": sha256(args.mask),
        "frame_sha256": sha256(args.frame),
        "part_sha256": part_sha,
        "failures": failures,
    }
    write_json(args.json, report)
    if failures:
        raise SystemExit(2)


def command_verify(args: argparse.Namespace) -> None:
    failures: list[str] = []
    files: list[dict] = []
    for path in args.inputs:
        try:
            with Image.open(path) as image:
                image.load()
                size = image.size
                frames = getattr(image, "n_frames", 1)
        except (OSError, FileNotFoundError) as exc:
            failures.append(f"{path}: {exc}")
            continue
        if args.expect_size and size != args.expect_size:
            failures.append(
                f"{path}: 尺寸 {size[0]}x{size[1]}，预期 "
                f"{args.expect_size[0]}x{args.expect_size[1]}"
            )
        files.append(
            {
                "path": str(path),
                "size": list(size),
                "frames": frames,
                "sha256": sha256(path),
            }
        )
    write_json(
        args.json,
        {
            "operation": "verify-images",
            "status": "fail" if failures else "pass",
            "files": files,
            "failures": failures,
        },
    )
    if failures:
        raise SystemExit(2)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="眼嘴许可蒙版与强制局部合成")
    subparsers = parser.add_subparsers(dest="command", required=True)

    mask = subparsers.add_parser("mask")
    mask.add_argument("--base", type=Path, required=True)
    mask.add_argument(
        "--ellipse",
        type=parse_ellipse,
        action="append",
        required=True,
        help="归一化 cx,cy,rx,ry；眼睛可重复两次",
    )
    mask.add_argument("--feather", type=float, default=4.0)
    mask.add_argument("--allow-out", type=Path, required=True)
    mask.add_argument("--api-out", type=Path, required=True)
    mask.add_argument("--overlay-out", type=Path, required=True)
    mask.add_argument("--json", type=Path)
    mask.set_defaults(func=command_mask)

    compose = subparsers.add_parser("compose")
    compose.add_argument("--base", type=Path, required=True)
    compose.add_argument("--candidate", type=Path, required=True)
    compose.add_argument("--mask", type=Path, required=True)
    compose.add_argument("--frame", type=Path, required=True)
    compose.add_argument("--part", type=Path)
    compose.add_argument("--min-inside-changed-pixels", type=int, default=8)
    compose.add_argument("--json", type=Path, required=True)
    compose.set_defaults(func=command_compose)

    verify = subparsers.add_parser("verify")
    verify.add_argument("inputs", type=Path, nargs="+")
    verify.add_argument("--expect-size", type=parse_size)
    verify.add_argument("--json", type=Path)
    verify.set_defaults(func=command_verify)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if hasattr(args, "feather") and not 0 <= args.feather <= 24:
        raise SystemExit("--feather 须在 0 到 24 之间")
    if hasattr(args, "min_inside_changed_pixels") and args.min_inside_changed_pixels < 1:
        raise SystemExit("--min-inside-changed-pixels 必须大于 0")
    args.func(args)


if __name__ == "__main__":
    main()
