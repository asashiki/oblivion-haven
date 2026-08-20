"use client";

import type { BlinkEvent } from "@/lib/figure-motion/blinkScheduler";
import type { MouthTimeline } from "@/lib/figure-motion/mouthTimeline";
import type { FigureCue } from "@/lib/story/performancePlan";

type Props = {
  mouth: MouthTimeline;
  blinks: BlinkEvent[];
  cues: FigureCue[];
  timeMs: number;
};

function percent(timeMs: number, durationMs: number): number {
  return Math.max(0, Math.min(100, timeMs / durationMs * 100));
}

export function MotionTimeline({ mouth, blinks, cues, timeMs }: Props) {
  const duration = mouth.durationMs;
  return (
    <div className="motion-timeline">
      <div className="motion-timeline__labels"><span>MOUTH</span><span>BLINK</span><span>CUES</span></div>
      <div className="motion-timeline__tracks">
        <div className="motion-track motion-track--mouth">
          {mouth.segments.map((segment, index) => (
            <i
              key={`${segment.startMs}-${index}`}
              className={`mouth-${segment.state}`}
              title={`${segment.state} · ${Math.round(segment.startMs)}–${Math.round(segment.endMs)}ms`}
              style={{ left: `${percent(segment.startMs, duration)}%`, width: `${percent(segment.endMs - segment.startMs, duration)}%` }}
            />
          ))}
        </div>
        <div className="motion-track motion-track--blink">
          {blinks.filter((event) => event.startMs <= duration).map((event, index) => (
            <i
              key={`${event.startMs}-${index}`}
              className={event.double ? "is-double" : ""}
              title={`blink · ${Math.round(event.startMs)}ms`}
              style={{ left: `${percent(event.startMs, duration)}%`, width: `${Math.max(.5, percent(event.endMs - event.startMs, duration))}%` }}
            />
          ))}
        </div>
        <div className="motion-track motion-track--cues">
          {cues.flatMap((cue) => cue.trigger.kind === "voice-ms" ? [cue] : []).map((cue) => (
            <i key={cue.id} title={`${cue.action} · ${cue.reason}`} style={{ left: `${percent(cue.trigger.kind === "voice-ms" ? cue.trigger.ms : 0, duration)}%` }}>
              <span>{cue.action === "expression-swap" ? "SWAP" : cue.action.toUpperCase()}</span>
            </i>
          ))}
        </div>
        <b className="motion-timeline__cursor" style={{ left: `${percent(timeMs, duration)}%` }} />
      </div>
    </div>
  );
}
