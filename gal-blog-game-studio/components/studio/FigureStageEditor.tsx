"use client";
/* eslint-disable @next/next/no-img-element -- project figures may be IndexedDB blob URLs */

import { Move, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { PointerEvent, useRef, useState } from "react";

import {
  FIGURE_SHOT_LABELS,
  normalizeFigurePosition,
  normalizeFigureTransform,
  recommendedFigureTransform,
  WEBGAL_STAGE_HEIGHT,
  WEBGAL_STAGE_WIDTH,
  webgalFigureBaseLayout,
  type FigureShot,
} from "@/lib/story/figureFraming";
import type { StagePosition, StageTransform, StoryAsset } from "@/lib/story/types";

export type FigureStageLayout = {
  position: StagePosition;
  transform: StageTransform;
};

type Props = {
  asset?: StoryAsset;
  assetUrl?: string;
  backgroundUrl?: string;
  characterName: string;
  position: StagePosition;
  transform: StageTransform;
  shot: FigureShot;
  onCommit: (layout: FigureStageLayout) => void;
  onReset?: () => void;
  compact?: boolean;
};

const POSITION_LABELS: Array<{ value: StagePosition; label: string }> = [
  { value: "left", label: "左" },
  { value: "center", label: "中" },
  { value: "right", label: "右" },
];

export function FigureStageEditor({
  asset,
  assetUrl,
  backgroundUrl,
  characterName,
  position,
  transform,
  shot,
  onCommit,
  onReset,
  compact = false,
}: Props) {
  const initialLayout: FigureStageLayout = {
    position: normalizeFigurePosition(position),
    transform: normalizeFigureTransform(transform),
  };
  const layoutKey = [
    assetUrl || "no-asset",
    initialLayout.position,
    initialLayout.transform.x,
    initialLayout.transform.y,
    initialLayout.transform.scale,
    asset?.metadata?.figureVisibleTop,
    asset?.metadata?.figureVisibleBottom,
  ].join(":");

  return (
    <FigureStageEditorSession
      key={layoutKey}
      asset={asset}
      assetUrl={assetUrl}
      backgroundUrl={backgroundUrl}
      characterName={characterName}
      shot={shot}
      onCommit={onCommit}
      onReset={onReset}
      compact={compact}
      initialLayout={initialLayout}
    />
  );
}

type SessionProps = Omit<Props, "position" | "transform"> & {
  initialLayout: FigureStageLayout;
};

function FigureStageEditorSession({
  asset,
  assetUrl,
  backgroundUrl,
  characterName,
  shot,
  onCommit,
  onReset,
  compact = false,
  initialLayout,
}: SessionProps) {
  const [draft, setDraft] = useState<FigureStageLayout>(initialLayout);
  const draftRef = useRef(draft);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | undefined>(undefined);

  const updateDraft = (next: FigureStageLayout) => {
    draftRef.current = next;
    setDraft(next);
  };

  const commit = (next = draftRef.current) => {
    const normalized = {
      position: normalizeFigurePosition(next.position),
      transform: normalizeFigureTransform(next.transform),
    };
    updateDraft(normalized);
    onCommit(normalized);
  };

  const setPosition = (nextPosition: StagePosition) => {
    const next = { ...draft, position: nextPosition };
    updateDraft(next);
    commit(next);
  };

  const setShot = (nextShot: FigureShot) => {
    const preset = recommendedFigureTransform(asset, nextShot);
    const next = {
      ...draft,
      transform: normalizeFigureTransform({
        ...draft.transform,
        scale: preset.scale,
        y: preset.y,
      }),
    };
    updateDraft(next);
    commit(next);
  };

  const nudgeScale = (delta: number) => {
    const next = {
      ...draft,
      transform: normalizeFigureTransform({
        ...draft.transform,
        scale: (draft.transform.scale ?? 1) + delta,
      }),
    };
    updateDraft(next);
    commit(next);
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!assetUrl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: draft.transform.x ?? 0,
      originY: draft.transform.y ?? 0,
    };
  };

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const current = draftRef.current;
    updateDraft({
      ...current,
      transform: normalizeFigureTransform({
        ...current.transform,
        x: active.originX + ((event.clientX - active.startX) / bounds.width) * 2560,
        y: active.originY + ((event.clientY - active.startY) / bounds.height) * 1440,
      }),
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
    commit();
  };

  const updateTransform = (key: "x" | "y" | "scale", value: number) => {
    const current = draftRef.current;
    updateDraft({
      ...current,
      transform: normalizeFigureTransform({ ...current.transform, [key]: value }),
    });
  };

  const x = draft.transform.x ?? 0;
  const y = draft.transform.y ?? 0;
  const scale = draft.transform.scale ?? 1;
  const base = webgalFigureBaseLayout(asset, draft.position);
  const characterStyle = {
    width: `${(base.fittedWidth / WEBGAL_STAGE_WIDTH) * 100}%`,
    height: `${(base.fittedHeight / WEBGAL_STAGE_HEIGHT) * 100}%`,
    left: `${((base.baseX + x) / WEBGAL_STAGE_WIDTH) * 100}%`,
    top: `${((base.baseY + y) / WEBGAL_STAGE_HEIGHT) * 100}%`,
    transform: `translate(-50%, -50%) scale(${scale})`,
  };

  return (
    <section className={`figure-stage-editor ${compact ? "is-compact" : ""}`} data-testid="figure-stage-editor">
      <header>
        <div>
          <span>角色构图</span>
          <strong>{characterName}</strong>
        </div>
        <p><Move size={13} /> WebGAL 2560×1440 实机坐标</p>
      </header>
      <div
        className="figure-stage-editor__stage"
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid="figure-stage-canvas"
      >
        {backgroundUrl ? <img className="figure-stage-editor__background" src={backgroundUrl} alt="" /> : <div className="figure-stage-editor__empty-bg" />}
        <div className="figure-stage-editor__grid" />
        <div className="figure-stage-editor__dialogue-safe"><span>对话框安全区</span></div>
        {assetUrl ? (
          <img
            className="figure-stage-editor__figure"
            src={assetUrl}
            alt={characterName}
            draggable={false}
            style={characterStyle}
          />
        ) : (
          <div className="figure-stage-editor__missing">当前差分没有可显示的图片</div>
        )}
        <span className="figure-stage-editor__hint">拖动调整画面位置 · 下方滑杆精调</span>
      </div>
      <div className="figure-stage-editor__presets">
        <div>
          <span>站位</span>
          <div className="figure-stage-editor__segments" data-testid="figure-position-presets">
            {POSITION_LABELS.map((item) => (
              <button key={item.value} className={draft.position === item.value ? "active" : ""} onClick={() => setPosition(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span>镜头</span>
          <div className="figure-stage-editor__segments figure-stage-editor__segments--shots" data-testid="figure-shot-presets">
            {(Object.keys(FIGURE_SHOT_LABELS) as FigureShot[]).map((item) => (
              <button key={item} className={shot === item ? "active" : ""} onClick={() => setShot(item)}>
                {FIGURE_SHOT_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="figure-stage-editor__sliders">
        <label>
          <span>横向</span>
          <input
            aria-label="角色横向位置"
            type="range"
            min="-900"
            max="900"
            step="5"
            value={Math.round(x)}
            onChange={(event) => updateTransform("x", Number(event.target.value))}
            onPointerUp={() => commit()}
            onBlur={() => commit()}
          />
          <b>{Math.round(x)}</b>
        </label>
        <label>
          <span>上下</span>
          <input
            aria-label="角色上下位置"
            type="range"
            min="-420"
            max="920"
            step="5"
            value={Math.round(y)}
            onChange={(event) => updateTransform("y", Number(event.target.value))}
            onPointerUp={() => commit()}
            onBlur={() => commit()}
          />
          <b>{Math.round(y)}</b>
        </label>
        <label>
          <span>缩放</span>
          <button aria-label="缩小角色" onClick={() => nudgeScale(-0.08)}><ZoomOut size={14} /></button>
          <input
            aria-label="角色缩放"
            type="range"
            min="0.45"
            max="2.8"
            step="0.01"
            value={scale}
            onChange={(event) => updateTransform("scale", Number(event.target.value))}
            onPointerUp={() => commit()}
            onBlur={() => commit()}
          />
          <button aria-label="放大角色" onClick={() => nudgeScale(0.08)}><ZoomIn size={14} /></button>
          <b>{scale.toFixed(2)}×</b>
        </label>
      </div>
      {onReset && (
        <button className="figure-stage-editor__reset" onClick={onReset}>
          <RotateCcw size={13} /> 恢复系统推荐构图
        </button>
      )}
    </section>
  );
}
