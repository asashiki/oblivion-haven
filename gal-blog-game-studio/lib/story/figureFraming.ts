import type { StagePosition, StageTransform, StoryAsset, StoryScene } from "./types";

export type FigureShot = "bust" | "waist" | "knee" | "full";
export type FigureLayoutPatch = {
  position?: StagePosition;
  shot?: FigureShot;
  transform?: StageTransform;
};

export const FIGURE_SHOT_LABELS: Record<FigureShot, string> = {
  bust: "胸像",
  waist: "腰上",
  knee: "膝上",
  full: "全身",
};

export const WEBGAL_STAGE_WIDTH = 2560;
export const WEBGAL_STAGE_HEIGHT = 1440;

const FIGURE_SHOT_PRESETS: Record<FigureShot, StageTransform> = {
  bust: { scale: 2.15, y: 760 },
  waist: { scale: 1.82, y: 570 },
  knee: { scale: 1.36, y: 300 },
  full: { scale: 0.94, y: 34 },
};

const EDITABLE_POSITIONS = new Set<StagePosition>(["left", "center", "right"]);

function metadataNumber(asset: StoryAsset | undefined, key: string): number | undefined {
  const value = asset?.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export type WebGalFigureBaseLayout = {
  sourceWidth: number;
  sourceHeight: number;
  fitScale: number;
  fittedWidth: number;
  fittedHeight: number;
  baseX: number;
  baseY: number;
};

/**
 * Mirrors WebGAL 4.6.2 PixiStage.addFigure exactly: the entire source canvas is
 * fitted inside 2560x1440, short figures are bottom-aligned, and left/center/
 * right are calculated from the fitted canvas width (not fixed percentages).
 */
export function webgalFigureBaseLayout(
  asset?: StoryAsset,
  position: StagePosition = "center",
): WebGalFigureBaseLayout {
  const sourceWidth = metadataNumber(asset, "sourceWidth") ?? 960;
  const sourceHeight = metadataNumber(asset, "sourceHeight") ?? 1440;
  const fitScale = Math.min(WEBGAL_STAGE_WIDTH / sourceWidth, WEBGAL_STAGE_HEIGHT / sourceHeight);
  const fittedWidth = sourceWidth * fitScale;
  const fittedHeight = sourceHeight * fitScale;
  const baseY = WEBGAL_STAGE_HEIGHT / 2 + Math.max(0, (WEBGAL_STAGE_HEIGHT - fittedHeight) / 2);
  const baseX = position === "left" || position === "far-left"
    ? fittedWidth / 2
    : position === "right" || position === "far-right"
      ? WEBGAL_STAGE_WIDTH - fittedWidth / 2
      : WEBGAL_STAGE_WIDTH / 2;
  return { sourceWidth, sourceHeight, fitScale, fittedWidth, fittedHeight, baseX, baseY };
}

export function normalizeFigurePosition(value: unknown): StagePosition {
  return typeof value === "string" && EDITABLE_POSITIONS.has(value as StagePosition)
    ? value as StagePosition
    : "right";
}

export function normalizeFigureTransform(transform?: StageTransform): StageTransform {
  return {
    x: Math.max(-1280, Math.min(1280, Number.isFinite(transform?.x) ? Number(transform?.x) : 0)),
    y: Math.max(-720, Math.min(1080, Number.isFinite(transform?.y) ? Number(transform?.y) : 0)),
    scale: Math.max(0.35, Math.min(3.2, Number.isFinite(transform?.scale) ? Number(transform?.scale) : 1)),
    ...(Number.isFinite(transform?.rotation) ? { rotation: Number(transform?.rotation) } : {}),
    ...(Number.isFinite(transform?.alpha) ? { alpha: Number(transform?.alpha) } : {}),
    ...(Number.isFinite(transform?.zIndex) ? { zIndex: Number(transform?.zIndex) } : {}),
  };
}

export function normalizeFigureShot(value: unknown): FigureShot {
  return value === "bust" || value === "knee" || value === "full" ? value : "waist";
}

export function figureShotTransform(shot: FigureShot): StageTransform {
  return { ...FIGURE_SHOT_PRESETS[shot] };
}

export function recommendedFigureTransform(
  asset: StoryAsset | undefined,
  shot: FigureShot,
): StageTransform {
  const fallback = figureShotTransform(shot);
  const visibleTop = metadataNumber(asset, "figureVisibleTop");
  const visibleBottom = metadataNumber(asset, "figureVisibleBottom");
  if (
    visibleTop === undefined
    || visibleBottom === undefined
    || visibleTop < 0
    || visibleTop > 0.45
    || visibleBottom < 0.55
    || visibleBottom > 1
    || visibleBottom - visibleTop < 0.35
  ) {
    return normalizeFigureTransform(fallback);
  }

  const bodyFraction: Record<FigureShot, number> = {
    bust: 0.49,
    waist: 0.56,
    knee: 0.73,
    full: 1,
  };
  const targetTop = shot === "full" ? 28 : 18;
  const targetBottom = shot === "full" ? 1390 : 1430;
  const base = webgalFigureBaseLayout(asset, "center");
  const visibleTopPx = visibleTop * base.fittedHeight;
  const cutPoint = visibleTop + (visibleBottom - visibleTop) * bodyFraction[shot];
  const cutPointPx = cutPoint * base.fittedHeight;
  const scale = (targetBottom - targetTop) / (cutPointPx - visibleTopPx);
  const y = targetTop - base.baseY - scale * (visibleTopPx - base.fittedHeight / 2);
  return normalizeFigureTransform({ x: 0, y, scale });
}

export function inferFigureShot(asset?: StoryAsset): FigureShot {
  if (!asset) return "waist";
  const declared = asset.metadata?.figureShot;
  if (declared) return normalizeFigureShot(declared);
  const searchable = [
    asset.name,
    asset.path,
    ...asset.aliases,
    String(asset.metadata?.description || ""),
    String(asset.metadata?.tags || ""),
  ].join(" ").toLowerCase();
  return /chibi|q版|q 版|小人|sd\b/.test(searchable) ? "full" : "waist";
}

export function assetDefaultPosition(asset?: StoryAsset): StagePosition {
  return normalizeFigurePosition(asset?.metadata?.figureDefaultPosition);
}

export function assetDefaultTransform(asset?: StoryAsset): StageTransform {
  const preset = recommendedFigureTransform(asset, inferFigureShot(asset));
  return normalizeFigureTransform({
    ...preset,
    x: metadataNumber(asset, "figureDefaultX") ?? preset.x ?? 0,
    y: metadataNumber(asset, "figureDefaultY") ?? preset.y ?? 0,
    scale: metadataNumber(asset, "figureDefaultScale") ?? preset.scale ?? 1,
  });
}

export function figureLayoutMetadata(
  position: StagePosition,
  transform: StageTransform,
): Record<string, string | number | boolean> {
  const normalized = normalizeFigureTransform(transform);
  return {
    figureDefaultPosition: normalizeFigurePosition(position),
    figureDefaultX: normalized.x ?? 0,
    figureDefaultY: normalized.y ?? 0,
    figureDefaultScale: normalized.scale ?? 1,
  };
}

export function figureShotFromTransform(
  transform?: StageTransform,
  asset?: StoryAsset,
): FigureShot {
  const scale = transform?.scale;
  if (typeof scale !== "number") return inferFigureShot(asset);
  return (Object.keys(FIGURE_SHOT_LABELS) as FigureShot[]).reduce((closest, shot) => {
    const expected = recommendedFigureTransform(asset, shot).scale ?? 1;
    const closestExpected = recommendedFigureTransform(asset, closest).scale ?? 1;
    return Math.abs(Math.log(scale / expected)) < Math.abs(Math.log(scale / closestExpected)) ? shot : closest;
  }, "waist");
}

export function figureTransformForAsset(
  asset?: StoryAsset,
  override?: StageTransform,
): StageTransform {
  return normalizeFigureTransform({
    ...assetDefaultTransform(asset),
    ...override,
  });
}

export function applySceneFigureLayout(
  scene: StoryScene,
  characterId: string,
  patch: FigureLayoutPatch,
): StoryScene {
  const currentFigure = scene.entryStage?.figures?.find((figure) => figure.characterId === characterId);
  if (!currentFigure) return scene;
  const position = patch.position || currentFigure.position;
  const transform = patch.transform
    ? normalizeFigureTransform(patch.transform)
    : patch.shot
      ? normalizeFigureTransform(figureShotTransform(patch.shot))
      : currentFigure.transform;

  return {
    ...scene,
    entryStage: {
      ...scene.entryStage,
      figures: (scene.entryStage?.figures || []).map((figure) => (
        figure.characterId === characterId
          ? { ...figure, position, transform }
          : figure
      )),
    },
    blocks: scene.blocks.map((block) => {
      if (
        block.type === "dialogue"
        && block.characterId === characterId
        && patch.position
      ) {
        return { ...block, position };
      }
      if (
        block.type === "stage"
        && block.characterId === characterId
        && (block.action === "enter-character" || block.action === "set-expression")
      ) {
        return {
          ...block,
          ...(patch.position ? { position } : {}),
          ...((patch.shot || patch.transform) ? { transform } : {}),
        };
      }
      return block;
    }),
  };
}
