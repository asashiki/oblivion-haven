import type {
  CompileResult,
  ChoiceOption,
  InputBlock,
  PerformanceCue,
  StageBlock,
  StoryAsset,
  StoryBlock,
  StoryDiagnostic,
  StoryProject,
  StoryScene,
  StageTransform,
  VariableOperation,
} from "./types";
import { figureTransformForAsset, normalizeFigureTransform } from "./figureFraming";
import { escapeWebgal, sanitizeWebgalArg, slugify } from "./utils";
import { validateProject } from "./schema";
import {
  normalizeTransitionName,
  toWebgalVolume,
  WEBGAL_ANIMATION_FILES,
} from "./performancePresets";
import { cuePresetName, targetStagePosition, validateStagingPlan } from "./staging";
import { buildWebGalLayerManifest } from "../figure-motion/webgalLayerManifest";
import { WEBGAL_FACE_MOTION_ADAPTER_SOURCE } from "../figure-motion/webgalFaceMotionAdapter";

function arg(value: string | number | undefined, name: string): string {
  if (value === undefined || value === "") return "";
  return ` -${name}=${sanitizeWebgalArg(String(value))}`;
}

function sceneFileName(scene: StoryScene): string {
  return `scene_${slugify(scene.slug || scene.name)}.txt`;
}

function resolveAsset(project: StoryProject, assetId?: string): string | undefined {
  if (!assetId) return undefined;
  return project.assets.find((asset) => asset.id === assetId)?.path;
}

function resolveCharacter(project: StoryProject, characterId?: string) {
  return project.characters.find((character) => character.id === characterId);
}

function resolveExpressionAsset(project: StoryProject, characterId?: string, expressionId?: string): string | undefined {
  const character = resolveCharacter(project, characterId);
  if (!character) return undefined;
  const expression = character.expressions.find((item) => item.id === (expressionId || character.defaultExpressionId));
  return resolveAsset(project, expression?.assetId);
}

function resolveExpressionAssetRecord(project: StoryProject, characterId?: string, expressionId?: string) {
  const character = resolveCharacter(project, characterId);
  if (!character) return undefined;
  const expression = character.expressions.find((item) => item.id === (expressionId || character.defaultExpressionId));
  return project.assets.find((asset) => asset.id === expression?.assetId);
}

function resolveExpressionRecord(project: StoryProject, characterId?: string, expressionId?: string) {
  const character = resolveCharacter(project, characterId);
  if (!character) return undefined;
  return character.expressions.find((item) => item.id === (expressionId || character.defaultExpressionId));
}

function figureAnimationArgs(
  project: StoryProject,
  characterId?: string,
  expressionId?: string,
  override?: Extract<StoryBlock, { type: "dialogue" }>["figureAnimation"],
): string {
  const expression = resolveExpressionRecord(project, characterId, expressionId);
  const animation = expression?.webgalAnimation;
  if (!expression || !animation) return "";
  const path = (assetId?: string) => resolveAsset(project, assetId);
  const base = path(expression.assetId);
  const parts: string[] = [];
  const mouthSync = override?.mouthSync === "on"
    ? true
    : override?.mouthSync === "off" ? false : Boolean(animation.mouthSync);
  if (mouthSync) {
    const open = path(animation.mouthOpenAssetId);
    const half = path(animation.mouthHalfOpenAssetId);
    const close = path(animation.mouthCloseAssetId) || base;
    if (open) parts.push(arg(open, "mouthOpen"));
    if (half) parts.push(arg(half, "mouthHalfOpen"));
    if (close) parts.push(arg(close, "mouthClose"));
  } else if (override?.mouthSync === "off" && base) {
    parts.push(arg(base, "mouthOpen"), arg(base, "mouthHalfOpen"), arg(base, "mouthClose"));
  }
  const blink = override?.blink && override.blink !== "inherit" ? override.blink : animation.blink;
  if (blink === "dynamic") {
    const open = path(animation.eyesOpenAssetId) || base;
    const close = path(animation.eyesCloseAssetId);
    if (open) parts.push(arg(open, "eyesOpen"));
    if (close) parts.push(arg(close, "eyesClose"));
  } else if ((blink === "fixed-open" || blink === "none") && base) {
    const open = path(animation.eyesOpenAssetId) || base;
    parts.push(arg(open, "eyesOpen"), arg(open, "eyesClose"));
  } else if (blink === "fixed-closed") {
    const close = path(animation.eyesCloseAssetId) || base;
    if (close) parts.push(arg(close, "eyesOpen"), arg(close, "eyesClose"));
  }
  return parts.join("");
}

function positionArgs(position?: string): string {
  if (position === "left" || position === "far-left") return " -left";
  if (position === "right" || position === "far-right") return " -right";
  return "";
}

function transformPayload(transform: StageTransform | undefined, asset?: StoryAsset): Record<string, unknown> {
  const resolved = figureTransformForAsset(asset, transform);
  const payload: Record<string, unknown> = {};
  if (resolved.x !== undefined || resolved.y !== undefined) payload.position = { x: resolved.x ?? 0, y: resolved.y ?? 0 };
  if (resolved.scale !== undefined) payload.scale = { x: resolved.scale, y: resolved.scale };
  if (resolved.rotation !== undefined) payload.rotation = resolved.rotation;
  if (resolved.alpha !== undefined) payload.alpha = resolved.alpha;
  return payload;
}

function transformArg(transform: StageTransform | undefined, asset?: StoryAsset): string {
  const payload = transformPayload(transform, asset);
  return Object.keys(payload).length ? ` -transform=${JSON.stringify(payload)}` : "";
}

function compileFigureChange({
  expressionPath,
  figureId,
  position,
  transform,
  asset,
  transition,
  duration,
  easing,
  animationArgs = "",
  next = false,
}: {
  expressionPath: string;
  figureId?: string;
  position?: string;
  transform?: StageTransform;
  asset?: StoryAsset;
  transition?: string;
  duration?: number;
  easing?: string;
  animationArgs?: string;
  next?: boolean;
}): string[] {
  const finalTransform = normalizeFigureTransform(figureTransformForAsset(asset, transform));
  const finalPayload = transformPayload(finalTransform, asset);
  const base = `changeFigure:${expressionPath}${arg(figureId, "id")}${positionArgs(position)}${animationArgs}`;
  const supportedEntrance = transition === "enter"
    || transition === "enter-from-left"
    || transition === "enter-from-right"
    || transition === "enter-from-bottom"
    || transition === "soft-enter-left"
    || transition === "soft-enter-right";

  if (!transition || !figureId) {
    return [
      `${base}${arg(duration, "duration")}${arg(easing, "ease")}`
      + `${transformArg(finalTransform, asset)}${next ? " -next" : ""};`,
    ];
  }
  if (transition === "diff-crossfade") {
    return [
      `${base}${transformArg(finalTransform, asset)} -duration=0 -next;`,
      `setAnimation:diff-crossfade${arg(figureId, "target")}${next ? " -next" : ""};`,
    ];
  }
  const entrance = supportedEntrance ? transition : "enter";

  /*
   * WebGAL ignores changeFigure -transform when -enter is present. Build the
   * entrance as a temporary animation instead, so a visual editor's exact
   * position and scale survive the transition.
   */
  const x = finalTransform.x ?? 0;
  const y = finalTransform.y ?? 0;
  const soft = entrance.startsWith("soft-enter");
  const offset = soft ? 36 : 90;
  const startTransform = {
    ...finalPayload,
    position: {
      x: x + (["enter-from-left", "soft-enter-left"].includes(entrance) ? -offset : ["enter-from-right", "soft-enter-right"].includes(entrance) ? offset : 0),
      y: y + (entrance === "enter-from-bottom" ? offset : 0),
    },
    alpha: 0,
    ...(entrance === "enter" || soft ? {} : { blur: 5 }),
  };
  const endTransform = {
    ...finalPayload,
    position: { x, y },
    alpha: finalTransform.alpha ?? 1,
    blur: 0,
    duration: duration ?? (soft ? 360 : entrance === "enter" ? 300 : 500),
    ...(easing ? { ease: easing } : {}),
  };
  const initialPayload = { ...finalPayload, alpha: 0 };
  return [
    `${base} -transform=${JSON.stringify(initialPayload)} -duration=0 -next;`,
    `setTempAnimation:${JSON.stringify([
      { ...startTransform, duration: 0 },
      endTransform,
    ])}${arg(figureId, "target")}${next ? " -next" : ""};`,
  ];
}

function cueMarker(cue: PerformanceCue): string {
  return `; @performance-cue ${JSON.stringify({
    id: cue.id,
    intent: cue.intent,
    target: cue.targetCharacterId,
    timing: cue.timing,
    intensity: cue.intensity,
    reason: cue.reason,
    anchorText: cue.anchorText,
    voiceTimeMs: cue.voiceTimeMs,
  })}`;
}

function compileStagingCue(project: StoryProject, scene: StoryScene, cue: PerformanceCue): string[] {
  const marker = cueMarker(cue);
  if (cue.intent === "hold" || cue.intent === "reframe") return [marker];
  const character = resolveCharacter(project, cue.targetCharacterId);
  const figureId = character ? `char-${slugify(character.name)}` : cue.targetCharacterId;
  const position = targetStagePosition(scene, cue);
  const preset = cuePresetName(cue, position);
  if (!figureId || !preset) return [marker];
  if (["expression-change", "pose-change", "listener-react"].includes(cue.intent) && cue.expressionId) {
    const path = resolveExpressionAsset(project, cue.targetCharacterId, cue.expressionId);
    if (!path) return [marker];
    return [marker, ...compileFigureChange({
      expressionPath: path,
      figureId,
      position,
      transform: sceneFigureTransform(scene, cue.targetCharacterId),
      asset: resolveExpressionAssetRecord(project, cue.targetCharacterId, cue.expressionId),
      transition: "diff-crossfade",
      duration: 160,
      next: true,
      animationArgs: figureAnimationArgs(project, cue.targetCharacterId, cue.expressionId),
    })];
  }
  if (["micro-emphasis", "micro-recoil"].includes(cue.intent)) {
    return [marker, `setAnimation:${preset}${arg(figureId, "target")} -next;`];
  }
  return [marker];
}

function cueAppliedByBlock(block: StoryBlock, cue: PerformanceCue): boolean {
  if (block.type === "stage") {
    if (cue.intent === "enter" && block.action === "enter-character") return block.characterId === cue.targetCharacterId;
    if (cue.intent === "exit" && block.action === "exit-character") return block.characterId === cue.targetCharacterId;
    if (["expression-change", "pose-change", "listener-react"].includes(cue.intent) && block.action === "set-expression") {
      return block.characterId === cue.targetCharacterId;
    }
  }
  if (block.type === "dialogue" && ["expression-change", "pose-change"].includes(cue.intent)) {
    return block.characterId === cue.targetCharacterId && Boolean(cue.expressionId || block.expressionId);
  }
  return false;
}

function applyCueToBlock(block: StoryBlock, cue: PerformanceCue): StoryBlock {
  if (block.type === "stage") {
    const preset = cuePresetName(cue, block.position || "center");
    if (!preset) return block;
    return {
      ...block,
      expressionId: cue.expressionId || block.expressionId,
      transition: { name: preset, durationMs: preset === "diff-crossfade" ? 160 : cue.intent === "exit" ? 340 : 360, easing: "easeOut" },
    };
  }
  if (block.type === "dialogue") {
    return {
      ...block,
      expressionId: cue.expressionId || block.expressionId,
      enter: { name: "diff-crossfade", durationMs: 160, easing: "easeOut" },
    };
  }
  return block;
}

function variableName(project: StoryProject, variableId: string): string {
  return project.variables.find((variable) => variable.id === variableId)?.name || variableId;
}

function recordVariableName(project: StoryProject, recordId: string): string {
  const record = (project.records || []).find((item) => item.id === recordId);
  return `record_${slugify(record?.name || recordId)}`;
}

function choiceStateVariable(blockId: string): string {
  return `__choice_${slugify(blockId)}`;
}

function sceneEndLabel(sceneId: string): string {
  return `__scene_end_${slugify(sceneId)}`;
}

function recordConditionExpression(project: StoryProject, edge: StoryProject["routeMap"]["edges"][number]): string | undefined {
  const condition = edge.recordCondition;
  if (!condition?.recordIds.length) return edge.condition?.trim() || undefined;
  const variables = condition.recordIds.map((id) => recordVariableName(project, id));
  if (condition.mode === "all") return variables.join(" && ");
  const minimum = Math.max(1, Math.min(condition.minimum || 1, variables.length));
  const combinations = (items: string[], size: number): string[][] => {
    if (size === 0) return [[]];
    if (items.length < size) return [];
    return items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((tail) => [item, ...tail]));
  };
  return combinations(variables, minimum).map((items) => `(${items.join(" && ")})`).join(" || ");
}

function variableValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "true";
  return String(value);
}

function compileVariableOperation(project: StoryProject, operation: VariableOperation): string {
  const name = variableName(project, operation.variableId);
  if (operation.expression) return `setVar:${name}=${operation.expression};`;
  if (operation.operation === "toggle") return `setVar:${name}=!${name};`;
  const value = variableValue(operation.value);
  if (operation.operation === "add") return `setVar:${name}=${name}+${value};`;
  if (operation.operation === "subtract") return `setVar:${name}=${name}-${value};`;
  return `setVar:${name}=${value};`;
}

function sceneFigureTransform(scene: StoryScene, characterId?: string): StageTransform | undefined {
  if (!characterId) return undefined;
  return scene.entryStage?.figures?.find((figure) => figure.characterId === characterId)?.transform;
}

function compileStage(project: StoryProject, scene: StoryScene, block: StageBlock): string[] {
  const assetPath = resolveAsset(project, block.assetId);
  const duration = block.transition?.durationMs ?? block.durationMs;
  const character = resolveCharacter(project, block.characterId);
  const figureId = character ? `char-${slugify(character.name)}` : block.characterId;
  const expressionPath = resolveExpressionAsset(project, block.characterId, block.expressionId);
  const enterTransition = normalizeTransitionName(block.transition?.name, "enter");
  const exitTransition = normalizeTransitionName(block.transition?.name, "exit");
  const animation = normalizeTransitionName(block.transition?.name, "animation");
  const volume = toWebgalVolume(block.volume);

  switch (block.action) {
    case "set-background":
      return [`changeBg:${assetPath || "none"}${enterTransition ? arg(enterTransition, "enter") : ""}${arg(duration, "duration")}${arg(block.transition?.easing, "ease")};`];
    case "play-bgm":
      return [`bgm:${assetPath || "none"}${arg(volume, "volume")}${arg(block.durationMs, "enter")};`];
    case "stop-bgm":
      return [`bgm:none${arg(block.durationMs, "enter")};`];
    case "play-sfx":
      return assetPath ? [`playEffect:${assetPath}${arg(volume, "volume")};`] : [];
    case "play-video":
      return assetPath ? [`video:${assetPath};`] : [];
    case "enter-character":
    case "set-expression":
      if (!expressionPath) return [];
      return compileFigureChange({
        expressionPath,
        figureId,
        position: block.position,
        transform: block.transform || sceneFigureTransform(scene, block.characterId),
        asset: resolveExpressionAssetRecord(project, block.characterId, block.expressionId),
        transition: enterTransition,
        duration,
        easing: block.transition?.easing,
        animationArgs: figureAnimationArgs(project, block.characterId, block.expressionId),
      });
    case "exit-character":
      return [`changeFigure:none${arg(figureId, "id")}${exitTransition ? arg(exitTransition, "exit") : ""}${arg(duration, "exitDuration")};`];
    case "move-character": {
      const payload: Record<string, unknown> = {};
      if (block.transform?.x !== undefined || block.transform?.y !== undefined) payload.position = { x: block.transform.x ?? 0, y: block.transform.y ?? 0 };
      if (block.transform?.scale !== undefined) payload.scale = { x: block.transform.scale, y: block.transform.scale };
      if (block.transform?.alpha !== undefined) payload.alpha = block.transform.alpha;
      return [`setTransform:${JSON.stringify(payload)}${arg(figureId, "target")}${arg(duration, "duration")}${arg(block.transition?.easing, "ease")};`];
    }
    case "clear-stage": {
      const figureIds = project.characters.map((item) => `char-${slugify(item.name)}`);
      if (!figureIds.length) return ["; [Story IR] clear-stage: project has no registered characters"];
      return figureIds.map((id, index) =>
        `changeFigure:none -id=${id}${exitTransition ? arg(exitTransition, "exit") : ""}${arg(duration, "exitDuration")}${index < figureIds.length - 1 ? " -next" : ""};`,
      );
    }
    case "transition":
      return [`setAnimation:${animation || "enter"}${arg(block.animationTarget || figureId || "stage-main", "target")};`];
    case "wait":
      return [`wait:${block.durationMs ?? 500};`];
  }
}

function conditionPrefix(option: ChoiceOption): string {
  const visible = option.condition?.trim() ? `(${option.condition.trim()})` : "";
  const enabled = option.enabledCondition?.trim() ? `[${option.enabledCondition.trim()}]` : "";
  return visible || enabled ? `${visible}${enabled}->` : "";
}

function choiceLabel(blockId: string, optionId: string): string {
  return `__choice_${slugify(blockId)}_${slugify(optionId)}`;
}

function blockLabel(blockId: string): string {
  return `__block_${slugify(blockId)}`;
}

function runtimeHookToken(kind: "action" | "input" | "ai" | "save", sceneId: string, blockId: string): string {
  return `${kind}_${slugify(sceneId)}_${slugify(blockId)}`;
}

function compileChoice(project: StoryProject, scene: StoryScene, block: Extract<StoryBlock, { type: "choice" }>): string[] {
  const usable = block.options.filter((option) => !option.hidden);
  if (!usable.length) return [`; [Story IR] 选择块 ${block.id} 没有可用选项`];
  const options = usable.map((option) => {
    const label = choiceLabel(block.id, option.id);
    return `${conditionPrefix(option)}${escapeWebgal(option.label)}:${label}`;
  });
  const lines = [`choose:${options.join("|")};`];
  const continueLabel = `__choice_done_${slugify(block.id)}`;
  let hasContinueOption = false;
  usable.forEach((option) => {
    lines.push(`label:${choiceLabel(block.id, option.id)};`);
    lines.push(`setVar:${choiceStateVariable(block.id)}=${JSON.stringify(option.id)} -next;`);
    if (option.recordId) lines.push(`setVar:${recordVariableName(project, option.recordId)}=true -global -next;`);
    (option.operations || []).forEach((operation) => lines.push(compileVariableOperation(project, operation)));
    const choiceTarget = option.targetChoiceGroupId
      ? project.scenes.flatMap((item) => item.blocks.map((candidate) => ({ scene: item, block: candidate })))
        .find((item) => item.block.type === "choice" && item.block.id === option.targetChoiceGroupId)
      : undefined;
    const internalTarget = option.targetBlockId
      ? scene.blocks.find((item) => item.id === option.targetBlockId)
      : undefined;
    const target = option.targetSceneId
      ? project.scenes.find((item) => item.id === option.targetSceneId)
      : project.scenes.find((item) => project.routeMap.nodes.find((node) => node.id === option.targetRouteNodeId)?.sceneId === item.id);
    if (choiceTarget?.scene.id === scene.id) lines.push(`jumpLabel:${blockLabel(choiceTarget.block.id)};`);
    else if (choiceTarget) {
      lines.push(`setVar:__story_choice_group=${JSON.stringify(choiceTarget.block.id)} -global -next;`);
      lines.push(`changeScene:${sceneFileName(choiceTarget.scene)};`);
    }
    else if (option.endScene) lines.push(`jumpLabel:${sceneEndLabel(scene.id)};`);
    else if (internalTarget) lines.push(`jumpLabel:${blockLabel(internalTarget.id)};`);
    else if (target) lines.push(`changeScene:${sceneFileName(target)};`);
    else {
      hasContinueOption = true;
      lines.push(`jumpLabel:${continueLabel};`);
    }
  });
  if (hasContinueOption) lines.push(`label:${continueLabel};`);
  return lines;
}

function compileInput(project: StoryProject, scene: StoryScene, block: InputBlock): string[] {
  const variable = variableName(project, block.variableId);
  const inputArgs = [
    arg(block.title, "title"),
    arg(block.buttonText, "buttonText"),
    arg(block.defaultValue, "defaultValue"),
    arg(block.validation?.pattern, "rule"),
    arg(block.validation?.flags, "ruleFlag"),
    arg(block.validation?.message, "ruleText"),
  ].join("");
  const marker = `; @gal-blog-input ${JSON.stringify({ blockId: block.id, targets: block.targets, blogActionId: block.blogActionId, aiHookId: block.aiHookId })}`;
  const inputHook = block.targets.some((target) => target === "blog" || target === "ai")
    ? `setVar:__galblog_input_request=${runtimeHookToken("input", scene.id, block.id)};`
    : undefined;
  if (!block.fixedOptions?.length) {
    return [marker, `getUserInput:${variable}${inputArgs};`, ...(inputHook ? [inputHook] : [])];
  }

  const doneLabel = `__input_done_${slugify(block.id)}`;
  const freeLabel = `__input_free_${slugify(block.id)}`;
  const options = block.fixedOptions.map((option) => `${escapeWebgal(option.label)}:__input_fixed_${slugify(option.id)}`);
  if (block.allowFreeText) options.push(`自由输入:${freeLabel}`);
  const lines = [marker, `choose:${options.join("|")};`];
  block.fixedOptions.forEach((option) => {
    lines.push(`label:__input_fixed_${slugify(option.id)};`);
    lines.push(`setVar:${variable}=${JSON.stringify(option.value)};`);
    lines.push(`jumpLabel:${doneLabel};`);
  });
  if (block.allowFreeText) {
    lines.push(`label:${freeLabel};`);
    lines.push(`getUserInput:${variable}${inputArgs};`);
    lines.push(`jumpLabel:${doneLabel};`);
  }
  lines.push(`label:${doneLabel};`);
  if (inputHook) lines.push(inputHook);
  return lines;
}

function compileBlock(project: StoryProject, scene: StoryScene, block: StoryBlock): string[] {
  if (block.disabled) return [`; [disabled:${block.type}] ${block.id}`];
  switch (block.type) {
    case "dialogue": {
      const lines: string[] = [];
      const reactions = block.choiceReactions || [];
      const addVariant = ({
        characterId,
        expressionId,
        position,
        transform,
        text,
        when,
        voiceAssetId,
      }: {
        characterId: string;
        expressionId?: string;
        position?: string;
        transform?: StageTransform;
        text: string;
        when?: string;
        voiceAssetId?: string;
      }) => {
        const character = resolveCharacter(project, characterId);
        const effectiveExpressionId = expressionId || ((position || transform) ? character?.defaultExpressionId : undefined);
        const expressionPath = resolveExpressionAsset(project, characterId, effectiveExpressionId);
        const expressionAsset = resolveExpressionAssetRecord(project, characterId, effectiveExpressionId);
        const condition = when ? ` -when=${when}` : "";
        if (expressionPath && effectiveExpressionId) {
          const dialogueEnter = normalizeTransitionName(block.enter?.name, "enter");
          lines.push(...compileFigureChange({
            expressionPath,
            figureId: `char-${slugify(character?.name || characterId)}`,
            position,
            transform: transform || sceneFigureTransform(scene, characterId),
            asset: expressionAsset,
            transition: dialogueEnter,
            duration: block.enter?.durationMs,
            easing: block.enter?.easing,
            animationArgs: figureAnimationArgs(project, characterId, effectiveExpressionId, block.figureAnimation),
            next: true,
          }).map((line) => condition ? line.replace(/;$/, `${condition};`) : line));
        }
        const voice = resolveAsset(project, voiceAssetId);
        const figureId = `char-${slugify(character?.name || characterId)}`;
        lines.push(`${escapeWebgal(character?.displayName || character?.name || "角色")}:${escapeWebgal(text)}${arg(figureId, "figureId")}${voice ? arg(voice, "vocal") : ""}${condition};`);
      };

      const grouped = new Map<string, typeof reactions>();
      reactions.forEach((reaction) => grouped.set(reaction.choiceBlockId, [...(grouped.get(reaction.choiceBlockId) || []), reaction]));
      const baseWhen = [...grouped.entries()].map(([choiceBlockId, items]) => (
        items.map((item) => `${choiceStateVariable(choiceBlockId)}!=${JSON.stringify(item.optionId)}`).join(" && ")
      )).filter(Boolean).join(" && ") || undefined;
      addVariant({
        characterId: block.characterId,
        expressionId: block.expressionId,
        position: block.position,
        transform: block.transform,
        text: block.text,
        when: baseWhen,
        voiceAssetId: block.voiceAssetId,
      });
      reactions.forEach((reaction) => addVariant({
        characterId: reaction.characterId || block.characterId,
        expressionId: reaction.expressionId || block.expressionId,
        position: reaction.position || block.position,
        transform: reaction.transform || block.transform,
        text: reaction.text,
        when: `${choiceStateVariable(reaction.choiceBlockId)}==${JSON.stringify(reaction.optionId)}`,
      }));
      grouped.forEach((_, choiceBlockId) => lines.push(`setVar:${choiceStateVariable(choiceBlockId)}="" -next;`));
      return lines;
    }
    case "narration":
      if ((block.mode || scene.mode) === "nvl") return [`intro:${escapeWebgal(block.text)}${block.hold ? " -hold" : ""};`];
      return [`${escapeWebgal(block.text)};`];
    case "stage":
      return compileStage(project, scene, block);
    case "choice":
      return compileChoice(project, scene, block);
    case "input":
      return compileInput(project, scene, block);
    case "condition":
      return block.branches.map((branch) => {
        const target = project.scenes.find((item) => item.id === branch.targetSceneId);
        return target ? `changeScene:${sceneFileName(target)}${branch.condition ? arg(branch.condition, "when") : ""};` : `; missing condition target ${branch.targetSceneId}`;
      });
    case "variable":
      return block.operations.map((operation) => compileVariableOperation(project, operation));
    case "jump": {
      if (block.targetBlockId) {
        const targetBlock = scene.blocks.find((item) => item.id === block.targetBlockId);
        return targetBlock
          ? [`jumpLabel:${blockLabel(targetBlock.id)}${block.condition ? arg(block.condition, "when") : ""};`]
          : [`; missing internal jump target ${block.targetBlockId}`];
      }
      const routeSceneId = project.routeMap.nodes.find((node) => node.id === block.targetRouteNodeId)?.sceneId;
      const target = project.scenes.find((item) => item.id === (block.targetSceneId || routeSceneId));
      return target ? [`changeScene:${sceneFileName(target)}${block.condition ? arg(block.condition, "when") : ""};`] : [`; missing jump target ${block.targetSceneId || block.targetRouteNodeId}`];
    }
    case "mode":
      return block.mode === "nvl"
        ? [`; @story-mode nvl dim=${block.dimBackground ?? 0.38}`, "setTextbox:hide;"]
        : ["; @story-mode adv", "setTextbox:show;"];
    case "save-point":
      return [
        `; @save-point ${JSON.stringify({ id: block.savePointId, auto: block.auto ?? false })}`,
        "setVar:__galblog_status=pending;",
        `setVar:__galblog_request=${runtimeHookToken("save", scene.id, block.id)};`,
        "wait:600000;",
      ];
    case "blog-action": {
      const token = runtimeHookToken("action", scene.id, block.id);
      const lines = [
        `; @gal-blog-action ${JSON.stringify({ blockId: block.id, action: block.action, customAction: block.customAction, payload: block.payload, resultVariableId: block.resultVariableId, resultBranches: block.resultBranches })}`,
        "setVar:__galblog_status=pending;",
        `setVar:__galblog_request=${token};`,
        "wait:600000;",
      ];
      const branches = [
        ["success", block.resultBranches?.successSceneId],
        ["failure", block.resultBranches?.failureSceneId],
        ["cancel", block.resultBranches?.cancelSceneId],
      ] as const;
      branches.forEach(([status, sceneId]) => {
        const target = project.scenes.find((item) => item.id === sceneId);
        if (target) {
          lines.push(`changeScene:${sceneFileName(target)} -when=__galblog_status=='${status}';`);
          if (status === "failure") lines.push(`changeScene:${sceneFileName(target)} -when=__galblog_status=='unsupported';`);
        }
      });
      return lines;
    }
    case "ai-turn": {
      const marker = `; @ai-turn ${JSON.stringify({ blockId: block.id, configId: block.configId, characters: block.characterIds, prompt: block.prompt, allowedTools: block.allowedTools, maxOperations: block.maxOperations })}`;
      const fallback = project.scenes.find((item) => item.id === block.fallbackSceneId);
      return fallback ? [marker, `changeScene:${sceneFileName(fallback)};`] : [marker];
    }
    case "native":
      return [`; @native-webgal begin ${block.id}`, ...block.script.replace(/\r/g, "").split("\n"), `; @native-webgal end ${block.id}`];
    case "comment":
      return block.text.split(/\r?\n/).map((line) => `; ${line}`);
  }
}

export function compileScene(project: StoryProject, scene: StoryScene): { script: string; diagnostics: StoryDiagnostic[] } {
  const diagnostics = validateProject(project).filter((diagnostic) => !diagnostic.sceneId || diagnostic.sceneId === scene.id);
  const staging = validateStagingPlan(project, scene);
  diagnostics.push(...staging.diagnostics);
  const cuesByBlock = new Map<string, PerformanceCue[]>();
  if (scene.staging?.enabled !== false) {
    staging.plan.cues.filter((cue) => !cue.disabled).forEach((cue) => {
      cuesByBlock.set(cue.blockId, [...(cuesByBlock.get(cue.blockId) || []), cue]);
    });
  }
  const lines = [
    `; Generated by Gal Blog Game Studio from Story IR ${project.schemaVersion}`,
    `; Scene: ${scene.name} (${scene.id})`,
    `; Mode: ${scene.mode}`,
  ];
  const choiceGroups = scene.blocks.filter((block) => block.type === "choice");
  choiceGroups.forEach((block) => {
    lines.push(`jumpLabel:${blockLabel(block.id)} -when=__story_choice_group==${JSON.stringify(block.id)} -next;`);
  });
  const internalTargets = new Set(
    scene.blocks.flatMap((block) => {
      if (block.type === "choice") return block.options.map((option) => option.targetBlockId).filter((id): id is string => Boolean(id));
      if (block.type === "jump" && block.targetBlockId) return [block.targetBlockId];
      return [];
    }),
  );
  const figureState = new Map<string, { expressionId?: string; position?: string; transformKey?: string }>();
  scene.blocks.forEach((block) => {
    if (block.id.startsWith("route_jump_") && block.source === "system") return;
    if (internalTargets.has(block.id) || block.type === "choice") lines.push(`label:${blockLabel(block.id)};`);
    if (block.type === "choice") lines.push("setVar:__story_choice_group=\"\" -global -next;");
    let blockToCompile = block;
    if (block.type === "stage" && block.characterId) {
      if (block.action === "exit-character") {
        figureState.delete(block.characterId);
      } else if (block.action === "enter-character" || block.action === "set-expression") {
        const current = figureState.get(block.characterId);
        if (block.action === "enter-character" && current) {
          blockToCompile = { ...block, action: "set-expression", transition: undefined };
        }
        figureState.set(block.characterId, {
          expressionId: block.expressionId || current?.expressionId,
          position: block.position || current?.position,
          transformKey: JSON.stringify(block.transform || sceneFigureTransform(scene, block.characterId) || {}),
        });
      }
    }
    if (block.type === "dialogue" && block.expressionId) {
      const current = figureState.get(block.characterId);
      const dialogueBlock = current && block.enter ? { ...block, enter: undefined } : block;
      const nextPosition = block.position || current?.position;
      const nextTransformKey = JSON.stringify(block.transform || sceneFigureTransform(scene, block.characterId) || {});
      if (current?.expressionId === block.expressionId && current.position === nextPosition && current.transformKey === nextTransformKey && !block.choiceReactions?.length && !block.figureAnimation) {
        blockToCompile = { ...dialogueBlock, expressionId: undefined, position: undefined, transform: undefined, enter: undefined };
      } else {
        blockToCompile = dialogueBlock;
        figureState.set(block.characterId, {
          expressionId: block.expressionId,
          position: nextPosition,
          transformKey: nextTransformKey,
        });
      }
    }

    const blockCues = cuesByBlock.get(block.id) || [];
    // during-line cues are scheduled by the layered WebGAL adapter against the active vocal.
    // Emitting their figure change before the dialogue would make a supposedly mid-line swap happen early.
    const leadingCues = blockCues.filter((cue) => cue.timing !== "after-line" && cue.timing !== "during-line");
    const trailingCues = blockCues.filter((cue) => cue.timing === "after-line");
    leadingCues.forEach((cue) => {
      if (cueAppliedByBlock(blockToCompile, cue)) {
        blockToCompile = applyCueToBlock(blockToCompile, cue);
        lines.push(cueMarker(cue));
      } else {
        lines.push(...compileStagingCue(project, scene, cue));
      }
    });

    lines.push(...compileBlock(project, scene, blockToCompile));
    trailingCues.forEach((cue) => lines.push(...compileStagingCue(project, scene, cue)));

    if (block.type === "stage") {
      if (block.action === "clear-stage") figureState.clear();
      if (block.action === "exit-character" && block.characterId) figureState.delete(block.characterId);
      if (
        (block.action === "enter-character" || block.action === "set-expression")
        && block.characterId
      ) {
        const current = figureState.get(block.characterId);
        figureState.set(block.characterId, {
          expressionId: block.expressionId || current?.expressionId,
          position: block.position || current?.position,
          transformKey: JSON.stringify(block.transform || sceneFigureTransform(scene, block.characterId) || {}),
        });
      }
    }
  });
  lines.push(`label:${sceneEndLabel(scene.id)};`);
  const sourceNodeIds = new Set(project.routeMap.nodes.filter((node) => node.sceneId === scene.id).map((node) => node.id));
  const outgoing = project.routeMap.edges
    .filter((edge) => sourceNodeIds.has(edge.source))
    .sort((a, b) => Number(Boolean(recordConditionExpression(project, b))) - Number(Boolean(recordConditionExpression(project, a))) || (b.priority || 0) - (a.priority || 0));
  outgoing.forEach((edge) => {
    const targetSceneId = project.routeMap.nodes.find((node) => node.id === edge.target)?.sceneId;
    const target = project.scenes.find((item) => item.id === targetSceneId);
    if (!target) return;
    lines.push(`changeScene:${sceneFileName(target)}${arg(recordConditionExpression(project, edge), "when")};`);
  });
  return { script: `${lines.join("\n")}\n`, diagnostics };
}

function compileConfig(project: StoryProject): string {
  return [
    `Game_name:${project.title};`,
    `Game_key:${project.slug};`,
    `Game_version:${project.version};`,
    "Default_Language:ja;",
    "Enable_Appreciation:false;",
    "TypingSoundEnabled:false;",
    "Figure_Default_Enter_Duration:350;",
    "Figure_Default_Exit_Duration:350;",
  ].join("\n") + "\n";
}

export function compileLaunchBootstrap(project: StoryProject, sceneId: string): string {
  const startScene = project.scenes.find((scene) => scene.id === sceneId);
  const fresh = " -when=__galblog_resume!=true";
  const lines = [
    "; Story IR bootstrap",
    ...project.variables
      .filter((variable) => variable.scope !== "scene")
      .map((variable) => `setVar:${variable.name}=${variableValue(variable.defaultValue)} -global -next${fresh};`),
    ...(project.records || []).map((record) => `setVar:${recordVariableName(project, record.id)}=false -global -next${fresh};`),
    startScene ? `changeScene:${sceneFileName(startScene)};` : "; ERROR: start scene missing",
  ];
  return `${lines.join("\n")}\n`;
}

function compileStart(project: StoryProject): string {
  return compileLaunchBootstrap(project, project.settings.startSceneId);
}

function compileBridgeRuntime(project: StoryProject): string {
  const config = JSON.stringify(project.settings.blogBridge);
  type BridgeActionManifestEntry = [string, {
    blockId: string;
    sceneId: string;
    action: string;
    payload: Record<string, unknown>;
    resultVariable?: string;
  }];
  const actionManifestEntries: BridgeActionManifestEntry[] = project.scenes.flatMap((scene) =>
    scene.blocks.flatMap((block): BridgeActionManifestEntry[] => {
      if (block.type === "blog-action") return [[runtimeHookToken("action", scene.id, block.id), {
            blockId: block.id,
            sceneId: scene.id,
            action: block.action === "custom" ? block.customAction || "custom" : block.action,
            payload: block.payload || {},
            resultVariable: block.resultVariableId ? variableName(project, block.resultVariableId) : undefined,
          }]];
      if (block.type === "save-point") {
        const point = project.savePoints.find((item) => item.id === block.savePointId);
        if (!point) return [];
        return [[runtimeHookToken("save", scene.id, block.id), {
          blockId: block.id,
          sceneId: scene.id,
          action: "save-progress",
          payload: { target: { kind: "save-point", id: point.id }, title: point.name, scene: scene.name },
        }]];
      }
      return [];
    }),
  );
  const actionManifest = Object.fromEntries(actionManifestEntries);
  const inputManifest = Object.fromEntries(
    project.scenes.flatMap((scene) =>
      scene.blocks
        .filter((block): block is InputBlock => block.type === "input" && block.targets.some((target) => target === "blog" || target === "ai"))
        .map((block) => [
          runtimeHookToken("input", scene.id, block.id),
          {
            blockId: block.id,
            sceneId: scene.id,
            variable: variableName(project, block.variableId),
            targets: block.targets,
            blogActionId: block.blogActionId,
            aiHookId: block.aiHookId,
          },
        ]),
    ),
  );
  return `(() => {
  const config = ${config};
  const actionManifest = ${JSON.stringify(actionManifest)};
  const inputManifest = ${JSON.stringify(inputManifest)};
  let seq = 0;
  const pending = new Map();
  const referrerOrigin = (() => {
    try { return document.referrer ? new URL(document.referrer).origin : ""; }
    catch { return ""; }
  })();
  const targetOrigin = config.allowedOrigins.includes(referrerOrigin)
    ? referrerOrigin
    : config.allowedOrigins.length === 1 ? config.allowedOrigins[0] : "*";
  let attachedCore = null;
  let unsubscribeStage = null;
  let activeActionToken = "";
  let activeInputToken = "";
  let aiProvider = null;

  function emit(type, payload) {
    const id = "gb-" + Date.now() + "-" + (++seq);
    const message = { channel: config.channel, source: "galgame", id, type, payload };
    window.dispatchEvent(new CustomEvent("galblog:bridge-message", { detail: message }));
    if (window.parent && window.parent !== window) window.parent.postMessage(message, targetOrigin);
    return id;
  }

  function request(action, payload) {
    if (!config.enabled) return Promise.resolve({ status: "failure", disabled: true });
    if (!config.capabilities.includes(action) && action !== "custom") {
      return Promise.resolve({ status: "failure", unsupported: true, action });
    }
    const id = emit("request", { action, payload });
    if (!window.parent || window.parent === window) {
      return Promise.resolve({ status: "success", standalone: true });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Blog Bridge timeout")); }, config.timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  }

  function setRuntimeVar(core, key, value) {
    core.stageManager.setStageVar({ key, value });
  }

  function commitRuntime(core) {
    core.stageManager.commit();
  }

  function normalizeStatus(value) {
    const status = value && typeof value === "object" ? value.status : undefined;
    return status === "failure" || status === "cancel" ? status : "success";
  }

  function showRuntimeLock(action) {
    let lock = document.getElementById("galblog-runtime-lock");
    if (!lock) {
      lock = document.createElement("div");
      lock.id = "galblog-runtime-lock";
      Object.assign(lock.style, {
        position: "fixed", inset: "0", zIndex: "2147483646", display: "grid",
        placeItems: "end center", padding: "0 0 8vh", pointerEvents: "all",
        background: "linear-gradient(180deg, transparent 60%, rgba(4,7,16,.68))",
        color: "white", font: "500 14px system-ui", letterSpacing: ".08em"
      });
      document.body.appendChild(lock);
    }
    lock.textContent = "GAL-BLOG · " + action + " · WAITING";
    return lock;
  }

  function advanceWebGAL() {
    const target = document.getElementById("FullScreenClick");
    if (target) target.dispatchEvent(new MouseEvent("click", { view: window, bubbles: true, cancelable: true }));
  }

  async function handleAction(core, token, action) {
    const lock = showRuntimeLock(action.action);
    let response;
    let status = "success";
    try {
      response = await request(action.action, {
        ...action.payload,
        __story: { projectId: ${JSON.stringify(project.id)}, sceneId: action.sceneId, blockId: action.blockId }
      });
      status = normalizeStatus(response);
    } catch (error) {
      status = "failure";
      response = { error: error instanceof Error ? error.message : String(error) };
    }
    setRuntimeVar(core, "__galblog_status", status);
    setRuntimeVar(core, "__galblog_request", "");
    if (action.resultVariable) setRuntimeVar(core, action.resultVariable, status);
    commitRuntime(core);
    emit("action-result", { token, action: action.action, status, response, sceneId: action.sceneId, blockId: action.blockId });
    lock.remove();
    setTimeout(advanceWebGAL, 0);
  }

  function handleInput(core, token, input, stageState) {
    const value = stageState.GameVar[input.variable] ?? "";
    const detail = {
      token,
      projectId: ${JSON.stringify(project.id)},
      sceneId: input.sceneId,
      blockId: input.blockId,
      variable: input.variable,
      value,
      targets: input.targets,
      blogActionId: input.blogActionId,
      aiHookId: input.aiHookId
    };
    emit("player-input", detail);
    window.dispatchEvent(new CustomEvent("galblog:player-input", { detail }));
    if (input.targets.includes("ai") && aiProvider && typeof aiProvider.onPlayerInput === "function") {
      Promise.resolve(aiProvider.onPlayerInput(detail)).catch((error) => emit("ai-error", { token, error: String(error) }));
    }
    setRuntimeVar(core, "__galblog_input_request", "");
    commitRuntime(core);
  }

  function onStageState(core, stageState) {
    const actionToken = String(stageState.GameVar.__galblog_request || "");
    if (!actionToken) {
      activeActionToken = "";
    } else if (actionToken !== activeActionToken && actionManifest[actionToken]) {
      activeActionToken = actionToken;
      void handleAction(core, actionToken, actionManifest[actionToken]);
    }

    const inputToken = String(stageState.GameVar.__galblog_input_request || "");
    if (!inputToken) {
      activeInputToken = "";
    } else if (inputToken !== activeInputToken && inputManifest[inputToken]) {
      activeInputToken = inputToken;
      queueMicrotask(() => handleInput(core, inputToken, inputManifest[inputToken], stageState));
    }
  }

  function attachWebGAL(core) {
    if (!core || !core.stageManager || typeof core.stageManager.subscribe !== "function") return false;
    if (attachedCore === core) return true;
    if (unsubscribeStage) unsubscribeStage();
    attachedCore = core;
    unsubscribeStage = core.stageManager.subscribe((state) => onStageState(core, state));
    const current = core.stageManager.getViewStageState?.() || core.stageManager.getCalculationStageState?.();
    if (current) onStageState(core, current);
    emit("runtime-attached", { engine: "WebGAL", projectId: ${JSON.stringify(project.id)} });
    return true;
  }

  function registerAIProvider(provider) {
    aiProvider = provider;
    emit("ai-provider-ready", { available: Boolean(provider) });
  }

  window.addEventListener("message", (event) => {
    if (window.parent && window.parent !== window && event.source !== window.parent) return;
    if (config.allowedOrigins.length && !config.allowedOrigins.includes(event.origin)) return;
    const data = event.data;
    if (!data || data.channel !== config.channel || data.source !== "gal-blog") return;
    if (data.replyTo && pending.has(data.replyTo)) {
      const item = pending.get(data.replyTo);
      clearTimeout(item.timer);
      pending.delete(data.replyTo);
      data.ok === false ? item.reject(new Error(data.error || "Bridge request failed")) : item.resolve(data.payload);
    }
  });

  window.GalBlogBridge = { emit, request, attachWebGAL, registerAIProvider, config, actionManifest, inputManifest };
  emit("ready", { projectId: ${JSON.stringify(project.id)}, version: ${JSON.stringify(project.version)} });
})();`;
}

type CompileProjectOptions = {
  previewMode?: boolean;
};

function compileIndex(project: StoryProject, options: CompileProjectOptions = {}): string {
  const previewMode = Boolean(options.previewMode);
  const engineUrl = previewMode ? "/vendor/webgal/assets/index-BuN51U1e.js" : (project.settings.sharedEngineUrl || "");
  const engineCssUrl = previewMode ? "/vendor/webgal/assets/index-Dch1g2w9.css" : (project.settings.sharedEngineCssUrl || "");
  const entryScript = `
      const click = (target) => target?.dispatchEvent(new MouseEvent("click", { view: window, bubbles: true, cancelable: true }));
      const waitFor = (resolveTarget, timeoutMs = 8000) => new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const check = () => {
          const target = resolveTarget();
          if (target) return resolve(target);
          if (Date.now() - startedAt >= timeoutMs) return reject(new Error("WebGAL preview start control was not found"));
          setTimeout(check, 40);
        };
        check();
      });
      const launchWebGal = async () => {
          const enterTarget = await waitFor(() => document.querySelector(".title__enter-game-target"));
          click(enterTarget);
          const startButton = await waitFor(() => Array.from(document.querySelectorAll("div")).find((element) => {
            const className = typeof element.className === "string" ? element.className : "";
            const parentClass = typeof element.parentElement?.className === "string" ? element.parentElement.className : "";
            return className.includes("_Title_button_") && parentClass.includes("_Title_buttonList_");
          }));
          click(startButton);
          ${previewMode ? `window.parent?.postMessage({
            channel: ${JSON.stringify(project.settings.blogBridge.channel)},
            type: "webgal-preview-started",
            sceneId: ${JSON.stringify(project.settings.startSceneId)}
          }, "*");` : ""}
      };
      window.__GAL_BLOG_ENGINE_RENDERED__
        .then(() => {
          ${previewMode ? `
          const startGate = document.createElement("button");
          startGate.id = "galblog-user-start";
          startGate.type = "button";
          startGate.textContent = "点击启动 WebGAL 实机（启用语音）";
          startGate.addEventListener("click", () => {
            startGate.remove();
            void launchWebGal();
          }, { once: true });
          document.body.appendChild(startGate);` : `void launchWebGal();`}
        })
        .catch((error) => {
          if (status) status.textContent = "WEBGAL PREVIEW START ERROR · " + (error instanceof Error ? error.message : String(error));
        });`;
  return `<!doctype html>
<html lang="${project.locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${project.title.replace(/[<>&"]/g, "")}</title>
  <style>
    html,body{width:100%;height:100%;margin:0;background:#05060b;color:#fff;overflow:hidden}
    #ebg{position:fixed;inset:-8%;background:radial-gradient(circle at 50% 45%,#22263a 0,#090b13 45%,#030408 100%);filter:blur(36px)}
    #ebgOverlay{width:100%;height:100%;background:#03040880}
    #root{position:absolute;width:2560px;height:1440px;transform-origin:top left;overflow:hidden}
    [class*="_Title_main_"],[class*="_main_rdjpk_"],[class*="_trans_1oupq_"]{display:none!important}
    #galblog-language-gate{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#05060b;color:#fff;font-family:system-ui,sans-serif}
    #galblog-language-gate[hidden]{display:none}
    #galblog-language-gate>div{display:flex;gap:8px;padding:8px;border:1px solid #ffffff1f;border-radius:16px;background:#ffffff0a;box-shadow:0 20px 80px #0008}
    #galblog-language-gate button{min-width:96px;border:0;border-radius:11px;padding:12px 16px;background:transparent;color:#d9dce7;font:600 14px system-ui;cursor:pointer}
    #galblog-language-gate button:first-child,#galblog-language-gate button:hover{background:#fff;color:#171922}
    #galblog-engine-status{position:absolute;left:50%;top:50%;z-index:101;width:18px;height:18px;border:2px solid #ffffff26;border-top-color:#fff;border-radius:50%;transform:translate(-50%,-50%);animation:galblog-spin .8s linear infinite;font-size:0}
    #galblog-user-start{position:fixed;left:50%;top:50%;z-index:2147483646;transform:translate(-50%,-50%);border:1px solid #ffffff45;border-radius:14px;padding:16px 22px;background:#171a27;color:#fff;box-shadow:0 16px 60px #0009;font:600 16px system-ui,sans-serif;cursor:pointer}
    #galblog-user-start:hover{background:#282d43}
    @keyframes galblog-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}
  </style>
  ${engineCssUrl ? `<link rel="stylesheet" crossorigin href="${engineCssUrl.replace(/["<>&]/g, "")}" />` : ""}
  <script>
    window.__GAL_BLOG_LAUNCH__={projectId:${JSON.stringify(project.id)},startScene:"game/scene/start.txt",gameDir:"./game/"};
    window.__TUANCHAT_WEBGAL__={autoStart:true,startScene:"game/scene/start.txt",gameDir:"./game/"};
    window.live2dPromise=window.live2dPromise||Promise.resolve([false,false]);
    window.__GAL_BLOG_ENGINE_RENDERED__=new Promise((resolve)=>{
      window.renderPromiseResolve=()=>{
        resolve();
        delete window.renderPromiseResolve;
      };
    });
  </script>
  <script src="./gal-blog-bridge.js"></script>
</head>
<body>
  <div id="ebg" aria-hidden="true"><div id="ebgOverlay"></div></div>
  <div id="galblog-language-gate" hidden><div><button type="button" data-lang="2">日本語</button><button type="button" data-lang="0">中文</button><button type="button" data-lang="1">English</button></div></div>
  <div id="html-body__panic-overlay"></div>
  <div id="root"></div>
  <div id="galblog-engine-status" aria-label="正在加载"></div>
  <script>
    (() => {
      const root = document.getElementById("root");
      const status = document.getElementById("galblog-engine-status");
      const languageGate = document.getElementById("galblog-language-gate");
      window.__GAL_BLOG_LANGUAGE_READY__ = (() => {
        const saved = window.localStorage.getItem("lang");
        if (["0", "1", "2"].includes(saved || "")) return Promise.resolve(saved);
        languageGate.hidden = false;
        return new Promise((resolve) => languageGate.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
          const language = button.dataset.lang || "2";
          window.localStorage.setItem("lang", language);
          languageGate.remove();
          resolve(language);
        }, { once: true })));
      })();
      const resize = () => {
        const scale = Math.min(window.innerWidth / 2560, window.innerHeight / 1440);
        const left = (window.innerWidth - 2560 * scale) / 2;
        const top = (window.innerHeight - 1440 * scale) / 2;
        const transform = \`translate(\${left}px,\${top}px) scale(\${scale})\`;
        if (root) root.style.transform = transform;
      };
      ${entryScript}
      resize();
      window.addEventListener("resize", resize);
    })();
  </script>
  <script type="module">
    const engineUrl = ${JSON.stringify(engineUrl).replace(/</g, "\\u003c")};
    const status = document.getElementById("galblog-engine-status");
    try {
      await window.__GAL_BLOG_LANGUAGE_READY__;
      if (!engineUrl) throw new Error("No sharedEngineUrl configured. Copy the official WebGAL dist into this package.");
      const engineModule = await import(engineUrl);
      const core = engineModule.W || engineModule.WebGAL || window.WebGAL || window.__WEBGAL__;
      const layerManifest = await fetch("./game/face-motion/layers.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null);
      const faceMotionAdapter = await import("./game/extensions/face-motion-adapter.js");
      faceMotionAdapter.attach?.(core, layerManifest);
      window.GalBlogBridge?.attachWebGAL(core);
      status?.remove();
    } catch (error) {
      if (status) status.textContent = "WEBGAL LOAD ERROR · " + (error instanceof Error ? error.message : String(error));
      console.error("[Gal Blog Studio] WebGAL load failed", error);
    }
  </script>
</body>
</html>`;
}

export function compileProject(
  project: StoryProject,
  options: CompileProjectOptions = {},
): CompileResult {
  const diagnostics = validateProject(project);
  const sceneScripts: Record<string, string> = {};
  project.scenes.forEach((scene) => {
    sceneScripts[scene.id] = compileScene(project, scene).script;
  });
  const files = [
    { path: "index.html", content: compileIndex(project, options), contentType: "text/html; charset=utf-8" },
    { path: "gal-blog-bridge.js", content: compileBridgeRuntime(project), contentType: "text/javascript; charset=utf-8" },
    { path: "gal-blog.embed.json", content: `${JSON.stringify({
      schemaVersion: 1,
      projectId: project.id,
      title: project.title,
      launchTargets: {
        start: { sceneId: project.settings.startSceneId },
        scenes: project.scenes.map((scene) => ({ id: scene.id, name: scene.name, slug: scene.slug })),
        savePoints: project.savePoints,
        routeMap: {
          layoutDirection: project.routeMap.layoutDirection || "left-right",
          nodes: project.routeMap.nodes.map((node) => ({
            id: node.id,
            title: node.title,
            sceneId: node.sceneId,
            kind: node.kind,
            x: node.x,
            y: node.y,
            condition: node.condition,
            unlockCondition: node.unlockCondition,
            readVariableId: node.readVariableId,
            hiddenFromPlayer: node.hiddenFromPlayer,
            replayable: node.replayable,
          })),
          edges: project.routeMap.edges,
        },
        routeNodes: project.routeMap.nodes.map((node) => ({ id: node.id, title: node.title, sceneId: node.sceneId, kind: node.kind })),
      },
      bridge: project.settings.blogBridge,
    }, null, 2)}\n`, contentType: "application/json; charset=utf-8" },
    { path: "game/config.txt", content: compileConfig(project), contentType: "text/plain; charset=utf-8" },
    { path: "game/face-motion/layers.json", content: `${JSON.stringify(buildWebGalLayerManifest(project), null, 2)}\n`, contentType: "application/json; charset=utf-8" },
    { path: "game/extensions/face-motion-adapter.js", content: WEBGAL_FACE_MOTION_ADAPTER_SOURCE, contentType: "text/javascript; charset=utf-8" },
    { path: "game/scene/start.txt", content: compileStart(project), contentType: "text/plain; charset=utf-8" },
    ...WEBGAL_ANIMATION_FILES.map((file) => ({ ...file, contentType: "application/json; charset=utf-8" })),
    { path: "game/userStyleSheet.css", content: "", contentType: "text/css; charset=utf-8" },
    ...project.scenes.map((scene) => ({
      path: `game/scene/${sceneFileName(scene)}`,
      content: sceneScripts[scene.id],
      contentType: "text/plain; charset=utf-8",
    })),
  ];
  return { files, diagnostics, sceneScripts, entrypoint: "index.html" };
}
