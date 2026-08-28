#!/usr/bin/env python3
"""Deterministic regression test for prompt building and runtime package export."""

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


def run_failure(*args: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert result.returncode != 0
    return result


def make_sprite(path: Path, eye: str = "open", mouth: str = "closed") -> None:
    image = Image.new("RGBA", (128, 192), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((30, 10, 98, 78), fill=(245, 220, 205, 255), outline=(40, 32, 55, 255), width=2)
    draw.rectangle((38, 70, 90, 180), fill=(75, 55, 120, 255))
    brow_y = 33 if eye == "closed" else 32 if eye == "half" else 31
    draw.line((44, brow_y, 57, brow_y - 1), fill=(55, 35, 50, 255), width=2)
    draw.line((71, brow_y - 1, 84, brow_y), fill=(55, 35, 50, 255), width=2)
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
        "eyes_half": ("half", "closed", [42, 28, 86, 50]),
        "eyes_close": ("closed", "closed", [42, 28, 86, 50]),
        "mouth_half_open": ("open", "half", [55, 53, 73, 68]),
        "mouth_open": ("open", "open", [55, 53, 73, 68]),
    }
    runtime_assets = {}
    completed = {}
    for state, (eye, mouth, bbox) in states.items():
        asset_id = f"normal_idle__{state}"
        frame = root / "work" / f"{state}.png"
        make_sprite(frame, eye=eye, mouth=mouth)
        candidate = root / "work" / f"{state}-candidate.png"
        make_sprite(candidate, eye=eye, mouth=mouth)
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
            "candidate": str(candidate.relative_to(root)),
            "candidate_sha256": digest(candidate),
            "qa": str(qa.relative_to(root)),
            "qa_sha256": digest(qa),
        }
        if state.startswith("eyes_"):
            review = root / "work" / f"{state}-review.json"
            write_json(
                review,
                {
                    "operation": "eye-alignment-and-residue-review",
                    "status": "pass",
                    "state": state,
                    "candidate_sha256": digest(candidate),
                    "frame_sha256": digest(frame),
                    "anchors_pixels": {
                        "left_inner": [58, 42],
                        "left_outer": [44, 42],
                        "right_inner": [70, 42],
                        "right_outer": [84, 42],
                    },
                    "reviewer_note": "Synthetic lids retain all four corner anchors.",
                },
            )
            completed[asset_id]["eye_review"] = str(review.relative_to(root))
            completed[asset_id]["eye_review_sha256"] = digest(review)
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
    assert manifest["output"]["make_contact_sheet"] is False
    eye_prompt = (
        root / "run" / "work" / "prompts" / "runtime_normal_idle_eyes_close.txt"
    ).read_text(encoding="utf-8")
    assert "repaint the complete original open-eye construction" in eye_prompt
    assert "second arc" in eye_prompt
    assert "Image 2 is locator-only" in eye_prompt
    assert "exactly one intentional lid contour" in eye_prompt
    assert "both eyes and both eyebrows as one coherent blink state" in eye_prompt
    assert "exact local mother-frame hue" in eye_prompt
    reference_prompt = (root / "run" / "work" / "prompts" / "reference_normal.txt").read_text(encoding="utf-8")
    assert "genuine transparent alpha channel" in reference_prompt
    assert manifest["input_pipeline"]["opaque_source_action"] == "transparent-img2img"


def test_alpha_route(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    rgba = root / "rgba.png"
    opaque = root / "opaque.png"
    make_sprite(rgba)
    Image.new("RGB", (64, 64), (20, 30, 40)).save(opaque)
    rgba_json = root / "rgba.json"
    opaque_json = root / "opaque.json"
    run(sys.executable, str(ROOT / "scripts" / "sprite_tools.py"), "alpha-route", str(rgba), "--json", str(rgba_json))
    run(sys.executable, str(ROOT / "scripts" / "sprite_tools.py"), "alpha-route", str(opaque), "--json", str(opaque_json))
    assert json.loads(rgba_json.read_text(encoding="utf-8"))["route"] == "use-authoritative-rgba"
    assert json.loads(opaque_json.read_text(encoding="utf-8"))["route"] == "opaque-reference-to-transparent-img2img"


def test_eye_mask_and_review(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    base = root / "base.png"
    candidate = root / "candidate.png"
    frame = root / "frame.png"
    make_sprite(base, eye="open")
    make_sprite(candidate, eye="closed")
    make_sprite(frame, eye="closed")
    allow = root / "eyes_allow.png"
    api = root / "eyes_api.png"
    overlay = root / "eyes_overlay.png"
    mask_json = root / "eyes_mask.json"
    run(
        sys.executable,
        str(ROOT / "scripts" / "face_parts.py"),
        "mask",
        "--base",
        str(base),
        "--ellipse",
        "0.398,0.219,0.09,0.07",
        "--ellipse",
        "0.602,0.219,0.09,0.07",
        "--brow-ellipse",
        "0.398,0.166,0.10,0.025",
        "--brow-ellipse",
        "0.602,0.166,0.10,0.025",
        "--feather",
        "4",
        "--allow-out",
        str(allow),
        "--api-out",
        str(api),
        "--overlay-out",
        str(overlay),
        "--json",
        str(mask_json),
    )
    allow_pixels = np.asarray(Image.open(allow).convert("L"))
    assert allow_pixels[42, 51] == 255
    assert np.any((allow_pixels > 0) & (allow_pixels < 255))
    mask_data = json.loads(mask_json.read_text(encoding="utf-8"))
    assert mask_data["feather_mode"] == "finite-outward-cosine-solid-core"
    assert len(mask_data["brow_ellipses_normalized"]) == 2
    assert mask_data["bbox"][1] < 32

    plate = root / "eyes-edit-plate.png"
    plate_map = root / "eyes-edit-plate.json"
    run(
        sys.executable,
        str(ROOT / "scripts" / "face_parts.py"),
        "edit-plate",
        "--base",
        str(base),
        "--mask",
        str(allow),
        "--context-scale",
        "2.4",
        "--plate-size",
        "256",
        "--out",
        str(plate),
        "--json",
        str(plate_map),
    )
    plate_data = json.loads(plate_map.read_text(encoding="utf-8"))
    assert plate_data["operation"] == "prepare-fixed-registration-edit-plate"
    assert Image.open(plate).size == (256, 256)
    guide = root / "eyes-anchor-guide.png"
    guide_json = root / "eyes-anchor-guide.json"
    run(
        sys.executable,
        str(ROOT / "scripts" / "face_parts.py"),
        "anchor-guide",
        "--plate",
        str(plate),
        "--plate-map",
        str(plate_map),
        "--left-inner",
        "0.46,0.22",
        "--left-outer",
        "0.34,0.22",
        "--right-inner",
        "0.54,0.22",
        "--right-outer",
        "0.66,0.22",
        "--out",
        str(guide),
        "--json",
        str(guide_json),
    )
    guide_data = json.loads(guide_json.read_text(encoding="utf-8"))
    assert guide_data["operation"] == "eye-anchor-locator-guide"
    assert len(guide_data["anchors_plate_pixels"]) == 4
    assert guide_data["usage"] == "locator-reference-only-never-an-edit-target"
    crop_box = tuple(plate_data["crop_bbox"])
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    candidate_plate = root / "candidate-edit-plate.png"
    Image.open(candidate).convert("RGBA").crop(crop_box).resize(
        (384, 384), resample=resampling
    ).save(candidate_plate)
    composed = root / "composed-from-plate.png"
    compose_json = root / "composed-from-plate.json"
    run(
        sys.executable,
        str(ROOT / "scripts" / "face_parts.py"),
        "compose",
        "--base",
        str(base),
        "--candidate",
        str(candidate_plate),
        "--plate-map",
        str(plate_map),
        "--mask",
        str(allow),
        "--frame",
        str(composed),
        "--json",
        str(compose_json),
    )
    compose_data = json.loads(compose_json.read_text(encoding="utf-8"))
    assert compose_data["candidate_kind"] == "fixed-registration-edit-plate"
    assert compose_data["candidate_source_size"] == [384, 384]
    assert compose_data["outside_mask_changed_pixels"] == 0
    assert compose_data["surface_rgb_p95_delta"] <= 28

    review = root / "eye-review.png"
    review_json = root / "eye-review.json"
    run(
        sys.executable,
        str(ROOT / "scripts" / "face_parts.py"),
        "eye-review",
        "--base",
        str(base),
        "--candidate",
        str(candidate_plate),
        "--plate-map",
        str(plate_map),
        "--frame",
        str(composed),
        "--mask",
        str(allow),
        "--state",
        "eyes_close",
        "--left-inner",
        "0.46,0.22",
        "--left-outer",
        "0.34,0.22",
        "--right-inner",
        "0.54,0.22",
        "--right-outer",
        "0.66,0.22",
        "--verdict",
        "pass",
        "--reviewer-note",
        "Synthetic closed lids keep all four endpoints on the base anchors.",
        "--out",
        str(review),
        "--json",
        str(review_json),
    )
    assert review.is_file()
    review_data = json.loads(review_json.read_text(encoding="utf-8"))
    assert review_data["operation"] == "eye-alignment-and-residue-review"
    assert review_data["status"] == "pass"
    assert len(review_data["anchors_pixels"]) == 4
    assert "remote black block" in " ".join(review_data["required_visual_checks"])
    assert review_data["crop_bbox"][1] == 0

    tinted = Image.open(candidate_plate).convert("RGBA")
    tint_draw = ImageDraw.Draw(tinted)
    tint_draw.rectangle((80, 40, 300, 180), fill=(220, 150, 150, 255))
    tinted_path = root / "candidate-tinted.png"
    tinted.save(tinted_path)
    failed_json = root / "tinted-compose.json"
    run_failure(
        sys.executable,
        str(ROOT / "scripts" / "face_parts.py"),
        "compose",
        "--base",
        str(base),
        "--candidate",
        str(tinted_path),
        "--plate-map",
        str(plate_map),
        "--mask",
        str(allow),
        "--frame",
        str(root / "tinted-frame.png"),
        "--json",
        str(failed_json),
    )
    failed_data = json.loads(failed_json.read_text(encoding="utf-8"))
    assert failed_data["status"] == "fail"
    assert any("色" in item or "纹理" in item for item in failed_data["failures"])


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="gal-sprite-self-test-") as directory:
        root = Path(directory)
        test_prompt_build(root / "prompt-build")
        test_alpha_route(root / "alpha-route")
        test_export(root / "export")
        test_eye_mask_and_review(root / "eye-review")
    print("self-test: pass")


if __name__ == "__main__":
    main()
