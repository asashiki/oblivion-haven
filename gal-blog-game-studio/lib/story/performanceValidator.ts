import type { FigureCue, PerformancePlan } from "./performancePlan";

export type PerformanceIssue = { cueId?: string; code: string; message: string };

export function validatePerformancePlan(plan: PerformancePlan): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  if (plan.schema !== "galgame-performance-plan/v1") issues.push({ code: "SCHEMA", message: "演出计划 schema 不受支持。" });
  const ids = new Set<string>();
  let lastVoiceMs = -1;
  for (const cue of plan.cues) {
    if (ids.has(cue.id)) issues.push({ cueId: cue.id, code: "DUPLICATE_ID", message: "Cue id 必须唯一。" });
    ids.add(cue.id);
    if (!cue.actorId.trim()) issues.push({ cueId: cue.id, code: "ACTOR", message: "Cue 缺少 actorId。" });
    if (!cue.reason.trim()) issues.push({ cueId: cue.id, code: "REASON", message: "Cue 必须说明 reason。" });
    if (typeof cue.pauseSafe !== "boolean") issues.push({ cueId: cue.id, code: "PAUSE_SAFE", message: "Cue 必须声明 pauseSafe。" });
    if (typeof cue.autoModeSafe !== "boolean") issues.push({ cueId: cue.id, code: "AUTO_SAFE", message: "Cue 必须声明 autoModeSafe。" });
    if (![0, 1, 2, 3].includes(cue.intensity)) issues.push({ cueId: cue.id, code: "INTENSITY", message: "intensity 只能是 0–3。" });
    if (cue.durationMs !== undefined && cue.durationMs <= 0) issues.push({ cueId: cue.id, code: "DURATION", message: "durationMs 必须大于 0。" });
    if (cue.action === "expression-swap" && !cue.expressionId) issues.push({ cueId: cue.id, code: "EXPRESSION", message: "expression-swap 必须指定 expressionId。" });
    if (cue.trigger.kind === "voice-ms") {
      if (cue.trigger.ms < 0) issues.push({ cueId: cue.id, code: "VOICE_MS", message: "voice-ms 不能为负数。" });
      if (cue.trigger.ms < lastVoiceMs) issues.push({ cueId: cue.id, code: "ORDER", message: "voice-ms cue 必须按时间排序。" });
      lastVoiceMs = cue.trigger.ms;
    }
  }
  return issues;
}

export function cuesAtTime(cues: FigureCue[], previousMs: number, currentMs: number): FigureCue[] {
  return cues.filter((cue) => cue.trigger.kind === "voice-ms" && cue.trigger.ms > previousMs && cue.trigger.ms <= currentMs);
}
