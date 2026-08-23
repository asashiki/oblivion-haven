import assert from "node:assert/strict";
import test from "node:test";

import { WEBGAL_FACE_MOTION_ADAPTER_SOURCE } from "../lib/figure-motion/webgalFaceMotionAdapter";

class FakeSprite {
  anchor = { set: () => undefined };
  position = { x: 0, y: 720, set: (x: number, y: number) => { this.position.x = x; this.position.y = y; } };
  scale = { x: 1, y: 1, set: (x: number, y: number) => { this.scale.x = x; this.scale.y = y; } };
  rotation = 0;
  alpha = 1;
  visible = true;
  texture: unknown;
}

test("编译后的 WebGAL 面部适配器可解析并实际挂载独立眼嘴层", async () => {
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(WEBGAL_FACE_MOTION_ADAPTER_SOURCE).toString("base64")}`;
  const adapter = await import(moduleUrl) as { attach: (core: unknown, manifest: unknown) => boolean };
  const base = new FakeSprite();
  const container = {
    children: [base],
    addChild(sprite: FakeSprite) { this.children.push(sprite); },
  };
  const resources: Record<string, { texture: unknown }> = {};
  const stage = {
    assetLoader: { resources },
    getStageObjByKey: (key: string) => key === "char-mai" ? ({ pixiContainer: container, sourceUrl: "./game/figure/base.png" }) : undefined,
    loadAsset: (path: string, done: () => void) => {
      if (path.startsWith("./game/figure/")) resources[path] = { texture: { path } };
      done();
    },
    requestRender: () => undefined,
  };
  const manifest = {
    canvas: { width: 1024, height: 1536 },
    figures: {
      "char-mai": {
        expressions: {
          normal: {
            base: "base.png",
            canvas: { width: 1024, height: 1536 },
            eyes: { closed: { file: "parts/eye-closed.png", rect: { x: 400, y: 280, width: 200, height: 80 } } },
            mouth: { open: { file: "parts/mouth-open.png", rect: { x: 480, y: 360, width: 70, height: 50 } } },
          },
        },
      },
    },
  };

  assert.equal(adapter.attach({ gameplay: { pixiStage: stage } }, manifest), true);
  stage.performMouthSyncAnimation("char-mai", {}, "open");
  stage.performBlinkAnimation("char-mai", {}, "closed");

  const layers = (container as typeof container & { __galBlogFaceLayers: Record<string, FakeSprite> }).__galBlogFaceLayers;
  assert.equal((layers.mouth.texture as { path: string }).path, "./game/figure/parts/mouth-open.png");
  assert.equal((layers.eyes.texture as { path: string }).path, "./game/figure/parts/eye-closed.png");
  assert.equal(layers.mouth.visible, true);
  assert.equal(layers.eyes.visible, true);
  assert.deepEqual({ x: layers.mouth.position.x, y: layers.mouth.position.y }, { x: 3, y: 337 });
});
