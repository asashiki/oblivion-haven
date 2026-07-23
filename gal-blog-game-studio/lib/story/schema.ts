import { z } from "zod";

import type { StoryDiagnostic, StoryProject } from "./types";

const Id = z.string().min(1);
const Base = z.object({
  id: Id,
  label: z.string().optional(),
  notes: z.string().optional(),
  disabled: z.boolean().optional(),
  source: z.enum(["human", "ai", "import", "native"]).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const Block = z.discriminatedUnion("type", [
  Base.extend({ type: z.literal("dialogue"), characterId: Id, text: z.string(), expressionId: Id.optional(), voiceAssetId: Id.optional() }).passthrough(),
  Base.extend({ type: z.literal("narration"), text: z.string(), mode: z.enum(["adv", "nvl"]).optional() }).passthrough(),
  Base.extend({ type: z.literal("stage"), action: z.string() }).passthrough(),
  Base.extend({ type: z.literal("choice"), options: z.array(z.object({ id: Id, label: z.string() }).passthrough()) }).passthrough(),
  Base.extend({ type: z.literal("input"), variableId: Id, title: z.string(), allowFreeText: z.boolean(), targets: z.array(z.enum(["story", "blog", "ai"])) }).passthrough(),
  Base.extend({ type: z.literal("condition"), branches: z.array(z.object({ id: Id, targetSceneId: Id }).passthrough()) }).passthrough(),
  Base.extend({ type: z.literal("variable"), operations: z.array(z.object({ variableId: Id, operation: z.string() }).passthrough()) }).passthrough(),
  Base.extend({ type: z.literal("jump") }).passthrough(),
  Base.extend({ type: z.literal("mode"), mode: z.enum(["adv", "nvl"]) }).passthrough(),
  Base.extend({ type: z.literal("save-point"), savePointId: Id }).passthrough(),
  Base.extend({ type: z.literal("blog-action"), action: z.string() }).passthrough(),
  Base.extend({ type: z.literal("ai-turn"), characterIds: z.array(Id) }).passthrough(),
  Base.extend({ type: z.literal("native"), engine: z.literal("webgal"), script: z.string() }).passthrough(),
  Base.extend({ type: z.literal("comment"), text: z.string() }).passthrough(),
]);

export const StoryProjectSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: Id,
  title: z.string().min(1),
  slug: z.string().min(1),
  version: z.string().min(1),
  locale: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.object({
    startSceneId: Id,
    defaultMode: z.enum(["adv", "nvl"]),
    webgalVersion: z.string(),
    sharedEngineUrl: z.string().optional(),
    sharedEngineCssUrl: z.string().optional(),
    terreBaseUrl: z.string().optional(),
    blogBridge: z.object({
      enabled: z.boolean(),
      allowedOrigins: z.array(z.string()),
      channel: z.string(),
      timeoutMs: z.number(),
      capabilities: z.array(z.string()),
    }),
  }),
  chapters: z.array(z.object({ id: Id, name: z.string(), order: z.number(), sceneIds: z.array(Id) }).passthrough()),
  scenes: z.array(z.object({
    id: Id,
    chapterId: Id,
    name: z.string(),
    slug: z.string(),
    mode: z.enum(["adv", "nvl"]),
    tags: z.array(z.string()),
    blocks: z.array(Block),
  }).passthrough()),
  characters: z.array(z.object({
    id: Id,
    name: z.string(),
    displayName: z.string(),
    aliases: z.array(z.string()),
    color: z.string(),
    expressions: z.array(z.object({ id: Id, name: z.string(), assetId: Id, aliases: z.array(z.string()) }).passthrough()),
  }).passthrough()),
  assets: z.array(z.object({ id: Id, kind: z.string(), name: z.string(), path: z.string(), aliases: z.array(z.string()) }).passthrough()),
  variables: z.array(z.object({ id: Id, name: z.string(), type: z.string(), defaultValue: z.union([z.string(), z.number(), z.boolean()]), scope: z.string() }).passthrough()),
  routeMap: z.object({
    layoutDirection: z.enum(["top-down", "left-right"]).optional(),
    nodes: z.array(z.object({ id: Id, kind: z.string(), title: z.string(), x: z.number(), y: z.number() }).passthrough()),
    edges: z.array(z.object({ id: Id, source: Id, target: Id }).passthrough()),
  }),
  endings: z.array(z.object({ id: Id, name: z.string(), kind: z.string(), routeNodeId: Id, sceneId: Id }).passthrough()),
  savePoints: z.array(z.object({ id: Id, name: z.string(), sceneId: Id }).passthrough()),
  aiConfigs: z.array(z.object({ id: Id, name: z.string(), mode: z.string(), allowedTools: z.array(z.string()), requireValidation: z.boolean(), saveGeneratedOperations: z.boolean() }).passthrough()),
}).passthrough();

export function parseStoryProject(input: unknown): StoryProject {
  return StoryProjectSchema.parse(input) as StoryProject;
}

export function validateProject(project: StoryProject): StoryDiagnostic[] {
  const diagnostics: StoryDiagnostic[] = [];
  const schema = StoryProjectSchema.safeParse(project);
  if (!schema.success) {
    schema.error.issues.forEach((issue, index) => diagnostics.push({
      id: `schema-${index}`,
      severity: "error",
      code: "SCHEMA_INVALID",
      message: issue.message,
      path: issue.path.join("."),
    }));
    return diagnostics;
  }

  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  const characterIds = new Set(project.characters.map((character) => character.id));
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  const variableIds = new Set(project.variables.map((variable) => variable.id));
  const savePointIds = new Set(project.savePoints.map((point) => point.id));
  const routeNodeIds = new Set(project.routeMap.nodes.map((node) => node.id));
  const aiConfigIds = new Set(project.aiConfigs.map((config) => config.id));
  const expressionOwner = new Map(
    project.characters.flatMap((character) => character.expressions.map((expression) => [expression.id, character.id] as const)),
  );
  const addReferenceError = (id: string, code: string, message: string, sceneId?: string, blockId?: string) => {
    diagnostics.push({ id, severity: "error", code, message, sceneId, blockId });
  };

  const allIds = [
    ...project.chapters.map((item) => item.id),
    ...project.scenes.map((item) => item.id),
    ...project.scenes.flatMap((scene) => scene.blocks.map((block) => block.id)),
    ...project.characters.map((item) => item.id),
    ...project.characters.flatMap((character) => character.expressions.map((expression) => expression.id)),
    ...project.assets.map((item) => item.id),
    ...project.variables.map((item) => item.id),
    ...project.routeMap.nodes.map((item) => item.id),
    ...project.routeMap.edges.map((item) => item.id),
    ...project.endings.map((item) => item.id),
    ...project.savePoints.map((item) => item.id),
    ...project.aiConfigs.map((item) => item.id),
  ];
  const seenIds = new Set<string>();
  const duplicatedIds = new Set<string>();
  allIds.forEach((id) => {
    if (seenIds.has(id)) duplicatedIds.add(id);
    else seenIds.add(id);
  });
  duplicatedIds.forEach((id) => addReferenceError(`duplicate-${id}`, "ID_DUPLICATED", `ID「${id}」在项目中重复，编译和局部 patch 可能指向错误对象。`));

  if (!sceneIds.has(project.settings.startSceneId)) {
    diagnostics.push({ id: "start-scene", severity: "error", code: "START_SCENE_MISSING", message: "项目入口场景不存在。" });
  }

  project.assets.forEach((asset) => {
    if (!asset.path || asset.missing) {
      diagnostics.push({
        id: `asset-${asset.id}`,
        severity: "error",
        code: "ASSET_MISSING",
        message: `资源「${asset.name}」没有可用文件。`,
        assetId: asset.id,
      });
    }
  });

  project.characters.forEach((character) => {
    if (character.defaultExpressionId && !character.expressions.some((expression) => expression.id === character.defaultExpressionId)) {
      addReferenceError(`default-expression-${character.id}`, "DEFAULT_EXPRESSION_MISSING", `${character.displayName} 的默认表情不存在。`);
    }
    character.expressions.forEach((expression) => {
      if (!assetIds.has(expression.assetId)) {
        diagnostics.push({
          id: `expression-${expression.id}`,
          severity: "error",
          code: "EXPRESSION_ASSET_MISSING",
          message: `${character.displayName} 的表情「${expression.name}」引用了不存在的资源。`,
        });
      }
    });
  });

  project.scenes.forEach((scene) => {
    scene.blocks.forEach((block) => {
      if (block.disabled) return;
      if (block.type === "dialogue" && !characterIds.has(block.characterId)) {
        diagnostics.push({ id: `character-${block.id}`, severity: "error", code: "CHARACTER_MISSING", message: "对话引用了不存在的角色。", sceneId: scene.id, blockId: block.id });
      }
      if (block.type === "dialogue" && block.voiceAssetId && !assetIds.has(block.voiceAssetId)) {
        diagnostics.push({ id: `voice-${block.id}`, severity: "warning", code: "VOICE_MISSING", message: "语音资源不存在，将以无语音方式编译。", sceneId: scene.id, blockId: block.id });
      }
      if (block.type === "dialogue" && block.expressionId && expressionOwner.get(block.expressionId) !== block.characterId) {
        addReferenceError(`dialogue-expression-${block.id}`, "EXPRESSION_MISSING", "对白表情不存在，或不属于当前角色。", scene.id, block.id);
      }
      if (block.type === "stage" && block.assetId && !assetIds.has(block.assetId)) {
        diagnostics.push({ id: `stage-asset-${block.id}`, severity: "error", code: "ASSET_REFERENCE_MISSING", message: "舞台指令引用了不存在的资源。", sceneId: scene.id, blockId: block.id });
      }
      if (block.type === "stage" && block.characterId && !characterIds.has(block.characterId)) {
        addReferenceError(`stage-character-${block.id}`, "CHARACTER_MISSING", "舞台指令引用了不存在的角色。", scene.id, block.id);
      }
      if (block.type === "stage" && block.expressionId && expressionOwner.get(block.expressionId) !== block.characterId) {
        addReferenceError(`stage-expression-${block.id}`, "EXPRESSION_MISSING", "舞台表情不存在，或不属于当前角色。", scene.id, block.id);
      }
      if (block.type === "input" && !variableIds.has(block.variableId)) {
        diagnostics.push({ id: `input-var-${block.id}`, severity: "error", code: "VARIABLE_MISSING", message: "自由输入没有可写入的变量。", sceneId: scene.id, blockId: block.id });
      }
      if (block.type === "input" && !block.targets.length) {
        diagnostics.push({ id: `input-target-${block.id}`, severity: "warning", code: "INPUT_TARGET_EMPTY", message: "自由输入没有传递目标，只会写入变量。", sceneId: scene.id, blockId: block.id });
      }
      if (block.type === "save-point" && !savePointIds.has(block.savePointId)) {
        diagnostics.push({ id: `save-${block.id}`, severity: "warning", code: "SAVE_POINT_MISSING", message: "存档点定义不存在。", sceneId: scene.id, blockId: block.id });
      }
      if (block.type === "choice") {
        block.options.forEach((option) => {
          if (option.targetSceneId && !sceneIds.has(option.targetSceneId)) {
            diagnostics.push({ id: `choice-${option.id}`, severity: "error", code: "CHOICE_TARGET_MISSING", message: `选项「${option.label}」的目标场景不存在。`, sceneId: scene.id, blockId: block.id });
          }
          if (option.targetRouteNodeId && !routeNodeIds.has(option.targetRouteNodeId)) {
            addReferenceError(`choice-route-${option.id}`, "CHOICE_ROUTE_MISSING", `选项「${option.label}」的路线节点不存在。`, scene.id, block.id);
          }
          (option.operations || []).forEach((operation, index) => {
            if (!variableIds.has(operation.variableId)) addReferenceError(`choice-var-${option.id}-${index}`, "VARIABLE_MISSING", `选项「${option.label}」修改了不存在的变量。`, scene.id, block.id);
          });
        });
      }
      if (block.type === "condition") {
        block.branches.forEach((branch) => {
          if (!sceneIds.has(branch.targetSceneId)) addReferenceError(`condition-${block.id}-${branch.id}`, "CONDITION_TARGET_MISSING", "条件分支的目标场景不存在。", scene.id, block.id);
        });
      }
      if (block.type === "variable") {
        block.operations.forEach((operation, index) => {
          if (!variableIds.has(operation.variableId)) addReferenceError(`variable-${block.id}-${index}`, "VARIABLE_MISSING", "变量操作引用了不存在的变量。", scene.id, block.id);
        });
      }
      if (block.type === "jump") {
        if (block.targetSceneId && !sceneIds.has(block.targetSceneId)) addReferenceError(`jump-${block.id}`, "JUMP_TARGET_MISSING", "跳转目标场景不存在。", scene.id, block.id);
        if (block.targetRouteNodeId && !routeNodeIds.has(block.targetRouteNodeId)) addReferenceError(`jump-route-${block.id}`, "JUMP_ROUTE_MISSING", "跳转目标路线节点不存在。", scene.id, block.id);
        if (!block.targetSceneId && !block.targetRouteNodeId) addReferenceError(`jump-empty-${block.id}`, "JUMP_TARGET_EMPTY", "跳转块没有设置目标。", scene.id, block.id);
      }
      if (block.type === "blog-action") {
        if (block.resultVariableId && !variableIds.has(block.resultVariableId)) addReferenceError(`blog-var-${block.id}`, "VARIABLE_MISSING", "Blog 动作的结果变量不存在。", scene.id, block.id);
        const actionName = block.action === "custom" ? "custom" : block.action;
        if (project.settings.blogBridge.enabled && actionName !== "custom" && !project.settings.blogBridge.capabilities.includes(actionName)) {
          diagnostics.push({ id: `blog-capability-${block.id}`, severity: "warning", code: "BLOG_CAPABILITY_MISSING", message: `Blog Bridge 未声明动作能力「${actionName}」，运行时会返回 failure。`, sceneId: scene.id, blockId: block.id });
        }
        Object.values(block.resultBranches || {}).filter(Boolean).forEach((target, index) => {
          if (!sceneIds.has(target!)) addReferenceError(`blog-branch-${block.id}-${index}`, "BLOG_BRANCH_MISSING", "Blog 动作的结果分支场景不存在。", scene.id, block.id);
        });
      }
      if (block.type === "ai-turn") {
        block.characterIds.forEach((characterId, index) => {
          if (!characterIds.has(characterId)) addReferenceError(`ai-character-${block.id}-${index}`, "CHARACTER_MISSING", "实时 AI 块引用了不存在的角色。", scene.id, block.id);
        });
        if (block.configId && !aiConfigIds.has(block.configId)) addReferenceError(`ai-config-${block.id}`, "AI_CONFIG_MISSING", "实时 AI 块引用了不存在的运行配置。", scene.id, block.id);
        if (block.fallbackSceneId && !sceneIds.has(block.fallbackSceneId)) addReferenceError(`ai-fallback-${block.id}`, "AI_FALLBACK_MISSING", "实时 AI fallback 场景不存在。", scene.id, block.id);
      }
    });
  });

  project.chapters.forEach((chapter) => chapter.sceneIds.forEach((sceneId) => {
    if (!sceneIds.has(sceneId)) addReferenceError(`chapter-scene-${chapter.id}-${sceneId}`, "CHAPTER_SCENE_MISSING", `章节「${chapter.name}」引用了不存在的场景。`);
  }));

  project.routeMap.nodes.forEach((node) => {
    if (node.sceneId && !sceneIds.has(node.sceneId)) addReferenceError(`route-scene-${node.id}`, "ROUTE_SCENE_MISSING", `路线节点「${node.title}」绑定的场景不存在。`);
    if (node.characterId && !characterIds.has(node.characterId)) addReferenceError(`route-character-${node.id}`, "ROUTE_CHARACTER_MISSING", `路线节点「${node.title}」绑定的角色不存在。`);
    if (node.readVariableId && !variableIds.has(node.readVariableId)) addReferenceError(`route-variable-${node.id}`, "ROUTE_VARIABLE_MISSING", `路线节点「${node.title}」的已读变量不存在。`);
  });
  project.routeMap.edges.forEach((edge) => {
    if (!routeNodeIds.has(edge.source) || !routeNodeIds.has(edge.target)) {
      diagnostics.push({ id: `edge-${edge.id}`, severity: "error", code: "ROUTE_EDGE_DANGLING", message: "路线图中存在悬空连线。" });
    }
  });

  project.endings.forEach((ending) => {
    if (!routeNodeIds.has(ending.routeNodeId)) addReferenceError(`ending-route-${ending.id}`, "ENDING_ROUTE_MISSING", `结局「${ending.name}」的路线节点不存在。`);
    if (!sceneIds.has(ending.sceneId)) addReferenceError(`ending-scene-${ending.id}`, "ENDING_SCENE_MISSING", `结局「${ending.name}」的场景不存在。`);
  });

  project.savePoints.forEach((point) => {
    const scene = project.scenes.find((item) => item.id === point.sceneId);
    if (!scene) addReferenceError(`save-scene-${point.id}`, "SAVE_SCENE_MISSING", `存档点「${point.name}」的场景不存在。`);
    if (point.blockId && scene && !scene.blocks.some((block) => block.id === point.blockId)) addReferenceError(`save-block-${point.id}`, "SAVE_BLOCK_MISSING", `存档点「${point.name}」的剧情块不存在。`);
    if (point.thumbnailAssetId && !assetIds.has(point.thumbnailAssetId)) addReferenceError(`save-thumbnail-${point.id}`, "SAVE_THUMBNAIL_MISSING", `存档点「${point.name}」的缩略图资源不存在。`);
  });

  if (!diagnostics.length) {
    diagnostics.push({ id: "project-ok", severity: "info", code: "PROJECT_VALID", message: "Story IR 结构、引用与路线连线均通过检查。" });
  }
  return diagnostics;
}
