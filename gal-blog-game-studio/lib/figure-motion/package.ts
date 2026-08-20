import type { FacialMotionPackageV2 } from "./schema";
import { assertValidFacialMotionPackage, type MotionPackageFiles } from "./validation";

export type LoadedFacialMotionPackage = {
  manifest: FacialMotionPackageV2;
  files: MotionPackageFiles;
  urls: Map<string, string>;
  dispose: () => void;
};

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function resolvePackageFile(files: MotionPackageFiles, requested: string): Uint8Array | undefined {
  const path = normalizedPath(requested);
  if (files.has(path)) return files.get(path);
  const suffixMatches = [...files.entries()].filter(([key]) => normalizedPath(key).endsWith(`/${path}`));
  if (suffixMatches.length === 1) return suffixMatches[0][1];
  const name = path.split("/").pop();
  const basenameMatches = [...files.entries()].filter(([key]) => normalizedPath(key).split("/").pop() === name);
  return basenameMatches.length === 1 ? basenameMatches[0][1] : undefined;
}

function buildLoaded(manifest: FacialMotionPackageV2, files: MotionPackageFiles): LoadedFacialMotionPackage {
  assertValidFacialMotionPackage(manifest, files);
  const urls = new Map<string, string>();
  const referenced = new Set<string>();
  Object.values(manifest.expressions).forEach((expression) => {
    referenced.add(expression.base);
    referenced.add(expression.eyes.open.file);
    if (expression.eyes.half) referenced.add(expression.eyes.half.file);
    referenced.add(expression.eyes.closed.file);
    referenced.add(expression.mouth.closed.file);
    referenced.add(expression.mouth.half.file);
    referenced.add(expression.mouth.open.file);
  });
  referenced.forEach((path) => {
    const bytes = resolvePackageFile(files, path);
    if (bytes) {
      const copy = Uint8Array.from(bytes);
      urls.set(path, URL.createObjectURL(new Blob([copy.buffer], { type: "image/png" })));
    }
  });
  return {
    manifest,
    files,
    urls,
    dispose: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  };
}

export async function loadFacialMotionPackageFromFiles(input: File[]): Promise<LoadedFacialMotionPackage> {
  const files: MotionPackageFiles = new Map();
  for (const file of input) {
    const path = normalizedPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    files.set(path, new Uint8Array(await file.arrayBuffer()));
  }
  const manifestEntry = [...files.entries()].find(([path]) => path === "manifest.json" || path.endsWith("/manifest.json"));
  if (!manifestEntry) throw new Error("所选文件里没有 manifest.json。");
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry[1])) as FacialMotionPackageV2;
  return buildLoaded(manifest, files);
}

export async function loadFacialMotionPackageFromUrl(manifestUrl: string): Promise<LoadedFacialMotionPackage> {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`面部动作包载入失败：${response.status}`);
  const manifest = await response.json() as FacialMotionPackageV2;
  const root = new URL(".", new URL(manifestUrl, window.location.href));
  const paths = new Set<string>();
  Object.values(manifest.expressions).forEach((expression) => {
    paths.add(expression.base);
    paths.add(expression.eyes.open.file);
    if (expression.eyes.half) paths.add(expression.eyes.half.file);
    paths.add(expression.eyes.closed.file);
    paths.add(expression.mouth.closed.file);
    paths.add(expression.mouth.half.file);
    paths.add(expression.mouth.open.file);
  });
  const files: MotionPackageFiles = new Map();
  await Promise.all([...paths].map(async (path) => {
    const fileResponse = await fetch(new URL(path, root));
    if (!fileResponse.ok) throw new Error(`面部动作素材载入失败：${path}`);
    files.set(path, new Uint8Array(await fileResponse.arrayBuffer()));
  }));
  return buildLoaded(manifest, files);
}
