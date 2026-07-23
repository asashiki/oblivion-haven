import type { StageBlock } from "./types";

export type WebgalAnimationPreset = {
  name: string;
  label: string;
  description: string;
  durationMs: number;
  category: "transition" | "motion" | "filter";
};

/**
 * Presets shipped by the official WebGAL Terre project template.
 *
 * Source:
 * packages/terre2/assets/templates/WebGAL_Template/game/animation
 * https://github.com/OpenWebGAL/WebGAL_Terre
 *
 * The upstream files are MPL-2.0 licensed. See THIRD_PARTY_NOTICES.md.
 */
const animationFrames: Record<string, Array<Record<string, unknown>>> = {
  "enter-from-left": [
    { alpha: 0, scale: { x: 1, y: 1 }, position: { x: -50, y: 0 }, rotation: 0, blur: 5, duration: 0 },
    { alpha: 1, scale: { x: 1, y: 1 }, position: { x: 0, y: 0 }, rotation: 0, blur: 0, duration: 500 },
  ],
  "enter-from-bottom": [
    { alpha: 0, position: { x: 0, y: 50 }, blur: 5, duration: 0 },
    { alpha: 1, position: { x: 0, y: 0 }, blur: 0, duration: 500 },
  ],
  "enter-from-right": [
    { alpha: 0, position: { x: 50, y: 0 }, blur: 5, duration: 0 },
    { alpha: 1, position: { x: 0, y: 0 }, blur: 0, duration: 500 },
  ],
  shake: [
    { position: { x: 0, y: 0 }, duration: 0 },
    { position: { x: -100, y: 0 }, duration: 250 },
    { position: { x: 100, y: 0 }, duration: 500 },
    { position: { x: 0, y: 0 }, duration: 250 },
  ],
  "move-front-and-back": [
    { scale: { x: 1, y: 1 }, duration: 0 },
    { scale: { x: 1.15, y: 1.15 }, duration: 500 },
    { scale: { x: 1, y: 1 }, duration: 500 },
  ],
  enter: [
    { alpha: 0, duration: 0 },
    { alpha: 1, duration: 300 },
  ],
  exit: [
    { alpha: 1, duration: 0 },
    { alpha: 0, duration: 300 },
  ],
  blur: [
    { blur: 0, duration: 0 },
    { blur: 5, duration: 300 },
  ],
  oldFilm: [{ oldFilm: 1, duration: 0 }],
  dotFilm: [{ dotFilm: 1, duration: 0 }],
  reflectionFilm: [{ reflectionFilm: 1, duration: 0 }],
  glitchFilm: [{ glitchFilm: 1, duration: 0 }],
  rgbFilm: [{ rgbFilm: 1, duration: 0 }],
  godrayFilm: [{ godrayFilm: 1, duration: 0 }],
  removeFilm: [{
    oldFilm: 0,
    dotFilm: 0,
    reflectionFilm: 0,
    glitchFilm: 0,
    rgbFilm: 0,
    godrayFilm: 0,
    duration: 0,
  }],
  shockwaveIn: [
    { shockwaveFilter: 0, alpha: 0, duration: 0 },
    { shockwaveFilter: 3, alpha: 1, duration: 2000 },
  ],
  shockwaveOut: [
    { shockwaveFilter: 0, alpha: 1, duration: 0 },
    { shockwaveFilter: 3, alpha: 0, duration: 2000 },
  ],
};

export const WEBGAL_ANIMATION_PRESETS: WebgalAnimationPreset[] = [
  { name: "enter", label: "柔和淡入", description: "WebGAL 默认透明度淡入", durationMs: 300, category: "transition" },
  { name: "exit", label: "柔和淡出", description: "WebGAL 默认透明度淡出", durationMs: 300, category: "transition" },
  { name: "enter-from-left", label: "从左侧淡入", description: "带轻微模糊的左侧入场", durationMs: 500, category: "transition" },
  { name: "enter-from-right", label: "从右侧淡入", description: "带轻微模糊的右侧入场", durationMs: 500, category: "transition" },
  { name: "enter-from-bottom", label: "从下方淡入", description: "适合人物和重要物件入场", durationMs: 500, category: "transition" },
  { name: "shake", label: "舞台震动", description: "一次横向震动", durationMs: 1000, category: "motion" },
  { name: "move-front-and-back", label: "推近再复位", description: "短暂放大后回到原位", durationMs: 1000, category: "motion" },
  { name: "blur", label: "逐渐模糊", description: "从清晰过渡到轻度模糊", durationMs: 300, category: "motion" },
  { name: "shockwaveIn", label: "冲击波显现", description: "两秒冲击波入场", durationMs: 2000, category: "motion" },
  { name: "shockwaveOut", label: "冲击波消失", description: "两秒冲击波退场", durationMs: 2000, category: "motion" },
  { name: "oldFilm", label: "旧胶片滤镜", description: "开启旧胶片效果", durationMs: 0, category: "filter" },
  { name: "dotFilm", label: "网点滤镜", description: "开启网点电影效果", durationMs: 0, category: "filter" },
  { name: "reflectionFilm", label: "反射滤镜", description: "开启反射电影效果", durationMs: 0, category: "filter" },
  { name: "glitchFilm", label: "故障滤镜", description: "开启 Glitch 效果", durationMs: 0, category: "filter" },
  { name: "rgbFilm", label: "RGB 分离", description: "开启 RGB 分离效果", durationMs: 0, category: "filter" },
  { name: "godrayFilm", label: "光束滤镜", description: "开启 Godray 光束效果", durationMs: 0, category: "filter" },
  { name: "removeFilm", label: "清除滤镜", description: "关闭全部电影滤镜", durationMs: 0, category: "filter" },
];

export const WEBGAL_ANIMATION_FILES = [
  {
    path: "game/animation/animationTable.json",
    content: `${JSON.stringify(Object.keys(animationFrames), null, 2)}\n`,
  },
  ...Object.entries(animationFrames).map(([name, frames]) => ({
    path: `game/animation/${name}.json`,
    content: `${JSON.stringify(frames, null, 2)}\n`,
  })),
];

export function presetsForStageAction(action: StageBlock["action"]): WebgalAnimationPreset[] {
  if (["set-background", "enter-character", "set-expression"].includes(action)) {
    return WEBGAL_ANIMATION_PRESETS.filter((preset) =>
      ["enter", "enter-from-left", "enter-from-right", "enter-from-bottom"].includes(preset.name),
    );
  }
  if (["exit-character", "clear-stage"].includes(action)) {
    return WEBGAL_ANIMATION_PRESETS.filter((preset) => preset.name === "exit");
  }
  if (action === "transition") {
    return WEBGAL_ANIMATION_PRESETS.filter((preset) =>
      preset.category !== "transition" || ["enter", "exit"].includes(preset.name),
    );
  }
  return [];
}

export function normalizeTransitionName(name: string | undefined, phase: "enter" | "exit" | "animation"): string | undefined {
  const value = name?.trim();
  if (!value) return undefined;
  if (["fade", "fade-in", "fadein", "淡入", "渐入", "渐变"].includes(value)) {
    return phase === "exit" ? "exit" : "enter";
  }
  if (["fade-out", "fadeout", "淡出", "渐出"].includes(value)) return "exit";
  return value;
}

export function toWebgalVolume(volume: number | undefined): number | undefined {
  if (volume === undefined || Number.isNaN(volume)) return undefined;
  const normalized = volume <= 1 ? volume * 100 : volume;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}
