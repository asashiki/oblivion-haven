#!/usr/bin/env python3
"""Create face-region masks and force model candidates into approved sprite bases."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ELLIPSE = re.compile(
    r"^\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*,\s*"
    r"(0(?:\.\d+)?|1(?:\.0+)?)\s*,\s*"
    r"(0(?:\.\d+)?|1(?:\.0+)?)\s*,\s*"
    r"(0(?:\.\d+)?|1(?:\.0+)?)\s*$"
)
SIZE = re.compile(r"^([1-9][0-9]*)x([1-9][0-9]*)$")
POINT = re.compile(
    r"^\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*,\s*"
    r"(0(?:\.\d+)?|1(?:\.0+)?)\s*$"
)


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


def parse_point(value: str) -> tuple[float, float]:
    match = POINT.fullmatch(value)
    if not match:
        raise argparse.ArgumentTypeError("锚点须为归一化 x,y，两项都在 0 到 1")
    return float(match.group(1)), float(match.group(2))


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


def save_png_atomic(image: Image.Image, path: Path) -> None:
    """Write and fully reload a PNG before replacing an accepted artifact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.writing.png")
    image.save(temporary, format="PNG")
    try:
        with Image.open(temporary) as check:
            check.load()
    except OSError as exc:
        temporary.unlink(missing_ok=True)
        raise SystemExit(f"PNG 写入后无法完整读取 {path}: {exc}") from exc
    temporary.replace(path)


def mask_bbox(mask: np.ndarray, threshold: int = 1) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask > threshold)
    if not len(xs):
        raise SystemExit("蒙版没有许可像素")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def square_context_box(
    size: tuple[int, int],
    bbox: tuple[int, int, int, int],
    context_scale: float,
) -> tuple[int, int, int, int]:
    width, height = size
    left, top, right, bottom = bbox
    feature_width = right - left
    feature_height = bottom - top
    side = max(32, int(np.ceil(max(feature_width, feature_height) * context_scale)))
    side = min(side, width, height)
    center_x = (left + right) / 2.0
    center_y = (top + bottom) / 2.0
    crop_left = int(round(center_x - side / 2.0))
    crop_top = int(round(center_y - side / 2.0))
    crop_left = min(max(0, crop_left), width - side)
    crop_top = min(max(0, crop_top), height - side)
    return crop_left, crop_top, crop_left + side, crop_top + side


def read_plate_map(
    path: Path,
    base_path: Path,
    base: Image.Image,
    candidate: Image.Image,
) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取局部编辑板记录 {path}: {exc}") from exc
    if data.get("operation") != "prepare-fixed-registration-edit-plate":
        raise SystemExit("局部编辑板记录类型错误")
    if data.get("base_sha256") != sha256(base_path):
        raise SystemExit("局部编辑板记录对应的母版与当前母版不一致")
    if data.get("base_size") != [base.width, base.height]:
        raise SystemExit("局部编辑板记录与当前母版尺寸不匹配")
    plate_size = data.get("plate_size")
    if not isinstance(plate_size, list) or len(plate_size) != 2:
        raise SystemExit("局部编辑板记录缺少计划尺寸")
    if candidate.width != candidate.height:
        raise SystemExit(
            f"模型候选须保持正方形编辑板，实际为 {candidate.width}x"
            f"{candidate.height}；拒绝改变纵横比"
        )
    crop_box = data.get("crop_bbox")
    if not isinstance(crop_box, list) or len(crop_box) != 4:
        raise SystemExit("局部编辑板记录缺少有效裁框")
    left, top, right, bottom = (int(value) for value in crop_box)
    if not (0 <= left < right <= base.width and 0 <= top < bottom <= base.height):
        raise SystemExit("局部编辑板裁框越出母版")
    data["crop_bbox"] = [left, top, right, bottom]
    return data


def expand_plate_candidate(
    base_path: Path,
    base: Image.Image,
    candidate: Image.Image,
    plate_map_path: Path | None,
) -> tuple[Image.Image, dict | None]:
    if plate_map_path is None:
        if candidate.size != base.size:
            raise SystemExit(
                f"候选尺寸 {candidate.width}x{candidate.height} 与母版 "
                f"{base.width}x{base.height} 不一致"
            )
        return candidate, None
    plate_map = read_plate_map(plate_map_path, base_path, base, candidate)
    left, top, right, bottom = plate_map["crop_bbox"]
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    restored = candidate.resize((right - left, bottom - top), resample=resampling)
    expanded = base.copy()
    expanded.paste(restored, (left, top))
    return expanded, plate_map


def build_allow_mask(
    size: tuple[int, int],
    ellipses: list[tuple[float, float, float, float]],
    feather: float,
) -> Image.Image:
    width, height = size
    yy, xx = np.indices((height, width), dtype=np.float32)
    allow_float = np.zeros((height, width), dtype=np.float32)
    for cx, cy, rx, ry in ellipses:
        normalized_distance = np.sqrt(
            ((xx - cx * width) / (rx * width)) ** 2
            + ((yy - cy * height) / (ry * height)) ** 2
        )
        if feather <= 0:
            weight = (normalized_distance <= 1.0).astype(np.float32)
        else:
            # Approximate the outward distance in final-canvas pixels and use
            # a finite cosine shoulder.  GaussianBlur has a much wider nonzero
            # support than its nominal radius; on tiny mouth masks that leaked
            # a downsampled nose/cheek block into the accepted frame.
            distance_px = np.maximum(normalized_distance - 1.0, 0.0) * min(
                rx * width, ry * height
            )
            t = np.clip(distance_px / feather, 0.0, 1.0)
            weight = np.where(
                normalized_distance <= 1.0,
                1.0,
                np.where(distance_px < feather, 0.5 * (1.0 + np.cos(np.pi * t)), 0.0),
            )
        allow_float = np.maximum(allow_float, weight)
    allow = np.rint(np.clip(allow_float, 0.0, 1.0) * 255.0).astype(np.uint8)
    return Image.fromarray(allow, mode="L")


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
            "feather_mode": "finite-outward-cosine-solid-core",
            "bbox": list(bbox),
            "allow_mask": str(args.allow_out),
            "api_edit_mask": str(args.api_out),
            "overlay": str(args.overlay_out),
            "allow_mask_sha256": sha256(args.allow_out),
            "api_edit_mask_sha256": sha256(args.api_out),
        },
    )


def command_edit_plate(args: argparse.Namespace) -> None:
    base = load_rgba(args.base)
    if not args.mask.is_file():
        raise SystemExit(f"找不到许可蒙版: {args.mask}")
    with Image.open(args.mask) as image:
        allow = image.convert("L")
        allow.load()
    if allow.size != base.size:
        raise SystemExit("许可蒙版与母版尺寸不一致")
    feature_bbox = mask_bbox(np.asarray(allow, dtype=np.uint8), threshold=127)
    crop_box = square_context_box(base.size, feature_bbox, args.context_scale)
    crop = base.crop(crop_box)
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    plate = crop.resize((args.plate_size, args.plate_size), resample=resampling)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    plate.save(args.out, format="PNG")
    write_json(
        args.json,
        {
            "operation": "prepare-fixed-registration-edit-plate",
            "base": str(args.base.resolve()),
            "base_sha256": sha256(args.base),
            "base_size": [base.width, base.height],
            "mask": str(args.mask.resolve()),
            "mask_sha256": sha256(args.mask),
            "feature_bbox": list(feature_bbox),
            "crop_bbox": list(crop_box),
            "context_scale": args.context_scale,
            "plate": str(args.out.resolve()),
            "plate_size": [args.plate_size, args.plate_size],
            "plate_sha256": sha256(args.out),
            "mapping_policy": "fixed-square-crop-no-auto-registration",
        },
    )


def command_anchor_guide(args: argparse.Namespace) -> None:
    plate = load_rgba(args.plate)
    try:
        plate_map = json.loads(args.plate_map.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取局部编辑板记录 {args.plate_map}: {exc}") from exc
    if plate_map.get("operation") != "prepare-fixed-registration-edit-plate":
        raise SystemExit("局部编辑板记录类型错误")
    if plate_map.get("plate_sha256") != sha256(args.plate):
        raise SystemExit("定位图对应的局部编辑板已变化")
    left, top, right, bottom = (int(value) for value in plate_map["crop_bbox"])
    base_width, base_height = (int(value) for value in plate_map["base_size"])
    anchors = {
        "left_inner": args.left_inner,
        "left_outer": args.left_outer,
        "right_inner": args.right_inner,
        "right_outer": args.right_outer,
    }
    anchor_pixels = {
        name: [round(point[0] * base_width), round(point[1] * base_height)]
        for name, point in anchors.items()
    }
    guide = plate.copy()
    draw = ImageDraw.Draw(guide)
    half = args.cross_size // 2
    plate_anchors: dict[str, list[int]] = {}
    for name, (anchor_x, anchor_y) in anchor_pixels.items():
        x = round((anchor_x - left) / (right - left) * plate.width)
        y = round((anchor_y - top) / (bottom - top) * plate.height)
        if not (0 <= x < plate.width and 0 <= y < plate.height):
            raise SystemExit(f"眼角锚点 {name} 越出局部编辑板")
        plate_anchors[name] = [x, y]
        color = (0, 168, 70, 255) if "inner" in name else (230, 67, 34, 255)
        draw.line((x - half, y, x + half, y), fill=color, width=args.line_width)
        draw.line((x, y - half, x, y + half), fill=color, width=args.line_width)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    guide.save(args.out, format="PNG")
    write_json(
        args.json,
        {
            "operation": "eye-anchor-locator-guide",
            "plate": str(args.plate.resolve()),
            "plate_sha256": sha256(args.plate),
            "plate_map": str(args.plate_map.resolve()),
            "plate_map_sha256": sha256(args.plate_map),
            "anchors_normalized": {name: list(point) for name, point in anchors.items()},
            "anchors_pixels": anchor_pixels,
            "anchors_plate_pixels": plate_anchors,
            "outer_color": "#e64322",
            "inner_color": "#00a846",
            "guide": str(args.out.resolve()),
            "guide_sha256": sha256(args.out),
            "usage": "locator-reference-only-never-an-edit-target",
        },
    )
def command_compose(args: argparse.Namespace) -> None:
    base = load_rgba(args.base)
    source_candidate = load_rgba(args.candidate)
    candidate, plate_map = expand_plate_candidate(
        args.base, base, source_candidate, args.plate_map
    )
    if not args.mask.is_file():
        raise SystemExit(f"找不到许可蒙版: {args.mask}")
    with Image.open(args.mask) as image:
        allow = image.convert("L")
        allow.load()
    if allow.size != base.size:
        raise SystemExit("许可蒙版与母版尺寸不一致")

    # Runtime eye/mouth edits must never alter the approved sprite silhouette.
    # Built-in image generation commonly returns an opaque RGB plate even when
    # the corresponding mother-frame pixels are transparent.  Preserve the
    # mother's alpha byte-for-byte before applying the region mask so an eye
    # mask that brushes a face edge cannot leak the candidate's black backing
    # into the final frame or exported replacement part.
    base_array = np.asarray(base, dtype=np.uint8)
    candidate_array = np.asarray(candidate, dtype=np.uint8).copy()
    candidate_array[..., 3] = base_array[..., 3]
    candidate = Image.fromarray(candidate_array, mode="RGBA")

    frame = Image.composite(candidate, base, allow)
    save_png_atomic(frame, args.frame)

    allow_array = np.asarray(allow, dtype=np.uint8)
    bbox = mask_bbox(allow_array)
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
    alpha_changed = int(np.count_nonzero(base_array[..., 3] != frame_array[..., 3]))
    transparent_became_visible = int(
        np.count_nonzero((base_array[..., 3] == 0) & (frame_array[..., 3] != 0))
    )

    part_sha = None
    if args.part is not None:
        # Store an exact rectangular replacement crop from the accepted final
        # frame. A runtime can clear this rectangle and draw the patch at bbox
        # x/y to reproduce the same pixels without guessing blend behavior.
        part = frame.crop(bbox)
        save_png_atomic(part, args.part)
        part_sha = sha256(args.part)

    failures: list[str] = []
    if outside_changed:
        failures.append("许可蒙版外发生像素变化")
    if alpha_changed:
        failures.append("最终帧改变了母版透明轮廓")
    if transparent_became_visible:
        failures.append("母版透明像素被候选变成非透明")
    if inside_changed < args.min_inside_changed_pixels:
        failures.append("许可区域内变化像素过少，候选可能没有完成指定状态")
    report = {
        "operation": "forced-local-composite",
        "status": "fail" if failures else "pass",
        "base": str(args.base),
        "candidate": str(args.candidate),
        "candidate_kind": "fixed-registration-edit-plate" if plate_map else "full-canvas",
        "candidate_source_size": [source_candidate.width, source_candidate.height],
        "plate_map": str(args.plate_map) if args.plate_map else None,
        "plate_map_sha256": sha256(args.plate_map) if args.plate_map else None,
        "plate_crop_bbox": plate_map.get("crop_bbox") if plate_map else None,
        "mask": str(args.mask),
        "frame": str(args.frame),
        "part": str(args.part) if args.part is not None else None,
        "part_mode": "replace-rect" if args.part is not None else None,
        "size": list(base.size),
        "mask_bbox": list(bbox),
        "outside_mask_changed_pixels": outside_changed,
        "alpha_changed_pixels": alpha_changed,
        "base_transparent_became_visible_pixels": transparent_became_visible,
        "alpha_policy": "preserve-approved-mother-alpha-byte-for-byte",
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


def flatten_rgba(image: Image.Image, background: tuple[int, int, int, int]) -> Image.Image:
    canvas = Image.new("RGBA", image.size, background)
    canvas.alpha_composite(image)
    return canvas.convert("RGB")


def command_eye_review(args: argparse.Namespace) -> None:
    base = load_rgba(args.base)
    source_candidate = load_rgba(args.candidate)
    candidate, plate_map = expand_plate_candidate(
        args.base, base, source_candidate, args.plate_map
    )
    frame = load_rgba(args.frame)
    if frame.size != base.size:
        raise SystemExit("母版与最终眼睛帧尺寸必须一致")
    if not args.mask.is_file():
        raise SystemExit(f"找不到许可蒙版: {args.mask}")
    with Image.open(args.mask) as image:
        allow = image.convert("L")
        allow.load()
    if allow.size != base.size:
        raise SystemExit("许可蒙版与眼睛帧尺寸不一致")

    left, top, right, bottom = mask_bbox(np.asarray(allow, dtype=np.uint8))
    left = max(0, left - args.padding)
    top = max(0, top - args.padding)
    right = min(base.width, right + args.padding)
    bottom = min(base.height, bottom + args.padding)
    crop_box = (left, top, right, bottom)
    anchors = {
        "left_inner": args.left_inner,
        "left_outer": args.left_outer,
        "right_inner": args.right_inner,
        "right_outer": args.right_outer,
    }
    anchor_pixels = {
        name: [round(point[0] * base.width), round(point[1] * base.height)]
        for name, point in anchors.items()
    }
    crops = [
        ("base", flatten_rgba(base.crop(crop_box), (255, 255, 255, 255))),
        ("raw candidate", flatten_rgba(candidate.crop(crop_box), (255, 255, 255, 255))),
        ("final / light", flatten_rgba(frame.crop(crop_box), (255, 255, 255, 255))),
        ("final / dark", flatten_rgba(frame.crop(crop_box), (32, 32, 36, 255))),
    ]
    resampling = getattr(Image, "Resampling", Image).NEAREST
    panels: list[Image.Image] = []
    label_height = 24
    for label, crop in crops:
        enlarged = crop.resize(
            (crop.width * args.scale, crop.height * args.scale),
            resample=resampling,
        )
        panel = Image.new("RGB", (enlarged.width, enlarged.height + label_height), "white")
        panel.paste(enlarged, (0, label_height))
        draw = ImageDraw.Draw(panel)
        draw.text((6, 6), label, fill="black")
        for name, (anchor_x, anchor_y) in anchor_pixels.items():
            x = (anchor_x - left) * args.scale
            y = (anchor_y - top) * args.scale + label_height
            color = (0, 170, 70) if "inner" in name else (220, 70, 30)
            radius = max(4, args.scale + 1)
            draw.line((x - radius, y, x + radius, y), fill=color, width=2)
            draw.line((x, y - radius, x, y + radius), fill=color, width=2)
        panels.append(panel)
    sheet = Image.new(
        "RGB",
        (max(panel.width for panel in panels), sum(panel.height for panel in panels)),
        "white",
    )
    y = 0
    for panel in panels:
        sheet.paste(panel, (0, y))
        y += panel.height
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out, format="PNG")

    write_json(
        args.json,
        {
            "operation": "eye-alignment-and-residue-review",
            "status": args.verdict,
            "state": args.state,
            "candidate_sha256": sha256(args.candidate),
            "candidate_kind": "fixed-registration-edit-plate" if plate_map else "full-canvas",
            "candidate_source_size": [source_candidate.width, source_candidate.height],
            "plate_map_sha256": sha256(args.plate_map) if args.plate_map else None,
            "frame_sha256": sha256(args.frame),
            "anchors_normalized": {name: list(point) for name, point in anchors.items()},
            "anchors_pixels": anchor_pixels,
            "endpoint_tolerance_px": 2,
            "reviewer_note": args.reviewer_note,
            "crop_bbox": list(crop_box),
            "scale": args.scale,
            "review_image": str(args.out),
            "review_image_sha256": sha256(args.out),
            "required_visual_checks": [
                "new lid endpoints stay on all four original eye-corner anchors within 2 pixels",
                "lid midpoint stays inside the original open-eye aperture",
                "no vertical jump, inter-eye spacing change, perspective change, or scale change",
                "slow base/frame toggle changes eyelid aperture without moving the eye corners",
                "no original full-open upper-lash arc above the new lid",
                "no second gray or black contour parallel to the new lid",
                "no iris, sclera, lower-lash, or antialiasing fragments in eyes_close",
                "no mask-edge blend restoring old eye ink",
            ],
        },
    )


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
    compose.add_argument("--plate-map", type=Path)
    compose.add_argument("--mask", type=Path, required=True)
    compose.add_argument("--frame", type=Path, required=True)
    compose.add_argument("--part", type=Path)
    compose.add_argument("--min-inside-changed-pixels", type=int, default=8)
    compose.add_argument("--json", type=Path, required=True)
    compose.set_defaults(func=command_compose)

    edit_plate = subparsers.add_parser("edit-plate")
    edit_plate.add_argument("--base", type=Path, required=True)
    edit_plate.add_argument("--mask", type=Path, required=True)
    edit_plate.add_argument("--context-scale", type=float, default=2.4)
    edit_plate.add_argument("--plate-size", type=int, default=1024)
    edit_plate.add_argument("--out", type=Path, required=True)
    edit_plate.add_argument("--json", type=Path, required=True)
    edit_plate.set_defaults(func=command_edit_plate)

    anchor_guide = subparsers.add_parser("anchor-guide")
    anchor_guide.add_argument("--plate", type=Path, required=True)
    anchor_guide.add_argument("--plate-map", type=Path, required=True)
    anchor_guide.add_argument("--left-inner", type=parse_point, required=True)
    anchor_guide.add_argument("--left-outer", type=parse_point, required=True)
    anchor_guide.add_argument("--right-inner", type=parse_point, required=True)
    anchor_guide.add_argument("--right-outer", type=parse_point, required=True)
    anchor_guide.add_argument("--cross-size", type=int, default=28)
    anchor_guide.add_argument("--line-width", type=int, default=4)
    anchor_guide.add_argument("--out", type=Path, required=True)
    anchor_guide.add_argument("--json", type=Path, required=True)
    anchor_guide.set_defaults(func=command_anchor_guide)

    eye_review = subparsers.add_parser("eye-review")
    eye_review.add_argument("--base", type=Path, required=True)
    eye_review.add_argument("--candidate", type=Path, required=True)
    eye_review.add_argument("--plate-map", type=Path)
    eye_review.add_argument("--frame", type=Path, required=True)
    eye_review.add_argument("--mask", type=Path, required=True)
    eye_review.add_argument("--state", choices=("eyes_half", "eyes_close"), required=True)
    eye_review.add_argument("--left-inner", type=parse_point, required=True)
    eye_review.add_argument("--left-outer", type=parse_point, required=True)
    eye_review.add_argument("--right-inner", type=parse_point, required=True)
    eye_review.add_argument("--right-outer", type=parse_point, required=True)
    eye_review.add_argument("--verdict", choices=("pass", "fail"), required=True)
    eye_review.add_argument("--reviewer-note", required=True)
    eye_review.add_argument("--scale", type=int, default=4)
    eye_review.add_argument("--padding", type=int, default=12)
    eye_review.add_argument("--out", type=Path, required=True)
    eye_review.add_argument("--json", type=Path, required=True)
    eye_review.set_defaults(func=command_eye_review)

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
    if hasattr(args, "scale") and not 2 <= args.scale <= 12:
        raise SystemExit("--scale 须在 2 到 12 之间")
    if hasattr(args, "padding") and not 0 <= args.padding <= 128:
        raise SystemExit("--padding 须在 0 到 128 之间")
    if hasattr(args, "context_scale") and not 1.25 <= args.context_scale <= 6:
        raise SystemExit("--context-scale 须在 1.25 到 6 之间")
    if hasattr(args, "plate_size") and not 256 <= args.plate_size <= 2048:
        raise SystemExit("--plate-size 须在 256 到 2048 之间")
    if hasattr(args, "cross_size") and not 8 <= args.cross_size <= 96:
        raise SystemExit("--cross-size 须在 8 到 96 之间")
    if hasattr(args, "line_width") and not 1 <= args.line_width <= 12:
        raise SystemExit("--line-width 须在 1 到 12 之间")
    args.func(args)


if __name__ == "__main__":
    main()
