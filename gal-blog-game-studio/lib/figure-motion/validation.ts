import { sha256 as sha256Bytes } from "@noble/hashes/sha2.js";

import type { FacialMotionPackageV2, PartRef, Rect } from "./schema";

export type MotionPackageFiles = Map<string, Uint8Array>;

export type MotionPackageIssue = {
  code: string;
  path: string;
  message: string;
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function sha256Hex(bytes: Uint8Array): string {
  return [...sha256Bytes(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 33) return undefined;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return undefined;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) return undefined;
  let offset = 8;
  let sawEnd = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const type = String.fromCharCode(...bytes.slice(typeOffset, typeOffset + 4));
    const next = offset + 12 + length;
    if (next > bytes.byteLength) return undefined;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = next;
  }
  return sawEnd ? { width, height } : undefined;
}

function fileBytes(files: MotionPackageFiles, path: string): Uint8Array | undefined {
  const requested = normalizePath(path);
  if (files.has(requested)) return files.get(requested);
  const suffixMatches = [...files.entries()].filter(([key]) => normalizePath(key).endsWith(`/${requested}`));
  if (suffixMatches.length === 1) return suffixMatches[0][1];
  const name = requested.split("/").pop();
  const basenameMatches = [...files.entries()].filter(([key]) => normalizePath(key).split("/").pop() === name);
  return basenameMatches.length === 1 ? basenameMatches[0][1] : undefined;
}

function validateRect(rect: Rect, canvas: FacialMotionPackageV2["canvas"]): boolean {
  return Number.isInteger(rect.x)
    && Number.isInteger(rect.y)
    && Number.isInteger(rect.width)
    && Number.isInteger(rect.height)
    && rect.x >= 0
    && rect.y >= 0
    && rect.width > 0
    && rect.height > 0
    && rect.x + rect.width <= canvas.width
    && rect.y + rect.height <= canvas.height;
}

function partEntries(expression: FacialMotionPackageV2["expressions"][string]): Array<[string, PartRef]> {
  return [
    ["eyes.open", expression.eyes.open],
    ...(expression.eyes.half ? [["eyes.half", expression.eyes.half] as [string, PartRef]] : []),
    ["eyes.closed", expression.eyes.closed],
    ["mouth.closed", expression.mouth.closed],
    ["mouth.half", expression.mouth.half],
    ["mouth.open", expression.mouth.open],
  ];
}

export function validateFacialMotionPackage(
  manifest: FacialMotionPackageV2,
  files: MotionPackageFiles,
): MotionPackageIssue[] {
  const issues: MotionPackageIssue[] = [];
  if (manifest.schema !== "galgame-face-motion/v2") {
    issues.push({ code: "SCHEMA", path: "schema", message: "需要 galgame-face-motion/v2。" });
  }
  if (!Number.isInteger(manifest.canvas?.width) || !Number.isInteger(manifest.canvas?.height)
    || manifest.canvas.width <= 0 || manifest.canvas.height <= 0) {
    issues.push({ code: "CANVAS", path: "canvas", message: "画布尺寸无效。" });
    return issues;
  }
  const expressionEntries = Object.entries(manifest.expressions || {});
  if (!expressionEntries.length) issues.push({ code: "EXPRESSIONS", path: "expressions", message: "至少需要一个表情。" });

  for (const [expressionId, expression] of expressionEntries) {
    const root = `expressions.${expressionId}`;
    const base = fileBytes(files, expression.base);
    if (!base) {
      issues.push({ code: "FILE_MISSING", path: `${root}.base`, message: `找不到 ${expression.base}` });
    } else {
      const size = pngDimensions(base);
      if (!size) issues.push({ code: "IMAGE_DECODE", path: `${root}.base`, message: `${expression.base} 不是完整 PNG。` });
      else if (size.width !== manifest.canvas.width || size.height !== manifest.canvas.height) {
        issues.push({ code: "CANVAS_MISMATCH", path: `${root}.base`, message: `${expression.base} 画布尺寸不一致。` });
      }
      if (sha256Hex(base) !== expression.sourceSha256) {
        issues.push({ code: "SOURCE_HASH", path: `${root}.sourceSha256`, message: `${expression.base} 的来源哈希不匹配。` });
      }
    }

    const entries = partEntries(expression);
    for (const [partPath, part] of entries) {
      if (!validateRect(part.rect, manifest.canvas)) {
        issues.push({ code: "RECT_BOUNDS", path: `${root}.${partPath}.rect`, message: `${partPath} 的矩形越出画布。` });
      }
      const bytes = fileBytes(files, part.file);
      if (!bytes) {
        issues.push({ code: "FILE_MISSING", path: `${root}.${partPath}.file`, message: `找不到 ${part.file}` });
        continue;
      }
      const size = pngDimensions(bytes);
      if (!size || size.width !== part.rect.width || size.height !== part.rect.height) {
        issues.push({ code: "PART_DECODE", path: `${root}.${partPath}.file`, message: `${part.file} 无法解码或尺寸与 rect 不一致。` });
      }
      if (sha256Hex(bytes) !== part.sha256) {
        issues.push({ code: "PART_HASH", path: `${root}.${partPath}.sha256`, message: `${part.file} 的哈希不匹配。` });
      }
    }

    const eyeRects = [expression.eyes.open.rect, expression.eyes.half?.rect, expression.eyes.closed.rect].filter(Boolean) as Rect[];
    const mouthRects = [expression.mouth.closed.rect, expression.mouth.half.rect, expression.mouth.open.rect];
    if (eyeRects.some((eye) => mouthRects.some((mouth) => rectsOverlap(eye, mouth)))) {
      issues.push({ code: "PART_OVERLAP", path: root, message: "眼睛与嘴巴替换矩形不能重叠。" });
    }
  }
  return issues;
}

export function assertValidFacialMotionPackage(manifest: FacialMotionPackageV2, files: MotionPackageFiles): void {
  const issues = validateFacialMotionPackage(manifest, files);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
}
