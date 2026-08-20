import assert from "node:assert/strict";
import test from "node:test";

import { eyeStateAt, normalizedPausedEyeState, scheduleBlinkEvents } from "../lib/figure-motion/blinkScheduler";
import { DEFAULT_BLINK_PROFILE } from "../lib/figure-motion/schema";

test("固定 seed 完全可复现且语音开头不强制眨眼", () => {
  const first = scheduleBlinkEvents(60_000, DEFAULT_BLINK_PROFILE, { hasHalf: true });
  const second = scheduleBlinkEvents(60_000, DEFAULT_BLINK_PROFILE, { hasHalf: true });
  assert.deepEqual(first, second);
  assert.ok(first.length > 5);
  assert.ok(first[0].startMs >= DEFAULT_BLINK_PROFILE.minIntervalMs);
  assert.equal(eyeStateAt(first, 0), "open");
});

test("60 秒仍持续调度，没有 10 秒上限", () => {
  const events = scheduleBlinkEvents(60_000, DEFAULT_BLINK_PROFILE, { hasHalf: true });
  assert.ok(events.some((event) => event.startMs > 50_000));
});

test("表情切换前后 250ms 抑制自动眨眼", () => {
  const events = scheduleBlinkEvents(30_000, DEFAULT_BLINK_PROFILE, {
    suppressWindows: [{ startMs: 6000, endMs: 6200 }],
  });
  assert.ok(events.every((event) => event.startMs < 5750 || event.startMs > 6450));
});

test("没有 half 时降级为 open/closed，fixed-closed 禁用调度，暂停归一 open", () => {
  const events = scheduleBlinkEvents(20_000, DEFAULT_BLINK_PROFILE, { hasHalf: false });
  assert.ok(events.flatMap((event) => event.phases).every((phase) => phase.state === "closed"));
  assert.deepEqual(scheduleBlinkEvents(20_000, DEFAULT_BLINK_PROFILE, { fixedClosed: true }), []);
  assert.equal(normalizedPausedEyeState(), "open");
});
