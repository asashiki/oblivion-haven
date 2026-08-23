"use client";

import { resolveRegisteredAssetUrl } from "./assetUrl";
import { readLocalAssetFile } from "./localAssetStore";
import { compileProject } from "./story/compiler";
import { buildWebGalLayerManifest } from "./figure-motion/webgalLayerManifest";
import type { StageBlock, StoryAsset, StoryBlock, StoryProject } from "./story/types";

const PREVIEW_CACHE = "gal-blog-studio-webgal-preview-v1";
const PREVIEW_SCOPE = "/webgal-runtime/";
const PREVIEW_SESSION_PREFIX = `${PREVIEW_SCOPE}session/`;

export type PreparedWebGalPreview = {
  url: string;
  warnings: string[];
};

function safeRelativePath(path: string): string {
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return normalized || "unnamed-asset";
}

export function webgalAssetTargetPath(asset: StoryAsset): string {
  const source = safeRelativePath(asset.path);
  switch (asset.kind) {
    case "background":
      return `game/background/${source}`;
    case "figure":
    case "expression":
      return `game/figure/${source}`;
    case "bgm":
      return `game/bgm/${source}`;
    case "voice":
    case "sfx":
      return `game/vocal/${source}`;
    case "video":
      return `game/video/${source}`;
    case "animation":
      return `game/animation/${source}`;
    case "ui":
      return `game/template/${source}`;
    default:
      return `game/${source}`;
  }
}

function waitForActiveWorker(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve();
  const worker = registration.installing || registration.waiting;
  if (!worker) return Promise.reject(new Error("WebGAL 预览服务未能启动"));
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("WebGAL 预览服务启动超时")), 12000);
    const onStateChange = () => {
      if (worker.state === "activated") {
        window.clearTimeout(timeout);
        worker.removeEventListener("statechange", onStateChange);
        resolve();
      }
      if (worker.state === "redundant") {
        window.clearTimeout(timeout);
        worker.removeEventListener("statechange", onStateChange);
        reject(new Error("WebGAL 预览服务安装失败"));
      }
    };
    worker.addEventListener("statechange", onStateChange);
  });
}

async function putText(
  cache: Cache,
  url: URL,
  content: string,
  contentType: string,
): Promise<void> {
  await cache.put(url.href, new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  }));
}

async function loadAssetResponse(asset: StoryAsset): Promise<Response | undefined> {
  if (asset.metadata?.localFile) {
    const stored = await readLocalAssetFile(asset.id);
    if (!stored) return undefined;
    return new Response(stored.file, {
      headers: { "Content-Type": stored.type || asset.mimeType || "application/octet-stream" },
    });
  }

  const sourceUrl = resolveRegisteredAssetUrl(asset);
  if (!sourceUrl) return undefined;
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) return undefined;
  return new Response(await response.blob(), {
    headers: {
      "Content-Type": response.headers.get("content-type") || asset.mimeType || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

async function loadPublicResponse(path: string): Promise<Response | undefined> {
  const normalized = safeRelativePath(path);
  if (!normalized || /^(?:https?:)?\/\//i.test(normalized)) return undefined;
  const response = await fetch(new URL(`/${normalized}`, window.location.origin), { cache: "no-store" });
  if (!response.ok) return undefined;
  return new Response(await response.blob(), {
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

async function stageFaceMotionFiles(
  cache: Cache,
  base: URL,
  project: StoryProject,
  warnings: string[],
): Promise<void> {
  const manifest = buildWebGalLayerManifest(project);
  const projectAssetPaths = new Set(project.assets.map((asset) => safeRelativePath(asset.path)));
  const figurePaths = new Set<string>();

  Object.values(manifest.figures).forEach((figure) => {
    Object.values(figure.expressions).forEach((expression) => {
      figurePaths.add(expression.base);
      Object.values(expression.eyes).forEach((part) => part && figurePaths.add(part.file));
      Object.values(expression.mouth).forEach((part) => part && figurePaths.add(part.file));
    });
  });

  await Promise.all([...figurePaths].map(async (path) => {
    const sourcePath = safeRelativePath(path);
    // Base frames are already staged through project.assets. Part files in the
    // bundled MVP are public files, so explicitly place them in WebGAL's
    // figure namespace as well.
    if (projectAssetPaths.has(sourcePath)) return;
    try {
      const response = await loadPublicResponse(sourcePath);
      if (!response) {
        warnings.push(`面部动效部件无法进入 WebGAL 实机：${sourcePath}`);
        return;
      }
      await cache.put(new URL(`game/figure/${sourcePath}`, base).href, response);
    } catch {
      warnings.push(`面部动效部件无法进入 WebGAL 实机：${sourcePath}`);
    }
  }));

  const timelineSource = project.assets.find((asset) => (
    asset.kind === "voice" && typeof asset.metadata?.mouthTimelinePath === "string"
  ));
  const timelinePath = timelineSource?.metadata?.mouthTimelinePath;
  if (typeof timelinePath === "string" && timelinePath.trim()) {
    try {
      const response = await loadPublicResponse(timelinePath);
      if (!response) warnings.push(`口型时间线无法进入 WebGAL 实机：${timelinePath}`);
      else await cache.put(new URL("game/face-motion/mouth-timeline.json", base).href, response);
    } catch {
      warnings.push(`口型时间线无法进入 WebGAL 实机：${timelinePath}`);
    }
  }
}

async function removeOldSessions(cache: Cache, currentBase: string): Promise<void> {
  const keys = await cache.keys();
  await Promise.all(keys.map((request) => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(PREVIEW_SESSION_PREFIX) || request.url.startsWith(currentBase)) return false;
    return cache.delete(request);
  }));
}

function previewEntryBlocks(project: StoryProject, sceneId: string, startBlockId?: string): StoryBlock[] {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return [];

  const targetIndex = startBlockId ? scene.blocks.findIndex((block) => block.id === startBlockId) : -1;
  if (targetIndex >= 0) {
    let backgroundAssetId = scene.entryStage?.backgroundAssetId;
    let bgmAssetId = scene.entryStage?.bgmAssetId;
    let mode = scene.mode;
    const figures = new Map((scene.entryStage?.figures || []).map((figure) => [figure.characterId, { ...figure }]));

    for (const block of scene.blocks.slice(0, targetIndex)) {
      if (block.type === "mode") mode = block.mode;
      if (block.type === "dialogue" && (block.expressionId || block.position || block.transform)) {
        const current = figures.get(block.characterId);
        figures.set(block.characterId, {
          characterId: block.characterId,
          expressionId: block.expressionId || current?.expressionId,
          position: block.position || current?.position || "center",
          transform: { ...(current?.transform || {}), ...(block.transform || {}) },
        });
      }
      if (block.type !== "stage") continue;
      if (block.action === "set-background") backgroundAssetId = block.assetId;
      if (block.action === "play-bgm") bgmAssetId = block.assetId;
      if (block.action === "stop-bgm") bgmAssetId = undefined;
      if (block.action === "clear-stage") figures.clear();
      if (block.action === "exit-character" && block.characterId) figures.delete(block.characterId);
      if (["enter-character", "set-expression", "move-character"].includes(block.action) && block.characterId) {
        const current = figures.get(block.characterId);
        figures.set(block.characterId, {
          characterId: block.characterId,
          expressionId: block.expressionId || current?.expressionId,
          position: block.position || current?.position || "center",
          transform: { ...(current?.transform || {}), ...(block.transform || {}) },
        });
      }
    }

    const restored: StoryBlock[] = [];
    if (mode !== scene.mode) restored.push({ id: `__preview_${scene.id}_mode`, type: "mode", mode, source: "native" });
    if (backgroundAssetId) restored.push({
      id: `__preview_${scene.id}_background`,
      type: "stage",
      action: "set-background",
      assetId: backgroundAssetId,
      source: "native",
    });
    if (bgmAssetId) restored.push({
      id: `__preview_${scene.id}_bgm`,
      type: "stage",
      action: "play-bgm",
      assetId: bgmAssetId,
      source: "native",
    });
    [...figures.values()].forEach((figure, index) => restored.push({
      id: `__preview_${scene.id}_figure_${index}`,
      type: "stage",
      action: "enter-character",
      characterId: figure.characterId,
      expressionId: figure.expressionId,
      position: figure.position,
      transform: figure.transform,
      source: "native",
    }));
    return restored;
  }

  if (!scene.entryStage) return [];

  const firstContentIndex = scene.blocks.findIndex((block) => (
    block.type === "dialogue"
    || block.type === "narration"
    || block.type === "choice"
    || block.type === "input"
  ));
  const openingBlocks = firstContentIndex < 0 ? scene.blocks : scene.blocks.slice(0, firstContentIndex);
  const openingStage = openingBlocks.filter((block): block is StageBlock => block.type === "stage");
  const injected: StoryBlock[] = [];

  if (
    scene.entryStage.backgroundAssetId
    && !openingStage.some((block) => block.action === "set-background")
  ) {
    injected.push({
      id: `__preview_${scene.id}_background`,
      type: "stage",
      action: "set-background",
      assetId: scene.entryStage.backgroundAssetId,
      transition: { name: "enter", durationMs: 450 },
      source: "native",
    });
  }

  if (
    scene.entryStage.bgmAssetId
    && !openingStage.some((block) => block.action === "play-bgm")
  ) {
    injected.push({
      id: `__preview_${scene.id}_bgm`,
      type: "stage",
      action: "play-bgm",
      assetId: scene.entryStage.bgmAssetId,
      durationMs: 450,
      source: "native",
    });
  }

  for (const [index, figure] of (scene.entryStage.figures || []).entries()) {
    const hasOpeningFigure = openingStage.some((block) => (
      (block.action === "enter-character" || block.action === "set-expression")
      && block.characterId === figure.characterId
    ));
    if (hasOpeningFigure) continue;
    injected.push({
      id: `__preview_${scene.id}_figure_${index}`,
      type: "stage",
      action: "enter-character",
      characterId: figure.characterId,
      expressionId: figure.expressionId,
      position: figure.position,
      transform: figure.transform,
      transition: { name: "enter", durationMs: 350 },
      source: "native",
    });
  }

  return injected;
}

export function projectForWebGalPreview(project: StoryProject, sceneId: string, startBlockId?: string): StoryProject {
  const injected = previewEntryBlocks(project, sceneId, startBlockId);
  const scene = project.scenes.find((item) => item.id === sceneId);
  const validStartBlock = startBlockId && scene?.blocks.some((block) => block.id === startBlockId)
    ? startBlockId
    : undefined;
  const previewJump: StoryBlock[] = validStartBlock ? [{
    id: `__preview_${sceneId}_jump_${validStartBlock}`,
    type: "jump",
    targetBlockId: validStartBlock,
    source: "native",
  }] : [];
  return {
    ...project,
    settings: {
      ...project.settings,
      startSceneId: sceneId,
    },
    scenes: project.scenes.map((scene) => (
      scene.id === sceneId && (injected.length || previewJump.length)
        ? { ...scene, blocks: [...injected, ...previewJump, ...scene.blocks] }
        : scene
    )),
  };
}

export async function prepareWebGalPreview(
  project: StoryProject,
  sceneId: string,
  options: { startBlockId?: string } = {},
): Promise<PreparedWebGalPreview> {
  if (!("serviceWorker" in navigator) || !("caches" in window) || !window.isSecureContext) {
    if (project.id === "project_maid_motion_mvp") {
      return {
        url: `/webgal-preview/index.html?v=${encodeURIComponent(project.updatedAt)}`,
        warnings: [],
      };
    }
    throw new Error("当前环境不支持 WebGAL 实机预览；正式 HTTPS 版本可用");
  }

  const registration = await navigator.serviceWorker.register(
    "/webgal-runtime-sw.js",
    { scope: PREVIEW_SCOPE },
  );
  await waitForActiveWorker(registration);

  const sessionId = crypto.randomUUID();
  const base = new URL(`${PREVIEW_SESSION_PREFIX}${sessionId}/`, window.location.origin);
  const targetProject = projectForWebGalPreview(project, sceneId, options.startBlockId);
  const compiled = compileProject(targetProject, { previewMode: true });
  const cache = await caches.open(PREVIEW_CACHE);
  await removeOldSessions(cache, base.href);

  await Promise.all(compiled.files.map((file) => (
    putText(cache, new URL(file.path, base), file.content, file.contentType)
  )));

  const warnings: string[] = [];
  for (const asset of project.assets.filter((item) => !item.missing)) {
    try {
      const response = await loadAssetResponse(asset);
      if (!response) {
        warnings.push(`素材无法进入实机预览：${asset.name}`);
        continue;
      }
      await cache.put(new URL(webgalAssetTargetPath(asset), base).href, response);
    } catch {
      warnings.push(`素材无法进入实机预览：${asset.name}`);
    }
  }
  await stageFaceMotionFiles(cache, base, project, warnings);

  return {
    url: new URL("index.html", base).href,
    warnings,
  };
}
