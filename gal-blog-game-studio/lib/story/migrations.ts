import { figureShotFromTransform, recommendedFigureTransform } from "./figureFraming";
import type { StageTransform, StoryAsset, StoryProject } from "./types";

const LEGACY_PRESETS = [
  { scale: 2.15, y: 760 },
  { scale: 1.82, y: 570 },
  { scale: 1.36, y: 300 },
  { scale: 0.94, y: 34 },
];

function isLegacyPreset(transform?: StageTransform): boolean {
  if (typeof transform?.scale !== "number" || typeof transform?.y !== "number") return false;
  return LEGACY_PRESETS.some((preset) => (
    Math.abs(transform.scale! - preset.scale) < 0.015
    && Math.abs(transform.y! - preset.y) < 2
  ));
}

function migrateTransform(asset: StoryAsset | undefined, transform?: StageTransform): StageTransform | undefined {
  if (!asset || !isLegacyPreset(transform)) return transform;
  const shot = figureShotFromTransform(transform, asset);
  const recommended = recommendedFigureTransform(asset, shot);
  return { ...transform, y: recommended.y, scale: recommended.scale };
}

/** Upgrade v15's canvas-assumption presets to the real WebGAL 4.6.2 Pixi fit. */
export function migrateWebGalFigureFraming(project: StoryProject): StoryProject {
  if (project.assets.every((asset) => !["figure", "expression"].includes(asset.kind) || asset.metadata?.figureFramingVersion === 2)) {
    return project;
  }
  const assets = project.assets.map((asset) => {
    if (!["figure", "expression"].includes(asset.kind)) return asset;
    const current = {
      x: typeof asset.metadata?.figureDefaultX === "number" ? asset.metadata.figureDefaultX : 0,
      y: typeof asset.metadata?.figureDefaultY === "number" ? asset.metadata.figureDefaultY : undefined,
      scale: typeof asset.metadata?.figureDefaultScale === "number" ? asset.metadata.figureDefaultScale : undefined,
    };
    const next = migrateTransform(asset, current) || current;
    return {
      ...asset,
      metadata: {
        ...asset.metadata,
        figureFramingVersion: 2,
        ...(next.y !== undefined ? { figureDefaultY: next.y } : {}),
        ...(next.scale !== undefined ? { figureDefaultScale: next.scale } : {}),
      },
    };
  });
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const expressionAsset = (characterId?: string, expressionId?: string) => {
    const character = project.characters.find((item) => item.id === characterId);
    const expression = character?.expressions.find((item) => item.id === (expressionId || character.defaultExpressionId));
    return expression ? assetById.get(expression.assetId) : undefined;
  };
  return {
    ...project,
    assets,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      entryStage: scene.entryStage ? {
        ...scene.entryStage,
        figures: scene.entryStage.figures?.map((figure) => ({
          ...figure,
          transform: migrateTransform(expressionAsset(figure.characterId, figure.expressionId), figure.transform),
        })),
      } : undefined,
      blocks: scene.blocks.map((block) => (
        block.type === "stage" && block.characterId && block.transform
          ? { ...block, transform: migrateTransform(expressionAsset(block.characterId, block.expressionId), block.transform) }
          : block
      )),
    })),
  };
}
