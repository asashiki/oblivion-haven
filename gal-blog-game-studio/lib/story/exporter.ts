import { strToU8, zipSync } from "fflate";
import { sha256 as sha256Bytes } from "@noble/hashes/sha2.js";

import { resolveRegisteredAssetUrl } from "../assetUrl";
import { readLocalAssetFile } from "../localAssetStore";
import { compileLaunchBootstrap, compileProject } from "./compiler";
import { validateProject } from "./schema";
import type { StoryAsset, StoryProject } from "./types";
import { slugify } from "./utils";

export const BLOG_PACKAGE_SCHEMA = "gal-blog-game-package/v1";
export const BLOG_BRIDGE_PROTOCOL = "gal-blog-bridge/v1";
export const BLOG_BRIDGE_CHANNEL = "gal-blog-game";
export const WEBGAL_RUNTIME_VERSION = "4.6.2";
export const WEBGAL_RUNTIME_MANIFEST_URL = "/vendor/webgal/runtime-manifest.json";

const MESSAGE_LIMIT = 64 * 1024;
const SUPPORTED_ACTIONS = [
  "return-menu",
  "open-article",
  "open-comment-form",
  "save-progress",
  "get-runtime-data",
] as const;
const SUPPORTED_ACTION_SET = new Set<string>(SUPPORTED_ACTIONS);

type Bytes = Uint8Array;
type EntryMap = Record<string, Bytes>;

export type WebGalRuntimeManifest = {
  schema: "gal-blog-webgal-runtime/v1";
  package: "webgal-engine";
  version: "4.6.2";
  entry: string;
  stylesheet: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
};

export type BlogPackageManifestV1 = {
  schema: typeof BLOG_PACKAGE_SCHEMA;
  game: {
    id: string;
    slug: string;
    title: string;
    gameVersion: string;
    releaseId: string;
    locale: string;
  };
  engine: { name: "WebGAL"; version: "4.6.2"; bundled: true; entry: "index.html" };
  launchTargets: {
    start: { kind: "start"; id: "start"; sceneId: string };
    scenes: Array<{ kind: "scene"; id: string; title: string; replayable: true }>;
    savePoints: Array<{ kind: "save-point"; id: string; title: string; sceneId: string; resumeMode: "scene-entry" }>;
  };
  publicRouteMap: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
  stateContract: {
    saveMode: "checkpoint-v1";
    launchVariables: string[];
    persistVariables: string[];
    records: string[];
  };
  bridge: {
    protocol: typeof BLOG_BRIDGE_PROTOCOL;
    channel: typeof BLOG_BRIDGE_CHANNEL;
    allowedHostOrigins: string[];
    requiredActions: ["return-menu"];
    optionalActions: ["open-article", "save-progress", "open-comment-form", "get-runtime-data"];
  };
  theme: { tokens: "game/theme.tokens.json"; webgalTemplate: "game/template/" };
  integrity: "integrity.json";
};

export type RuntimeExportIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type RuntimeExportOptions = {
  allowedHostOrigins?: string[];
  customCss?: string;
  extensionJs?: string;
};

export type RuntimePackage = {
  blob: Blob;
  fileName: string;
  manifest: BlogPackageManifestV1;
  integrity: { schema: "gal-blog-integrity/v1"; algorithm: "SHA-256"; files: Array<{ path: string; sha256: string; bytes: number }> };
  entries: EntryMap;
};

function safeRelativePath(path: string): boolean {
  if (!path || path.length > 512) return false;
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || decoded.includes("?") || decoded.includes("#")) return false;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return false;
    return !decoded.split("/").some((part) => part === "." || part === "..");
  } catch {
    return false;
  }
}

function safeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

function normalizeOrigins(origins: string[]): string[] {
  return [...new Set(origins.map((origin) => origin.trim()).filter(Boolean))].sort();
}

function validOrigin(origin: string): boolean {
  if (origin === "*") return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === origin;
  } catch {
    return false;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, stableValue(item)]));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

async function sha256(bytes: Bytes): Promise<string> {
  return [...sha256Bytes(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function addEntry(entries: EntryMap, path: string, bytes: Bytes): void {
  if (!safeRelativePath(path)) throw new Error(`导出路径不安全：${path}`);
  if (entries[path]) throw new Error(`导出路径发生冲突：${path}`);
  entries[path] = bytes;
}

function zipBlob(entries: EntryMap): Blob {
  const zipped = zipSync(Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))), { level: 0 });
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: "application/zip" });
}

function exportAssetPath(asset: StoryAsset): string {
  const source = asset.path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!safeRelativePath(source)) throw new Error(`素材「${asset.name}」的路径不安全：${asset.path}`);
  if (asset.kind === "background") return `game/background/${source}`;
  if (asset.kind === "figure" || asset.kind === "expression") return `game/figure/${source}`;
  if (asset.kind === "bgm") return `game/bgm/${source}`;
  if (asset.kind === "voice" || asset.kind === "sfx") return `game/vocal/${source}`;
  if (asset.kind === "video") return `game/video/${source}`;
  if (asset.kind === "animation") return `game/animation/${source}`;
  if (asset.kind === "ui") return `game/template/${source}`;
  return `game/assets/${source}`;
}

function referencedAssets(project: StoryProject): StoryAsset[] {
  const scripts = compileProject(project).files
    .filter((file) => file.path.startsWith("game/scene/"))
    .map((file) => file.content)
    .join("\n");
  return project.assets.filter((asset) => scripts.includes(asset.path));
}

function publicScenes(project: StoryProject) {
  const replayableIds = new Set(project.routeMap.nodes
    .filter((node) => node.sceneId && node.replayable === true && !node.hiddenFromPlayer)
    .map((node) => node.sceneId!));
  return project.scenes
    .filter((scene) => replayableIds.has(scene.id))
    .map((scene) => ({ kind: "scene" as const, id: scene.id, title: scene.name, replayable: true as const }));
}

function publicRouteMap(project: StoryProject) {
  const nodes = project.routeMap.nodes
    .filter((node) => !node.hiddenFromPlayer && node.replayable === true && node.sceneId)
    .map((node) => ({ id: node.id, title: node.title, kind: node.kind, sceneId: node.sceneId, replayable: true }));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = project.routeMap.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && !edge.hiddenFromPlayer)
    .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, ...(edge.label ? { label: edge.label } : {}) }));
  return { nodes, edges };
}

function stateContract(project: StoryProject) {
  return {
    saveMode: "checkpoint-v1" as const,
    launchVariables: project.variables.filter((variable) => variable.scope === "global" && !variable.readonly).map((variable) => variable.id).sort(),
    persistVariables: project.variables.filter((variable) => variable.scope === "save" && !variable.readonly).map((variable) => variable.id).sort(),
    records: (project.records || []).map((record) => record.id).sort(),
  };
}

function manifestSeed(project: StoryProject, origins: string[]) {
  return {
    game: { id: project.id, slug: project.slug, title: project.title, gameVersion: project.version, locale: project.locale },
    launchTargets: {
      start: { kind: "start", id: "start", sceneId: project.settings.startSceneId },
      scenes: publicScenes(project),
      savePoints: project.savePoints.map((point) => ({
        kind: "save-point",
        id: point.id,
        title: point.name,
        sceneId: point.sceneId,
        resumeMode: "scene-entry",
      })),
    },
    publicRouteMap: publicRouteMap(project),
    stateContract: stateContract(project),
    origins,
  };
}

function projectActions(project: StoryProject): string[] {
  return project.scenes.flatMap((scene) => scene.blocks.flatMap((block) => {
    if (block.type === "blog-action") return [block.action === "custom" ? block.customAction || "custom" : block.action];
    if (block.type === "input" && block.targets.includes("blog") && block.blogActionId) return [block.blogActionId];
    return [];
  }));
}

export function inspectRuntimeExport(project: StoryProject, options: RuntimeExportOptions = {}): RuntimeExportIssue[] {
  const issues: RuntimeExportIssue[] = validateProject(project)
    .filter((item) => item.severity === "error")
    .map((item) => ({ severity: "error", code: item.code, message: item.message }));
  const origins = normalizeOrigins(options.allowedHostOrigins ?? project.settings.blogBridge.allowedOrigins);
  if (!origins.length) issues.push({ severity: "error", code: "BLOG_ORIGIN_EMPTY", message: "正式导出至少需要一个精确的 Blog origin。" });
  origins.filter((origin) => !validOrigin(origin)).forEach((origin) => issues.push({ severity: "error", code: "BLOG_ORIGIN_INVALID", message: `Blog origin 无效：${origin}` }));
  if (!safeIdentifier(project.id)) issues.push({ severity: "error", code: "GAME_ID_INVALID", message: `项目 ID 不符合安全标识符规则：${project.id}` });
  if (!safeIdentifier(project.slug)) issues.push({ severity: "error", code: "GAME_SLUG_INVALID", message: `游戏 slug 不符合安全标识符规则：${project.slug}` });
  if (!safeIdentifier(project.version)) issues.push({ severity: "error", code: "GAME_VERSION_INVALID", message: `游戏版本不符合安全标识符规则：${project.version}` });
  if (project.settings.webgalVersion !== WEBGAL_RUNTIME_VERSION) issues.push({ severity: "error", code: "WEBGAL_VERSION_INVALID", message: "正式导出固定使用 WebGAL 4.6.2。" });
  const targetIds = ["start", ...publicScenes(project).map((item) => item.id), ...project.savePoints.map((point) => point.id)];
  targetIds.filter((id) => !safeIdentifier(id)).forEach((id) => issues.push({ severity: "error", code: "TARGET_ID_INVALID", message: `启动目标 ID 无效：${id}` }));
  if (new Set(targetIds).size !== targetIds.length) issues.push({ severity: "error", code: "TARGET_ID_DUPLICATED", message: "start、公开场景和检查点的启动目标 ID 不能重复。" });
  const stateIds = [...stateContract(project).launchVariables, ...stateContract(project).persistVariables, ...stateContract(project).records];
  stateIds.filter((id) => !safeIdentifier(id)).forEach((id) => issues.push({ severity: "error", code: "STATE_ID_INVALID", message: `公开状态 ID 无效：${id}` }));
  projectActions(project).filter((action) => !SUPPORTED_ACTION_SET.has(action)).forEach((action) => issues.push({ severity: "error", code: "BLOG_ACTION_UNSUPPORTED", message: `Blog v1 不支持动作「${action}」，请改为明确支持的动作后再导出。` }));
  for (const item of [...publicRouteMap(project).nodes, ...publicRouteMap(project).edges]) {
    if (!safeIdentifier(String(item.id || ""))) issues.push({ severity: "error", code: "PUBLIC_ROUTE_ID_INVALID", message: `公开路线 ID 无效：${String(item.id || "")}` });
  }
  const paths = new Map<string, string>();
  for (const asset of referencedAssets(project)) {
    try {
      const path = exportAssetPath(asset);
      const previous = paths.get(path);
      if (previous) issues.push({ severity: "error", code: "ASSET_PATH_COLLISION", message: `素材「${previous}」与「${asset.name}」会写入同一路径：${path}` });
      else paths.set(path, asset.name);
    } catch (error) {
      issues.push({ severity: "error", code: "ASSET_PATH_INVALID", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!project.assets.some((asset) => asset.kind === "bgm")) issues.push({ severity: "warning", code: "BGM_EMPTY", message: "项目没有 BGM；这不会阻止导出。" });
  if (!project.savePoints.length) issues.push({ severity: "warning", code: "SAVE_POINT_EMPTY", message: "项目没有检查点；Blog LOAD 暂时不会出现此游戏的存档入口。" });
  return issues;
}

function makeManifest(project: StoryProject, origins: string[], releaseId: string): BlogPackageManifestV1 {
  const seed = manifestSeed(project, origins);
  return {
    schema: BLOG_PACKAGE_SCHEMA,
    game: { ...seed.game, releaseId },
    engine: { name: "WebGAL", version: WEBGAL_RUNTIME_VERSION, bundled: true, entry: "index.html" },
    launchTargets: seed.launchTargets as BlogPackageManifestV1["launchTargets"],
    publicRouteMap: seed.publicRouteMap,
    stateContract: seed.stateContract,
    bridge: {
      protocol: BLOG_BRIDGE_PROTOCOL,
      channel: BLOG_BRIDGE_CHANNEL,
      allowedHostOrigins: origins,
      requiredActions: ["return-menu"],
      optionalActions: ["open-article", "save-progress", "open-comment-form", "get-runtime-data"],
    },
    theme: { tokens: "game/theme.tokens.json", webgalTemplate: "game/template/" },
    integrity: "integrity.json",
  };
}

export function assertBlogManifestV1(manifest: unknown): asserts manifest is BlogPackageManifestV1 {
  const value = manifest as BlogPackageManifestV1;
  if (!value || value.schema !== BLOG_PACKAGE_SCHEMA) throw new Error("游戏清单 schema 不是 v1");
  if (!value.game || !safeIdentifier(value.game.id) || !safeIdentifier(value.game.slug) || !safeIdentifier(value.game.releaseId)) throw new Error("游戏清单 game 字段无效");
  if (value.engine?.name !== "WebGAL" || value.engine.version !== WEBGAL_RUNTIME_VERSION || value.engine.bundled !== true || !safeRelativePath(value.engine.entry)) throw new Error("正式游戏包必须内置 WebGAL 4.6.2");
  if (!value.launchTargets?.start || value.launchTargets.start.id !== "start" || value.launchTargets.start.kind !== "start") throw new Error("游戏清单 start 目标无效");
  const targets = [value.launchTargets.start, ...(value.launchTargets.scenes || []), ...(value.launchTargets.savePoints || [])];
  if (targets.some((target) => !safeIdentifier(target.id)) || new Set(targets.map((target) => target.id)).size !== targets.length) throw new Error("游戏清单启动目标无效或重复");
  if (!value.publicRouteMap || !Array.isArray(value.publicRouteMap.nodes) || !Array.isArray(value.publicRouteMap.edges)) throw new Error("游戏清单公开路线无效");
  if (value.stateContract?.saveMode !== "checkpoint-v1" || !Array.isArray(value.stateContract.launchVariables) || !Array.isArray(value.stateContract.persistVariables) || !Array.isArray(value.stateContract.records)) throw new Error("游戏清单状态契约无效");
  if (value.bridge?.protocol !== BLOG_BRIDGE_PROTOCOL || value.bridge.channel !== BLOG_BRIDGE_CHANNEL) throw new Error("游戏包 Bridge 协议不兼容");
  if (!value.bridge.allowedHostOrigins.length || value.bridge.allowedHostOrigins.some((origin) => !validOrigin(origin))) throw new Error("正式游戏包必须声明精确宿主 origin");
  if ([...value.bridge.requiredActions, ...value.bridge.optionalActions].some((action) => !SUPPORTED_ACTION_SET.has(action))) throw new Error("游戏包声明了 Blog v1 未知动作");
  if (!safeRelativePath(value.integrity)) throw new Error("integrity 不是安全相对路径");
}

function actionManifest(project: StoryProject) {
  const actions: Record<string, { kind: string; action: string; input: Record<string, unknown>; resultVariable?: string }> = Object.fromEntries(project.scenes.flatMap((scene) => scene.blocks.flatMap((block) => {
    if (block.type !== "blog-action") return [];
    const action = block.action === "custom" ? block.customAction || "custom" : block.action;
    return [[`action_${slugify(scene.id)}_${slugify(block.id)}`, {
      kind: "action",
      action,
      input: { ...block.payload, __story: { projectId: project.id, sceneId: scene.id, blockId: block.id } },
      resultVariable: block.resultVariableId ? project.variables.find((item) => item.id === block.resultVariableId)?.name : undefined,
    }]];
  })));
  for (const scene of project.scenes) {
    for (const block of scene.blocks) {
      if (block.type !== "save-point") continue;
      const point = project.savePoints.find((item) => item.id === block.savePointId);
      if (!point) continue;
      actions[`save_${slugify(scene.id)}_${slugify(block.id)}`] = {
        kind: "save-point",
        action: "save-progress",
        input: { target: { kind: "save-point", id: point.id }, title: point.name, scene: scene.name },
        resultVariable: undefined,
      };
    }
  }
  return actions;
}

function bridgeRuntime(project: StoryProject, manifest: BlogPackageManifestV1, launchFiles: Record<string, string>): string {
  const variables = Object.fromEntries(project.variables.map((variable) => [variable.id, { name: variable.name, defaultValue: variable.defaultValue }]));
  const records = Object.fromEntries((project.records || []).map((record) => [record.id, `__story_record_${slugify(record.id)}`]));
  const config = {
    protocol: BLOG_BRIDGE_PROTOCOL,
    channel: BLOG_BRIDGE_CHANNEL,
    gameId: project.id,
    releaseId: manifest.game.releaseId,
    origins: manifest.bridge.allowedHostOrigins,
    timeoutMs: Math.max(1000, project.settings.blogBridge.timeoutMs || 20000),
    messageLimit: MESSAGE_LIMIT,
    launchFiles,
    variables,
    records,
    stateContract: manifest.stateContract,
    actions: actionManifest(project),
  };
  return `(() => {
  "use strict";
  const config = ${JSON.stringify(config)};
  let sequence = 0;
  let sessionId = "";
  let hostOrigin = "";
  let launch = null;
  let core = null;
  let unsubscribe = null;
  let disposed = false;
  let activeToken = "";
  const pending = new Map();
  const lifecycle = (name, detail = {}) => window.dispatchEvent(new CustomEvent(name, { detail: { gameId: config.gameId, releaseId: config.releaseId, ...detail } }));
  const nextId = (prefix) => prefix + "-" + Date.now() + "-" + (++sequence);
  const sizeOf = (value) => { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Infinity; } };
  const scalar = (value) => typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
  const envelope = (type, extra = {}) => ({ protocol: config.protocol, channel: config.channel, source: "galgame", gameId: config.gameId, releaseId: config.releaseId, sessionId, type, ...extra });
  const validEnvelope = (value, source = "gal-blog") => Boolean(value) && typeof value === "object" && sizeOf(value) <= config.messageLimit
    && value.protocol === config.protocol && value.channel === config.channel && value.source === source
    && value.gameId === config.gameId && value.releaseId === config.releaseId && value.sessionId === sessionId;
  const emitHost = (message) => {
    if (!hostOrigin || !window.parent || window.parent === window) return false;
    window.parent.postMessage(message, hostOrigin);
    return true;
  };
  const targetKey = (target) => target && target.kind + ":" + target.id;
  const validLaunch = (payload) => {
    if (!payload || typeof payload !== "object" || !payload.target || !config.launchFiles[targetKey(payload.target)]) return null;
    const state = payload.state && typeof payload.state === "object" ? payload.state : { variables: {}, records: [] };
    const values = state.variables && typeof state.variables === "object" && !Array.isArray(state.variables) ? state.variables : {};
    const allowed = new Set([...config.stateContract.launchVariables, ...config.stateContract.persistVariables]);
    if (Object.entries(values).some(([key, value]) => !allowed.has(key) || !scalar(value))) return null;
    const facts = Array.isArray(state.records) ? state.records : [];
    if (facts.some((id) => !config.stateContract.records.includes(id))) return null;
    return { target: payload.target, state: { variables: values, records: facts } };
  };
  const prepare = async () => {
    sessionId = new URL(location.href).searchParams.get("session") || (crypto.randomUUID ? crypto.randomUUID() : nextId("session"));
    const standalone = window.parent === window;
    let referrerOrigin = "";
    try { referrerOrigin = document.referrer ? new URL(document.referrer).origin : ""; } catch {}
    lifecycle("galblog:bridge-ready", { sessionId, mode: standalone ? "standalone" : "embedded" });
    if (standalone || !config.origins.includes(referrerOrigin)) {
      launch = { target: { kind: "start", id: "start" }, state: { variables: {}, records: [] }, mode: standalone ? "standalone" : "rejected-host" };
      lifecycle("galblog:launch-applied", { sessionId, target: launch.target, mode: launch.mode });
      return { scenePath: config.launchFiles[targetKey(launch.target)], mode: launch.mode };
    }
    hostOrigin = referrerOrigin;
    const helloId = nextId("hello");
    emitHost(envelope("hello", { id: helloId, payload: { engine: "WebGAL", engineVersion: "4.6.2" } }));
    launch = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Blog launch timeout")), config.timeoutMs);
      const accept = (event) => {
        if (event.source !== window.parent || event.origin !== hostOrigin || !validEnvelope(event.data) || event.data.type !== "launch" || !event.data.id) return;
        const value = validLaunch(event.data.payload);
        if (!value) return;
        clearTimeout(timer);
        window.removeEventListener("message", accept);
        resolve({ ...value, mode: "hosted" });
      };
      window.addEventListener("message", accept);
    });
    lifecycle("galblog:launch-applied", { sessionId, target: launch.target, mode: launch.mode });
    return { scenePath: config.launchFiles[targetKey(launch.target)], mode: launch.mode };
  };
  const setVar = (key, value) => core.stageManager.setStageVar({ key, value });
  const commit = () => core.stageManager.commit();
  const applyLaunchState = () => {
    for (const item of Object.values(config.variables)) setVar(item.name, item.defaultValue);
    for (const name of Object.values(config.records)) setVar(name, false);
    for (const [id, value] of Object.entries(launch.state.variables)) setVar(config.variables[id].name, value);
    for (const id of launch.state.records) setVar(config.records[id], true);
    setVar("__galblog_resume", launch.mode === "hosted");
    commit();
  };
  const runtimeState = () => core.stageManager.getViewStageState?.() || core.stageManager.getCalculationStageState?.();
  const postRequest = (action, input) => {
    if (!hostOrigin) return Promise.resolve({ status: "unsupported", action });
    const id = nextId("request");
    const message = envelope("request", { id, payload: { action, input } });
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ status: "failure", code: "TIMEOUT" }); }, config.timeoutMs);
      pending.set(id, { resolve, timer });
      emitHost(message);
    });
  };
  const saveInput = (input, state) => {
    const values = {};
    for (const id of config.stateContract.persistVariables) values[id] = state.GameVar[config.variables[id].name];
    const facts = config.stateContract.records.filter((id) => state.GameVar[config.records[id]] === true);
    return { ...input, variables: values, records: facts };
  };
  const unlock = () => {
    document.getElementById("galblog-runtime-lock")?.remove();
    setTimeout(() => document.getElementById("FullScreenClick")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })), 0);
  };
  const handleToken = async (token, action, state) => {
    let lock = document.getElementById("galblog-runtime-lock");
    if (!lock) {
      lock = document.createElement("div"); lock.id = "galblog-runtime-lock"; lock.textContent = "GAL-BLOG · WAITING";
      Object.assign(lock.style, { position: "fixed", inset: 0, zIndex: 2147483646, display: "grid", placeItems: "end center", paddingBottom: "8vh", background: "linear-gradient(transparent 60%,rgba(4,7,16,.68))", color: "white", font: "500 14px system-ui" });
      document.body.appendChild(lock);
    }
    const input = action.kind === "save-point" ? saveInput(action.input, state) : action.input;
    let response;
    try { response = await postRequest(action.action, input); }
    catch (error) { response = { status: "failure", message: String(error) }; }
    let status = response && ["success", "failure", "cancel", "unsupported"].includes(response.status) ? response.status : "failure";
    setVar("__galblog_status", status);
    setVar("__galblog_request", "");
    if (action.resultVariable) setVar(action.resultVariable, scalar(response.value) ? response.value : status);
    commit();
    lifecycle("galblog:action-result", { token, action: action.action, status, response });
    unlock();
  };
  const onStage = (state) => {
    const token = String(state.GameVar.__galblog_request || "");
    if (!token) { activeToken = ""; return; }
    if (token === activeToken || !config.actions[token]) return;
    activeToken = token;
    void handleToken(token, config.actions[token], state);
  };
  const receive = (event) => {
    if (disposed || !hostOrigin || event.source !== window.parent || event.origin !== hostOrigin || !validEnvelope(event.data)) return;
    const message = event.data;
    if (message.type !== "result" || !message.replyTo || !pending.has(message.replyTo)) return;
    const item = pending.get(message.replyTo);
    clearTimeout(item.timer); pending.delete(message.replyTo); item.resolve(message.payload || { status: "failure" });
  };
  const attachWebGAL = async (runtimeCore) => {
    if (!runtimeCore?.stageManager?.subscribe) throw new Error("WebGAL 4.6.2 adapter could not attach");
    core = runtimeCore;
    applyLaunchState();
    unsubscribe = core.stageManager.subscribe(onStage);
    const state = runtimeState(); if (state) onStage(state);
    lifecycle("galblog:webgal-ready", { sessionId, target: launch.target });
    if (hostOrigin) emitHost(envelope("ready", { payload: { target: launch.target, engine: "WebGAL", engineVersion: "4.6.2" } }));
  };
  const dispose = () => {
    if (disposed) return; disposed = true; unsubscribe?.(); window.removeEventListener("message", receive);
    for (const item of pending.values()) { clearTimeout(item.timer); item.resolve({ status: "failure", code: "DISPOSED" }); }
    pending.clear(); unlock();
  };
  window.addEventListener("message", receive);
  window.addEventListener("pagehide", dispose, { once: true });
  window.GalBlogBridgeV1 = { prepare, attachWebGAL, request: postRequest, dispose, config };
})();\n`;
}

function runtimeIndex(project: StoryProject, runtime: WebGalRuntimeManifest, inlineBridge: string): string {
  const title = project.title.replace(/[<>&"]/g, "");
  const safeBridge = inlineBridge.replaceAll("</script", "<\\/script");
  return `<!doctype html>
<html lang="${project.locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no" />
  <title>${title}</title>
  <link rel="stylesheet" href="./vendor/webgal/${runtime.stylesheet}" />
  <link rel="stylesheet" href="./game/userStyleSheet.css" />
  <style>html,body{width:100%;height:100%;margin:0;background:#05060b;color:#fff;overflow:hidden}#ebg{position:fixed;inset:-8%;background:#05060b;filter:blur(36px)}#ebgOverlay{width:100%;height:100%}#root,.html-body__title-enter{position:absolute;width:2560px;height:1440px;transform-origin:top left;overflow:hidden}.html-body__title-enter{z-index:100;display:grid;place-items:center;background:linear-gradient(135deg,#111525,#05060b);transition:opacity .65s}.html-body__title-enter.is-leaving{opacity:0;pointer-events:none}#galblog-enter{border:1px solid #ffffff42;border-radius:999px;padding:18px 34px;background:#ffffff0c;color:#f5f7ff;font:500 20px serif;letter-spacing:.28em;cursor:pointer}#galblog-engine-status{position:absolute;left:50%;bottom:84px;z-index:101;transform:translateX(-50%);font:500 13px system-ui;letter-spacing:.18em;color:#a9b5d5}</style>
  <script>window.live2dPromise=window.live2dPromise||Promise.resolve([false,false]);window.__GAL_BLOG_ENGINE_RENDERED__=new Promise(resolve=>{window.renderPromiseResolve=()=>{resolve();delete window.renderPromiseResolve;};});</script>
  <script>${safeBridge}</script>
</head>
<body>
  <div id="ebg" aria-hidden="true"><div id="ebgOverlay"></div></div>
  <div class="html-body__title-enter"><button id="galblog-enter" type="button">PRESS SCREEN TO START</button></div>
  <div id="html-body__panic-overlay"></div><div id="root"></div>
  <div id="galblog-engine-status">WEBGAL 4.6.2 · LOADING</div>
  <script>
    (()=>{const root=document.getElementById("root"),landing=document.querySelector(".html-body__title-enter");const resize=()=>{const scale=Math.min(innerWidth/2560,innerHeight/1440),left=(innerWidth-2560*scale)/2,top=(innerHeight-1440*scale)/2,transform="translate("+left+"px,"+top+"px) scale("+scale+")";root.style.transform=transform;landing.style.transform=transform;};resize();addEventListener("resize",resize);document.getElementById("galblog-enter").addEventListener("click",()=>{landing.classList.add("is-leaving");window.__GAL_BLOG_ENGINE_RENDERED__.then(()=>document.querySelector(".title__enter-game-target")?.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})));setTimeout(()=>landing.remove(),700);},{once:true});})();
  </script>
  <script type="module">
    const status=document.getElementById("galblog-engine-status");
    try {
      const launch=await window.GalBlogBridgeV1.prepare();
      window.__GAL_BLOG_LAUNCH__={projectId:${JSON.stringify(project.id)},startScene:launch.scenePath,gameDir:"./game/"};
      window.__TUANCHAT_WEBGAL__={autoStart:true,startScene:launch.scenePath,gameDir:"./game/"};
      const engine=await import("./vendor/webgal/${runtime.entry}");
      await window.GalBlogBridgeV1.attachWebGAL(engine.W);
      await import("./game/extensions/entry.js");
      status?.remove();
    } catch(error) { if(status) status.textContent="WEBGAL LOAD ERROR · "+(error?.message||String(error)); console.error("[Gal Blog Runtime]",error); }
  </script>
</body></html>\n`;
}

const extensionReadme = `# 自定义扩展\n\n\`entry.js\` 是可信作者代码入口。它不会远程 import、不会 eval，也不包含密钥。\n\n稳定生命周期事件：\n\n- \`galblog:bridge-ready\`\n- \`galblog:launch-applied\`\n- \`galblog:webgal-ready\`\n- \`galblog:action-result\`\n\n请勿依赖 WebGAL 私有 Core；版本相关访问集中在 \`gal-blog-bridge.js\` 的 4.6.2 adapter。\n`;

function runtimeReadme(project: StoryProject, manifest: BlogPackageManifestV1): string {
  return `# ${project.title}\n\nGal Blog Game Studio 正式运行包。\n\n## 本地运行\n\n解压后在本目录启动静态服务器，例如 \`python -m http.server 8000\`，再打开 \`http://localhost:8000/\`。不承诺通过 \`file://\` 直接运行。\n\n## 部署到《孤独之海》\n\n把本目录完整放到 \`public/games/${project.slug}/${manifest.game.releaseId}/\`，并在 Blog 的 release registry 登记 slug、releaseId 与目录。允许宿主：${manifest.bridge.allowedHostOrigins.join("、")}。\n\n## 可编辑内容\n\n- \`game/scene/*.txt\`：可读 WebGAL 剧本\n- \`game/userStyleSheet.css\`：游戏样式\n- \`game/template/\`：WebGAL template\n- \`game/extensions/entry.js\`：可信作者扩展\n- 素材目录：普通静态文件\n\n手工修改后，现有 releaseId 与 integrity 会失效。请回到 Studio 重新导出为新 release，不要覆盖已发布版本。公开运行包不含 Story IR；工程备份请在 Studio 单独导出。\n`;
}

const thirdPartyNotices = `# Third-party notices\n\n## WebGAL 4.6.2\n\n- Package: webgal-engine@4.6.2\n- Source: https://github.com/OpenWebGAL/WebGAL/tree/4.6.2\n- License: Mozilla Public License 2.0\n- Bundled files: vendor/webgal/\n\n## WebGAL animation presets\n\nFiles under game/animation/ originate from the official WebGAL Terre template and are distributed under MPL-2.0.\n`;

export async function buildRuntimePackage(
  project: StoryProject,
  runtime: WebGalRuntimeManifest,
  runtimeFiles: Record<string, Bytes>,
  assetFiles: Record<string, Bytes>,
  options: RuntimeExportOptions = {},
): Promise<RuntimePackage> {
  const issues = inspectRuntimeExport(project, options);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join("\n"));
  if (runtime.version !== WEBGAL_RUNTIME_VERSION || runtime.schema !== "gal-blog-webgal-runtime/v1") throw new Error("内置 WebGAL runtime 清单无效或版本不为 4.6.2");
  const origins = normalizeOrigins(options.allowedHostOrigins ?? project.settings.blogBridge.allowedOrigins);
  const entries: EntryMap = {};
  for (const file of runtime.files) {
    const bytes = runtimeFiles[file.path];
    if (!bytes) throw new Error(`内置 WebGAL runtime 缺少文件：${file.path}`);
    if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256) throw new Error(`内置 WebGAL runtime 文件校验失败：${file.path}`);
    addEntry(entries, `vendor/webgal/${file.path}`, bytes);
  }
  addEntry(entries, "vendor/webgal/runtime-manifest.json", strToU8(stableJson(runtime)));
  const compiled = compileProject(project);
  for (const file of compiled.files) {
    if (["index.html", "gal-blog-bridge.js", "gal-blog.embed.json"].includes(file.path)) continue;
    addEntry(entries, file.path, strToU8(file.path === "game/userStyleSheet.css" ? options.customCss || file.content : file.content));
  }
  const launchFiles: Record<string, string> = { "start:start": "game/scene/start.txt" };
  for (const scene of publicScenes(project)) {
    const path = `game/scene/__launch_scene_${slugify(scene.id)}.txt`;
    launchFiles[`scene:${scene.id}`] = path;
    addEntry(entries, path, strToU8(compileLaunchBootstrap(project, scene.id)));
  }
  for (const point of project.savePoints) {
    const path = `game/scene/__launch_save_${slugify(point.id)}.txt`;
    launchFiles[`save-point:${point.id}`] = path;
    addEntry(entries, path, strToU8(compileLaunchBootstrap(project, point.sceneId)));
  }
  addEntry(entries, "game/template/template.json", strToU8(stableJson({ fonts: [] })));
  addEntry(entries, "game/template/UI/Title/title.scss", strToU8("/* Author title-screen overrides */\n"));
  addEntry(entries, "game/template/Stage/TextBox/textbox.scss", strToU8("/* Author dialogue-box overrides */\n"));
  addEntry(entries, "game/template/Stage/Choose/choose.scss", strToU8("/* Author choice-button overrides */\n"));
  addEntry(entries, "game/theme.tokens.json", strToU8(stableJson({ schema: "gal-blog-theme/v1", colors: {}, typography: {} })));
  addEntry(entries, "game/extensions/entry.js", strToU8(options.extensionJs || "// Trusted author extension entry. Keep this file local and auditable.\n"));
  addEntry(entries, "game/extensions/README.md", strToU8(extensionReadme));
  for (const asset of referencedAssets(project)) {
    const bytes = assetFiles[asset.id];
    if (!bytes) throw new Error(`已引用素材无法写入导出包：${asset.name}（${asset.id}）`);
    addEntry(entries, exportAssetPath(asset), bytes);
  }
  const seed = manifestSeed(project, origins);
  const fingerprints = [];
  for (const [path, bytes] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) fingerprints.push({ path, sha256: await sha256(bytes), bytes: bytes.byteLength });
  const blueprintManifest = makeManifest(project, origins, `${project.version}-00000000`);
  const blueprintBridge = bridgeRuntime(project, blueprintManifest, launchFiles);
  const blueprints = {
    "index.html": strToU8(runtimeIndex(project, runtime, blueprintBridge)),
    "gal-blog-bridge.js": strToU8(blueprintBridge),
    "gal-blog-runtime.js": strToU8(blueprintBridge),
    "boot.js": strToU8(blueprintBridge),
  };
  for (const [path, bytes] of Object.entries(blueprints)) fingerprints.push({ path, sha256: await sha256(bytes), bytes: bytes.byteLength });
  fingerprints.sort((a, b) => a.path.localeCompare(b.path));
  const contentHash = await sha256(strToU8(stableJson({ seed, files: fingerprints })));
  const releaseId = `${project.version}-${contentHash.slice(0, 8)}`;
  if (!safeIdentifier(releaseId)) throw new Error(`生成的 releaseId 不安全：${releaseId}`);
  const manifest = makeManifest(project, origins, releaseId);
  assertBlogManifestV1(manifest);
  const bridgeSource = bridgeRuntime(project, manifest, launchFiles);
  const bridge = strToU8(bridgeSource);
  addEntry(entries, "index.html", strToU8(runtimeIndex(project, runtime, bridgeSource)));
  addEntry(entries, "gal-blog-bridge.js", bridge);
  addEntry(entries, "gal-blog-runtime.js", bridge);
  addEntry(entries, "boot.js", bridge);
  addEntry(entries, "gal-blog.embed.json", strToU8(stableJson(manifest)));
  addEntry(entries, "README.md", strToU8(runtimeReadme(project, manifest)));
  addEntry(entries, "THIRD_PARTY_NOTICES.md", strToU8(thirdPartyNotices));
  const integrityFiles = [];
  for (const [path, bytes] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) integrityFiles.push({ path, sha256: await sha256(bytes), bytes: bytes.byteLength });
  const integrity = { schema: "gal-blog-integrity/v1" as const, algorithm: "SHA-256" as const, files: integrityFiles };
  addEntry(entries, "integrity.json", strToU8(stableJson(integrity)));
  return { blob: zipBlob(entries), fileName: `${project.slug}-${releaseId}-runtime.zip`, manifest, integrity, entries };
}

async function fetchRuntime(): Promise<{ manifest: WebGalRuntimeManifest; files: Record<string, Bytes> }> {
  const response = await fetch(WEBGAL_RUNTIME_MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取内置 WebGAL 4.6.2 runtime 清单");
  const manifest = await response.json() as WebGalRuntimeManifest;
  const pairs = await Promise.all(manifest.files.map(async (file) => {
    const item = await fetch(`/vendor/webgal/${file.path}`, { cache: "no-store" });
    if (!item.ok) throw new Error(`内置 WebGAL runtime 文件缺失：${file.path}`);
    return [file.path, new Uint8Array(await item.arrayBuffer())] as const;
  }));
  return { manifest, files: Object.fromEntries(pairs) };
}

async function readAssetFiles(project: StoryProject): Promise<Record<string, Bytes>> {
  const pairs = await Promise.all(referencedAssets(project).map(async (asset) => {
    let bytes: Bytes | undefined;
    if (asset.metadata?.localFile) {
      const stored = await readLocalAssetFile(asset.id);
      if (stored) bytes = new Uint8Array(await stored.file.arrayBuffer());
    } else {
      const url = resolveRegisteredAssetUrl(asset);
      if (url) {
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      }
    }
    if (!bytes) throw new Error(`已引用素材无法读取：${asset.name}（${asset.id}）`);
    return [asset.id, bytes] as const;
  }));
  return Object.fromEntries(pairs);
}

export async function createRuntimeZipWithAssets(project: StoryProject, options: RuntimeExportOptions = {}): Promise<RuntimePackage> {
  const [{ manifest, files }, assets] = await Promise.all([fetchRuntime(), readAssetFiles(project)]);
  return buildRuntimePackage(project, manifest, files, assets, options);
}

/** @deprecated Use createRuntimeZipWithAssets. Kept for the advanced workspace during migration. */
export async function createProjectZipWithAssets(project: StoryProject): Promise<Blob> {
  return (await createRuntimeZipWithAssets(project)).blob;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(api.?key|access.?token|secret|authorization|password)/i.test(key))
    .map(([key, item]) => [key, redactSecrets(item)]));
}

export function createStoryJson(project: StoryProject): Blob {
  return new Blob([stableJson(redactSecrets(project))], { type: "application/json" });
}

export function projectBackupFileName(project: StoryProject): string {
  return `${project.slug}-${project.version}-project.json`;
}
