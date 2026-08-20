import assert from "node:assert/strict";
import test from "node:test";

import { analyseAudioSamples } from "../lib/figure-motion/audioEnvelope";
import { buildMouthTimeline, mouthStateAt } from "../lib/figure-motion/mouthTimeline";
import { DEFAULT_MOUTH_PROFILE } from "../lib/figure-motion/schema";

function syntheticVoice(): { samples: Float32Array; sampleRate: number } {
  const sampleRate = 1000;
  const durationMs = 2600;
  const samples = new Float32Array(durationMs);
  for (let index = 0; index < samples.length; index += 1) {
    const voiced = (index >= 350 && index < 1050) || (index >= 1090 && index < 1900);
    samples[index] = voiced ? Math.sin(index / 4.7) * (index < 900 ? 0.34 : 0.7) : 0.001;
  }
  return { samples, sampleRate };
}

test("RMS + attack/release + hysteresis 产生确定性三态时间线", () => {
  const voice = syntheticVoice();
  const first = buildMouthTimeline(analyseAudioSamples(voice.samples, voice.sampleRate, DEFAULT_MOUTH_PROFILE), DEFAULT_MOUTH_PROFILE);
  const second = buildMouthTimeline(analyseAudioSamples(voice.samples, voice.sampleRate, DEFAULT_MOUTH_PROFILE), DEFAULT_MOUTH_PROFILE);
  assert.deepEqual(first, second);
  assert.ok(first.segments.some((segment) => segment.state === "open"));
  assert.ok(first.segments.some((segment) => segment.state === "half"));
});

test("口型 segment 不短于 minHold，短静音缝隙被合并，结尾强制闭嘴", () => {
  const voice = syntheticVoice();
  const timeline = buildMouthTimeline(analyseAudioSamples(voice.samples, voice.sampleRate, DEFAULT_MOUTH_PROFILE), DEFAULT_MOUTH_PROFILE);
  assert.ok(timeline.segments.every((segment) => segment.endMs - segment.startMs >= DEFAULT_MOUTH_PROFILE.minHoldMs - 0.001));
  assert.notEqual(mouthStateAt(timeline, 1070), "closed");
  assert.equal(timeline.segments[timeline.segments.length - 1].state, "closed");
  assert.equal(mouthStateAt(timeline, timeline.durationMs), "closed");
});

test("纯静音不会随机抖嘴", () => {
  const samples = new Float32Array(2000);
  const timeline = buildMouthTimeline(analyseAudioSamples(samples, 1000, DEFAULT_MOUTH_PROFILE), DEFAULT_MOUTH_PROFILE);
  assert.deepEqual(timeline.segments, [{ startMs: 0, endMs: 2000, state: "closed" }]);
});
