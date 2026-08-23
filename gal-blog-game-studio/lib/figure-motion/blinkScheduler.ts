import type { BlinkProfile, EyeState } from "./schema";

export type TimeWindow = { startMs: number; endMs: number };

export type BlinkEvent = {
  startMs: number;
  endMs: number;
  double: boolean;
  phases: Array<{ startMs: number; endMs: number; state: EyeState }>;
};

function randomFactory(seed: number): () => number {
  let value = seed >>> 0 || 0x6d2b79f5;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function nextInterval(random: () => number, profile: BlinkProfile): number {
  const scale = Math.max(1, (profile.medianIntervalMs - profile.minIntervalMs) / Math.log(2));
  const exponential = -Math.log(Math.max(1e-7, 1 - random())) * scale;
  return Math.min(profile.maxIntervalMs, Math.max(profile.minIntervalMs, profile.minIntervalMs + exponential));
}

function overlapsSuppression(timeMs: number, windows: TimeWindow[], margin: number): TimeWindow | undefined {
  return windows.find((window) => timeMs >= window.startMs - margin && timeMs <= window.endMs + margin);
}

function phasesFor(startMs: number, profile: BlinkProfile, hasHalf: boolean): Array<{ startMs: number; endMs: number; state: EyeState }> {
  const phases: Array<{ startMs: number; endMs: number; state: EyeState }> = [];
  let cursor = startMs;
  if (hasHalf) {
    phases.push({ startMs: cursor, endMs: cursor + profile.halfMs, state: "half" });
    cursor += profile.halfMs;
  }
  phases.push({ startMs: cursor, endMs: cursor + profile.closedMs, state: "closed" });
  cursor += profile.closedMs;
  if (hasHalf) phases.push({ startMs: cursor, endMs: cursor + profile.halfMs, state: "half" });
  return phases;
}

export function scheduleBlinkEvents(
  durationMs: number,
  profile: BlinkProfile,
  options: { hasHalf?: boolean; fixedClosed?: boolean; suppressWindows?: TimeWindow[] } = {},
): BlinkEvent[] {
  if (options.fixedClosed || durationMs <= 0) return [];
  const random = randomFactory(profile.seed);
  const windows = options.suppressWindows || [];
  const hasHalf = options.hasHalf !== false;
  const events: BlinkEvent[] = [];
  let cursor = nextInterval(random, profile);
  while (cursor < durationMs) {
    const blocked = overlapsSuppression(cursor, windows, profile.suppressAroundSwapMs);
    if (blocked) {
      cursor = blocked.endMs + profile.suppressAroundSwapMs + 1;
      continue;
    }
    const isDouble = random() < profile.doubleBlinkChance;
    let phases = phasesFor(cursor, profile, hasHalf);
    if (isDouble) {
      const secondStart = phases[phases.length - 1].endMs + 95;
      phases = [...phases, ...phasesFor(secondStart, profile, hasHalf)];
    }
    const endMs = phases[phases.length - 1].endMs;
    if (endMs <= durationMs) events.push({ startMs: cursor, endMs, double: isDouble, phases });
    cursor = endMs + nextInterval(random, profile);
  }
  return events;
}

export function eyeStateAt(events: BlinkEvent[], timeMs: number, fixedClosed = false): EyeState {
  if (fixedClosed) return "closed";
  for (const event of events) {
    if (timeMs < event.startMs || timeMs >= event.endMs) continue;
    return event.phases.find((phase) => timeMs >= phase.startMs && timeMs < phase.endMs)?.state || "open";
  }
  return "open";
}

export function normalizedPausedEyeState(): EyeState {
  return "open";
}
