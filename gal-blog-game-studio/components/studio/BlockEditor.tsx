"use client";

import {
  ArrowDown,
  ArrowUp,
  Bot,
  Braces,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Code2,
  Copy,
  FileText,
  GitBranch,
  ImageIcon,
  Keyboard,
  MessageSquareText,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { compileScene } from "@/lib/story/compiler";
import { importStoryText } from "@/lib/story/importers";
import { presetsForStageAction, WEBGAL_ANIMATION_PRESETS } from "@/lib/story/performancePresets";
import type { Easing, StageBlock, StagePosition, StoryBlock, StoryProject, StoryScene } from "@/lib/story/types";
import { createId, deepClone, slugify } from "@/lib/story/utils";

type Props = {
  project: StoryProject;
  sceneId: string;
  onChange: (project: StoryProject, label: string, actor?: "human" | "ai" | "import") => void;
  onPreview: () => void;
};

type EditorView = "blocks" | "ai-script" | "webgal";

const blockLabels: Record<StoryBlock["type"], string> = {
  dialogue: "对白",
  narration: "旁白 / NVL",
  stage: "舞台演出",
  choice: "选择项",
  input: "自由输入",
  condition: "条件分支",
  variable: "变量操作",
  jump: "场景跳转",
  mode: "ADV / NVL",
  "save-point": "存档点",
  "blog-action": "Blog 动作",
  "ai-turn": "实时 AI",
  native: "WebGAL 原生",
  comment: "注释",
};

const stageActionLabels: Record<StageBlock["action"], string> = {
  "set-background": "切换背景",
  "play-bgm": "播放 / 切换 BGM",
  "stop-bgm": "停止 BGM",
  "play-sfx": "播放音效",
  "enter-character": "角色入场",
  "exit-character": "角色退场",
  "move-character": "移动 / 变换角色",
  "set-expression": "切换表情",
  "clear-stage": "清空全部立绘",
  transition: "播放 WebGAL 动画",
  wait: "等待",
};

const easingOptions: Array<{ value: Easing; label: string }> = [
  { value: "linear", label: "匀速 linear" },
  { value: "easeIn", label: "缓入 easeIn" },
  { value: "easeOut", label: "缓出 easeOut" },
  { value: "easeInOut", label: "缓入缓出 easeInOut" },
  { value: "circIn", label: "圆弧缓入 circIn" },
  { value: "circOut", label: "圆弧缓出 circOut" },
  { value: "circInOut", label: "圆弧缓入缓出 circInOut" },
  { value: "backIn", label: "回拉缓入 backIn" },
  { value: "backOut", label: "回拉缓出 backOut" },
  { value: "backInOut", label: "回拉双向 backInOut" },
  { value: "bounceIn", label: "弹跳缓入 bounceIn" },
  { value: "bounceOut", label: "弹跳缓出 bounceOut" },
  { value: "bounceInOut", label: "弹跳双向 bounceInOut" },
  { value: "anticipate", label: "预备动作 anticipate" },
];

function BlockIcon({ type }: { type: StoryBlock["type"] }) {
  if (type === "dialogue") return <MessageSquareText size={15} />;
  if (type === "narration") return <FileText size={15} />;
  if (type === "stage") return <ImageIcon size={15} />;
  if (type === "choice" || type === "condition" || type === "jump") return <GitBranch size={15} />;
  if (type === "input") return <Keyboard size={15} />;
  if (type === "variable") return <Braces size={15} />;
  if (type === "save-point") return <Save size={15} />;
  if (type === "blog-action") return <ClipboardList size={15} />;
  if (type === "ai-turn") return <Bot size={15} />;
  if (type === "native") return <Code2 size={15} />;
  return <CircleHelp size={15} />;
}

function createBlock(type: StoryBlock["type"], project: StoryProject): StoryBlock {
  const id = createId(type);
  const character = project.characters[0];
  const variable = project.variables[0];
  const scene = project.scenes[0];
  if (type === "dialogue") return { id, type, characterId: character?.id || "unresolved:角色", expressionId: character?.defaultExpressionId, text: "新的台词", source: "human" };
  if (type === "narration") return { id, type, text: "新的旁白。", source: "human" };
  if (type === "stage") return {
    id,
    type,
    action: "set-background",
    assetId: project.assets.find((asset) => asset.kind === "background")?.id,
    transition: { name: "enter", durationMs: 800, easing: "easeInOut" },
    source: "human",
  };
  if (type === "choice") return { id, type, prompt: "选择接下来的行动", options: [{ id: createId("option"), label: "新的选项", targetSceneId: scene?.id }], source: "human" };
  if (type === "input") return { id, type, variableId: variable?.id || "unresolved:input", title: "请输入", buttonText: "确认", allowFreeText: true, targets: ["story"], source: "human" };
  if (type === "condition") return { id, type, branches: [{ id: createId("branch"), targetSceneId: scene?.id || "", label: "默认分支" }], source: "human" };
  if (type === "variable") return { id, type, operations: [{ variableId: variable?.id || "unresolved:var", operation: "set", value: true }], source: "human" };
  if (type === "jump") return { id, type, targetSceneId: scene?.id, source: "human" };
  if (type === "mode") return { id, type, mode: "nvl", dimBackground: 0.38, source: "human" };
  if (type === "save-point") return { id, type, savePointId: project.savePoints[0]?.id || "unresolved:save", source: "human" };
  if (type === "blog-action") return { id, type, action: "open-article", payload: { slug: "article-slug" }, source: "human" };
  if (type === "ai-turn") return { id, type, characterIds: character ? [character.id] : [], configId: project.aiConfigs.find((config) => config.mode === "live")?.id, prompt: "根据玩家输入继续当前剧情。", allowedTools: ["add_dialogue", "set_expression", "add_choice"], maxOperations: 6, source: "human" };
  if (type === "native") return { id, type, engine: "webgal", script: "; 在这里输入高级 WebGAL 指令", source: "native" };
  return { id, type: "comment", text: "作者注释", source: "human" };
}

function summary(block: StoryBlock, project: StoryProject): { title: string; body: string; meta?: string } {
  if (block.type === "dialogue") {
    const character = project.characters.find((item) => item.id === block.characterId);
    const expression = character?.expressions.find((item) => item.id === block.expressionId);
    return { title: character?.displayName || "未绑定角色", body: block.text, meta: `${expression?.name || "默认表情"} · ${block.position || "保持站位"}` };
  }
  if (block.type === "narration") return { title: block.mode === "nvl" ? "NVL 叙述" : "旁白", body: block.text, meta: block.hold ? "累积显示" : undefined };
  if (block.type === "stage") {
    const asset = project.assets.find((item) => item.id === block.assetId);
    return {
      title: blockLabels.stage,
      body: `${stageActionLabels[block.action]} · ${asset?.name || block.characterId || block.animationTarget || "未设置"}`,
      meta: block.transition ? `${block.transition.name} / ${block.transition.durationMs || 0}ms` : block.durationMs ? `${block.durationMs}ms` : undefined,
    };
  }
  if (block.type === "choice") return { title: block.prompt || "选择项", body: block.options.map((option) => option.label).join(" / "), meta: `${block.options.length} 个选项` };
  if (block.type === "input") return { title: block.title, body: `${block.fixedOptions?.length || 0} 个固定选项 + ${block.allowFreeText ? "自由输入" : "无自由输入"}`, meta: block.targets.join(" · ") };
  if (block.type === "blog-action") return { title: "Blog Bridge", body: block.action, meta: JSON.stringify(block.payload || {}) };
  if (block.type === "ai-turn") return { title: "实时 AI 回合", body: block.prompt || "等待玩家自由输入", meta: `${block.allowedTools?.length || 0} 个工具 · 最多 ${block.maxOperations || 6} 次操作` };
  if (block.type === "native") return { title: "WebGAL 原生指令", body: block.script, meta: block.unsafe ? "unsafe" : "保留原样" };
  if (block.type === "mode") return { title: "表现模式", body: block.mode.toUpperCase(), meta: block.mode === "nvl" ? `遮罩 ${block.dimBackground ?? 0.38}` : undefined };
  if (block.type === "variable") return { title: "变量操作", body: block.operations.map((operation) => `${operation.variableId} ${operation.operation} ${String(operation.value ?? operation.expression ?? "")}`).join(", ") };
  if (block.type === "jump") return { title: "跳转", body: project.scenes.find((scene) => scene.id === block.targetSceneId)?.name || block.targetRouteNodeId || "未设置" };
  if (block.type === "condition") return { title: "条件分支", body: block.branches.map((branch) => branch.condition || "else").join(" / ") };
  if (block.type === "save-point") return { title: "存档点", body: project.savePoints.find((point) => point.id === block.savePointId)?.name || block.savePointId };
  return { title: blockLabels[block.type], body: block.type === "comment" ? block.text : "" };
}

function toAiScript(scene: StoryScene, project: StoryProject): string {
  const lines = [`# ${scene.name}`, `# Story IR scene: ${scene.id}`, ""];
  const metadata = (block: StoryBlock) => ` @meta=${encodeURIComponent(JSON.stringify(block))}`;
  scene.blocks.forEach((block) => {
    if (block.type === "dialogue") {
      const character = project.characters.find((item) => item.id === block.characterId);
      const expression = character?.expressions.find((item) => item.id === block.expressionId);
      lines.push(`${character?.displayName || block.characterId} "${block.text}"  # @id=${block.id}${expression ? ` @expression=${expression.name}` : ""}${metadata(block)}`);
    } else if (block.type === "narration") lines.push(`"${block.text}"  # @id=${block.id}${metadata(block)}`);
    else if (block.type === "stage" && block.action === "set-background") lines.push(`scene ${project.assets.find((asset) => asset.id === block.assetId)?.name || block.assetId} with ${block.transition?.name || "enter"} duration ${(block.transition?.durationMs || 500) / 1000}  # @id=${block.id}${metadata(block)}`);
    else if (block.type === "stage" && block.action === "play-bgm") lines.push(`play music ${JSON.stringify(project.assets.find((asset) => asset.id === block.assetId)?.name || block.assetId)} volume ${Math.round((block.volume ?? 1) * 100)}%${block.loop === false ? "" : " loop"}  # @id=${block.id}${metadata(block)}`);
    else if (block.type === "stage" && block.action === "enter-character") {
      const character = project.characters.find((item) => item.id === block.characterId);
      const expression = character?.expressions.find((item) => item.id === block.expressionId);
      lines.push(`show ${character?.displayName || block.characterId} ${expression?.name || ""} at ${block.position || "center"}  # @id=${block.id}${metadata(block)}`.trim());
    } else if (block.type === "stage" && block.action === "exit-character") lines.push(`hide ${project.characters.find((item) => item.id === block.characterId)?.displayName || block.characterId}  # @id=${block.id}${metadata(block)}`);
    else if (block.type === "stage" && block.action === "wait") lines.push(`pause ${(block.durationMs || 500) / 1000}  # @id=${block.id}${metadata(block)}`);
    else if (block.type === "mode") lines.push(`# studio mode: ${JSON.stringify(block)}`);
    else if (block.type === "native") lines.push(`# studio native: ${JSON.stringify(block)}`);
    else lines.push(`# studio ${block.type}: ${JSON.stringify(block)}`);
  });
  return lines.join("\n");
}

export function BlockEditor({ project, sceneId, onChange, onPreview }: Props) {
  const scene = project.scenes.find((item) => item.id === sceneId) || project.scenes[0];
  const [selectedBlockId, setSelectedBlockId] = useState<string | undefined>(scene?.blocks[0]?.id);
  const [view, setView] = useState<EditorView>("blocks");
  const [addOpen, setAddOpen] = useState(false);
  const [scriptDraft, setScriptDraft] = useState(() => scene ? toAiScript(scene, project) : "");
  const effectiveSelectedBlockId = scene?.blocks.some((block) => block.id === selectedBlockId) ? selectedBlockId : scene?.blocks[0]?.id;
  const selectedBlock = scene?.blocks.find((block) => block.id === effectiveSelectedBlockId);
  const compiled = useMemo(() => scene ? compileScene(project, scene).script : "", [project, scene]);

  if (!scene) return <div className="empty-state">项目中还没有场景。</div>;

  const updateScene = (nextScene: StoryScene, label: string, actor: "human" | "ai" | "import" = "human") => {
    onChange({ ...project, scenes: project.scenes.map((item) => item.id === scene.id ? nextScene : item) }, label, actor);
  };
  const updateBlock = (patch: Partial<StoryBlock>) => {
    if (!selectedBlock) return;
    updateScene({ ...scene, blocks: scene.blocks.map((block) => block.id === selectedBlock.id ? { ...block, ...patch } as StoryBlock : block) }, `编辑${blockLabels[selectedBlock.type]}`);
  };
  const addBlock = (type: StoryBlock["type"]) => {
    const block = createBlock(type, project);
    updateScene({ ...scene, blocks: [...scene.blocks, block] }, `添加${blockLabels[type]}`);
    setSelectedBlockId(block.id);
    setAddOpen(false);
  };
  const removeBlock = (id: string) => {
    updateScene({ ...scene, blocks: scene.blocks.filter((block) => block.id !== id) }, "删除剧情块");
  };
  const duplicateBlock = (block: StoryBlock) => {
    const clone = { ...deepClone(block), id: createId(block.type) };
    const index = scene.blocks.findIndex((item) => item.id === block.id);
    const blocks = [...scene.blocks];
    blocks.splice(index + 1, 0, clone);
    updateScene({ ...scene, blocks }, "复制剧情块");
    setSelectedBlockId(clone.id);
  };
  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= scene.blocks.length) return;
    const blocks = [...scene.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    updateScene({ ...scene, blocks }, "调整剧情块顺序");
  };
  const syncScript = () => {
    const result = importStoryText(scriptDraft, project, "renpy");
    if (!result.blocks.length) return;
    updateScene({ ...scene, blocks: result.blocks }, "从 AI / Ren'Py 脚本同步剧情块", "import");
    setView("blocks");
  };

  return (
    <div className="editor-workspace">
      <header className="editor-header">
        <div>
          <div className="editor-breadcrumb"><span>{project.chapters.find((chapter) => chapter.id === scene.chapterId)?.name}</span><ChevronRight size={12} /><strong>{scene.name}</strong></div>
          <div className="editor-title-row">
            <input className="editor-scene-title" value={scene.name} onChange={(event) => updateScene({ ...scene, name: event.target.value }, "重命名场景")} />
            <select
              className={`mode-chip mode-chip--${scene.mode} editor-mode-select`}
              value={scene.mode}
              onChange={(event) => updateScene({ ...scene, mode: event.target.value as StoryScene["mode"] }, "切换场景表现模式")}
              aria-label="场景表现模式"
            >
              <option value="adv">ADV</option>
              <option value="nvl">NVL</option>
            </select>
            <span className="editor-count">{scene.blocks.length} BLOCKS</span>
          </div>
        </div>
        <div className="editor-actions">
          <div className="segmented">
            <button className={view === "blocks" ? "active" : ""} onClick={() => setView("blocks")}><Sparkles size={13} /> 块</button>
            <button className={view === "ai-script" ? "active" : ""} onClick={() => { setScriptDraft(toAiScript(scene, project)); setView("ai-script"); }}><Code2 size={13} /> AI 剧本</button>
            <button className={view === "webgal" ? "active" : ""} onClick={() => setView("webgal")}><Braces size={13} /> WebGAL</button>
          </div>
          <button className="primary-button" onClick={onPreview}><Play size={14} fill="currentColor" /> 从此场景预览</button>
        </div>
      </header>

      {view === "blocks" && (
        <div className="block-editor-layout">
          <div className="block-list">
            <div className="block-list__lead">
              <span>SCENE FLOW</span>
              <small>Story IR 是源数据 · 可局部修改</small>
            </div>
            {scene.blocks.map((block, index) => {
              const item = summary(block, project);
              return (
                <article key={block.id} className={`story-block story-block--${block.type} ${effectiveSelectedBlockId === block.id ? "selected" : ""} ${block.disabled ? "disabled" : ""}`} onClick={() => setSelectedBlockId(block.id)}>
                  <div className="story-block__rail"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>
                  <div className="story-block__icon"><BlockIcon type={block.type} /></div>
                  <div className="story-block__content">
                    <span className="story-block__kind">{blockLabels[block.type]}</span>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                    {item.meta && <small>{item.meta}</small>}
                  </div>
                  <div className="story-block__tools">
                    <button onClick={(event) => { event.stopPropagation(); moveBlock(index, -1); }} disabled={index === 0} aria-label="上移"><ArrowUp size={13} /></button>
                    <button onClick={(event) => { event.stopPropagation(); moveBlock(index, 1); }} disabled={index === scene.blocks.length - 1} aria-label="下移"><ArrowDown size={13} /></button>
                    <button onClick={(event) => { event.stopPropagation(); duplicateBlock(block); }} aria-label="复制"><Copy size={13} /></button>
                    <button onClick={(event) => { event.stopPropagation(); removeBlock(block.id); }} aria-label="删除"><Trash2 size={13} /></button>
                  </div>
                </article>
              );
            })}
            <div className="add-block-wrap">
              <button className="add-block-button" onClick={() => setAddOpen((value) => !value)}><Plus size={15} /> 添加剧情块</button>
              {addOpen && (
                <div className="add-block-menu">
                  {(Object.keys(blockLabels) as StoryBlock["type"][]).map((type) => (
                    <button key={type} onClick={() => addBlock(type)}><BlockIcon type={type} /><span>{blockLabels[type]}</span></button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <aside className="block-inspector">
            {selectedBlock ? (
              <>
                <div className="inspector-title">
                  <span><BlockIcon type={selectedBlock.type} /> {blockLabels[selectedBlock.type]}</span>
                </div>
                <label>Block ID<input value={selectedBlock.id} disabled /></label>
                {selectedBlock.type === "dialogue" && (
                  <>
                    <label>角色<select value={selectedBlock.characterId} onChange={(event) => updateBlock({ characterId: event.target.value })}>{project.characters.map((character) => <option key={character.id} value={character.id}>{character.displayName}</option>)}</select></label>
                    <label>表情<select value={selectedBlock.expressionId || ""} onChange={(event) => updateBlock({ expressionId: event.target.value || undefined })}><option value="">默认</option>{project.characters.find((character) => character.id === selectedBlock.characterId)?.expressions.map((expression) => <option key={expression.id} value={expression.id}>{expression.name}</option>)}</select></label>
                    <label>站位<select value={selectedBlock.position || ""} onChange={(event) => updateBlock({ position: event.target.value as StagePosition || undefined })}><option value="">保持舞台状态</option>{["far-left", "left", "center", "right", "far-right"].map((item) => <option key={item}>{item}</option>)}</select></label>
                    <label>台词<textarea value={selectedBlock.text} rows={7} onChange={(event) => updateBlock({ text: event.target.value })} /></label>
                  </>
                )}
                {selectedBlock.type === "narration" && (
                  <>
                    <label>呈现<select value={selectedBlock.mode || scene.mode} onChange={(event) => updateBlock({ mode: event.target.value as "adv" | "nvl" })}><option value="adv">ADV 旁白</option><option value="nvl">NVL 累积文本</option></select></label>
                    <label>文本<textarea value={selectedBlock.text} rows={8} onChange={(event) => updateBlock({ text: event.target.value })} /></label>
                    <label className="inline-check"><input type="checkbox" checked={selectedBlock.hold || false} onChange={(event) => updateBlock({ hold: event.target.checked })} /> 保持并累积显示</label>
                  </>
                )}
                {selectedBlock.type === "stage" && (
                  <>
                    <label>舞台动作
                      <select value={selectedBlock.action} onChange={(event) => updateBlock({ action: event.target.value as typeof selectedBlock.action })}>
                        {Object.entries(stageActionLabels).map(([action, label]) => <option key={action} value={action}>{label}</option>)}
                      </select>
                    </label>
                    {selectedBlock.action.includes("background") && <label>背景<select value={selectedBlock.assetId || ""} onChange={(event) => updateBlock({ assetId: event.target.value })}>{project.assets.filter((asset) => asset.kind === "background").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}
                    {(selectedBlock.action.includes("bgm") || selectedBlock.action === "play-sfx") && <label>音频<select value={selectedBlock.assetId || ""} onChange={(event) => updateBlock({ assetId: event.target.value })}><option value="">无</option>{project.assets.filter((asset) => ["bgm", "sfx"].includes(asset.kind)).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}
                    {(selectedBlock.action.includes("character") || selectedBlock.action.includes("expression")) && <label>角色<select value={selectedBlock.characterId || ""} onChange={(event) => updateBlock({ characterId: event.target.value })}>{project.characters.map((character) => <option key={character.id} value={character.id}>{character.displayName}</option>)}</select></label>}
                    {["enter-character", "set-expression"].includes(selectedBlock.action) && (
                      <label>表情<select value={selectedBlock.expressionId || ""} onChange={(event) => updateBlock({ expressionId: event.target.value || undefined })}><option value="">默认表情</option>{project.characters.find((character) => character.id === selectedBlock.characterId)?.expressions.map((expression) => <option key={expression.id} value={expression.id}>{expression.name}</option>)}</select></label>
                    )}
                    {["enter-character", "move-character", "set-expression"].includes(selectedBlock.action) && (
                      <label>站位<select value={selectedBlock.position || ""} onChange={(event) => updateBlock({ position: event.target.value as StagePosition || undefined })}><option value="">保持站位</option>{["far-left", "left", "center", "right", "far-right"].map((item) => <option key={item}>{item}</option>)}</select></label>
                    )}
                    {selectedBlock.action === "wait" ? (
                      <label>等待时长（ms）<input type="number" min="0" value={selectedBlock.durationMs ?? 500} onChange={(event) => updateBlock({ durationMs: Number(event.target.value) })} /></label>
                    ) : null}
                    {["play-bgm", "play-sfx"].includes(selectedBlock.action) && (
                      <>
                        <label>音量（0–1）<input type="number" min="0" max="1" step="0.05" value={selectedBlock.volume ?? 1} onChange={(event) => updateBlock({ volume: Number(event.target.value) })} /></label>
                        {selectedBlock.action === "play-bgm" && <label className="inline-check"><input type="checkbox" checked={selectedBlock.loop !== false} onChange={(event) => updateBlock({ loop: event.target.checked })} /> 循环播放</label>}
                      </>
                    )}
                    {["play-bgm", "stop-bgm"].includes(selectedBlock.action) && (
                      <label>{selectedBlock.action === "play-bgm" ? "BGM 淡入时长（ms）" : "BGM 淡出时长（ms）"}
                        <input type="number" min="0" value={selectedBlock.durationMs ?? 0} onChange={(event) => updateBlock({ durationMs: Number(event.target.value) })} />
                      </label>
                    )}
                    {presetsForStageAction(selectedBlock.action).length > 0 && (
                      <div className="performance-preset">
                        <span>WEBGAL OFFICIAL PRESETS</span>
                        <label>演出预设
                          <select
                            value={selectedBlock.transition?.name || ""}
                            onChange={(event) => {
                              const preset = WEBGAL_ANIMATION_PRESETS.find((item) => item.name === event.target.value);
                              updateBlock({
                                transition: event.target.value
                                  ? {
                                    ...selectedBlock.transition,
                                    name: event.target.value,
                                    durationMs: preset?.durationMs ?? selectedBlock.transition?.durationMs,
                                  }
                                  : undefined,
                              });
                            }}
                          >
                            <option value="">使用 WebGAL 默认效果</option>
                            {presetsForStageAction(selectedBlock.action).map((preset) => (
                              <option key={preset.name} value={preset.name}>{preset.label} · {preset.durationMs}ms</option>
                            ))}
                            {selectedBlock.transition?.name && !WEBGAL_ANIMATION_PRESETS.some((preset) => preset.name === selectedBlock.transition?.name) && (
                              <option value={selectedBlock.transition.name}>自定义 · {selectedBlock.transition.name}</option>
                            )}
                          </select>
                        </label>
                        <label>自定义动画名
                          <input
                            value={selectedBlock.transition?.name || ""}
                            onChange={(event) => updateBlock({
                              transition: event.target.value
                                ? { ...selectedBlock.transition, name: event.target.value }
                                : undefined,
                            })}
                            placeholder="可填写 animationTable 中的自定义名称"
                          />
                        </label>
                        {selectedBlock.action === "transition" ? (
                          <div className="preset-duration-note">
                            该动画时长由对应 JSON 预设决定
                            <b>{WEBGAL_ANIMATION_PRESETS.find((preset) => preset.name === selectedBlock.transition?.name)?.durationMs ?? "自定义"}ms</b>
                          </div>
                        ) : (
                          <div className="inspector-grid">
                            <label>时长（ms）
                              <input
                                type="number"
                                min="0"
                                value={selectedBlock.transition?.durationMs ?? selectedBlock.durationMs ?? 0}
                                onChange={(event) => updateBlock({
                                  transition: {
                                    name: selectedBlock.transition?.name || (["exit-character", "clear-stage"].includes(selectedBlock.action) ? "exit" : "enter"),
                                    ...selectedBlock.transition,
                                    durationMs: Number(event.target.value),
                                  },
                                })}
                              />
                            </label>
                            {!["exit-character", "clear-stage"].includes(selectedBlock.action) && (
                            <label>缓动
                              <select
                                value={selectedBlock.transition?.easing || "easeInOut"}
                                onChange={(event) => updateBlock({
                                  transition: {
                                    name: selectedBlock.transition?.name || (selectedBlock.action === "exit-character" ? "exit" : "enter"),
                                    ...selectedBlock.transition,
                                    easing: event.target.value as Easing,
                                  },
                                })}
                              >
                                {easingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </label>
                            )}
                          </div>
                        )}
                        <small>预设来自 WebGAL Terre 官方工程模板，导出时会自动写入 animationTable 与对应 JSON。</small>
                      </div>
                    )}
                    {selectedBlock.action === "transition" && (
                      <label>动画目标
                        <select value={selectedBlock.animationTarget || "stage-main"} onChange={(event) => updateBlock({ animationTarget: event.target.value })}>
                          <option value="stage-main">舞台全体</option>
                          <option value="bg-main">当前背景</option>
                          <option value="fig-left">左侧默认立绘</option>
                          <option value="fig-center">中间默认立绘</option>
                          <option value="fig-right">右侧默认立绘</option>
                          {project.characters.map((character) => <option key={character.id} value={`char-${slugify(character.name)}`}>{character.displayName}</option>)}
                        </select>
                      </label>
                    )}
                    {selectedBlock.action === "move-character" && (
                      <>
                        <div className="inspector-grid">
                          <label>X<input type="number" value={selectedBlock.transform?.x ?? 0} onChange={(event) => updateBlock({ transform: { ...selectedBlock.transform, x: Number(event.target.value) } })} /></label>
                          <label>Y<input type="number" value={selectedBlock.transform?.y ?? 0} onChange={(event) => updateBlock({ transform: { ...selectedBlock.transform, y: Number(event.target.value) } })} /></label>
                          <label>缩放<input type="number" min="0" step="0.05" value={selectedBlock.transform?.scale ?? 1} onChange={(event) => updateBlock({ transform: { ...selectedBlock.transform, scale: Number(event.target.value) } })} /></label>
                          <label>透明度<input type="number" min="0" max="1" step="0.05" value={selectedBlock.transform?.alpha ?? 1} onChange={(event) => updateBlock({ transform: { ...selectedBlock.transform, alpha: Number(event.target.value) } })} /></label>
                        </div>
                        <div className="inspector-grid">
                          <label>移动时长（ms）<input type="number" min="0" value={selectedBlock.durationMs ?? 500} onChange={(event) => updateBlock({ durationMs: Number(event.target.value) })} /></label>
                          <label>移动缓动
                            <select
                              value={selectedBlock.transition?.easing || "easeInOut"}
                              onChange={(event) => updateBlock({ transition: { name: selectedBlock.transition?.name || "transform", ...selectedBlock.transition, easing: event.target.value as Easing } })}
                            >
                              {easingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                        </div>
                      </>
                    )}
                  </>
                )}
                {selectedBlock.type === "choice" && (
                  <>
                    <label>提示<input value={selectedBlock.prompt || ""} onChange={(event) => updateBlock({ prompt: event.target.value })} /></label>
                    <div className="choice-inspector">
                      {selectedBlock.options.map((option, optionIndex) => (
                        <div key={option.id}>
                          <input value={option.label} onChange={(event) => updateBlock({ options: selectedBlock.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) })} />
                          <select value={option.targetSceneId || ""} onChange={(event) => updateBlock({ options: selectedBlock.options.map((item) => item.id === option.id ? { ...item, targetSceneId: event.target.value || undefined, targetRouteNodeId: undefined } : item) })}><option value="">继续执行下一块</option>{project.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                          <input value={option.condition || ""} onChange={(event) => updateBlock({ options: selectedBlock.options.map((item) => item.id === option.id ? { ...item, condition: event.target.value || undefined } : item) })} placeholder="显示条件（可选）" />
                          <input value={option.enabledCondition || ""} onChange={(event) => updateBlock({ options: selectedBlock.options.map((item) => item.id === option.id ? { ...item, enabledCondition: event.target.value || undefined } : item) })} placeholder="可点击条件（可选）" />
                          <button onClick={() => updateBlock({ options: selectedBlock.options.filter((_, index) => index !== optionIndex) })}><Trash2 size={12} /></button>
                        </div>
                      ))}
                      <button onClick={() => updateBlock({ options: [...selectedBlock.options, { id: createId("option"), label: "新选项", targetSceneId: scene.id }] })}><Plus size={12} /> 添加选项</button>
                    </div>
                  </>
                )}
                {selectedBlock.type === "input" && (
                  <>
                    <label>标题<input value={selectedBlock.title} onChange={(event) => updateBlock({ title: event.target.value })} /></label>
                    <label>写入变量<select value={selectedBlock.variableId} onChange={(event) => updateBlock({ variableId: event.target.value })}>{project.variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select></label>
                    <label>输入提示<input value={selectedBlock.placeholder || ""} onChange={(event) => updateBlock({ placeholder: event.target.value || undefined })} /></label>
                    <label>默认值<input value={selectedBlock.defaultValue || ""} onChange={(event) => updateBlock({ defaultValue: event.target.value || undefined })} /></label>
                    <label>确认按钮<input value={selectedBlock.buttonText || ""} onChange={(event) => updateBlock({ buttonText: event.target.value || undefined })} /></label>
                    <label className="inline-check"><input type="checkbox" checked={selectedBlock.allowFreeText} onChange={(event) => updateBlock({ allowFreeText: event.target.checked })} /> 允许自由输入</label>
                    <span className="field-title">固定选项</span>
                    <div className="choice-inspector">
                      {(selectedBlock.fixedOptions || []).map((option) => (
                        <div key={option.id}>
                          <input value={option.label} onChange={(event) => updateBlock({ fixedOptions: selectedBlock.fixedOptions?.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) })} placeholder="显示文字" />
                          <input value={option.value} onChange={(event) => updateBlock({ fixedOptions: selectedBlock.fixedOptions?.map((item) => item.id === option.id ? { ...item, value: event.target.value } : item) })} placeholder="写入值" />
                          <button onClick={() => updateBlock({ fixedOptions: selectedBlock.fixedOptions?.filter((item) => item.id !== option.id) })}><Trash2 size={12} /></button>
                        </div>
                      ))}
                      <button onClick={() => updateBlock({ fixedOptions: [...(selectedBlock.fixedOptions || []), { id: createId("fixed"), label: "新选项", value: "" }] })}><Plus size={12} /> 添加固定选项</button>
                    </div>
                    <span className="field-title">传递目标</span>
                    <div className="check-row">{(["story", "blog", "ai"] as const).map((target) => <label key={target}><input type="checkbox" checked={selectedBlock.targets.includes(target)} onChange={(event) => updateBlock({ targets: event.target.checked ? [...selectedBlock.targets, target] : selectedBlock.targets.filter((item) => item !== target) })} /> {target}</label>)}</div>
                  </>
                )}
                {selectedBlock.type === "condition" && (
                  <div className="choice-inspector">
                    {selectedBlock.branches.map((branch) => (
                      <div key={branch.id}>
                        <input value={branch.label || ""} onChange={(event) => updateBlock({ branches: selectedBlock.branches.map((item) => item.id === branch.id ? { ...item, label: event.target.value || undefined } : item) })} placeholder="分支名称" />
                        <input value={branch.condition || ""} onChange={(event) => updateBlock({ branches: selectedBlock.branches.map((item) => item.id === branch.id ? { ...item, condition: event.target.value || undefined } : item) })} placeholder="条件；留空表示 else" />
                        <select value={branch.targetSceneId} onChange={(event) => updateBlock({ branches: selectedBlock.branches.map((item) => item.id === branch.id ? { ...item, targetSceneId: event.target.value } : item) })}>{project.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                        <button onClick={() => updateBlock({ branches: selectedBlock.branches.filter((item) => item.id !== branch.id) })}><Trash2 size={12} /></button>
                      </div>
                    ))}
                    <button onClick={() => updateBlock({ branches: [...selectedBlock.branches, { id: createId("branch"), targetSceneId: scene.id, label: "新分支" }] })}><Plus size={12} /> 添加分支</button>
                  </div>
                )}
                {selectedBlock.type === "variable" && (
                  <div className="choice-inspector">
                    {selectedBlock.operations.map((operation, index) => (
                      <div key={`${operation.variableId}-${index}`}>
                        <select value={operation.variableId} onChange={(event) => updateBlock({ operations: selectedBlock.operations.map((item, itemIndex) => itemIndex === index ? { ...item, variableId: event.target.value } : item) })}>{project.variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select>
                        <select value={operation.operation} onChange={(event) => updateBlock({ operations: selectedBlock.operations.map((item, itemIndex) => itemIndex === index ? { ...item, operation: event.target.value as typeof operation.operation } : item) })}>{["set", "add", "subtract", "toggle"].map((item) => <option key={item}>{item}</option>)}</select>
                        <input value={String(operation.expression ?? operation.value ?? "")} onChange={(event) => updateBlock({ operations: selectedBlock.operations.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value, expression: undefined } : item) })} placeholder="值或表达式" />
                        <button onClick={() => updateBlock({ operations: selectedBlock.operations.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={12} /></button>
                      </div>
                    ))}
                    <button onClick={() => updateBlock({ operations: [...selectedBlock.operations, { variableId: project.variables[0]?.id || "unresolved:var", operation: "set", value: true }] })}><Plus size={12} /> 添加变量操作</button>
                  </div>
                )}
                {selectedBlock.type === "jump" && (
                  <>
                    <label>目标场景<select value={selectedBlock.targetSceneId || ""} onChange={(event) => updateBlock({ targetSceneId: event.target.value || undefined, targetRouteNodeId: undefined })}><option value="">未设置</option>{project.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label>跳转条件<input value={selectedBlock.condition || ""} onChange={(event) => updateBlock({ condition: event.target.value || undefined })} /></label>
                  </>
                )}
                {selectedBlock.type === "mode" && (
                  <>
                    <label>表现模式<select value={selectedBlock.mode} onChange={(event) => updateBlock({ mode: event.target.value as typeof selectedBlock.mode })}><option value="adv">ADV</option><option value="nvl">NVL</option></select></label>
                    {selectedBlock.mode === "nvl" && <label>背景遮罩<input type="number" min="0" max="1" step="0.05" value={selectedBlock.dimBackground ?? 0.38} onChange={(event) => updateBlock({ dimBackground: Number(event.target.value) })} /></label>}
                  </>
                )}
                {selectedBlock.type === "save-point" && (
                  <>
                    <label>存档点<select value={selectedBlock.savePointId} onChange={(event) => updateBlock({ savePointId: event.target.value })}>{project.savePoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label>
                    <label className="inline-check"><input type="checkbox" checked={selectedBlock.auto || false} onChange={(event) => updateBlock({ auto: event.target.checked })} /> 自动记录</label>
                  </>
                )}
                {selectedBlock.type === "blog-action" && (
                  <>
                    <label>动作<select value={selectedBlock.action} onChange={(event) => updateBlock({ action: event.target.value as typeof selectedBlock.action })}>{["open-article", "return-menu", "open-comment-form", "view-comments", "submit-friend-link", "upload-image", "get-user", "get-page-data", "save-progress", "launch-story", "notify-event", "custom"].map((item) => <option key={item}>{item}</option>)}</select></label>
                    <label>结果变量<select value={selectedBlock.resultVariableId || ""} onChange={(event) => updateBlock({ resultVariableId: event.target.value || undefined })}><option value="">不写入</option>{project.variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select></label>
                    <label>Payload JSON<textarea rows={7} value={JSON.stringify(selectedBlock.payload || {}, null, 2)} onChange={(event) => { try { updateBlock({ payload: JSON.parse(event.target.value) }); } catch { /* retain last valid payload */ } }} /></label>
                    {(["success", "failure", "cancel"] as const).map((result) => (
                      <label key={result}>{result} 分支<select value={selectedBlock.resultBranches?.[`${result}SceneId`] || ""} onChange={(event) => updateBlock({ resultBranches: { ...selectedBlock.resultBranches, [`${result}SceneId`]: event.target.value || undefined } })}><option value="">继续下一块</option>{project.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    ))}
                  </>
                )}
                {selectedBlock.type === "ai-turn" && (
                  <>
                    <label>AI 配置<select value={selectedBlock.configId || ""} onChange={(event) => updateBlock({ configId: event.target.value || undefined })}><option value="">未绑定</option>{project.aiConfigs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}</select></label>
                    <label>本回合提示<textarea rows={6} value={selectedBlock.prompt || ""} onChange={(event) => updateBlock({ prompt: event.target.value })} /></label>
                    <label>最大操作数<input type="number" min="1" max="30" value={selectedBlock.maxOperations ?? 6} onChange={(event) => updateBlock({ maxOperations: Number(event.target.value) })} /></label>
                    <label>Fallback 场景<select value={selectedBlock.fallbackSceneId || ""} onChange={(event) => updateBlock({ fallbackSceneId: event.target.value || undefined })}><option value="">停在当前场景</option>{project.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  </>
                )}
                {selectedBlock.type === "native" && <label>WebGAL 指令<textarea className="code-textarea" rows={14} value={selectedBlock.script} onChange={(event) => updateBlock({ script: event.target.value })} /></label>}
                {selectedBlock.type === "comment" && <label>注释<textarea rows={8} value={selectedBlock.text} onChange={(event) => updateBlock({ text: event.target.value })} /></label>}
                <label className="inline-check"><input type="checkbox" checked={selectedBlock.disabled || false} onChange={(event) => updateBlock({ disabled: event.target.checked })} /> 暂时禁用此块</label>
              </>
            ) : <div className="empty-inspector"><UserRound size={24} /><strong>选择一个剧情块</strong></div>}
          </aside>
        </div>
      )}

      {view === "ai-script" && (
        <div className="code-editor-panel">
          <div className="code-editor-panel__bar"><span>AI / REN&apos;PY-LIKE · 当前 Fragment</span><button onClick={syncScript}><Sparkles size={13} /> 解析并同步到 Story IR</button></div>
          <textarea value={scriptDraft} onChange={(event) => setScriptDraft(event.target.value)} spellCheck={false} />
          <footer><span>合法脚本同步到同一份剧情块数据；复杂演出以 <code>studio &lt;type&gt;</code> 注释保留。</span><span>Ctrl / ⌘ + Enter · 同步</span></footer>
        </div>
      )}

      {view === "webgal" && (
        <div className="code-editor-panel code-editor-panel--readonly">
          <div className="code-editor-panel__bar"><span>COMPILED WEBGAL 4.6.2 · 只读产物</span><button onClick={() => navigator.clipboard?.writeText(compiled)}><Copy size={13} /> 复制脚本</button></div>
          <pre>{compiled}</pre>
          <footer><span>请在 Story IR 或原生块中修改；重新编译不会覆盖源数据。</span><span>{compiled.split("\n").length} lines</span></footer>
        </div>
      )}
    </div>
  );
}
