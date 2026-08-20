import assert from "node:assert/strict";
import test from "node:test";

import { FACE_MOTION_PERFORMANCE_FIXTURE } from "../lib/story/performancePlan";
import { cuesAtTime, validatePerformancePlan } from "../lib/story/performanceValidator";

test("最小演出计划包含入场、句中表情切换、lean 与 settle", () => {
  assert.deepEqual(validatePerformancePlan(FACE_MOTION_PERFORMANCE_FIXTURE), []);
  const actions = FACE_MOTION_PERFORMANCE_FIXTURE.cues.map((cue) => cue.action);
  assert.ok(actions.includes("enter"));
  assert.ok(actions.includes("expression-swap"));
  assert.ok(actions.includes("lean"));
  assert.ok(actions.includes("settle"));
  assert.ok(FACE_MOTION_PERFORMANCE_FIXTURE.cues.every((cue) => cue.reason && cue.pauseSafe && cue.autoModeSafe));
});

test("cue reason、pauseSafe 与 expressionId 缺失会被拒绝", () => {
  const invalid = structuredClone(FACE_MOTION_PERFORMANCE_FIXTURE);
  invalid.cues[0].reason = "";
  invalid.cues[0].pauseSafe = undefined as never;
  const swap = invalid.cues.find((cue) => cue.action === "expression-swap")!;
  swap.expressionId = undefined;
  const codes = validatePerformancePlan(invalid).map((issue) => issue.code);
  assert.ok(codes.includes("REASON"));
  assert.ok(codes.includes("PAUSE_SAFE"));
  assert.ok(codes.includes("EXPRESSION"));
});

test("拖动或循环时只触发越过时间边界的 cue", () => {
  const cues = cuesAtTime(FACE_MOTION_PERFORMANCE_FIXTURE.cues, 6100, 7700);
  assert.deepEqual(cues.map((cue) => cue.id), ["swap", "lean"]);
});
