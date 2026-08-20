"use client";

import { Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { eyeStateAt, scheduleBlinkEvents } from "@/lib/figure-motion/blinkScheduler";
import { LayeredFigureRenderer, type FigureRenderState } from "@/lib/figure-motion/layeredRenderer";
import { mouthStateAt, type MouthTimeline } from "@/lib/figure-motion/mouthTimeline";
import { loadFacialMotionPackageFromUrl, type LoadedFacialMotionPackage } from "@/lib/figure-motion/package";
import type { StoryProject, StoryScene } from "@/lib/story/types";

type Props = {
  project: StoryProject;
  scene: StoryScene;
  directorEnabled: boolean;
  restartKey: number;
};

const DEMO_DURATION_MS = 12_800;
const SWAP_AT_MS = 6_200;

function publicPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function sceneUsesLayeredMotion(project: StoryProject, scene: StoryScene): boolean {
  return Boolean(scene.entryStage?.figures?.some((figure) => {
    const character = project.characters.find((item) => item.id === figure.characterId);
    return character?.expressions.find((item) => item.id === figure.expressionId)?.facialMotion;
  }));
}

export function DynamicGalgameStage({ project, scene, directorEnabled, restartKey }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rendererRef = useRef<LayeredFigureRenderer>();
  const frameRef = useRef<number>();
  const idleStartRef = useRef(0);
  const previousFaceRef = useRef({ eyes: "open", mouth: "closed" } as Pick<FigureRenderState, "eyes" | "mouth">);
  const [motionPackage, setMotionPackage] = useState<LoadedFacialMotionPackage>();
  const [timeline, setTimeline] = useState<MouthTimeline>();
  const [timeMs, setTimeMs] = useState(0);
  const [idleMs, setIdleMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState("");
  const [lastChanged, setLastChanged] = useState<"eyes" | "mouth">("mouth");

  const figure = scene.entryStage?.figures?.find((item) => {
    const character = project.characters.find((candidate) => candidate.id === item.characterId);
    return character?.expressions.find((expression) => expression.id === item.expressionId)?.facialMotion;
  });
  const character = project.characters.find((item) => item.id === figure?.characterId);
  const initialExpression = character?.expressions.find((item) => item.id === figure?.expressionId)
    || character?.expressions.find((item) => item.id === character.defaultExpressionId)
    || character?.expressions[0];
  const guideExpression = character?.expressions.find((item) => item.facialMotion?.expressionId === "guide");
  const line = scene.blocks.find((block) => block.type === "dialogue");
  const voice = line?.type === "dialogue" ? project.assets.find((asset) => asset.id === line.voiceAssetId) : undefined;
  const manifestPath = initialExpression?.facialMotion?.manifestPath;
  const timelinePath = typeof voice?.metadata?.mouthTimelinePath === "string"
    ? voice.metadata.mouthTimelinePath
    : "face-motion-demo/mouth-timeline.json";

  useEffect(() => {
    if (!manifestPath) return;
    let active = true;
    Promise.all([
      loadFacialMotionPackageFromUrl(publicPath(manifestPath)),
      fetch(publicPath(timelinePath)).then((response) => {
        if (!response.ok) throw new Error("口型时间线载入失败");
        return response.json() as Promise<MouthTimeline>;
      }),
    ]).then(([loaded, mouthTimeline]) => {
      if (!active) { loaded.dispose(); return; }
      setMotionPackage(loaded);
      setTimeline(mouthTimeline);
      setError("");
      requestAnimationFrame(() => setEntered(true));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "动态立绘载入失败"));
    return () => { active = false; };
  }, [manifestPath, timelinePath]);

  useEffect(() => () => motionPackage?.dispose(), [motionPackage]);

  useEffect(() => {
    if (!motionPackage || !canvasRef.current) return;
    rendererRef.current = new LayeredFigureRenderer(canvasRef.current, (path) => motionPackage.urls.get(path) || path);
  }, [motionPackage]);

  useEffect(() => {
    const tick = (now: number) => {
      if (!idleStartRef.current) idleStartRef.current = now;
      setIdleMs(now - idleStartRef.current);
      const audio = audioRef.current;
      if (audio && !audio.paused) setTimeMs(audio.currentTime * 1000);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setTimeMs(0);
    setPlaying(false);
    setEntered(false);
    requestAnimationFrame(() => setEntered(true));
  }, [restartKey]);

  const blinks = useMemo(() => {
    if (!motionPackage) return [];
    return scheduleBlinkEvents(120_000, motionPackage.manifest.profile.blink, {
      hasHalf: true,
      suppressWindows: directorEnabled ? [{ startMs: SWAP_AT_MS, endMs: SWAP_AT_MS }] : [],
    });
  }, [directorEnabled, motionPackage]);

  const expressionId = directorEnabled && timeMs >= SWAP_AT_MS
    ? guideExpression?.facialMotion?.expressionId || "guide"
    : initialExpression?.facialMotion?.expressionId || "welcome";
  const mouth = playing && timeline ? mouthStateAt(timeline, timeMs) : "closed";
  const eyes = eyeStateAt(blinks, (playing ? timeMs : idleMs) % 120_000);
  const lean = directorEnabled && playing && timeMs >= 7_600 && timeMs <= 8_120;
  const swapping = directorEnabled && playing && timeMs >= SWAP_AT_MS - 90 && timeMs <= SWAP_AT_MS + 220;

  useEffect(() => {
    if (eyes !== previousFaceRef.current.eyes) setLastChanged("eyes");
    if (mouth !== previousFaceRef.current.mouth) setLastChanged("mouth");
    previousFaceRef.current = { eyes, mouth };
  }, [eyes, mouth]);

  useEffect(() => {
    const expression = motionPackage?.manifest.expressions[expressionId];
    if (!expression || !rendererRef.current) return;
    const state: FigureRenderState = {
      expressionId,
      eyes,
      mouth,
      lastChanged,
      stageTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    };
    rendererRef.current.draw(expression, state, "independent")
      .then(() => setError(""))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "动态立绘绘制失败"));
  }, [eyes, expressionId, lastChanged, motionPackage, mouth]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (audio.ended || audio.currentTime * 1000 >= (timeline?.durationMs || DEMO_DURATION_MS) - 80) {
      audio.currentTime = 0;
      setTimeMs(0);
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setError("浏览器阻止了播放，请再点击一次画面。");
    }
  };

  const replay = (event: MouseEvent) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setTimeMs(0);
    setPlaying(false);
    void audio.play().then(() => setPlaying(true)).catch(() => setError("请点击画面播放语音。"));
  };

  const progress = Math.min(100, (timeMs / (timeline?.durationMs || DEMO_DURATION_MS)) * 100);

  return (
    <div
      className={`dynamic-gal-stage ${entered ? "is-entered" : ""} ${lean ? "is-leaning" : ""} ${swapping ? "is-swapping" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={playing ? "暂停动态立绘台词" : "播放动态立绘台词"}
      onClick={() => void togglePlay()}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void togglePlay(); }}
    >
      <audio
        ref={audioRef}
        src={voice ? publicPath(voice.path) : undefined}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setTimeMs(timeline?.durationMs || DEMO_DURATION_MS); }}
      />
      <div className="dynamic-gal-stage__light" />
      <div className="dynamic-gal-stage__room"><i /><i /><i /></div>
      <div className="dynamic-gal-stage__actor">
        <canvas ref={canvasRef} width={1024} height={1536} aria-label={`${character?.displayName || "角色"}动态立绘`} />
      </div>
      <div className="dynamic-gal-stage__dialogue">
        <div className="dynamic-gal-stage__name"><span>{character?.displayName || "Mai"}</span><small>VOICE</small></div>
        <p>{line?.type === "dialogue" ? line.text : "あっ、ごめん……でも、ちゃんと説明するからね！"}</p>
        <div className="dynamic-gal-stage__meta">
          <span><Volume2 size={12} /> 语音口型同步</span>
          <span>{Math.floor(timeMs / 1000)}.{Math.floor(timeMs % 1000 / 100)} / 12.8s</span>
        </div>
        <div className="dynamic-gal-stage__progress"><i style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="dynamic-gal-stage__transport">
        <span>{playing ? <><Pause size={13} /> 点击暂停</> : <><Play size={13} fill="currentColor" /> 点击播放台词</>}</span>
        <button onClick={replay} aria-label="重新播放"><RotateCcw size={13} /> 重播</button>
      </div>
      {error && <p className="dynamic-gal-stage__error">{error}</p>}
    </div>
  );
}
