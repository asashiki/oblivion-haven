export type Rect = { x: number; y: number; width: number; height: number };

export type PartRef = {
  file: string;
  rect: Rect;
  sha256: string;
};

export type MouthState = "closed" | "half" | "open";
export type EyeState = "open" | "half" | "closed";

export type MouthProfile = {
  windowMs: number;
  noiseFloorPercentile: number;
  peakPercentile: number;
  attackMs: number;
  releaseMs: number;
  minHoldMs: number;
  closeThreshold: number;
  openThreshold: number;
  hysteresis: number;
  mergeGapMs: number;
};

export type BlinkProfile = {
  minIntervalMs: number;
  medianIntervalMs: number;
  maxIntervalMs: number;
  halfMs: number;
  closedMs: number;
  doubleBlinkChance: number;
  phraseBoundaryBias: number;
  suppressAroundSwapMs: number;
  seed: number;
};

export type FacialMotionExpression = {
  label?: string;
  base: string;
  sourceSha256: string;
  eyes: { open: PartRef; half?: PartRef; closed: PartRef };
  mouth: { closed: PartRef; half: PartRef; open: PartRef };
};

export type FacialMotionPackageV2 = {
  schema: "galgame-face-motion/v2";
  canvas: { width: number; height: number };
  expressions: Record<string, FacialMotionExpression>;
  profile: { mouth: MouthProfile; blink: BlinkProfile };
};

export const DEFAULT_MOUTH_PROFILE: MouthProfile = {
  windowMs: 24,
  noiseFloorPercentile: 0.15,
  peakPercentile: 0.92,
  attackMs: 45,
  releaseMs: 110,
  minHoldMs: 80,
  closeThreshold: 0.18,
  openThreshold: 0.58,
  hysteresis: 0.07,
  mergeGapMs: 60,
};

export const DEFAULT_BLINK_PROFILE: BlinkProfile = {
  minIntervalMs: 2200,
  medianIntervalMs: 4300,
  maxIntervalMs: 8500,
  halfMs: 45,
  closedMs: 75,
  doubleBlinkChance: 0.08,
  phraseBoundaryBias: 0.35,
  suppressAroundSwapMs: 250,
  seed: 12345,
};
