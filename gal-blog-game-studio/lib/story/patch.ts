import type { OperationRecord, StoryPatch, StoryProject } from "./types";
import { createId, deepClone, nowIso } from "./utils";

function pathParts(path: string): string[] {
  return path.replace(/^\//, "").split("/").filter(Boolean).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function getAtPath(root: unknown, path: string): unknown {
  return pathParts(path).reduce<unknown>((value, key) => {
    if (Array.isArray(value)) return value[Number(key)];
    if (value && typeof value === "object") return (value as Record<string, unknown>)[key];
    return undefined;
  }, root);
}

function getContainer(root: unknown, path: string): { container: unknown; key: string } {
  const parts = pathParts(path);
  const key = parts.pop();
  if (!key) throw new Error(`无效 patch 路径：${path}`);
  const container = parts.reduce<unknown>((value, part) => {
    if (Array.isArray(value)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= value.length) throw new Error(`patch 数组索引越界：${path}`);
      return value[index];
    }
    if (value && typeof value === "object") return (value as Record<string, unknown>)[part];
    throw new Error(`patch 路径不存在：${path}`);
  }, root);
  return { container, key };
}

function writeAtPath(root: unknown, path: string, value: unknown): void {
  const { container, key } = getContainer(root, path);
  if (Array.isArray(container)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= container.length) throw new Error(`patch 数组索引越界：${path}`);
    container[index] = value;
  }
  else if (container && typeof container === "object") (container as Record<string, unknown>)[key] = value;
  else throw new Error(`patch 目标不是容器：${path}`);
}

function removeAtPath(root: unknown, path: string): unknown {
  const { container, key } = getContainer(root, path);
  if (Array.isArray(container)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= container.length) throw new Error(`patch 数组索引越界：${path}`);
    return container.splice(index, 1)[0];
  }
  if (container && typeof container === "object") {
    const record = container as Record<string, unknown>;
    const previous = record[key];
    delete record[key];
    return previous;
  }
  throw new Error(`patch 目标不是容器：${path}`);
}

export function applyPatches(project: StoryProject, operations: StoryPatch[]): { project: StoryProject; inverse: StoryPatch[] } {
  const next = deepClone(project);
  const inverse: StoryPatch[] = [];

  operations.forEach((operation) => {
    if (operation.op === "test") {
      const actual = getAtPath(next, operation.path);
      if (JSON.stringify(actual) !== JSON.stringify(operation.value)) throw new Error(`patch test 失败：${operation.path}`);
      return;
    }
    if (operation.op === "set") {
      const previous = deepClone(getAtPath(next, operation.path));
      writeAtPath(next, operation.path, deepClone(operation.value));
      inverse.unshift({ op: "set", path: operation.path, value: previous });
      return;
    }
    if (operation.op === "insert") {
      const target = getAtPath(next, operation.path);
      if (!Array.isArray(target)) throw new Error(`insert 目标不是数组：${operation.path}`);
      const index = operation.index ?? target.length;
      if (!Number.isInteger(index) || index < 0 || index > target.length) throw new Error(`insert 数组索引越界：${operation.path}[${index}]`);
      target.splice(index, 0, deepClone(operation.value));
      inverse.unshift({ op: "remove", path: operation.path, index });
      return;
    }
    if (operation.op === "remove") {
      if (typeof operation.index === "number") {
        const target = getAtPath(next, operation.path);
        if (!Array.isArray(target)) throw new Error(`remove 目标不是数组：${operation.path}`);
        if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index >= target.length) throw new Error(`remove 数组索引越界：${operation.path}[${operation.index}]`);
        const previous = target.splice(operation.index, 1)[0];
        inverse.unshift({ op: "insert", path: operation.path, index: operation.index, value: previous });
      } else {
        const previous = removeAtPath(next, operation.path);
        inverse.unshift({ op: "set", path: operation.path, value: previous });
      }
      return;
    }
    if (operation.op === "move") {
      const source = getContainer(next, operation.from);
      if (!Array.isArray(source.container) || !Number.isInteger(Number(source.key))) {
        throw new Error(`move 来源必须是数组元素：${operation.from}`);
      }
      const originalIndex = Number(source.key);
      const value = removeAtPath(next, operation.from);
      const target = getAtPath(next, operation.path);
      if (!Array.isArray(target)) throw new Error(`move 目标不是数组：${operation.path}`);
      const index = operation.index ?? target.length;
      if (!Number.isInteger(index) || index < 0 || index > target.length) throw new Error(`move 数组索引越界：${operation.path}[${index}]`);
      target.splice(index, 0, value);
      inverse.unshift({ op: "move", from: `${operation.path}/${index}`, path: operation.from.replace(/\/[^/]+$/, ""), index: originalIndex });
    }
  });

  next.updatedAt = nowIso();
  return { project: next, inverse };
}

export function makeOperationRecord(
  label: string,
  actor: OperationRecord["actor"],
  operations: StoryPatch[],
  inverse: StoryPatch[],
): OperationRecord {
  return { id: createId("op"), label, actor, timestamp: nowIso(), operations, inverse };
}

export const AI_TOOL_CATALOG = [
  { name: "create_scene", description: "创建场景并将其挂到章节与路线图。", args: ["chapterId", "name", "mode", "afterSceneId?"] },
  { name: "modify_scene", description: "以 patch 修改场景元数据或入口舞台。", args: ["sceneId", "patch"] },
  { name: "add_dialogue", description: "在指定位置插入角色对白，可指定站位与入场演出。", args: ["sceneId", "characterId", "text", "expressionId?", "position?", "enter?", "index?"] },
  { name: "modify_line", description: "只修改一条既有台词，保留块 ID。", args: ["sceneId", "blockId", "text"] },
  { name: "set_expression", description: "设置对白或舞台角色表情。", args: ["sceneId", "blockId", "expressionId"] },
  { name: "set_figure_position", description: "设置立绘位置与 transform。", args: ["sceneId", "blockId", "position", "transform?"] },
  { name: "plan_staging", description: "为现有剧情块提交语义演出计划；系统负责密度、连续性、时机和安全预设校验。", args: ["sceneId", "enabled?", "cues"] },
  { name: "enter_character", description: "[高级手工] 直接写入底层 WebGAL 入场参数。普通 AI 应使用 plan_staging。", args: ["sceneId", "characterId", "expressionId?", "position?", "transform?", "transition?", "index?"], advanced: true },
  { name: "exit_character", description: "让指定角色离场并释放舞台状态。", args: ["sceneId", "characterId", "transition?", "durationMs?", "index?"] },
  { name: "move_character", description: "[高级手工] 直接写入 setTransform。普通 AI 不应调用。", args: ["sceneId", "characterId", "transform", "durationMs?", "easing?", "index?"], advanced: true },
  { name: "set_background", description: "插入或更新背景舞台操作。", args: ["sceneId", "assetId", "index?"] },
  { name: "set_bgm", description: "插入或更新 BGM 舞台操作。", args: ["sceneId", "assetId", "index?"] },
  { name: "stop_bgm", description: "停止 BGM，可设置淡出时长。", args: ["sceneId", "durationMs?", "index?"] },
  { name: "play_sfx", description: "播放已上传的音效资源。", args: ["sceneId", "assetId", "volume?", "index?"] },
  { name: "play_video", description: "播放已上传的视频资源。", args: ["sceneId", "assetId", "index?"] },
  { name: "set_stage_animation", description: "[高级手工] 直接应用底层动画预设。普通 AI 不应调用。", args: ["sceneId", "target", "animation", "index?"], advanced: true },
  { name: "wait", description: "[高级手工] 插入底层 wait。语义演出不应猜测随机毫秒数。", args: ["sceneId", "durationMs", "index?"], advanced: true },
  { name: "set_text_mode", description: "切换 ADV/NVL 文本模式。", args: ["sceneId", "mode", "index?"] },
  { name: "set_voice", description: "把已生成或上传的语音资源绑定到指定对白。", args: ["sceneId", "blockId", "voiceAssetId"] },
  { name: "generate_tts", description: "请求已配置的 TTS Provider 生成语音；生成后作为 voice 资源回写对白。", args: ["sceneId", "blockId", "voice?", "model?"] },
  { name: "add_choice", description: "在片段任意位置添加带唯一名称的选项组；选项可继续、结束片段、跳到任意选项组并写入一次性记录。", args: ["sceneId", "groupName?", "groupCode?", "prompt?", "options", "index?"] },
  { name: "add_free_input", description: "添加自由输入并指定 story/blog/ai 去向。", args: ["sceneId", "variableId", "targets", "index?"] },
  { name: "connect_branch", description: "连接片段结束后的外层主干；不会向片段内部偷偷插入跳转块。", args: ["sourceNodeId", "targetNodeId", "label?", "condition?"] },
  { name: "set_variable", description: "插入变量操作。", args: ["sceneId", "variableId", "operation", "value", "index?"] },
  { name: "create_route_node", description: "创建作者/玩家路线图节点。", args: ["kind", "title", "sceneId?", "position"] },
  { name: "validate_project", description: "运行 Story IR 与资源引用校验。", args: [] },
  { name: "compile_scene", description: "将单场景稳定编译为 WebGAL 脚本。", args: ["sceneId"] },
  { name: "start_preview", description: "从场景或块位置启动预览。", args: ["sceneId", "blockId?"] },
  { name: "export_web_game", description: "执行预检并导出 WebGAL Web 包。", args: ["engineUrl?", "engineCssUrl?", "includeSource?"] },
] as const;

export const AI_DIRECTOR_TOOL_CATALOG = AI_TOOL_CATALOG.filter((tool) => !("advanced" in tool && tool.advanced));
