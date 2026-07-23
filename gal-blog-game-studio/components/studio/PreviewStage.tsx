"use client";

import { Bot, Check, ChevronRight, ExternalLink, RotateCcw, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import {
  choiceEnabled,
  chooseRuntime,
  createRuntime,
  interpolate,
  resolveAiRuntime,
  resolveBlogRuntime,
  stepRuntime,
  submitInputRuntime,
  visibleChoices,
  type RuntimeState,
} from "@/lib/story/runtime";
import type { StoryProject } from "@/lib/story/types";

type Props = {
  project: StoryProject;
  sceneId: string;
  compact?: boolean;
  onBridgeEvent?: (message: string) => void;
};

function assetLabel(project: StoryProject, id?: string): string {
  return project.assets.find((asset) => asset.id === id)?.name || "未设置";
}

function PreviewStageSession({ project, sceneId, compact = false, onBridgeEvent }: Props) {
  const [runtime, setRuntime] = useState<RuntimeState>(() => stepRuntime(project, createRuntime(project, sceneId)));
  const [input, setInput] = useState("");

  const scene = project.scenes.find((item) => item.id === runtime.sceneId);
  const block = runtime.currentBlock;
  const background = project.assets.find((asset) => asset.id === runtime.backgroundAssetId);
  const bgKey = background?.id || "none";
  const currentDialogue = block?.type === "dialogue"
    ? {
        speaker: project.characters.find((character) => character.id === block.characterId)?.displayName || "角色",
        text: interpolate(block.text, runtime.variables),
      }
    : block?.type === "narration"
      ? { speaker: runtime.mode === "nvl" ? "NVL" : "旁白", text: interpolate(block.text, runtime.variables) }
      : undefined;
  const nvlLines = useMemo(() => runtime.log.slice(-5), [runtime.log]);

  const advance = () => setRuntime((value) => stepRuntime(project, value));
  const reset = () => {
    setInput("");
    setRuntime(stepRuntime(project, createRuntime(project, sceneId)));
  };
  const submitValue = (value: string) => {
    if (block?.type === "input" && block.targets.some((target) => target === "blog" || target === "ai")) {
      onBridgeEvent?.(`player-input → ${block.targets.join("+")}`);
    }
    setRuntime((runtimeState) => submitInputRuntime(project, runtimeState, value));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    submitValue(input);
    setInput("");
  };

  const resolveBridge = (result: "success" | "failure" | "cancel") => {
    if (block?.type === "blog-action") onBridgeEvent?.(`${block.action} → ${result}`);
    setRuntime((value) => resolveBlogRuntime(project, value, result));
  };

  return (
    <section className={`preview-stage ${compact ? "preview-stage--compact" : ""}`} data-bg={bgKey}>
      <div className="preview-stage__backdrop">
        <div className="preview-stage__light preview-stage__light--one" />
        <div className="preview-stage__light preview-stage__light--two" />
        <div className="preview-stage__architecture">
          <span />
          <span />
          <span />
        </div>
        <div className="preview-stage__caption">
          <span>BACKGROUND</span>
          {assetLabel(project, runtime.backgroundAssetId)}
        </div>
      </div>

      <header className="preview-stage__hud">
        <div>
          <span className={`mode-chip mode-chip--${runtime.mode}`}>{runtime.mode.toUpperCase()}</span>
          <strong>{scene?.name || "场景结束"}</strong>
        </div>
        <button className="icon-button icon-button--glass" onClick={reset} title="重新开始预览" aria-label="重新开始预览">
          <RotateCcw size={15} />
        </button>
      </header>

      <div className="preview-stage__figures">
        {runtime.figures.filter((figure) => figure.visible).map((figure) => {
          const character = project.characters.find((item) => item.id === figure.characterId);
          const expression = character?.expressions.find((item) => item.id === figure.expressionId);
          return (
            <div className={`preview-figure preview-figure--${figure.position}`} key={figure.characterId}>
              <div className="preview-figure__halo" />
              <div className="preview-figure__head">
                <span />
              </div>
              <div className="preview-figure__body" />
              <div className="preview-figure__label">
                <strong>{character?.displayName || "未知角色"}</strong>
                <span>{expression?.name || "默认表情"} · {figure.position}</span>
              </div>
            </div>
          );
        })}
      </div>

      {runtime.mode === "nvl" && (
        <div className="nvl-layer" style={{ background: `rgba(7, 10, 20, ${runtime.dimBackground || 0.38})` }}>
          <div className="nvl-layer__rule" />
          <div className="nvl-layer__text">
            {nvlLines.map((line) => <p key={`${line.blockId}-${line.text}`}>{line.text}</p>)}
          </div>
        </div>
      )}

      {currentDialogue && runtime.mode === "adv" && (
        <button className="dialogue-box" onClick={advance}>
          <span className="dialogue-box__speaker">{currentDialogue.speaker}</span>
          <span className="dialogue-box__text">{currentDialogue.text}</span>
          <ChevronRight className="dialogue-box__next" size={18} />
        </button>
      )}

      {currentDialogue && runtime.mode === "nvl" && (
        <button className="nvl-next" onClick={advance} aria-label="继续">
          <ChevronRight size={18} />
        </button>
      )}

      {runtime.waitingFor === "choice" && block?.type === "choice" && (
        <div className="runtime-overlay runtime-overlay--choices">
          {block.prompt && <p>{block.prompt}</p>}
          {visibleChoices(block, runtime).map((option) => {
            const enabled = choiceEnabled(option, runtime);
            return (
              <button key={option.id} disabled={!enabled} onClick={() => setRuntime((value) => chooseRuntime(project, value, option.id))}>
                <span>{option.label}</span>
                {option.condition && <small>{option.condition}</small>}
                <ChevronRight size={16} />
              </button>
            );
          })}
        </div>
      )}

      {runtime.waitingFor === "input" && block?.type === "input" && (
        <div className="runtime-overlay runtime-overlay--panel">
          <span className="eyebrow">PLAYER INPUT</span>
          <h3>{block.title}</h3>
          {block.fixedOptions?.map((option) => (
            <button className="runtime-fixed-option" key={option.id} onClick={() => submitValue(option.value)}>
              {option.label}
            </button>
          ))}
          {block.allowFreeText && (
            <form onSubmit={submit}>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={block.placeholder || block.defaultValue || "输入文字…"} />
              <button type="submit">{block.buttonText || "确认"}</button>
            </form>
          )}
          <div className="runtime-targets">
            {block.targets.map((target) => <span key={target}>{target}</span>)}
          </div>
        </div>
      )}

      {runtime.waitingFor === "blog" && block?.type === "blog-action" && (
        <div className="runtime-overlay runtime-overlay--panel">
          <span className="eyebrow">BLOG BRIDGE</span>
          <h3>{block.action}</h3>
          <p>复杂表单由 gal-blog 弹出，完成结果回到当前剧情。</p>
          <pre>{JSON.stringify(block.payload || {}, null, 2)}</pre>
          <div className="runtime-actions">
            <button onClick={() => resolveBridge("success")}><Check size={15} /> 模拟成功</button>
            <button onClick={() => resolveBridge("failure")}><X size={15} /> 模拟失败</button>
            <button onClick={() => resolveBridge("cancel")}>取消</button>
          </div>
        </div>
      )}

      {runtime.waitingFor === "ai" && block?.type === "ai-turn" && (
        <div className="runtime-overlay runtime-overlay--panel">
          <span className="eyebrow"><Bot size={14} /> LIVE AI TURN</span>
          <h3>受约束剧情操作</h3>
          <p>{block.prompt}</p>
          <div className="runtime-targets">
            {(block.allowedTools || []).slice(0, 6).map((tool) => <span key={tool}>{tool}</span>)}
          </div>
          <button className="runtime-primary" onClick={() => setRuntime((value) => resolveAiRuntime(project, value))}>
            使用 fallback 继续 <ChevronRight size={16} />
          </button>
        </div>
      )}

      {runtime.waitingFor === "end" && (
        <div className="runtime-overlay runtime-overlay--end">
          <span>SCENE COMPLETE</span>
          <strong>{scene?.name}</strong>
          <button onClick={reset}><RotateCcw size={14} /> 重玩场景</button>
        </div>
      )}

      <footer className="preview-stage__footer">
        <span>BGM · {assetLabel(project, runtime.bgmAssetId)}</span>
        <span>BLOCK {Math.max(0, runtime.blockIndex)}/{scene?.blocks.length || 0}</span>
        <span><ExternalLink size={12} /> Blog Bridge ready</span>
      </footer>
    </section>
  );
}

export function PreviewStage(props: Props) {
  return <PreviewStageSession key={`${props.sceneId}:${props.project.updatedAt}`} {...props} />;
}
