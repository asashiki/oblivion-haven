"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prepareWebGalPreview } from "@/lib/webgalPreview";
import { maidMotionProject } from "@/lib/story/maidMotionProject";

type EyeState = "open" | "half" | "closed";
type MouthState = "closed" | "half" | "open";
type ExpressionKey = "welcome" | "guide";
type RuntimeMode = "layered" | "webgal" | "engine";
type StageEffect = "" | "emphasis" | "recoil" | "enter";

type Part = {
  file: string;
  rect: { x: number; y: number; width: number; height: number };
};

type Expression = {
  label: string;
  base: string;
  eyes: Record<EyeState, Part>;
  mouth: Record<MouthState, Part>;
};

type Manifest = {
  canvas: { width: number; height: number };
  expressions: Record<ExpressionKey, Expression>;
};

type Envelope = {
  durationMs: number;
  frames: Array<{ timeMs: number; normalized: number; smoothed: number }>;
};

type MouthCue = { timeMs: number; state: MouthState };

const ASSET_ROOT = "/face-motion-demo/";
const VISUAL_LEAD_MS = 32;

function deriveMouthCues(envelope: Envelope): MouthCue[] {
  const frames = envelope.frames;
  const energy = frames.map((frame) => frame.smoothed * 0.62 + frame.normalized * 0.38);
  const peaks = new Set<number>();

  for (let index = 3; index < frames.length - 3; index += 1) {
    const local = energy.slice(index - 3, index + 4);
    const localMin = Math.min(...local);
    if (energy[index] >= 0.46 && energy[index] === Math.max(...local) && energy[index] - localMin >= 0.07) {
      peaks.add(index);
    }
  }

  const raw = frames.map((frame, index): MouthState => {
    const silent = frame.smoothed < 0.105 && frame.normalized < 0.15;
    if (silent) return "closed";
    const nearPeak = [-2, -1, 0, 1, 2].some((delta) => peaks.has(index + delta));
    if (nearPeak && energy[index] >= 0.48) return "open";
    return "half";
  });

  // Eliminate one-frame chatter. Full-open is reserved for short vowel peaks;
  // ordinary voiced spans stay half-open instead of holding a frozen wide mouth.
  for (let pass = 0; pass < 2; pass += 1) {
    let start = 0;
    while (start < raw.length) {
      let end = start + 1;
      while (end < raw.length && raw[end] === raw[start]) end += 1;
      if (end - start < 3) {
        const replacement = raw[start - 1] ?? raw[end] ?? "closed";
        for (let index = start; index < end; index += 1) raw[index] = replacement;
      }
      start = end;
    }
  }

  let openRun = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "open") {
      openRun += 1;
      if (openRun > 6) raw[index] = "half";
    } else {
      openRun = 0;
    }
  }

  return frames.map((frame, index) => ({ timeMs: frame.timeMs, state: raw[index] }));
}

function loadImage(path: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `${ASSET_ROOT}${path}`;
  });
}

function SpriteCanvas({
  manifest,
  expressionKey,
  eyeState,
  mouthState,
  mode,
  images,
  className,
}: {
  manifest: Manifest;
  expressionKey: ExpressionKey;
  eyeState: EyeState;
  mouthState: MouthState;
  mode: RuntimeMode;
  images: Map<string, HTMLImageElement>;
  className: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const expression = manifest.expressions[expressionKey];
    const context = canvas?.getContext("2d");
    const base = images.get(expression.base);
    if (!canvas || !context || !base) return;

    context.clearRect(0, 0, manifest.canvas.width, manifest.canvas.height);
    context.drawImage(base, 0, 0, manifest.canvas.width, manifest.canvas.height);

    const replacePart = (part: Part) => {
      const image = images.get(part.file);
      if (!image) return;
      const { x, y, width, height } = part.rect;
      context.clearRect(x, y, width, height);
      context.drawImage(image, x, y, width, height);
    };

    if (mode === "layered") {
      replacePart(expression.eyes[eyeState]);
      replacePart(expression.mouth[mouthState]);
    } else if (eyeState !== "open") {
      // This intentionally mirrors WebGAL's current full-texture behavior:
      // a blink frame replaces the mouth frame instead of combining with it.
      replacePart(expression.eyes[eyeState]);
    } else {
      replacePart(expression.mouth[mouthState]);
    }
  }, [eyeState, expressionKey, images, manifest, mode, mouthState]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={manifest.canvas.width}
      height={manifest.canvas.height}
      aria-label={manifest.expressions[expressionKey].label}
    />
  );
}

export default function Home() {
  const audioDataRef = useRef<ArrayBuffer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sourceGenerationRef = useRef(0);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const playingRef = useRef(false);
  const mouthCuesRef = useRef<MouthCue[]>([]);
  const mouthStateRef = useRef<MouthState>("closed");
  const syncOffsetRef = useRef(0);
  const blinkSuppressUntilRef = useRef(0);
  const effectTimerRef = useRef<number | null>(null);
  const swapTimerRef = useRef<number | null>(null);
  const phraseTimerRef = useRef<number | null>(null);

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [images, setImages] = useState<Map<string, HTMLImageElement> | null>(null);
  const [expressionKey, setExpressionKey] = useState<ExpressionKey>("welcome");
  const [previousExpression, setPreviousExpression] = useState<ExpressionKey | null>(null);
  const [eyeState, setEyeState] = useState<EyeState>("open");
  const [mouthState, setMouthState] = useState<MouthState>("closed");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("layered");
  const [stageEffect, setStageEffect] = useState<StageEffect>("enter");
  const [phrasePulse, setPhrasePulse] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [syncOffset, setSyncOffset] = useState(0);
  const [webgalUrl, setWebgalUrl] = useState("");
  const [webgalStatus, setWebgalStatus] = useState("尚未启动 WebGAL 实机");

  useEffect(() => {
    Promise.all([
      fetch(`${ASSET_ROOT}manifest.json`).then((response) => response.json() as Promise<Manifest>),
      fetch(`${ASSET_ROOT}audio-envelope.json`).then((response) => response.json() as Promise<Envelope>),
      fetch(`${ASSET_ROOT}voice.wav`).then((response) => response.arrayBuffer()),
    ]).then(async ([nextManifest, nextEnvelope, audioData]) => {
      const paths = new Set<string>();
      (Object.keys(nextManifest.expressions) as ExpressionKey[]).forEach((key) => {
        const expression = nextManifest.expressions[key];
        paths.add(expression.base);
        Object.values(expression.eyes).forEach((part) => paths.add(part.file));
        Object.values(expression.mouth).forEach((part) => paths.add(part.file));
      });
      const loaded = await Promise.all([...paths].map(async (path) => [path, await loadImage(path)] as const));
      audioDataRef.current = audioData;
      mouthCuesRef.current = deriveMouthCues(nextEnvelope);
      setManifest(nextManifest);
      setEnvelope(nextEnvelope);
      setImages(new Map(loaded));
    });
  }, []);

  useEffect(() => {
    if (runtimeMode !== "engine") return;
    let cancelled = false;
    setWebgalStatus("正在编译并启动 WebGAL 4.6.2…");
    setWebgalUrl("");
    void prepareWebGalPreview(maidMotionProject, "scene_mai_motion").then((prepared) => {
      if (cancelled) return;
      setWebgalUrl(prepared.url);
      setWebgalStatus("WebGAL 实机已启动：请在引擎对话框中点击推进");
    }).catch((error) => {
      if (cancelled) return;
      setWebgalStatus(error instanceof Error ? error.message : "WebGAL 实机启动失败");
    });
    return () => { cancelled = true; };
  }, [runtimeMode]);

  useEffect(() => {
    syncOffsetRef.current = syncOffset;
  }, [syncOffset]);

  const setMouth = useCallback((next: MouthState) => {
    if (mouthStateRef.current === next) return;
    const previous = mouthStateRef.current;
    mouthStateRef.current = next;
    setMouthState(next);
    if (previous === "closed" && next !== "closed") {
      setPhrasePulse(false);
      requestAnimationFrame(() => setPhrasePulse(true));
      if (phraseTimerRef.current) window.clearTimeout(phraseTimerRef.current);
      phraseTimerRef.current = window.setTimeout(() => setPhrasePulse(false), 320);
    }
  }, []);

  // One persistent RAF scheduler keeps blinking alive even after the voice ends.
  useEffect(() => {
    let animationFrame = 0;
    let seed = 0x12345;
    let nextBlinkAt = performance.now() + 900;
    let blinkStartedAt = -1;
    let secondBlinkPending = false;
    let currentEye: EyeState = "open";

    const random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };

    const updateEye = (next: EyeState) => {
      if (next === currentEye) return;
      currentEye = next;
      setEyeState(next);
    };

    const loop = (now: number) => {
      if (blinkStartedAt < 0 && now >= nextBlinkAt) {
        if (now < blinkSuppressUntilRef.current) {
          nextBlinkAt = blinkSuppressUntilRef.current + 180;
        } else {
          blinkStartedAt = now;
        }
      }

      if (blinkStartedAt >= 0) {
        const elapsed = now - blinkStartedAt;
        if (elapsed < 48) updateEye("half");
        else if (elapsed < 126) updateEye("closed");
        else if (elapsed < 176) updateEye("half");
        else {
          updateEye("open");
          blinkStartedAt = -1;
          if (!secondBlinkPending && random() < 0.09) {
            secondBlinkPending = true;
            nextBlinkAt = now + 125;
          } else {
            secondBlinkPending = false;
            nextBlinkAt = now + 2400 + random() * 3800;
          }
        }
      }
      animationFrame = requestAnimationFrame(loop);
    };

    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  // The mouth reads a Web Audio clock, not wall-clock timers or image load events.
  useEffect(() => {
    let animationFrame = 0;
    const loop = () => {
      const context = audioContextRef.current;
      const durationMs = envelope?.durationMs ?? 0;
      if (playingRef.current && context && durationMs) {
        const positionSeconds = Math.max(0, context.currentTime - startedAtRef.current);
        const nextProgress = Math.min(1, (positionSeconds * 1000) / durationMs);
        setProgress(nextProgress);

        const outputLatency = (context.baseLatency + (context.outputLatency ?? 0)) * 1000;
        const visualTime = positionSeconds * 1000 - outputLatency + VISUAL_LEAD_MS + syncOffsetRef.current;
        const cues = mouthCuesRef.current;
        const frameMs = cues[1]?.timeMs || 24;
        const cueIndex = Math.max(0, Math.min(cues.length - 1, Math.floor(visualTime / frameMs)));
        setMouth(cues[cueIndex]?.state ?? "closed");

        if (positionSeconds * 1000 >= durationMs) {
          playingRef.current = false;
          pausedAtRef.current = 0;
          setPlaying(false);
          setProgress(1);
          setMouth("closed");
        }
      }
      animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [envelope, setMouth]);

  useEffect(() => () => {
    sourceGenerationRef.current += 1;
    sourceRef.current?.stop();
    audioContextRef.current?.close();
    if (effectTimerRef.current) window.clearTimeout(effectTimerRef.current);
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
    if (phraseTimerRef.current) window.clearTimeout(phraseTimerRef.current);
  }, []);

  const ensureAudio = async () => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    const context = audioContextRef.current;
    if (context.state === "suspended") await context.resume();
    if (!audioBufferRef.current && audioDataRef.current) {
      audioBufferRef.current = await context.decodeAudioData(audioDataRef.current.slice(0));
    }
    return { context, buffer: audioBufferRef.current };
  };

  const startFrom = async (offsetSeconds: number) => {
    const { context, buffer } = await ensureAudio();
    if (!buffer) return;
    sourceGenerationRef.current += 1;
    const generation = sourceGenerationRef.current;
    sourceRef.current?.stop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = context.currentTime + 0.035;
    startedAtRef.current = startAt - offsetSeconds;
    pausedAtRef.current = offsetSeconds;
    source.onended = () => {
      if (sourceGenerationRef.current !== generation || !playingRef.current) return;
      playingRef.current = false;
      setPlaying(false);
      setMouth("closed");
    };
    source.start(startAt, offsetSeconds);
    sourceRef.current = source;
    playingRef.current = true;
    setPlaying(true);
  };

  const togglePlayback = async () => {
    if (playingRef.current) {
      const context = audioContextRef.current;
      if (context) pausedAtRef.current = Math.max(0, context.currentTime - startedAtRef.current);
      sourceGenerationRef.current += 1;
      sourceRef.current?.stop();
      sourceRef.current = null;
      playingRef.current = false;
      setPlaying(false);
      setMouth("closed");
      return;
    }
    const durationSeconds = (envelope?.durationMs ?? 0) / 1000;
    const offset = progress >= 0.999 ? 0 : Math.min(pausedAtRef.current, durationSeconds);
    if (offset === 0) setProgress(0);
    await startFrom(offset);
  };

  const seek = async (value: number) => {
    const durationSeconds = (envelope?.durationMs ?? 0) / 1000;
    const offset = value * durationSeconds;
    pausedAtRef.current = offset;
    setProgress(value);
    if (playingRef.current) await startFrom(offset);
    else {
      const cues = mouthCuesRef.current;
      const index = Math.max(0, Math.min(cues.length - 1, Math.floor((offset * 1000) / 24)));
      setMouth(cues[index]?.state ?? "closed");
    }
  };

  const switchExpression = (next: ExpressionKey) => {
    if (next === expressionKey) return;
    blinkSuppressUntilRef.current = performance.now() + 300;
    setEyeState("open");
    setPreviousExpression(expressionKey);
    setExpressionKey(next);
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
    swapTimerRef.current = window.setTimeout(() => setPreviousExpression(null), 260);
  };

  const playEffect = (next: Exclude<StageEffect, "">) => {
    setStageEffect("");
    requestAnimationFrame(() => setStageEffect(next));
    if (effectTimerRef.current) window.clearTimeout(effectTimerRef.current);
    effectTimerRef.current = window.setTimeout(() => setStageEffect(""), next === "enter" ? 520 : 380);
  };

  const ready = manifest && images;
  const modeNote = runtimeMode === "layered"
    ? "Studio 分层对照：眼睛与嘴巴同时合成。"
    : runtimeMode === "webgal"
      ? "旧版整图覆盖限制模拟，不代表实际 WebGAL 已修复后的结果。"
      : "真实 WebGAL 4.6.2：点击引擎对话框推进两句，并观察语音、口型与表情切换。";

  return (
    <main className="stage-shell">
      <section className="stage-panel" aria-label="Galgame facial motion preview">
        <div className="stage-glow" />
        <div className={`character-motion ${playing ? "is-speaking" : ""} ${phrasePulse ? "phrase-pulse" : ""} effect-${stageEffect}`}>
          <div className="character-frame">
            {runtimeMode === "engine" ? (
              webgalUrl ? <iframe className="webgal-lab-frame" src={webgalUrl} title="WebGAL 4.6.2 实机 MVP" allow="autoplay; fullscreen" /> : <div className="webgal-lab-loading">{webgalStatus}</div>
            ) : ready ? (
              <>
                {previousExpression && (
                  <SpriteCanvas
                    manifest={manifest}
                    expressionKey={previousExpression}
                    eyeState={eyeState}
                    mouthState={mouthState}
                    mode={runtimeMode}
                    images={images}
                    className="figure-canvas figure-out"
                  />
                )}
                <SpriteCanvas
                  key={`${expressionKey}-${previousExpression ? "swap" : "steady"}`}
                  manifest={manifest}
                  expressionKey={expressionKey}
                  eyeState={eyeState}
                  mouthState={mouthState}
                  mode={runtimeMode}
                  images={images}
                  className={`figure-canvas ${previousExpression ? "figure-in" : ""}`}
                />
              </>
            ) : (
              <div className="loading">正在载入立绘…</div>
            )}
          </div>
        </div>

        <div className="dialogue-card">
          <div className="dialogue-topline">
            <p className="speaker">Mai</p>
            <span className={`voice-indicator ${playing ? "active" : ""}`}>{playing ? "VOICE" : "READY"}</span>
          </div>
          <p className="line">あっ、ごめん……でも、ちゃんとそばにいるからね！</p>
        </div>
      </section>

      <aside className="control-panel">
        <a className="back-link" href="/">← 返回 Gal Blog Game Studio</a>
        <div>
          <p className="eyebrow">STUDIO · FACIAL MOTION LAB V2</p>
          <h1>语音、眨眼与立绘演出</h1>
          <p className="summary">三态口型从提供的语音包络离线生成，并由音频时钟逐帧驱动；立绘素材全部预载后再播放。</p>
        </div>

        <div className="control-group">
          <span className="control-label">运行模式 A / B</span>
          <div className="segment-control">
            <button className={runtimeMode === "engine" ? "active" : ""} onClick={() => setRuntimeMode("engine")}>WebGAL 实机 A</button>
            <button className={runtimeMode === "layered" ? "active" : ""} onClick={() => setRuntimeMode("layered")}>Studio 分层 B</button>
            <button className={runtimeMode === "webgal" ? "active warning" : ""} onClick={() => setRuntimeMode("webgal")}>旧整图限制</button>
          </div>
          <p className={`mode-note ${runtimeMode === "webgal" ? "warning" : ""}`}>{modeNote}</p>
        </div>

        <div className="control-group">
          <span className="control-label">表情 / 姿势切换</span>
          <div className="segment-control">
            <button className={expressionKey === "welcome" ? "active" : ""} onClick={() => switchExpression("welcome")}>迎接</button>
            <button className={expressionKey === "guide" ? "active" : ""} onClick={() => switchExpression("guide")}>说明</button>
          </div>
        </div>

        <div className="control-group compact">
          <span className="control-label">立绘演出</span>
          <div className="effect-buttons">
            <button onClick={() => playEffect("emphasis")}>轻强调</button>
            <button onClick={() => playEffect("recoil")}>后退反应</button>
            <button onClick={() => playEffect("enter")}>重新进场</button>
          </div>
        </div>

        <div className="control-group audio-controls">
          <span className="control-label">语音驱动</span>
          <button className="play-button" onClick={togglePlayback} disabled={!ready || !envelope}>
            <span>{playing ? "Ⅱ" : "▶"}</span>
            {playing ? "暂停语音" : "播放语音"}
          </button>
          <input className="timeline" type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => void seek(Number(event.target.value))} aria-label="语音进度" />
          <label className="sync-row">
            <span>A/V 微调</span>
            <input type="range" min="-120" max="120" step="10" value={syncOffset} onChange={(event) => setSyncOffset(Number(event.target.value))} />
            <strong>{syncOffset > 0 ? "+" : ""}{syncOffset}ms</strong>
          </label>
        </div>

        <div className="status-grid">
          <div><span>眼睛</span><strong>{eyeState}</strong></div>
          <div><span>嘴巴</span><strong>{mouthState}</strong></div>
          <div><span>模式</span><strong>{runtimeMode === "engine" ? "WebGAL 实机" : runtimeMode === "layered" ? "分层" : "整图限制"}</strong></div>
        </div>
      </aside>
    </main>
  );
}
