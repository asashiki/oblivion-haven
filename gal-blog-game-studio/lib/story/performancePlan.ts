export type FigureCue = {
  id: string;
  actorId: string;
  trigger:
    | { kind: "before-line" }
    | { kind: "line-start" }
    | { kind: "voice-ms"; ms: number }
    | { kind: "after-line" };
  action: "focus" | "expression-swap" | "nudge" | "lean" | "settle" | "enter" | "exit";
  intensity: 0 | 1 | 2 | 3;
  durationMs?: number;
  expressionId?: string;
  reason: string;
  pauseSafe: boolean;
  autoModeSafe: boolean;
};

export type PerformancePlan = {
  schema: "galgame-performance-plan/v1";
  lineId: string;
  cues: FigureCue[];
};

export const FACE_MOTION_PERFORMANCE_FIXTURE: PerformancePlan = {
  schema: "galgame-performance-plan/v1",
  lineId: "mai-mvp-line",
  cues: [
    { id: "enter", actorId: "maid-princess", trigger: { kind: "before-line" }, action: "enter", intensity: 1, durationMs: 420, reason: "角色先入场并停稳，再开始对白。", pauseSafe: true, autoModeSafe: true },
    { id: "focus", actorId: "maid-princess", trigger: { kind: "line-start" }, action: "focus", intensity: 1, durationMs: 260, reason: "对白开始时把视觉焦点交给说话角色。", pauseSafe: true, autoModeSafe: true },
    { id: "swap", actorId: "maid-princess", trigger: { kind: "voice-ms", ms: 6200 }, action: "expression-swap", expressionId: "guide", intensity: 1, durationMs: 180, reason: "句中语义转折时切换到说明手势。", pauseSafe: true, autoModeSafe: true },
    { id: "lean", actorId: "maid-princess", trigger: { kind: "voice-ms", ms: 7600 }, action: "lean", intensity: 1, durationMs: 360, reason: "用轻微前倾强化语气，不改变脚点。", pauseSafe: true, autoModeSafe: true },
    { id: "settle", actorId: "maid-princess", trigger: { kind: "after-line" }, action: "settle", intensity: 0, durationMs: 300, reason: "台词结束后闭嘴并回到稳定状态。", pauseSafe: true, autoModeSafe: true },
  ],
};
