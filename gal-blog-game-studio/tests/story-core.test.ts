import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { strFromU8, unzipSync } from "fflate";

import { executeAiTool } from "../lib/story/aiTools";
import { compileProject, compileScene } from "../lib/story/compiler";
import { exampleProject } from "../lib/story/example";
import { createProjectZip } from "../lib/story/exporter";
import { importStoryText } from "../lib/story/importers";
import { applyPatches } from "../lib/story/patch";
import { layoutRoutesTopDown, routeDisplayPosition, routeStoredPosition } from "../lib/story/routeLayout";
import {
  choiceEnabled,
  chooseRuntime,
  createRuntime,
  resolveBlogRuntime,
  stepRuntime,
  submitInputRuntime,
} from "../lib/story/runtime";
import { validateProject } from "../lib/story/schema";
import { deepClone } from "../lib/story/utils";
import { GET as getAiTools, POST as postAiTool } from "../app/api/ai-tools/route";
import { POST as postCompile } from "../app/api/story/compile/route";
import { POST as postPatch } from "../app/api/story/patch/route";

test("完整示例通过 Story IR 引用校验", () => {
  const diagnostics = validateProject(exampleProject);
  assert.equal(diagnostics.filter((item) => item.severity === "error").length, 0);
  assert.equal(diagnostics.at(-1)?.code, "PROJECT_VALID");
});

test("WebGAL 编译覆盖 ADV、NVL、输入、Bridge 与共享引擎", () => {
  const compiled = compileProject(exampleProject);
  const allScripts = compiled.files.map((file) => file.content).join("\n");
  const index = compiled.files.find((file) => file.path === "index.html")?.content || "";
  const bridge = compiled.files.find((file) => file.path === "gal-blog-bridge.js")?.content || "";

  assert.match(allScripts, /getUserInput:player_name/);
  assert.match(allScripts, /intro:七月二十三日/);
  assert.match(allScripts, /@gal-blog-action/);
  assert.match(allScripts, /setVar:__galblog_request=action_/);
  assert.match(allScripts, /wait:600000/);
  assert.match(allScripts, /__galblog_status=='success'/);
  assert.match(allScripts, /choose:/);
  assert.doesNotMatch(allScripts, /setTextbox:(none|default)/);
  assert.match(index, /__TUANCHAT_WEBGAL__/);
  assert.match(index, /await import\(engineUrl\)/);
  assert.match(index, /index-Dch1g2w9\.css/);
  assert.match(index, /html-body__panic-overlay/);
  assert.match(index, /renderPromiseResolve/);
  assert.match(index, /PRESS SCREEN TO START/);
  assert.match(bridge, /stageManager\.subscribe/);
  assert.match(bridge, /player-input/);
  assert.match(bridge, /attachWebGAL/);
  assert.match(bridge, /document\.referrer/);
  assert.match(bridge, /config\.capabilities\.includes/);
  assert.equal(compiled.entrypoint, "index.html");
});

test("WebGAL Terre 官方动画预设会完整进入编译产物", () => {
  const compiled = compileProject(exampleProject);
  const table = compiled.files.find((file) => file.path === "game/animation/animationTable.json")?.content || "";
  assert.match(table, /"enter-from-right"/);
  assert.match(table, /"shockwaveIn"/);
  assert.ok(compiled.files.some((file) => file.path === "game/animation/enter.json"));
  assert.ok(compiled.files.some((file) => file.path === "game/animation/shake.json"));
  assert.ok(compiled.files.some((file) => file.path === "game/animation/removeFilm.json"));
});

test("友好 fade 别名编译为 WebGAL 官方 enter 预设", () => {
  const project = deepClone(exampleProject);
  const scene = project.scenes[0];
  scene.blocks = [{
    id: "fade_bg",
    type: "stage",
    action: "set-background",
    assetId: "bg_teahouse_day",
    transition: { name: "fade", durationMs: 720, easing: "easeInOut" },
  }];
  const compiled = compileScene(project, scene).script;
  assert.match(compiled, /changeBg:.* -enter=enter -duration=720 -ease=easeInOut;/);
  assert.doesNotMatch(compiled, /-enter=fade/);
});

test("BGM 使用 WebGAL 百分比音量并支持淡入淡出", () => {
  const project = deepClone(exampleProject);
  const scene = project.scenes[0];
  scene.blocks = [
    { id: "bgm_in", type: "stage", action: "play-bgm", assetId: "bgm_quiet", volume: 0.42, durationMs: 1200 },
    { id: "bgm_out", type: "stage", action: "stop-bgm", durationMs: 900 },
  ];
  const compiled = compileScene(project, scene).script;
  assert.match(compiled, /bgm:.* -volume=42 -enter=1200;/);
  assert.match(compiled, /bgm:none -enter=900;/);
});

test("全舞台特效使用 setAnimation，而不是只登记下次入场的 setTransition", () => {
  const project = deepClone(exampleProject);
  const scene = project.scenes[0];
  scene.blocks = [{
    id: "stage_shake",
    type: "stage",
    action: "transition",
    animationTarget: "stage-main",
    transition: { name: "shake", durationMs: 1000 },
  }];
  const compiled = compileScene(project, scene).script;
  assert.match(compiled, /setAnimation:shake -target=stage-main;/);
  assert.doesNotMatch(compiled, /setTransition:/);
});

test("叙事地图自动形成竖向主轴和横向分支，并兼容旧版横向坐标", () => {
  const nodes = [
    { id: "start", kind: "start" as const, title: "START", x: 0, y: 0 },
    { id: "common", kind: "common-route" as const, title: "COMMON", x: 100, y: 0 },
    { id: "left", kind: "scene-story" as const, title: "LEFT", x: 200, y: -100 },
    { id: "right", kind: "character-story" as const, title: "RIGHT", x: 200, y: 100 },
    { id: "end", kind: "true-ending" as const, title: "END", x: 300, y: 0 },
  ];
  const edges = [
    { id: "e1", source: "start", target: "common" },
    { id: "e2", source: "common", target: "left" },
    { id: "e3", source: "common", target: "right" },
    { id: "e4", source: "left", target: "end" },
    { id: "e5", source: "right", target: "end" },
  ];
  const layouted = layoutRoutesTopDown(nodes, edges);
  const byId = Object.fromEntries(layouted.map((node) => [node.id, node]));
  assert.ok(byId.start.y < byId.common.y);
  assert.equal(byId.left.y, byId.right.y);
  assert.notEqual(byId.left.x, byId.right.x);
  assert.ok(byId.right.y < byId.end.y);

  assert.deepEqual(routeDisplayPosition({ ...nodes[0], x: 40, y: 210 }, undefined), { x: 210, y: 40 });
  assert.deepEqual(routeStoredPosition({ x: 210, y: 40 }, undefined), { x: 40, y: 210 });
});

test("导出 Bridge 连接 WebGAL 舞台变量、等待回传并自动继续", async () => {
  const compiled = compileProject(exampleProject);
  const bridgeSource = compiled.files.find((file) => file.path === "gal-blog-bridge.js")?.content || "";
  const gameVar: Record<string, unknown> = {};
  const messages: Array<{ detail?: { type?: string; payload?: unknown } }> = [];
  let stageListener: ((state: { GameVar: Record<string, unknown> }) => void) | undefined;
  let clickCount = 0;
  const lock = { style: {}, textContent: "", remove() {} };
  const documentMock = {
    body: { appendChild() {} },
    createElement: () => lock,
    getElementById: (id: string) => id === "FullScreenClick"
      ? { dispatchEvent: () => { clickCount += 1; } }
      : undefined,
  };
  const stageManager = {
    subscribe(listener: typeof stageListener) {
      stageListener = listener;
      return () => { stageListener = undefined; };
    },
    getViewStageState: () => ({ GameVar: gameVar }),
    setStageVar({ key, value }: { key: string; value: unknown }) {
      gameVar[key] = value;
    },
    commit() {
      stageListener?.({ GameVar: gameVar });
    },
  };
  const windowMock: Record<string, unknown> & {
    parent?: unknown;
    GalBlogBridge?: {
      attachWebGAL: (core: unknown) => boolean;
      actionManifest: Record<string, { action: string }>;
      inputManifest: Record<string, { variable: string }>;
    };
  } = {
    dispatchEvent: (event: { detail?: { type?: string; payload?: unknown } }) => {
      messages.push(event);
      return true;
    },
    addEventListener() {},
  };
  windowMock.parent = windowMock;

  vm.runInNewContext(bridgeSource, {
    window: windowMock,
    document: documentMock,
    CustomEvent: class {
      detail: unknown;
      constructor(_name: string, init: { detail: unknown }) { this.detail = init.detail; }
    },
    MouseEvent: class {},
    Map,
    Promise,
    Object,
    Boolean,
    Date,
    Error,
    Math,
    String,
    console,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  });

  assert.ok(windowMock.GalBlogBridge?.attachWebGAL({ stageManager }));
  const actionToken = Object.entries(windowMock.GalBlogBridge?.actionManifest || {})
    .find(([, action]) => action.action === "open-article")?.[0];
  assert.ok(actionToken);
  gameVar.__galblog_request = actionToken;
  stageManager.commit();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(gameVar.__galblog_status, "success");
  assert.equal(gameVar.__galblog_request, "");
  assert.equal(clickCount, 1);
  assert.ok(messages.some((event) => event.detail?.type === "action-result"));

  const inputToken = Object.keys(windowMock.GalBlogBridge?.inputManifest || {})[0];
  assert.ok(inputToken);
  gameVar.player_name = "旅人";
  gameVar.__galblog_input_request = inputToken;
  stageManager.commit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(gameVar.__galblog_input_request, "");
  assert.ok(messages.some((event) => event.detail?.type === "player-input"));
});

test("自然语言导入通过别名生成受约束剧情块", () => {
  const result = importStoryText(
    "把背景换成茶室夜晚。让爱丽丝从右侧缓慢淡入，表情有些犹豫，然后说“主人今天回来得有些晚呢”。",
    exampleProject,
    "natural",
  );

  assert.equal(result.format, "natural");
  assert.ok(result.blocks.some((block) => block.type === "stage" && block.action === "set-background"));
  assert.ok(result.blocks.some((block) => block.type === "stage" && block.action === "enter-character"));
  assert.ok(result.blocks.some((block) => block.type === "dialogue" && block.characterId === "char_alice"));
  assert.equal(result.diagnostics.filter((item) => item.severity === "error").length, 0);
});

test("标签式输入优先于 JSON 数组检测", () => {
  const result = importStoryText(
    "[角色=爱丽丝][表情=微笑2][背景=茶室夜晚][位置=中间]\n爱丽丝：欢迎回来，主人。",
    exampleProject,
  );
  assert.equal(result.format, "tagged");
  assert.ok(result.blocks.some((block) => block.type === "dialogue"));
  assert.equal(result.diagnostics.filter((item) => item.code === "IMPORT_JSON_INVALID").length, 0);
});

test("标签与自然描述混合输入会分别解析，不把动作说明降级成旁白", () => {
  const result = importStoryText(
    "[角色=爱丽丝][表情=微笑2][背景=茶室夜晚][位置=中间]\n爱丽丝：欢迎回来，主人。\n让爱丽丝从右侧缓慢淡入，表情有些犹豫，然后说“主人今天回来得有些晚呢”。",
    exampleProject,
  );
  assert.equal(result.format, "tagged");
  assert.equal(result.blocks.filter((block) => block.type === "dialogue").length, 2);
  assert.ok(result.blocks.some((block) => block.type === "stage" && block.action === "enter-character"));
  assert.ok(!result.blocks.some((block) => block.type === "narration" && block.text.startsWith("让爱丽丝")));
});

test("无跳转目标的选择项可执行局部操作并继续下一剧情块", () => {
  const project = deepClone(exampleProject);
  const scene = project.scenes[0];
  scene.blocks = [
    { id: "choice_continue", type: "choice", options: [{ id: "stay", label: "留在当前场景" }] },
    { id: "after_choice", type: "dialogue", characterId: "char_alice", text: "选择后继续。" },
  ];
  const compiled = compileScene(project, scene).script;
  assert.match(compiled, /留在当前场景:__choice_choice-continue_stay/);
  assert.match(compiled, /jumpLabel:__choice_done_choice-continue/);
  assert.match(compiled, /爱丽丝:选择后继续。/);

  let runtime = stepRuntime(project, createRuntime(project, scene.id));
  assert.equal(runtime.waitingFor, "choice");
  runtime = chooseRuntime(project, runtime, "stay");
  assert.equal(runtime.currentBlock?.id, "after_choice");
  assert.equal(runtime.waitingFor, "advance");
});

test("clear-stage 使用项目真实角色 figure ID，不遗留已登场立绘", () => {
  const project = deepClone(exampleProject);
  const scene = project.scenes[0];
  scene.blocks = [{ id: "clear_all", type: "stage", action: "clear-stage" }];
  const compiled = compileScene(project, scene).script;
  assert.match(compiled, /changeFigure:none -id=char-alice/);
  assert.doesNotMatch(compiled, /fig-(left|center|right)/);
});

test("完整示例的留言入口可到达 Blog Bridge，并按结果进入对应结局", () => {
  let runtime = stepRuntime(exampleProject, createRuntime(exampleProject, "scene_prologue"));
  runtime = stepRuntime(exampleProject, runtime);
  assert.equal(runtime.currentBlock?.id, "b_p_input");
  runtime = submitInputRuntime(exampleProject, runtime, "浅仪式");
  runtime = stepRuntime(exampleProject, runtime);
  assert.equal(runtime.currentBlock?.id, "b_p_choice");
  runtime = chooseRuntime(exampleProject, runtime, "opt_comment");
  assert.equal(runtime.sceneId, "scene_comment");
  assert.equal(runtime.currentBlock?.id, "b_c_1");
  runtime = stepRuntime(exampleProject, runtime);
  assert.equal(runtime.currentBlock?.id, "b_c_comment");
  assert.equal(runtime.waitingFor, "blog");
  runtime = resolveBlogRuntime(exampleProject, runtime, "success");
  assert.equal(runtime.sceneId, "scene_true");
  assert.equal(runtime.currentBlock?.id, "b_t_1");
});

test("Ren'Py-like 代码视图保留块 ID 与不可见演出元数据", () => {
  const original = exampleProject.scenes[0].blocks[2];
  assert.equal(original.type, "stage");
  const script = `show 爱丽丝 微笑 at right  # @id=${original.id} @meta=${encodeURIComponent(JSON.stringify(original))}`;
  const result = importStoryText(script, exampleProject, "renpy");
  const roundTripped = result.blocks[0];

  assert.equal(roundTripped.id, original.id);
  assert.equal(roundTripped.type, "stage");
  assert.equal(roundTripped.type === "stage" ? roundTripped.transition?.name : "", "enter-from-right");
  assert.equal(roundTripped.type === "stage" ? roundTripped.transition?.durationMs : 0, 650);
});

test("StoryPatch 生成 inverse 并可恢复原台词", () => {
  const original = exampleProject.scenes[0].blocks[3];
  assert.equal(original.type, "dialogue");
  const changed = applyPatches(exampleProject, [{
    op: "set",
    path: "/scenes/0/blocks/3/text",
    value: "局部修改后的台词",
  }]);
  const changedLine = changed.project.scenes[0].blocks[3];
  assert.equal(changedLine.type === "dialogue" ? changedLine.text : "", "局部修改后的台词");

  const restored = applyPatches(changed.project, changed.inverse);
  const restoredLine = restored.project.scenes[0].blocks[3];
  assert.equal(restoredLine.type === "dialogue" ? restoredLine.text : "", original.text);
});

test("move Patch 的 inverse 恢复原始剧情块顺序", () => {
  const originalIds = exampleProject.scenes[0].blocks.map((block) => block.id);
  const moved = applyPatches(exampleProject, [{
    op: "move",
    from: "/scenes/0/blocks/1",
    path: "/scenes/0/blocks",
    index: 5,
  }]);
  assert.notDeepEqual(moved.project.scenes[0].blocks.map((block) => block.id), originalIds);
  const restored = applyPatches(moved.project, moved.inverse);
  assert.deepEqual(restored.project.scenes[0].blocks.map((block) => block.id), originalIds);
});

test("StoryPatch 拒绝越界数组索引，避免生成稀疏或损坏的 Story IR", () => {
  assert.throws(
    () => applyPatches(exampleProject, [{ op: "set", path: "/scenes/999/name", value: "损坏" }]),
    /patch 路径不存在|数组索引越界|目标不是容器/,
  );
  assert.throws(
    () => applyPatches(exampleProject, [{ op: "insert", path: "/scenes", index: 999, value: {} }]),
    /insert 数组索引越界/,
  );
});

test("选择项 enabledCondition 使用实际变量而不是字符串启发式", () => {
  const choice = exampleProject.scenes[1].blocks.find((block) => block.id === "b_a_choice");
  assert.equal(choice?.type, "choice");
  if (!choice || choice.type !== "choice") return;
  const returnOption = choice.options.find((option) => option.id === "opt_return");
  assert.ok(returnOption);
  const runtime = createRuntime(exampleProject);
  assert.equal(choiceEnabled(returnOption!, runtime), false);
  runtime.variables.read_article = true;
  assert.equal(choiceEnabled(returnOption!, runtime), true);
});

test("AI 语义工具只插入局部块并返回可撤销操作", () => {
  const result = executeAiTool(deepClone(exampleProject), {
    name: "add_dialogue",
    arguments: {
      sceneId: "scene_prologue",
      characterId: "char_alice",
      expressionId: "expr_alice_shy",
      position: "right",
      text: "由 AI 工具插入的局部台词。",
      index: 4,
    },
  });

  const inserted = result.project.scenes[0].blocks[4];
  assert.equal(inserted.type, "dialogue");
  assert.equal(inserted.source, "ai");
  assert.equal(result.operations.length, 1);
  assert.equal(result.inverse[0]?.op, "remove");
  assert.match(compileScene(result.project, result.project.scenes[0]).script, /由 AI 工具插入的局部台词/);
});

test("Web ZIP 同时包含可运行产物、Story 源数据与资源清单", async () => {
  const archive = createProjectZip(exampleProject);
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.ok(files["index.html"]);
  assert.ok(files["game/scene/start.txt"]);
  assert.ok(files["game/scene/scene_night-diary.txt"]);
  assert.ok(files["story.project.json"]);
  assert.ok(files["assets.required.json"]);
  assert.ok(files["game/animation/animationTable.json"]);
  assert.ok(files["game/animation/enter-from-right.json"]);
  assert.ok(files["THIRD_PARTY_NOTICES.md"]);
  assert.match(strFromU8(files["gal-blog.embed.json"]), /routeNodes/);
  assert.match(strFromU8(files["gal-blog.embed.json"]), /layoutDirection/);
});

test("HTTP API 暴露工具目录、局部工具、Patch 与编译链路", async () => {
  const catalogResponse = await getAiTools();
  const catalog = await catalogResponse.json() as { tools: Array<{ name: string }> };
  assert.ok(catalog.tools.some((tool) => tool.name === "create_scene"));

  const toolResponse = await postAiTool({
    json: async () => ({
      project: exampleProject,
      call: {
        name: "modify_line",
        arguments: { sceneId: "scene_prologue", blockId: "b_p_1", text: "API 局部修改" },
      },
    }),
  } as never);
  const toolResult = await toolResponse.json() as { ok: boolean; operations: unknown[] };
  assert.equal(toolResult.ok, true);
  assert.equal(toolResult.operations.length, 1);

  const patchResponse = await postPatch({
    json: async () => ({
      project: exampleProject,
      operations: [{ op: "set", path: "/title", value: "Patch API 标题" }],
    }),
  } as never);
  const patchResult = await patchResponse.json() as { ok: boolean; project: { title: string }; inverse: unknown[] };
  assert.equal(patchResult.project.title, "Patch API 标题");
  assert.equal(patchResult.inverse.length, 1);

  const compileResponse = await postCompile({
    json: async () => ({ project: exampleProject, sceneId: "scene_diary" }),
  } as never);
  const compileResult = await compileResponse.json() as { ok: boolean; script: string };
  assert.equal(compileResult.ok, true);
  assert.match(compileResult.script, /intro:七月二十三日/);
});
