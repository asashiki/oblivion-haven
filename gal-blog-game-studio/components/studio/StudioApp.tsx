"use client";

import {
  AlertTriangle,
  Archive,
  Bot,
  Boxes,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CloudCog,
  Download,
  FileArchive,
  FileJson,
  Files,
  FolderOpen,
  Gamepad2,
  GitBranch,
  History,
  ImageIcon,
  Import,
  Layers3,
  LibraryBig,
  Music2,
  PanelLeftClose,
  Play,
  Plus,
  Redo2,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Undo2,
  UploadCloud,
  UserRound,
  WandSparkles,
  Workflow,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { BlockEditor } from "./BlockEditor";
import { NarrativeMap } from "./NarrativeMap";
import { PreviewStage } from "./PreviewStage";
import { compileProject } from "@/lib/story/compiler";
import { exampleProject } from "@/lib/story/example";
import { createProjectZip, createStoryJson } from "@/lib/story/exporter";
import { importStoryText } from "@/lib/story/importers";
import { AI_TOOL_CATALOG, applyPatches } from "@/lib/story/patch";
import { parseStoryProject, validateProject } from "@/lib/story/schema";
import type {
  ImportFormat,
  ImportResult,
  StoryAsset,
  StoryCharacter,
  StoryDiagnostic,
  StoryPatch,
  StoryProject,
  StoryScene,
  StoryVariable,
} from "@/lib/story/types";
import { createId, deepClone, downloadBlob, nowIso } from "@/lib/story/utils";
import { routeDisplayPosition, routeStoredPosition } from "@/lib/story/routeLayout";
import { TerreClient } from "@/lib/integrations/terre";

type View = "story" | "map" | "assets" | "ai" | "preview" | "diagnostics" | "export" | "settings";
type Snapshot = { project: StoryProject; label: string; actor: "human" | "ai" | "import" | "system"; timestamp: string };

const STORAGE_KEY = "gal-blog-game-studio.project.v1";

const navItems: Array<{ id: View; label: string; icon: typeof Layers3 }> = [
  { id: "story", label: "剧本", icon: Layers3 },
  { id: "map", label: "叙事地图", icon: Workflow },
  { id: "assets", label: "角色与资源", icon: Boxes },
  { id: "ai", label: "AI 创作", icon: WandSparkles },
  { id: "preview", label: "运行预览", icon: Gamepad2 },
  { id: "diagnostics", label: "校验问题", icon: ShieldCheck },
  { id: "export", label: "编译与导出", icon: FileArchive },
];

function loadInitialProject(): StoryProject {
  if (typeof window === "undefined") return deepClone(exampleProject);
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? parseStoryProject(JSON.parse(saved)) : deepClone(exampleProject);
  } catch {
    return deepClone(exampleProject);
  }
}

function NavRail({
  view,
  setView,
  diagnostics,
  explorerOpen,
  onToggleExplorer,
}: {
  view: View;
  setView: (view: View) => void;
  diagnostics: StoryDiagnostic[];
  explorerOpen: boolean;
  onToggleExplorer: () => void;
}) {
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  return (
    <nav className="nav-rail" aria-label="工作区">
      <div className="brand-mark"><span>G</span><i /></div>
      <div className="nav-rail__items">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} title={item.label} aria-label={item.label}>
              <Icon size={19} />
              {item.id === "diagnostics" && errorCount > 0 && <b>{errorCount}</b>}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="nav-rail__bottom">
        <button className={view === "settings" ? "active" : ""} title="项目设置" aria-label="项目设置" onClick={() => setView("settings")}><Settings2 size={18} /><span>项目设置</span></button>
        <button title={explorerOpen ? "收起项目树" : "展开项目树"} aria-label={explorerOpen ? "收起项目树" : "展开项目树"} onClick={onToggleExplorer}><PanelLeftClose size={18} /><span>{explorerOpen ? "收起项目树" : "展开项目树"}</span></button>
      </div>
    </nav>
  );
}

type ExplorerProps = {
  project: StoryProject;
  selectedSceneId: string;
  onSelect: (id: string) => void;
  onAddScene: () => void;
  onOpenProject: () => void;
  onNavigate: (view: View) => void;
};

function ProjectExplorer({ project, selectedSceneId, onSelect, onAddScene, onOpenProject, onNavigate }: ExplorerProps) {
  const [query, setQuery] = useState("");
  return (
    <aside className="project-explorer">
      <div className="project-explorer__title">
        <div><span className="status-dot" /><strong>PROJECT</strong></div>
        <button onClick={onOpenProject} title="打开 Story JSON"><FolderOpen size={14} /></button>
      </div>
      <div className="explorer-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索场景或块…" /></div>
      <div className="explorer-section">
        <div className="explorer-section__header"><span><ChevronDown size={12} /> STORY</span><button onClick={onAddScene}><Plus size={13} /></button></div>
        {project.chapters.map((chapter) => (
          <div className="chapter-tree" key={chapter.id}>
            <div className="chapter-tree__title"><LibraryBig size={13} /><span>{chapter.name}</span><small>{chapter.sceneIds.length}</small></div>
            <div className="chapter-tree__scenes">
              {chapter.sceneIds
                .map((id) => project.scenes.find((scene) => scene.id === id))
                .filter((scene): scene is StoryScene => Boolean(scene))
                .filter((scene) => !query || `${scene.name} ${scene.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
                .map((scene) => (
                  <button key={scene.id} className={selectedSceneId === scene.id ? "active" : ""} onClick={() => onSelect(scene.id)}>
                    <span className={`scene-mode scene-mode--${scene.mode}`}>{scene.mode === "nvl" ? "N" : "A"}</span>
                    <span>{scene.name}</span>
                    <small>{scene.blocks.length}</small>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="explorer-section explorer-section--compact">
        <div className="explorer-section__header"><span><ChevronDown size={12} /> DATABASE</span></div>
        <button className="explorer-row" onClick={() => onNavigate("assets")}><UserRound size={13} /><span>角色</span><small>{project.characters.length}</small></button>
        <button className="explorer-row" onClick={() => onNavigate("assets")}><ImageIcon size={13} /><span>资源</span><small>{project.assets.length}</small></button>
        <button className="explorer-row" onClick={() => onNavigate("settings")}><Braces size={13} /><span>变量</span><small>{project.variables.length}</small></button>
        <button className="explorer-row" onClick={() => onNavigate("map")}><GitBranch size={13} /><span>路线节点</span><small>{project.routeMap.nodes.length}</small></button>
      </div>
      <footer className="explorer-footer">
        <div><span>Story IR</span><strong>{project.schemaVersion}</strong></div>
        <div><span>WebGAL</span><strong>{project.settings.webgalVersion}</strong></div>
      </footer>
    </aside>
  );
}

function AiWorkspace({
  project,
  sceneId,
  onChange,
}: {
  project: StoryProject;
  sceneId: string;
  onChange: (project: StoryProject, label: string, actor?: Snapshot["actor"]) => void;
}) {
  const [tab, setTab] = useState<"import" | "patch" | "tools">("import");
  const [format, setFormat] = useState<"auto" | ImportFormat>("auto");
  const [input, setInput] = useState(`[角色=爱丽丝][表情=有些犹豫][背景=茶室夜晚][BGM=quiet][入场=淡入][位置=右侧]
爱丽丝：欢迎回来，主人。

让爱丽丝从右侧缓慢淡入，表情有些犹豫，然后说“主人今天回来得有些晚呢”。`);
  const [result, setResult] = useState<ImportResult>();
  const [importApplyError, setImportApplyError] = useState("");
  const [patchText, setPatchText] = useState(`[
  {
    "op": "set",
    "path": "/scenes/0/blocks/3/text",
    "value": "欢迎回来，主人。茶已经泡好了。"
  }
]`);
  const [patchError, setPatchError] = useState("");

  const parse = () => {
    setResult(importStoryText(input, project, format === "auto" ? undefined : format));
    setImportApplyError("");
  };
  const applyImport = () => {
    if (!result?.blocks.length) return;
    const scene = project.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    try {
      const next = parseStoryProject({
        ...project,
        scenes: project.scenes.map((item) => item.id === scene.id ? { ...item, blocks: [...item.blocks, ...result.blocks] } : item),
      });
      onChange(next, `导入 ${result.blocks.length} 个剧情块`, "import");
      setImportApplyError("");
    } catch (error) {
      setImportApplyError(error instanceof Error ? `导入结果不符合 Story IR：${error.message}` : "导入结果不符合 Story IR");
    }
  };
  const applyPatchText = () => {
    try {
      const operations = JSON.parse(patchText) as StoryPatch[];
      const applied = applyPatches(project, operations);
      const validated = parseStoryProject(applied.project);
      onChange(validated, `应用 AI patch（${operations.length} 项）`, "ai");
      setPatchError("");
    } catch (error) {
      setPatchError(error instanceof Error ? error.message : "Patch 无法应用");
    }
  };

  return (
    <div className="ai-workspace">
      <header className="workspace-title">
        <div><span className="eyebrow">AI-FIRST AUTHORING</span><h2>AI 创作工作台</h2><p>整篇生成与局部修改使用同一份 Story IR；模型输出先校验，再进入项目。</p></div>
        <div className="segmented">
          <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}><Import size={13} /> 多格式导入</button>
          <button className={tab === "patch" ? "active" : ""} onClick={() => setTab("patch")}><Braces size={13} /> Patch</button>
          <button className={tab === "tools" ? "active" : ""} onClick={() => setTab("tools")}><Bot size={13} /> 工具 API</button>
        </div>
      </header>

      {tab === "import" && (
        <div className="ai-import-grid">
          <section className="ai-source">
            <div className="panel-bar">
              <span>AI 剧本 / 自然语言</span>
              <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
                <option value="auto">自动识别</option>
                <option value="json">Story JSON / Blocks</option>
                <option value="markdown">Markdown</option>
                <option value="renpy">Ren&apos;Py-like</option>
                <option value="webgal">WebGAL 原生</option>
                <option value="tagged">标签式剧本</option>
                <option value="natural">自然描述</option>
              </select>
            </div>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} />
            <footer><span>不要求模型严格输出复杂格式</span><button className="primary-button" onClick={parse}><Sparkles size={14} /> 解析为 Story IR</button></footer>
          </section>
          <section className="ai-result">
            <div className="panel-bar"><span>导入预览</span>{result && <b>{result.format} · {Math.round(result.confidence * 100)}%</b>}</div>
            {!result ? (
              <div className="large-empty"><WandSparkles size={30} /><strong>等待解析</strong><p>角色、表情与资源会优先匹配项目别名；失败时保留诊断，不会伪造文件。</p></div>
            ) : (
              <>
                <div className="import-stats">
                  <span><strong>{result.blocks.length}</strong> 剧情块</span>
                  <span><strong>{result.discovered.characterNames.length}</strong> 角色</span>
                  <span><strong>{result.diagnostics.length}</strong> 提示</span>
                </div>
                <div className="import-blocks">
                  {result.blocks.map((block, index) => (
                    <div key={block.id}><span>{String(index + 1).padStart(2, "0")}</span><i className={`import-type import-type--${block.type}`} /> <strong>{block.type}</strong><p>{block.type === "dialogue" || block.type === "narration" ? block.text : JSON.stringify(block).slice(0, 130)}</p></div>
                  ))}
                </div>
                <div className="import-diagnostics">
                  {result.diagnostics.map((item) => <p key={item.id} className={`diag-${item.severity}`}><AlertTriangle size={13} /> {item.message}</p>)}
                  {importApplyError && <p className="diag-error"><AlertTriangle size={13} /> {importApplyError}</p>}
                </div>
                <button className="primary-button import-apply" onClick={applyImport}><Plus size={14} /> 追加到当前场景</button>
              </>
            )}
          </section>
        </div>
      )}

      {tab === "patch" && (
        <div className="patch-workspace">
          <section>
            <div className="panel-bar"><span>受约束 StoryPatch[]</span><b>局部修改 · 可撤销</b></div>
            <textarea value={patchText} onChange={(event) => setPatchText(event.target.value)} spellCheck={false} />
            {patchError && <p className="patch-error"><AlertTriangle size={14} /> {patchError}</p>}
            <footer><span>支持 set / insert / remove / move / test</span><button className="primary-button" onClick={applyPatchText}><Bot size={14} /> 校验并应用</button></footer>
          </section>
          <aside>
            <span className="eyebrow">WHY PATCH</span>
            <h3>AI 不再整包覆盖项目</h3>
            <p>每次只修改指定路径；未变化的场景、块 ID、资源绑定与路线引用保持不动。应用前运行 test，应用后进入统一撤销历史。</p>
            <div className="patch-flow">
              <span>AI tool call</span><ChevronRight size={14} /><span>StoryPatch</span><ChevronRight size={14} /><span>Schema check</span><ChevronRight size={14} /><span>Compile</span>
            </div>
          </aside>
        </div>
      )}

      {tab === "tools" && (
        <div className="tool-catalog">
          {AI_TOOL_CATALOG.map((tool) => (
            <article key={tool.name}>
              <div><TerminalSquare size={16} /><code>{tool.name}</code></div>
              <p>{tool.description}</p>
              <span>{tool.args.join(" · ") || "无参数"}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetWorkspace({ project, onChange }: { project: StoryProject; onChange: (project: StoryProject, label: string) => void }) {
  const [filter, setFilter] = useState<"all" | StoryAsset["kind"]>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [editingCharacterId, setEditingCharacterId] = useState<string>();
  const [draft, setDraft] = useState({ name: "", kind: "background" as StoryAsset["kind"], path: "", aliases: "" });
  const [characterDraft, setCharacterDraft] = useState({
    name: "",
    displayName: "",
    aliases: "",
    color: "#7f8ed5",
    expressionName: "",
    expressionAssetId: "",
    expressionAliases: "",
  });
  const [aliasQuery, setAliasQuery] = useState("");

  const assets = project.assets.filter((asset) => filter === "all" || asset.kind === filter);
  const aliasMatch = aliasQuery ? project.assets.find((asset) => [asset.name, asset.path, ...asset.aliases].some((value) => value.toLowerCase().includes(aliasQuery.toLowerCase()))) : undefined;
  const addAsset = () => {
    if (!draft.name || !draft.path) return;
    const asset: StoryAsset = { id: createId("asset"), name: draft.name, kind: draft.kind, path: draft.path, aliases: draft.aliases.split(/[,，]/).map((item) => item.trim()).filter(Boolean) };
    onChange({ ...project, assets: [...project.assets, asset] }, "注册资源");
    setDraft({ name: "", kind: "background", path: "", aliases: "" });
    setShowAdd(false);
  };
  const openCharacter = (character?: StoryCharacter) => {
    setEditingCharacterId(character?.id);
    setCharacterDraft({
      name: character?.name || "",
      displayName: character?.displayName || "",
      aliases: character?.aliases.join(", ") || "",
      color: character?.color || "#7f8ed5",
      expressionName: "",
      expressionAssetId: "",
      expressionAliases: "",
    });
    setShowCharacter(true);
  };
  const saveCharacter = () => {
    if (!characterDraft.name.trim() || !characterDraft.displayName.trim()) return;
    const expression = characterDraft.expressionName && characterDraft.expressionAssetId ? {
      id: createId("expr"),
      name: characterDraft.expressionName.trim(),
      assetId: characterDraft.expressionAssetId,
      aliases: characterDraft.expressionAliases.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    } : undefined;
    if (editingCharacterId) {
      onChange({
        ...project,
        characters: project.characters.map((character) => character.id === editingCharacterId ? {
          ...character,
          name: characterDraft.name.trim(),
          displayName: characterDraft.displayName.trim(),
          aliases: characterDraft.aliases.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          color: characterDraft.color,
          expressions: expression ? [...character.expressions, expression] : character.expressions,
          defaultExpressionId: character.defaultExpressionId || expression?.id,
        } : character),
      }, expression ? "编辑角色并添加表情差分" : "编辑角色");
    } else {
      const character: StoryCharacter = {
        id: createId("char"),
        name: characterDraft.name.trim(),
        displayName: characterDraft.displayName.trim(),
        aliases: characterDraft.aliases.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        color: characterDraft.color,
        expressions: expression ? [expression] : [],
        defaultExpressionId: expression?.id,
      };
      onChange({ ...project, characters: [...project.characters, character] }, "创建角色");
    }
    setShowCharacter(false);
  };

  return (
    <div className="asset-workspace">
      <header className="workspace-title">
        <div><span className="eyebrow">CHARACTERS & ASSETS</span><h2>角色与资源管理</h2><p>别名解析、表情差分与缺失引用共享同一个资源注册表。</p></div>
        <button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={14} /> 注册资源</button>
      </header>
      <div className="asset-layout">
        <aside className="asset-sidebar">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><Archive size={14} /> 全部资源 <b>{project.assets.length}</b></button>
          {(["background", "figure", "expression", "bgm", "voice", "sfx", "video", "animation", "ui"] as StoryAsset["kind"][]).map((kind) => (
            <button key={kind} className={filter === kind ? "active" : ""} onClick={() => setFilter(kind)}>
              {kind === "bgm" || kind === "voice" || kind === "sfx" ? <Music2 size={14} /> : <ImageIcon size={14} />}
              {kind}<b>{project.assets.filter((asset) => asset.kind === kind).length}</b>
            </button>
          ))}
          <div className="alias-tester">
            <span>ALIAS RESOLVER</span>
            <input value={aliasQuery} onChange={(event) => setAliasQuery(event.target.value)} placeholder="如：爱丽丝微笑" />
            {aliasQuery && <p className={aliasMatch ? "matched" : "unmatched"}>{aliasMatch ? `→ ${aliasMatch.name}` : "无匹配：将要求选择/上传/生成"}</p>}
          </div>
        </aside>
        <main className="asset-main">
          <section className="character-strip">
            {project.characters.map((character) => (
              <button className="character-card" key={character.id} onClick={() => openCharacter(character)}>
                <div className="character-avatar">{character.displayName.slice(0, 1)}</div>
                <div><strong>{character.displayName}</strong><span>{character.expressions.length} expressions · {character.aliases.length} aliases</span></div>
                <div className="expression-dots">{character.expressions.map((expression) => <i key={expression.id} title={expression.name} />)}</div>
              </button>
            ))}
            <button className="new-character" onClick={() => openCharacter()}><Plus size={17} /> 新角色</button>
          </section>
          <div className="asset-grid">
            {assets.map((asset) => (
              <article key={asset.id} className={asset.missing ? "missing" : ""}>
                <div className={`asset-thumb asset-thumb--${asset.kind}`}>
                  {["bgm", "voice", "sfx"].includes(asset.kind) ? <Music2 size={24} /> : <ImageIcon size={24} />}
                  <span>{asset.kind.toUpperCase()}</span>
                </div>
                <div className="asset-info">
                  <strong>{asset.name}</strong>
                  <code>{asset.path}</code>
                  <div>{asset.aliases.map((alias) => <span key={alias}>{alias}</span>)}</div>
                </div>
                {asset.missing ? <b className="asset-state asset-state--missing">MISSING</b> : <b className="asset-state">REGISTERED</b>}
              </article>
            ))}
          </div>
        </main>
      </div>
      {showAdd && (
        <div className="modal-backdrop">
          <div className="studio-modal">
            <header><div><span className="eyebrow">RESOURCE REGISTRY</span><h3>注册资源与别名</h3></div><button onClick={() => setShowAdd(false)}><X size={17} /></button></header>
            <label>显示名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="爱丽丝·微笑" /></label>
            <label>资源类型<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as StoryAsset["kind"] })}>{["background", "figure", "expression", "bgm", "voice", "sfx", "video", "animation", "ui", "other"].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
            <label>WebGAL 相对路径<input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} placeholder="alice/smile.png" /></label>
            <label>别名（逗号分隔）<input value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} placeholder="爱丽丝微笑, 微笑2, 有些开心" /></label>
            <div className="file-drop"><UploadCloud size={22} /><span>资源二进制可在 Terre 同步后上传；此处先注册稳定路径与别名。</span></div>
            <footer><button onClick={() => setShowAdd(false)}>取消</button><button className="primary-button" onClick={addAsset}>注册资源</button></footer>
          </div>
        </div>
      )}
      {showCharacter && (
        <div className="modal-backdrop">
          <div className="studio-modal">
            <header><div><span className="eyebrow">CHARACTER REGISTRY</span><h3>{editingCharacterId ? "编辑角色与差分" : "创建角色"}</h3></div><button onClick={() => setShowCharacter(false)}><X size={17} /></button></header>
            <div className="settings-row">
              <label>内部名称<input value={characterDraft.name} onChange={(event) => setCharacterDraft({ ...characterDraft, name: event.target.value })} placeholder="alice" /></label>
              <label>显示名称<input value={characterDraft.displayName} onChange={(event) => setCharacterDraft({ ...characterDraft, displayName: event.target.value })} placeholder="爱丽丝" /></label>
            </div>
            <div className="settings-row">
              <label>别名<input value={characterDraft.aliases} onChange={(event) => setCharacterDraft({ ...characterDraft, aliases: event.target.value })} placeholder="Alice, 爱丽丝" /></label>
              <label>主题色<input type="color" value={characterDraft.color} onChange={(event) => setCharacterDraft({ ...characterDraft, color: event.target.value })} /></label>
            </div>
            {editingCharacterId && (
              <div className="character-expression-list">
                <span>已有表情差分</span>
                {project.characters.find((character) => character.id === editingCharacterId)?.expressions.map((expression) => <code key={expression.id}>{expression.name}</code>)}
              </div>
            )}
            <span className="field-title">{editingCharacterId ? "追加表情差分（可选）" : "首个表情差分（可选）"}</span>
            <label>差分名称<input value={characterDraft.expressionName} onChange={(event) => setCharacterDraft({ ...characterDraft, expressionName: event.target.value })} placeholder="微笑" /></label>
            <label>立绘资源<select value={characterDraft.expressionAssetId} onChange={(event) => setCharacterDraft({ ...characterDraft, expressionAssetId: event.target.value })}><option value="">暂不绑定</option>{project.assets.filter((asset) => ["figure", "expression"].includes(asset.kind)).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
            <label>差分别名<input value={characterDraft.expressionAliases} onChange={(event) => setCharacterDraft({ ...characterDraft, expressionAliases: event.target.value })} placeholder="微笑2, 开心" /></label>
            <footer><button onClick={() => setShowCharacter(false)}>取消</button><button className="primary-button" onClick={saveCharacter}>{editingCharacterId ? "保存角色" : "创建角色"}</button></footer>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsWorkspace({ project, onChange }: { project: StoryProject; onChange: (project: StoryProject, label: string) => void }) {
  const updateProject = (patch: Partial<StoryProject>, label: string) => onChange({ ...project, ...patch }, label);
  const updateSettings = (patch: Partial<StoryProject["settings"]>, label: string) => updateProject({ settings: { ...project.settings, ...patch } }, label);
  const updateVariable = (id: string, patch: Partial<StoryVariable>) => {
    updateProject({ variables: project.variables.map((variable) => variable.id === id ? { ...variable, ...patch } : variable) }, "编辑项目变量");
  };
  const parseDefaultValue = (type: StoryVariable["type"], value: string): StoryVariable["defaultValue"] => {
    if (type === "boolean") return value === "true";
    if (type === "number") return Number(value || 0);
    return value;
  };
  const addVariable = () => {
    const variable: StoryVariable = {
      id: createId("var"),
      name: `variable_${project.variables.length + 1}`,
      type: "string",
      defaultValue: "",
      scope: "save",
      description: "",
    };
    updateProject({ variables: [...project.variables, variable] }, "添加项目变量");
  };

  return (
    <div className="settings-workspace">
      <header className="workspace-title">
        <div><span className="eyebrow">PROJECT CONFIGURATION</span><h2>项目与运行设置</h2><p>这里的配置直接写回 Story IR，并影响预览、编译、Blog Bridge 与导出。</p></div>
      </header>
      <div className="settings-grid">
        <section className="settings-card">
          <div className="panel-bar"><span>项目信息</span><b>Story IR</b></div>
          <label>项目标题<input value={project.title} onChange={(event) => updateProject({ title: event.target.value }, "编辑项目标题")} /></label>
          <div className="settings-row">
            <label>Slug<input value={project.slug} onChange={(event) => updateProject({ slug: event.target.value }, "编辑项目 Slug")} /></label>
            <label>版本<input value={project.version} onChange={(event) => updateProject({ version: event.target.value }, "编辑项目版本")} /></label>
          </div>
          <div className="settings-row">
            <label>入口场景<select value={project.settings.startSceneId} onChange={(event) => updateSettings({ startSceneId: event.target.value }, "修改入口场景")}>{project.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></label>
            <label>默认模式<select value={project.settings.defaultMode} onChange={(event) => updateSettings({ defaultMode: event.target.value as StoryProject["settings"]["defaultMode"] }, "修改默认表现模式")}><option value="adv">ADV</option><option value="nvl">NVL</option></select></label>
          </div>
        </section>

        <section className="settings-card">
          <div className="panel-bar"><span>WebGAL 与 Terre</span><b>{project.settings.webgalVersion}</b></div>
          <label>WebGAL 版本<input value={project.settings.webgalVersion} onChange={(event) => updateSettings({ webgalVersion: event.target.value }, "修改 WebGAL 版本")} /></label>
          <label>共享引擎模块 URL<input value={project.settings.sharedEngineUrl || ""} onChange={(event) => updateSettings({ sharedEngineUrl: event.target.value || undefined }, "修改共享引擎地址")} /></label>
          <label>共享引擎样式 URL<input value={project.settings.sharedEngineCssUrl || ""} onChange={(event) => updateSettings({ sharedEngineCssUrl: event.target.value || undefined }, "修改共享引擎样式")} /></label>
          <label>Terre 服务地址<input value={project.settings.terreBaseUrl || ""} onChange={(event) => updateSettings({ terreBaseUrl: event.target.value || undefined }, "修改 Terre 地址")} /></label>
        </section>

        <section className="settings-card">
          <div className="panel-bar"><span>Blog Bridge</span><b>{project.settings.blogBridge.enabled ? "ENABLED" : "DISABLED"}</b></div>
          <label className="inline-check"><input type="checkbox" checked={project.settings.blogBridge.enabled} onChange={(event) => updateSettings({ blogBridge: { ...project.settings.blogBridge, enabled: event.target.checked } }, "切换 Blog Bridge")} /> 启用双向通信</label>
          <label>允许的父页面来源<textarea rows={4} value={project.settings.blogBridge.allowedOrigins.join("\n")} onChange={(event) => updateSettings({ blogBridge: { ...project.settings.blogBridge, allowedOrigins: event.target.value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean) } }, "修改 Bridge 来源白名单")} /></label>
          <div className="settings-row">
            <label>通信频道<input value={project.settings.blogBridge.channel} onChange={(event) => updateSettings({ blogBridge: { ...project.settings.blogBridge, channel: event.target.value } }, "修改 Bridge 频道")} /></label>
            <label>超时（ms）<input type="number" min="1000" value={project.settings.blogBridge.timeoutMs} onChange={(event) => updateSettings({ blogBridge: { ...project.settings.blogBridge, timeoutMs: Number(event.target.value) } }, "修改 Bridge 超时")} /></label>
          </div>
        </section>

        <section className="settings-card settings-card--variables">
          <div className="panel-bar"><span>变量注册表</span><button onClick={addVariable}><Plus size={13} /> 添加变量</button></div>
          <div className="variable-table">
            {project.variables.map((variable) => (
              <article key={variable.id}>
                <input value={variable.name} onChange={(event) => updateVariable(variable.id, { name: event.target.value })} aria-label={`${variable.name} 名称`} />
                <select value={variable.type} onChange={(event) => {
                  const type = event.target.value as StoryVariable["type"];
                  updateVariable(variable.id, { type, defaultValue: type === "boolean" ? false : type === "number" ? 0 : "" });
                }} aria-label={`${variable.name} 类型`}><option value="boolean">boolean</option><option value="number">number</option><option value="string">string</option></select>
                {variable.type === "boolean" ? (
                  <select value={String(variable.defaultValue)} onChange={(event) => updateVariable(variable.id, { defaultValue: parseDefaultValue(variable.type, event.target.value) })} aria-label={`${variable.name} 默认值`}><option value="false">false</option><option value="true">true</option></select>
                ) : (
                  <input type={variable.type === "number" ? "number" : "text"} value={String(variable.defaultValue)} onChange={(event) => updateVariable(variable.id, { defaultValue: parseDefaultValue(variable.type, event.target.value) })} aria-label={`${variable.name} 默认值`} />
                )}
                <select value={variable.scope} onChange={(event) => updateVariable(variable.id, { scope: event.target.value as StoryVariable["scope"] })} aria-label={`${variable.name} 作用域`}><option value="scene">scene</option><option value="save">save</option><option value="global">global</option></select>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function DiagnosticsWorkspace({ diagnostics, project, onOpenScene }: { diagnostics: StoryDiagnostic[]; project: StoryProject; onOpenScene: (id: string) => void }) {
  const grouped = {
    error: diagnostics.filter((item) => item.severity === "error"),
    warning: diagnostics.filter((item) => item.severity === "warning"),
    info: diagnostics.filter((item) => item.severity === "info"),
  };
  return (
    <div className="diagnostics-workspace">
      <header className="workspace-title"><div><span className="eyebrow">VALIDATION</span><h2>项目校验与资源缺失</h2><p>导出前检查 Story IR、场景引用、变量、路线连线和资源注册。</p></div><div className="diagnostic-summary"><span className="error">{grouped.error.length} errors</span><span className="warning">{grouped.warning.length} warnings</span><span className="info">{grouped.info.length} info</span></div></header>
      <div className="diagnostic-list">
        {diagnostics.map((item) => (
          <article key={item.id} className={`diagnostic diagnostic--${item.severity}`}>
            {item.severity === "error" ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
            <div><strong>{item.code}</strong><p>{item.message}</p>{item.path && <code>{item.path}</code>}</div>
            {item.sceneId && <button onClick={() => onOpenScene(item.sceneId!)}>打开 {project.scenes.find((scene) => scene.id === item.sceneId)?.name}<ChevronRight size={13} /></button>}
          </article>
        ))}
      </div>
    </div>
  );
}

function PreviewWorkspace({ project, sceneId }: { project: StoryProject; sceneId: string }) {
  const [mode, setMode] = useState<"internal" | "terre">("internal");
  const [terreUrl, setTerreUrl] = useState(project.settings.terreBaseUrl || "http://localhost:3001");
  const [status, setStatus] = useState("未连接");
  const [previewUrl, setPreviewUrl] = useState("");
  const [bridgeLog, setBridgeLog] = useState<string[]>([]);

  const connect = async () => {
    setStatus("连接中…");
    try {
      const client = new TerreClient(terreUrl);
      await client.health();
      const result = await client.syncProject(project, (message, current, total) => setStatus(`${message} ${current}/${total}`));
      setPreviewUrl(client.previewUrl(result.gameDir));
      setStatus(`已同步 ${result.files} 个编译文件`);
      setMode("terre");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Terre 连接失败");
    }
  };

  return (
    <div className="preview-workspace">
      <header className="workspace-title">
        <div><span className="eyebrow">REALTIME PREVIEW</span><h2>运行与 WebGAL 预览</h2><p>内置舞台用于快速检查 Story IR；Terre 模式运行真实 WebGAL 4.6.2。</p></div>
        <div className="segmented"><button className={mode === "internal" ? "active" : ""} onClick={() => setMode("internal")}>Studio Runtime</button><button className={mode === "terre" ? "active" : ""} onClick={() => setMode("terre")}>WebGAL / Terre</button></div>
      </header>
      <div className="preview-layout">
        <main>
          {mode === "internal" ? (
            <PreviewStage project={project} sceneId={sceneId} onBridgeEvent={(message) => setBridgeLog((items) => [`${new Date().toLocaleTimeString()} ${message}`, ...items].slice(0, 8))} />
          ) : previewUrl ? (
            <iframe className="terre-frame" src={previewUrl} title="WebGAL Terre preview" />
          ) : (
            <div className="terre-empty"><CloudCog size={34} /><strong>连接本地 Terre</strong><p>Studio 会创建/复用 WebGAL 工程、增量写入编译脚本，再在 iframe 中运行真实引擎。</p><button className="primary-button" onClick={connect}><RefreshCcw size={14} /> 连接并同步</button></div>
          )}
        </main>
        <aside className="preview-console">
          <span className="eyebrow">PREVIEW ADAPTER</span>
          <label>Terre 地址<input value={terreUrl} onChange={(event) => setTerreUrl(event.target.value)} /></label>
          <button onClick={connect}><CloudCog size={14} /> 同步 Story IR → WebGAL</button>
          <div className="connection-status"><CircleDot size={13} /><span>{status}</span></div>
          <div className="preview-console__section">
            <strong>Blog Bridge events</strong>
            {bridgeLog.length ? bridgeLog.map((line) => <code key={line}>{line}</code>) : <p>预览中的博客动作会记录在这里。</p>}
          </div>
          <div className="preview-console__section">
            <strong>启动目标</strong>
            <p>scene: {sceneId}</p>
            <p>route / save point 可从导出清单指定。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

const implementedFeatures = [
  ["Story IR 唯一源数据", "完成"],
  ["JSON / Markdown / Ren'Py-like / WebGAL / 标签 / 自然语言导入", "完成"],
  ["局部 StoryPatch、撤销/重做、版本时间线", "完成"],
  ["Story IR → WebGAL 4.6.2 编译", "完成"],
  ["ADV / NVL、选择、自由输入、变量、舞台操作", "完成"],
  ["作者/玩家叙事地图、节点拖动与重新连线", "完成"],
  ["Studio 运行预览 + Blog Bridge 结果模拟", "完成"],
  ["Terre 工程同步与 iframe 真实预览适配器", "完成（需本地 Terre）"],
  ["WebGAL 项目 ZIP、Story JSON、Blog Embed 清单", "完成"],
  ["实时 AI Provider 调用", "接口完成，Provider 未绑定"],
  ["资源二进制持久化与离线引擎内嵌", "待接入本地/云存储"],
] as const;

function ExportWorkspace({ project, diagnostics }: { project: StoryProject; diagnostics: StoryDiagnostic[] }) {
  const compiled = useMemo(() => compileProject(project), [project]);
  const [selectedFile, setSelectedFile] = useState(compiled.files.find((file) => file.path.includes("/scene/scene_"))?.path || compiled.files[0]?.path);
  const file = compiled.files.find((item) => item.path === selectedFile);
  const errors = diagnostics.filter((item) => item.severity === "error");
  const exportZip = () => downloadBlob(createProjectZip(project), `${project.slug}-${project.version}.zip`);
  const exportJson = () => downloadBlob(createStoryJson(project), `${project.slug}.story.json`);
  return (
    <div className="export-workspace">
      <header className="workspace-title"><div><span className="eyebrow">BUILD & PUBLISH</span><h2>WebGAL 编译与导出</h2><p>Story IR 保留为源数据；脚本、Web 包和博客嵌入配置都是可重复生成的产物。</p></div><div className="export-actions"><button onClick={exportJson}><FileJson size={14} /> Story JSON</button><button className="primary-button" disabled={errors.length > 0} onClick={exportZip}><Download size={14} /> 导出 Web 游戏 ZIP</button></div></header>
      <div className="build-summary">
        <article><span>BUILD TARGET</span><strong>WebGAL {project.settings.webgalVersion}</strong><small>Static Web + Terre compatible</small></article>
        <article><span>COMPILED FILES</span><strong>{compiled.files.length}</strong><small>{project.scenes.length} scenes · {project.assets.length} assets registered</small></article>
        <article className={errors.length ? "has-error" : "ok"}><span>PRE-FLIGHT</span><strong>{errors.length ? `${errors.length} errors` : "READY"}</strong><small>{errors.length ? "修复错误后才能导出" : "引用与路线结构通过"}</small></article>
      </div>
      <div className="export-grid">
        <section className="compiled-files">
          <div className="panel-bar"><span>编译产物</span><b>{compiled.entrypoint}</b></div>
          <div className="compiled-file-list">
            {compiled.files.map((item) => <button key={item.path} className={selectedFile === item.path ? "active" : ""} onClick={() => setSelectedFile(item.path)}><Files size={13} /><span>{item.path}</span><small>{item.content.length} B</small></button>)}
          </div>
        </section>
        <section className="compiled-code">
          <div className="panel-bar"><span>{file?.path}</span><button onClick={() => file && navigator.clipboard?.writeText(file.content)}>复制</button></div>
          <pre>{file?.content}</pre>
        </section>
      </div>
      <section className="feature-matrix">
        <div className="panel-bar"><span>第一版能力状态</span><b>不是玩具 Demo</b></div>
        {implementedFeatures.map(([feature, status]) => <div key={feature}><span>{feature}</span><strong className={status.startsWith("完成") ? "done" : "todo"}>{status}</strong></div>)}
      </section>
    </div>
  );
}

function StudioAppClient({ initialProject }: { initialProject: StoryProject }) {
  const [project, setProject] = useState<StoryProject>(() => deepClone(initialProject));
  const [view, setView] = useState<View>("story");
  const [selectedSceneId, setSelectedSceneId] = useState(project.settings.startSceneId);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [savedAt, setSavedAt] = useState("本地自动保存");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastCommit = useRef<{ label: string; time: number } | undefined>(undefined);
  const diagnostics = useMemo(() => validateProject(project), [project]);
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        setSavedAt(`已保存 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      } catch {
        setSavedAt("本地保存空间不足，请导出 Story JSON");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [project]);

  const commit = (next: StoryProject, label: string, actor: Snapshot["actor"] = "human") => {
    const time = Date.now();
    const grouped = lastCommit.current?.label === label && time - lastCommit.current.time < 700;
    if (!grouped) {
      setPast((items) => [...items.slice(-59), { project: deepClone(project), label, actor, timestamp: nowIso() }]);
    }
    setFuture([]);
    setProject({ ...next, updatedAt: nowIso() });
    lastCommit.current = { label, time };
  };
  const undo = () => {
    const snapshot = past[past.length - 1];
    if (!snapshot) return;
    setFuture((items) => [{ project: deepClone(project), label: snapshot.label, actor: snapshot.actor, timestamp: nowIso() }, ...items].slice(0, 60));
    setPast((items) => items.slice(0, -1));
    setProject(snapshot.project);
    lastCommit.current = undefined;
  };
  const redo = () => {
    const snapshot = future[0];
    if (!snapshot) return;
    setPast((items) => [...items, { project: deepClone(project), label: snapshot.label, actor: snapshot.actor, timestamp: nowIso() }].slice(-60));
    setFuture((items) => items.slice(1));
    setProject(snapshot.project);
    lastCommit.current = undefined;
  };
  const addScene = () => {
    const chapter = project.chapters[0];
    if (!chapter) return;
    const id = createId("scene");
    const scene: StoryScene = { id, chapterId: chapter.id, name: `新场景 ${project.scenes.length + 1}`, slug: `scene-${project.scenes.length + 1}`, mode: "adv", tags: [], blocks: [] };
    const deepestY = Math.max(40, ...project.routeMap.nodes.map((node) => routeDisplayPosition(node, project.routeMap.layoutDirection).y));
    const routePosition = routeStoredPosition({ x: 360, y: deepestY + 142 }, project.routeMap.layoutDirection);
    commit({
      ...project,
      scenes: [...project.scenes, scene],
      chapters: project.chapters.map((item) => item.id === chapter.id ? { ...item, sceneIds: [...item.sceneIds, id] } : item),
      routeMap: { ...project.routeMap, nodes: [...project.routeMap.nodes, { id: createId("route"), kind: "scene", title: scene.name, sceneId: id, ...routePosition, replayable: true }] },
    }, "创建场景");
    setSelectedSceneId(id);
    setView("story");
  };
  const openScene = (id: string) => {
    setSelectedSceneId(id);
    setView("story");
  };
  const handleProjectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const loaded = parseStoryProject(JSON.parse(await file.text()));
      setPast((items) => [...items, { project: deepClone(project), label: "打开外部 Story JSON", actor: "import", timestamp: nowIso() }]);
      setFuture([]);
      setProject(loaded);
      setSelectedSceneId(loaded.settings.startSceneId);
      setProjectMenuOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "项目文件无效");
    }
    event.target.value = "";
  };

  return (
    <div className="studio-shell">
      <NavRail view={view} setView={setView} diagnostics={diagnostics} explorerOpen={explorerOpen} onToggleExplorer={() => setExplorerOpen((value) => !value)} />
      <div className="studio-main">
        <header className="topbar">
          <div className="topbar__project">
            <span className="topbar__product">GAL BLOG <b>STUDIO</b></span>
            <i />
            <div className="project-switcher">
              <button onClick={() => setProjectMenuOpen((value) => !value)} aria-expanded={projectMenuOpen}>
                {project.title}<ChevronDown size={13} />
              </button>
              {projectMenuOpen && (
                <div className="project-switcher__menu">
                  <span>PROJECT ACTIONS</span>
                  <button onClick={() => {
                    const restored = deepClone(exampleProject);
                    commit(restored, "恢复内置完整示例", "system");
                    setSelectedSceneId(restored.settings.startSceneId);
                    setView("story");
                    setProjectMenuOpen(false);
                  }}><RefreshCcw size={13} /><div><strong>恢复完整示例</strong><small>当前状态可用撤销恢复</small></div></button>
                  <button onClick={() => {
                    downloadBlob(createStoryJson(project), `${project.slug}.story.json`);
                    setProjectMenuOpen(false);
                  }}><FileJson size={13} /><div><strong>下载 Story 源数据</strong><small>可移植的唯一源文件</small></div></button>
                </div>
              )}
            </div>
            <span className="version-chip">v{project.version}</span>
          </div>
          <div className="topbar__center">
            <span className="save-state"><Save size={13} /> {savedAt}</span>
          </div>
          <div className="topbar__actions">
            <button onClick={undo} disabled={!past.length} title="撤销"><Undo2 size={16} /></button>
            <button onClick={redo} disabled={!future.length} title="重做"><Redo2 size={16} /></button>
            <button onClick={() => setHistoryOpen((value) => !value)} className={historyOpen ? "active" : ""} title="版本历史"><History size={16} /></button>
            <button className={errorCount ? "validation-button validation-button--error" : "validation-button"} onClick={() => setView("diagnostics")}><ShieldCheck size={15} /> {errorCount ? `${errorCount} 个错误` : "校验通过"}</button>
            <button className="topbar-preview" onClick={() => setView("preview")}><Play size={14} fill="currentColor" /> 运行</button>
          </div>
        </header>
        <div className="studio-content">
          {explorerOpen && <ProjectExplorer project={project} selectedSceneId={selectedSceneId} onSelect={openScene} onAddScene={addScene} onOpenProject={() => fileInputRef.current?.click()} onNavigate={setView} />}
          <input ref={fileInputRef} type="file" accept=".json,.story.json" hidden onChange={handleProjectFile} />
          <main className="work-surface">
            {view === "story" && <BlockEditor key={selectedSceneId} project={project} sceneId={selectedSceneId} onChange={commit} onPreview={() => setView("preview")} />}
            {view === "map" && <NarrativeMap project={project} onChange={commit} onOpenScene={openScene} />}
            {view === "assets" && <AssetWorkspace project={project} onChange={commit} />}
            {view === "ai" && <AiWorkspace project={project} sceneId={selectedSceneId} onChange={commit} />}
            {view === "preview" && <PreviewWorkspace project={project} sceneId={selectedSceneId} />}
            {view === "diagnostics" && <DiagnosticsWorkspace diagnostics={diagnostics} project={project} onOpenScene={openScene} />}
            {view === "export" && <ExportWorkspace project={project} diagnostics={diagnostics} />}
            {view === "settings" && <SettingsWorkspace project={project} onChange={commit} />}
          </main>
          {historyOpen && (
            <aside className="history-drawer">
              <header><div><span className="eyebrow">UNDO / REDO LOG</span><h3>操作历史</h3></div><button onClick={() => setHistoryOpen(false)}><X size={16} /></button></header>
              <div className="history-current"><CircleDot size={13} /><div><strong>当前版本</strong><span>{project.updatedAt}</span></div></div>
              {[...past].reverse().map((item, index) => (
                <button key={`${item.timestamp}-${index}`} onClick={() => {
                  const targetIndex = past.length - 1 - index;
                  const snapshot = past[targetIndex];
                  setFuture((items) => [{ project: deepClone(project), label: "恢复前状态", actor: "system", timestamp: nowIso() }, ...items]);
                  setPast((items) => items.slice(0, targetIndex));
                  setProject(snapshot.project);
                }}>
                  <i className={`actor actor--${item.actor}`} />
                  <div><strong>{item.label}</strong><span>{item.actor} · {new Date(item.timestamp).toLocaleTimeString()}</span></div>
                </button>
              ))}
              {!past.length && <p className="history-empty">修改项目后，patch 与人工编辑都会记录在这里。</p>}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

const subscribeToClient = () => () => {};

export function StudioApp() {
  const isClient = useSyncExternalStore(subscribeToClient, () => true, () => false);
  if (!isClient) {
    return (
      <div className="studio-loading">
        <div className="brand-mark"><span>G</span><i /></div>
        <strong>GAL BLOG STUDIO</strong>
        <span>正在载入 Story IR 工作区…</span>
      </div>
    );
  }
  return <StudioAppClient initialProject={loadInitialProject()} />;
}
