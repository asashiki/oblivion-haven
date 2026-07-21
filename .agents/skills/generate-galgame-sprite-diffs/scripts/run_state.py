#!/usr/bin/env python3
"""Enforce the two-stage approval state machine in a run manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(path: Path) -> str:
    if not path.is_file():
        raise SystemExit(f"找不到文件: {path}")
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def load_manifest(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取 manifest {path}: {exc}") from exc
    if "state" not in data:
        raise SystemExit("manifest 缺少 state")
    return data


def relative_or_absolute(path: Path, parent: Path) -> str:
    try:
        return str(path.resolve().relative_to(parent.resolve()))
    except ValueError:
        return str(path.resolve())


def atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(encoded)
        temporary = Path(handle.name)
    os.replace(temporary, path)


def command_status(args: argparse.Namespace, manifest: dict) -> None:
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def command_base_ready(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] not in {"BASE_PENDING", "BASE_REVIEW"}:
        raise SystemExit(f"当前状态 {manifest['state']} 不允许登记通常立绘；请先 reset-base")
    root = args.manifest.parent
    manifest["state"] = "BASE_REVIEW"
    manifest["base_candidate"] = {
        "source": relative_or_absolute(args.source, root),
        "source_sha256": digest(args.source),
        "final": relative_or_absolute(args.final, root),
        "final_sha256": digest(args.final),
        "ready_at": now(),
    }
    manifest.pop("approved_base", None)
    manifest.pop("completed_outputs", None)
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "base_candidate": manifest["base_candidate"]}, ensure_ascii=False))


def command_approve(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] != "BASE_REVIEW" or "base_candidate" not in manifest:
        raise SystemExit("只有 BASE_REVIEW 状态下已登记的通常立绘可以批准")
    root = args.manifest.parent
    candidate = manifest["base_candidate"]
    source = root / candidate["source"] if not Path(candidate["source"]).is_absolute() else Path(candidate["source"])
    final = root / candidate["final"] if not Path(candidate["final"]).is_absolute() else Path(candidate["final"])
    if digest(source) != candidate["source_sha256"] or digest(final) != candidate["final_sha256"]:
        raise SystemExit("通常立绘在预览后发生了变化；请重新执行 base-ready 并让用户再次确认")
    manifest["state"] = "VARIANTS_PENDING"
    manifest["approved_base"] = {**candidate, "approved_at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "approved_base": manifest["approved_base"]}, ensure_ascii=False))


def command_complete(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] != "VARIANTS_PENDING" or "approved_base" not in manifest:
        raise SystemExit("只有已批准通常立绘的 VARIANTS_PENDING 运行可以完成")
    root = args.manifest.parent
    approved = manifest["approved_base"]
    source = root / approved["source"] if not Path(approved["source"]).is_absolute() else Path(approved["source"])
    if digest(source) != approved["source_sha256"]:
        raise SystemExit("批准后的通常立绘源图发生了变化；差分不得继续绑定该基准")
    outputs = {}
    for expression, path in (("normal", args.normal), ("smile", args.smile), ("laugh", args.laugh)):
        outputs[expression] = {
            "path": relative_or_absolute(path, root),
            "sha256": digest(path),
        }
    manifest["state"] = "COMPLETE"
    manifest["completed_outputs"] = outputs
    manifest["completed_at"] = now()
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "completed_outputs": outputs}, ensure_ascii=False))


def command_reset(args: argparse.Namespace, manifest: dict) -> None:
    previous = manifest["state"]
    manifest["state"] = "BASE_PENDING"
    manifest.pop("base_candidate", None)
    manifest.pop("approved_base", None)
    manifest.pop("completed_outputs", None)
    manifest.pop("completed_at", None)
    manifest["last_reset"] = {"from": previous, "reason": args.reason, "at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "last_reset": manifest["last_reset"]}, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="立绘差分运行状态机")
    parser.add_argument("manifest", type=Path)
    subparsers = parser.add_subparsers(dest="command", required=True)

    status = subparsers.add_parser("status")
    status.set_defaults(func=command_status)

    ready = subparsers.add_parser("base-ready")
    ready.add_argument("--source", type=Path, required=True, help="通常立绘色键源图")
    ready.add_argument("--final", type=Path, required=True, help="供用户确认的透明通常立绘")
    ready.set_defaults(func=command_base_ready)

    approve = subparsers.add_parser("approve")
    approve.set_defaults(func=command_approve)

    complete = subparsers.add_parser("complete")
    complete.add_argument("--normal", type=Path, required=True)
    complete.add_argument("--smile", type=Path, required=True)
    complete.add_argument("--laugh", type=Path, required=True)
    complete.set_defaults(func=command_complete)

    reset = subparsers.add_parser("reset-base")
    reset.add_argument("--reason", default="user requested a new base")
    reset.set_defaults(func=command_reset)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    manifest = load_manifest(args.manifest)
    args.func(args, manifest)


if __name__ == "__main__":
    main()
