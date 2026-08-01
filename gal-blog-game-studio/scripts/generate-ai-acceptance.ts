import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { POST as postAiTool } from "../app/api/ai-tools/route";
import type { AiToolCall, AiToolResult } from "../lib/story/aiTools";
import { compileProject } from "../lib/story/compiler";
import { exampleProject } from "../lib/story/example";
import { validateProject } from "../lib/story/schema";
import type { StoryProject } from "../lib/story/types";
import { deepClone } from "../lib/story/utils";

const outputPath = resolve(process.cwd(), "lib/story/generatedAcceptance.json");
const transcriptPath = resolve(process.cwd(), "tests/fixtures/generated-acceptance-calls.json");

let project: StoryProject = deepClone(exampleProject);
project = {
  ...project,
  title: "爱丽丝茶室 · AI 工具验收样章",
  version: "0.5.0",
  description: "由 ChatGPT 在编辑器功能完成后，通过项目公开的 AI 工具调用链生成；不是手写进默认场景的固定演示。",
  chapters: [{
    id: "chapter_one",
    name: "第一章 · 被书签留住的午后",
    order: 0,
    description: "只使用茶室背景、爱丽丝标准立绘和 Q 版立绘，验证分支、循环、构图与 WebGAL 实机。",
    sceneIds: [],
  }],
  scenes: [],
  routeMap: { layoutDirection: "top-down", nodes: [], edges: [] },
  endings: [],
  savePoints: [],
  variables: [],
  aiConfigs: [],
  settings: { ...project.settings, startSceneId: "pending-ai-scene" },
};

const transcript: Array<{ call: AiToolCall; operationCount: number }> = [];

async function run(call: AiToolCall) {
  const response = await postAiTool({
    json: async () => ({ project, call }),
  } as never);
  const result = await response.json() as AiToolResult | { ok: false; error: string };
  if (!result.ok) throw new Error(result.error);
  project = result.project;
  transcript.push({ call, operationCount: result.operations.length });
  return result;
}

async function createScene(name: string): Promise<string> {
  const before = new Set(project.scenes.map((scene) => scene.id));
  await run({
    name: "create_scene",
    arguments: {
      chapterId: "chapter_one",
      name,
      mode: "adv",
      afterSceneId: project.scenes.at(-1)?.id,
    },
  });
  const scene = project.scenes.find((item) => !before.has(item.id));
  if (!scene) throw new Error(`AI 工具没有创建场景：${name}`);
  return scene.id;
}

function routeId(sceneId: string): string {
  const id = project.routeMap.nodes.find((node) => node.sceneId === sceneId)?.id;
  if (!id) throw new Error(`场景没有路线节点：${sceneId}`);
  return id;
}

async function configureScene({
  sceneId,
  summary,
  expressionId,
  position,
  transform,
}: {
  sceneId: string;
  summary: string;
  expressionId: string;
  position: "left" | "center" | "right";
  transform: { x: number; y: number; scale: number };
}) {
  await run({
    name: "modify_scene",
    arguments: {
      sceneId,
      patch: {
        summary,
        aiContext: `${summary}。只使用已登记的三份真实素材；没有 BGM，因此保持静音。`,
        tags: ["ai-generated-acceptance", "three-real-assets"],
        entryStage: {
          backgroundAssetId: "bg_alice_tea_room_day",
          figures: [{
            characterId: "char_alice",
            expressionId,
            position,
            transform,
          }],
        },
      },
    },
  });
  await run({
    name: "set_background",
    arguments: {
      sceneId,
      assetId: "bg_alice_tea_room_day",
      index: 0,
    },
  });
}

async function addDialogue(
  sceneId: string,
  text: string,
  options: {
    expressionId?: string;
    position?: "left" | "center" | "right";
    enter?: { name: string; durationMs: number; easing?: string };
  } = {},
) {
  await run({
    name: "add_dialogue",
    arguments: {
      sceneId,
      characterId: "char_alice",
      text,
      ...options,
    },
  });
}

async function connect(sourceSceneId: string, targetSceneId: string, label: string) {
  await run({
    name: "connect_branch",
    arguments: {
      sourceNodeId: routeId(sourceSceneId),
      targetNodeId: routeId(targetSceneId),
      label,
    },
  });
}

const arrival = await createScene("01 · 门铃之后");
const confession = await createScene("02A · 先说今天");
const tea = await createScene("02B · 先让茶醒");
const promise = await createScene("03 · 留给明天的问题");

await configureScene({
  sceneId: arrival,
  summary: "主人比约定更早来到茶室，爱丽丝察觉他有话没有说出口",
  expressionId: "expr_alice_standard_normal",
  position: "right",
  transform: { x: 0, y: 570, scale: 1.82 },
});
await addDialogue(arrival, "你比约定早了十一分钟，主人。", {
  expressionId: "expr_alice_standard_normal",
  position: "right",
  enter: { name: "enter-from-right", durationMs: 520, easing: "easeOut" },
});
await addDialogue(arrival, "不是坏事。只是门铃响起的时候，我还在想——今天要先问候你，还是先把茶端上来。");
await addDialogue(arrival, "现在看来，茶可以等一等。你握着门把的样子，比平时用力。");
await addDialogue(arrival, "如果还没想好从哪里说起，就由你选一个比较容易的开头吧。");
await run({
  name: "add_choice",
  arguments: {
    sceneId: arrival,
    prompt: "先从哪里开始？",
    options: [
      { id: "arrival_talk", label: "先说今天发生的事", targetSceneId: confession },
      { id: "arrival_tea", label: "先让红茶醒一会儿", targetSceneId: tea },
    ],
  },
});

await configureScene({
  sceneId: confession,
  summary: "主人试着说明今天的迟疑，爱丽丝没有催促，只把问题缩小到可以回答的程度",
  expressionId: "expr_alice_standard_normal",
  position: "left",
  transform: { x: 0, y: 570, scale: 1.82 },
});
await addDialogue(confession, "那就从今天开始。不用从最正确的地方开始。", {
  expressionId: "expr_alice_standard_normal",
  position: "left",
  enter: { name: "enter-from-left", durationMs: 520, easing: "easeOut" },
});
await addDialogue(confession, "你可以只告诉我，哪一个瞬间最想立刻离开。");
await addDialogue(confession, "……原来如此。你不是不知道该怎么做，只是不想让任何人失望。");
await addDialogue(confession, "可如果连你自己也被排在最后，这份体贴迟早会变成一张没人敢拆的欠条。");
await addDialogue(confession, "要继续说下去，还是先回到茶桌旁？两种都不算逃避。");
await run({
  name: "add_choice",
  arguments: {
    sceneId: confession,
    prompt: "把话说到哪一步？",
    options: [
      { id: "confession_promise", label: "把真正担心的事说完", targetSceneId: promise },
      { id: "confession_tea", label: "先去看看红茶", targetSceneId: tea },
    ],
  },
});

await configureScene({
  sceneId: tea,
  summary: "短暂的 Q 版演出缓和气氛，玩家可以返回谈话或继续作出约定",
  expressionId: "expr_alice_chibi_normal",
  position: "center",
  transform: { x: 0, y: 34, scale: 0.94 },
});
await addDialogue(tea, "报告主人：红茶没有生气，只是已经等得开始怀疑自己的冲泡时间。", {
  expressionId: "expr_alice_chibi_normal",
  position: "center",
  enter: { name: "enter-from-bottom", durationMs: 420, easing: "backOut" },
});
await addDialogue(tea, "这是我替它说的。它本人暂时保持沉默。");
await addDialogue(tea, "不过，停下来喝一口以后，刚才那句话也许会变得没那么锋利。");
await addDialogue(tea, "你想回去把它说完，还是把答案留在今天的最后？");
await run({
  name: "add_choice",
  arguments: {
    sceneId: tea,
    prompt: "接下来怎么做？",
    options: [
      { id: "tea_return", label: "回到刚才的话题", targetSceneId: confession },
      { id: "tea_promise", label: "把约定写进书签", targetSceneId: promise },
    ],
  },
});

await configureScene({
  sceneId: promise,
  summary: "爱丽丝恢复标准构图，与主人约定明天只处理一件真正重要的事",
  expressionId: "expr_alice_standard_normal",
  position: "right",
  transform: { x: 0, y: 570, scale: 1.82 },
});
await addDialogue(promise, "谢谢你愿意说到这里。剩下的部分，不必为了让今天完整而勉强补上。", {
  expressionId: "expr_alice_standard_normal",
  position: "right",
  enter: { name: "enter", durationMs: 360, easing: "easeOut" },
});
await addDialogue(promise, "我们只约定一件事：明天醒来以后，先替自己决定一件真正重要的事。");
await addDialogue(promise, "不是最紧急的，也不是别人最期待的。只是一件你愿意承认重要的事。");
await addDialogue(promise, "我会把空白留在这张书签上。等你想写的时候，再交给我。");
await addDialogue(promise, "现在，红茶的温度刚好。欢迎回来，主人。");

await connect(arrival, confession, "先说今天");
await connect(arrival, tea, "先让茶醒");
await connect(confession, promise, "把担心说完");
await connect(confession, tea, "回到茶桌");
await connect(tea, confession, "回到话题");
await connect(tea, promise, "写下约定");

const finalRouteId = routeId(promise);
project.endings = [{
  id: "ending_generated_bookmark",
  name: "留白的书签",
  kind: "normal",
  routeNodeId: finalRouteId,
  sceneId: promise,
}];
project.updatedAt = new Date().toISOString();

const errors = validateProject(project).filter((diagnostic) => diagnostic.severity === "error");
if (errors.length) {
  throw new Error(`生成项目校验失败：${errors.map((item) => item.message).join("；")}`);
}
const compiled = compileProject(project, { previewMode: true });
if (!compiled.files.some((file) => file.path === "game/scene/start.txt")) {
  throw new Error("生成项目没有可运行的 WebGAL 入口");
}

await writeFile(outputPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
await writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");

console.log(`Generated ${project.scenes.length} AI-authored scenes through ${transcript.length} production tool calls.`);
