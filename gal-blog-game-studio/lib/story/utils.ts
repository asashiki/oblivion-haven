import type { Id, StoryProject } from "./types";

export function createId(prefix = "id"): Id {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deepClone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || `scene-${Date.now().toString(36)}`;
}

export function escapeWebgal(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([:;|,.])/g, "\\$1")
    .replace(/\r?\n/g, "\\n");
}

export function sanitizeWebgalArg(value: string): string {
  return String(value ?? "").replace(/[\r\n;]/g, " ").trim();
}

export function findScene(project: StoryProject, sceneId: Id) {
  return project.scenes.find((scene) => scene.id === sceneId);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
