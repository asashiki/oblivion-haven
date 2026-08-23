"use client";
/* eslint-disable @next/next/no-img-element -- runtime assets may be IndexedDB blob URLs */

import { Bot, Check, ChevronRight, ExternalLink, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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
import { resolveRegisteredAssetUrl } from "@/lib/assetUrl";
import { readLocalAssetFile } from "@/lib/localAssetStore";
import type { StoryProject } from "@/lib/story/types";
import { prepareWebGalPreview } from "@/lib/webgalPreview";

type Props = {
  project: StoryProject;
  sceneId: string;
  compact?: boolean;
  restartKey?: string | number;
  engine?: "studio" | "webgal";
  stagingEnabled?: boolean;
  playbackMode?: "manual" | "auto" | "fast";
  startBlockId?: string;
  onBridgeEvent?: (message: string) => void;
};

function assetLabel(project: StoryProject, id?: string): string {
  return project.assets.find((asset) => asset.id === id)?.name || "未设置";
}

function PreviewStageSession({
  project,
  sceneId,
  compact = false,
  stagingEnabled = true,
  playbackMode = "manual",
  startBlockId,
  onBridgeEvent,
}: Props) {
  const runtimeProject = useMemo(() => ({
    ...project,
    scenes: project.scenes.map((scene) => scene.id === sceneId
      ? { ...scene, staging: { enabled: stagingEnabled, cues: scene.staging?.cues || [], revision: scene.staging?.revision } }
      : scene),
  }), [project, sceneId, stagingEnabled]);
  const startBlockIndex = Math.max(0, runtimeProject.scenes.find((scene) => scene.id === sceneId)?.blocks.findIndex((block) => block.id === startBlockId) ?? 0);
  const initialChapter = project.chapters.find((chapter) => chapter.sceneIds[0] === sceneId);
  const initialChapterIndex = initialChapter ? project.chapters.findIndex((chapter) => chapter.id === initialChapter.id) : -1;
  const [runtime, setRuntime] = useState<RuntimeState>(() => stepRuntime(runtimeProject, createRuntime(runtimeProject, sceneId, startBlockIndex)));
  const [input, setInput] = useState("");
  const [showChapterIntro, setShowChapterIntro] = useState(Boolean(initialChapter));
  const [localAssetUrls, setLocalAssetUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!showChapterIntro) return;
    const timer = window.setTimeout(() => setShowChapterIntro(false), compact ? 1100 : 1700);
    return () => window.clearTimeout(timer);
  }, [compact, showChapterIntro]);

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];
    const loadFiles = async () => {
      const entries = await Promise.all(project.assets
        .filter((asset) => asset.metadata?.localFile)
        .map(async (asset) => {
          try {
            const stored = await readLocalAssetFile(asset.id);
            if (!stored || cancelled) return undefined;
            const url = URL.createObjectURL(stored.file);
            createdUrls.push(url);
            return [asset.id, url] as const;
          } catch {
            return undefined;
          }
        }));
      if (!cancelled) {
        setLocalAssetUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
      }
    };
    void loadFiles();
    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [project.assets]);

  const scene = project.scenes.find((item) => item.id === runtime.sceneId);
  const block = runtime.currentBlock;
  const background = project.assets.find((asset) => asset.id === runtime.backgroundAssetId);
  const backgroundUrl = resolveRegisteredAssetUrl(background, localAssetUrls);
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

  const advance = () => setRuntime((value) => stepRuntime(runtimeProject, value));
  const reset = () => {
    setInput("");
    setRuntime(stepRuntime(runtimeProject, createRuntime(runtimeProject, sceneId, startBlockIndex)));
  };

  useEffect(() => {
    if (playbackMode === "manual" || runtime.waitingFor !== "advance") return;
    const timer = window.setTimeout(
      () => setRuntime((value) => stepRuntime(runtimeProject, value)),
      playbackMode === "fast" ? 520 : 1650,
    );
    return () => window.clearTimeout(timer);
  }, [playbackMode, runtime.blockIndex, runtime.sceneId, runtime.waitingFor, runtimeProject]);
  const submitValue = (value: string) => {
    if (block?.type === "input" && block.targets.some((target) => target === "blog" || target === "ai")) {
      onBridgeEvent?.(`player-input → ${block.targets.join("+")}`);
    }
    setRuntime((runtimeState) => submitInputRuntime(runtimeProject, runtimeState, value));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    submitValue(input);
    setInput("");
  };

  const resolveBridge = (result: "success" | "failure" | "cancel") => {
    if (block?.type === "blog-action") onBridgeEvent?.(`${block.action} → ${result}`);
    setRuntime((value) => resolveBlogRuntime(runtimeProject, value, result));
  };

  return (
    <section className={`preview-stage ${compact ? "preview-stage--compact" : ""}`} data-bg={bgKey}>
      <div className="preview-stage__backdrop">
        {backgroundUrl ? (
          <img className="preview-stage__background-image" src={backgroundUrl} alt={background?.name || "剧情背景"} />
        ) : (
          <>
            <div className="preview-stage__light preview-stage__light--one" />
            <div className="preview-stage__light preview-stage__light--two" />
            <div className="preview-stage__architecture">
              <span />
              <span />
              <span />
            </div>
          </>
        )}
        <div className="preview-stage__vignette" />
        <div className="preview-stage__caption">
          <span>{backgroundUrl ? "背景素材" : "尚未设置背景"}</span>
          {assetLabel(project, runtime.backgroundAssetId)}
        </div>
      </div>

      {showChapterIntro && initialChapter && (
        <button className="chapter-intro-card" onClick={() => setShowChapterIntro(false)}>
          <span>CHAPTER {String(initialChapterIndex + 1).padStart(2, "0")}</span>
          <i />
          <strong>{initialChapter.name}</strong>
          {initialChapter.description && <p>{initialChapter.description}</p>}
          <small>点击跳过</small>
        </button>
      )}

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
          const figureAsset = project.assets.find((asset) => asset.id === expression?.assetId);
          const figureUrl = resolveRegisteredAssetUrl(figureAsset, localAssetUrls);
          const previewScale = typeof figureAsset?.metadata?.previewScale === "number"
            ? figureAsset.metadata.previewScale
            : 1;
          const cueClasses = runtime.activeCues
            .filter((cue) => cue.targetCharacterId === figure.characterId)
            .map((cue) => `preview-figure--cue-${cue.intent}`)
            .join(" ");
          return (
            <div
              className={`preview-figure preview-figure--${figure.position} ${cueClasses}`}
              key={figure.characterId}
              style={{ "--figure-scale": previewScale } as React.CSSProperties}
            >
              {figureUrl ? (
                <img className="preview-figure__image" src={figureUrl} alt={`${character?.displayName || "角色"} · ${expression?.name || "默认立绘"}`} />
              ) : (
                <div className="preview-figure__missing">
                  <strong>{character?.displayName || "未知角色"}</strong>
                  <span>{expression?.name || "未绑定立绘"}</span>
                </div>
              )}
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
              <button key={option.id} disabled={!enabled} onClick={() => setRuntime((value) => chooseRuntime(runtimeProject, value, option.id))}>
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
          <button className="runtime-primary" onClick={() => setRuntime((value) => resolveAiRuntime(runtimeProject, value))}>
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
        <span>{runtime.bgmAssetId ? `BGM · ${assetLabel(project, runtime.bgmAssetId)}` : "静音 · 尚未上传 BGM"}</span>
        <span>BLOCK {Math.max(0, runtime.blockIndex)}/{scene?.blocks.length || 0}</span>
        <span>{project.settings.blogBridge.enabled ? <><ExternalLink size={12} /> Blog Bridge 已启用</> : `${project.assets.length} 个真实素材`}</span>
      </footer>
    </section>
  );
}

function WebGalPreviewStage(props: Props) {
  const { project, sceneId, compact, restartKey = 0, onBridgeEvent } = props;
  const previewKey = `${project.id}:${project.updatedAt}:${sceneId}:${restartKey}`;
  const [previewState, setPreviewState] = useState<{
    key: string;
    url?: string;
    warnings: string[];
    error?: string;
    loaded: boolean;
  }>({ key: "", warnings: [], loaded: false });
  const [quickFallbackKey, setQuickFallbackKey] = useState<string>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentState = previewState.key === previewKey
    ? previewState
    : { key: previewKey, warnings: [], loaded: false };
  const showQuickFallback = quickFallbackKey === previewKey;

  useEffect(() => {
    let cancelled = false;

    void prepareWebGalPreview(project, sceneId)
      .then((result) => {
        if (cancelled) return;
        setPreviewState({
          key: previewKey,
          url: result.url,
          warnings: result.warnings,
          loaded: false,
        });
      })
      .catch((reason) => {
        if (cancelled) return;
        setPreviewState({
          key: previewKey,
          warnings: [],
          error: reason instanceof Error ? reason.message : "WebGAL 实机预览准备失败",
          loaded: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [previewKey, project, sceneId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { channel?: string; type?: string; payload?: unknown } | undefined;
      if (!data || data.channel !== project.settings.blogBridge.channel) return;
      if (data.type === "webgal-preview-started") {
        setPreviewState((state) => (
          state.key === previewKey ? { ...state, loaded: true, error: undefined } : state
        ));
      }
      onBridgeEvent?.(`${data.type || "bridge-event"}${data.payload ? " → WebGAL" : ""}`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onBridgeEvent, previewKey, project.settings.blogBridge.channel]);

  useEffect(() => {
    if (!currentState.url || currentState.loaded) return;
    const timer = window.setTimeout(() => {
      setPreviewState((state) => (
        state.key === previewKey && !state.loaded
          ? {
              key: previewKey,
              warnings: state.warnings,
              error: "WebGAL 未能在限定时间内直接进入所选片段",
              loaded: false,
            }
          : state
      ));
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [currentState.loaded, currentState.url, previewKey]);

  if (showQuickFallback) {
    return (
      <div className="webgal-preview-shell">
        <div className="webgal-preview-note webgal-preview-note--fallback">
          <TriangleAlert size={14} />
          <span>当前显示的是 Story IR 快速预览，不代表最终 WebGAL 画面。</span>
          <button onClick={() => setQuickFallbackKey(undefined)}>返回实机预览</button>
        </div>
        <PreviewStageSession key={`${sceneId}:${project.updatedAt}:${restartKey}`} {...props} />
      </div>
    );
  }

  return (
    <section className={`webgal-preview-shell ${compact ? "webgal-preview-shell--compact" : ""}`}>
      <div className="webgal-preview-frame">
        {currentState.url ? (
          <iframe
            ref={iframeRef}
            src={currentState.url}
            title="WebGAL 实机预览"
            allow="autoplay; fullscreen"
          />
        ) : (
          <div className="webgal-preview-state">
            {currentState.error ? <TriangleAlert size={24} /> : <LoaderCircle className="is-spinning" size={24} />}
            <strong>{currentState.error ? "实机预览暂不可用" : "正在编译并启动 WebGAL"}</strong>
            <p>{currentState.error || "场景脚本、资源与转场将交给官方 WebGAL 4.6.2 运行。"}</p>
            {currentState.error && (
              <button onClick={() => setQuickFallbackKey(previewKey)}>
                临时打开快速预览
              </button>
            )}
          </div>
        )}
        {currentState.url && !currentState.loaded && (
          <div className="webgal-preview-loading">
            <LoaderCircle className="is-spinning" size={20} />
            <span>WebGAL 正在载入场景…</span>
          </div>
        )}
      </div>
      <footer className="webgal-preview-meta">
        <span><i className="status-dot status-dot--live" /> 官方 WebGAL 实机</span>
        <span>{currentState.warnings.length ? currentState.warnings.join(" · ") : "背景、立绘、选择与点击逻辑均由引擎执行"}</span>
        <button onClick={() => setQuickFallbackKey(previewKey)}>快速预览</button>
      </footer>
    </section>
  );
}

export function PreviewStage(props: Props) {
  if (props.engine === "studio") {
    return <PreviewStageSession key={`${props.sceneId}:${props.project.updatedAt}:${props.restartKey}:${props.startBlockId}:${props.stagingEnabled}`} {...props} />;
  }
  return <WebGalPreviewStage {...props} />;
}
