#!/usr/bin/env python3
"""Thin, optional gpt-image-2 provider adapter for the portable workflow."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
from pathlib import Path


SIZE = re.compile(r"^([1-9][0-9]*)x([1-9][0-9]*)$")


def valid_size(value: str) -> str:
    if value == "auto":
        return value
    match = SIZE.fullmatch(value)
    if not match:
        raise argparse.ArgumentTypeError("尺寸须为 WIDTHxHEIGHT 或 auto")
    width, height = int(match.group(1)), int(match.group(2))
    if width % 16 or height % 16:
        raise argparse.ArgumentTypeError("两条边都须为 16 的倍数")
    if max(width, height) > 3840 or max(width, height) / min(width, height) > 3:
        raise argparse.ArgumentTypeError("尺寸超过 gpt-image-2 的边长或长宽比限制")
    if not 655_360 <= width * height <= 8_294_400:
        raise argparse.ArgumentTypeError("总像素须在 655360 到 8294400 之间")
    return value


def load_prompt(path: Path) -> str:
    try:
        prompt = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise SystemExit(f"无法读取提示词 {path}: {exc}") from exc
    if not prompt:
        raise SystemExit("提示词文件为空")
    return prompt


def response_b64(result: object) -> str:
    data = getattr(result, "data", None)
    if not data:
        raise SystemExit("OpenAI 返回结果中没有图片数据")
    first = data[0]
    value = getattr(first, "b64_json", None)
    if value is None and isinstance(first, dict):
        value = first.get("b64_json")
    if not value:
        raise SystemExit("OpenAI 返回结果中没有 b64_json")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(
        description="用 gpt-image-2 生成或编辑一张色键源图；默认只供未来 API 项目复用"
    )
    parser.add_argument("--prompt-file", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image", type=Path, action="append", default=[], help="参考/编辑图片；可重复")
    parser.add_argument("--mask", type=Path, help="可选编辑蒙版，仅对第一张输入图生效")
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--size", type=valid_size, default="1024x1536")
    parser.add_argument("--quality", choices=("low", "medium", "high", "auto"), default="high")
    parser.add_argument("--dry-run", action="store_true", help="只打印请求摘要，不联网")
    args = parser.parse_args()

    if args.out.suffix.lower() != ".png":
        raise SystemExit("色键源图应保存为 .png")
    if args.mask and not args.image:
        raise SystemExit("--mask 只能与至少一个 --image 一起使用")
    for path in [*args.image, *([args.mask] if args.mask else [])]:
        if not path.is_file():
            raise SystemExit(f"找不到输入文件: {path}")
    prompt = load_prompt(args.prompt_file)
    mode = "edit" if args.image else "generate"
    summary = {
        "mode": mode,
        "model": args.model,
        "prompt_file": str(args.prompt_file),
        "images": [str(path) for path in args.image],
        "mask": str(args.mask) if args.mask else None,
        "size": args.size,
        "quality": args.quality,
        "output": str(args.out),
        "notes": [
            "input_fidelity is intentionally omitted for gpt-image-2",
            "transparent background is intentionally not requested; the prompt uses a chroma key",
        ],
    }
    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("缺少 OPENAI_API_KEY；在 Work/Codex 中请改用内置图片生成功能")

    try:
        from openai import OpenAI
    except ImportError as exc:
        raise SystemExit("缺少 openai Python SDK；请先安装当前版 openai 包") from exc

    client = OpenAI()
    common = {
        "model": args.model,
        "prompt": prompt,
        "size": args.size,
        "quality": args.quality,
    }
    handles = []
    mask_handle = None
    try:
        if mode == "generate":
            result = client.images.generate(**common)
        else:
            handles = [path.open("rb") for path in args.image]
            image_value = handles[0] if len(handles) == 1 else handles
            if args.mask:
                mask_handle = args.mask.open("rb")
            result = client.images.edit(
                image=image_value,
                mask=mask_handle,
                **common,
            ) if mask_handle else client.images.edit(image=image_value, **common)
    except Exception as exc:
        request_id = getattr(exc, "request_id", None)
        code = getattr(exc, "code", None)
        detail = f"；code={code}" if code else ""
        detail += f"；request_id={request_id}" if request_id else ""
        raise SystemExit(f"OpenAI 图片请求失败: {exc}{detail}") from exc
    finally:
        for handle in handles:
            handle.close()
        if mask_handle:
            mask_handle.close()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(base64.b64decode(response_b64(result)))
    print(json.dumps({**summary, "status": "saved"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
