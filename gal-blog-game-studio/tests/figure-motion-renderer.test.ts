import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  independentLayerPlan,
  normalizedPausedState,
  swapExpression,
  webGalWholeTexturePlan,
  type FigureRenderState,
} from "../lib/figure-motion/layeredRenderer";
import type { FacialMotionPackageV2 } from "../lib/figure-motion/schema";

const manifest = JSON.parse(await readFile("tests/fixtures/face-motion-demo/manifest.json", "utf8")) as FacialMotionPackageV2;

test("independent renderer 同时合成 closed eye + open mouth", () => {
  const expression = manifest.expressions.welcome;
  const plan = independentLayerPlan(expression, "closed", "open");
  const parts = plan.filter((operation) => operation.kind === "draw-part");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].kind === "draw-part" ? parts[0].part.file : "", expression.eyes.closed.file);
  assert.equal(parts[1].kind === "draw-part" ? parts[1].part.file : "", expression.mouth.open.file);
});

test("WebGAL A/B 模拟会让最后写入的整图状态覆盖另一状态", () => {
  const expression = manifest.expressions.welcome;
  const eyeLast = webGalWholeTexturePlan(expression, "closed", "open", "eyes");
  const mouthLast = webGalWholeTexturePlan(expression, "closed", "open", "mouth");
  assert.equal(eyeLast.filter((item) => item.kind === "draw-part").length, 1);
  assert.equal(mouthLast.filter((item) => item.kind === "draw-part").length, 1);
  assert.notDeepEqual(eyeLast, mouthLast);
});

test("暂停归一为 open + closed，不会卡在眨眼或张嘴中间态", () => {
  const state: FigureRenderState = {
    expressionId: "welcome",
    eyes: "half",
    mouth: "open",
    lastChanged: "eyes",
    stageTransform: { x: 12, y: 8, scale: 1.08, rotation: 0 },
  };
  const paused = normalizedPausedState(state);
  assert.equal(paused.eyes, "open");
  assert.equal(paused.mouth, "closed");
});

test("表情切换保留位置、尺度、旋转和脚点所依赖的外部 transform", () => {
  const state: FigureRenderState = {
    expressionId: "welcome",
    eyes: "open",
    mouth: "closed",
    lastChanged: "mouth",
    stageTransform: { x: -18, y: 0, scale: 0.92, rotation: 0 },
  };
  const swapped = swapExpression(state, "guide");
  assert.deepEqual(swapped.stageTransform, state.stageTransform);
  assert.equal(swapped.expressionId, "guide");
});
