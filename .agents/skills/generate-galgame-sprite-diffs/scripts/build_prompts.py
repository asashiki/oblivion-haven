#!/usr/bin/env python3
"""Build deterministic prompts and a v3 sprite-difference run manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
SIZE = re.compile(r"^([1-9][0-9]*)x([1-9][0-9]*)$")
ID = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
REFERENCE_ROLES = {
    "primary-character",
    "supporting-character",
    "detail-style",
    "pose-only",
}
BASE_RUNTIME_STATES = ("eyes_close", "mouth_half_open", "mouth_open")
EXTRA_RUNTIME_STATES = {"eyes_half"}


def normalize_references(values: object) -> list[dict[str, str]]:
    if not isinstance(values, list):
        raise SystemExit("character.reference_images 必须是数组")
    if not values:
        return []

    normalized: list[dict[str, str]] = []
    has_structured_item = any(isinstance(item, dict) for item in values)
    explicit_primary_count = sum(
        1
        for item in values
        if isinstance(item, dict) and item.get("role") == "primary-character"
    )
    if explicit_primary_count > 1:
        raise SystemExit("character.reference_images 只能有一张 primary-character")

    for index, item in enumerate(values):
        if isinstance(item, str):
            path = item.strip()
            if not path:
                raise SystemExit("character.reference_images 不可包含空路径")
            if not has_structured_item:
                role = "primary-character" if index == 0 else "supporting-character"
            elif explicit_primary_count == 0 and not normalized:
                role = "primary-character"
            else:
                role = "supporting-character"
            normalized.append({"path": path, "role": role, "note": ""})
            continue

        if not isinstance(item, dict):
            raise SystemExit("character.reference_images 的条目必须是路径字符串或角色对象")
        path = str(item.get("path", "")).strip()
        role = str(item.get("role", "")).strip()
        note = str(item.get("note", "")).strip()
        if not path:
            raise SystemExit("结构化参考图缺少 path")
        if role not in REFERENCE_ROLES:
            raise SystemExit(f"不支持的参考图 role: {role}")
        normalized.append({"path": path, "role": role, "note": note})

    primary_count = sum(item["role"] == "primary-character" for item in normalized)
    if primary_count != 1:
        raise SystemExit("有参考图时必须且只能指定一张 primary-character")
    return normalized


def validate_runtime_policy(policy: object, owner: str, mask_profiles: set[str]) -> dict:
    if not isinstance(policy, dict):
        raise SystemExit(f"{owner}.runtime 必须是对象")
    blink = policy.get("blink")
    if blink not in {"dynamic", "fixed-open", "fixed-closed"}:
        raise SystemExit(f"{owner}.runtime.blink 不受支持: {blink}")
    if not isinstance(policy.get("mouth_sync"), bool):
        raise SystemExit(f"{owner}.runtime.mouth_sync 必须是布尔值")
    extras = policy.get("extra_states")
    if not isinstance(extras, list) or len(extras) != len(set(extras)):
        raise SystemExit(f"{owner}.runtime.extra_states 必须是无重复数组")
    unknown = sorted(set(extras) - EXTRA_RUNTIME_STATES)
    if unknown:
        raise SystemExit(f"{owner}.runtime.extra_states 不受支持: {', '.join(unknown)}")
    mask_profile = str(policy.get("mask_profile", ""))
    if mask_profile not in mask_profiles:
        raise SystemExit(f"{owner}.runtime.mask_profile 未对应任何姿势: {mask_profile}")
    return policy


def load_config(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取配置 {path}: {exc}") from exc

    required = (
        "character",
        "render",
        "pose_design",
        "chroma_key",
        "poses",
        "expressions",
        "runtime",
        "qa",
        "workflow",
        "output",
    )
    for key in required:
        if key not in data:
            raise SystemExit(f"配置缺少字段: {key}")
    if data.get("schema_version") != 3:
        raise SystemExit("当前生成器要求 schema_version=3")
    input_pipeline = data.setdefault(
        "input_pipeline",
        {
            "mode": "auto-alpha-first",
            "opaque_source_action": "transparent-img2img",
            "transparent_retry_limit": 1,
            "allow_chroma_fallback": False,
            "preserve_source_canvas_when_reusing_pose": True,
        },
    )
    if input_pipeline.get("mode") != "auto-alpha-first":
        raise SystemExit("input_pipeline.mode 必须为 auto-alpha-first")
    if input_pipeline.get("opaque_source_action") != "transparent-img2img":
        raise SystemExit("不透明输入必须先走 transparent-img2img")
    if not isinstance(input_pipeline.get("allow_chroma_fallback"), bool):
        raise SystemExit("input_pipeline.allow_chroma_fallback 必须是布尔值")

    slug = data["character"].get("slug", "")
    if not ID.fullmatch(slug):
        raise SystemExit("character.slug 只能包含小写字母、数字、下划线和连字符")
    references = normalize_references(data["character"].get("reference_images", []))
    data["character"]["reference_images"] = references
    if not data["character"].get("description", "").strip() and not references:
        raise SystemExit("须提供 character.description 或至少一张 character.reference_images")

    size_match = SIZE.fullmatch(data["render"].get("size", ""))
    if not size_match:
        raise SystemExit("render.size 须为 WIDTHxHEIGHT，例如 1024x1536")
    width, height = map(int, size_match.groups())
    if width % 16 or height % 16:
        raise SystemExit("gpt-image-2 尺寸的两条边都须为 16 的倍数")
    if max(width, height) > 3840 or max(width, height) / min(width, height) > 3:
        raise SystemExit("render.size 超出 gpt-image-2 的边长或长宽比限制")
    if not 655_360 <= width * height <= 8_294_400:
        raise SystemExit("render.size 的总像素须在 655360 到 8294400 之间")

    poses = data["poses"]
    if not isinstance(poses, list) or not poses:
        raise SystemExit("poses 至少须包含一个姿势")
    pose_ids = [item.get("id") for item in poses]
    if len(pose_ids) != len(set(pose_ids)) or any(not ID.fullmatch(str(value or "")) for value in pose_ids):
        raise SystemExit("poses.id 必须唯一且只含小写字母、数字、下划线和连字符")
    mask_profiles = set(pose_ids)
    for pose in poses:
        validate_runtime_policy(pose.get("runtime"), f"pose {pose['id']}", mask_profiles)

    expressions = data["expressions"]
    if not isinstance(expressions, list) or not expressions:
        raise SystemExit("expressions 至少须包含一个表情")
    expression_ids = [item.get("id") for item in expressions]
    if len(expression_ids) != len(set(expression_ids)) or any(
        not ID.fullmatch(str(value or "")) for value in expression_ids
    ):
        raise SystemExit("expressions.id 必须唯一且格式正确")
    if "normal" in expression_ids:
        raise SystemExit("normal 已由三张姿势母版承担，不应再配置独立 normal 表情")
    if set(expression_ids) & {f"normal_{pose_id}" for pose_id in pose_ids}:
        raise SystemExit("expressions.id 不得与 normal_<pose> 运行时 ID 冲突")
    for expression in expressions:
        if expression.get("pose") not in pose_ids:
            raise SystemExit(f"表情 {expression.get('id')} 引用了未配置姿势: {expression.get('pose')}")
        validate_runtime_policy(
            expression.get("runtime"),
            f"expression {expression['id']}",
            mask_profiles,
        )

    states = data["runtime"].get("states")
    required_states = {"eyes_half", *BASE_RUNTIME_STATES}
    if not isinstance(states, dict) or set(states) != required_states:
        raise SystemExit("runtime.states 必须且只能包含 eyes_half、eyes_close、mouth_half_open、mouth_open")
    if any(not str(states[state]).strip() for state in required_states):
        raise SystemExit("runtime.states 的提示词说明不可为空")

    chroma = data["chroma_key"]
    if not 0 <= chroma["transparent_distance"] < chroma["opaque_distance"] <= 255:
        raise SystemExit("色键阈值须满足 0 <= transparent_distance < opaque_distance <= 255")

    workflow = data["workflow"]
    gates = (
        "pause_after_base",
        "require_explicit_base_approval",
        "pause_after_poses",
        "require_explicit_pose_approval",
        "pause_after_expressions",
        "require_explicit_expression_approval",
        "generate_poses_separately",
        "generate_expressions_separately",
        "generate_runtime_states_separately",
    )
    if any(workflow.get(key) is not True for key in gates):
        raise SystemExit("v3 流程的三个批准门与所有独立生成开关都必须为 true")

    output = data["output"]
    for key in ("work_dir", "deliverables_dir"):
        value = str(output.get(key, ""))
        if not ID.fullmatch(value):
            raise SystemExit(f"output.{key} 必须是安全的相对目录名")
    if output["work_dir"] == output["deliverables_dir"]:
        raise SystemExit("work_dir 与 deliverables_dir 不可相同")
    for key in ("export_local_parts", "include_compositor_runtime", "make_contact_sheet", "make_demo_gifs"):
        if not isinstance(output.get(key), bool):
            raise SystemExit(f"output.{key} 必须是布尔值")
    if output["include_compositor_runtime"] and not output["export_local_parts"]:
        raise SystemExit("启用合成运行时必须同时启用 export_local_parts")
    return data


def bullet_lines(items: list[str], fallback: str) -> str:
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    return "\n".join(f"- {item}" for item in cleaned) if cleaned else f"- {fallback}"


def reference_authority_lines(references: list[dict[str, str]]) -> str:
    if not references:
        return "No image reference. Treat the written character description as authoritative."
    rules = {
        "primary-character": "PRIMARY truth for identity, age, face, proportions, costume, palette, and style",
        "supporting-character": "same-character support only; recover hidden details without overriding the primary",
        "detail-style": "line, eye, hair, and shading finish only; never identity, age, anatomy, crop, or pose",
        "pose-only": "pose only; never identity, face, anatomy, costume, palette, or style",
    }
    lines = ["Use supplied images in this exact order and authority hierarchy:"]
    for index, reference in enumerate(references, start=1):
        note = f" User note: {reference['note']}" if reference["note"] else ""
        lines.append(f"- Image {index} — {reference['role']}: {rules[reference['role']]}.{note}")
    lines.append("When references disagree, primary-character wins.")
    return "\n".join(lines)


def common_identity_lock(config: dict) -> str:
    character = config["character"]
    return f"""Identity and proportion lock:
- Preserve exact apparent age, face geometry, feature scale, head-to-body ratio, shoulder width, torso length, hip width, limb thickness, and leg-to-torso ratio.
- Never make the character taller, slimmer, smaller-headed, longer-necked, longer-legged, older, or more mature.
- Preserve costume geometry, palette, accessories, hair silhouette, linework, shading, and original stylized anatomy.
{bullet_lines(character['preserve'], 'Preserve every identity-defining detail from the authoritative source.')}

Avoid:
{bullet_lines(character['avoid'], 'Avoid props, scenery, particles, cast shadows, and invented design details.')}"""


def reference_prompt(config: dict, key_color: str) -> str:
    character = config["character"]
    render = config["render"]
    references = character["reference_images"]
    description = character["description"].strip() or "Use the supplied primary character reference exactly."
    return f"""Use case: identity-preserve
Asset type: canonical Galgame full-body model-reference sprite, true transparent RGBA PNG
Input images:
{reference_authority_lines(references)}

Create exactly one canonical full-body reference sprite for this character.
Character: {description}
Style: {character['style_note'].strip()}
Pose: {render['reference_pose'].strip()}

This is a faithful pose/framing conversion, not beautification or anatomy correction. If the primary input is opaque, perform exactly one fidelity-locked image-to-image conversion whose only material change is removal of the background into real alpha.
{common_identity_lock(config)}

Face and framing:
- Keep both eyes naturally open and the mouth completely closed.
- Show one complete character from topmost hair or accessory through both shoe soles.
- Keep both hands, all hair tips, ribbons, and clothing edges visible.
- Use a {render['size']} portrait canvas with about {render['safe_margin_percent']}% margin and a {render['anchor'].replace('-', ' ')} anchor.
- No duplicate views, inset faces, charts, text, UI, watermark, or incidental prop.

Background and alpha:
- Output a PNG with a genuine transparent alpha channel. The canvas outside the character must have alpha 0; do not paint a checkerboard, solid matte, halo, glow, floor, reflection, or cast shadow.
- Preserve all hair tips, fabric edges, white clothing, accessories, antialiasing, and semi-transparent edge pixels. Do not simulate transparency in RGB.
"""


def pose_profile_lines(config: dict) -> str:
    design = config["pose_design"]
    traits = ", ".join(str(item).strip() for item in design["character_traits"] if str(item).strip())
    traits = traits or "No explicit traits; use conservative low-intensity acting."
    signature = design["signature_gesture"].strip() or "No explicit signature gesture."
    return f"""Character-trait evidence: {traits}
Controls: energy={design['energy']:.2f}, openness={design['openness']:.2f}, formality={design['formality']:.2f}, shyness={design['shyness']:.2f}
Gesture amplitude: {design['gesture_amplitude']}
Signature gesture: {signature}
Preferred side-turn direction: {design['side_turn_direction']}
Forbidden gestures:
{bullet_lines(design['forbidden_gestures'], 'No dramatic or viewer-directed gesture.')}"""


def pose_file_stem(config: dict, pose_id: str) -> str:
    return f"{config['character']['slug']}_normal_{pose_id}"


def expression_file_stem(config: dict, expression_id: str) -> str:
    return f"{config['character']['slug']}_{expression_id}"


def pose_prompt(config: dict, key_color: str, pose: dict) -> str:
    render = config["render"]
    slug = config["character"]["slug"]
    return f"""Use case: identity-preserve
Asset type: Galgame neutral runtime pose base, true transparent RGBA PNG
Input image: `{slug}_reference_normal.png`, the approved transparent canonical reference.

Create the distinct neutral “{pose['label']}” runtime pose:
{pose['instruction'].strip()}

{pose_profile_lines(config)}

Expression and identity:
- Both eyes naturally open and generally directed toward the viewer.
- Mouth fully closed; a faint friendly closed-lip curve is allowed, but no open mouth or emotion-coded smile.
- Keep an otherwise calm normal face with no blush, tears, sweat, anger, surprise, or other emotional cue.
- Change only body pose, hand placement, body/face angle, weight shift, and unavoidable hair or clothing overlap.
{common_identity_lock(config)}

Composition:
- One complete character on {render['size']}; same scale; about {render['safe_margin_percent']}% margin; {render['anchor'].replace('-', ' ')} anchor.
- No props, scenery, shadows, duplicate views, text, UI, or watermark.
- Genuine transparent alpha outside the complete character; no checkerboard, matte, floor, halo, or shadow.
"""


def expression_prompt(config: dict, key_color: str, expression: dict) -> str:
    slug = config["character"]["slug"]
    pose_stem = pose_file_stem(config, expression["pose"])
    policy = expression["runtime"]
    return f"""Use case: precise-object-edit
Asset type: Galgame facial-expression mother frame, true transparent RGBA PNG
Input image: `{pose_stem}.png`, the approved transparent neutral `{expression['pose']}` pose.

Change only the facial expression to “{expression['label']}”:
{expression['instruction'].strip()}

Runtime mother-frame contract:
- Blink policy: {policy['blink']}.
- Mouth sync enabled: {str(policy['mouth_sync']).lower()}.
- Preserve the requested emotion while using its resting or lowest-volume mouth state; this exact frame becomes the runtime default and mouthClose.
- Do not exaggerate the mouth solely to make the emotion readable; eyes and eyebrows should carry their share.

Absolute invariants:
- Same canvas, placement, crop, pose, hands, body, silhouette, hair, costume, colors, linework, shading, lighting, and edge placement.
- Change only eyelids, eyes, eyebrows, mouth, and explicitly requested blush or moist highlights.
- No symbols, motion lines, props, text, effects, or newly invented details.
- Preserve the approved transparent alpha exactly; do not add a checkerboard, matte, halo, shadow, or background pixels.
{common_identity_lock(config)}
"""


def runtime_states(policy: dict) -> list[str]:
    result: list[str] = []
    for state in policy["extra_states"]:
        if state.startswith("eyes_") and state not in result:
            result.append(state)
    if policy["blink"] == "dynamic":
        result.append("eyes_close")
    if policy["mouth_sync"]:
        result.extend(("mouth_half_open", "mouth_open"))
    for state in policy["extra_states"]:
        if state not in result:
            result.append(state)
    return result


def runtime_prompt(config: dict, key_color: str, runtime_id: str, state: str) -> str:
    instruction = config["runtime"]["states"][state]
    region = "eyes" if state.startswith("eyes_") else "mouth"
    pair_rule = ""
    eye_cleanup_rule = ""
    if state == "eyes_close":
        eye_cleanup_rule = """
Eye-replacement rule:
- Treat both eyes and both eyebrows as one coherent blink state. First repaint the complete original open-eye construction and every displaced old brow pixel as clean local skin: remove both irises, sclerae, lower lashes, the full-open upper-lash contours, remote black fragments, and every antialiased gray/black echo.
- Then draw exactly one intentional closed-eyelid curve per eye in the original eye position.
- Move each eyebrow subtly and naturally with the blink while preserving its emotional direction and identity. Do not leave the old eyebrow behind, split it into two copies, or move it into hair.
- Leave no eyelid crease, eyelid fold, highlight line, shadow line, second arc, remote black block, orphan lash tip, or faint duplicate stroke above or around the new closed lid. There must be exactly one intentional lid contour per eye.
- Any reconstructed skin or flat-color fill must use the exact local mother-frame hue, value, texture, edge softness, and antialiasing; never introduce a warmer, pinker, grayer, blurrier, or flatter skin patch.
"""
    elif state == "eyes_half":
        eye_cleanup_rule = """
Eye-replacement rule:
- Treat both eyes and both eyebrows as one coherent blink state. First remove the complete original full-open eye construction, including its upper/lower lash outlines, remote black fragments, antialiased gray/black echoes, and any old brow pixels displaced by the new state; then redraw the reduced half-closed aperture cleanly.
- Draw exactly one intentional upper-lid contour per eye. The old full-open upper contour must not remain as a second arc above it.
- Preserve only the iris/sclera portion naturally visible through the new smaller aperture. Move each eyebrow subtly with the blink while preserving its emotional direction; do not leave an old/new double brow.
- Reconstructed skin must match the exact local mother-frame hue, value, texture, and antialiasing with no visible patch boundary.
"""
    if state in {"mouth_half_open", "mouth_open"}:
        pair_rule = """
Mouth-pair rule:
- `mouth_half_open` and `mouth_open` are neighboring speaking frames, not extremes.
- Keep the same mouth corners, emotion, inner-mouth palette, teeth/tongue policy, and face identity.
- `mouth_open` may be only modestly more open than `mouth_half_open`; never jump from a tiny mouth to a shout-sized mouth.
"""
    input_rule = (
        f"Input images: Image 1 is the sole edit target, a fixed-coordinate 1024x1024 local edit plate prepared directly from the approved `{runtime_id}` mother frame. Image 2 is locator-only: red crosses mark outer eye corners and green crosses mark inner eye corners. Never reproduce a guide mark."
        if region == "eyes"
        else f"Input image: a fixed-coordinate 1024x1024 local edit plate prepared directly from the approved `{runtime_id}` mother frame."
    )
    return f"""Use case: precise-object-edit
Asset type: WebGAL image-sprite {region} micro-differential candidate
{input_rule}

Change request:
{instruction.strip()}
{eye_cleanup_rule}
{pair_rule}
Absolute invariants:
- Change only the requested {region} region.
- Preserve emotion, identity, apparent age, face geometry, head angle, pose, placement, body, hair, costume, linework, shading, and palette.
- Keep the exact 1024x1024 plate canvas and its identical crop boundaries.
- Do not recenter, rescale, expand, rotate, translate, or redraw the head or face. Keep all visible hair, nose, cheeks, ears, and crop-edge pixels fixed. For eye states only, eyebrows inside the separately approved brow activity mask may move subtly with the blink; everything outside that eye-and-brow mask remains fixed.
- This is an independent edit from the approved mother frame, never from another runtime state.
- Do not retouch, sharpen, soften, recolor, or add detail outside the requested region.
- No symbols, effects, text, UI, watermark, props, shadows, or scenery.

The downstream program maps this exact plate back to its recorded mother-frame crop and discards every pixel outside a locally approved {region} mask.
"""


def write_text(path: Path, value: str) -> str:
    value = value.rstrip() + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 v3 立绘、表情与 WebGAL 眼嘴差分提示词")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--key-color", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if not HEX_COLOR.fullmatch(args.key_color):
        raise SystemExit("--key-color 须为 #RRGGBB")
    key_color = args.key_color.lower()
    config = load_config(args.config)
    out = args.out.resolve()
    manifest_path = out / "manifest.json"
    if manifest_path.exists() and not args.force:
        raise SystemExit(f"运行目录已有 manifest.json；如需重建请添加 --force: {out}")

    work = Path(config["output"]["work_dir"])
    deliverables = Path(config["output"]["deliverables_dir"])
    directories = (
        work / "prompts",
        work / "source",
        work / "cutouts",
        work / "finals",
        work / "transforms",
        work / "masks",
        work / "qa",
        work / "runtime" / "sources",
        work / "runtime" / "candidates",
        work / "runtime" / "frames",
        work / "runtime" / "parts",
        deliverables / "figures",
        deliverables / "parts",
        deliverables / "previews",
        deliverables / "runtime",
    )
    for directory in directories:
        (out / directory).mkdir(parents=True, exist_ok=True)

    prompts: dict[str, dict] = {}

    def add_prompt(key: str, text: str, kind: str, **metadata: str) -> str:
        path = work / "prompts" / f"{key}.txt"
        digest = write_text(out / path, text)
        prompts[key] = {"path": str(path), "sha256": digest, "kind": kind, **metadata}
        return str(path)

    add_prompt("reference_normal", reference_prompt(config, key_color), "reference")
    for pose in config["poses"]:
        add_prompt(
            f"pose_{pose['id']}",
            pose_prompt(config, key_color, pose),
            "pose",
            pose=pose["id"],
        )
    for expression in config["expressions"]:
        add_prompt(
            f"expression_{expression['id']}",
            expression_prompt(config, key_color, expression),
            "expression",
            expression=expression["id"],
            pose=expression["pose"],
        )

    slug = config["character"]["slug"]
    pose_files: dict[str, dict] = {}
    for pose in config["poses"]:
        stem = pose_file_stem(config, pose["id"])
        pose_files[pose["id"]] = {
            "generated_transparent": str(work / "source" / f"{stem}.png"),
            "fallback_chroma_source": str(work / "source" / f"{stem}_key.png"),
            "fallback_cutout": str(work / "cutouts" / f"{stem}.png"),
            "transparent_final": str(work / "finals" / f"{stem}.png"),
            "transform": str(work / "transforms" / f"{pose['id']}.json"),
        }

    expression_files: dict[str, dict] = {}
    for expression in config["expressions"]:
        stem = expression_file_stem(config, expression["id"])
        expression_files[expression["id"]] = {
            "from_pose": expression["pose"],
            "generated_transparent": str(work / "source" / f"{stem}.png"),
            "fallback_chroma_source": str(work / "source" / f"{stem}_key.png"),
            "fallback_cutout": str(work / "cutouts" / f"{stem}.png"),
            "transparent_final": str(work / "finals" / f"{stem}.png"),
        }

    runtime_bases: dict[str, dict] = {}
    for pose in config["poses"]:
        runtime_id = f"normal_{pose['id']}"
        runtime_bases[runtime_id] = {
            "kind": "pose",
            "source_id": pose["id"],
            "pose": pose["id"],
            "label": f"通常／{pose['label']}",
            "base_final": pose_files[pose["id"]]["transparent_final"],
            "policy": pose["runtime"],
        }
    for expression in config["expressions"]:
        runtime_bases[expression["id"]] = {
            "kind": "expression",
            "source_id": expression["id"],
            "pose": expression["pose"],
            "label": expression["label"],
            "base_final": expression_files[expression["id"]]["transparent_final"],
            "policy": expression["runtime"],
        }

    runtime_assets: dict[str, dict] = {}
    for runtime_id, base in runtime_bases.items():
        for state in runtime_states(base["policy"]):
            asset_id = f"{runtime_id}__{state}"
            prompt_key = f"runtime_{runtime_id}_{state}"
            add_prompt(
                prompt_key,
                runtime_prompt(config, key_color, runtime_id, state),
                "runtime",
                runtime_id=runtime_id,
                state=state,
                pose=base["pose"],
            )
            stem = f"{slug}_{runtime_id}_{state}"
            region = "eyes" if state.startswith("eyes_") else "mouth"
            runtime_assets[asset_id] = {
                "runtime_id": runtime_id,
                "state": state,
                "region": region,
                "mask_profile": base["policy"]["mask_profile"],
                "prompt": prompts[prompt_key]["path"],
                "edit_plate": str(work / "runtime" / "sources" / f"{slug}_{runtime_id}_{region}_plate.png"),
                "model_candidate": str(work / "runtime" / "candidates" / f"{stem}.png"),
                "frame": str(work / "runtime" / "frames" / f"{stem}.png"),
                "part": str(work / "runtime" / "parts" / f"{stem}.png"),
                "qa": str(work / "qa" / f"{stem}.json"),
            }

    manifest = {
        "schema_version": 3,
        "state": "BASE_PENDING",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "character_slug": slug,
        "reference_images": [
            {"image_index": index, **reference}
            for index, reference in enumerate(config["character"]["reference_images"], start=1)
        ],
        "key_color": key_color,
        "input_pipeline": config["input_pipeline"],
        "render": config["render"],
        "pose_design": config["pose_design"],
        "poses": [item["id"] for item in config["poses"]],
        "expressions": [{"id": item["id"], "pose": item["pose"]} for item in config["expressions"]],
        "runtime_bases": runtime_bases,
        "runtime_assets": runtime_assets,
        "prompts": prompts,
        "files": {
            "directories": {"work": str(work), "deliverables": str(deliverables)},
            "reference_normal": {
                "generated_transparent": str(work / "source" / f"{slug}_reference_normal.png"),
                "fallback_chroma_source": str(work / "source" / f"{slug}_reference_normal_key.png"),
                "fallback_cutout": str(work / "cutouts" / f"{slug}_reference_normal.png"),
                "transparent_final": str(work / "finals" / f"{slug}_reference_normal.png"),
                "transform": str(work / "transforms" / "reference_normal.json"),
            },
            "pose_bases": pose_files,
            "expressions": expression_files,
        },
        "runtime": config["runtime"],
        "qa": config["qa"],
        "output": config["output"],
        "generation_summary": {
            "reference_calls": 1,
            "pose_calls": len(config["poses"]),
            "expression_calls": len(config["expressions"]),
            "runtime_calls": len(runtime_assets),
            "total_calls": 1 + len(config["poses"]) + len(config["expressions"]) + len(runtime_assets),
        },
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "run": str(out),
                "state": manifest["state"],
                "key_color": key_color,
                "generation_summary": manifest["generation_summary"],
                "prompt_count": len(prompts),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
