import type {
  ChoiceOption,
  InputBlock,
  PerformanceCue,
  StagePosition,
  StageTransform,
  StoryBlock,
  StoryMode,
  StoryProject,
  VariableOperation,
} from "./types";
import { deepClone, slugify } from "./utils";
import { targetStagePosition, validateStagingPlan } from "./staging";

export type RuntimeFigure = {
  characterId: string;
  expressionId?: string;
  position: StagePosition;
  transform?: StageTransform;
  visible: boolean;
};

export type RuntimeState = {
  sceneId: string;
  blockIndex: number;
  mode: StoryMode;
  dimBackground: number;
  backgroundAssetId?: string;
  bgmAssetId?: string;
  figures: RuntimeFigure[];
  variables: Record<string, boolean | number | string>;
  currentBlock?: StoryBlock;
  /** Temporary semantic motions currently visible in the Studio preview. */
  activeCues: PerformanceCue[];
  /** after-line cues are applied on the same click that advances to the next stable state. */
  pendingAfterCues: PerformanceCue[];
  waitingFor?: "advance" | "choice" | "input" | "blog" | "ai" | "end";
  log: Array<{ sceneId: string; blockId: string; label: string; text?: string }>;
};

function initialVariables(project: StoryProject): RuntimeState["variables"] {
  return Object.fromEntries([
    ...project.variables.map((variable) => [variable.name, variable.defaultValue] as const),
    ...(project.records || []).map((record) => [`record_${slugify(record.name)}`, false] as const),
  ]);
}

function recordVariableName(project: StoryProject, recordId: string): string {
  const record = (project.records || []).find((item) => item.id === recordId);
  return `record_${slugify(record?.name || recordId)}`;
}

function routeEdgeEnabled(project: StoryProject, edge: StoryProject["routeMap"]["edges"][number], variables: RuntimeState["variables"]): boolean {
  if (!evaluate(edge.condition, variables)) return false;
  const condition = edge.recordCondition;
  if (!condition?.recordIds.length) return true;
  const count = condition.recordIds.filter((recordId) => Boolean(variables[recordVariableName(project, recordId)])).length;
  return condition.mode === "all" ? count === condition.recordIds.length : count >= Math.max(1, condition.minimum || 1);
}

function variableName(project: StoryProject, variableId: string): string {
  return project.variables.find((variable) => variable.id === variableId)?.name || variableId;
}

function applyVariableOperation(project: StoryProject, state: RuntimeState, operation: VariableOperation): void {
  const name = variableName(project, operation.variableId);
  const current = state.variables[name];
  if (operation.operation === "toggle") {
    state.variables[name] = !Boolean(current);
  } else if (operation.operation === "add") {
    state.variables[name] = Number(current || 0) + Number(operation.value || 0);
  } else if (operation.operation === "subtract") {
    state.variables[name] = Number(current || 0) - Number(operation.value || 0);
  } else {
    state.variables[name] = operation.value ?? operation.expression ?? "";
  }
}

function enterScene(project: StoryProject, state: RuntimeState, sceneId: string, blockIndex = 0): void {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    state.waitingFor = "end";
    return;
  }
  state.sceneId = scene.id;
  state.blockIndex = blockIndex;
  state.mode = scene.mode;
  state.currentBlock = undefined;
  state.waitingFor = undefined;
  state.activeCues = [];
  state.pendingAfterCues = [];
  if (scene.entryStage) {
    state.backgroundAssetId = scene.entryStage.backgroundAssetId;
    state.bgmAssetId = scene.entryStage.bgmAssetId;
    state.figures = (scene.entryStage.figures || []).map((figure) => ({ ...figure, visible: true }));
  }
}

function enterBlock(project: StoryProject, state: RuntimeState, blockId: string): boolean {
  const scene = project.scenes.find((item) => item.id === state.sceneId);
  const blockIndex = scene?.blocks.findIndex((block) => block.id === blockId) ?? -1;
  if (blockIndex < 0) return false;
  state.blockIndex = blockIndex;
  state.currentBlock = undefined;
  state.waitingFor = undefined;
  return true;
}

export function createRuntime(project: StoryProject, sceneId = project.settings.startSceneId, blockIndex = 0): RuntimeState {
  const scene = project.scenes.find((item) => item.id === sceneId);
  const state: RuntimeState = {
    sceneId,
    blockIndex,
    mode: scene?.mode || project.settings.defaultMode,
    dimBackground: 0,
    backgroundAssetId: scene?.entryStage?.backgroundAssetId,
    bgmAssetId: scene?.entryStage?.bgmAssetId,
    figures: (scene?.entryStage?.figures || []).map((figure) => ({ ...figure, visible: true })),
    variables: initialVariables(project),
    activeCues: [],
    pendingAfterCues: [],
    log: [],
  };
  return state;
}

export function cloneRuntime(state: RuntimeState): RuntimeState {
  return deepClone(state);
}

export function interpolate(text: string, variables: RuntimeState["variables"]): string {
  return text.replace(/\{([^}]+)\}/g, (_, name: string) => String(variables[name] ?? `{${name}}`));
}

function evaluate(expression: string | undefined, variables: RuntimeState["variables"]): boolean {
  if (!expression) return true;
  const match = expression.match(/^\s*([\w\u4e00-\u9fff]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
  if (!match) return Boolean(variables[expression.trim()]);
  const left = variables[match[1]];
  const rawRight = match[3].replace(/^["']|["']$/g, "");
  const right: boolean | number | string = rawRight === "true" ? true : rawRight === "false" ? false : Number.isNaN(Number(rawRight)) ? rawRight : Number(rawRight);
  switch (match[2]) {
    case "==": return left == right; // Story expressions intentionally use value equality.
    case "!=": return left != right;
    case ">=": return Number(left) >= Number(right);
    case "<=": return Number(left) <= Number(right);
    case ">": return Number(left) > Number(right);
    case "<": return Number(left) < Number(right);
    default: return false;
  }
}

export function visibleChoices(block: Extract<StoryBlock, { type: "choice" }>, state: RuntimeState): ChoiceOption[] {
  return block.options.filter((option) => !option.hidden && evaluate(option.condition, state.variables));
}

export function choiceEnabled(option: ChoiceOption, state: RuntimeState): boolean {
  return evaluate(option.enabledCondition, state.variables);
}

function applyPerformanceCue(project: StoryProject, scene: NonNullable<StoryProject["scenes"][number]>, state: RuntimeState, cue: PerformanceCue): void {
  state.activeCues.push(cue);
  if (!cue.targetCharacterId) return;
  const existing = state.figures.find((figure) => figure.characterId === cue.targetCharacterId);
  if (["expression-change", "pose-change", "listener-react"].includes(cue.intent) && cue.expressionId && existing) {
    existing.expressionId = cue.expressionId;
  }
  if (cue.intent === "enter") {
    if (existing) {
      existing.visible = true;
      existing.expressionId = cue.expressionId || existing.expressionId;
    } else {
      state.figures.push({
        characterId: cue.targetCharacterId,
        expressionId: cue.expressionId || project.characters.find((item) => item.id === cue.targetCharacterId)?.defaultExpressionId,
        position: targetStagePosition(scene, cue),
        visible: true,
      });
    }
  }
  if (cue.intent === "exit" && existing) existing.visible = false;
}

export function stepRuntime(project: StoryProject, inputState: RuntimeState): RuntimeState {
  const state = cloneRuntime(inputState);
  const scene = project.scenes.find((item) => item.id === state.sceneId);
  if (!scene) {
    state.waitingFor = "end";
    return state;
  }
  const userAdvance = inputState.waitingFor === "advance";
  if (userAdvance) {
    state.waitingFor = undefined;
    state.activeCues = [];
    const pending = [...state.pendingAfterCues];
    state.pendingAfterCues = [];
    pending.forEach((cue) => applyPerformanceCue(project, scene, state, cue));
  }
  if (state.blockIndex >= scene.blocks.length) {
    const sourceIds = new Set(project.routeMap.nodes.filter((node) => node.sceneId === scene.id).map((node) => node.id));
    const edge = project.routeMap.edges
      .filter((item) => sourceIds.has(item.source))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .find((item) => routeEdgeEnabled(project, item, state.variables));
    const targetSceneId = edge ? project.routeMap.nodes.find((node) => node.id === edge.target)?.sceneId : undefined;
    if (targetSceneId) {
      enterScene(project, state, targetSceneId);
      return stepRuntime(project, state);
    }
    state.waitingFor = "end";
    state.currentBlock = undefined;
    return state;
  }

  const block = scene.blocks[state.blockIndex];
  const staging = scene.staging?.enabled === false ? [] : validateStagingPlan(project, scene).plan.cues;
  const blockCues = staging.filter((cue) => !cue.disabled && cue.blockId === block.id);
  blockCues.filter((cue) => cue.timing !== "after-line").forEach((cue) => applyPerformanceCue(project, scene, state, cue));
  state.pendingAfterCues = blockCues.filter((cue) => cue.timing === "after-line");
  state.currentBlock = block;
  state.blockIndex += 1;
  if (block.disabled) return stepRuntime(project, state);

  if (block.type === "stage") {
    if (block.action === "set-background") state.backgroundAssetId = block.assetId;
    if (block.action === "play-bgm") state.bgmAssetId = block.assetId;
    if (block.action === "stop-bgm") state.bgmAssetId = undefined;
    if (block.action === "clear-stage") state.figures = [];
    if (["enter-character", "set-expression", "move-character", "exit-character"].includes(block.action) && block.characterId) {
      const existing = state.figures.find((figure) => figure.characterId === block.characterId);
      if (block.action === "exit-character") {
        if (existing) existing.visible = false;
      } else if (existing) {
        existing.visible = true;
        existing.expressionId = block.expressionId || existing.expressionId;
        existing.position = block.position || existing.position;
        existing.transform = block.transform || existing.transform;
      } else {
        state.figures.push({ characterId: block.characterId, expressionId: block.expressionId, position: block.position || "center", transform: block.transform, visible: true });
      }
    }
    return stepRuntime(project, state);
  }
  if (block.type === "variable") {
    block.operations.forEach((operation) => applyVariableOperation(project, state, operation));
    return stepRuntime(project, state);
  }
  if (block.type === "mode") {
    state.mode = block.mode;
    state.dimBackground = block.mode === "nvl" ? block.dimBackground ?? 0.38 : 0;
    return stepRuntime(project, state);
  }
  if (block.type === "jump") {
    if (evaluate(block.condition, state.variables)) {
      if (block.targetBlockId) {
        enterBlock(project, state, block.targetBlockId);
      } else {
        const routeScene = project.routeMap.nodes.find((node) => node.id === block.targetRouteNodeId)?.sceneId;
        enterScene(project, state, block.targetSceneId || routeScene || state.sceneId);
      }
    }
    return stepRuntime(project, state);
  }
  if (block.type === "condition") {
    const branch = block.branches.find((item) => evaluate(item.condition, state.variables));
    if (branch) enterScene(project, state, branch.targetSceneId);
    return stepRuntime(project, state);
  }
  if (block.type === "dialogue") {
    const reaction = (block.choiceReactions || []).find((item) => state.variables[`__choice_${slugify(item.choiceBlockId)}`] === item.optionId);
    const characterId = reaction?.characterId || block.characterId;
    const character = project.characters.find((item) => item.id === characterId);
    const existing = state.figures.find((figure) => figure.characterId === characterId);
    if (existing) {
      existing.expressionId = reaction?.expressionId || block.expressionId || existing.expressionId;
      existing.position = reaction?.position || block.position || existing.position;
      existing.transform = reaction?.transform || block.transform || existing.transform;
    } else if (reaction?.expressionId || reaction?.position || reaction?.transform || block.expressionId || block.position || block.transform) {
      state.figures.push({
        characterId,
        expressionId: reaction?.expressionId || block.expressionId || character?.defaultExpressionId,
        position: reaction?.position || block.position || "center",
        transform: reaction?.transform || block.transform,
        visible: true,
      });
    }
    state.log.push({ sceneId: scene.id, blockId: block.id, label: character?.displayName || character?.name || "角色", text: interpolate(reaction?.text || block.text, state.variables) });
    new Set((block.choiceReactions || []).map((item) => item.choiceBlockId)).forEach((choiceBlockId) => {
      state.variables[`__choice_${slugify(choiceBlockId)}`] = "";
    });
    state.waitingFor = "advance";
    return state;
  }
  if (block.type === "narration") {
    state.log.push({ sceneId: scene.id, blockId: block.id, label: block.mode === "nvl" || state.mode === "nvl" ? "NVL" : "旁白", text: interpolate(block.text, state.variables) });
    state.waitingFor = "advance";
    return state;
  }
  if (block.type === "choice") {
    state.waitingFor = "choice";
    return state;
  }
  if (block.type === "input") {
    state.waitingFor = "input";
    return state;
  }
  if (block.type === "blog-action") {
    state.waitingFor = "blog";
    return state;
  }
  if (block.type === "ai-turn") {
    state.waitingFor = "ai";
    return state;
  }
  if (block.type === "native") {
    state.log.push({ sceneId: scene.id, blockId: block.id, label: "WebGAL", text: "原生指令将在 WebGAL 预览中执行。" });
    state.waitingFor = "advance";
    return state;
  }
  return stepRuntime(project, state);
}

export function chooseRuntime(project: StoryProject, inputState: RuntimeState, optionId: string): RuntimeState {
  const state = cloneRuntime(inputState);
  const block = state.currentBlock;
  if (block?.type !== "choice") return state;
  const option = block.options.find((item) => item.id === optionId);
  if (!option || !evaluate(option.enabledCondition, state.variables)) return state;
  state.variables[`__choice_${slugify(block.id)}`] = option.id;
  if (option.recordId) state.variables[recordVariableName(project, option.recordId)] = true;
  (option.operations || []).forEach((operation) => applyVariableOperation(project, state, operation));
  const routeScene = project.routeMap.nodes.find((node) => node.id === option.targetRouteNodeId)?.sceneId;
  const choiceTarget = option.targetChoiceGroupId
    ? project.scenes.flatMap((scene) => scene.blocks.map((candidate) => ({ scene, candidate })))
      .find((item) => item.candidate.type === "choice" && item.candidate.id === option.targetChoiceGroupId)
    : undefined;
  if (choiceTarget) {
    if (choiceTarget.scene.id !== state.sceneId) enterScene(project, state, choiceTarget.scene.id);
    enterBlock(project, state, choiceTarget.candidate.id);
  }
  else if (option.endScene) {
    const currentScene = project.scenes.find((scene) => scene.id === state.sceneId);
    state.blockIndex = currentScene?.blocks.length || 0;
    state.currentBlock = undefined;
    state.waitingFor = undefined;
  }
  else if (option.targetBlockId) enterBlock(project, state, option.targetBlockId);
  else if (option.targetSceneId || routeScene) enterScene(project, state, option.targetSceneId || routeScene!);
  return stepRuntime(project, state);
}

export function submitInputRuntime(project: StoryProject, inputState: RuntimeState, value: string): RuntimeState {
  const state = cloneRuntime(inputState);
  const block = state.currentBlock as InputBlock | undefined;
  if (block?.type !== "input") return state;
  state.variables[variableName(project, block.variableId)] = value || block.defaultValue || "";
  state.log.push({ sceneId: state.sceneId, blockId: block.id, label: "PLAYER INPUT", text: value || block.defaultValue || "" });
  return stepRuntime(project, state);
}

export function resolveBlogRuntime(project: StoryProject, inputState: RuntimeState, result: "success" | "failure" | "cancel"): RuntimeState {
  const state = cloneRuntime(inputState);
  const block = state.currentBlock;
  if (block?.type !== "blog-action") return state;
  if (block.resultVariableId) state.variables[variableName(project, block.resultVariableId)] = result;
  const target = block.resultBranches?.[`${result}SceneId` as keyof NonNullable<typeof block.resultBranches>];
  if (target) enterScene(project, state, target);
  return stepRuntime(project, state);
}

export function resolveAiRuntime(project: StoryProject, inputState: RuntimeState): RuntimeState {
  const state = cloneRuntime(inputState);
  const block = state.currentBlock;
  if (block?.type !== "ai-turn") return state;
  if (block.fallbackSceneId) enterScene(project, state, block.fallbackSceneId);
  return stepRuntime(project, state);
}
