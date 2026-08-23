#!/usr/bin/env python3
"""Enforce the v3 reference, pose, expression, and runtime approval state machine."""

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
    if data.get("schema_version") != 3 or "state" not in data:
        raise SystemExit("run_state.py 只接受含 state 的 schema_version=3 manifest")
    return data


def relative_or_absolute(path: Path, parent: Path) -> str:
    try:
        return str(path.resolve().relative_to(parent.resolve()))
    except ValueError:
        return str(path.resolve())


def resolve_record_path(root: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(encoded)
        temporary = Path(handle.name)
    os.replace(temporary, path)


def file_record(root: Path, source: Path, final: Path) -> dict:
    return {
        "source": relative_or_absolute(source, root),
        "source_sha256": digest(source),
        "final": relative_or_absolute(final, root),
        "final_sha256": digest(final),
        "ready_at": now(),
    }


def verify_file_record(root: Path, record: dict, label: str) -> None:
    source = resolve_record_path(root, record["source"])
    final = resolve_record_path(root, record["final"])
    if digest(source) != record["source_sha256"] or digest(final) != record["final_sha256"]:
        raise SystemExit(f"{label} 在批准后发生了变化")


def verify_base(manifest: dict, root: Path) -> None:
    record = manifest.get("approved_base")
    if record is None:
        raise SystemExit("manifest 缺少 approved_base")
    verify_file_record(root, record, "标准人设基准")


def verify_poses(manifest: dict, root: Path) -> None:
    verify_base(manifest, root)
    approved = manifest.get("approved_poses")
    if approved is None:
        raise SystemExit("manifest 缺少 approved_poses")
    for pose in manifest.get("poses", []):
        if pose not in approved:
            raise SystemExit(f"批准姿势组缺少 {pose}")
        verify_file_record(root, approved[pose], f"姿势 {pose}")


def verify_expressions(manifest: dict, root: Path) -> None:
    verify_poses(manifest, root)
    approved = manifest.get("approved_expressions")
    if approved is None:
        raise SystemExit("manifest 缺少 approved_expressions")
    for entry in manifest.get("expressions", []):
        expression = entry["id"]
        if expression not in approved:
            raise SystemExit(f"批准表情组缺少 {expression}")
        verify_file_record(root, approved[expression], f"表情 {expression}")


def clear_after_base(manifest: dict) -> None:
    for key in (
        "approved_base",
        "pose_candidates",
        "approved_poses",
        "expression_candidates",
        "approved_expressions",
        "runtime_candidates",
        "completed_runtime",
        "completed_at",
        "export",
    ):
        manifest.pop(key, None)


def clear_after_poses(manifest: dict) -> None:
    for key in (
        "approved_poses",
        "expression_candidates",
        "approved_expressions",
        "runtime_candidates",
        "completed_runtime",
        "completed_at",
        "export",
    ):
        manifest.pop(key, None)


def clear_after_expressions(manifest: dict) -> None:
    for key in (
        "approved_expressions",
        "runtime_candidates",
        "completed_runtime",
        "completed_at",
        "export",
    ):
        manifest.pop(key, None)


def command_status(args: argparse.Namespace, manifest: dict) -> None:
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def command_base_ready(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] not in {"BASE_PENDING", "BASE_REVIEW"}:
        raise SystemExit(f"当前状态 {manifest['state']} 不允许登记基准；请先 reset-base")
    root = args.manifest.parent
    manifest["base_candidate"] = file_record(root, args.source, args.final)
    clear_after_base(manifest)
    manifest["state"] = "BASE_REVIEW"
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "base_candidate": manifest["base_candidate"]}, ensure_ascii=False))


def command_approve_base(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] != "BASE_REVIEW" or "base_candidate" not in manifest:
        raise SystemExit("只有 BASE_REVIEW 下已登记的标准基准可以批准")
    root = args.manifest.parent
    candidate = manifest["base_candidate"]
    verify_file_record(root, candidate, "待批准标准基准")
    manifest["approved_base"] = {**candidate, "approved_at": now()}
    manifest["state"] = "POSES_PENDING"
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "approved_base": manifest["approved_base"]}, ensure_ascii=False))


def command_pose_ready(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] not in {"POSES_PENDING", "POSES_REVIEW"}:
        raise SystemExit(f"当前状态 {manifest['state']} 不允许登记姿势")
    required = list(manifest.get("poses", []))
    if args.pose not in required:
        raise SystemExit(f"manifest 未配置姿势: {args.pose}")
    root = args.manifest.parent
    verify_base(manifest, root)
    candidates = manifest.setdefault("pose_candidates", {})
    candidates[args.pose] = file_record(root, args.source, args.final)
    missing = [pose for pose in required if pose not in candidates]
    clear_after_poses(manifest)
    manifest["state"] = "POSES_PENDING" if missing else "POSES_REVIEW"
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "registered_pose": args.pose, "missing_poses": missing}, ensure_ascii=False))


def command_approve_poses(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] != "POSES_REVIEW":
        raise SystemExit("只有 POSES_REVIEW 下的完整姿势组可以批准")
    root = args.manifest.parent
    verify_base(manifest, root)
    required = list(manifest.get("poses", []))
    candidates = manifest.get("pose_candidates", {})
    missing = [pose for pose in required if pose not in candidates]
    if missing:
        raise SystemExit(f"姿势组不完整: {', '.join(missing)}")
    approved = {}
    for pose in required:
        verify_file_record(root, candidates[pose], f"待批准姿势 {pose}")
        approved[pose] = {**candidates[pose], "approved_at": now()}
    manifest["approved_poses"] = approved
    manifest["state"] = "EXPRESSIONS_PENDING"
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "approved_poses": approved}, ensure_ascii=False))


def expression_ids(manifest: dict) -> list[str]:
    return [entry["id"] for entry in manifest.get("expressions", [])]


def command_expression_ready(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] not in {"EXPRESSIONS_PENDING", "EXPRESSIONS_REVIEW"}:
        raise SystemExit(f"当前状态 {manifest['state']} 不允许登记表情")
    required = expression_ids(manifest)
    if args.expression not in required:
        raise SystemExit(f"manifest 未配置表情: {args.expression}")
    root = args.manifest.parent
    verify_poses(manifest, root)
    candidates = manifest.setdefault("expression_candidates", {})
    candidates[args.expression] = file_record(root, args.source, args.final)
    missing = [expression for expression in required if expression not in candidates]
    clear_after_expressions(manifest)
    manifest["state"] = "EXPRESSIONS_PENDING" if missing else "EXPRESSIONS_REVIEW"
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(
        json.dumps(
            {
                "state": manifest["state"],
                "registered_expression": args.expression,
                "missing_expressions": missing,
            },
            ensure_ascii=False,
        )
    )


def command_approve_expressions(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] != "EXPRESSIONS_REVIEW":
        raise SystemExit("只有 EXPRESSIONS_REVIEW 下的完整表情组可以批准")
    root = args.manifest.parent
    verify_poses(manifest, root)
    required = expression_ids(manifest)
    candidates = manifest.get("expression_candidates", {})
    missing = [expression for expression in required if expression not in candidates]
    if missing:
        raise SystemExit(f"表情组不完整: {', '.join(missing)}")
    approved = {}
    for expression in required:
        verify_file_record(root, candidates[expression], f"待批准表情 {expression}")
        approved[expression] = {**candidates[expression], "approved_at": now()}
    manifest["approved_expressions"] = approved
    if manifest.get("runtime_assets"):
        manifest["state"] = "RUNTIME_PENDING"
    else:
        manifest["state"] = "COMPLETE"
        manifest["completed_runtime"] = {}
        manifest["completed_at"] = now()
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "approved_expressions": approved}, ensure_ascii=False))


def command_runtime_ready(args: argparse.Namespace, manifest: dict) -> None:
    if manifest["state"] not in {"RUNTIME_PENDING", "COMPLETE"}:
        raise SystemExit(f"当前状态 {manifest['state']} 不允许登记运行时眼嘴差分")
    configured = manifest.get("runtime_assets", {})
    if args.asset not in configured:
        raise SystemExit(f"manifest 未配置运行时资产: {args.asset}")
    root = args.manifest.parent
    verify_expressions(manifest, root)
    try:
        qa = json.loads(args.qa.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取运行时 QA {args.qa}: {exc}") from exc
    if qa.get("outside_mask_changed_pixels") != 0:
        raise SystemExit("运行时完整帧在许可蒙版外发生了像素变化，拒绝登记")
    frame_sha = digest(args.frame)
    if qa.get("frame_sha256") and qa["frame_sha256"] != frame_sha:
        raise SystemExit("QA 中的 frame_sha256 与当前完整帧不一致")

    state = configured[args.asset].get("state")
    eye_review_record = None
    if state in {"eyes_half", "eyes_close"}:
        if args.eye_review is None:
            raise SystemExit("眼睛运行时素材缺少独立对位与残影审核，拒绝登记")
        try:
            eye_review = json.loads(args.eye_review.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"无法读取眼睛审核 {args.eye_review}: {exc}") from exc
        if eye_review.get("operation") != "eye-alignment-and-residue-review":
            raise SystemExit("眼睛审核类型不正确，拒绝登记")
        if eye_review.get("status") != "pass":
            raise SystemExit("眼睛对位与残影审核未通过，拒绝登记")
        if eye_review.get("state") != state:
            raise SystemExit("眼睛审核状态与运行时素材不匹配")
        if eye_review.get("candidate_sha256") != digest(args.candidate):
            raise SystemExit("眼睛审核对应的候选图已变化")
        if eye_review.get("frame_sha256") != frame_sha:
            raise SystemExit("眼睛审核对应的最终帧已变化")
        anchors = eye_review.get("anchors_pixels")
        if not isinstance(anchors, dict) or set(anchors) != {
            "left_inner", "left_outer", "right_inner", "right_outer"
        }:
            raise SystemExit("眼睛审核缺少四个母版眼角锚点")
        if not str(eye_review.get("reviewer_note", "")).strip():
            raise SystemExit("眼睛审核缺少具体观察记录")
        eye_review_record = {
            "eye_review": relative_or_absolute(args.eye_review, root),
            "eye_review_sha256": digest(args.eye_review),
        }

    record = {
        "source": relative_or_absolute(args.source, root),
        "source_sha256": digest(args.source),
        "candidate": relative_or_absolute(args.candidate, root),
        "candidate_sha256": digest(args.candidate),
        "frame": relative_or_absolute(args.frame, root),
        "frame_sha256": frame_sha,
        "qa": relative_or_absolute(args.qa, root),
        "qa_sha256": digest(args.qa),
        "ready_at": now(),
    }
    if args.part is not None:
        record["part"] = relative_or_absolute(args.part, root)
        record["part_sha256"] = digest(args.part)
    if eye_review_record is not None:
        record.update(eye_review_record)

    candidates = manifest.setdefault("runtime_candidates", {})
    candidates[args.asset] = record
    required = list(configured)
    missing = [asset for asset in required if asset not in candidates]
    manifest["state"] = "RUNTIME_PENDING" if missing else "COMPLETE"
    if missing:
        manifest.pop("completed_runtime", None)
        manifest.pop("completed_at", None)
    else:
        manifest["completed_runtime"] = candidates
        manifest["completed_at"] = now()
    manifest.pop("export", None)
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(
        json.dumps(
            {
                "state": manifest["state"],
                "registered_asset": args.asset,
                "missing_assets": missing,
            },
            ensure_ascii=False,
        )
    )


def command_reset_base(args: argparse.Namespace, manifest: dict) -> None:
    previous = manifest["state"]
    manifest["state"] = "BASE_PENDING"
    manifest.pop("base_candidate", None)
    clear_after_base(manifest)
    manifest["last_reset"] = {"from": previous, "reason": args.reason, "at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "last_reset": manifest["last_reset"]}, ensure_ascii=False))


def command_reset_poses(args: argparse.Namespace, manifest: dict) -> None:
    root = args.manifest.parent
    verify_base(manifest, root)
    previous = manifest["state"]
    manifest["state"] = "POSES_PENDING"
    manifest.pop("pose_candidates", None)
    clear_after_poses(manifest)
    manifest["last_pose_reset"] = {"from": previous, "reason": args.reason, "at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "last_pose_reset": manifest["last_pose_reset"]}, ensure_ascii=False))


def command_reset_expressions(args: argparse.Namespace, manifest: dict) -> None:
    root = args.manifest.parent
    verify_poses(manifest, root)
    previous = manifest["state"]
    manifest["state"] = "EXPRESSIONS_PENDING"
    manifest.pop("expression_candidates", None)
    clear_after_expressions(manifest)
    manifest["last_expression_reset"] = {"from": previous, "reason": args.reason, "at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(
        json.dumps(
            {"state": manifest["state"], "last_expression_reset": manifest["last_expression_reset"]},
            ensure_ascii=False,
        )
    )


def command_reset_runtime(args: argparse.Namespace, manifest: dict) -> None:
    root = args.manifest.parent
    verify_expressions(manifest, root)
    previous = manifest["state"]
    manifest["state"] = "RUNTIME_PENDING"
    manifest.pop("runtime_candidates", None)
    manifest.pop("completed_runtime", None)
    manifest.pop("completed_at", None)
    manifest.pop("export", None)
    manifest["last_runtime_reset"] = {"from": previous, "reason": args.reason, "at": now()}
    manifest["updated_at"] = now()
    atomic_write(args.manifest, manifest)
    print(json.dumps({"state": manifest["state"], "last_runtime_reset": manifest["last_runtime_reset"]}, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="v3 立绘差分运行状态机")
    parser.add_argument("manifest", type=Path)
    subparsers = parser.add_subparsers(dest="command", required=True)

    status = subparsers.add_parser("status")
    status.set_defaults(func=command_status)

    ready = subparsers.add_parser("base-ready")
    ready.add_argument("--source", type=Path, required=True)
    ready.add_argument("--final", type=Path, required=True)
    ready.set_defaults(func=command_base_ready)

    approve_base = subparsers.add_parser("approve-base")
    approve_base.set_defaults(func=command_approve_base)

    pose_ready = subparsers.add_parser("pose-ready")
    pose_ready.add_argument("--pose", required=True)
    pose_ready.add_argument("--source", type=Path, required=True)
    pose_ready.add_argument("--final", type=Path, required=True)
    pose_ready.set_defaults(func=command_pose_ready)

    approve_poses = subparsers.add_parser("approve-poses")
    approve_poses.set_defaults(func=command_approve_poses)

    expression_ready = subparsers.add_parser("expression-ready")
    expression_ready.add_argument("--expression", required=True)
    expression_ready.add_argument("--source", type=Path, required=True)
    expression_ready.add_argument("--final", type=Path, required=True)
    expression_ready.set_defaults(func=command_expression_ready)

    approve_expressions = subparsers.add_parser("approve-expressions")
    approve_expressions.set_defaults(func=command_approve_expressions)

    runtime_ready = subparsers.add_parser("runtime-ready")
    runtime_ready.add_argument("--asset", required=True)
    runtime_ready.add_argument("--source", type=Path, required=True)
    runtime_ready.add_argument("--candidate", type=Path, required=True)
    runtime_ready.add_argument("--frame", type=Path, required=True)
    runtime_ready.add_argument("--part", type=Path)
    runtime_ready.add_argument("--qa", type=Path, required=True)
    runtime_ready.add_argument("--eye-review", type=Path)
    runtime_ready.set_defaults(func=command_runtime_ready)

    reset_base = subparsers.add_parser("reset-base")
    reset_base.add_argument("--reason", default="user requested a new base")
    reset_base.set_defaults(func=command_reset_base)

    reset_poses = subparsers.add_parser("reset-poses")
    reset_poses.add_argument("--reason", default="user requested a new pose group")
    reset_poses.set_defaults(func=command_reset_poses)

    reset_expressions = subparsers.add_parser("reset-expressions")
    reset_expressions.add_argument("--reason", default="user requested a new expression group")
    reset_expressions.set_defaults(func=command_reset_expressions)

    reset_runtime = subparsers.add_parser("reset-runtime")
    reset_runtime.add_argument("--reason", default="user requested new runtime states")
    reset_runtime.set_defaults(func=command_reset_runtime)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    manifest = load_manifest(args.manifest)
    args.func(args, manifest)


if __name__ == "__main__":
    main()
