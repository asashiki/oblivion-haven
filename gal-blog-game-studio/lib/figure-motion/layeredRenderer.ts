import type { EyeState, FacialMotionExpression, MouthState, PartRef, Rect } from "./schema";

export type FigureStageTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type FigureRenderState = {
  expressionId: string;
  eyes: EyeState;
  mouth: MouthState;
  lastChanged: "eyes" | "mouth";
  stageTransform: FigureStageTransform;
};

export type DrawOperation =
  | { kind: "clear-canvas" }
  | { kind: "draw-base"; file: string }
  | { kind: "clear-rect"; rect: Rect; layer: "eyes" | "mouth" }
  | { kind: "draw-part"; part: PartRef; layer: "eyes" | "mouth" };

function eyePart(expression: FacialMotionExpression, state: EyeState): PartRef {
  if (state === "half") return expression.eyes.half || expression.eyes.closed;
  return state === "closed" ? expression.eyes.closed : expression.eyes.open;
}

function mouthPart(expression: FacialMotionExpression, state: MouthState): PartRef {
  return expression.mouth[state];
}

export function independentLayerPlan(expression: FacialMotionExpression, eyes: EyeState, mouth: MouthState): DrawOperation[] {
  const eye = eyePart(expression, eyes);
  const lip = mouthPart(expression, mouth);
  return [
    { kind: "clear-canvas" },
    { kind: "draw-base", file: expression.base },
    { kind: "clear-rect", rect: eye.rect, layer: "eyes" },
    { kind: "draw-part", part: eye, layer: "eyes" },
    { kind: "clear-rect", rect: lip.rect, layer: "mouth" },
    { kind: "draw-part", part: lip, layer: "mouth" },
  ];
}

export function webGalWholeTexturePlan(
  expression: FacialMotionExpression,
  eyes: EyeState,
  mouth: MouthState,
  lastChanged: "eyes" | "mouth",
): DrawOperation[] {
  const part = lastChanged === "eyes" ? eyePart(expression, eyes) : mouthPart(expression, mouth);
  return [
    { kind: "clear-canvas" },
    { kind: "draw-base", file: expression.base },
    { kind: "clear-rect", rect: part.rect, layer: lastChanged },
    { kind: "draw-part", part, layer: lastChanged },
  ];
}

export function normalizedPausedState(state: FigureRenderState): FigureRenderState {
  return { ...state, eyes: "open", mouth: "closed", lastChanged: "mouth" };
}

export function swapExpression(state: FigureRenderState, expressionId: string): FigureRenderState {
  return { ...state, expressionId, stageTransform: { ...state.stageTransform } };
}

export class LayeredFigureRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly imageCache = new Map<string, Promise<HTMLImageElement>>();

  constructor(canvas: HTMLCanvasElement, private readonly resolveUrl: (path: string) => string) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Canvas2D。");
    this.canvas = canvas;
    this.context = context;
  }

  private load(path: string): Promise<HTMLImageElement> {
    if (!this.imageCache.has(path)) {
      this.imageCache.set(path, new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`图片载入失败：${path}`));
        image.src = this.resolveUrl(path);
      }));
    }
    return this.imageCache.get(path)!;
  }

  async draw(expression: FacialMotionExpression, state: FigureRenderState, mode: "independent" | "webgal"): Promise<void> {
    const operations = mode === "independent"
      ? independentLayerPlan(expression, state.eyes, state.mouth)
      : webGalWholeTexturePlan(expression, state.eyes, state.mouth, state.lastChanged);
    for (const operation of operations) {
      if (operation.kind === "clear-canvas") this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      else if (operation.kind === "draw-base") {
        const image = await this.load(operation.file);
        this.context.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      } else if (operation.kind === "clear-rect") {
        this.context.clearRect(operation.rect.x, operation.rect.y, operation.rect.width, operation.rect.height);
      } else {
        const image = await this.load(operation.part.file);
        const rect = operation.part.rect;
        this.context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
      }
    }
  }
}
