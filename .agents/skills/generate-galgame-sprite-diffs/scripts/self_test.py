#!/usr/bin/env python3
"""Deterministic regression test for cutout review and runtime package export."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def test_cutout(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    source = root / "cutout-source.png"
    output = root / "cutout.png"
    report = root / "cutout.json"
    review = root / "cutout-review.jpg"
    scale = 4
    image = Image.new("RGB", (256 * scale, 384 * scale), (0, 242, 81))
    draw = ImageDraw.Draw(image)
    draw.ellipse((70 * scale, 30 * scale, 190 * scale, 160 * scale), fill=(244, 221, 205))
    draw.polygon(
        ((84 * scale, 45 * scale), (128 * scale, 12 * scale), (176 * scale, 45 * scale), (196 * scale, 230 * scale), (62 * scale, 230 * scale)),
        fill=(224, 226, 239),
    )
    draw.rectangle((82 * scale, 135 * scale, 174 * scale, 340 * scale), fill=(65, 50, 108))
    image.resize((256, 384), Image.Resampling.LANCZOS).save(source)
    run(
        sys.executable,
        str(ROOT / "scripts" / "sprite_tools.py"),
        "cutout",
        str(source),
        str(output),
        "--scope",
        "all",
        "--auto-refine",
        "--review-out",
        str(review),
        "--json",
        str(report),
    )
    data = json.loads(report.read_text(encoding="utf-8"))
    assert data["auto_refine"] is True
    assert len(data["candidates"]) >= 2
    assert review.is_file()
    with Image.open(output) as cutout:
        cutout.load()
        assert "A" in cutout.getbands()


def make_sprite(path: Path, eye: str = "open", mouth: str = "closed") -> None:
    image = Image.new("RGBA", (128, 192), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((30, 10, 98, 78), fill=(245, 220, 205, 255), outline=(40, 32, 55, 255), width=2)
    draw.rectangle((38, 70, 90, 180), fill=(75, 55, 120, 255))
    if eye == "closed":
        draw.line((45, 42, 57, 42), fill=(45, 30, 55, 255), width=3)
        draw.line((71, 42, 83, 42), fill=(45, 30, 55, 255), width=3)
    elif eye == "half":
        draw.arc((44, 36, 58, 47), 0, 180, fill=(45, 30, 55, 255), width=3)
        draw.arc((70, 36, 84, 47), 0, 180, fill=(45, 30, 55, 255), width=3)
    else:
        draw.ellipse((47, 37, 55, 47), fill=(95, 50, 130, 255))
        draw.ellipse((73, 37, 81, 47), fill=(95, 50, 130, 255))
    if mouth == "half":
        draw.ellipse((59, 57, 69, 62), fill=(120, 40, 60, 255))
    elif mouth == "open":
        draw.ellipse((58, 56, 70, 64), fill=(105, 30, 50, 255))
    else:
        draw.line((60, 59, 68, 59), fill=(90, 45, 55, 255), width=2)
    image.save(path)


def test_export(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    base = root / "work" / "base.png"
    source = root / "work" / "base-source.png"
    base.parent.mkdir(parents=True, exist_ok=True)
    make_sprite(base)
    make_sprite(source)
    states = {
        "eyes_half": ("half", "closed", [42, 34, 86, 50]),
        "eyes_close": ("closed", "closed", [42, 34, 86, 50]),
        "mouth_half_open": ("open", "half", [55, 53, 73, 68]),
        "mouth_open": ("open", "open", [55, 53, 73, 68]),
    }
    runtime_assets = {}
    completed = {}
    for state, (eye, mouth, bbox) in states.items():
        asset_id = f"normal_idle__{state}"
        frame = root / "work" / f"{state}.png"
        make_sprite(frame, eye=eye, mouth=mouth)
        qa = root / "work" / f"{state}.json"
        write_json(qa, {"mask_bbox": bbox, "outside_mask_changed_pixels": 0})
        runtime_assets[asset_id] = {
            "runtime_id": "normal_idle",
            "state": state,
            "region": "eyes" if state.startswith("eyes_") else "mouth",
            "mask_profile": "idle",
        }
        completed[asset_id] = {
            "frame": str(frame.relative_to(root)),
            "frame_sha256": digest(frame),
            "qa": str(qa.relative_to(root)),
            "qa_sha256": digest(qa),
        }
    record = {
        "source": str(source.relative_to(root)),
        "source_sha256": digest(source),
        "final": str(base.relative_to(root)),
        "final_sha256": digest(base),
    }
    manifest = {
        "schema_version": 3,
        "state": "COMPLETE",
        "character_slug": "tester",
        "render": {"size": "128x192"},
        "approved_base": record,
        "approved_poses": {"idle": record},
        "approved_expressions": {},
        "runtime_bases": {
            "normal_idle": {
                "kind": "pose",
                "source_id": "idle",
                "pose": "idle",
                "label": "通常／自然交流",
                "policy": {
                    "blink": "dynamic",
                    "mouth_sync": True,
                    "extra_states": ["eyes_half"],
                    "mask_profile": "idle",
                },
            }
        },
        "runtime_assets": runtime_assets,
        "completed_runtime": completed,
        "files": {"directories": {"deliverables": "deliverables"}},
        "output": {
            "export_local_parts": True,
            "include_compositor_runtime": True,
            "make_contact_sheet": True,
            "make_demo_gifs": False,
        },
    }
    manifest_path = root / "manifest.json"
    write_json(manifest_path, manifest)
    run(sys.executable, str(ROOT / "scripts" / "export_webgal.py"), str(manifest_path))

    deliverables = root / "deliverables"
    runtime_manifest = json.loads(
        (deliverables / "runtime" / "runtime-manifest.json").read_text(encoding="utf-8")
    )
    assert runtime_manifest["patch_mode"] == "replace-rect"
    figure = runtime_manifest["figures"]["normal_idle"]
    base_pixels = np.asarray(Image.open(deliverables / "figures" / "tester_normal_idle_base.png").convert("RGBA")).copy()
    for state, part in figure["parts"].items():
        reconstructed = base_pixels.copy()
        rect = part["rect"]
        patch = np.asarray(Image.open(deliverables / "runtime" / part["file"]).convert("RGBA"))
        x, y, width, height = rect["x"], rect["y"], rect["width"], rect["height"]
        reconstructed[y : y + height, x : x + width] = patch
        expected = np.asarray(Image.open(root / completed[f"normal_idle__{state}"]["frame"]).convert("RGBA"))
        assert np.array_equal(reconstructed, expected), state
    assert not list((deliverables / "previews").glob("*.gif"))
    assert (deliverables / "runtime" / "sprite-compositor.js").is_file()
    assert (deliverables / "runtime" / "preview.html").is_file()


def test_prompt_build(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    config = json.loads((ROOT / "references" / "default-config.json").read_text(encoding="utf-8"))
    config["character"]["slug"] = "tester"
    config["character"]["description"] = "A compact test character"
    config["$schema"] = str(ROOT / "references" / "config.schema.json")
    config_path = root / "config.json"
    write_json(config_path, config)
    run(
        sys.executable,
        str(ROOT / "scripts" / "build_prompts.py"),
        "--config",
        str(config_path),
        "--key-color",
        "#fc5d21",
        "--out",
        str(root / "run"),
    )
    manifest = json.loads((root / "run" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["generation_summary"]["total_calls"] == 42
    assert (root / "run" / "deliverables" / "parts").is_dir()
    assert (root / "run" / "deliverables" / "runtime").is_dir()
    assert manifest["output"]["make_demo_gifs"] is False


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="gal-sprite-self-test-") as directory:
        root = Path(directory)
        test_prompt_build(root / "prompt-build")
        test_cutout(root / "cutout")
        test_export(root / "export")
    print("self-test: pass")


if __name__ == "__main__":
    main()
