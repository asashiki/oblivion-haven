#!/usr/bin/env python3
"""Portable chroma-key, canvas normalization, and sprite QA utilities."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


DEFAULT_KEYS = ("#fc5d21", "#00ff66", "#ff00ff", "#00d9ff", "#7d00ff", "#fff200")
HEX_COLOR = re.compile(r"^#?([0-9a-fA-F]{6})$")
SIZE = re.compile(r"^([1-9][0-9]*)x([1-9][0-9]*)$")


def parse_hex_color(value: str) -> np.ndarray:
    match = HEX_COLOR.fullmatch(value.strip())
    if not match:
        raise argparse.ArgumentTypeError("颜色须为 6 位十六进制，例如 #fc5d21")
    raw = match.group(1)
    return np.array([int(raw[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def color_hex(color: np.ndarray) -> str:
    return "#" + "".join(f"{int(round(channel)):02x}" for channel in color)


def parse_size(value: str) -> tuple[int, int]:
    match = SIZE.fullmatch(value.strip())
    if not match:
        raise argparse.ArgumentTypeError("尺寸须为 WIDTHxHEIGHT，例如 1024x1536")
    return int(match.group(1)), int(match.group(2))


def parse_box(value: str) -> tuple[float, float, float, float]:
    try:
        parts = tuple(float(item.strip()) for item in value.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("区域须为 x0,y0,x1,y1") from exc
    if len(parts) != 4 or not all(0 <= item <= 1 for item in parts):
        raise argparse.ArgumentTypeError("区域须包含四个 0 到 1 的小数")
    if parts[0] >= parts[2] or parts[1] >= parts[3]:
        raise argparse.ArgumentTypeError("区域的 x0/y0 必须小于 x1/y1")
    return parts


def write_json(path: Path | None, data: dict) -> None:
    encoded = json.dumps(data, ensure_ascii=False, indent=2)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(encoded + "\n", encoding="utf-8")
    print(json.dumps(data, ensure_ascii=False))


def sample_border_key(rgb: np.ndarray, band: int = 8) -> np.ndarray:
    height, width, _ = rgb.shape
    band = max(1, min(band, height // 2, width // 2))
    samples = np.concatenate(
        (
            rgb[:band].reshape(-1, 3),
            rgb[-band:].reshape(-1, 3),
            rgb[:, :band].reshape(-1, 3),
            rgb[:, -band:].reshape(-1, 3),
        ),
        axis=0,
    )
    return np.median(samples, axis=0).astype(np.float32)


def border_connected(mask: np.ndarray) -> np.ndarray:
    """Return only true pixels connected to the outside border."""
    try:
        from scipy.ndimage import binary_propagation
    except ImportError:
        binary_propagation = None
    if binary_propagation is not None:
        seeds = np.zeros_like(mask, dtype=bool)
        seeds[0, :] = mask[0, :]
        seeds[-1, :] = mask[-1, :]
        seeds[:, 0] = mask[:, 0]
        seeds[:, -1] = mask[:, -1]
        return np.asarray(binary_propagation(seeds, mask=mask), dtype=bool)

    # Dependency-light fallback for environments without SciPy.
    padded = np.pad(mask.astype(np.uint8) * 255, 1, mode="constant", constant_values=255)
    # Image.fromarray may expose a read-only shared buffer; floodfill needs a copy.
    image = Image.fromarray(padded, mode="L").copy()
    ImageDraw.floodfill(image, (0, 0), 128, thresh=0)
    filled = np.asarray(image, dtype=np.uint8)
    return filled[1:-1, 1:-1] == 128


def reference_subject_pixels(rgba: np.ndarray) -> tuple[np.ndarray, dict]:
    """Sample likely subject pixels while ignoring a simple opaque backdrop."""

    visible = rgba[..., 3] >= 24
    visible_pixels = rgba[..., :3][visible]
    report = {
        "sampling_mode": "all-visible",
        "detected_background": None,
        "subject_fraction": 1.0,
    }
    if not visible_pixels.size:
        return visible_pixels, report

    # Transparent references already expose the subject directly. Background
    # inference is useful only when an opaque reference has a stable border,
    # such as a prepared purple chroma backdrop.
    if float(np.count_nonzero(visible) / visible.size) < 0.97:
        return visible_pixels, report

    height, width = visible.shape
    band = max(2, min(8, height // 12, width // 12))
    border = np.concatenate(
        (
            rgba[:band, :, :3].reshape(-1, 3),
            rgba[-band:, :, :3].reshape(-1, 3),
            rgba[:, :band, :3].reshape(-1, 3),
            rgba[:, -band:, :3].reshape(-1, 3),
        ),
        axis=0,
    ).astype(np.float32)
    background = np.median(border, axis=0)
    border_distance = np.sqrt(np.sum((border - background) ** 2, axis=1))
    border_spread = float(np.percentile(border_distance, 95.0))
    if border_spread > 58.0:
        return visible_pixels, report

    rgb = rgba[..., :3].astype(np.float32)
    distance = np.sqrt(np.sum((rgb - background) ** 2, axis=2))
    # Include antialiased and mildly graded backdrop pixels in the removable
    # band so they are not mistaken for tiny subject-color conflicts.
    cutoff = float(np.clip(border_spread * 1.5 + 64.0, 64.0, 110.0))
    subject = visible & (distance > cutoff)
    subject_fraction = float(np.count_nonzero(subject) / max(1, np.count_nonzero(visible)))
    if not 0.03 <= subject_fraction <= 0.88:
        return visible_pixels, report

    report = {
        "sampling_mode": "simple-background-removed",
        "detected_background": color_hex(background),
        "background_border_spread": round(border_spread, 3),
        "background_distance_cutoff": round(cutoff, 3),
        "subject_fraction": round(subject_fraction, 6),
    }
    return rgba[..., :3][subject], report


def command_choose_key(args: argparse.Namespace) -> None:
    sampled: list[np.ndarray] = []
    reference_analysis: list[dict] = []
    detected_backgrounds: list[str] = []
    for path in args.inputs:
        if not path.is_file():
            raise SystemExit(f"找不到参考图: {path}")
        with Image.open(path) as image:
            image = image.convert("RGBA")
            image.thumbnail((384, 384), Image.Resampling.LANCZOS)
            rgba = np.asarray(image, dtype=np.uint8)
        pixels, analysis = reference_subject_pixels(rgba)
        analysis["path"] = str(path)
        reference_analysis.append(analysis)
        if analysis["detected_background"] is not None:
            detected_backgrounds.append(analysis["detected_background"])
        if pixels.size:
            sampled.append(pixels.astype(np.float32))
    if not sampled:
        raise SystemExit("参考图没有可采样的可见像素")
    pixels = np.concatenate(sampled, axis=0)
    if len(pixels) > 120_000:
        indices = np.linspace(0, len(pixels) - 1, 120_000, dtype=np.int64)
        pixels = pixels[indices]

    candidate_values = list(args.candidate or DEFAULT_KEYS)
    if args.reuse_reference_background:
        candidate_values.extend(detected_backgrounds)
    deduplicated: list[str] = []
    for value in candidate_values:
        normalized = color_hex(parse_hex_color(value))
        if normalized not in deduplicated:
            deduplicated.append(normalized)
    candidates = [parse_hex_color(value) for value in deduplicated]
    preferred = parse_hex_color(args.preferred)
    scores: list[tuple[np.ndarray, float, float, float, float, bool]] = []
    for candidate in candidates:
        distance = np.sqrt(np.sum((pixels - candidate) ** 2, axis=1))
        low = float(np.percentile(distance, 0.2))
        median = float(np.median(distance))
        score = low * 0.78 + median * 0.22
        conflict_fraction = float(np.count_nonzero(distance < 60.0) / len(distance))
        safe = conflict_fraction <= 0.0001
        scores.append((candidate, score, low, median, conflict_fraction, safe))

    scores.sort(key=lambda item: item[1], reverse=True)
    safe_scores = [item for item in scores if item[5]]
    best = safe_scores[0] if safe_scores else scores[0]
    selection_reason = "highest subject-palette separation"
    detected_set = set(detected_backgrounds)
    reusable = [item for item in safe_scores if color_hex(item[0]) in detected_set]
    if args.reuse_reference_background and reusable:
        reusable.sort(key=lambda item: item[1], reverse=True)
        best = reusable[0]
        selection_reason = "reused safe simple reference background"
    preferred_match = next((item for item in scores if np.array_equal(item[0], preferred)), None)
    if preferred_match is not None and preferred_match[5] and preferred_match[1] >= best[1] * 0.90:
        best = preferred_match
        selection_reason = "safe preferred key within 90% of best score"

    result = {
        "selected": color_hex(best[0]),
        "selection_reason": selection_reason,
        "preferred": color_hex(preferred),
        "reference_analysis": reference_analysis,
        "scores": [
            {
                "color": color_hex(item[0]),
                "score": round(item[1], 3),
                "nearest_0_2_percent_distance": round(item[2], 3),
                "median_distance": round(item[3], 3),
                "near_key_fraction": round(item[4], 8),
                "safe": item[5],
            }
            for item in scores
        ],
    }
    if args.json is not None:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.plain:
        print(result["selected"])
    else:
        print(json.dumps(result, ensure_ascii=False))


def command_rekey(args: argparse.Namespace) -> None:
    if not args.input.is_file():
        raise SystemExit(f"找不到输入图片: {args.input}")
    if args.output.suffix.lower() != ".png":
        raise SystemExit("重新铺色键的输出必须使用 .png 扩展名")
    with Image.open(args.input) as image:
        rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    key = args.key_color.reshape(1, 1, 3)
    flattened = rgba[..., :3].astype(np.float32) * alpha + key * (1.0 - alpha)
    output = np.rint(np.clip(flattened, 0.0, 255.0)).astype(np.uint8)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, mode="RGB").save(args.output, format="PNG")
    write_json(
        args.json,
        {
            "operation": "rekey",
            "input": str(args.input),
            "output": str(args.output),
            "key_color": color_hex(args.key_color),
            "size": [int(output.shape[1]), int(output.shape[0])],
        },
    )


def command_cutout(args: argparse.Namespace) -> None:
    if not args.input.is_file():
        raise SystemExit(f"找不到输入图片: {args.input}")
    if args.output.suffix.lower() != ".png":
        raise SystemExit("透明输出必须使用 .png 扩展名")
    if not 0 <= args.transparent_distance < args.opaque_distance <= 255:
        raise SystemExit("阈值须满足 0 <= transparent-distance < opaque-distance <= 255")

    with Image.open(args.input) as image:
        rgb_u8 = np.asarray(image.convert("RGB"), dtype=np.uint8)
    rgb = rgb_u8.astype(np.float32)
    key = args.key_color if args.key_color is not None else sample_border_key(rgb)
    distance = np.sqrt(np.sum((rgb - key) ** 2, axis=2))

    key_like = distance < args.opaque_distance
    # Chroma-key backgrounds can form enclosed islands between hair strands,
    # ribbons, arms, and clothing. The normal workflow therefore removes every
    # key-like pixel. Border-connected mode remains available only for an
    # explicitly accepted subject/key color collision.
    removable_band = (
        border_connected(key_like)
        if args.scope == "border-connected"
        else key_like
    )
    transparent_core = removable_band & (distance <= args.transparent_distance)

    alpha = np.ones(distance.shape, dtype=np.float32)
    if args.soft_matte:
        soft = removable_band & ~transparent_core
        alpha[transparent_core] = 0.0
        alpha[soft] = np.clip(
            (distance[soft] - args.transparent_distance)
            / (args.opaque_distance - args.transparent_distance),
            0.0,
            1.0,
        )
        if args.edge_radius > 0 and np.any(soft):
            alpha_image = Image.fromarray(np.rint(alpha * 255).astype(np.uint8), mode="L")
            smoothed = np.asarray(
                alpha_image.filter(ImageFilter.GaussianBlur(radius=args.edge_radius / 3.0)),
                dtype=np.float32,
            ) / 255.0
            alpha[soft] = smoothed[soft]
            alpha[transparent_core] = 0.0
    else:
        alpha[removable_band] = 0.0

    alpha[alpha <= (4.0 / 255.0)] = 0.0
    alpha[alpha >= (251.0 / 255.0)] = 1.0

    foreground = rgb.copy()
    if args.despill:
        partial = (alpha > 0.0) & (alpha < 1.0) & removable_band
        safe_alpha = np.maximum(alpha, 0.08)
        reconstructed = (rgb - (1.0 - safe_alpha[..., None]) * key) / safe_alpha[..., None]
        foreground[partial] = np.clip(reconstructed[partial], 0.0, 255.0)
    foreground[alpha == 0.0] = 0.0

    rgba = np.dstack(
        (
            np.rint(foreground).astype(np.uint8),
            np.rint(alpha * 255.0).astype(np.uint8),
        )
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(args.output, format="PNG")

    report = {
        "operation": "cutout",
        "input": str(args.input),
        "output": str(args.output),
        "key_color": color_hex(key),
        "scope": args.scope,
        "size": [int(rgba.shape[1]), int(rgba.shape[0])],
        "transparent_pixels": int(np.count_nonzero(rgba[..., 3] == 0)),
        "partial_alpha_pixels": int(np.count_nonzero((rgba[..., 3] > 0) & (rgba[..., 3] < 255))),
        "opaque_pixels": int(np.count_nonzero(rgba[..., 3] == 255)),
    }
    write_json(args.json, report)


def alpha_bbox(alpha: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(alpha > threshold)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def calculate_transform(
    image: Image.Image,
    target: tuple[int, int],
    margin_percent: float,
    anchor: str,
) -> dict:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    bbox = alpha_bbox(rgba[..., 3])
    if bbox is None:
        raise SystemExit("输入图片没有可见人物像素")
    x0, y0, x1, y1 = bbox
    target_width, target_height = target
    margin = int(round(min(target_width, target_height) * margin_percent / 100.0))
    available_width = max(1, target_width - margin * 2)
    available_height = max(1, target_height - margin * 2)
    crop_width, crop_height = x1 - x0, y1 - y0
    scale = min(available_width / crop_width, available_height / crop_height)
    resized = (max(1, round(crop_width * scale)), max(1, round(crop_height * scale)))
    paste_x = (target_width - resized[0]) // 2
    paste_y = target_height - margin - resized[1] if anchor == "bottom-center" else (target_height - resized[1]) // 2
    return {
        "version": 1,
        "source_size": list(image.size),
        "crop_box": [x0, y0, x1, y1],
        "target_size": [target_width, target_height],
        "resized_size": list(resized),
        "paste_xy": [paste_x, paste_y],
        "margin_percent": margin_percent,
        "anchor": anchor,
    }


def apply_transform(image: Image.Image, transform: dict) -> Image.Image:
    required = ("source_size", "crop_box", "target_size", "resized_size", "paste_xy")
    if any(key not in transform for key in required):
        raise SystemExit("变换文件缺少必要字段")
    if list(image.size) != list(transform["source_size"]):
        raise SystemExit(
            f"差分源尺寸 {image.size[0]}x{image.size[1]} 与通常立绘源尺寸 "
            f"{transform['source_size'][0]}x{transform['source_size'][1]} 不一致"
        )
    crop = image.convert("RGBA").crop(tuple(transform["crop_box"]))
    resized = crop.resize(tuple(transform["resized_size"]), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", tuple(transform["target_size"]), (0, 0, 0, 0))
    canvas.alpha_composite(resized, tuple(transform["paste_xy"]))
    return canvas


def command_normalize(args: argparse.Namespace) -> None:
    if not args.input.is_file():
        raise SystemExit(f"找不到输入图片: {args.input}")
    with Image.open(args.input) as source:
        image = source.convert("RGBA")
    if args.transform:
        try:
            transform = json.loads(args.transform.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"无法读取变换文件 {args.transform}: {exc}") from exc
    else:
        transform = calculate_transform(image, args.canvas, args.margin_percent, args.anchor)
    normalized = apply_transform(image, transform)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    normalized.save(args.output, format="PNG")
    if args.write_transform:
        args.write_transform.parent.mkdir(parents=True, exist_ok=True)
        args.write_transform.write_text(json.dumps(transform, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_json(args.json, {"operation": "normalize", "output": str(args.output), "transform": transform})


def command_validate(args: argparse.Namespace) -> None:
    if not args.input.is_file():
        raise SystemExit(f"找不到输入图片: {args.input}")
    with Image.open(args.input) as image:
        bands = image.getbands()
        original_mode = image.mode
        image_info = dict(image.info)
        rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)

    height, width, _ = rgba.shape
    alpha = rgba[..., 3]
    bbox = alpha_bbox(alpha)
    failures: list[str] = []
    warnings: list[str] = []
    has_alpha = "A" in bands or (original_mode == "P" and "transparency" in image_info)
    if not has_alpha:
        failures.append("图片没有 alpha 通道")
    if args.expect_size and (width, height) != args.expect_size:
        failures.append(f"尺寸为 {width}x{height}，预期 {args.expect_size[0]}x{args.expect_size[1]}")
    if bbox is None:
        failures.append("没有可见人物像素")
        margins = None
        coverage = 0.0
    else:
        x0, y0, x1, y1 = bbox
        margins = {"left": x0, "top": y0, "right": width - x1, "bottom": height - y1}
        if min(margins.values()) <= 0:
            failures.append("人物触碰或越过画布边缘")
        elif min(margins.values()) < round(min(width, height) * args.min_margin_percent / 100.0):
            warnings.append("人物安全边距小于建议值")
        coverage = float(np.count_nonzero(alpha > 8) / (width * height))
        if coverage < 0.02:
            failures.append("可见人物覆盖率过低")
        if coverage > 0.90:
            warnings.append("人物覆盖率过高，可能缺少安全边距")

    corners = np.concatenate(
        (
            alpha[: args.corner_size, : args.corner_size].ravel(),
            alpha[: args.corner_size, -args.corner_size :].ravel(),
            alpha[-args.corner_size :, : args.corner_size].ravel(),
            alpha[-args.corner_size :, -args.corner_size :].ravel(),
        )
    )
    opaque_corner_fraction = float(np.count_nonzero(corners > 4) / len(corners))
    if opaque_corner_fraction > 0.01:
        failures.append("画布角落并非透明，疑似仍有背景")

    partial = (alpha > 0) & (alpha < 255)
    partial_count = int(np.count_nonzero(partial))
    if partial_count == 0:
        warnings.append("没有半透明抗锯齿像素，边缘可能偏硬")

    residual_fraction = None
    residual_opaque_pixels = None
    residual_opaque_fraction = None
    if args.key_color is not None:
        rgb = rgba[..., :3].astype(np.float32)
        distance = np.sqrt(np.sum((rgb - args.key_color) ** 2, axis=2))
        if partial_count:
            residual_fraction = float(np.count_nonzero(partial & (distance < 64)) / partial_count)
            if residual_fraction > 0.12:
                warnings.append("半透明边缘仍含较多色键颜色")
        visible_count = max(1, int(np.count_nonzero(alpha > 8)))
        residual_opaque_pixels = int(np.count_nonzero((alpha >= 128) & (distance < 64)))
        residual_opaque_fraction = float(residual_opaque_pixels / visible_count)
        if residual_opaque_pixels > 32 and residual_opaque_fraction > 0.001:
            failures.append("人物轮廓或封闭空隙内仍有不透明色键背景")
        elif residual_opaque_pixels > 8 and residual_opaque_fraction > 0.0001:
            warnings.append("画面内仍有少量不透明色键像素")

    status = "fail" if failures else ("warn" if warnings else "pass")
    report = {
        "operation": "validate",
        "status": status,
        "input": str(args.input),
        "mode": original_mode,
        "size": [width, height],
        "bbox": list(bbox) if bbox else None,
        "margins": margins,
        "visible_coverage": round(coverage, 6),
        "partial_alpha_pixels": partial_count,
        "opaque_corner_fraction": round(opaque_corner_fraction, 6),
        "residual_key_edge_fraction": round(residual_fraction, 6) if residual_fraction is not None else None,
        "residual_key_opaque_pixels": residual_opaque_pixels,
        "residual_key_opaque_fraction": round(residual_opaque_fraction, 8) if residual_opaque_fraction is not None else None,
        "warnings": warnings,
        "failures": failures,
    }
    write_json(args.json, report)
    if failures:
        raise SystemExit(2)


def command_compare(args: argparse.Namespace) -> None:
    for path in (args.base, args.variant):
        if not path.is_file():
            raise SystemExit(f"找不到图片: {path}")
    with Image.open(args.base) as image:
        base = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    with Image.open(args.variant) as image:
        variant = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    if base.shape != variant.shape:
        report = {
            "operation": "compare",
            "status": "fail",
            "failures": [f"尺寸不同: base={base.shape[1]}x{base.shape[0]}, variant={variant.shape[1]}x{variant.shape[0]}"],
        }
        write_json(args.json, report)
        raise SystemExit(2)

    base_alpha = base[..., 3]
    variant_alpha = variant[..., 3]
    bbox = alpha_bbox(base_alpha)
    if bbox is None:
        raise SystemExit("通常立绘没有可见人物像素")
    x0, y0, x1, y1 = bbox
    fx0, fy0, fx1, fy1 = args.face_box
    face_rect = (
        round(x0 + (x1 - x0) * fx0),
        round(y0 + (y1 - y0) * fy0),
        round(x0 + (x1 - x0) * fx1),
        round(y0 + (y1 - y0) * fy1),
    )
    face_mask = np.zeros(base_alpha.shape, dtype=bool)
    face_mask[face_rect[1] : face_rect[3], face_rect[0] : face_rect[2]] = True
    outside = ~face_mask

    base_visible = base_alpha > 8
    variant_visible = variant_alpha > 8
    intersection = base_visible & variant_visible & outside
    union = (base_visible | variant_visible) & outside
    alpha_iou = float(np.count_nonzero(intersection) / max(1, np.count_nonzero(union)))

    both_opaque = (base_alpha > 128) & (variant_alpha > 128) & outside
    if np.any(both_opaque):
        delta = np.abs(base[..., :3].astype(np.int16) - variant[..., :3].astype(np.int16))
        per_pixel = np.mean(delta, axis=2)
        rgb_mean = float(np.mean(per_pixel[both_opaque]))
        changed_fraction = float(np.count_nonzero(both_opaque & (per_pixel > args.changed_threshold)) / np.count_nonzero(both_opaque))
    else:
        rgb_mean = 255.0
        changed_fraction = 1.0

    warnings: list[str] = []
    failures: list[str] = []
    if alpha_iou < args.fail_alpha_iou:
        failures.append("脸部以外的轮廓变化过大")
    elif alpha_iou < args.warn_alpha_iou:
        warnings.append("脸部以外的轮廓存在可见变化")
    if rgb_mean > args.fail_rgb_mean:
        failures.append("脸部以外的颜色或线稿变化过大")
    elif rgb_mean > args.warn_rgb_mean:
        warnings.append("脸部以外的颜色或线稿存在可见变化")
    if changed_fraction > args.fail_changed_fraction:
        failures.append("脸部以外发生变化的像素比例过高")
    elif changed_fraction > args.warn_changed_fraction:
        warnings.append("脸部以外存在局部重绘")
    status = "fail" if failures else ("warn" if warnings else "pass")
    report = {
        "operation": "compare",
        "status": status,
        "base": str(args.base),
        "variant": str(args.variant),
        "face_rect_pixels": list(face_rect),
        "outside_face_alpha_iou": round(alpha_iou, 6),
        "outside_face_rgb_mean": round(rgb_mean, 6),
        "outside_face_changed_fraction": round(changed_fraction, 6),
        "warnings": warnings,
        "failures": failures,
    }
    write_json(args.json, report)
    if failures:
        raise SystemExit(2)


def checkerboard(size: tuple[int, int], block: int = 18) -> Image.Image:
    width, height = size
    yy, xx = np.indices((height, width))
    cells = ((xx // block) + (yy // block)) % 2
    values = np.where(cells[..., None] == 0, np.array([238, 238, 238]), np.array([207, 207, 207]))
    alpha = np.full((height, width, 1), 255, dtype=np.uint8)
    return Image.fromarray(np.concatenate((values.astype(np.uint8), alpha), axis=2), mode="RGBA")


def command_sheet(args: argparse.Namespace) -> None:
    for path in args.inputs:
        if not path.is_file():
            raise SystemExit(f"找不到图片: {path}")
    cell_width, cell_height = args.cell
    label_height = 34
    gap = 12
    sheet = Image.new(
        "RGBA",
        (gap + len(args.inputs) * (cell_width + gap), cell_height + label_height + gap * 2),
        (245, 245, 245, 255),
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, path in enumerate(args.inputs):
        x = gap + index * (cell_width + gap)
        panel = checkerboard((cell_width, cell_height))
        with Image.open(path) as source:
            sprite = source.convert("RGBA")
        sprite.thumbnail((cell_width - 16, cell_height - 16), Image.Resampling.LANCZOS)
        panel.alpha_composite(sprite, ((cell_width - sprite.width) // 2, cell_height - sprite.height - 8))
        sheet.alpha_composite(panel, (x, gap + label_height))
        label = path.stem
        text_box = draw.textbbox((0, 0), label, font=font)
        draw.text((x + (cell_width - (text_box[2] - text_box[0])) // 2, gap + 8), label, fill=(35, 35, 35, 255), font=font)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(args.out, quality=95)
    write_json(args.json, {"operation": "sheet", "output": str(args.out), "inputs": [str(path) for path in args.inputs]})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Galgame 立绘差分图像工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    choose = subparsers.add_parser("choose-key", help="从角色参考图自动选择冲突最小的色键")
    choose.add_argument("inputs", type=Path, nargs="+", help="一张或多张角色参考图")
    choose.add_argument("--preferred", default="#fc5d21", help="安全时优先使用的色键")
    choose.add_argument("--candidate", action="append", help="候选 #RRGGBB；可重复")
    choose.add_argument(
        "--reuse-reference-background",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="检测到安全的简单参考图背景时将其加入候选并优先复用",
    )
    choose.add_argument("--plain", action="store_true", help="只输出选中色号")
    choose.add_argument("--json", type=Path, help="同时保存 JSON 报告")
    choose.set_defaults(func=command_choose_key)

    rekey = subparsers.add_parser("rekey", help="把透明立绘铺到新的纯色色键背景")
    rekey.add_argument("input", type=Path, help="透明 PNG，优先使用规范化前的 cutout")
    rekey.add_argument("output", type=Path, help="新的不透明 PNG 色键源")
    rekey.add_argument("--key-color", type=parse_hex_color, required=True)
    rekey.add_argument("--json", type=Path, help="保存 JSON 报告")
    rekey.set_defaults(func=command_rekey)

    cutout = subparsers.add_parser("cutout", help="删除与画布边缘连通的纯色色键背景")
    cutout.add_argument("input", type=Path)
    cutout.add_argument("output", type=Path)
    cutout.add_argument("--key-color", type=parse_hex_color, help="固定色键；省略则采样边缘中位色")
    cutout.add_argument("--transparent-distance", type=float, default=28.0)
    cutout.add_argument("--opaque-distance", type=float, default=175.0)
    cutout.add_argument("--edge-radius", type=int, default=2)
    cutout.add_argument(
        "--scope",
        choices=("all", "border-connected"),
        default="all",
        help="all 会同时删除发丝等围成的封闭背景孔；默认 all",
    )
    cutout.add_argument("--soft-matte", action=argparse.BooleanOptionalAction, default=True)
    cutout.add_argument("--despill", action=argparse.BooleanOptionalAction, default=True)
    cutout.add_argument("--json", type=Path, help="保存 JSON 报告")
    cutout.set_defaults(func=command_cutout)

    normalize = subparsers.add_parser("normalize", help="把透明人物放入稳定的目标画布")
    normalize.add_argument("input", type=Path)
    normalize.add_argument("output", type=Path)
    group = normalize.add_mutually_exclusive_group(required=True)
    group.add_argument("--canvas", type=parse_size, help="新建基准变换时的目标尺寸")
    group.add_argument("--transform", type=Path, help="差分复用的基准变换 JSON")
    normalize.add_argument("--margin-percent", type=float, default=6.0)
    normalize.add_argument("--anchor", choices=("center", "bottom-center"), default="bottom-center")
    normalize.add_argument("--write-transform", type=Path, help="保存基准变换")
    normalize.add_argument("--json", type=Path, help="保存 JSON 报告")
    normalize.set_defaults(func=command_normalize)

    validate = subparsers.add_parser("validate", help="检查 alpha、尺寸、边距和残余色键")
    validate.add_argument("input", type=Path)
    validate.add_argument("--expect-size", type=parse_size)
    validate.add_argument("--key-color", type=parse_hex_color)
    validate.add_argument("--min-margin-percent", type=float, default=2.0)
    validate.add_argument("--corner-size", type=int, default=12)
    validate.add_argument("--json", type=Path, help="保存 JSON 报告")
    validate.set_defaults(func=command_validate)

    compare = subparsers.add_parser("compare", help="检查表情差分在脸部以外的漂移")
    compare.add_argument("base", type=Path)
    compare.add_argument("variant", type=Path)
    compare.add_argument("--face-box", type=parse_box, default=(0.22, 0.02, 0.78, 0.24))
    compare.add_argument("--warn-alpha-iou", type=float, default=0.92)
    compare.add_argument("--fail-alpha-iou", type=float, default=0.78)
    compare.add_argument("--warn-rgb-mean", type=float, default=24.0)
    compare.add_argument("--fail-rgb-mean", type=float, default=58.0)
    compare.add_argument("--changed-threshold", type=float, default=32.0)
    compare.add_argument("--warn-changed-fraction", type=float, default=0.015)
    compare.add_argument("--fail-changed-fraction", type=float, default=0.10)
    compare.add_argument("--json", type=Path, help="保存 JSON 报告")
    compare.set_defaults(func=command_compare)

    sheet = subparsers.add_parser("sheet", help="制作透明底预览联系表")
    sheet.add_argument("inputs", type=Path, nargs="+")
    sheet.add_argument("--out", type=Path, required=True)
    sheet.add_argument("--cell", type=parse_size, default=(360, 540))
    sheet.add_argument("--json", type=Path, help="保存 JSON 报告")
    sheet.set_defaults(func=command_sheet)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if hasattr(args, "edge_radius") and not 0 <= args.edge_radius <= 16:
        raise SystemExit("--edge-radius 须在 0 到 16 之间")
    if hasattr(args, "margin_percent") and not 0 <= args.margin_percent <= 25:
        raise SystemExit("--margin-percent 须在 0 到 25 之间")
    if hasattr(args, "corner_size") and args.corner_size < 1:
        raise SystemExit("--corner-size 须大于 0")
    args.func(args)


if __name__ == "__main__":
    main()
