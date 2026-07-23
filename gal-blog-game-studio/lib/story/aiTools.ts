import { compileProject, compileScene } from "./compiler";
import { AI_TOOL_CATALOG, applyPatches } from "./patch";
import { routeDisplayPosition, routeStoredPosition } from "./routeLayout";
import { validateProject } from "./schema";
import type {
  ChoiceOption,
  StagePosition,
  StoryBlock,
  StoryPatch,
  StoryProject,
  StoryScene,
  VariableOperation,
} from "./types";
import { createId, slugify } from "./utils";

export type AiToolCall = {
  name: (typeof AI_TOOL_CATALOG)[number]["name"];
  arguments?: Record<string, unknown>;
};

export type AiToolResult = {
  ok: true;
  tool: string;
  project: StoryProject;
  operations: StoryPatch[];
  inverse: StoryPatch[];
  data?: unknown;
};

function textArg(args: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = args[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new Error(`AI 工具缺少字符串参数：${key}`);
  return undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`AI 工具参数 ${key} 必须是数字`);
  return number;
}

function sceneIndex(project: StoryProject, sceneId: string): number {
  const index = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) throw new Error(`场景不存在：${sceneId}`);
  return index;
}

function blockIndex(project: StoryProject, sceneId: string, blockId: string): { scene: number; block: number } {
  const scene = sceneIndex(project, sceneId);
  const block = project.scenes[scene].blocks.findIndex((item) => item.id === blockId);
  if (block < 0) throw new Error(`剧情块不存在：${blockId}`);
  return { scene, block };
}

function insertionIndex(args: Record<string, unknown>, fallback: number): number {
  return Math.max(0, Math.min(numberArg(args, "index") ?? fallback, fallback));
}

function insertBlock(project: StoryProject, sceneId: string, block: StoryBlock, requestedIndex?: number): StoryPatch[] {
  const scene = sceneIndex(project, sceneId);
  const length = project.scenes[scene].blocks.length;
  const index = Math.max(0, Math.min(requestedIndex ?? length, length));
  return [{ op: "insert", path: `/scenes/${scene}/blocks`, index, value: block }];
}

function executeMutation(project: StoryProject, call: AiToolCall): StoryPatch[] {
  const args = call.arguments || {};
  const sceneId = textArg(args, "sceneId", false);

  switch (call.name) {
    case "create_scene": {
      const chapterId = textArg(args, "chapterId")!;
      const chapter = project.chapters.findIndex((item) => item.id === chapterId);
      if (chapter < 0) throw new Error(`章节不存在：${chapterId}`);
      const name = textArg(args, "name")!;
      const id = createId("scene");
      const mode = args.mode === "nvl" ? "nvl" : "adv";
      const scene: StoryScene = {
        id,
        chapterId,
        name,
        slug: slugify(name),
        mode,
        tags: [],
        blocks: [],
        aiContext: "此场景由 AI 工具创建；请在编辑器中继续补充角色目标与演出约束。",
      };
      const afterSceneId = textArg(args, "afterSceneId", false);
      const sceneInsert = afterSceneId ? sceneIndex(project, afterSceneId) + 1 : project.scenes.length;
      const chapterInsert = afterSceneId
        ? Math.max(0, project.chapters[chapter].sceneIds.indexOf(afterSceneId) + 1)
        : project.chapters[chapter].sceneIds.length;
      return [
        { op: "insert", path: "/scenes", index: sceneInsert, value: scene },
        { op: "insert", path: `/chapters/${chapter}/sceneIds`, index: chapterInsert, value: id },
        {
          op: "insert",
          path: "/routeMap/nodes",
          value: {
            id: createId("route"),
            kind: "scene",
            title: name,
            sceneId: id,
            x: 460,
            y: 180 + project.routeMap.nodes.length * 36,
            replayable: true,
          },
        },
      ];
    }
    case "modify_scene": {
      const target = sceneIndex(project, sceneId!);
      const patch = args.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("modify_scene.patch 必须是对象");
      const allowed = new Set(["name", "slug", "mode", "tags", "summary", "entryStage", "aiContext"]);
      return Object.entries(patch as Record<string, unknown>)
        .filter(([key]) => allowed.has(key))
        .map(([key, value]) => ({ op: "set", path: `/scenes/${target}/${key}`, value }) as StoryPatch);
    }
    case "add_dialogue": {
      const target = sceneIndex(project, sceneId!);
      const block: StoryBlock = {
        id: createId("dialogue"),
        type: "dialogue",
        characterId: textArg(args, "characterId")!,
        text: textArg(args, "text")!,
        expressionId: textArg(args, "expressionId", false),
        position: textArg(args, "position", false) as StagePosition | undefined,
        source: "ai",
      };
      return insertBlock(project, sceneId!, block, insertionIndex(args, project.scenes[target].blocks.length));
    }
    case "modify_line": {
      const target = blockIndex(project, sceneId!, textArg(args, "blockId")!);
      const block = project.scenes[target.scene].blocks[target.block];
      if (block.type !== "dialogue" && block.type !== "narration") throw new Error("modify_line 只能修改对白或旁白块");
      return [{ op: "set", path: `/scenes/${target.scene}/blocks/${target.block}/text`, value: textArg(args, "text")! }];
    }
    case "set_expression": {
      const target = blockIndex(project, sceneId!, textArg(args, "blockId")!);
      return [{ op: "set", path: `/scenes/${target.scene}/blocks/${target.block}/expressionId`, value: textArg(args, "expressionId")! }];
    }
    case "set_figure_position": {
      const target = blockIndex(project, sceneId!, textArg(args, "blockId")!);
      const operations: StoryPatch[] = [{
        op: "set",
        path: `/scenes/${target.scene}/blocks/${target.block}/position`,
        value: textArg(args, "position")!,
      }];
      if (args.transform && typeof args.transform === "object") {
        operations.push({ op: "set", path: `/scenes/${target.scene}/blocks/${target.block}/transform`, value: args.transform });
      }
      return operations;
    }
    case "set_background":
    case "set_bgm": {
      const target = sceneIndex(project, sceneId!);
      const block: StoryBlock = {
        id: createId("stage"),
        type: "stage",
        action: call.name === "set_background" ? "set-background" : "play-bgm",
        assetId: textArg(args, "assetId")!,
        transition: call.name === "set_background" ? { name: "enter", durationMs: 500 } : undefined,
        source: "ai",
      };
      return insertBlock(project, sceneId!, block, insertionIndex(args, project.scenes[target].blocks.length));
    }
    case "add_choice": {
      const target = sceneIndex(project, sceneId!);
      if (!Array.isArray(args.options)) throw new Error("add_choice.options 必须是数组");
      const options = (args.options as Array<Record<string, unknown>>).map((option) => ({
        id: typeof option.id === "string" ? option.id : createId("option"),
        label: String(option.label || "未命名选项"),
        targetSceneId: typeof option.targetSceneId === "string" ? option.targetSceneId : undefined,
        targetRouteNodeId: typeof option.targetRouteNodeId === "string" ? option.targetRouteNodeId : undefined,
        condition: typeof option.condition === "string" ? option.condition : undefined,
        enabledCondition: typeof option.enabledCondition === "string" ? option.enabledCondition : undefined,
        operations: Array.isArray(option.operations) ? option.operations as VariableOperation[] : undefined,
      })) satisfies ChoiceOption[];
      return insertBlock(project, sceneId!, {
        id: createId("choice"),
        type: "choice",
        prompt: textArg(args, "prompt", false),
        options,
        source: "ai",
      }, insertionIndex(args, project.scenes[target].blocks.length));
    }
    case "add_free_input": {
      const target = sceneIndex(project, sceneId!);
      const rawTargets = Array.isArray(args.targets) ? args.targets : ["story", "ai"];
      const targets = rawTargets.filter((item): item is "story" | "blog" | "ai" => item === "story" || item === "blog" || item === "ai");
      return insertBlock(project, sceneId!, {
        id: createId("input"),
        type: "input",
        variableId: textArg(args, "variableId")!,
        title: textArg(args, "title", false) || "你想说什么？",
        buttonText: "确认",
        allowFreeText: true,
        targets,
        source: "ai",
      }, insertionIndex(args, project.scenes[target].blocks.length));
    }
    case "connect_branch":
      return [{
        op: "insert",
        path: "/routeMap/edges",
        value: {
          id: createId("edge"),
          sourceNodeId: textArg(args, "sourceNodeId")!,
          targetNodeId: textArg(args, "targetNodeId")!,
          condition: textArg(args, "condition", false),
        },
      }];
    case "set_variable": {
      const target = sceneIndex(project, sceneId!);
      const operation = String(args.operation || "set");
      if (!["set", "add", "subtract", "toggle"].includes(operation)) throw new Error(`不支持的变量操作：${operation}`);
      return insertBlock(project, sceneId!, {
        id: createId("variable"),
        type: "variable",
        operations: [{
          variableId: textArg(args, "variableId")!,
          operation: operation as VariableOperation["operation"],
          value: args.value as boolean | number | string | undefined,
          expression: textArg(args, "expression", false),
        }],
        source: "ai",
      }, insertionIndex(args, project.scenes[target].blocks.length));
    }
    case "create_route_node": {
      const position = args.position && typeof args.position === "object" ? args.position as Record<string, unknown> : {};
      const deepestY = Math.max(40, ...project.routeMap.nodes.map((node) => routeDisplayPosition(node, project.routeMap.layoutDirection).y));
      const storedPosition = routeStoredPosition({
        x: typeof position.x === "number" ? position.x : 360,
        y: typeof position.y === "number" ? position.y : deepestY + 142,
      }, project.routeMap.layoutDirection);
      return [{
        op: "insert",
        path: "/routeMap/nodes",
        value: {
          id: createId("route"),
          kind: textArg(args, "kind")!,
          title: textArg(args, "title")!,
          sceneId: textArg(args, "sceneId", false),
          ...storedPosition,
          replayable: true,
        },
      }];
    }
    case "validate_project":
    case "compile_scene":
    case "start_preview":
    case "export_web_game":
      return [];
  }
}

export function executeAiTool(project: StoryProject, call: AiToolCall): AiToolResult {
  if (!AI_TOOL_CATALOG.some((tool) => tool.name === call.name)) throw new Error(`未知 AI 工具：${call.name}`);
  const operations = executeMutation(project, call);
  const applied = operations.length ? applyPatches(project, operations) : { project, inverse: [] as StoryPatch[] };
  const args = call.arguments || {};
  let data: unknown;

  if (call.name === "validate_project") data = { diagnostics: validateProject(applied.project) };
  if (call.name === "compile_scene") {
    const sceneId = textArg(args, "sceneId")!;
    const scene = applied.project.scenes.find((item) => item.id === sceneId);
    if (!scene) throw new Error(`场景不存在：${sceneId}`);
    data = compileScene(applied.project, scene);
  }
  if (call.name === "start_preview") {
    data = { sceneId: textArg(args, "sceneId")!, blockId: textArg(args, "blockId", false) };
  }
  if (call.name === "export_web_game") {
    const engineUrl = textArg(args, "engineUrl", false);
    const engineCssUrl = textArg(args, "engineCssUrl", false);
    const target = engineUrl || engineCssUrl
      ? {
          ...applied.project,
          settings: {
            ...applied.project.settings,
            ...(engineUrl ? { sharedEngineUrl: engineUrl } : {}),
            ...(engineCssUrl ? { sharedEngineCssUrl: engineCssUrl } : {}),
          },
        }
      : applied.project;
    data = compileProject(target);
  }

  return {
    ok: true,
    tool: call.name,
    project: applied.project,
    operations,
    inverse: applied.inverse,
    data,
  };
}
