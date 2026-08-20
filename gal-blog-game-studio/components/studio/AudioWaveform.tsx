"use client";

import { useEffect, useRef } from "react";

import type { AudioEnvelope } from "@/lib/figure-motion/audioEnvelope";

type Props = {
  envelope: AudioEnvelope;
  timeMs: number;
  onSeek: (timeMs: number) => void;
};

export function AudioWaveform({ envelope, timeMs, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(dpr, dpr);
    const width = bounds.width;
    const height = bounds.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0a0f19";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(151, 164, 194, .12)";
    context.lineWidth = 1;
    for (let line = 1; line < 5; line += 1) {
      const y = line / 5 * height;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    const drawLine = (key: "normalized" | "smoothed", color: string, lineWidth: number) => {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.beginPath();
      envelope.frames.forEach((frame, index) => {
        const x = frame.timeMs / envelope.durationMs * width;
        const value = frame[key];
        const y = height - 11 - value * (height - 24);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };
    drawLine("normalized", "rgba(128, 148, 190, .36)", 1);
    drawLine("smoothed", "#9b8cff", 2.2);
    const cursor = Math.max(0, Math.min(1, timeMs / envelope.durationMs)) * width;
    context.strokeStyle = "#ffce70";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(cursor, 0);
    context.lineTo(cursor, height);
    context.stroke();
  }, [envelope, timeMs]);

  return (
    <canvas
      ref={canvasRef}
      className="audio-waveform"
      aria-label="语音波形与平滑包络，可点击拖动"
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * envelope.durationMs);
      }}
    />
  );
}
