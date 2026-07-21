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


def load_config(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取配置 {path}: {exc}") from exc

    for key in ("character", "render", "chroma_key", "expressions", "qa", "workflow", "output"):
        if key not in data:
            raise SystemExit(f"配置缺少字段: {key}")

    slug = data["character"].get("slug", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", slug):
        raise SystemExit("character.slug 只能包含小写字母、数字、下划线和连字符")
    if not data["character"].get("description", "").strip() and not data["character"].get("reference_images"):
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

    expressions = data["expressions"]
    expression_ids = [item.get("id") for item in expressions]
    if not expressions or expression_ids[0] != "normal":
        raise SystemExit("expressions 的第一项必须是 normal")
    if len(expression_ids) != len(set(expression_ids)):
        raise SystemExit("expressions.id 不可重复")
    if not {"normal", "smile", "laugh"}.issubset(expression_ids):
        raise SystemExit("v1 配置必须包含 normal、smile 和 laugh")

    chroma = data["chroma_key"]
    if not 0 <= chroma["transparent_distance"] < chroma["opaque_distance"] <= 255:
        raise SystemExit("色键阈值须满足 0 <= transparent_distance < opaque_distance <= 255")

    workflow = data["workflow"]
    if not workflow.get("pause_after_base") or not workflow.get("require_explicit_base_approval"):
        raise SystemExit("v1 必须在通常立绘后暂停并要求明确确认")
    return data


def bullet_lines(items: list[str], fallback: str) -> str:
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    return "\n".join(f"- {item}" for item in cleaned) if cleaned else f"- {fallback}"


def base_prompt(config: dict, key_color: str) -> str:
    character = config["character"]
    render = config["render"]
    expression = config["expressions"][0]
    has_refs = bool(character["reference_images"])
    use_case = "identity-preserve" if has_refs else "stylized-concept"
    input_role = (
        "The supplied character reference image(s) are authoritative for identity, costume, "
        "palette, accessories, proportions, and drawing style. Do not copy their background or incidental pose."
        if has_refs
        else "No image reference. Treat the written character description as authoritative."
    )
    description = character["description"].strip() or "Use the supplied character reference exactly."

    return f"""Use case: {use_case}
Asset type: production-ready Galgame full-body standing sprite, opaque chroma-key source
Input images: {input_role}

Primary request:
Create exactly one canonical full-body standing sprite for this character. This will become the locked base for later facial-expression variants.
Regardless of the reference image's original crop, pose, expression, or background, convert the character into the canonical production format below. The reference controls identity and design, not incidental presentation.

Character description:
{description}

Style:
{character['style_note'].strip()}

Pose:
{render['pose'].strip()}

Canonicalization requirements:
- Use natural equal-proportion full-body anatomy, not chibi or super-deformed proportions unless the character design itself requires it.
- Use a calm standard standing pose facing forward or only very slightly three-quarter.
- Keep both eyes naturally open and the mouth completely closed for the normal base.
- If a reference is cropped, seated, in motion, turned sideways, holding a prop, or otherwise non-standard, reconstruct the missing body consistently and convert it to this standard stance.
- Do not preserve the reference background, cast shadow, incidental hand gesture, or incidental facial expression.

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


def variant_prompt(config: dict, key_color: str, expression: dict) -> str:
    character = config["character"]
    slug = character["slug"]
    return f"""Use case: precise-object-edit
Asset type: Galgame facial-expression difference, opaque chroma-key source
Input image: `{slug}_normal_key.png` is the approved canonical edit target and the absolute source of truth.

Primary request:
Edit this exact base sprite. Change only the facial expression to “{expression['label']}”.
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

This is an expression-only edit, not a redraw, redesign, alternate pose, or style reinterpretation.
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

    for directory in ("prompts", "source", "working", "qa"):
        (out / directory).mkdir(parents=True, exist_ok=True)

    prompts: dict[str, dict[str, str]] = {}
    for index, expression in enumerate(config["expressions"]):
        expression_id = expression["id"]
        prompt = base_prompt(config, key_color) if index == 0 else variant_prompt(config, key_color, expression)
        prompt_path = out / "prompts" / f"{expression_id}.txt"
        write_text(prompt_path, prompt)
        prompts[expression_id] = {
            "path": str(prompt_path.relative_to(out)),
            "sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        }

    slug = config["character"]["slug"]
    manifest = {
        "schema_version": 1,
        "state": "BASE_PENDING",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "character_slug": slug,
        "key_color": key_color,
        "render": config["render"],
        "expressions": [item["id"] for item in config["expressions"]],
        "prompts": prompts,
        "files": {
            item["id"]: {
                "chroma_source": f"source/{slug}_{item['id']}_key.png",
                "transparent_final": f"{slug}_{item['id']}.png",
            }
            for item in config["expressions"]
        },
        "qa": config["qa"],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"run": str(out), "state": manifest["state"], "key_color": key_color, "prompts": prompts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
