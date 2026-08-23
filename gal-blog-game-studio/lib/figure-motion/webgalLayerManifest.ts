import type { FaceMotionPart, StoryProject } from "../story/types";
import { slugify } from "../story/utils";

export type WebGalLayerManifest = {
  schema: "galgame-face-motion/webgal-layered/v1";
  canvas: { width: number; height: number };
  /** Runtime-relative path for the deterministic voice timeline used by the adapter. */
  mouthTimelinePath?: string;
  figures: Record<string, {
    expressions: Record<string, {
      base: string;
      canvas: { width: number; height: number };
      eyes: Record<string, FaceMotionPart>;
      mouth: Record<string, FaceMotionPart>;
    }>;
  }>;
  performance?: Array<{ key: string; fromExpressionId?: string; toExpressionId: string; atMs: number }>;
};

export function buildWebGalLayerManifest(project: StoryProject): WebGalLayerManifest {
  const result: WebGalLayerManifest = {
    schema: "galgame-face-motion/webgal-layered/v1",
    canvas: { width: 1024, height: 1536 },
    figures: {},
    performance: [],
  };
  const timelineAsset = project.assets.find((asset) => (
    asset.kind === "voice" && typeof asset.metadata?.mouthTimelinePath === "string"
  ));
  if (timelineAsset) result.mouthTimelinePath = "game/face-motion/mouth-timeline.json";
  for (const character of project.characters) {
    const figureKey = `char-${slugify(character.name || character.id)}`;
    const expressions: WebGalLayerManifest["figures"][string]["expressions"] = {};
    for (const expression of character.expressions) {
      const motion = expression.facialMotion;
      if (!motion?.parts || !motion.canvas) continue;
      const base = project.assets.find((asset) => asset.id === expression.assetId)?.path;
      if (!base) continue;
      expressions[expression.id] = {
        base,
        canvas: motion.canvas,
        eyes: motion.parts.eyes || {},
        mouth: motion.parts.mouth || {},
      };
    }
    if (Object.keys(expressions).length) result.figures[figureKey] = { expressions };
  }
  for (const scene of project.scenes) {
    for (const cue of scene.staging?.cues || []) {
      if (cue.timing !== "during-line" || typeof cue.voiceTimeMs !== "number" || !cue.targetCharacterId || !cue.expressionId) continue;
      const character = project.characters.find((item) => item.id === cue.targetCharacterId);
      if (!character) continue;
      const block = scene.blocks.find((item) => item.id === cue.blockId);
      if (!block || block.type !== "dialogue") continue;
      result.performance?.push({
        key: `char-${slugify(character.name || character.id)}`,
        fromExpressionId: block.expressionId,
        toExpressionId: cue.expressionId,
        atMs: cue.voiceTimeMs,
      });
    }
  }
  return result;
}
