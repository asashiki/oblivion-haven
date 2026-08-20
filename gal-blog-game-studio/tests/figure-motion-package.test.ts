import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import test from "node:test";

import type { FacialMotionPackageV2 } from "../lib/figure-motion/schema";
import { validateFacialMotionPackage, type MotionPackageFiles } from "../lib/figure-motion/validation";

const fixtureRoot = resolve("tests/fixtures/face-motion-demo");

async function fixture(): Promise<{ manifest: FacialMotionPackageV2; files: MotionPackageFiles }> {
  const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "manifest.json"), "utf8")) as FacialMotionPackageV2;
  const files: MotionPackageFiles = new Map();
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".png")) files.set(relative(fixtureRoot, path).replace(/\\/g, "/"), new Uint8Array(await readFile(path)));
    }
  };
  await walk(fixtureRoot);
  return { manifest, files };
}

test("v2 fixture 校验画布、显式 open/closed、图片解码与 SHA-256", async () => {
  const loaded = await fixture();
  assert.deepEqual(validateFacialMotionPackage(loaded.manifest, loaded.files), []);
  for (const expression of Object.values(loaded.manifest.expressions)) {
    assert.ok(expression.eyes.open.file);
    assert.ok(expression.mouth.closed.file);
  }
});

test("part rect 越界会被拒绝", async () => {
  const loaded = await fixture();
  const manifest = structuredClone(loaded.manifest);
  manifest.expressions.guide.eyes.closed.rect.x = 1000;
  assert.ok(validateFacialMotionPackage(manifest, loaded.files).some((issue) => issue.code === "RECT_BOUNDS"));
});

test("眼睛与嘴巴 rect 重叠会被拒绝", async () => {
  const loaded = await fixture();
  const manifest = structuredClone(loaded.manifest);
  manifest.expressions.guide.mouth.closed.rect = { ...manifest.expressions.guide.eyes.open.rect };
  assert.ok(validateFacialMotionPackage(manifest, loaded.files).some((issue) => issue.code === "PART_OVERLAP"));
});

test("来源或部件 hash 改变会被拒绝", async () => {
  const loaded = await fixture();
  const manifest = structuredClone(loaded.manifest);
  manifest.expressions.welcome.sourceSha256 = "0".repeat(64);
  manifest.expressions.guide.mouth.open.sha256 = "f".repeat(64);
  const codes = validateFacialMotionPackage(manifest, loaded.files).map((issue) => issue.code);
  assert.ok(codes.includes("SOURCE_HASH"));
  assert.ok(codes.includes("PART_HASH"));
});
