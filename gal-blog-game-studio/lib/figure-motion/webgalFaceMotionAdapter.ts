export const WEBGAL_FACE_MOTION_ADAPTER_SOURCE = `
const normalizePath = (value) => String(value || "")
  .replace(/^\\/+/, "")
  .replace(/^.*?\\/?game\\/figure\\//, "");
// WebGAL's compiler resolves figure resources to ./game/figure/<asset path>.
// The layered manifest stores the project-relative asset path, so adapter
// loads must go through the same resource namespace or the patch texture is
// never found (the base sprite remains static with no visible error).
const figureResourcePath = (value) => {
  const path = String(value || "").replace(/^\\/+/, "");
  if (!path) return "";
  if (/^(?:https?:)?\\/\\//.test(path) || path.startsWith("./game/")) return path;
  if (path.startsWith("game/")) return "./" + path;
  return "./game/figure/" + path;
};
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
  const normalized = normalizePath(path);
  const candidates = [...new Set([
    path,
    normalized,
    figureResourcePath(path),
    "./" + figureResourcePath(path).replace(/^\.\//, ""),
    "/" + normalized,
  ])];
  let index = 0;
  const tryNext = () => {
    const resourcePath = candidates[index++];
    if (!resourcePath) return done(null);
    const cached = stage.assetLoader?.resources?.[resourcePath]?.texture;
    if (cached) return done(cached);
    try {
      stage.loadAsset(resourcePath, () => {
        const texture = stage.assetLoader?.resources?.[resourcePath]?.texture;
        if (texture) return done(texture);
        tryNext();
      });
    } catch (_) {
      tryNext();
    }
  };
  tryNext();
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
  // The bundled WebGAL module exports the engine singleton, but depending on
  // the load order it can be published before gameplay.pixiStage exists. Keep
  // resolving the live singleton instead of freezing an empty import-time
  // reference; otherwise the adapter installs successfully yet never reaches
  // the stage that renders the figure.
  const runtimeCandidates = () => [
    core,
    globalThis.WebGAL,
    globalThis.__WEBGAL__,
    globalThis.__WEBGAL_CORE__,
  ].filter(Boolean);
  const resolveStage = () => {
    for (const runtime of runtimeCandidates()) {
      const stage = runtime?.gameplay?.pixiStage || runtime?.pixiStage;
      if (stage) return stage;
    }
    return null;
  };
  const install = (stage) => {
    if (!stage) return false;
    if (stage.__galBlogFaceMotionAttached) return true;
    stage.__galBlogFaceMotionAttached = true;
  stage.performMouthSyncAnimation = (key, _item, state) => setLayer(stage, key, "mouth", state === "open" ? "open" : state === "half_open" ? "half" : "closed", manifest);
  stage.performBlinkAnimation = (key, _item, state) => setLayer(stage, key, "eyes", state === "closed" ? "closed" : "open", manifest);
    const timelinePromise = manifest?.mouthTimelinePath
      ? fetch("./game/face-motion/mouth-timeline.json", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null)
      : Promise.resolve(null);
    const audioStates = new WeakMap();
    const hash = (value) => [...String(value)].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 10000, 7);
    const blinkStateAt = (key, timeMs) => {
      const phase = (timeMs + hash(key) * 13) % 5200;
      if (phase < 42) return "half";
      if (phase < 118) return "closed";
      return "open";
    };
    const mouthStateAt = (timeline, timeMs) => {
      const segment = timeline?.segments?.find((item) => timeMs >= item.startMs && timeMs < item.endMs);
      return segment?.state || "closed";
    };
    const resetLayers = () => {
      for (const key of Object.keys(manifest?.figures || {})) {
        setLayer(stage, key, "mouth", "closed", manifest);
        setLayer(stage, key, "eyes", "open", manifest);
      }
    };
    const driveLayers = async () => {
      const timeline = await timelinePromise;
      const tick = () => {
        const audio = document.getElementById("currentVocal");
        if (audio && !audio.paused) {
          const timeMs = audio.currentTime * 1000;
          let state = audioStates.get(audio);
          if (!state || timeMs < state.lastTimeMs - 100) state = { applied: new Set(), layers: new Map(), lastTimeMs: -1, normalized: false };
          state.lastTimeMs = timeMs;
          state.normalized = false;
          for (const key of Object.keys(manifest?.figures || {})) {
            for (const cue of manifest?.performance || []) {
              if (cue.key !== key || timeMs < cue.atMs) continue;
              const token = cue.key + ":" + cue.atMs + ":" + cue.toExpressionId;
              if (state.applied.has(token)) continue;
              swapExpression(stage, cue.key, cue.toExpressionId, manifest);
              state.applied.add(token);
            }
            const layers = state.layers.get(key) || {};
            const mouth = mouthStateAt(timeline, timeMs);
            const eyes = blinkStateAt(key, timeMs);
            if (layers.mouth !== mouth) {
              setLayer(stage, key, "mouth", mouth, manifest);
              layers.mouth = mouth;
            }
            if (layers.eyes !== eyes) {
              setLayer(stage, key, "eyes", eyes, manifest);
              layers.eyes = eyes;
            }
            state.layers.set(key, layers);
          }
          audioStates.set(audio, state);
        } else if (audio) {
          const state = audioStates.get(audio);
          if (!state?.normalized) {
            resetLayers();
            audioStates.set(audio, { ...(state || { applied: new Set(), layers: new Map(), lastTimeMs: -1 }), normalized: true });
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    globalThis.GalBlogFaceMotion = { stage, manifest, status: "installed" };
    void driveLayers();
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
