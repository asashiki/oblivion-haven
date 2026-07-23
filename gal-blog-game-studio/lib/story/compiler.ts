import type {
  CompileResult,
  ChoiceOption,
  InputBlock,
  StageBlock,
  StoryBlock,
  StoryDiagnostic,
  StoryProject,
  StoryScene,
  VariableOperation,
} from "./types";
import { escapeWebgal, sanitizeWebgalArg, slugify } from "./utils";
import { validateProject } from "./schema";
import {
  normalizeTransitionName,
  toWebgalVolume,
  WEBGAL_ANIMATION_FILES,
} from "./performancePresets";

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

function positionArgs(position?: string): string {
  if (position === "left" || position === "far-left") return " -left";
  if (position === "right" || position === "far-right") return " -right";
  return "";
}

function transformArg(block: StageBlock): string {
  const transform = block.transform;
  if (!transform) return "";
  const payload: Record<string, unknown> = {};
  if (transform.x !== undefined || transform.y !== undefined) payload.position = { x: transform.x ?? 0, y: transform.y ?? 0 };
  if (transform.scale !== undefined) payload.scale = { x: transform.scale, y: transform.scale };
  if (transform.rotation !== undefined) payload.rotation = transform.rotation;
  if (transform.alpha !== undefined) payload.alpha = transform.alpha;
  return Object.keys(payload).length ? ` -transform=${JSON.stringify(payload)}` : "";
}

function variableName(project: StoryProject, variableId: string): string {
  return project.variables.find((variable) => variable.id === variableId)?.name || variableId;
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

function compileStage(project: StoryProject, block: StageBlock): string[] {
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
    case "enter-character":
    case "set-expression":
      if (!expressionPath) return [];
      return [
        `changeFigure:${expressionPath}${arg(figureId, "id")}${positionArgs(block.position)}${enterTransition ? arg(enterTransition, "enter") : ""}${arg(duration, "duration")}${arg(block.transition?.easing, "ease")}${transformArg(block)};`,
      ];
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

function runtimeHookToken(kind: "action" | "input" | "ai", sceneId: string, blockId: string): string {
  return `${kind}_${slugify(sceneId)}_${slugify(blockId)}`;
}

function compileChoice(project: StoryProject, block: Extract<StoryBlock, { type: "choice" }>): string[] {
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
    (option.operations || []).forEach((operation) => lines.push(compileVariableOperation(project, operation)));
    const target = option.targetSceneId
      ? project.scenes.find((scene) => scene.id === option.targetSceneId)
      : project.scenes.find((scene) => project.routeMap.nodes.find((node) => node.id === option.targetRouteNodeId)?.sceneId === scene.id);
    if (target) lines.push(`changeScene:${sceneFileName(target)};`);
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
      const character = resolveCharacter(project, block.characterId);
      const lines: string[] = [];
      const expressionPath = resolveExpressionAsset(project, block.characterId, block.expressionId);
      if (expressionPath && block.expressionId) {
        lines.push(`changeFigure:${expressionPath}${arg(`char-${slugify(character?.name || block.characterId)}`, "id")}${positionArgs(block.position)} -next;`);
      }
      const voice = resolveAsset(project, block.voiceAssetId);
      lines.push(`${escapeWebgal(character?.displayName || character?.name || "角色")}:${escapeWebgal(block.text)}${voice ? arg(voice, "vocal") : ""};`);
      return lines;
    }
    case "narration":
      if ((block.mode || scene.mode) === "nvl") return [`intro:${escapeWebgal(block.text)}${block.hold ? " -hold" : ""};`];
      return [`${escapeWebgal(block.text)};`];
    case "stage":
      return compileStage(project, block);
    case "choice":
      return compileChoice(project, block);
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
      const routeSceneId = project.routeMap.nodes.find((node) => node.id === block.targetRouteNodeId)?.sceneId;
      const target = project.scenes.find((item) => item.id === (block.targetSceneId || routeSceneId));
      return target ? [`changeScene:${sceneFileName(target)}${block.condition ? arg(block.condition, "when") : ""};`] : [`; missing jump target ${block.targetSceneId || block.targetRouteNodeId}`];
    }
    case "mode":
      return block.mode === "nvl"
        ? [`; @story-mode nvl dim=${block.dimBackground ?? 0.38}`, "setTextbox:hide;"]
        : ["; @story-mode adv", "setTextbox:show;"];
    case "save-point":
      return [`; @save-point ${JSON.stringify({ id: block.savePointId, auto: block.auto ?? false })}`];
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
        if (target) lines.push(`changeScene:${sceneFileName(target)} -when=__galblog_status=='${status}';`);
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
  const lines = [
    `; Generated by Gal Blog Game Studio from Story IR ${project.schemaVersion}`,
    `; Scene: ${scene.name} (${scene.id})`,
    `; Mode: ${scene.mode}`,
  ];
  scene.blocks.forEach((block) => lines.push(...compileBlock(project, scene, block)));
  return { script: `${lines.join("\n")}\n`, diagnostics };
}

function compileConfig(project: StoryProject): string {
  return [
    `Game_name:${project.title};`,
    `Game_key:${project.slug};`,
    `Game_version:${project.version};`,
    `Language:${project.locale};`,
    "Enable_Appreciation:true;",
    "TypingSoundEnabled:false;",
    "Figure_Default_Enter_Duration:350;",
    "Figure_Default_Exit_Duration:350;",
  ].join("\n") + "\n";
}

function compileStart(project: StoryProject): string {
  const startScene = project.scenes.find((scene) => scene.id === project.settings.startSceneId);
  const lines = [
    "; Story IR bootstrap",
    ...project.variables
      .filter((variable) => variable.scope !== "scene")
      .map((variable) => `setVar:${variable.name}=${variableValue(variable.defaultValue)} -global -next;`),
    startScene ? `changeScene:${sceneFileName(startScene)};` : "; ERROR: start scene missing",
  ];
  return `${lines.join("\n")}\n`;
}

function compileBridgeRuntime(project: StoryProject): string {
  const config = JSON.stringify(project.settings.blogBridge);
  const actionManifest = Object.fromEntries(
    project.scenes.flatMap((scene) =>
      scene.blocks
        .filter((block): block is Extract<StoryBlock, { type: "blog-action" }> => block.type === "blog-action")
        .map((block) => [
          runtimeHookToken("action", scene.id, block.id),
          {
            blockId: block.id,
            sceneId: scene.id,
            action: block.action === "custom" ? block.customAction || "custom" : block.action,
            payload: block.payload || {},
            resultVariable: block.resultVariableId ? variableName(project, block.resultVariableId) : undefined,
          },
        ]),
    ),
  );
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

function compileIndex(project: StoryProject): string {
  const engineUrl = project.settings.sharedEngineUrl || "";
  const engineCssUrl = project.settings.sharedEngineCssUrl || "";
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
    #root,.html-body__title-enter{position:absolute;width:2560px;height:1440px;transform-origin:top left;overflow:hidden}
    .html-body__title-enter{z-index:100;display:grid;place-items:center;background:linear-gradient(135deg,#111525 0%,#070910 68%);transition:opacity .65s ease}
    .html-body__title-enter.is-leaving{opacity:0;pointer-events:none}
    #galblog-enter{border:1px solid #ffffff42;border-radius:999px;padding:18px 34px;background:#ffffff0c;color:#f5f7ff;font:500 20px/1.2 ui-serif,Georgia,serif;letter-spacing:.28em;cursor:pointer;box-shadow:0 16px 70px #0008;transition:background .2s,border-color .2s}
    #galblog-enter:hover{background:#ffffff16;border-color:#ffffff70}
    #galblog-engine-status{position:absolute;left:50%;bottom:84px;z-index:101;transform:translateX(-50%);font:500 13px system-ui;letter-spacing:.18em;color:#a9b5d5}
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
  <div class="html-body__title-enter">
    <button id="galblog-enter" type="button">PRESS SCREEN TO START</button>
  </div>
  <div id="html-body__panic-overlay"></div>
  <div id="root"></div>
  <div id="galblog-engine-status">WEBGAL ${project.settings.webgalVersion} · LOADING</div>
  <script>
    (() => {
      const root = document.getElementById("root");
      const landing = document.querySelector(".html-body__title-enter");
      const enter = document.getElementById("galblog-enter");
      const resize = () => {
        const scale = Math.min(window.innerWidth / 2560, window.innerHeight / 1440);
        const left = (window.innerWidth - 2560 * scale) / 2;
        const top = (window.innerHeight - 1440 * scale) / 2;
        const transform = \`translate(\${left}px,\${top}px) scale(\${scale})\`;
        if (root) root.style.transform = transform;
        if (landing) landing.style.transform = transform;
      };
      let entered = false;
      const enteredPromise = new Promise((resolve) => {
        enter?.addEventListener("click", () => {
          if (entered) return;
          entered = true;
          landing?.classList.add("is-leaving");
          setTimeout(() => landing?.remove(), 700);
          resolve();
        });
      });
      Promise.all([window.__GAL_BLOG_ENGINE_RENDERED__, enteredPromise]).then(() => {
        const target = document.querySelector(".title__enter-game-target");
        target?.dispatchEvent(new MouseEvent("click", { view: window, bubbles: true, cancelable: true }));
      });
      resize();
      window.addEventListener("resize", resize);
    })();
  </script>
  <script type="module">
    const engineUrl = ${JSON.stringify(engineUrl).replace(/</g, "\\u003c")};
    const status = document.getElementById("galblog-engine-status");
    try {
      if (!engineUrl) throw new Error("No sharedEngineUrl configured. Copy the official WebGAL dist into this package.");
      const engineModule = await import(engineUrl);
      const core = engineModule.W || engineModule.WebGAL || window.WebGAL || window.__WEBGAL__;
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

export function compileProject(project: StoryProject): CompileResult {
  const diagnostics = validateProject(project);
  const sceneScripts: Record<string, string> = {};
  project.scenes.forEach((scene) => {
    sceneScripts[scene.id] = compileScene(project, scene).script;
  });
  const files = [
    { path: "index.html", content: compileIndex(project), contentType: "text/html; charset=utf-8" },
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
