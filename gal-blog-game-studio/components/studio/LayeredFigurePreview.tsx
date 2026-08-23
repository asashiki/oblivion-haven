"use client";

import { useEffect, useRef, useState } from "react";

import {
  LayeredFigureRenderer,
  type FigureRenderState,
} from "@/lib/figure-motion/layeredRenderer";
import type { LoadedFacialMotionPackage } from "@/lib/figure-motion/package";

type Props = {
  motionPackage: LoadedFacialMotionPackage;
  state: FigureRenderState;
  mode: "independent" | "webgal";
  title: string;
  subtitle: string;
  faceZoom?: boolean;
};

export function LayeredFigurePreview({ motionPackage, state, mode, title, subtitle, faceZoom = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LayeredFigureRenderer | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current = new LayeredFigureRenderer(canvas, (path) => motionPackage.urls.get(path) || path);
  }, [motionPackage]);

  useEffect(() => {
    const expression = motionPackage.manifest.expressions[state.expressionId];
    if (!expression || !rendererRef.current) return;
    let alive = true;
    rendererRef.current.draw(expression, state, mode)
      .then(() => alive && setError(""))
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "立绘绘制失败"));
    return () => { alive = false; };
  }, [mode, motionPackage, state]);

  return (
    <article className={`figure-preview ${faceZoom ? "figure-preview--face" : ""}`}>
      <header>
        <div><strong>{title}</strong><span>{subtitle}</span></div>
        <i className={mode === "independent" ? "is-good" : "is-baseline"}>{mode === "independent" ? "INDEPENDENT" : "WEBGAL 4.6.2"}</i>
      </header>
      <div className="figure-preview__stage">
        <div className="figure-preview__grid" />
        <div
          className="figure-preview__actor"
          style={{
            transform: `translate3d(${state.stageTransform.x}px, ${state.stageTransform.y}px, 0) scale(${state.stageTransform.scale}) rotate(${state.stageTransform.rotation}deg)`,
          }}
        >
          <canvas ref={canvasRef} width={1024} height={1536} aria-label={`${title} 立绘预览`} />
        </div>
        {!faceZoom && <div className="figure-preview__foot"><span>LOCKED FOOT POINT</span></div>}
        {error && <p className="figure-preview__error">{error}</p>}
      </div>
      <footer>
        <span>EYE <b>{state.eyes}</b></span>
        <span>MOUTH <b>{state.mouth}</b></span>
        {mode === "webgal" && <span>LAST WRITE <b>{state.lastChanged}</b></span>}
      </footer>
    </article>
  );
}
