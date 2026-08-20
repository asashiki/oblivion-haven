export const WEBGAL_FACE_MOTION_ADAPTER_SOURCE = `
const normalizePath = (value) => String(value || "").replace(/^\\/+/, "").replace(/^.*?\\/game\\/figure\\//, "");
const findExpression = (manifest, key, sourceUrl) => {
  const figure = manifest?.figures?.[key];
  if (!figure) return null;
  const source = normalizePath(sourceUrl);
  return Object.values(figure.expressions || {}).find((item) => {
    const base = normalizePath(item.base);
    return source === base || source.endsWith("/" + base) || base.endsWith("/" + source);
  }) || null;
};
const loadTexture = (stage, path, done) => {
  if (!path) return done(null);
  const cached = stage.assetLoader?.resources?.[path]?.texture;
  if (cached) return done(cached);
  try { stage.loadAsset(path, () => done(stage.assetLoader?.resources?.[path]?.texture || null)); }
  catch (_) { done(null); }
};
const ensureLayer = (container, name, SpriteCtor) => {
  container.__galBlogFaceLayers ||= {};
  if (container.__galBlogFaceLayers[name]) return container.__galBlogFaceLayers[name];
  const layer = new SpriteCtor();
  layer.anchor?.set?.(0.5);
  layer.visible = false;
  container.addChild(layer);
  container.__galBlogFaceLayers[name] = layer;
  return layer;
};
const setLayer = (stage, key, region, state, manifest) => {
  const object = stage.getStageObjByKey?.(key);
  const container = object?.pixiContainer;
  const base = container?.children?.[0];
  if (!object || !container || !base) return;
  const expression = findExpression(manifest, key, object.sourceUrl);
  if (expression) container.__galBlogFaceExpressionId = Object.entries(manifest.figures?.[key]?.expressions || {}).find(([, item]) => item === expression)?.[0];
  const entry = expression?.[region]?.[state];
  const layer = ensureLayer(container, region, base.constructor);
  if (!entry) { layer.visible = false; return; }
  loadTexture(stage, entry.file, (texture) => {
    if (!texture) return;
    layer.texture = texture;
    layer.anchor?.set?.(0.5);
    const canvas = expression.canvas || manifest.canvas || { width: 1024, height: 1536 };
    // WebGAL's figure Sprite is centered on the stage (its local y already
    // includes stageHeight / 2).  Parts live in the same container, so place
    // them relative to that Sprite rather than the container's pivot origin.
    const basePosition = base.position || { x: 0, y: canvas.height / 2 };
    layer.position.set(
      basePosition.x + entry.rect.x + entry.rect.width / 2 - canvas.width / 2,
      basePosition.y + entry.rect.y + entry.rect.height / 2 - canvas.height / 2,
    );
    layer.scale.set(base.scale.x, base.scale.y);
    layer.rotation = 0; layer.alpha = 1; layer.visible = true;
    stage.requestRender?.();
  });
};
const swapExpression = (stage, key, expressionId, manifest) => {
  const object = stage.getStageObjByKey?.(key);
  const container = object?.pixiContainer;
  const base = container?.children?.[0];
  const expression = manifest?.figures?.[key]?.expressions?.[expressionId];
  if (!object || !container || !base || !expression) return;
  loadTexture(stage, expression.base, (texture) => {
    if (!texture) return;
    base.texture = texture;
    object.sourceUrl = expression.base;
    container.__galBlogFaceExpressionId = expressionId;
    for (const layer of Object.values(container.__galBlogFaceLayers || {})) layer.visible = false;
    stage.requestRender?.();
  });
};
export function attach(core, manifest) {
  const resolveStage = () => core?.gameplay?.pixiStage || core?.pixiStage || null;
  const install = (stage) => {
    if (!stage) return false;
    if (stage.__galBlogFaceMotionAttached) return true;
    stage.__galBlogFaceMotionAttached = true;
  stage.performMouthSyncAnimation = (key, _item, state) => setLayer(stage, key, "mouth", state === "open" ? "open" : state === "half_open" ? "half" : "closed", manifest);
  stage.performBlinkAnimation = (key, _item, state) => setLayer(stage, key, "eyes", state === "closed" ? "closed" : "open", manifest);
  const scheduled = new WeakMap();
  const onPlay = (event) => {
    const audio = event.target;
    if (!(audio instanceof HTMLMediaElement) || audio.id !== "currentVocal") return;
    for (const cue of manifest?.performance || []) {
      const token = cue.key + ":" + cue.atMs + ":" + cue.toExpressionId;
      if (scheduled.get(audio)?.has(token)) continue;
      const timers = scheduled.get(audio) || new Set();
      timers.add(token); scheduled.set(audio, timers);
      window.setTimeout(() => {
        const object = stage.getStageObjByKey?.(cue.key);
        const current = object?.pixiContainer?.__galBlogFaceExpressionId || object?.expressionId;
        if (!cue.fromExpressionId || current === cue.fromExpressionId || !current) swapExpression(stage, cue.key, cue.toExpressionId, manifest);
      }, Math.max(0, cue.atMs));
    }
  };
    document.addEventListener("play", onPlay, true);
    globalThis.GalBlogFaceMotion = { stage, manifest };
    return true;
  };
  const stage = resolveStage();
  if (install(stage)) return true;
  // WebGAL creates gameplay.pixiStage during its first render.  The adapter
  // is loaded beside the engine module, so retry briefly instead of silently
  // missing the stage when initialization is asynchronous.
  let attempts = 0;
  const timer = window.setInterval(() => {
    if (install(resolveStage()) || ++attempts > 200) window.clearInterval(timer);
  }, 50);
  return false;
}
`;
