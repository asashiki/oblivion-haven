import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileProject } from "../lib/story/compiler";
import { buildWebGalLayerManifest } from "../lib/figure-motion/webgalLayerManifest";
import { maidMotionProject } from "../lib/story/maidMotionProject";
import type { StoryAsset } from "../lib/story/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(root, "public", "webgal-preview");

function assetTarget(asset: StoryAsset): string {
  const source = asset.path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (asset.kind === "background") return `game/background/${source}`;
  if (asset.kind === "figure" || asset.kind === "expression") return `game/figure/${source}`;
  if (asset.kind === "bgm") return `game/bgm/${source}`;
  if (asset.kind === "voice" || asset.kind === "sfx") return `game/vocal/${source}`;
  if (asset.kind === "video") return `game/video/${source}`;
  if (asset.kind === "animation") return `game/animation/${source}`;
  if (asset.kind === "ui") return `game/template/${source}`;
  return `game/${source}`;
}

async function copyPublic(sourcePath: string, targetPath: string): Promise<void> {
  const destination = join(outputRoot, targetPath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(root, "public", sourcePath), destination);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(join(root, "public", "vendor", "webgal"), join(outputRoot, "runtime"), { recursive: true });

const compiled = compileProject(maidMotionProject, { previewMode: true });
for (const file of compiled.files) {
  const destination = join(outputRoot, file.path);
  await mkdir(dirname(destination), { recursive: true });
  const content = file.path === "index.html"
    ? file.content
      .replaceAll("/vendor/webgal/assets/index-BuN51U1e.js", "./runtime/assets/index-BuN51U1e.js")
      .replaceAll("/vendor/webgal/assets/index-Dch1g2w9.css", "./runtime/assets/index-Dch1g2w9.css")
    : file.content;
  await writeFile(destination, content);
}

for (const asset of maidMotionProject.assets) {
  await copyPublic(asset.path, assetTarget(asset));
}

const layerManifest = buildWebGalLayerManifest(maidMotionProject);
const partPaths = new Set<string>();
for (const figure of Object.values(layerManifest.figures)) {
  for (const expression of Object.values(figure.expressions)) {
    for (const part of Object.values(expression.eyes)) if (part) partPaths.add(part.file);
    for (const part of Object.values(expression.mouth)) if (part) partPaths.add(part.file);
  }
}
for (const partPath of partPaths) {
  await copyPublic(partPath, `game/figure/${partPath}`);
}

const timelinePath = maidMotionProject.assets.find((asset) => asset.kind === "voice")?.metadata?.mouthTimelinePath;
if (typeof timelinePath === "string") {
  await copyPublic(timelinePath, "game/face-motion/mouth-timeline.json");
}

console.log(`Prepared WebGAL motion smoke runtime (${compiled.files.length} compiled files, ${partPaths.size} face parts).`);
