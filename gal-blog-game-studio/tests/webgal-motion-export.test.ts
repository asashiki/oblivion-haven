import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildRuntimePackage, type WebGalRuntimeManifest } from "../lib/story/exporter";
import { maidMotionProject } from "../lib/story/maidMotionProject";
import { deepClone } from "../lib/story/utils";

test("正式 WebGAL 包包含眼嘴部件与口型时间线", async () => {
  const project = deepClone(maidMotionProject);
  project.settings.blogBridge.allowedOrigins = ["https://example.com"];
  const runtime = JSON.parse(await readFile("public/vendor/webgal/runtime-manifest.json", "utf8")) as WebGalRuntimeManifest;
  const runtimeFiles = Object.fromEntries(await Promise.all(runtime.files.map(async (file) => [
    file.path,
    new Uint8Array(await readFile(`public/vendor/webgal/${file.path}`)),
  ] as const)));
  const assetFiles: Record<string, Uint8Array> = {};
  for (const asset of project.assets) {
    assetFiles[asset.id] = new Uint8Array(await readFile(`public/${asset.path}`));
  }
  const partPaths = new Set<string>();
  for (const character of project.characters) {
    for (const expression of character.expressions) {
      for (const part of [
        ...Object.values(expression.facialMotion?.parts?.eyes || {}),
        ...Object.values(expression.facialMotion?.parts?.mouth || {}),
      ]) if (part?.file) partPaths.add(part.file);
    }
  }
  for (const path of partPaths) {
    assetFiles[`face-motion:${path}`] = new Uint8Array(await readFile(`public/${path}`));
  }
  const timeline = String(project.assets.find((asset) => asset.kind === "voice")?.metadata?.mouthTimelinePath);
  assetFiles[`face-motion:${timeline}`] = new Uint8Array(await readFile(`public/${timeline}`));

  const result = await buildRuntimePackage(project, runtime, runtimeFiles, assetFiles);
  assert.ok(result.entries["game/face-motion/mouth-timeline.json"]);
  assert.ok(result.entries["game/figure/face-motion-demo/parts/welcome-mouth-open.png"]);
  assert.ok(result.entries["game/figure/face-motion-demo/parts/welcome-eye-closed.png"]);
  assert.ok(result.entries["game/extensions/face-motion-adapter.js"]);
});
