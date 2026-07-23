#!/usr/bin/env python3
"""Enforce the reference, pose, and expression approval state machine."""

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
    manifest.pop("pose_candidates", None)
    manifest.pop("approved_poses", None)
    manifest.pop("completed_outputs", None)
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "base_candidate": manifest["base_candidate"]}, ensure_ascii=False))


def command_approve_base(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] != "BASE_REVIEW" or "base_candidate" not in manifest:
        raise SystemExit("只有 BASE_REVIEW 状态下已登记的通常立绘可以批准")
    root = args.manifest.parent
    candidate = manifest["base_candidate"]
    source = root / candidate["source"] if not Path(candidate["source"]).is_absolute() else Path(candidate["source"])
    final = root / candidate["final"] if not Path(candidate["final"]).is_absolute() else Path(candidate["final"])
    if digest(source) != candidate["source_sha256"] or digest(final) != candidate["final_sha256"]:
        raise SystemExit("通常立绘在预览后发生了变化；请重新执行 base-ready 并让用户再次确认")
    manifest["state"] = "POSES_PENDING"
    manifest["approved_base"] = {**candidate, "approved_at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "approved_base": manifest["approved_base"]}, ensure_ascii=False))


def approved_base_source(manifest: dict, root: Path) -> Path:
    if "approved_base" not in manifest:
        raise SystemExit("manifest 缺少 approved_base")
    approved = manifest["approved_base"]
    source = root / approved["source"] if not Path(approved["source"]).is_absolute() else Path(approved["source"])
    if digest(source) != approved["source_sha256"]:
        raise SystemExit("批准后的标准人设基准源图发生了变化")
    return source


def command_pose_ready(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] not in {"POSES_PENDING", "POSES_REVIEW"}:
        raise SystemExit(f"当前状态 {manifest['state']} 不允许登记姿势基准")
    required = list(manifest.get("poses", []))
    if args.pose not in required:
        raise SystemExit(f"manifest 未配置姿势: {args.pose}")
    root = args.manifest.parent
    approved_base_source(manifest, root)
    candidates = manifest.setdefault("pose_candidates", {})
    candidates[args.pose] = {
        "source": relative_or_absolute(args.source, root),
        "source_sha256": digest(args.source),
        "final": relative_or_absolute(args.final, root),
        "final_sha256": digest(args.final),
        "ready_at": now(),
    }
    missing = [pose for pose in required if pose not in candidates]
    manifest["state"] = "POSES_PENDING" if missing else "POSES_REVIEW"
    manifest.pop("approved_poses", None)
    manifest.pop("completed_outputs", None)
    manifest.pop("completed_at", None)
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(
        json.dumps(
            {
                "state": manifest["state"],
                "registered_pose": args.pose,
                "missing_poses": missing,
            },
            ensure_ascii=False,
        )
    )


def command_approve_poses(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] != "POSES_REVIEW":
        raise SystemExit("只有 POSES_REVIEW 状态下的完整姿势组可以批准")
    root = args.manifest.parent
    approved_base_source(manifest, root)
    required = list(manifest.get("poses", []))
    candidates = manifest.get("pose_candidates", {})
    missing = [pose for pose in required if pose not in candidates]
    if missing:
        raise SystemExit(f"姿势组不完整: {', '.join(missing)}")

    approved_poses = {}
    for pose in required:
        candidate = candidates[pose]
        source = root / candidate["source"] if not Path(candidate["source"]).is_absolute() else Path(candidate["source"])
        final = root / candidate["final"] if not Path(candidate["final"]).is_absolute() else Path(candidate["final"])
        if digest(source) != candidate["source_sha256"] or digest(final) != candidate["final_sha256"]:
            raise SystemExit(f"姿势 {pose} 在预览后发生了变化；请重新登记并再次确认")
        approved_poses[pose] = {**candidate, "approved_at": now()}

    manifest["state"] = "EXPRESSIONS_PENDING"
    manifest["approved_poses"] = approved_poses
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "approved_poses": approved_poses}, ensure_ascii=False))


def expression_entries(manifest: dict) -> list[dict[str, str]]:
    values = manifest.get("expressions", [])
    if not values:
        raise SystemExit("manifest 缺少 expressions")
    if all(isinstance(item, str) for item in values):
        return [{"id": item, "pose": "normal"} for item in values]
    entries = []
    for item in values:
        if not isinstance(item, dict) or not item.get("id") or not item.get("pose"):
            raise SystemExit("manifest.expressions 条目须包含 id 与 pose")
        entries.append({"id": item["id"], "pose": item["pose"]})
    return entries


def command_complete(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] != "EXPRESSIONS_PENDING" or "approved_poses" not in manifest:
        raise SystemExit("只有已批准姿势组的 EXPRESSIONS_PENDING 运行可以完成")
    root = args.manifest.parent
    approved_base_source(manifest, root)
    for pose, approved in manifest["approved_poses"].items():
        source = root / approved["source"] if not Path(approved["source"]).is_absolute() else Path(approved["source"])
        final = root / approved["final"] if not Path(approved["final"]).is_absolute() else Path(approved["final"])
        if digest(source) != approved["source_sha256"] or digest(final) != approved["final_sha256"]:
            raise SystemExit(f"批准后的姿势 {pose} 发生了变化；表情不得继续绑定该基准")
    supplied: dict[str, Path] = {}
    for value in args.output:
        if "=" not in value:
            raise SystemExit("--output 须为 expression=path")
        expression, raw_path = value.split("=", 1)
        expression = expression.strip()
        if not expression or not raw_path.strip():
            raise SystemExit("--output 须为非空的 expression=path")
        if expression in supplied:
            raise SystemExit(f"重复的 --output 表情: {expression}")
        supplied[expression] = Path(raw_path)

    for expression in ("normal", "smile", "laugh"):
        legacy_path = getattr(args, expression)
        if legacy_path is not None:
            if expression in supplied:
                raise SystemExit(f"不要同时使用 --{expression} 和 --output {expression}=...")
            supplied[expression] = legacy_path

    entries = expression_entries(manifest)
    required = [item["id"] for item in entries]
    missing = [expression for expression in required if expression not in supplied]
    extra = [expression for expression in supplied if expression not in required]
    if missing:
        raise SystemExit(f"缺少输出: {', '.join(missing)}")
    if extra:
        raise SystemExit(f"manifest 未配置这些输出: {', '.join(extra)}")

    outputs = {}
    for entry in entries:
        expression = entry["id"]
        path = supplied[expression]
        if expression == "normal":
            pose = entry["pose"]
            approved_normal = manifest["approved_poses"].get(pose)
            if approved_normal is None:
                raise SystemExit(f"normal 映射的姿势未批准: {pose}")
            if digest(path) != approved_normal["final_sha256"]:
                raise SystemExit("normal 输出必须与其批准的中性姿势基准完全相同")
        outputs[expression] = {
            "path": relative_or_absolute(path, root),
            "sha256": digest(path),
            "pose": entry["pose"],
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
    manifest.pop("pose_candidates", None)
    manifest.pop("approved_poses", None)
    manifest.pop("completed_outputs", None)
    manifest.pop("completed_at", None)
    manifest["last_reset"] = {"from": previous, "reason": args.reason, "at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "last_reset": manifest["last_reset"]}, ensure_ascii=False))


def command_reset_poses(args: argparse.Namespace, manifest: dict) -> None:
    if "approved_base" not in manifest:
        raise SystemExit("没有已批准的标准人设基准；请先完成 BASE_REVIEW")
    root = args.manifest.parent
    approved_base_source(manifest, root)
    previous = manifest["state"]
    manifest["state"] = "POSES_PENDING"
    manifest.pop("pose_candidates", None)
    manifest.pop("approved_poses", None)
    manifest.pop("completed_outputs", None)
    manifest.pop("completed_at", None)
    manifest["last_pose_reset"] = {"from": previous, "reason": args.reason, "at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "last_pose_reset": manifest["last_pose_reset"]}, ensure_ascii=False))


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

    approve_base = subparsers.add_parser("approve-base")
    approve_base.set_defaults(func=command_approve_base)

    approve_alias = subparsers.add_parser("approve", help=argparse.SUPPRESS)
    approve_alias.set_defaults(func=command_approve_base)

    pose_ready = subparsers.add_parser("pose-ready")
    pose_ready.add_argument("--pose", required=True, help="姿势 ID")
    pose_ready.add_argument("--source", type=Path, required=True, help="姿势色键源图")
    pose_ready.add_argument("--final", type=Path, required=True, help="供用户确认的透明姿势立绘")
    pose_ready.set_defaults(func=command_pose_ready)

    approve_poses = subparsers.add_parser("approve-poses")
    approve_poses.set_defaults(func=command_approve_poses)

    complete = subparsers.add_parser("complete")
    complete.add_argument(
        "--output",
        action="append",
        default=[],
        metavar="EXPRESSION=PATH",
        help="按 manifest 表情逐项登记输出；可重复使用",
    )
    complete.add_argument("--normal", type=Path, help="兼容旧版三表情运行")
    complete.add_argument("--smile", type=Path, help="兼容旧版三表情运行")
    complete.add_argument("--laugh", type=Path, help="兼容旧版三表情运行")
    complete.set_defaults(func=command_complete)

    reset = subparsers.add_parser("reset-base")
    reset.add_argument("--reason", default="user requested a new base")
    reset.set_defaults(func=command_reset)

    reset_poses = subparsers.add_parser("reset-poses")
    reset_poses.add_argument("--reason", default="user requested a new pose group")
    reset_poses.set_defaults(func=command_reset_poses)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    manifest = load_manifest(args.manifest)
    args.func(args, manifest)


if __name__ == "__main__":
    main()
