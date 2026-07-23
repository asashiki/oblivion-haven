#!/usr/bin/env python3
"""Build deterministic prompts and a run manifest for sprite differences."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
SIZE = re.compile(r"^([1-9][0-9]*)x([1-9][0-9]*)$")
REFERENCE_ROLES = {
    "primary-character",
    "supporting-character",
    "detail-style",
    "pose-only",
}


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
        raise SystemExit(
            "有参考图时必须且只能指定一张 primary-character；旧式纯路径数组默认第一张为主参考"
        )
    return normalized


def load_config(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取配置 {path}: {exc}") from exc

    for key in (
        "character",
        "render",
        "pose_design",
        "chroma_key",
        "poses",
        "expressions",
        "qa",
        "workflow",
        "output",
    ):
        if key not in data:
            raise SystemExit(f"配置缺少字段: {key}")
    if data.get("schema_version") != 2:
        raise SystemExit("当前生成器要求 schema_version=2")

    slug = data["character"].get("slug", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", slug):
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
    pixels = width * height
    if not 655_360 <= pixels <= 8_294_400:
        raise SystemExit("render.size 的总像素须在 655360 到 8294400 之间")

    poses = data["poses"]
    pose_ids = [item.get("id") for item in poses]
    if not poses:
        raise SystemExit("poses 至少须包含一个姿势")
    if len(pose_ids) != len(set(pose_ids)):
        raise SystemExit("poses.id 不可重复")
    if any(not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", str(pose_id or "")) for pose_id in pose_ids):
        raise SystemExit("poses.id 只能包含小写字母、数字、下划线和连字符")

    expressions = data["expressions"]
    expression_ids = [item.get("id") for item in expressions]
    if not expressions or expression_ids[0] != "normal":
        raise SystemExit("expressions 的第一项必须是 normal")
    if len(expression_ids) != len(set(expression_ids)):
        raise SystemExit("expressions.id 不可重复")
    if not {"normal", "smile", "laugh"}.issubset(expression_ids):
        raise SystemExit("配置至少必须包含 normal、smile 和 laugh")
    unknown_pose_mappings = [
        item.get("pose")
        for item in expressions
        if item.get("pose") not in pose_ids
    ]
    if unknown_pose_mappings:
        raise SystemExit(
            "expressions.pose 引用了未配置姿势: "
            + ", ".join(sorted(set(str(item) for item in unknown_pose_mappings)))
        )

    chroma = data["chroma_key"]
    if not 0 <= chroma["transparent_distance"] < chroma["opaque_distance"] <= 255:
        raise SystemExit("色键阈值须满足 0 <= transparent_distance < opaque_distance <= 255")

    workflow = data["workflow"]
    if not workflow.get("pause_after_base") or not workflow.get("require_explicit_base_approval"):
        raise SystemExit("流程必须在通常立绘后暂停并要求明确确认")
    if not workflow.get("pause_after_poses") or not workflow.get("require_explicit_pose_approval"):
        raise SystemExit("流程必须在姿势组后暂停并要求明确确认")
    return data


def bullet_lines(items: list[str], fallback: str) -> str:
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    return "\n".join(f"- {item}" for item in cleaned) if cleaned else f"- {fallback}"


def reference_authority_lines(references: list[dict[str, str]]) -> str:
    if not references:
        return "No image reference. Treat the written character description as authoritative."

    role_rules = {
        "primary-character": (
            "PRIMARY source of truth for identity, apparent age, face geometry, head-to-body ratio, "
            "leg-to-torso ratio, body build, costume, palette, accessories, and original drawing style"
        ),
        "supporting-character": (
            "secondary view of the same character; use only to recover hidden design details and never "
            "override the primary face, apparent age, body proportions, or silhouette"
        ),
        "detail-style": (
            "rendering-detail reference only; borrow line cleanliness, eye/hair detail, and shading finish, "
            "but not its face shape, apparent age, proportions, expression, blush, lighting, crop, or pose"
        ),
        "pose-only": (
            "pose reference only; do not borrow identity, face, age, anatomy, costume, palette, or style"
        ),
    }
    lines = ["Use the supplied images in this exact order and authority hierarchy:"]
    for index, reference in enumerate(references, start=1):
        note = f" User note: {reference['note']}" if reference["note"] else ""
        lines.append(
            f"- Image {index} — {reference['role']}: {role_rules[reference['role']]}.{note}"
        )
    lines.append(
        "When references disagree, the primary-character image wins. Greater detail or polish in a "
        "secondary image never grants permission to redesign or mature the character."
    )
    return "\n".join(lines)


def reference_prompt(config: dict, key_color: str) -> str:
    character = config["character"]
    render = config["render"]
    expression = config["expressions"][0]
    references = character["reference_images"]
    has_refs = bool(references)
    use_case = "identity-preserve" if has_refs else "stylized-concept"
    input_role = reference_authority_lines(references)
    description = character["description"].strip() or "Use the supplied character reference exactly."
    identity_source = "primary character reference" if has_refs else "written character description"

    return f"""Use case: {use_case}
Asset type: production-ready Galgame full-body standing sprite, opaque chroma-key source
Input images: {input_role}

Primary request:
Create exactly one canonical full-body model-reference sprite for this character. This neutral standard stance will lock identity, apparent age, proportions, costume, palette, and rendering style for every later pose.
Regardless of the reference image's original crop, pose, expression, or background, convert the character into the canonical production format below. The reference controls identity and design, not incidental presentation.
This is a faithful reformatting task, not a beautification, redesign, age-up, or anatomy correction. Change the presentation only where required to obtain the complete standing sprite.

Character description:
{description}

Style:
{character['style_note'].strip()}

Pose:
{render['reference_pose'].strip()}

Identity, apparent-age, and proportion lock — higher priority than pose and polish:
- Preserve the {identity_source}'s exact apparent age and youthful or mature impression. Never make the character look older, more adult, or more mature than that source.
- Preserve face geometry and feature scale: face outline, cheek fullness, jaw/chin roundness, forehead, eye size and spacing, nose scale, and mouth scale. Do not lengthen or narrow the face, sharpen the jaw, reduce the eyes, or otherwise mature the facial structure.
- Preserve the original stylized head-to-body ratio, shoulder width, torso length, hip width, limb thickness, and leg-to-torso ratio. Do not make the character taller, slimmer, longer-necked, smaller-headed, or longer-legged.
- A standard standing pose changes only pose, crop, and completion of occluded regions. It must not normalize the character toward realistic anatomy, adult fashion-model proportions, or a generic modern anime body template.
- Do not infer height from how much of the source canvas the character occupies. Read proportions from the character's own head and body instead.
- If cropped or occluded areas make proportions uncertain, use the most compact interpretation consistent with the authoritative face, visible anatomy, and original Japanese anime style. Never resolve ambiguity by aging the character up or extending the legs.

Canonicalization requirements:
- Retain the {identity_source}'s own stylized anatomy exactly; do not convert either to or from chibi, petite, youthful, tall, or mature proportions.
- Use a calm, stable, model-reference standing pose facing forward or nearly forward.
- Keep both eyes naturally open and the mouth completely closed for the normal base.
- If a reference is cropped, seated, in motion, turned sideways, holding a prop, or otherwise non-standard, reconstruct the missing body consistently and convert it to this standard stance.
- Do not preserve the reference background, cast shadow, incidental hand gesture, or incidental facial expression.
- This deliberately plain stance is a reusable design reference, not the final conversational acting pose. Do not add personality gestures here.

Expression — {expression['label']}:
{expression['instruction'].strip()}

Composition and framing:
- Portrait canvas requested at {render['size']}.
- Show the complete character from the topmost hair/accessory to the soles of both shoes.
- Keep every limb, hand, hair tip, ribbon, and clothing edge inside the canvas.
- Leave approximately {render['safe_margin_percent']}% empty safe margin on every side.
- Anchor the character {render['anchor'].replace('-', ' ')}.
- One character only. No duplicate views, inset faces, expression charts, text, labels, UI, or watermark.

Identity invariants:
{bullet_lines(character['preserve'], 'Preserve every identity-defining design detail visible in the references.')}

Avoid:
{bullet_lines(character['avoid'], 'Avoid props, scenery, particles, cast shadows, and newly invented costume details.')}

Chroma-key background contract:
- The entire background must be exactly one perfectly flat solid {key_color} color.
- No gradient, texture, vignette, halo, floor plane, horizon, shadow, reflection, glow, or lighting variation in the background.
- Do not use {key_color} anywhere on the character.
- Keep crisp, separable edges and clean gaps between hair strands, arms, and body where visible.
"""


def pose_profile_lines(config: dict) -> str:
    design = config["pose_design"]
    traits = [str(item).strip() for item in design["character_traits"] if str(item).strip()]
    traits_line = ", ".join(traits) if traits else (
        "No explicit personality traits supplied. Do not infer personality from appearance; "
        "use conservative low-intensity acting."
    )
    signature = design["signature_gesture"].strip() or (
        "No explicit signature gesture supplied. Use a subtle, reusable gesture rather than inventing "
        "a dramatic character trait."
    )
    return f"""Character-trait evidence: {traits_line}
Acting controls (0.0 restrained to 1.0 strong): energy={design['energy']:.2f}, openness={design['openness']:.2f}, formality={design['formality']:.2f}, shyness={design['shyness']:.2f}
Gesture amplitude: {design['gesture_amplitude']}
Signature gesture: {signature}
Forbidden gestures:
{bullet_lines(design['forbidden_gestures'], 'No dramatic, acrobatic, aggressive, or viewer-directed gesture.')}"""


def normal_pose_id(config: dict) -> str:
    return config["expressions"][0]["pose"]


def pose_file_stem(config: dict, pose_id: str) -> str:
    slug = config["character"]["slug"]
    return f"{slug}_normal" if pose_id == normal_pose_id(config) else f"{slug}_{pose_id}_normal"


def pose_prompt(config: dict, key_color: str, pose: dict) -> str:
    character = config["character"]
    render = config["render"]
    slug = character["slug"]
    return f"""Use case: identity-preserve
Asset type: Galgame neutral pose base, opaque chroma-key source
Input image: `{slug}_reference_normal_key.png` is the approved standard model reference and the absolute source of truth for character design.

Primary request:
Edit this exact approved reference sprite into the neutral “{pose['label']}” pose.
{pose['instruction'].strip()}

Pose-personality profile:
{pose_profile_lines(config)}

Expression lock:
- Keep both eyes naturally open, looking generally toward the viewer.
- Keep the mouth fully closed and the face calm and neutral.
- Do not add blush, tears, sweat, anger, surprise, or another emotional facial cue.

Identity and proportion invariants — higher priority than the requested gesture:
- Preserve the exact apparent age, face geometry, head size, head-to-body ratio, torso length, leg-to-torso ratio, limb thickness, and overall build.
- Preserve every costume seam, ornament, accessory, hair shape, color, line style, shading style, and identity-defining detail.
- Change only the body pose, hand placement, configured body/face angle, weight shift, and the minimum hair/clothing overlap required by that pose.
- When the pose instruction requests a controlled three-quarter turn, rotate the shoulders, torso, hips, skirt or coat, feet, and balance coherently. Do not simulate the turn by changing only the hands.
- Keep both eyes and the recognizable full face readable unless the user explicitly approved a special side-profile pose.
- Do not make the character taller, slimmer, smaller-headed, longer-necked, longer-legged, older, or more mature.
- Do not convert chibi, petite, youthful, tall, or mature anatomy into another proportion system.

Composition:
- Keep one complete character on the same requested {render['size']} portrait canvas.
- Keep approximately the same overall character scale as the approved reference.
- Show the topmost hair/accessory, both hands, both feet, and every clothing edge.
- Keep approximately {render['safe_margin_percent']}% empty safe margin and a {render['anchor'].replace('-', ' ')} anchor.
- No duplicate views, inset faces, text, labels, UI, props, scenery, cast shadow, or watermark.

Identity invariants:
{bullet_lines(character['preserve'], 'Preserve every identity-defining design detail from the approved reference.')}

Avoid:
{bullet_lines(character['avoid'], 'Avoid dramatic acting, newly invented costume details, and anatomy redesign.')}

Chroma-key background lock:
- Keep the entire background exactly one perfectly flat solid {key_color}.
- No gradient, texture, floor plane, horizon, shadow, halo, glow, reflection, or background element.
- Do not use {key_color} anywhere on the character.

This is a pose-only edit from the approved standard reference, not a facial-expression edit or redesign.
"""


def expression_prompt(config: dict, key_color: str, expression: dict) -> str:
    character = config["character"]
    slug = character["slug"]
    pose_id = expression["pose"]
    pose_stem = pose_file_stem(config, pose_id)
    return f"""Use case: precise-object-edit
Asset type: Galgame facial-expression difference, opaque chroma-key source
Input image: `{pose_stem}_key.png` is the approved neutral “{pose_id}” pose base and the absolute source of truth.

Primary request:
Edit this exact approved pose base. Change only the facial expression to “{expression['label']}”.
{expression['instruction'].strip()}

No other change is authorized.

Absolute invariants:
- Keep the exact same canvas size, character scale, pixel placement, crop, pose, hands, fingers, body proportions, and silhouette.
- Keep the exact same face identity and proportions; change only eyelids/eyes and mouth shapes needed for the requested expression.
- Keep all hair shapes and strands, costume geometry and seams, ornaments, accessories, colors, linework, shading, lighting, and edge placement unchanged.
- Do not add blush, tears, symbols, motion lines, teeth, tongue, props, text, or effects unless explicitly required by the expression instruction.
{bullet_lines(character['preserve'], 'Preserve every identity-defining design detail from the approved base.')}

Chroma-key background lock:
- Keep the entire background exactly the same perfectly flat solid {key_color}.
- No gradient, texture, shadow, halo, glow, reflection, or new background element.
- Do not use {key_color} anywhere on the character.

This is an expression-only edit, not a redraw, redesign, alternate pose, or style reinterpretation. Never blend in another pose base.
"""


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value.rstrip() + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="生成立绘差分提示词与运行清单")
    parser.add_argument("--config", type=Path, required=True, help="运行配置 JSON")
    parser.add_argument("--key-color", required=True, help="最终使用的色键，例如 #fc5d21")
    parser.add_argument("--out", type=Path, required=True, help="运行目录")
    parser.add_argument("--force", action="store_true", help="覆盖已有提示词与初始清单")
    args = parser.parse_args()

    if not HEX_COLOR.fullmatch(args.key_color):
        raise SystemExit("--key-color 须为 #RRGGBB")
    key_color = args.key_color.lower()
    config = load_config(args.config)
    out = args.out.resolve()
    manifest_path = out / "manifest.json"
    if manifest_path.exists() and not args.force:
        raise SystemExit(f"运行目录已有 manifest.json；如需重建请添加 --force: {out}")

    for directory in ("prompts", "source", "working", "qa", "pose-transforms"):
        (out / directory).mkdir(parents=True, exist_ok=True)

    prompts: dict[str, dict[str, str]] = {}

    reference_key = "reference_normal"
    reference_text = reference_prompt(config, key_color)
    reference_path = out / "prompts" / f"{reference_key}.txt"
    write_text(reference_path, reference_text)
    prompts[reference_key] = {
        "path": str(reference_path.relative_to(out)),
        "sha256": hashlib.sha256(reference_text.encode("utf-8")).hexdigest(),
        "kind": "reference",
    }

    for pose in config["poses"]:
        prompt_key = f"pose_{pose['id']}"
        prompt = pose_prompt(config, key_color, pose)
        prompt_path = out / "prompts" / f"{prompt_key}.txt"
        write_text(prompt_path, prompt)
        prompts[prompt_key] = {
            "path": str(prompt_path.relative_to(out)),
            "sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "kind": "pose",
            "pose": pose["id"],
        }

    for expression in config["expressions"][1:]:
        prompt_key = f"expression_{expression['id']}"
        prompt = expression_prompt(config, key_color, expression)
        prompt_path = out / "prompts" / f"{prompt_key}.txt"
        write_text(prompt_path, prompt)
        prompts[prompt_key] = {
            "path": str(prompt_path.relative_to(out)),
            "sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "kind": "expression",
            "expression": expression["id"],
            "pose": expression["pose"],
        }

    slug = config["character"]["slug"]
    normal_pose = normal_pose_id(config)
    pose_files = {
        pose["id"]: {
            "chroma_source": f"source/{pose_file_stem(config, pose['id'])}_key.png",
            "transparent_final": f"{pose_file_stem(config, pose['id'])}.png",
        }
        for pose in config["poses"]
    }
    expression_files = {}
    for expression in config["expressions"]:
        expression_id = expression["id"]
        if expression_id == "normal":
            expression_files[expression_id] = {
                "from_pose": normal_pose,
                "chroma_source": pose_files[normal_pose]["chroma_source"],
                "transparent_final": pose_files[normal_pose]["transparent_final"],
                "requires_generation": False,
            }
        else:
            expression_files[expression_id] = {
                "from_pose": expression["pose"],
                "chroma_source": f"source/{slug}_{expression_id}_key.png",
                "transparent_final": f"{slug}_{expression_id}.png",
                "requires_generation": True,
            }

    manifest = {
        "schema_version": 2,
        "state": "BASE_PENDING",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "character_slug": slug,
        "reference_images": [
            {
                "image_index": index,
                "path": reference["path"],
                "role": reference["role"],
                "note": reference["note"],
            }
            for index, reference in enumerate(config["character"]["reference_images"], start=1)
        ],
        "key_color": key_color,
        "render": config["render"],
        "pose_design": config["pose_design"],
        "poses": [item["id"] for item in config["poses"]],
        "expressions": [
            {"id": item["id"], "pose": item["pose"]}
            for item in config["expressions"]
        ],
        "prompts": prompts,
        "files": {
            "reference_normal": {
                "chroma_source": f"source/{slug}_reference_normal_key.png",
                "transparent_final": f"{slug}_reference_normal.png",
            },
            "pose_bases": pose_files,
            "expressions": expression_files,
        },
        "qa": config["qa"],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"run": str(out), "state": manifest["state"], "key_color": key_color, "prompts": prompts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
