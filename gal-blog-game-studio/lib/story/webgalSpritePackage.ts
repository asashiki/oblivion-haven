import { strFromU8, unzipSync } from "fflate";

export type SpriteFrameRole =
  | "base"
  | "mouthOpen"
  | "mouthHalfOpen"
  | "mouthClose"
  | "eyesOpen"
  | "eyesClose";

export type ParsedSpriteFrame = {
  relativePath: string;
  bytes: Uint8Array;
  mimeType: string;
};

export type ParsedSpriteExpression = {
  label: string;
  pose?: string;
  blink: "dynamic" | "fixed-open" | "fixed-closed" | "none";
  mouthSync: boolean;
  files: Partial<Record<SpriteFrameRole, string>>;
  issues: string[];
};

export type ParsedWebGalSpritePackage = {
  packageName: string;
  schemaVersion: string;
  engine: string;
  installTo?: string;
  readme?: string;
  inventory?: unknown;
  expressions: ParsedSpriteExpression[];
  frames: Map<string, ParsedSpriteFrame>;
  issues: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index + 1);
}

function basename(path: string): string {
  return normalizedPath(path).split("/").pop() || path;
}

function mimeTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function stringField(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function booleanField(source: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function resolveEntryPath(
  requested: string | undefined,
  entries: string[],
  manifestRoot: string,
  installTo?: string,
): string | undefined {
  if (!requested) return undefined;
  const value = normalizedPath(requested);
  const install = installTo ? normalizedPath(installTo) : "";
  const candidates = [
    value,
    `${manifestRoot}${value}`,
    value.replace(/^game\/figure\//, ""),
    `${manifestRoot}${value.replace(/^game\/figure\//, "")}`,
    install && value.startsWith(install) ? value.slice(install.length).replace(/^\//, "") : "",
  ].filter(Boolean).map(normalizedPath);
  const direct = candidates.find((candidate) => entries.includes(candidate));
  if (direct) return direct;
  const sameName = entries.filter((entry) => basename(entry) === basename(value));
  return sameName.length === 1 ? sameName[0] : undefined;
}

function figureList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.map(record);
  const source = record(value);
  return Object.entries(source).map(([key, item]) => ({ id: key, ...record(item) }));
}

export function parseWebGalSpritePackage(bytes: Uint8Array, archiveName = "sprite-package.zip"): ParsedWebGalSpritePackage {
  const archive = unzipSync(bytes);
  const entries = Object.keys(archive).map(normalizedPath).filter((path) => !path.endsWith("/"));
  const manifestPath = entries
    .filter((path) => path.endsWith("webgal-manifest.json"))
    .sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new Error("压缩包里没有 webgal-manifest.json；请上传立绘 Skill 的 deliverables 成品包。");
  const manifestRoot = dirname(manifestPath);
  const manifest = JSON.parse(strFromU8(archive[manifestPath])) as unknown;
  const manifestRecord = record(manifest);
  const installTo = stringField(manifestRecord, "install_to", "installTo");
  const rawFigures = figureList(manifestRecord.figures);
  if (!rawFigures.length) throw new Error("webgal-manifest.json 里没有 figures 定义。");

  const usedPaths = new Set<string>();
  const expressions = rawFigures.map((item, index): ParsedSpriteExpression => {
    const files = record(item.files);
    const states = record(files.states);
    const webgal = { ...record(item.webgal), ...record(record(item.webgal).params) };
    const requested: Partial<Record<SpriteFrameRole, string>> = {
      base: stringField(files, "base") || stringField(webgal, "base", "src", "figure"),
      mouthOpen: stringField(webgal, "mouthOpen") || stringField(states, "mouthOpen", "mouth_open"),
      mouthHalfOpen: stringField(webgal, "mouthHalfOpen") || stringField(states, "mouthHalfOpen", "mouth_half_open"),
      mouthClose: stringField(webgal, "mouthClose") || stringField(states, "mouthClose", "mouth_close"),
      eyesOpen: stringField(webgal, "eyesOpen") || stringField(states, "eyesOpen", "eyes_open"),
      eyesClose: stringField(webgal, "eyesClose") || stringField(states, "eyesClose", "eyes_close"),
    };
    requested.base ||= requested.mouthClose || requested.eyesOpen;
    const resolved = Object.fromEntries(
      Object.entries(requested).flatMap(([role, path]) => {
        const entry = resolveEntryPath(path, entries, manifestRoot, installTo);
        if (!entry) return [];
        usedPaths.add(entry);
        return [[role, entry]];
      }),
    ) as Partial<Record<SpriteFrameRole, string>>;
    const blinkValue = stringField(item, "blink")?.toLowerCase();
    const dynamicBlink = Boolean(resolved.eyesClose && resolved.eyesOpen);
    const blink = blinkValue === "fixed-closed" || blinkValue === "closed" || blinkValue === "fixed_closed"
      ? "fixed-closed"
      : blinkValue === "fixed-open" || blinkValue === "open" || blinkValue === "fixed_open"
        ? "fixed-open"
        : dynamicBlink ? "dynamic" : "none";
    const mouthSync = booleanField(item, "mouth_sync", "mouthSync")
      ?? Boolean(resolved.mouthOpen && (resolved.mouthClose || resolved.base));
    const issues: string[] = [];
    if (!resolved.base) issues.push("缺少 base 全画布帧");
    if (mouthSync && !resolved.mouthOpen) issues.push("声明了动嘴但缺少 mouthOpen");
    if (blink === "dynamic" && !resolved.eyesClose) issues.push("声明了眨眼但缺少 eyesClose");
    return {
      label: stringField(item, "label", "name", "id") || `表情 ${index + 1}`,
      pose: stringField(item, "pose"),
      blink,
      mouthSync,
      files: resolved,
      issues,
    };
  });

  const frames = new Map<string, ParsedSpriteFrame>();
  usedPaths.forEach((path) => {
    frames.set(path, { relativePath: path, bytes: archive[path], mimeType: mimeTypeFor(path) });
  });
  const readmePath = entries.find((path) => path === `${manifestRoot}README.md`) || entries.find((path) => path.endsWith("/README.md"));
  const inventoryPath = entries.find((path) => path === `${manifestRoot}inventory.json`) || entries.find((path) => path.endsWith("/inventory.json"));
  const issues = expressions.flatMap((expression) => expression.issues.map((issue) => `${expression.label}：${issue}`));
  return {
    packageName: archiveName.replace(/\.zip$/i, ""),
    schemaVersion: stringField(manifestRecord, "schema_version", "schemaVersion") || "unknown",
    engine: stringField(manifestRecord, "engine") || "WebGAL",
    installTo,
    readme: readmePath ? strFromU8(archive[readmePath]) : undefined,
    inventory: inventoryPath ? JSON.parse(strFromU8(archive[inventoryPath])) : undefined,
    expressions,
    frames,
    issues,
  };
}
