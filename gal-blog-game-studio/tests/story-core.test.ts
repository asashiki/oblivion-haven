import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { executeAiTool } from "../lib/story/aiTools";
import { compileProject, compileScene } from "../lib/story/compiler";
import { createDirectorDraft, reviseSceneWithInstruction } from "../lib/story/director";
import { deleteStoryAsset, deleteStoryScene, linkRouteEdge, unlinkRouteEdge } from "../lib/story/editorOperations";
import { exampleProject } from "../lib/story/example";
import { createProjectZip } from "../lib/story/exporter";
import { generatedAcceptanceProject } from "../lib/story/generatedAcceptance";
import { applySceneFigureLayout, recommendedFigureTransform, webgalFigureBaseLayout } from "../lib/story/figureFraming";
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
import { parseWebGalSpritePackage } from "../lib/story/webgalSpritePackage";
import { projectForWebGalPreview, webgalAssetTargetPath } from "../lib/webgalPreview";
import { GET as getAiTools, POST as postAiTool } from "../app/api/ai-tools/route";
import { POST as postCompile } from "../app/api/story/compile/route";
import { POST as postPatch } from "../app/api/story/patch/route";

function createBridgeFixture() {
  const project = deepClone(exampleProject);
  project.settings.blogBridge = {
    enabled: true,
    allowedOrigins: ["https://example.test"],
    channel: "gal-blog-game",
    timeoutMs: 20000,
    capabilities: ["open-article"],
  };
  project.variables = [
    { id: "var_player_name", name: "player_name", type: "string", defaultValue: "主人", scope: "save" },
    { id: "var_bridge_result", name: "bridge_result", type: "string", defaultValue: "", scope: "scene" },
  ];
  project.scenes[0].blocks = [
    {
      id: "b_bridge_input",
      type: "input",
      variableId: "var_player_name",
      title: "怎么称呼你？",
      allowFreeText: true,
      targets: ["story", "blog"],
    },
    {
      id: "b_bridge_action",
      type: "blog-action",
      action: "open-article",
      payload: { slug: "test-article" },
      resultVariableId: "var_bridge_result",
      resultBranches: { successSceneId: "scene_bookmark" },
    },
  ];
  return project;
}

test("最小可玩项目通过 Story IR 引用校验", () => {
  const diagnostics = validateProject(exampleProject);
  assert.equal(diagnostics.filter((item) => item.severity === "error").length, 0);
  assert.equal(diagnostics.at(-1)?.code, "PROJECT_VALID");
});

test("默认项目只登记用户提供的三份真实素材", () => {
  assert.deepEqual(
    exampleProject.assets.map((asset) => asset.path).sort(),
    [
      "project-assets/alice-chibi-normal.png",
      "project-assets/alice-standard-normal.png",
      "project-assets/alice-tea-room-day.png",
    ],
  );
  assert.equal(exampleProject.assets.some((asset) => ["bgm", "voice", "sfx"].includes(asset.kind)), false);
  assert.equal(exampleProject.characters.length, 1);
});

test("删除角色或背景素材会同步清理场景引用，不留下损坏项目", () => {
  const withoutStandard = deleteStoryAsset(
    deepClone(exampleProject),
    "fig_alice_standard_normal",
  );
  assert.equal(withoutStandard.assets.length, 2);
  assert.equal(withoutStandard.characters[0]?.expressions.length, 1);
  assert.ok(withoutStandard.scenes.flatMap((scene) => scene.entryStage?.figures || []).every((figure) => (
    figure.expressionId !== "expr_alice_standard_normal"
  )));
  assert.equal(validateProject(withoutStandard).filter((item) => item.severity === "error").length, 0);

  const withoutBackground = deleteStoryAsset(
    deepClone(exampleProject),
    "bg_alice_tea_room_day",
  );
  assert.ok(withoutBackground.scenes.every((scene) => (
    scene.entryStage?.backgroundAssetId !== "bg_alice_tea_room_day"
    && scene.blocks.every((block) => block.type !== "stage" || block.assetId !== "bg_alice_tea_room_day")
  )));
  assert.equal(validateProject(withoutBackground).filter((item) => item.severity === "error").length, 0);
});

test("发布验收项目由生产 AI 工具链从空章节生成并可完整编译", async () => {
  const transcript = JSON.parse(
    await readFile("tests/fixtures/generated-acceptance-calls.json", "utf8"),
  ) as Array<{ call: { name: string }; operationCount: number }>;
  assert.equal(transcript.length, 39);
  assert.equal(transcript[0]?.call.name, "create_scene");
  assert.equal(transcript.at(-1)?.call.name, "connect_branch");
  assert.equal(generatedAcceptanceProject.scenes.length, 4);
  assert.equal(generatedAcceptanceProject.assets.length, 3);
  assert.ok(generatedAcceptanceProject.scenes.every((scene) => (
    scene.tags.includes("ai-generated-acceptance")
    && scene.blocks
      .filter((block) => block.type === "dialogue" || block.type === "choice")
      .every((block) => block.source === "ai")
  )));
  assert.ok(generatedAcceptanceProject.routeMap.edges.some((edge) => (
    edge.source === generatedAcceptanceProject.routeMap.nodes.find((node) => node.sceneId === generatedAcceptanceProject.scenes[2]?.id)?.id
    && edge.target === generatedAcceptanceProject.routeMap.nodes.find((node) => node.sceneId === generatedAcceptanceProject.scenes[1]?.id)?.id
  )));
  assert.equal(validateProject(generatedAcceptanceProject).filter((item) => item.severity === "error").length, 0);
  const compiled = compileProject(generatedAcceptanceProject, { previewMode: true });
  assert.ok(compiled.files.some((file) => file.path === "game/scene/start.txt"));
  assert.ok(compiled.files.some((file) => file.content.includes("你比约定早了十一分钟")));
  const scripts = compiled.files
    .filter((file) => file.path.startsWith("game/scene/"))
    .map((file) => file.content)
    .join("\n");
  assert.match(scripts, /changeFigure:project-assets\/alice-standard-normal\.png/);
  assert.match(scripts, /changeFigure:project-assets\/alice-chibi-normal\.png/);
  assert.match(scripts, /"position":\{"x":0,"y":570\}.*"scale":\{"x":1\.82,"y":1\.82\}/);
  assert.match(scripts, /setTempAnimation:.*"duration":520/);
  assert.doesNotMatch(scripts, /changeFigure:[^\n;]+ -enter=[^\n;]+ -transform=/);
});

test("角色素材可按透明像素边界自动计算胸像、腰上、膝上与全身构图", () => {
  const asset = exampleProject.assets.find((item) => item.id === "fig_alice_standard_normal");
  assert.ok(asset);
  const bust = recommendedFigureTransform(asset, "bust");
  const waist = recommendedFigureTransform(asset, "waist");
  const knee = recommendedFigureTransform(asset, "knee");
  const full = recommendedFigureTransform(asset, "full");

  assert.ok((bust.scale ?? 0) > (waist.scale ?? 0));
  assert.ok((waist.scale ?? 0) > (knee.scale ?? 0));
  assert.ok((knee.scale ?? 0) > (full.scale ?? 0));
  assert.ok((bust.y ?? 0) > (waist.y ?? 0));
  assert.ok((waist.y ?? 0) > (knee.y ?? 0));
});

test("站点打包的三份素材与用户原始文件内容一致", async () => {
  const expected = {
    "alice-chibi-normal.png": "8ae750ef5f277d81b15f6b27a17e781d22d0931e844bf9f6b212534a162b6fff",
    "alice-standard-normal.png": "941fba307bad0930ad72e9cbecba3625ea40b583d89bd5db39cc17dd57f7ea9e",
    "alice-tea-room-day.png": "27e415c0b31360812f984d543fc729051d73e4fec3d24635bf3ddb859998d4bf",
  };
  for (const [name, digest] of Object.entries(expected)) {
    const file = await readFile(new URL(`../public/project-assets/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(file).digest("hex"), digest);
  }
});

test("WebGAL 编译覆盖真实素材、内部循环、外部路线与共享引擎", () => {
  const compiled = compileProject(exampleProject);
  const allScripts = compiled.files.map((file) => file.content).join("\n");
  const index = compiled.files.find((file) => file.path === "index.html")?.content || "";
  const bridge = compiled.files.find((file) => file.path === "gal-blog-bridge.js")?.content || "";

  assert.match(allScripts, /changeBg:project-assets\/alice-tea-room-day\.png/);
  assert.match(allScripts, /changeFigure:project-assets\/alice-standard-normal\.png/);
  assert.match(allScripts, /jumpLabel:__block_questions-menu/);
  assert.match(allScripts, /choose:/);
  assert.match(allScripts, /-transform=\{"position":\{"x":0,"y":570\},"scale":\{"x":1\.82,"y":1\.82\},"alpha":0\}/);
  assert.match(allScripts, /setTempAnimation:.*"position":\{"x":0,"y":570\}.*"scale":\{"x":1\.82,"y":1\.82\}.*-target=char-alice/);
  assert.doesNotMatch(
    allScripts,
    /changeFigure:[^\n]+ -enter=[^\n]+ -transform=/,
    "WebGAL 在 changeFigure 同时使用 enter 与 transform 时会忽略构图参数",
  );
  assert.equal(
    compiled.sceneScripts.scene_return.match(/changeFigure:project-assets\/alice-standard-normal\.png/g)?.length,
    1,
    "同一差分的连续台词不应反复换图",
  );
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
    assetId: "bg_alice_tea_room_day",
    transition: { name: "fade", durationMs: 720, easing: "easeInOut" },
  }];
  const compiled = compileScene(project, scene).script;
  assert.match(compiled, /changeBg:.* -enter=enter -duration=720 -ease=easeInOut;/);
  assert.doesNotMatch(compiled, /-enter=fade/);
});

test("BGM 使用 WebGAL 百分比音量并支持淡入淡出", () => {
  const project = deepClone(exampleProject);
  const scene = project.scenes[0];
  project.assets.push({ id: "test_bgm", kind: "bgm", name: "测试 BGM", path: "test.ogg", aliases: [] });
  scene.blocks = [
    { id: "bgm_in", type: "stage", action: "play-bgm", assetId: "test_bgm", volume: 0.42, durationMs: 1200 },
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

test("故事地图细线可独立删除，删除剧情片段会清理失效引用", () => {
  const beforeBlocks = deepClone(exampleProject.scenes.find((scene) => scene.id === "scene_return")!.blocks);
  const unlinked = unlinkRouteEdge(deepClone(exampleProject), "edge_return_teatime");
  assert.equal(unlinked.routeMap.edges.some((edge) => edge.id === "edge_return_teatime"), false);
  assert.deepEqual(unlinked.scenes.find((scene) => scene.id === "scene_return")?.blocks, beforeBlocks);
  assert.equal(validateProject(unlinked).filter((item) => item.severity === "error").length, 0);

  const deleted = deleteStoryScene(deepClone(exampleProject), "scene_teatime");
  assert.equal(deleted.nextSceneId, "scene_questions");
  assert.equal(deleted.project.scenes.some((scene) => scene.id === "scene_teatime"), false);
  assert.equal(deleted.project.routeMap.nodes.some((node) => node.sceneId === "scene_teatime"), false);
  assert.equal(deleted.project.routeMap.edges.some((edge) => edge.source === "route_teatime" || edge.target === "route_teatime"), false);
  assert.equal(deleted.project.chapters[0].sceneIds.includes("scene_teatime"), false);
  assert.equal(validateProject(deleted.project).filter((item) => item.severity === "error").length, 0);
});

test("地图出口线直接编译为片段结束后的流向，不污染片段内部", () => {
  const project = deepClone(exampleProject);
  const sourceScene = project.scenes.find((scene) => scene.id === "scene_bookmark")!;
  sourceScene.blocks = sourceScene.blocks.filter((block) => (
    block.type !== "jump"
    && block.type !== "choice"
    && block.type !== "condition"
  ));
  const edge = {
    id: "edge_bookmark_return",
    source: "route_bookmark",
    target: "route_return",
    label: "回到开场",
  };

  const linked = linkRouteEdge(project, edge);
  assert.equal(linked.routeMap.edges.some((item) => item.id === edge.id), true);
  assert.equal(
    linked.scenes.find((scene) => scene.id === "scene_bookmark")?.blocks
      .some((block) => block.type === "jump" && block.targetSceneId === "scene_return"),
    false,
  );
  assert.match(compileScene(linked, linked.scenes.find((scene) => scene.id === "scene_bookmark")!).script, /changeScene:scene_return\.txt/);

  const unlinked = unlinkRouteEdge(linked, edge.id);
  assert.equal(unlinked.routeMap.edges.some((item) => item.id === edge.id), false);
  assert.equal(
    unlinked.scenes.find((scene) => scene.id === "scene_bookmark")?.blocks
      .some((block) => block.type === "jump" && block.targetSceneId === "scene_return"),
    false,
  );
  assert.doesNotMatch(compileScene(unlinked, unlinked.scenes.find((scene) => scene.id === "scene_bookmark")!).script, /changeScene:scene_return\.txt/);
});

test("片段级站位与构图会同步到 WebGAL 入场和对白", () => {
  const source = deepClone(exampleProject.scenes.find((scene) => scene.id === "scene_return")!);
  const updated = applySceneFigureLayout(source, "char_alice", { position: "left", shot: "bust" });
  const figure = updated.entryStage?.figures?.find((item) => item.characterId === "char_alice");
  assert.equal(figure?.position, "left");
  assert.deepEqual(figure?.transform, { x: 0, scale: 2.15, y: 760 });
  assert.equal(
    updated.blocks.every((block) => (
      block.type !== "dialogue"
      || block.characterId !== "char_alice"
      || block.position === "left"
    )),
    true,
  );
  assert.equal(
    updated.blocks.every((block) => (
      block.type !== "stage"
      || block.characterId !== "char_alice"
      || (block.action !== "enter-character" && block.action !== "set-expression")
      || (block.transform?.scale === 2.15 && block.transform?.y === 760)
    )),
    true,
  );
});

test("导出 Bridge 连接 WebGAL 舞台变量、等待回传并自动继续", async () => {
  const compiled = compileProject(createBridgeFixture());
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
    "把背景换成白昼茶室。让爱丽丝从右侧缓慢淡入，使用标准立绘，然后说“欢迎回来，主人”。",
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
    "[角色=爱丽丝][表情=标准立绘][背景=白昼茶室][位置=中间]\n爱丽丝：欢迎回来，主人。",
    exampleProject,
  );
  assert.equal(result.format, "tagged");
  assert.ok(result.blocks.some((block) => block.type === "dialogue"));
  assert.equal(result.diagnostics.filter((item) => item.code === "IMPORT_JSON_INVALID").length, 0);
});

test("标签与自然描述混合输入会分别解析，不把动作说明降级成旁白", () => {
  const result = importStoryText(
    "[角色=爱丽丝][表情=标准立绘][背景=白昼茶室][位置=中间]\n爱丽丝：欢迎回来，主人。\n让爱丽丝从右侧缓慢淡入，使用 Q 版立绘，然后说“今天先试试这场小茶会吧”。",
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

test("Bridge 测试夹具可从输入到达动作，并按成功结果进入目标片段", () => {
  const project = createBridgeFixture();
  let runtime = stepRuntime(project, createRuntime(project, "scene_return"));
  assert.equal(runtime.currentBlock?.id, "b_bridge_input");
  runtime = submitInputRuntime(project, runtime, "浅仪式");
  assert.equal(runtime.currentBlock?.id, "b_bridge_action");
  assert.equal(runtime.waitingFor, "blog");
  runtime = resolveBlogRuntime(project, runtime, "success");
  assert.equal(runtime.sceneId, "scene_bookmark");
  assert.equal(runtime.currentBlock?.id, "bookmark_n1");
});

test("Ren'Py-like 代码视图保留块 ID 与不可见演出元数据", () => {
  const original = exampleProject.scenes[0].blocks[1];
  assert.equal(original.type, "stage");
  const script = `show 爱丽丝 微笑 at right  # @id=${original.id} @meta=${encodeURIComponent(JSON.stringify(original))}`;
  const result = importStoryText(script, exampleProject, "renpy");
  const roundTripped = result.blocks[0];

  assert.equal(roundTripped.id, original.id);
  assert.equal(roundTripped.type, "stage");
  assert.equal(roundTripped.type === "stage" ? roundTripped.transition?.name : "", "enter-from-right");
  assert.equal(roundTripped.type === "stage" ? roundTripped.transition?.durationMs : 0, 700);
});

test("StoryPatch 生成 inverse 并可恢复原台词", () => {
  const blockIndex = exampleProject.scenes[0].blocks.findIndex((block) => block.id === "return_d1");
  const original = exampleProject.scenes[0].blocks[blockIndex];
  assert.equal(original.type, "dialogue");
  const changed = applyPatches(exampleProject, [{
    op: "set",
    path: `/scenes/0/blocks/${blockIndex}/text`,
    value: "局部修改后的台词",
  }]);
  const changedLine = changed.project.scenes[0].blocks[blockIndex];
  assert.equal(changedLine.type === "dialogue" ? changedLine.text : "", "局部修改后的台词");

  const restored = applyPatches(changed.project, changed.inverse);
  const restoredLine = restored.project.scenes[0].blocks[blockIndex];
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
  const project = deepClone(exampleProject);
  project.variables.push({ id: "var_unlocked", name: "unlocked", type: "boolean", defaultValue: false, scope: "save" });
  project.scenes[0].blocks = [{
    id: "conditional_choice",
    type: "choice",
    options: [{ id: "open_when_ready", label: "继续", enabledCondition: "unlocked==true" }],
  }];
  const choice = project.scenes[0].blocks[0];
  assert.equal(choice?.type, "choice");
  if (!choice || choice.type !== "choice") return;
  const returnOption = choice.options.find((option) => option.id === "open_when_ready");
  assert.ok(returnOption);
  const runtime = createRuntime(project);
  assert.equal(choiceEnabled(returnOption!, runtime), false);
  runtime.variables.unlocked = true;
  assert.equal(choiceEnabled(returnOption!, runtime), true);
});

test("片段内部选项循环不会被拆成外部场景", () => {
  const project = deepClone(exampleProject);
  const scene = project.scenes[0];
  scene.blocks = [
    { id: "loop_start", type: "dialogue", characterId: "char_alice", text: "想先聊哪一件事？" },
    {
      id: "loop_menu",
      type: "choice",
      options: [
        { id: "loop_back", label: "返回刚才的话题", targetBlockId: "loop_start" },
        { id: "loop_continue", label: "继续往下" },
      ],
    },
    { id: "loop_after", type: "dialogue", characterId: "char_alice", text: "那就继续吧。" },
  ];
  const script = compileScene(project, scene).script;
  assert.match(script, /label:__block_loop-start/);
  assert.match(script, /jumpLabel:__block_loop-start/);
  assert.equal(validateProject(project).filter((item) => item.severity === "error").length, 0);

  let runtime = stepRuntime(project, createRuntime(project, scene.id));
  assert.equal(runtime.currentBlock?.id, "loop_start");
  runtime = stepRuntime(project, runtime);
  assert.equal(runtime.currentBlock?.id, "loop_menu");
  runtime = chooseRuntime(project, runtime, "loop_back");
  assert.equal(runtime.currentBlock?.id, "loop_start");
});

test("选项组支持局部反应、跨组选项跳转、一次性记录与主干记录条件", () => {
  const project = deepClone(exampleProject);
  project.records = [
    { id: "record_clue_a", name: "获得线索A" },
    { id: "record_clue_b", name: "获得线索B" },
    { id: "record_trust_alice", name: "相信爱丽丝" },
  ];
  const scene = project.scenes.find((item) => item.id === "scene_return")!;
  scene.blocks = [
    {
      id: "choice_mid",
      type: "choice",
      groupCode: "S01-Q01",
      prompt: "要相信她吗？",
      options: [
        { id: "opt_trust", label: "相信爱丽丝", recordId: "record_trust_alice" },
        { id: "opt_loop", label: "再问一次", targetChoiceGroupId: "choice_loop" },
      ],
    },
    {
      id: "dialogue_reaction",
      type: "dialogue",
      characterId: "char_alice",
      expressionId: "expr_alice_standard_normal",
      text: "那么，我们继续吧。",
      choiceReactions: [{
        choiceBlockId: "choice_mid",
        optionId: "opt_trust",
        text: "谢谢主人愿意相信我。",
        position: "right",
        transform: { x: 20, y: 540, scale: 1.8 },
      }],
    },
    {
      id: "choice_loop",
      type: "choice",
      groupCode: "S01-Q02",
      options: [{ id: "opt_back", label: "回到刚才", targetChoiceGroupId: "choice_mid", recordId: "record_clue_a" }],
    },
  ];
  project.routeMap.edges = [{
    id: "edge_records",
    source: "route_return",
    target: "route_teatime",
    recordCondition: { mode: "all", recordIds: ["record_trust_alice"] },
  }, {
    id: "edge_records_at_least",
    source: "route_return",
    target: "route_teatime",
    recordCondition: { mode: "at-least", recordIds: ["record_clue_a", "record_clue_b", "record_trust_alice"], minimum: 2 },
  }];

  assert.equal(validateProject(project).filter((item) => item.severity === "error").length, 0);
  const script = compileScene(project, scene).script;
  assert.match(script, /setVar:record_相信爱丽丝=true -global -next/);
  assert.match(script, /jumpLabel:__block_choice-loop/);
  assert.match(script, /谢谢主人愿意相信我.*-when=__choice_choice-mid=="opt_trust"/);
  assert.match(script, /"y":540/);
  assert.match(script, /changeScene:scene_teatime\.txt -when=record_相信爱丽丝/);
  assert.match(script, /record_获得线索a.*record_获得线索b.*\|\|/);

  let runtime = createRuntime(project, scene.id);
  runtime = stepRuntime(project, runtime);
  runtime = chooseRuntime(project, runtime, "opt_trust");
  assert.equal(runtime.variables.record_相信爱丽丝, true);
  assert.equal(runtime.log.at(-1)?.text, "谢谢主人愿意相信我。");
});

test("三份真实素材组成的默认故事可从内部循环完整玩到结尾", () => {
  const advanceTo = (input: ReturnType<typeof createRuntime>, blockId: string) => {
    let state = input;
    for (let index = 0; index < 80; index += 1) {
      if (state.currentBlock?.id === blockId) return state;
      state = stepRuntime(exampleProject, state);
    }
    throw new Error(`没有到达剧情块：${blockId}`);
  };

  let runtime = stepRuntime(exampleProject, createRuntime(exampleProject, "scene_return"));
  assert.equal(runtime.currentBlock?.id, "return_n1");
  runtime = advanceTo(runtime, "tea_choice");
  assert.equal(runtime.sceneId, "scene_teatime");
  runtime = chooseRuntime(exampleProject, runtime, "tea_choose_drink");
  assert.equal(runtime.currentBlock?.id, "tea_drink");
  runtime = advanceTo(runtime, "questions_menu");
  assert.equal(runtime.sceneId, "scene_questions");

  runtime = chooseRuntime(exampleProject, runtime, "questions_work");
  assert.equal(runtime.currentBlock?.id, "questions_work_answer");
  runtime = stepRuntime(exampleProject, runtime);
  assert.equal(runtime.currentBlock?.id, "questions_menu");
  runtime = chooseRuntime(exampleProject, runtime, "questions_continue");
  runtime = advanceTo(runtime, "protest_d1");
  assert.equal(runtime.figures[0]?.expressionId, "expr_alice_chibi_normal");
  runtime = advanceTo(runtime, "bookmark_n1");
  assert.equal(runtime.sceneId, "scene_bookmark");
  assert.equal(runtime.figures[0]?.expressionId, "expr_alice_standard_normal");
  assert.equal(runtime.backgroundAssetId, "bg_alice_tea_room_day");

  for (let index = 0; index < 20 && runtime.waitingFor !== "end"; index += 1) {
    runtime = stepRuntime(exampleProject, runtime);
  }
  assert.equal(runtime.waitingFor, "end");
});

test("导演生成器只使用现有素材并生成局部可玩片段", () => {
  const project = deepClone(exampleProject);
  project.scenes[0].blocks = [];
  project.scenes[0].entryStage = undefined;
  const result = createDirectorDraft(
    project,
    "scene_return",
    "白昼茶室，爱丽丝使用 Q 版立绘邀请主人坐下。最后给出几个选项，并允许返回最开始循环。",
  );

  assert.equal(result.scene.mode, "adv");
  assert.equal(result.scene.entryStage?.backgroundAssetId, "bg_alice_tea_room_day");
  assert.ok(result.matches.some((match) => match.role === "background" && match.id === "bg_alice_tea_room_day"));
  assert.ok(result.matches.some((match) => match.role === "expression" && match.id === "expr_alice_chibi_normal"));
  assert.ok(result.notes.some((note) => note.includes("保持静音")));
  assert.equal(result.scene.entryStage?.figures?.[0]?.position, "center");
  assert.ok(result.scene.blocks.some((block) => block.type === "dialogue" && block.source === "system"));
  const choice = result.scene.blocks.find((block) => block.type === "choice");
  assert.equal(choice?.type, "choice");
  if (!choice || choice.type !== "choice") return;
  assert.ok(choice.options.some((option) => option.targetBlockId));
  assert.equal(validateProject(result.project).filter((item) => item.severity === "error").length, 0);
  assert.match(compileScene(result.project, result.scene).script, /jumpLabel:__block_/);
});

test("导演规则继承素材默认构图，并允许剧情说明明确覆盖", () => {
  const project = deepClone(exampleProject);
  project.scenes[0].blocks = [];
  project.scenes[0].entryStage = undefined;
  const defaultDraft = createDirectorDraft(project, "scene_return", "白昼茶室，爱丽丝使用标准立绘欢迎主人。");
  assert.equal(defaultDraft.scene.entryStage?.figures?.[0]?.position, "right");
  assert.equal(defaultDraft.scene.entryStage?.figures?.[0]?.transform, undefined);
  assert.match(
    compileScene(defaultDraft.project, defaultDraft.scene).script,
    /"position":\{"x":0,"y":570\}.*"scale":\{"x":1\.82,"y":1\.82\}/,
  );

  const overrideDraft = createDirectorDraft(project, "scene_return", "白昼茶室，爱丽丝站在左侧，使用胸像近景欢迎主人。");
  assert.equal(overrideDraft.scene.entryStage?.figures?.[0]?.position, "left");
  assert.ok((overrideDraft.scene.entryStage?.figures?.[0]?.transform?.scale ?? 0) > 2);
  assert.ok((overrideDraft.scene.entryStage?.figures?.[0]?.transform?.y ?? 0) > 700);
});

test("试玩改修保留地图摘要与外部路线，不把修改指令堆进节点", () => {
  const project = deepClone(exampleProject);
  const summary = project.scenes[0].summary || "";
  const result = reviseSceneWithInstruction(
    project,
    "scene_return",
    "切换为 Q 版立绘，语气更温柔，并保留返回循环。",
  );

  assert.equal(result.scene.summary, summary);
  assert.doesNotMatch(result.scene.summary, /修改要求/);
  assert.ok(result.scene.blocks.some((block) => block.type === "jump" && block.targetSceneId === "scene_teatime"));
  assert.equal(validateProject(result.project).filter((item) => item.severity === "error").length, 0);
});

test("AI 语义工具只插入局部块并返回可撤销操作", () => {
  const result = executeAiTool(deepClone(exampleProject), {
    name: "add_dialogue",
    arguments: {
      sceneId: "scene_return",
      characterId: "char_alice",
      expressionId: "expr_alice_standard_normal",
      position: "right",
      text: "由 AI 工具插入的局部台词。",
      index: 3,
    },
  });

  const inserted = result.project.scenes[0].blocks[3];
  assert.equal(inserted.type, "dialogue");
  assert.equal(inserted.source, "ai");
  assert.equal(result.operations.length, 1);
  assert.equal(result.inverse[0]?.op, "remove");
  assert.match(compileScene(result.project, result.project.scenes[0]).script, /由 AI 工具插入的局部台词/);
});

test("AI 连接剧情节点会写入合法主干边并由编译器执行", () => {
  const project = deepClone(exampleProject);
  project.routeMap.edges = [];
  project.scenes[0].blocks = project.scenes[0].blocks.filter((block) => (
    block.type !== "jump" && block.type !== "choice" && block.type !== "condition"
  ));
  const result = executeAiTool(project, {
    name: "connect_branch",
    arguments: {
      sourceNodeId: "route_return",
      targetNodeId: "route_teatime",
    },
  });

  assert.deepEqual(
    result.project.routeMap.edges.map((edge) => [edge.source, edge.target]),
    [["route_return", "route_teatime"]],
  );
  assert.equal(result.project.scenes[0].blocks.some((block) => block.id.startsWith("route_jump_")), false);
  assert.match(compileScene(result.project, result.project.scenes[0]).script, /changeScene:scene_teatime\.txt/);
  assert.equal(validateProject(result.project).filter((item) => item.severity === "error").length, 0);
});

test("Web ZIP 同时包含可运行产物、Story 源数据与资源清单", async () => {
  const archive = createProjectZip(exampleProject);
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.ok(files["index.html"]);
  assert.ok(files["game/scene/start.txt"]);
  assert.ok(files["game/scene/scene_teatime.txt"]);
  assert.ok(files["game/scene/scene_bookmark.txt"]);
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
        arguments: { sceneId: "scene_return", blockId: "return_d1", text: "API 局部修改" },
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
    json: async () => ({ project: exampleProject, sceneId: "scene_teatime" }),
  } as never);
  const compileResult = await compileResponse.json() as { ok: boolean; script: string };
  assert.equal(compileResult.ok, true);
  assert.match(compileResult.script, /爱丽丝:红茶还需要一点时间。主人想先做什么？/);
});

test("任意片段的 WebGAL 实机预览会补齐独立入场状态", () => {
  const project = projectForWebGalPreview(exampleProject, "scene_questions");
  assert.equal(project.settings.startSceneId, "scene_questions");
  const scene = project.scenes.find((item) => item.id === "scene_questions");
  assert.ok(scene);
  assert.equal(scene?.blocks[0]?.type, "stage");
  assert.equal(scene?.blocks[0]?.type === "stage" ? scene.blocks[0].action : "", "set-background");
  assert.ok(scene?.blocks.some((block) => block.id.startsWith("__preview_scene_questions_figure")));

  const script = compileScene(project, scene!).script;
  assert.match(script, /changeBg:project-assets\/alice-tea-room-day\.png/);
  assert.match(script, /changeFigure:project-assets\/alice-standard-normal\.png/);
  assert.match(script, /-transform=\{"position":\{"x":0,"y":570\},"scale":\{"x":1\.82,"y":1\.82\},"alpha":0\}/);
  assert.match(script, /setTempAnimation:.*"position":\{"x":0,"y":570\}.*"scale":\{"x":1\.82,"y":1\.82\}/);
  assert.equal(webgalAssetTargetPath(exampleProject.assets[0]), "game/background/project-assets/alice-tea-room-day.png");
});

test("片段实机预览绕过标题菜单并自动运行所选入口", () => {
  const target = projectForWebGalPreview(exampleProject, "scene_questions");
  const compiled = compileProject(target, { previewMode: true });
  const index = compiled.files.find((file) => file.path === "index.html")?.content || "";
  const start = compiled.files.find((file) => file.path === "game/scene/start.txt")?.content || "";

  assert.doesNotMatch(index, /PRESS SCREEN TO START/);
  assert.match(index, /webgal-preview-started/);
  assert.match(index, /_Title_buttonList_/);
  assert.match(index, /click\(startButton\)/);
  assert.match(start, /changeScene:scene_questions\.txt/);
});

test("WebGAL 实机预览 Service Worker 只接管隔离的虚拟文件目录", async () => {
  const source = await readFile(new URL("../public/webgal-runtime-sw.js", import.meta.url), "utf8");
  assert.match(source, /\/webgal-runtime\/session\//);
  assert.match(source, /caches\.match\(event\.request\)/);
  assert.doesNotMatch(source, /respondWith\([^)]*fetch\(/);
});

test("自动构图按 WebGAL 4.6.2 的真实 fit 与底部锚定计算用户立绘", () => {
  const asset = {
    id: "user_base",
    kind: "figure" as const,
    name: "base.png",
    path: "base.png",
    aliases: [],
    metadata: {
      sourceWidth: 1024,
      sourceHeight: 1536,
      figureVisibleLeft: 0.2891,
      figureVisibleTop: 0.0397,
      figureVisibleRight: 0.7109,
      figureVisibleBottom: 0.9603,
    },
  };
  const base = webgalFigureBaseLayout(asset, "right");
  assert.deepEqual(base, {
    sourceWidth: 1024,
    sourceHeight: 1536,
    fitScale: 0.9375,
    fittedWidth: 960,
    fittedHeight: 1440,
    baseX: 2080,
    baseY: 720,
  });
  const waist = recommendedFigureTransform(asset, "waist");
  assert.ok(Math.abs((waist.scale ?? 0) - 1.902) < 0.002);
  assert.ok(Math.abs((waist.y ?? 0) - 558.7) < 0.2);
  const full = recommendedFigureTransform(asset, "full");
  assert.ok(Math.abs((full.scale ?? 0) - 1.0274) < 0.002);
  assert.ok(Math.abs((full.y ?? 0) + 11) < 0.2);
});

test("立绘 Skill 成品 ZIP 会按 manifest 识别全画布嘴型与眨眼差分", () => {
  const manifest = {
    schema_version: "1",
    engine: "WebGAL",
    install_to: "game/figure/alice",
    figures: [{
      label: "idle",
      pose: "normal",
      blink: "dynamic",
      mouth_sync: true,
      files: { base: "figures/idle_base.png" },
      webgal: {
        mouthOpen: "figures/idle_mouth_open.png",
        mouthHalfOpen: "figures/idle_mouth_half.png",
        mouthClose: "figures/idle_base.png",
        eyesOpen: "figures/idle_base.png",
        eyesClose: "figures/idle_eyes_close.png",
      },
    }],
  };
  const archive = zipSync({
    "deliverables/webgal-manifest.json": strToU8(JSON.stringify(manifest)),
    "deliverables/README.md": strToU8("# Alice runtime"),
    "deliverables/inventory.json": strToU8("{}"),
    "deliverables/figures/idle_base.png": new Uint8Array([1]),
    "deliverables/figures/idle_mouth_open.png": new Uint8Array([2]),
    "deliverables/figures/idle_mouth_half.png": new Uint8Array([3]),
    "deliverables/figures/idle_eyes_close.png": new Uint8Array([4]),
  });
  const parsed = parseWebGalSpritePackage(archive, "alice-deliverables.zip");
  assert.equal(parsed.expressions.length, 1);
  assert.equal(parsed.expressions[0].mouthSync, true);
  assert.equal(parsed.expressions[0].blink, "dynamic");
  assert.equal(parsed.expressions[0].files.mouthOpen, "deliverables/figures/idle_mouth_open.png");
  assert.equal(parsed.frames.size, 4);
  assert.deepEqual(parsed.issues, []);
});

test("动态立绘编译为 WebGAL 原生 mouth/eyes 参数并让对白命中 figureId", () => {
  const project = deepClone(exampleProject);
  project.assets.push(
    { id: "mouth_open", kind: "expression", name: "open", path: "alice/open.png", aliases: [] },
    { id: "mouth_half", kind: "expression", name: "half", path: "alice/half.png", aliases: [] },
    { id: "eyes_close", kind: "expression", name: "eyes", path: "alice/eyes-close.png", aliases: [] },
  );
  const expression = project.characters[0].expressions[0];
  expression.webgalAnimation = {
    mouthSync: true,
    blink: "dynamic",
    mouthOpenAssetId: "mouth_open",
    mouthHalfOpenAssetId: "mouth_half",
    mouthCloseAssetId: expression.assetId,
    eyesOpenAssetId: expression.assetId,
    eyesCloseAssetId: "eyes_close",
  };
  const scene = project.scenes[0];
  scene.blocks = [
    { id: "enter", type: "stage", action: "enter-character", characterId: project.characters[0].id, expressionId: expression.id, position: "right" },
    { id: "say", type: "dialogue", characterId: project.characters[0].id, expressionId: expression.id, text: "测试动嘴。" },
  ];
  const script = compileScene(project, scene).script;
  assert.match(script, /-mouthOpen=alice\/open\.png/);
  assert.match(script, /-mouthHalfOpen=alice\/half\.png/);
  assert.match(script, /-mouthClose=project-assets\/alice-standard-normal\.png/);
  assert.match(script, /-eyesClose=alice\/eyes-close\.png/);
  assert.match(script, /爱丽丝:测试动嘴。 -figureId=char-alice;/);
});
