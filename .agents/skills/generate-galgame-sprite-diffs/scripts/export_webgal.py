#!/usr/bin/env python3
"""Export approved v3 sprite runs as WebGAL-ready full-frame assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


STATE_SUFFIX = {
    "eyes_close": "eyes_close",
    "eyes_half": "eyes_half",
    "mouth_half_open": "mouth_half_open",
    "mouth_open": "mouth_open",
}
WEBGAL_PARAMETER = {
    "eyes_close": "eyesClose",
    "mouth_half_open": "mouthHalfOpen",
    "mouth_open": "mouthOpen",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve(root: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


def load_manifest(path: Path) -> dict:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取 manifest {path}: {exc}") from exc
    if manifest.get("schema_version") != 3 or manifest.get("state") != "COMPLETE":
        raise SystemExit("只可导出 state=COMPLETE 的 schema_version=3 运行")
    return manifest


def verify_record(root: Path, record: dict, label: str) -> None:
    for key, hash_key in (("source", "source_sha256"), ("final", "final_sha256")):
        path = resolve(root, record[key])
        if sha256(path) != record[hash_key]:
            raise SystemExit(f"{label} 的 {key} 文件发生了变化")


def verify_approvals(root: Path, manifest: dict) -> None:
    verify_record(root, manifest["approved_base"], "标准基准")
    for pose, record in manifest["approved_poses"].items():
        verify_record(root, record, f"姿势 {pose}")
    for expression, record in manifest["approved_expressions"].items():
        verify_record(root, record, f"表情 {expression}")


def approved_base_path(root: Path, manifest: dict, runtime_base: dict) -> Path:
    if runtime_base["kind"] == "pose":
        record = manifest["approved_poses"][runtime_base["source_id"]]
    elif runtime_base["kind"] == "expression":
        record = manifest["approved_expressions"][runtime_base["source_id"]]
    else:
        raise SystemExit(f"未知 runtime base kind: {runtime_base['kind']}")
    return resolve(root, record["final"])


def copy_png(source: Path, destination: Path, size: tuple[int, int]) -> None:
    try:
        with Image.open(source) as image:
            image.load()
            if image.size != size:
                raise SystemExit(
                    f"{source} 尺寸 {image.width}x{image.height} 与运行画布 "
                    f"{size[0]}x{size[1]} 不一致"
                )
            if "A" not in image.getbands() and not (
                image.mode == "P" and "transparency" in image.info
            ):
                raise SystemExit(f"{source} 没有透明通道")
    except OSError as exc:
        raise SystemExit(f"图片无法完整读取 {source}: {exc}") from exc
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def checkerboard(size: tuple[int, int], tile: int = 14) -> Image.Image:
    width, height = size
    yy, xx = np.indices((height, width))
    pattern = ((xx // tile + yy // tile) % 2).astype(np.uint8)
    colors = np.array([[244, 244, 244], [218, 218, 218]], dtype=np.uint8)
    return Image.fromarray(colors[pattern], mode="RGB").convert("RGBA")


def get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    if font_path.is_file():
        return ImageFont.truetype(str(font_path), size=size)
    return ImageFont.load_default()


def preview_panel(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as image:
        sprite = image.convert("RGBA")
        sprite.load()
    sprite.thumbnail((size[0] - 16, size[1] - 16), Image.Resampling.LANCZOS)
    panel = checkerboard(size)
    panel.alpha_composite(
        sprite,
        ((size[0] - sprite.width) // 2, size[1] - sprite.height - 8),
    )
    return panel


def make_contact_sheet(
    figures: dict[str, dict],
    deliverables: Path,
    output: Path,
) -> None:
    columns = ("base", "eyesClose", "mouthHalfOpen", "mouthOpen")
    labels = ("BASE", "EYES CLOSE", "MOUTH HALF", "MOUTH OPEN")
    cell = (250, 360)
    header_height = 42
    row_label_width = 160
    canvas = Image.new(
        "RGBA",
        (
            row_label_width + len(columns) * cell[0],
            header_height + len(figures) * cell[1],
        ),
        (239, 241, 246, 255),
    )
    draw = ImageDraw.Draw(canvas)
    header_font = get_font(17)
    row_font = get_font(17)
    for column, label in enumerate(labels):
        x = row_label_width + column * cell[0]
        draw.rectangle((x, 0, x + cell[0], header_height), fill=(29, 34, 48, 255))
        box = draw.textbbox((0, 0), label, font=header_font)
        draw.text(
            (x + (cell[0] - (box[2] - box[0])) // 2, 10),
            label,
            font=header_font,
            fill=(255, 255, 255, 255),
        )
    for row, (runtime_id, entry) in enumerate(figures.items()):
        y = header_height + row * cell[1]
        draw.rectangle((0, y, row_label_width, y + cell[1]), fill=(46, 53, 73, 255))
        box = draw.textbbox((0, 0), runtime_id, font=row_font)
        draw.text(
            (
                (row_label_width - (box[2] - box[0])) // 2,
                y + (cell[1] - (box[3] - box[1])) // 2,
            ),
            runtime_id,
            font=row_font,
            fill=(255, 255, 255, 255),
        )
        paths = {
            "base": entry["files"]["base"],
            **entry["webgal"],
        }
        for column, key in enumerate(columns):
            path_value = paths.get(key)
            x = row_label_width + column * cell[0]
            if path_value:
                filename = Path(path_value).name
                canvas.alpha_composite(
                    preview_panel(deliverables / "figures" / filename, cell),
                    (x, y),
                )
            else:
                draw.rectangle((x, y, x + cell[0], y + cell[1]), fill=(225, 227, 232, 255))
                text = "FIXED / N.A."
                box = draw.textbbox((0, 0), text, font=header_font)
                draw.text(
                    (
                        x + (cell[0] - (box[2] - box[0])) // 2,
                        y + (cell[1] - (box[3] - box[1])) // 2,
                    ),
                    text,
                    font=header_font,
                    fill=(105, 108, 117, 255),
                )
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, format="JPEG", quality=94)


def make_gif(entry: dict, deliverables: Path, output: Path) -> None:
    files = entry["files"]
    base = deliverables / "figures" / Path(files["base"]).name
    states = {key: deliverables / "figures" / Path(value).name for key, value in files["states"].items()}
    sequence: list[tuple[Path, int]] = [(base, 900)]
    if "eyes_close" in states:
        sequence.extend(((states["eyes_close"], 90), (base, 650)))
    if "mouth_half_open" in states and "mouth_open" in states:
        sequence.extend(
            (
                (states["mouth_half_open"], 105),
                (states["mouth_open"], 115),
                (states["mouth_half_open"], 105),
                (base, 180),
                (states["mouth_half_open"], 105),
                (states["mouth_open"], 115),
                (states["mouth_half_open"], 105),
                (base, 600),
            )
        )
    frames: list[Image.Image] = []
    durations: list[int] = []
    for path, duration in sequence:
        frames.append(preview_panel(path, (512, 768)).convert("P", palette=Image.Palette.ADAPTIVE, colors=255))
        durations.append(duration)
    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=True,
    )


def verify_deliverable_images(deliverables: Path) -> list[dict]:
    files: list[dict] = []
    for path in sorted(deliverables.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif"}:
            continue
        try:
            with Image.open(path) as image:
                frame_count = getattr(image, "n_frames", 1)
                for index in range(frame_count):
                    image.seek(index)
                    image.load()
                size = image.size
        except OSError as exc:
            raise SystemExit(f"交付图片无法完整读取 {path}: {exc}") from exc
        files.append(
            {
                "path": str(path.relative_to(deliverables)),
                "size": list(size),
                "frames": frame_count,
                "sha256": sha256(path),
            }
        )
    return files


def build_readme(slug: str, canvas: tuple[int, int], figures: dict[str, dict]) -> str:
    lines = [
        f"# {slug} · WebGAL 图片立绘口型差分",
        "",
        f"所有 `figures/` 图片均为 `{canvas[0]}×{canvas[1]}` 的同位置透明完整帧，可直接交给 WebGAL；它们不是局部小图。",
        "",
        "## 使用",
        "",
        f"把 `figures/` 内的文件复制到 WebGAL 工程的 `game/figure/{slug}/`，然后参考 `webgal-manifest.json` 或下表的脚本行。",
        "",
        "| 运行时 ID | 表情／姿势 | 眨眼策略 | WebGAL 示例 |",
        "| --- | --- | --- | --- |",
    ]
    for runtime_id, entry in figures.items():
        script = entry["changeFigure_example"].replace("|", "\\|")
        lines.append(
            f"| `{runtime_id}` | {entry['label']} | `{entry['blink']}` | `{script}` |"
        )
    lines.extend(
        [
            "",
            "## 规则",
            "",
            "- `base` 同时是默认图与 `mouthClose`；动态睁眼时也复用为 `eyesOpen`。",
            "- `laugh`、`thinking` 等 `fixed-closed` 项不会注册 `eyesOpen/eyesClose`，因此不会被随机眨眼切回睁眼。",
            "- 两档嘴型是相邻幅度：`mouthOpen` 只比 `mouthHalfOpen` 稍大，不应出现小嘴与夸张大嘴之间跳变。",
            "- `previews/` 仅供验收，不需要放进游戏。",
            "- `work/` 中的模型候选、蒙版、局部零件、提示词和 QA 是测试工程文件，不属于正式 WebGAL 资源。",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="导出 WebGAL 可直接使用的完整立绘帧")
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    root = manifest_path.parent
    manifest = load_manifest(manifest_path)
    verify_approvals(root, manifest)
    source_manifest_sha = sha256(manifest_path)
    slug = manifest["character_slug"]
    width, height = (int(value) for value in manifest["render"]["size"].split("x"))
    canvas = (width, height)
    deliverables = root / manifest["files"]["directories"]["deliverables"]
    figures_dir = deliverables / "figures"
    previews_dir = deliverables / "previews"
    figures_dir.mkdir(parents=True, exist_ok=True)
    previews_dir.mkdir(parents=True, exist_ok=True)

    completed = manifest.get("completed_runtime", {})
    exported: dict[str, dict] = {}
    for runtime_id, base in manifest["runtime_bases"].items():
        base_source = approved_base_path(root, manifest, base)
        base_name = f"{slug}_{runtime_id}_base.png"
        copy_png(base_source, figures_dir / base_name, canvas)
        states: dict[str, str] = {}
        webgal: dict[str, str] = {}
        for asset_id, asset in manifest["runtime_assets"].items():
            if asset["runtime_id"] != runtime_id:
                continue
            record = completed.get(asset_id)
            if record is None:
                raise SystemExit(f"completed_runtime 缺少 {asset_id}")
            frame = resolve(root, record["frame"])
            if sha256(frame) != record["frame_sha256"]:
                raise SystemExit(f"运行时完整帧发生变化: {asset_id}")
            state = asset["state"]
            destination_name = f"{slug}_{runtime_id}_{STATE_SUFFIX[state]}.png"
            copy_png(frame, figures_dir / destination_name, canvas)
            resource_path = f"{slug}/{destination_name}"
            states[state] = resource_path
            if state in WEBGAL_PARAMETER:
                webgal[WEBGAL_PARAMETER[state]] = resource_path

        base_resource = f"{slug}/{base_name}"
        policy = base["policy"]
        if policy["mouth_sync"]:
            webgal["mouthClose"] = base_resource
        if policy["blink"] == "dynamic":
            webgal["eyesOpen"] = base_resource
            if "eyesClose" not in webgal:
                raise SystemExit(f"{runtime_id} 声明动态眨眼但没有 eyes_close")
        elif "eyesClose" in webgal:
            raise SystemExit(f"{runtime_id} 是固定眼睛状态却导出了 eyesClose")

        parameter_order = ("mouthOpen", "mouthHalfOpen", "mouthClose", "eyesOpen", "eyesClose")
        parameter_text = " ".join(
            f"-{key}={webgal[key]}" for key in parameter_order if key in webgal
        )
        script = f"changeFigure:{base_resource} -id={slug}"
        if parameter_text:
            script += f" {parameter_text}"
        script += ";"
        exported[runtime_id] = {
            "label": base["label"],
            "pose": base["pose"],
            "blink": policy["blink"],
            "mouth_sync": policy["mouth_sync"],
            "files": {"base": base_resource, "states": states},
            "webgal": webgal,
            "changeFigure_example": script,
        }

    webgal_manifest = {
        "schema_version": 1,
        "engine": "WebGAL image figure",
        "generated_at": now(),
        "canvas": {"width": width, "height": height},
        "install_to": f"game/figure/{slug}/",
        "source_manifest_sha256": source_manifest_sha,
        "figures": exported,
    }
    webgal_manifest_path = deliverables / "webgal-manifest.json"
    atomic_json(webgal_manifest_path, webgal_manifest)

    readme_path = deliverables / "README.md"
    readme_path.write_text(build_readme(slug, canvas, exported), encoding="utf-8")

    if manifest["output"].get("make_contact_sheet"):
        make_contact_sheet(exported, deliverables, previews_dir / f"{slug}_webgal_contact_sheet.jpg")
    if manifest["output"].get("make_demo_gifs"):
        for runtime_id, entry in exported.items():
            make_gif(entry, deliverables, previews_dir / f"{slug}_{runtime_id}_demo.gif")

    image_files = verify_deliverable_images(deliverables)
    inventory_files = []
    for path in sorted(deliverables.rglob("*")):
        if path.is_file() and path.name != "inventory.json":
            inventory_files.append(
                {
                    "path": str(path.relative_to(deliverables)),
                    "bytes": path.stat().st_size,
                    "sha256": sha256(path),
                }
            )
    inventory = {
        "generated_at": now(),
        "file_count": len(inventory_files),
        "image_file_count": len(image_files),
        "image_frame_count": sum(item["frames"] for item in image_files),
        "files": inventory_files,
        "images": image_files,
    }
    inventory_path = deliverables / "inventory.json"
    atomic_json(inventory_path, inventory)

    manifest["export"] = {
        "exported_at": now(),
        "deliverables": str(deliverables.relative_to(root)),
        "webgal_manifest": str(webgal_manifest_path.relative_to(root)),
        "webgal_manifest_sha256": sha256(webgal_manifest_path),
        "readme": str(readme_path.relative_to(root)),
        "inventory": str(inventory_path.relative_to(root)),
        "inventory_sha256": sha256(inventory_path),
    }
    manifest["updated_at"] = now()
    atomic_json(manifest_path, manifest)
    print(
        json.dumps(
            {
                "deliverables": str(deliverables),
                "runtime_bases": len(exported),
                "figure_pngs": len(list(figures_dir.glob("*.png"))),
                "image_files": len(image_files),
                "image_frames": inventory["image_frame_count"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
