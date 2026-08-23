import type { AudioEnvelope } from "./audioEnvelope";
import type { MouthProfile, MouthState } from "./schema";

export type MouthSegment = {
  startMs: number;
  endMs: number;
  state: MouthState;
};

export type MouthTimeline = {
  schema: "galgame-mouth-timeline/v1";
  durationMs: number;
  windowMs: number;
  segments: MouthSegment[];
};

function targetState(value: number, current: MouthState, profile: MouthProfile): MouthState {
  const closeUp = profile.closeThreshold + profile.hysteresis;
  const closeDown = Math.max(0, profile.closeThreshold - profile.hysteresis);
  const openUp = profile.openThreshold + profile.hysteresis;
  const openDown = profile.openThreshold - profile.hysteresis;
  if (current === "closed") return value >= openUp ? "open" : value >= closeUp ? "half" : "closed";
  if (current === "half") return value >= openUp ? "open" : value <= closeDown ? "closed" : "half";
  return value <= closeDown ? "closed" : value <= openDown ? "half" : "open";
}

function mergeBriefSilentGaps(values: number[], profile: MouthProfile): number[] {
  const result = [...values];
  const maxFrames = Math.max(0, Math.floor(profile.mergeGapMs / profile.windowMs));
  let index = 0;
  while (index < result.length) {
    if (result[index] >= profile.closeThreshold) { index += 1; continue; }
    const start = index;
    while (index < result.length && result[index] < profile.closeThreshold) index += 1;
    const length = index - start;
    if (start > 0 && index < result.length && length <= maxFrames) {
      const bridge = Math.min(result[start - 1], result[index]);
      for (let cursor = start; cursor < index; cursor += 1) result[cursor] = bridge;
    }
  }
  return result;
}

function coalesce(segments: MouthSegment[]): MouthSegment[] {
  const result: MouthSegment[] = [];
  for (const segment of segments) {
    const previous = result[result.length - 1];
    if (previous?.state === segment.state) previous.endMs = segment.endMs;
    else result.push({ ...segment });
  }
  return result;
}

function enforceMinimumHold(segments: MouthSegment[], minHoldMs: number, durationMs: number): MouthSegment[] {
  let result = coalesce(segments);
  let changed = true;
  while (changed && result.length > 1) {
    changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const segment = result[index];
      if (segment.endMs - segment.startMs + 0.001 >= minHoldMs) continue;
      const previous = result[index - 1];
      const next = result[index + 1];
      if (!previous && next) next.startMs = segment.startMs;
      else if (previous && !next) previous.endMs = segment.endMs;
      else if (previous && next) {
        if (previous.state === next.state) {
          previous.endMs = next.endMs;
          result.splice(index, 2);
        } else if (previous.endMs - previous.startMs >= next.endMs - next.startMs) previous.endMs = segment.endMs;
        else next.startMs = segment.startMs;
      }
      if (result[index] === segment) result.splice(index, 1);
      result = coalesce(result);
      changed = true;
      break;
    }
  }
  if (!result.length) result = [{ startMs: 0, endMs: durationMs, state: "closed" }];
  result[0].startMs = 0;
  result[result.length - 1].endMs = durationMs;
  return result;
}

export function buildMouthTimeline(envelope: AudioEnvelope, profile: MouthProfile): MouthTimeline {
  const values = mergeBriefSilentGaps(envelope.frames.map((frame) => frame.smoothed), profile);
  const raw: MouthSegment[] = [];
  let state: MouthState = "closed";
  let segmentStart = 0;
  values.forEach((value, index) => {
    const timeMs = index * profile.windowMs;
    const next = targetState(value, state, profile);
    if (next !== state && timeMs - segmentStart >= profile.minHoldMs) {
      raw.push({ startMs: segmentStart, endMs: timeMs, state });
      state = next;
      segmentStart = timeMs;
    }
  });
  raw.push({ startMs: segmentStart, endMs: envelope.durationMs, state });
  let segments = enforceMinimumHold(raw, profile.minHoldMs, envelope.durationMs);
  const last = segments[segments.length - 1];
  if (last.state !== "closed") {
    const closedStart = Math.max(last.startMs + profile.minHoldMs, envelope.durationMs - profile.minHoldMs);
    if (closedStart < envelope.durationMs) {
      last.endMs = closedStart;
      segments.push({ startMs: closedStart, endMs: envelope.durationMs, state: "closed" });
    } else last.state = "closed";
  }
  segments = enforceMinimumHold(segments, profile.minHoldMs, envelope.durationMs);
  if (segments[segments.length - 1].state !== "closed") segments[segments.length - 1].state = "closed";
  return { schema: "galgame-mouth-timeline/v1", durationMs: envelope.durationMs, windowMs: profile.windowMs, segments };
}

export function mouthStateAt(timeline: MouthTimeline, timeMs: number): MouthState {
  const clamped = Math.max(0, Math.min(timeline.durationMs, timeMs));
  return timeline.segments.find((segment) => clamped >= segment.startMs && clamped < segment.endMs)?.state
    || timeline.segments[timeline.segments.length - 1]?.state
    || "closed";
}
