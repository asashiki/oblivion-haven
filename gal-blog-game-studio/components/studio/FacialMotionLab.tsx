"use client";

import {
  Download,
  FileArchive,
  Gauge,
  Layers3,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  ScanFace,
  SlidersHorizontal,
  Upload,
  Volume2,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { AudioWaveform } from "./AudioWaveform";
import { LayeredFigurePreview } from "./LayeredFigurePreview";
import { MotionTimeline } from "./MotionTimeline";
import { analyseAudioSamples, type AudioEnvelope } from "@/lib/figure-motion/audioEnvelope";
import { eyeStateAt, scheduleBlinkEvents } from "@/lib/figure-motion/blinkScheduler";
import {
  normalizedPausedState,
  type FigureRenderState,
} from "@/lib/figure-motion/layeredRenderer";
import { buildMouthTimeline, mouthStateAt, type MouthTimeline } from "@/lib/figure-motion/mouthTimeline";
import {
  loadFacialMotionPackageFromFiles,
  loadFacialMotionPackageFromUrl,
  type LoadedFacialMotionPackage,
} from "@/lib/figure-motion/package";
import type { BlinkProfile, MouthProfile } from "@/lib/figure-motion/schema";
import { FACE_MOTION_PERFORMANCE_FIXTURE } from "@/lib/story/performancePlan";

const DEMO_ROOT = "/face-motion-demo/";
const SWAP_AT_MS = 6200;

function downloadJson(name: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatTime(timeMs: number): string {
  const seconds = Math.max(0, timeMs) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

function sliderValue(event: ChangeEvent<HTMLInputElement>): number {
  return Number(event.target.value);
}

async function decodeBrowserAudio(file: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const source = buffer.getChannelData(channel);
      for (let index = 0; index < source.length; index += 1) samples[index] += source[index] / buffer.numberOfChannels;
    }
    return { samples, sampleRate: buffer.sampleRate };
  } finally {
    await context.close();
  }
}

export function FacialMotionLab() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const packageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const audioUrlRef = useRef<string | undefined>(undefined);
  const sampleRef = useRef<{ samples: Float32Array; sampleRate: number } | undefined>(undefined);
  const previousFaceRef = useRef<{ eyes: FigureRenderState["eyes"]; mouth: FigureRenderState["mouth"] }>({ eyes: "open", mouth: "closed" });

  const [motionPackage, setMotionPackage] = useState<LoadedFacialMotionPackage>();
  const [mouthProfile, setMouthProfile] = useState<MouthProfile>();
  const [blinkProfile, setBlinkProfile] = useState<BlinkProfile>();
  const [envelope, setEnvelope] = useState<AudioEnvelope>();
  const [timeline, setTimeline] = useState<MouthTimeline>();
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [expressionId, setExpressionId] = useState("welcome");
  const [autoPlan, setAutoPlan] = useState(true);
  const [diagnosticCombo, setDiagnosticCombo] = useState(false);
  const [lastChanged, setLastChanged] = useState<"eyes" | "mouth">("mouth");
  const [audioLabel, setAudioLabel] = useState("[Mai] 用户语音 · 12.80s");
  const [message, setMessage] = useState("正在载入 MVP fixture…");

  const rebuildTimeline = (profile: MouthProfile, samples = sampleRef.current) => {
    if (!samples) return;
    const nextEnvelope = analyseAudioSamples(samples.samples, samples.sampleRate, profile);
    setEnvelope(nextEnvelope);
    setTimeline(buildMouthTimeline(nextEnvelope, profile));
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      loadFacialMotionPackageFromUrl(`${DEMO_ROOT}manifest.json`),
      fetch(`${DEMO_ROOT}voice.mp3`).then((response) => response.blob()).then(decodeBrowserAudio),
    ]).then(([loaded, decodedVoice]) => {
      if (!active) { loaded.dispose(); return; }
      setMotionPackage(loaded);
      setMouthProfile(loaded.manifest.profile.mouth);
      setBlinkProfile(loaded.manifest.profile.blink);
      sampleRef.current = decodedVoice;
      rebuildTimeline(loaded.manifest.profile.mouth, sampleRef.current);
      setMessage("真实素材已通过 v2 包校验；可直接播放或切换组合诊断。");
    }).catch((reason) => setMessage(reason instanceof Error ? reason.message : "MVP fixture 载入失败"));
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    motionPackage?.dispose();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, [motionPackage]);

  const blinks = useMemo(() => {
    if (!blinkProfile || !motionPackage) return [];
    return scheduleBlinkEvents(120_000, blinkProfile, {
      hasHalf: Object.values(motionPackage.manifest.expressions).every((expression) => Boolean(expression.eyes.half)),
      suppressWindows: [{ startMs: SWAP_AT_MS, endMs: SWAP_AT_MS }],
    });
  }, [blinkProfile, motionPackage]);

  const currentExpression = autoPlan && playing ? (timeMs >= SWAP_AT_MS ? "guide" : "welcome") : expressionId;
  const currentMouth = diagnosticCombo ? "open" : playing && timeline ? mouthStateAt(timeline, timeMs) : "closed";
  const currentEyes = diagnosticCombo ? "closed" : playing ? eyeStateAt(blinks, timeMs) : "open";

  useEffect(() => {
    if (currentEyes !== previousFaceRef.current.eyes) setLastChanged("eyes");
    if (currentMouth !== previousFaceRef.current.mouth) setLastChanged("mouth");
    previousFaceRef.current = { eyes: currentEyes, mouth: currentMouth };
  }, [currentEyes, currentMouth]);

  const lean = playing && timeMs >= 7600 && timeMs <= 8120;
  const renderState: FigureRenderState = {
    expressionId: currentExpression,
    eyes: currentEyes,
    mouth: currentMouth,
    lastChanged,
    stageTransform: { x: lean ? 7 : 0, y: lean ? 1 : 0, scale: lean ? 1.012 : 1, rotation: lean ? 0.45 : 0 },
  };
  const safeState = playing || diagnosticCombo ? renderState : normalizedPausedState(renderState);

  const updateClock = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setTimeMs(audio.currentTime * 1000);
    if (!audio.paused) frameRef.current = requestAnimationFrame(updateClock);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setDiagnosticCombo(false);
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
      frameRef.current = requestAnimationFrame(updateClock);
    } else {
      audio.pause();
      setPlaying(false);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    }
  };

  const seek = (nextMs: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = nextMs / 1000;
    setTimeMs(nextMs);
  };

  const importPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    try {
      const loaded = await loadFacialMotionPackageFromFiles([...event.target.files]);
      motionPackage?.dispose();
      setMotionPackage(loaded);
      setMouthProfile(loaded.manifest.profile.mouth);
      setBlinkProfile(loaded.manifest.profile.blink);
      setExpressionId(Object.keys(loaded.manifest.expressions)[0]);
      setAutoPlan(false);
      setMessage(`已导入 ${Object.keys(loaded.manifest.expressions).length} 个表情；全部哈希和部件矩形通过校验。`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "面部动作包导入失败");
    } finally {
      event.target.value = "";
    }
  };

  const importAudio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !mouthProfile) return;
    try {
      sampleRef.current = await decodeBrowserAudio(file);
      rebuildTimeline(mouthProfile, sampleRef.current);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = URL.createObjectURL(file);
      const audio = audioRef.current;
      if (audio) { audio.src = audioUrlRef.current; audio.load(); }
      setAudioLabel(`${file.name} · 用户导入`);
      setMessage("新语音已离线分析；没有发送到任何生成服务。" );
      seek(0);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "语音解码失败");
    } finally {
      event.target.value = "";
    }
  };

  if (!motionPackage || !mouthProfile || !blinkProfile || !timeline || !envelope) {
    return <div className="facial-lab-loading"><ScanFace size={34} /><strong>Facial Motion Lab</strong><span>{message}</span></div>;
  }

  const expressionIds = Object.keys(motionPackage.manifest.expressions);
  const updateMouth = (patch: Partial<MouthProfile>) => {
    const next = { ...mouthProfile, ...patch };
    setMouthProfile(next);
    rebuildTimeline(next);
  };

  return (
    <main className="facial-lab">
      <audio
        ref={audioRef}
        src={`${DEMO_ROOT}voice.mp3`}
        loop={loop}
        onEnded={() => { setPlaying(false); setTimeMs(timeline.durationMs); }}
        onPause={() => setPlaying(false)}
      />
      <input ref={packageInputRef} hidden type="file" multiple accept=".json,.png" onChange={importPackage} />
      <input ref={audioInputRef} hidden type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg" onChange={importAudio} />

      <header className="facial-lab__header">
        <div className="facial-lab__brand"><Link href="/">G</Link><span>STUDIO / R&amp;D</span></div>
        <div>
          <span className="facial-lab__eyebrow">RUNTIME EXPERIMENT 01</span>
          <h1>Facial Motion Lab</h1>
          <p>眼睛与嘴巴独立替换 · 离线语音包络 · 可复现眨眼 · 表情连续切换</p>
        </div>
        <div className="facial-lab__metrics">
          <span><b>01</b> CHARACTER</span><span><b>02</b> EXPRESSIONS</span><span><b>01</b> VOICE</span>
        </div>
      </header>

      <section className="facial-lab__toolbar">
        <div className="voice-chip"><Volume2 size={15} /><span><b>{audioLabel}</b><small>{formatTime(timeMs)} / {formatTime(timeline.durationMs)}</small></span></div>
        <div className="transport">
          <button onClick={() => seek(0)} title="回到开头"><RotateCcw size={15} /></button>
          <button className="transport__play" onClick={togglePlay}>{playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}{playing ? "暂停" : "播放"}</button>
          <label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /><RefreshCcw size={13} /> 循环</label>
        </div>
        <div className="toolbar-actions">
          <button onClick={() => packageInputRef.current?.click()}><FileArchive size={14} /> 导入动作包</button>
          <button onClick={() => audioInputRef.current?.click()}><Upload size={14} /> 导入语音</button>
        </div>
      </section>

      <p className="facial-lab__notice"><i />{message}</p>

      <section className="facial-lab__workspace">
        <div className="facial-lab__compare">
          <div className="compare-heading">
            <div><span className="facial-lab__eyebrow">A / B COMPOSITION</span><h2>同一时刻，同一眼嘴状态</h2></div>
            <div className="combo-toggle">
              <button className={!diagnosticCombo ? "active" : ""} onClick={() => setDiagnosticCombo(false)}>语音同步</button>
              <button className={diagnosticCombo ? "active" : ""} onClick={() => { setDiagnosticCombo(true); audioRef.current?.pause(); setPlaying(false); setLastChanged("eyes"); }}>闭眼 + 张嘴证据</button>
            </div>
          </div>
          <div className="compare-grid">
            <LayeredFigurePreview motionPackage={motionPackage} state={safeState} mode="webgal" title="Whole Texture" subtitle="后写入状态覆盖同一 Sprite" />
            <LayeredFigurePreview motionPackage={motionPackage} state={safeState} mode="independent" title="Independent Parts" subtitle="base → eye patch → mouth patch" />
          </div>
          <div className="compare-proof">
            <span className="proof-baseline">A · 只能保留最后写入的 <b>{safeState.lastChanged}</b> 状态</span>
            <span className="proof-good">B · 同时保留 <b>{safeState.eyes} eye + {safeState.mouth} mouth</b></span>
          </div>
        </div>

        <aside className="facial-lab__inspector">
          <LayeredFigurePreview faceZoom motionPackage={motionPackage} state={safeState} mode="independent" title="Face Crop" subtitle="局部像素检查" />
          <section className="inspector-section">
            <header><Layers3 size={14} /><strong>表情与演出</strong></header>
            <div className="expression-switch">
              {expressionIds.map((id) => <button key={id} className={safeState.expressionId === id ? "active" : ""} onClick={() => { setAutoPlan(false); setExpressionId(id); }}>{motionPackage.manifest.expressions[id].label || id}</button>)}
            </div>
            <label className="check-row"><input type="checkbox" checked={autoPlan} onChange={(event) => setAutoPlan(event.target.checked)} /><span><b>语义演出计划</b><small>6.2s swap · 7.6s micro lean · 脚点锁定</small></span></label>
          </section>
          <section className="inspector-section">
            <header><SlidersHorizontal size={14} /><strong>Mouth profile</strong><code>{timeline.segments.length} SEG</code></header>
            <label><span>Attack <b>{mouthProfile.attackMs}ms</b></span><input type="range" min="20" max="100" step="5" value={mouthProfile.attackMs} onChange={(event) => updateMouth({ attackMs: sliderValue(event) })} /></label>
            <label><span>Release <b>{mouthProfile.releaseMs}ms</b></span><input type="range" min="60" max="220" step="5" value={mouthProfile.releaseMs} onChange={(event) => updateMouth({ releaseMs: sliderValue(event) })} /></label>
            <label><span>Min hold <b>{mouthProfile.minHoldMs}ms</b></span><input type="range" min="60" max="180" step="5" value={mouthProfile.minHoldMs} onChange={(event) => updateMouth({ minHoldMs: sliderValue(event) })} /></label>
            <label><span>Open threshold <b>{mouthProfile.openThreshold.toFixed(2)}</b></span><input type="range" min="0.35" max="0.8" step="0.01" value={mouthProfile.openThreshold} onChange={(event) => updateMouth({ openThreshold: sliderValue(event) })} /></label>
          </section>
          <section className="inspector-section">
            <header><Gauge size={14} /><strong>Blink profile</strong><code>SEED {blinkProfile.seed}</code></header>
            <label><span>Median interval <b>{blinkProfile.medianIntervalMs}ms</b></span><input type="range" min="2800" max="6500" step="100" value={blinkProfile.medianIntervalMs} onChange={(event) => setBlinkProfile({ ...blinkProfile, medianIntervalMs: sliderValue(event) })} /></label>
            <label><span>Double blink <b>{Math.round(blinkProfile.doubleBlinkChance * 100)}%</b></span><input type="range" min="0" max="0.25" step="0.01" value={blinkProfile.doubleBlinkChance} onChange={(event) => setBlinkProfile({ ...blinkProfile, doubleBlinkChance: sliderValue(event) })} /></label>
            <label><span>Seed <b>{blinkProfile.seed}</b></span><input type="number" value={blinkProfile.seed} onChange={(event) => setBlinkProfile({ ...blinkProfile, seed: sliderValue(event) || 1 })} /></label>
          </section>
          <div className="export-actions">
            <button onClick={() => downloadJson("face-motion-profile.json", { mouth: mouthProfile, blink: blinkProfile })}><Download size={14} /> 导出 profile</button>
            <button onClick={() => downloadJson("mouth-timeline.json", timeline)}><Download size={14} /> 导出 timeline</button>
          </div>
        </aside>
      </section>

      <section className="facial-lab__timeline">
        <header><div><span className="facial-lab__eyebrow">DETERMINISTIC TIMELINE</span><h2>语音包络与运行时事件</h2></div><div className="timeline-legend"><span className="legend-raw">RAW</span><span className="legend-smooth">SMOOTHED</span><span className="legend-cursor">PLAYHEAD</span></div></header>
        <AudioWaveform envelope={envelope} timeMs={timeMs} onSeek={seek} />
        <MotionTimeline mouth={timeline} blinks={blinks} cues={FACE_MOTION_PERFORMANCE_FIXTURE.cues} timeMs={timeMs} />
      </section>
    </main>
  );
}
