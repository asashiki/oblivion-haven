import type {
  PerformanceCue,
  StagePosition,
  StagingIntent,
  StoryDiagnostic,
  StoryProject,
  StoryScene,
} from "./types";

const VISIBLE_INTENTS = new Set<StagingIntent>([
  "enter",
  "exit",
  "expression-change",
  "pose-change",
  "listener-react",
  "micro-emphasis",
  "micro-recoil",
  "reframe",
]);

const BODY_OR_CAMERA_INTENTS = new Set<StagingIntent>(["micro-emphasis", "micro-recoil", "reframe"]);
const TEMPORARY_INTENTS = new Set<StagingIntent>(["listener-react", "micro-emphasis", "micro-recoil"]);
const STRONG_REASONS = new Set(["explicit-physical-action", "reveal", "shock", "scene-entry", "scene-exit"]);

export type StagingValidationResult = {
  plan: NonNullable<StoryScene["staging"]>;
  diagnostics: StoryDiagnostic[];
  rejectedCueIds: string[];
};

function cueDiagnostic(
  scene: StoryScene,
  cue: PerformanceCue,
  code: string,
  message: string,
  severity: StoryDiagnostic["severity"] = "warning",
): StoryDiagnostic {
  return {
    id: `staging-${scene.id}-${cue.id}-${code}`,
    severity,
    code,
    message,
    sceneId: scene.id,
    blockId: cue.blockId,
    path: `/scenes/${scene.id}/staging/cues/${cue.id}`,
  };
}

export function cuePresetName(cue: PerformanceCue, position: StagePosition = "center"): string | undefined {
  const rightSide = position === "right" || position === "far-right";
  switch (cue.intent) {
    case "expression-change":
    case "pose-change":
    case "listener-react":
      return "diff-crossfade";
    case "micro-emphasis":
      return "micro-emphasis";
    case "micro-recoil":
      return rightSide ? "micro-recoil-right" : "micro-recoil-left";
    case "enter":
      return rightSide ? "soft-enter-right" : "soft-enter-left";
    case "exit":
      return rightSide ? "soft-exit-right" : "soft-exit-left";
    default:
      return undefined;
  }
}

/**
 * Deterministic guardrail between AI-authored semantic cues and low-level engine commands.
 * Invalid cues are omitted instead of being "fixed" with invented timing or motion.
 */
export function validateStagingPlan(
  project: StoryProject,
  scene: StoryScene,
  input = scene.staging,
): StagingValidationResult {
  const source = input || { enabled: true, cues: [] };
  const diagnostics: StoryDiagnostic[] = [];
  const rejectedCueIds: string[] = [];
  const accepted: PerformanceCue[] = [];
  const blocks = new Map(scene.blocks.map((block, index) => [block.id, { block, index }] as const));
  const dialogueOrdinal = new Map<string, number>();
  let dialogueCount = 0;
  scene.blocks.forEach((block) => {
    if (block.type === "dialogue" || block.type === "narration") dialogueOrdinal.set(block.id, dialogueCount++);
  });
  const stage = new Set((scene.entryStage?.figures || []).map((figure) => figure.characterId));
  const positions = new Map((scene.entryStage?.figures || []).map((figure) => [figure.characterId, figure.position] as const));
  const visibleAtBlock = new Map<string, number>();
  const bodyActionOrdinals: number[] = [];
  const lastTemporary = new Map<string, number>();
  const duplicateKeys = new Set<string>();

  const reject = (cue: PerformanceCue, code: string, message: string) => {
    rejectedCueIds.push(cue.id);
    diagnostics.push(cueDiagnostic(scene, cue, code, message));
  };

  const cuesByBlock = new Map<string, PerformanceCue[]>();
  source.cues.forEach((cue) => cuesByBlock.set(cue.blockId, [...(cuesByBlock.get(cue.blockId) || []), cue]));

  scene.blocks.forEach((block) => {
    for (const cue of cuesByBlock.get(block.id) || []) {
      if (cue.disabled) {
        accepted.push(cue);
        continue;
      }
      const blockRecord = blocks.get(cue.blockId);
      if (!blockRecord) {
        reject(cue, "STAGING_BLOCK_MISSING", `演出 ${cue.id} 指向不存在的块。`);
        continue;
      }
      if (cue.intent !== "hold" && !cue.reason) {
        reject(cue, "STAGING_REASON_REQUIRED", `演出 ${cue.id} 缺少可解释的剧情原因。`);
        continue;
      }
      if (cue.intent !== "hold" && !cue.targetCharacterId && cue.intent !== "reframe") {
        reject(cue, "STAGING_TARGET_REQUIRED", `演出 ${cue.id} 缺少目标角色。`);
        continue;
      }
      const character = cue.targetCharacterId
        ? project.characters.find((item) => item.id === cue.targetCharacterId)
        : undefined;
      if (cue.targetCharacterId && !character) {
        reject(cue, "STAGING_CHARACTER_MISSING", `演出 ${cue.id} 的目标角色不存在。`);
        continue;
      }
      if (cue.expressionId && !character?.expressions.some((item) => item.id === cue.expressionId)) {
        reject(cue, "STAGING_EXPRESSION_MISSING", `演出 ${cue.id} 的差分不属于目标角色。`);
        continue;
      }
      if (cue.timing === "during-line") {
        const dialogueText = block.type === "dialogue" || block.type === "narration" ? block.text : "";
        const hasAnchor = Boolean(cue.anchorText && dialogueText.includes(cue.anchorText));
        const hasVoiceTime = typeof cue.voiceTimeMs === "number" && cue.voiceTimeMs >= 0;
        if (!hasAnchor && !hasVoiceTime) {
          reject(cue, "STAGING_ANCHOR_REQUIRED", `台词中演出 ${cue.id} 必须绑定原文锚点或已标注的语音时间。`);
          continue;
        }
      }
      if (cue.intensity === "high" && (!cue.reason || !STRONG_REASONS.has(cue.reason))) {
        reject(cue, "STAGING_STRONG_REASON", `强演出 ${cue.id} 没有强事件依据。`);
        continue;
      }
      const duplicateKey = [cue.blockId, cue.targetCharacterId, cue.intent, cue.timing, cue.expressionId].join(":");
      if (duplicateKeys.has(duplicateKey)) {
        reject(cue, "STAGING_DUPLICATE", `重复演出 ${cue.id} 已合并。`);
        continue;
      }
      duplicateKeys.add(duplicateKey);

      if (VISIBLE_INTENTS.has(cue.intent)) {
        const count = visibleAtBlock.get(cue.blockId) || 0;
        if (count >= 1) {
          reject(cue, "STAGING_ONE_VISIBLE_CUE", `块 ${cue.blockId} 已有一个可见演出，本条已移除。`);
          continue;
        }
      }

      const ordinal = dialogueOrdinal.get(cue.blockId) ?? -1;
      if (BODY_OR_CAMERA_INTENTS.has(cue.intent) && ordinal >= 0) {
        if (bodyActionOrdinals.some((previous) => ordinal - previous >= 0 && ordinal - previous < 4)) {
          reject(cue, "STAGING_DENSITY_LIMIT", `普通对话任意连续 4 句只允许一次身体或镜头动作。`);
          continue;
        }
      }
      if (TEMPORARY_INTENTS.has(cue.intent) && ordinal >= 0) {
        const key = `${cue.targetCharacterId || "stage"}:${cue.intent}`;
        const previous = lastTemporary.get(key);
        if (previous !== undefined && ordinal - previous < 6 && cue.reason !== "explicit-physical-action") {
          reject(cue, "STAGING_COOLDOWN", `同一临时动作需间隔至少 6 句对白。`);
          continue;
        }
      }

      if (cue.targetCharacterId) {
        const isOnStage = stage.has(cue.targetCharacterId);
        if (cue.intent === "enter" && isOnStage) {
          reject(cue, "STAGING_ALREADY_ON_STAGE", `${character?.displayName || character?.name} 已在舞台上，不能再次入场。`);
          continue;
        }
        if (cue.intent === "exit" && !isOnStage) {
          reject(cue, "STAGING_ALREADY_OFF_STAGE", `${character?.displayName || character?.name} 不在舞台上，不能离场。`);
          continue;
        }
        if (!["enter", "hold"].includes(cue.intent) && !isOnStage) {
          reject(cue, "STAGING_TARGET_OFF_STAGE", `${character?.displayName || character?.name} 不在舞台上，不能执行 ${cue.intent}。`);
          continue;
        }
      }

      accepted.push(cue);
      if (VISIBLE_INTENTS.has(cue.intent)) visibleAtBlock.set(cue.blockId, 1);
      if (BODY_OR_CAMERA_INTENTS.has(cue.intent) && ordinal >= 0) bodyActionOrdinals.push(ordinal);
      if (TEMPORARY_INTENTS.has(cue.intent) && ordinal >= 0) {
        lastTemporary.set(`${cue.targetCharacterId || "stage"}:${cue.intent}`, ordinal);
      }
      if (cue.intent === "enter" && cue.targetCharacterId) stage.add(cue.targetCharacterId);
      if (cue.intent === "exit" && cue.targetCharacterId) stage.delete(cue.targetCharacterId);
    }

    if (block.type === "stage" && block.characterId) {
      if (block.action === "enter-character") {
        stage.add(block.characterId);
        if (block.position) positions.set(block.characterId, block.position);
      }
      if (block.action === "exit-character") stage.delete(block.characterId);
      if ((block.action === "move-character" || block.action === "set-expression") && block.position) {
        positions.set(block.characterId, block.position);
      }
    }
    if (block.type === "dialogue" && block.position) positions.set(block.characterId, block.position);
  });

  for (const cue of source.cues) {
    if (!blocks.has(cue.blockId) && !rejectedCueIds.includes(cue.id)) {
      reject(cue, "STAGING_BLOCK_MISSING", `演出 ${cue.id} 指向不存在的块。`);
    }
  }

  return {
    plan: { enabled: source.enabled, revision: source.revision, cues: accepted },
    diagnostics,
    rejectedCueIds,
  };
}

export function validatedCuesForBlock(
  project: StoryProject,
  scene: StoryScene,
  blockId: string,
  timing?: PerformanceCue["timing"],
): PerformanceCue[] {
  if (scene.staging?.enabled === false) return [];
  return validateStagingPlan(project, scene).plan.cues.filter((cue) => (
    !cue.disabled && cue.blockId === blockId && (!timing || cue.timing === timing)
  ));
}

export function targetStagePosition(scene: StoryScene, cue: PerformanceCue): StagePosition {
  if (!cue.targetCharacterId) return "center";
  const entry = scene.entryStage?.figures?.find((figure) => figure.characterId === cue.targetCharacterId);
  const before = scene.blocks.slice(0, Math.max(0, scene.blocks.findIndex((block) => block.id === cue.blockId)) + 1)
    .filter((block) => block.type === "stage" && block.characterId === cue.targetCharacterId && block.position)
    .at(-1);
  return (before?.type === "stage" ? before.position : entry?.position) || "center";
}
