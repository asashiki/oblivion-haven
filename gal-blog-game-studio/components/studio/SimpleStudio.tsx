"use client";

import {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import {
  ArrowLeft,
  ArrowLeftRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  FileAudio,
  Film,
  FolderHeart,
  Gamepad2,
  GitBranch,
  GripVertical,
  ImageIcon,
  LibraryBig,
  LockKeyhole,
  Maximize2,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Route,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
  Undo2,
} from "lucide-react";
import { ChangeEvent, memo, useEffect, useMemo, useRef, useState } from "react";

import { FigureStageEditor } from "./FigureStageEditor";
import { resolveRegisteredAssetUrl } from "@/lib/assetUrl";
import { createDirectorDraft, reviseSceneWithInstruction, type DirectorDraft } from "@/lib/story/director";
import { WEBGAL_ANIMATION_PRESETS } from "@/lib/story/performancePresets";
import { prepareWebGalPreview } from "@/lib/webgalPreview";
import {
  deleteStoryAsset,
  deleteStoryScene,
  linkRouteEdge,
  unlinkRouteEdge,
  unlinkRouteEdges,
} from "@/lib/story/editorOperations";
import {
  assetDefaultPosition,
  assetDefaultTransform,
  FIGURE_SHOT_LABELS,
  figureLayoutMetadata,
  figureShotFromTransform,
  inferFigureShot,
  normalizeFigureShot,
  recommendedFigureTransform,
} from "@/lib/story/figureFraming";
import { readLocalAssetFile, removeLocalAssetFile, saveLocalAssetFile } from "@/lib/localAssetStore";
import { routeDisplayPosition, routeStoredPosition } from "@/lib/story/routeLayout";
import type {
  AssetKind,
  RouteEdge,
  RouteNode,
  StagePosition,
  StoryAsset,
  StoryBlock,
  StoryCharacter,
  StoryDiagnostic,
  StoryProject,
  StoryRecord,
  StoryScene,
} from "@/lib/story/types";
import { createId, nowIso, slugify } from "@/lib/story/utils";
import { parseWebGalSpritePackage } from "@/lib/story/webgalSpritePackage";

type SnapshotActor = "human" | "ai" | "import" | "system";
type SimpleSection = "story" | "assets" | "preview";

type Props = {
  project: StoryProject;
  selectedSceneId: string;
  diagnostics: StoryDiagnostic[];
  savedAt: string;
  canUndo: boolean;
  canRedo: boolean;
  onSelectScene: (sceneId: string) => void;
  onChange: (project: StoryProject, label: string, actor?: SnapshotActor) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAdvanced: (view?: "story" | "map" | "assets" | "preview" | "diagnostics") => void;
};

type SimpleNodeData = {
  route: RouteNode;
  scene?: StoryScene;
  chapter?: string;
  locked: boolean;
  playerView: boolean;
  onPlay: (sceneId: string) => void;
};

const assetKindLabels: Record<AssetKind, string> = {
  background: "背景",
  figure: "角色立绘",
  expression: "表情差分",
  bgm: "背景音乐",
  voice: "角色语音",
  sfx: "音效",
  video: "视频",
  animation: "演出动画",
  ui: "界面素材",
  other: "其他",
};

const sectionItems: Array<{ id: SimpleSection; step: string; label: string; description: string; icon: typeof Route }> = [
  { id: "story", step: "01", label: "故事地图", description: "写片段与连路线", icon: Route },
  { id: "assets", step: "02", label: "素材库", description: "上传并补充用途", icon: FolderHeart },
  { id: "preview", step: "03", label: "试玩修订", description: "边玩边调整", icon: Gamepad2 },
];

function useResizablePane(storageKey: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return initial;
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored >= min && stored <= max ? stored : initial;
  });
  const startResize = (event: React.PointerEvent<HTMLButtonElement>, direction: "left" | "right") => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const move = (pointerEvent: PointerEvent) => {
      const delta = pointerEvent.clientX - startX;
      setWidth(Math.max(min, Math.min(max, startWidth + (direction === "left" ? delta : -delta))));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setWidth((value) => {
        window.localStorage.setItem(storageKey, String(value));
        return value;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };
  return { width, startResize };
}

function SplitGrip({ onPointerDown, label }: { onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void; label: string }) {
  return <button className="split-grip" onPointerDown={onPointerDown} aria-label={label} title={label}><GripVertical size={15} /></button>;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function choiceGroupCode(project: StoryProject, scene: StoryScene, block: Extract<StoryBlock, { type: "choice" }>): string {
  if (block.groupCode) return block.groupCode;
  const sceneIndex = Math.max(0, project.scenes.findIndex((item) => item.id === scene.id));
  const groupIndex = Math.max(0, scene.blocks.filter((item) => item.type === "choice").findIndex((item) => item.id === block.id));
  return `S${String(sceneIndex + 1).padStart(2, "0")}-Q${String(groupIndex + 1).padStart(2, "0")}`;
}

function precedingChoice(blocks: StoryBlock[], index: number): Extract<StoryBlock, { type: "choice" }> | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = blocks[cursor];
    if (candidate.type === "choice") return candidate;
    if (candidate.type === "dialogue" || candidate.type === "narration" || candidate.type === "input") return undefined;
  }
  return undefined;
}

function useProjectAssetUrls(project: StoryProject): Record<string, string> {
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void Promise.all(project.assets.filter((asset) => asset.metadata?.localFile).map(async (asset) => {
      try {
        const stored = await readLocalAssetFile(asset.id);
        if (!stored || cancelled) return;
        const url = URL.createObjectURL(stored.file);
        created.push(url);
        setAssetUrls((items) => ({ ...items, [asset.id]: url }));
      } catch {
        // The resource card can still show its semantic metadata.
      }
    }));
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [project.assets]);

  return assetUrls;
}

const SimpleRouteNode = memo(function SimpleRouteNode({ data, selected }: NodeProps<Node<SimpleNodeData>>) {
  const { route, scene, chapter, locked, playerView, onPlay } = data;
  return (
    <div
      className={[
        "simple-route-node",
        selected ? "is-selected" : "",
        locked ? "is-locked" : "",
        route.kind.includes("ending") ? "is-ending" : "",
      ].filter(Boolean).join(" ")}
      style={{ "--route-accent": route.color || "#786bd9" } as React.CSSProperties}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={!playerView}
        className={playerView ? "simple-route-handle--readonly" : undefined}
      />
      <div className="simple-route-node__meta">
        <span>{chapter || "故事片段"}</span>
        {locked ? <LockKeyhole size={12} /> : route.kind === "start" ? <Sparkles size={12} /> : <GitBranch size={12} />}
      </div>
      <strong>{route.title}</strong>
      <p>{scene?.summary || "点击后写下这一段发生什么。"}</p>
      <footer>
        <span>{scene?.blocks.filter((block) => block.type === "dialogue" || block.type === "narration").length || 0} 句</span>
        <span>{scene?.blocks.filter((block) => block.type === "choice").length || 0} 组选项</span>
        {scene && !playerView && (
          <button
            className="simple-route-node__play nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              onPlay(scene.id);
            }}
            aria-label={`试玩 ${scene.name}`}
          >
            <Play size={12} fill="currentColor" /> 试玩
          </button>
        )}
        {playerView && <ChevronRight size={14} />}
      </footer>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={!playerView}
        className={playerView ? "simple-route-handle--readonly" : undefined}
      />
    </div>
  );
});

const simpleNodeTypes = { simpleRoute: SimpleRouteNode };

function SceneStats({ scene }: { scene: StoryScene }) {
  const dialogue = scene.blocks.filter((block) => block.type === "dialogue" || block.type === "narration").length;
  const choices = scene.blocks.filter((block) => block.type === "choice");
  const innerLoops = choices.reduce((count, block) => count + (block.type === "choice" ? block.options.filter((option) => option.targetBlockId).length : 0), 0)
    + scene.blocks.filter((block) => block.type === "jump" && block.targetBlockId).length;
  const outerExits = new Set(scene.blocks.flatMap((block) => {
    if (block.type === "choice") return block.options.map((option) => option.targetSceneId).filter(Boolean);
    if (block.type === "condition") return block.branches.map((branch) => branch.targetSceneId);
    if (block.type === "jump" && block.targetSceneId) return [block.targetSceneId];
    return [];
  })).size;
  return (
    <div className="scene-stats">
      <span><strong>{dialogue}</strong> 句内容</span>
      <span><strong>{choices.length}</strong> 组选项</span>
      <span><strong>{innerLoops}</strong> 个片段内循环</span>
      <span><strong>{outerExits}</strong> 个外部出口</span>
    </div>
  );
}

function DirectorResultCard({ result }: { result: DirectorDraft }) {
  return (
    <div className="director-result">
      <div className="director-result__title"><Check size={15} /><strong>这一段已经生成</strong><span>可直接试玩，也可以撤销</span></div>
      <div className="director-matches">
        {result.matches.map((match) => (
          <span key={`${match.role}-${match.id}`} title={match.reason}>
            <i>{match.role === "background" ? "景" : match.role === "bgm" ? "乐" : match.role === "character" ? "角" : "表"}</i>
            {match.label}
            <b>{Math.round(match.confidence * 100)}%</b>
          </span>
        ))}
      </div>
      {result.notes.map((note) => <p key={note}>{note}</p>)}
    </div>
  );
}

type StoryWorkspaceProps = Pick<Props, "project" | "selectedSceneId" | "onSelectScene" | "onChange" | "onAdvanced"> & {
  onCreate: (kind: "scene" | "chapter") => void;
  onDeleteScene: (sceneId: string) => void;
  onOpenPreview: () => void;
};

function StoryWorkspace({
  project,
  selectedSceneId,
  onSelectScene,
  onChange,
  onAdvanced,
  onCreate,
  onDeleteScene,
  onOpenPreview,
}: StoryWorkspaceProps) {
  const playerView = false;
  const [chapterId, setChapterId] = useState("all");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [recordDraft, setRecordDraft] = useState("");
  const [brief, setBrief] = useState("");
  const [directorResult, setDirectorResult] = useState<DirectorDraft>();
  const briefSceneId = useRef<string | undefined>(undefined);
  const storyPane = useResizablePane("gal-story-inspector-width", 470, 360, 720);
  const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId) || project.scenes[0];
  const selectedRoute = project.routeMap.nodes.find((node) => node.sceneId === selectedScene?.id);

  useEffect(() => {
    if (briefSceneId.current === selectedScene?.id) return;
    briefSceneId.current = selectedScene?.id;
    setBrief(selectedScene?.aiContext || selectedScene?.summary || "");
    setDirectorResult(undefined);
  }, [selectedScene]);

  const chapterSceneIds = useMemo(() => {
    if (chapterId === "all") return undefined;
    return new Set(project.chapters.find((chapter) => chapter.id === chapterId)?.sceneIds || []);
  }, [chapterId, project.chapters]);

  const visibleRoutes = useMemo(() => project.routeMap.nodes.filter((route) => {
    if (playerView && route.hiddenFromPlayer) return false;
    if (!chapterSceneIds) return true;
    return Boolean(route.sceneId && chapterSceneIds.has(route.sceneId));
  }), [chapterSceneIds, playerView, project.routeMap.nodes]);
  const visibleRouteIds = useMemo(() => new Set(visibleRoutes.map((route) => route.id)), [visibleRoutes]);

  const projectNodes = useMemo<Node<SimpleNodeData>[]>(() => visibleRoutes.map((route) => {
    const scene = project.scenes.find((item) => item.id === route.sceneId);
    const chapter = project.chapters.find((item) => item.id === scene?.chapterId);
    return {
      id: route.id,
      type: "simpleRoute",
      position: routeDisplayPosition(route, project.routeMap.layoutDirection),
      selected: route.sceneId === selectedScene?.id,
      deletable: false,
      ariaLabel: `${route.title}，${scene?.summary || "尚未生成"}`,
      data: {
        route,
        scene,
        chapter: chapter?.name,
        playerView,
        locked: playerView && Boolean(route.unlockCondition),
        onPlay: (sceneId: string) => {
          onSelectScene(sceneId);
          onOpenPreview();
        },
      },
    };
  }), [onOpenPreview, onSelectScene, playerView, project.chapters, project.routeMap.layoutDirection, project.scenes, selectedScene?.id, visibleRoutes]);
  const [nodes, setNodes, onNodesChange] = useNodesState(projectNodes);

  useEffect(() => {
    setNodes(projectNodes);
  }, [projectNodes, setNodes]);

  const edges = useMemo<Edge[]>(() => project.routeMap.edges
    .filter((edge) => visibleRouteIds.has(edge.source) && visibleRouteIds.has(edge.target) && (!playerView || !edge.hiddenFromPlayer))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label || edge.condition,
      selected: edge.id === selectedEdgeId,
      markerEnd: { type: MarkerType.ArrowClosed, color: edge.id === selectedEdgeId ? "#6e5fca" : "#a89fd6" },
      style: {
        stroke: edge.id === selectedEdgeId ? "#6e5fca" : edge.condition ? "#ba91ba" : "#afa8cf",
        strokeWidth: edge.id === selectedEdgeId ? 3 : 1.8,
        strokeDasharray: edge.condition ? "5 4" : undefined,
      },
      labelStyle: { fill: "#756e88", fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: "#fffdf9", fillOpacity: 0.96 },
      labelBgPadding: [5, 3] as [number, number],
      labelBgBorderRadius: 8,
    })), [playerView, project.routeMap.edges, selectedEdgeId, visibleRouteIds]);
  const selectedEdge = project.routeMap.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedEdgeSource = project.routeMap.nodes.find((node) => node.id === selectedEdge?.source);
  const selectedEdgeTarget = project.routeMap.nodes.find((node) => node.id === selectedEdge?.target);

  const updateNodePosition = (routeId: string, x: number, y: number) => {
    const position = routeStoredPosition({ x: Math.round(x), y: Math.round(y) }, project.routeMap.layoutDirection);
    onChange({
      ...project,
      routeMap: {
        ...project.routeMap,
        nodes: project.routeMap.nodes.map((node) => node.id === routeId ? { ...node, ...position } : node),
      },
    }, "移动剧情片段");
  };

  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    if (project.routeMap.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) return;
    const edge: RouteEdge = { id: createId("edge"), source: connection.source, target: connection.target, label: "继续" };
    onChange(linkRouteEdge(project, edge), "连接剧情片段");
    setSelectedEdgeId(edge.id);
  };

  const removeEdge = (edgeId: string) => {
    onChange(unlinkRouteEdge(project, edgeId), "删除剧情分支");
    setSelectedEdgeId((current) => current === edgeId ? undefined : current);
  };

  const removeEdges = (edgeIds: string[]) => {
    if (!edgeIds.length) return;
    onChange(unlinkRouteEdges(project, edgeIds), "删除剧情分支");
    setSelectedEdgeId(undefined);
  };

  const updateEdgeLabel = (edgeId: string, label: string) => {
    onChange({
      ...project,
      routeMap: {
        ...project.routeMap,
        edges: project.routeMap.edges.map((edge) => (
          edge.id === edgeId ? { ...edge, label: label.trim() || undefined } : edge
        )),
      },
    }, "修改分支名称");
  };

  const generate = () => {
    if (!selectedScene) return;
    const result = createDirectorDraft(project, selectedScene.id, brief);
    onChange(result.project, `本地规则生成「${selectedScene.name}」`, "system");
    setDirectorResult(result);
  };

  const updateScene = (patch: Partial<StoryScene>, label: string) => {
    if (!selectedScene) return;
    onChange({
      ...project,
      scenes: project.scenes.map((scene) => scene.id === selectedScene.id ? { ...scene, ...patch } : scene),
      routeMap: patch.name ? {
        ...project.routeMap,
        nodes: project.routeMap.nodes.map((node) => node.sceneId === selectedScene.id ? { ...node, title: patch.name || node.title } : node),
      } : project.routeMap,
    }, label);
  };

  const saveSceneName = (draft: string) => {
    const name = draft.trim();
    if (!selectedScene || !name || name === selectedScene.name) return;
    updateScene({ name }, "修改剧情片段名称");
  };


  const records = project.records || [];
  const allChoiceGroups = project.scenes.flatMap((scene) => scene.blocks
    .filter((block): block is Extract<StoryBlock, { type: "choice" }> => block.type === "choice")
    .map((block) => ({ scene, block, code: choiceGroupCode(project, scene, block) })));
  const selectedChoiceGroups = selectedScene?.blocks.filter((block): block is Extract<StoryBlock, { type: "choice" }> => block.type === "choice") || [];

  const updateChoiceGroup = (blockId: string, updater: (block: Extract<StoryBlock, { type: "choice" }>) => Extract<StoryBlock, { type: "choice" }>, label: string) => {
    if (!selectedScene) return;
    updateScene({
      blocks: selectedScene.blocks.map((block) => block.type === "choice" && block.id === blockId ? updater(block) : block),
    }, label);
  };

  const addChoiceGroup = () => {
    if (!selectedScene) return;
    const group: Extract<StoryBlock, { type: "choice" }> = {
      id: createId("choice"),
      type: "choice",
      groupCode: `S${String(project.scenes.findIndex((item) => item.id === selectedScene.id) + 1).padStart(2, "0")}-Q${String(selectedChoiceGroups.length + 1).padStart(2, "0")}`,
      prompt: "玩家要怎么回应？",
      options: [
        { id: createId("option"), label: "继续听下去" },
        { id: createId("option"), label: "换一种回应" },
      ],
      source: "human",
      createdAt: nowIso(),
    };
    updateScene({ blocks: [...selectedScene.blocks, group] }, "添加片段内选项组");
  };

  const moveChoiceGroup = (blockId: string, afterBlockId: string) => {
    if (!selectedScene) return;
    const group = selectedScene.blocks.find((block) => block.type === "choice" && block.id === blockId);
    if (!group) return;
    const blocks = selectedScene.blocks.filter((block) => block.id !== blockId);
    const insertAt = afterBlockId === "start"
      ? 0
      : Math.max(0, blocks.findIndex((block) => block.id === afterBlockId) + 1);
    blocks.splice(insertAt, 0, group);
    updateScene({ blocks }, "移动片段内选项组");
  };

  const deleteChoiceGroup = (blockId: string) => {
    onChange({
      ...project,
      scenes: project.scenes.map((scene) => ({
        ...scene,
        blocks: scene.blocks.filter((block) => block.id !== blockId).map((block): StoryBlock => {
          if (block.type === "choice") {
            return {
              ...block,
              options: block.options.map((option) => option.targetChoiceGroupId === blockId
                ? { ...option, targetChoiceGroupId: undefined }
                : option),
            };
          }
          if (block.type === "dialogue") {
            return {
              ...block,
              choiceReactions: block.choiceReactions?.filter((reaction) => reaction.choiceBlockId !== blockId),
            };
          }
          return block;
        }),
      })),
    }, "删除片段内选项组并清理引用");
  };

  const createRecord = () => {
    const name = recordDraft.trim();
    if (!name) return;
    const record: StoryRecord = { id: createId("record"), name };
    onChange({ ...project, records: [...records, record] }, `创建记录「${record.name}」`);
    setRecordDraft("");
  };

  const setOptionDestination = (blockId: string, optionId: string, value: string) => {
    updateChoiceGroup(blockId, (block) => ({
      ...block,
      options: block.options.map((option) => option.id !== optionId ? option : {
        ...option,
        targetBlockId: undefined,
        targetRouteNodeId: undefined,
        targetChoiceGroupId: value.startsWith("group:") ? value.slice(6) : undefined,
        targetSceneId: value.startsWith("scene:") ? value.slice(6) : undefined,
        endScene: value === "end" || undefined,
      }),
    }), "修改选项去向");
  };

  const updateSelectedEdgeRecords = (patch: Partial<NonNullable<RouteEdge["recordCondition"]>>) => {
    if (!selectedEdge) return;
    onChange({
      ...project,
      routeMap: {
        ...project.routeMap,
        edges: project.routeMap.edges.map((edge) => edge.id === selectedEdge.id ? {
          ...edge,
          recordCondition: {
            mode: edge.recordCondition?.mode || "all",
            recordIds: edge.recordCondition?.recordIds || [],
            ...patch,
          },
        } : edge),
      },
    }, "修改主干进入条件");
  };

  return (
    <div className="simple-story">
      <header className="simple-page-heading">
        <div>
          <span className="simple-kicker">STORY MAP · 一小段一小段地写</span>
          <h1>从地图上直接创作故事</h1>
          <p>外层只管章节和剧情片段；选项、循环与演出留在每个片段内部。</p>
        </div>
        <div className="simple-heading-actions">
          <button className="soft-button" onClick={() => onCreate("chapter")}><LibraryBig size={15} /> 新章节</button>
          <button className="simple-primary" onClick={() => onCreate("scene")}><Plus size={16} /> 新增剧情片段</button>
        </div>
      </header>

      <div className="simple-story-toolbar">
        <div className="chapter-switcher">
          <button className={chapterId === "all" ? "active" : ""} onClick={() => setChapterId("all")}>完整故事</button>
          {project.chapters.map((chapter, index) => (
            <button key={chapter.id} className={chapterId === chapter.id ? "active" : ""} onClick={() => setChapterId(chapter.id)}>
              <small>CH.{String(index + 1).padStart(2, "0")}</small>{chapter.name}
            </button>
          ))}
        </div>
        <div className="simple-view-toggle simple-view-toggle--hint">
          <CircleHelp size={15} />
          <strong>外层只画片段结束后的主干</strong>
          <span>片段内的多组选项、短反应和循环统一在右侧编辑，不会把地图拆成一地小节点。</span>
        </div>
      </div>

      <div className="simple-story-layout" style={{ gridTemplateColumns: `minmax(520px, 1fr) 8px ${storyPane.width}px` }}>
        <section className="simple-map-panel">
          <div className="simple-map-chapter-card">
            <span>{chapterId === "all" ? "全路线总览" : project.chapters.find((chapter) => chapter.id === chapterId)?.name}</span>
            <strong>剧情向下推进，分支向左右展开</strong>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={simpleNodeTypes}
            onNodesChange={onNodesChange}
            defaultViewport={{ x: 0, y: 0, zoom: 0.92 }}
            minZoom={0.35}
            maxZoom={1.5}
            nodeDragThreshold={1}
            nodesDraggable={!playerView}
            nodesConnectable={!playerView}
            elementsSelectable
            edgesFocusable={!playerView}
            deleteKeyCode={playerView ? null : ["Backspace", "Delete"]}
            elevateNodesOnSelect={false}
            panOnScroll
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
            onConnect={connect}
            onNodeClick={(_, node) => {
              const sceneId = project.routeMap.nodes.find((route) => route.id === node.id)?.sceneId;
              if (sceneId) onSelectScene(sceneId);
              setSelectedEdgeId(undefined);
            }}
            onNodeDragStop={(_, node) => updateNodePosition(node.id, node.position.x, node.position.y)}
            onEdgeClick={(event, edge) => {
              event.stopPropagation();
              setSelectedEdgeId(edge.id);
            }}
            onEdgesDelete={(deleted) => removeEdges(deleted.map((edge) => edge.id))}
            onPaneClick={() => setSelectedEdgeId(undefined)}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="#ded9ea" />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
          <div className="simple-map-legend">
            <span><i className="open" /> 主干剧情片段</span>
            <span><GitBranch size={13} /> 点击细线编辑记录条件</span>
            <span><ArrowLeftRight size={13} /> 线条可交叉；片段内循环不画在这里</span>
          </div>
        </section>

        <SplitGrip onPointerDown={(event) => storyPane.startResize(event, "right")} label="拖动调整地图与片段编辑区宽度" />

        <aside className="simple-scene-panel">
          {selectedScene ? (
            <>
              <header className="scene-panel-heading">
                <div>
                  <span>{project.chapters.find((chapter) => chapter.id === selectedScene.chapterId)?.name}</span>
                  <input
                    key={selectedScene.id}
                    defaultValue={selectedScene.name}
                    onBlur={(event) => saveSceneName(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    aria-label="剧情片段名称"
                  />
                </div>
                <div className="scene-panel-heading__actions">
                  <button
                    className="icon-soft is-danger"
                    onClick={() => onDeleteScene(selectedScene.id)}
                    disabled={project.scenes.length <= 1}
                    title={project.scenes.length <= 1 ? "项目至少需要保留一个剧情片段" : "删除当前剧情片段"}
                  >
                    <Trash2 size={16} />
                  </button>
                  <button className="icon-soft" onClick={() => onAdvanced("story")} title="打开细节编辑"><MoreHorizontal size={18} /></button>
                </div>
              </header>
              <SceneStats scene={selectedScene} />
              {selectedEdge ? (
                <section className="route-edge-inspector">
                  <header><GitBranch size={16} /><div><span>片段结束后的主干</span><strong>{selectedEdgeSource?.title} → {selectedEdgeTarget?.title}</strong></div></header>
                  <label>细线名称<input value={selectedEdge.label || ""} onChange={(event) => updateEdgeLabel(selectedEdge.id, event.target.value)} placeholder="继续" /></label>
                  <label>进入条件
                    <select value={selectedEdge.recordCondition ? selectedEdge.recordCondition.mode : "none"} onChange={(event) => {
                      const value = event.target.value;
                      if (value === "none") {
                        onChange({ ...project, routeMap: { ...project.routeMap, edges: project.routeMap.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, recordCondition: undefined } : edge) } }, "清除主干进入条件");
                      } else updateSelectedEdgeRecords({ mode: value as "all" | "at-least" });
                    }}>
                      <option value="none">无条件继续</option>
                      <option value="all">拥有选中的全部记录</option>
                      <option value="at-least">选中的记录至少获得几个</option>
                    </select>
                  </label>
                  {selectedEdge.recordCondition && (
                    <div className="route-record-picker">
                      {records.map((record) => (
                        <label key={record.id}><input type="checkbox" checked={selectedEdge.recordCondition?.recordIds.includes(record.id) || false} onChange={(event) => {
                          const current = selectedEdge.recordCondition?.recordIds || [];
                          updateSelectedEdgeRecords({ recordIds: event.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id) });
                        }} />{record.name}</label>
                      ))}
                      {!records.length && <p>还没有一次性记录。先回到片段，给某个选项添加记录。</p>}
                    </div>
                  )}
                  {selectedEdge.recordCondition?.mode === "at-least" && (
                    <label>至少获得<input type="number" min={1} max={Math.max(1, selectedEdge.recordCondition.recordIds.length)} value={selectedEdge.recordCondition.minimum || 1} onChange={(event) => updateSelectedEdgeRecords({ minimum: Number(event.target.value) })} /></label>
                  )}
                  <p className="route-edge-note">单个记录就是只勾选一项；多项全有与“至少 N 项”都直接编译到 WebGAL 的片段出口。</p>
                  <button className="danger-button" onClick={() => removeEdge(selectedEdge.id)}><Trash2 size={14} /> 删除这条细线</button>
                </section>
              ) : (
                <>
              <section className="choice-group-workspace">
                <header><div><span>片段内部 · 按游戏推进顺序</span><strong>选项组</strong></div><button onClick={addChoiceGroup}><Plus size={13} /> 添加选项组</button></header>
                <p>选项可以出现在片段中间；跳到本段或别段的任意选项组、结束片段，或者只影响下一句后继续。</p>
                <div className="story-record-strip">
                  <span>一次性记录</span>
                  {records.map((record) => <button key={record.id} onClick={() => copyText(record.name)} title="点击复制记录名"><Copy size={11} />{record.name}</button>)}
                  <span className="story-record-create">
                    <input value={recordDraft} onChange={(event) => setRecordDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createRecord(); }} placeholder="例如：获得线索 A" aria-label="新记录名称" />
                    <button onClick={createRecord} disabled={!recordDraft.trim()}><Plus size={11} />添加</button>
                  </span>
                </div>
                <div className="choice-group-list">
                  {selectedChoiceGroups.map((group, groupIndex) => (
                    <article className="choice-group-card" key={group.id}>
                      <header><span>{choiceGroupCode(project, selectedScene, group)}</span><input value={group.prompt || ""} onChange={(event) => updateChoiceGroup(group.id, (block) => ({ ...block, prompt: event.target.value }), "修改选项组提示")} placeholder="选项出现时的提示" /><button onClick={() => deleteChoiceGroup(group.id)}><Trash2 size={12} /></button></header>
                      <label className="choice-group-placement">
                        <span>出现位置</span>
                        <select
                          value={selectedScene.blocks[selectedScene.blocks.findIndex((block) => block.id === group.id) - 1]?.id || "start"}
                          onChange={(event) => moveChoiceGroup(group.id, event.target.value)}
                        >
                          <option value="start">片段开头</option>
                          {selectedScene.blocks.filter((block) => block.id !== group.id).map((block, blockIndex) => (
                            <option key={block.id} value={block.id}>
                              放在 {blockIndex + 1}. {block.type === "dialogue"
                                ? `${project.characters.find((character) => character.id === block.characterId)?.displayName || "角色"}：${block.text.slice(0, 18)}`
                                : block.type === "narration"
                                  ? `旁白：${block.text.slice(0, 18)}`
                                  : block.type === "choice"
                                    ? `选项组 ${choiceGroupCode(project, selectedScene, block)}`
                                    : block.type === "stage" ? stageActionLabels[block.action] : block.type} 之后
                            </option>
                          ))}
                        </select>
                      </label>
                      <div>
                        {group.options.map((option, optionIndex) => {
                          const destination = option.targetChoiceGroupId
                            ? `group:${option.targetChoiceGroupId}`
                            : option.targetSceneId
                              ? `scene:${option.targetSceneId}`
                              : option.endScene ? "end" : "continue";
                          return (
                            <section className="choice-option-row" key={option.id}>
                              <b>{optionIndex + 1}</b>
                              <input value={option.label} onChange={(event) => updateChoiceGroup(group.id, (block) => ({ ...block, options: block.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) }), "修改选项文字")} aria-label={`${choiceGroupCode(project, selectedScene, group)} 选项 ${optionIndex + 1}`} />
                              <select value={destination} onChange={(event) => setOptionDestination(group.id, option.id, event.target.value)}>
                                <option value="continue">继续播放本片段（可影响下一句）</option>
                                <option value="end">结束本片段，按地图细线继续</option>
                                {allChoiceGroups.map((item) => <option key={item.block.id} value={`group:${item.block.id}`}>跳到 {item.code} · {item.scene.name}{item.block.id === group.id ? "（本组选项循环）" : ""}</option>)}
                                {project.scenes.map((scene) => <option key={scene.id} value={`scene:${scene.id}`}>兼容旧稿：跳到片段开头 · {scene.name}</option>)}
                              </select>
                              <select value={option.recordId || ""} onChange={(event) => updateChoiceGroup(group.id, (block) => ({ ...block, options: block.options.map((item) => item.id === option.id ? { ...item, recordId: event.target.value || undefined } : item) }), "修改选项一次性记录")}>
                                <option value="">不写入记录</option>
                                {records.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
                              </select>
                              <button onClick={() => updateChoiceGroup(group.id, (block) => ({ ...block, options: block.options.filter((item) => item.id !== option.id) }), "删除选项")}><Trash2 size={12} /></button>
                            </section>
                          );
                        })}
                      </div>
                      <button className="choice-add-option" onClick={() => updateChoiceGroup(group.id, (block) => ({ ...block, options: [...block.options, { id: createId("option"), label: `新选项 ${block.options.length + 1}` }] }), "添加选项")}><Plus size={12} /> 添加一个选项</button>
                      <small>第 {groupIndex + 1} 组选项 · 选择“继续”时可在试玩修订页给下一句添加不同反应，然后自动汇合。</small>
                    </article>
                  ))}
                  {!selectedChoiceGroups.length && <button className="choice-group-empty" onClick={addChoiceGroup}><GitBranch size={20} /><strong>这个片段还没有选项组</strong><span>可以在开头、中间或结尾添加，不会强制收尾。</span></button>}
                </div>
              </section>
              <div className="scene-panel-tabs">
                <button className="active"><WandSparkles size={14} /> 用一句话创作</button>
                <button onClick={onOpenPreview}><Gamepad2 size={14} /> 用 WebGAL 试玩本段</button>
              </div>
              <div className="director-editor">
                <div className="director-promise">
                  <Sparkles size={17} />
                  <p><strong>真实 AI 尚未接入。</strong>这里先用透明、可回退的本地规则从现有素材中生成验收草稿；没有的资源会明确留空。</p>
                </div>
                <label>
                  <span>这一小段大概发生什么？</span>
                  <textarea
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                    placeholder="例如：晚上的茶室，爱丽丝发现主人回来得很晚。她有一点担心，但不想直接责备。最后问主人今天去了哪里，并给出几个选项。"
                  />
                </label>
                <div className="director-hints">
                  <span>可以只写概括</span>
                  <span>明确台词和选项会原样保留</span>
                  <span>当前只补有限的基础演出</span>
                </div>
                <button className="director-generate" onClick={generate} disabled={!brief.trim()}>
                  <WandSparkles size={17} />
                  <span><strong>生成本地规则草稿</strong><small>非 AI · 只改当前片段 · 可撤销</small></span>
                  <ChevronRight size={18} />
                </button>
                {directorResult && <DirectorResultCard result={directorResult} />}
              </div>
              <div className="scene-exits">
                <div><strong>这段之后会去哪里</strong><span>外层路线只记录片段出口</span></div>
                {project.routeMap.edges.filter((edge) => edge.source === selectedRoute?.id).map((edge) => (
                  <span key={edge.id}>
                    <GitBranch size={13} />
                    {edge.label || edge.condition || "继续"}
                    <ChevronRight size={13} />
                    {project.routeMap.nodes.find((node) => node.id === edge.target)?.title}
                    <button onClick={() => removeEdge(edge.id)} title="删除这条分支线"><Trash2 size={12} /></button>
                  </span>
                ))}
                {!project.routeMap.edges.some((edge) => edge.source === selectedRoute?.id) && <p>还没有外部出口。你可以从地图节点底部拖线连接下一段。</p>}
              </div>
                </>
              )}
            </>
          ) : (
            <div className="simple-empty"><BookOpen size={30} /><strong>先选择一个剧情片段</strong><p>点击地图上的卡片，就能写下这一段发生什么。</p></div>
          )}
        </aside>
      </div>
    </div>
  );
}

function inferAssetKind(file: File): AssetKind {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("audio/")) {
    if (/voice|vocal|cv|语音|台词/.test(name)) return "voice";
    if (/bgm|music|theme|ost|曲/.test(name)) return "bgm";
    return "sfx";
  }
  if (file.type.startsWith("video/")) return "video";
  if (/\.json$/i.test(name)) return "animation";
  if (file.type.startsWith("image/")) {
    if (/bg|background|背景|room|house|street|school|day|night|夕|夜|朝/.test(name)) return "background";
    if (/expression|face|差分|表情|smile|happy|sad|angry|shy|serious/.test(name)) return "expression";
    return "figure";
  }
  return "other";
}

function humanizeFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function expressionName(fileName: string): string {
  const name = fileName.toLowerCase();
  if (/smile|happy|开心|微笑/.test(name)) return /big|very|大笑/.test(name) ? "开心大笑" : "微笑";
  if (/shy|hesitant|害羞|犹豫/.test(name)) return "害羞 / 犹豫";
  if (/serious|worried|认真|担心/.test(name)) return "认真 / 担心";
  if (/angry|生气/.test(name)) return "生气";
  if (/sad|悲伤|难过/.test(name)) return "难过";
  return humanizeFileName(fileName);
}

function semanticMetadata(file: File, kind: AssetKind): Record<string, string | number | boolean> {
  const base = humanizeFileName(file.name);
  const lower = file.name.toLowerCase();
  const time = /night|夜/.test(lower) ? "夜晚" : /sunset|dusk|夕|黄昏/.test(lower) ? "黄昏" : /morning|朝|清晨/.test(lower) ? "清晨" : /day|昼|白天/.test(lower) ? "白天" : "";
  const mood = /sad|悲伤/.test(lower) ? "悲伤" : /happy|smile|开心|微笑/.test(lower) ? "温柔开心" : /serious|担心/.test(lower) ? "认真克制" : /quiet|calm|安静/.test(lower) ? "安静" : "";
  const description = kind === "background"
    ? `${base}${time ? `，${time}` : ""}。适合作为地点明确的场景背景。`
    : kind === "expression" || kind === "figure"
      ? `${base}${mood ? `，情绪偏${mood}` : ""}。上传后可继续补充表情强度和不适用场景。`
      : kind === "bgm"
        ? `${base}${mood ? `，整体氛围${mood}` : ""}。`
        : `${base}。`;
  const metadata: Record<string, string | number | boolean> = {
    description,
    recommendedUse: kind === "background" ? `${time || "对应时段"}的场景开场或转场` : kind === "bgm" ? "按情绪氛围匹配" : "供导演规则或未来 AI 根据角色、情绪与强度选择",
    tags: [time, mood, kind].filter(Boolean).join(", "),
    originalName: file.name,
    fileSize: file.size,
    localFile: true,
    semanticReady: true,
  };
  if (kind === "figure" || kind === "expression") {
    const shot = /chibi|q版|q 版|小人|sd\b/.test(lower) ? "full" : "waist";
    metadata.figureShot = shot;
    metadata.figureDefaultPosition = shot === "full" ? "center" : "right";
  }
  return metadata;
}

async function analyzeFigureFile(file: File): Promise<Record<string, number>> {
  if (!file.type.startsWith("image/")) return {};
  try {
    const bitmap = await createImageBitmap(file);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const longest = Math.max(sourceWidth, sourceHeight);
    const scale = Math.min(1, 384 / longest);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      return {};
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height).data;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] < 12) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return { sourceWidth, sourceHeight };
    return {
      sourceWidth,
      sourceHeight,
      figureVisibleLeft: Number((left / width).toFixed(4)),
      figureVisibleTop: Number((top / height).toFixed(4)),
      figureVisibleRight: Number(((right + 1) / width).toFixed(4)),
      figureVisibleBottom: Number(((bottom + 1) / height).toFixed(4)),
    };
  } catch {
    return {};
  }
}

function findCharacterForFile(project: StoryProject, fileName: string): StoryCharacter | undefined {
  const normalized = fileName.toLowerCase();
  return project.characters.find((character) =>
    [character.name, character.displayName, ...character.aliases].some((alias) => alias && normalized.includes(alias.toLowerCase())),
  );
}

function packageCharacterName(fileName: string, intent: string): string {
  const explicit = (
    intent.match(/这是\s*([^，。,.的]{1,20})的/i)
    || intent.match(/角色(?:是|名为|[：:])\s*([^，。,.]{1,24})/i)
  )?.[1]?.trim();
  if (explicit) return explicit;
  const cleaned = humanizeFileName(fileName)
    .replace(/\b(deliverables?|webgal|sprites?|figures?|package)\b/gi, "")
    .replace(/立绘|差分|成品包|资源包/g, "")
    .trim();
  return cleaned || "待命名角色";
}

type AssetWorkspaceProps = Pick<Props, "project" | "onChange" | "onUndo" | "canUndo">;

function SimpleAssetWorkspace({ project, onChange, onUndo, canUndo }: AssetWorkspaceProps) {
  const [filter, setFilter] = useState<"all" | AssetKind>("all");
  const [query, setQuery] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadIntent, setUploadIntent] = useState("");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "assistant", text: "可以先不上传文件。告诉我你准备放进来的素材、命名习惯和用途，我会先给出整理方案；点名已有素材时，确定性修改会写入操作历史并可撤销。" },
  ]);
  const [packageSummary, setPackageSummary] = useState<{
    name: string;
    character: string;
    expressions: number;
    mouthSync: number;
    blink: number;
    issues: string[];
  }>();
  const [showCharacter, setShowCharacter] = useState(false);
  const [characterDraft, setCharacterDraft] = useState({ displayName: "", name: "", persona: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedAsset = project.assets.find((asset) => asset.id === selectedAssetId);
  const assetPane = useResizablePane("gal-asset-inspector-width", 500, 400, 760);
  const [assetDraft, setAssetDraft] = useState({
    name: "",
    kind: "other" as AssetKind,
    description: "",
    recommendedUse: "",
    tags: "",
    aliases: "",
    figureShot: "waist",
    figurePosition: "right" as StagePosition,
    figureX: 0,
    figureY: 570,
    figureScale: 1.82,
    characterId: "",
    expressionName: "",
    setAsDefault: false,
  });

  const openAsset = (asset: StoryAsset) => {
    const defaultTransform = assetDefaultTransform(asset);
    const characterBinding = project.characters
      .map((character) => ({
        character,
        expression: character.expressions.find((expression) => expression.assetId === asset.id),
      }))
      .find((item) => item.expression);
    setSelectedAssetId(asset.id);
    setAssetDraft({
      name: asset.name,
      kind: asset.kind,
      description: String(asset.metadata?.description || ""),
      recommendedUse: String(asset.metadata?.recommendedUse || ""),
      tags: String(asset.metadata?.tags || ""),
      aliases: asset.aliases.join(", "),
      figureShot: String(asset.metadata?.figureShot || "waist"),
      figurePosition: assetDefaultPosition(asset),
      figureX: defaultTransform.x ?? 0,
      figureY: defaultTransform.y ?? 0,
      figureScale: defaultTransform.scale ?? 1,
      characterId: characterBinding?.character.id || "",
      expressionName: characterBinding?.expression?.name || expressionName(asset.name),
      setAsDefault: Boolean(
        characterBinding?.expression
        && characterBinding.character.defaultExpressionId === characterBinding.expression.id
      ),
    });
  };

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    Promise.all(project.assets.filter((asset) => asset.metadata?.localFile).map(async (asset) => {
      try {
        const stored = await readLocalAssetFile(asset.id);
        if (!stored || cancelled) return;
        const url = URL.createObjectURL(stored.file);
        created.push(url);
        setAssetUrls((items) => ({ ...items, [asset.id]: url }));
      } catch {
        // Registered metadata still remains useful if browser storage is unavailable.
      }
    }));
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [project.assets]);

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadMessage("");
    const newAssets: StoryAsset[] = [];
    let nextCharacters = [...project.characters];
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) {
        try {
          const parsed = parseWebGalSpritePackage(new Uint8Array(await file.arrayBuffer()), file.name);
          const packageId = createId("spritepkg");
          const lookupText = `${file.name} ${uploadIntent}`;
          let character = findCharacterForFile({ ...project, characters: nextCharacters }, lookupText);
          if (!character) {
            const displayName = packageCharacterName(file.name, uploadIntent);
            character = {
              id: createId("char"),
              name: slugify(displayName),
              displayName,
              aliases: [displayName],
              color: "#8878d8",
              description: uploadIntent.trim() || `从 ${file.name} 导入的 WebGAL 动态立绘包。`,
              persona: uploadIntent.trim(),
              expressions: [],
            };
            nextCharacters.push(character);
          }

          const frameAssetIds = new Map<string, string>();
          for (const frame of parsed.frames.values()) {
            const id = createId("asset");
            const frameFile = new File(
              [frame.bytes.slice().buffer as ArrayBuffer],
              frame.relativePath.split("/").pop() || "figure.png",
              { type: frame.mimeType },
            );
            const analysis = await analyzeFigureFile(frameFile);
            const baseMetadata = {
              ...semanticMetadata(frameFile, "expression"),
              ...analysis,
              packageId,
              packageName: parsed.packageName,
              packageSchema: parsed.schemaVersion,
              packageEngine: parsed.engine,
              packageInstallTo: parsed.installTo || "game/figure",
              importIntent: uploadIntent.trim(),
              sourceRelativePath: frame.relativePath,
              runtimeFrame: true,
              figureFramingVersion: 2,
            };
            const shot = normalizeFigureShot((baseMetadata as Record<string, string | number | boolean>).figureShot);
            const metadata = {
              ...baseMetadata,
              ...figureLayoutMetadata(shot === "full" ? "center" : "right", recommendedFigureTransform({
                id,
                kind: "expression",
                name: frameFile.name,
                path: frame.relativePath,
                aliases: [],
                mimeType: frame.mimeType,
                metadata: baseMetadata,
              }, shot)),
            };
            const asset: StoryAsset = {
              id,
              kind: "expression",
              name: `${parsed.packageName} · ${humanizeFileName(frameFile.name)}`,
              path: `${slugify(parsed.packageName)}/${frame.relativePath.replace(/^.*?figures\//, "").replace(/[^\w.\-/\u4e00-\u9fff]/g, "-")}`,
              aliases: [humanizeFileName(frameFile.name)],
              mimeType: frame.mimeType,
              metadata,
            };
            await saveLocalAssetFile(id, frameFile);
            setAssetUrls((items) => ({ ...items, [id]: URL.createObjectURL(frameFile) }));
            frameAssetIds.set(frame.relativePath, id);
            newAssets.push(asset);
          }

          const importedExpressions = parsed.expressions.flatMap((item) => {
            const basePath = item.files.base;
            const baseAssetId = basePath ? frameAssetIds.get(basePath) : undefined;
            if (!baseAssetId) return [];
            const supportingPaths = new Set(Object.values(item.files).filter((path): path is string => Boolean(path)));
            newAssets.forEach((asset) => {
              if (asset.metadata?.packageId !== packageId) return;
              const sourcePath = String(asset.metadata.sourceRelativePath || "");
              if (supportingPaths.has(sourcePath) && sourcePath === basePath) {
                asset.metadata = { ...asset.metadata, runtimeFrame: false, semanticRole: "expression-base" };
              }
            });
            const assetId = (role: keyof typeof item.files) => {
              const path = item.files[role];
              return path ? frameAssetIds.get(path) : undefined;
            };
            return [{
              id: createId("expr"),
              name: item.label,
              assetId: baseAssetId,
              aliases: [item.label, ...(item.pose ? [item.pose] : [])],
              tags: [item.pose, item.mouthSync ? "动嘴" : "闭嘴", item.blink === "dynamic" ? "自动眨眼" : item.blink].filter(Boolean) as string[],
              webgalAnimation: {
                mouthSync: item.mouthSync,
                blink: item.blink,
                mouthOpenAssetId: assetId("mouthOpen"),
                mouthHalfOpenAssetId: assetId("mouthHalfOpen"),
                mouthCloseAssetId: assetId("mouthClose") || baseAssetId,
                eyesOpenAssetId: assetId("eyesOpen") || baseAssetId,
                eyesCloseAssetId: item.blink === "dynamic" ? assetId("eyesClose") : undefined,
                sourcePackageId: packageId,
              },
            }];
          });
          nextCharacters = nextCharacters.map((item) => item.id === character!.id ? {
            ...item,
            expressions: [...item.expressions, ...importedExpressions],
            defaultExpressionId: item.defaultExpressionId || importedExpressions[0]?.id,
          } : item);
          setPackageSummary({
            name: parsed.packageName,
            character: character.displayName,
            expressions: importedExpressions.length,
            mouthSync: parsed.expressions.filter((item) => item.mouthSync).length,
            blink: parsed.expressions.filter((item) => item.blink === "dynamic").length,
            issues: parsed.issues,
          });
        } catch (error) {
          setUploadMessage(error instanceof Error ? error.message : `${file.name} 导入失败`);
        }
        continue;
      }
      const kind = inferAssetKind(file);
      const id = createId("asset");
      const cleanName = file.name.replace(/[^\w.\-\u4e00-\u9fff]/g, "-");
      const asset: StoryAsset = {
        id,
        kind,
        name: humanizeFileName(file.name),
        path: `${kind}/${Date.now()}-${cleanName}`,
        aliases: [humanizeFileName(file.name)],
        mimeType: file.type || undefined,
        metadata: semanticMetadata(file, kind),
      };
      if (kind === "figure" || kind === "expression") {
        asset.metadata = { ...asset.metadata, ...(await analyzeFigureFile(file)) };
        const shot = normalizeFigureShot(asset.metadata.figureShot);
        const position = shot === "full" ? "center" : "right";
        asset.metadata = {
          ...asset.metadata,
          figureFramingVersion: 2,
          ...figureLayoutMetadata(position, recommendedFigureTransform(asset, shot)),
        };
      }
      try {
        await saveLocalAssetFile(id, file);
        const url = URL.createObjectURL(file);
        setAssetUrls((items) => ({ ...items, [id]: url }));
      } catch {
        asset.metadata = { ...asset.metadata, localFile: false, storageNote: "文件未能写入浏览器本地素材库" };
      }
      newAssets.push(asset);
      if (kind === "expression" || kind === "figure") {
        const character = findCharacterForFile({ ...project, characters: nextCharacters }, file.name);
        if (character) {
          const expression = {
            id: createId("expr"),
            name: expressionName(file.name),
            assetId: id,
            aliases: [humanizeFileName(file.name)],
            tags: String(asset.metadata?.tags || "").split(/,\s*/).filter(Boolean),
          };
          nextCharacters = nextCharacters.map((item) => item.id === character.id ? {
            ...item,
            expressions: [...item.expressions, expression],
            defaultExpressionId: item.defaultExpressionId || expression.id,
          } : item);
        }
      }
    }
    onChange({ ...project, assets: [...project.assets, ...newAssets], characters: nextCharacters }, `上传 ${newAssets.length} 个素材`);
    setUploadMessage(`${newAssets.length} 个文件已加入；成品包会按 manifest 建立角色、表情、动嘴和眨眼关系，请检查下方导入报告。`);
    setUploading(false);
    event.target.value = "";
  };

  const filteredAssets = project.assets.filter((asset) => {
    if (asset.metadata?.runtimeFrame && !query && selectedAssetId !== asset.id) return false;
    if (filter !== "all" && asset.kind !== filter) return false;
    if (!query) return true;
    return [asset.name, asset.path, ...asset.aliases, ...Object.values(asset.metadata || {}).map(String)]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase());
  });

  const saveAsset = () => {
    if (!selectedAsset) return;
    const figureLike = ["figure", "expression"].includes(assetDraft.kind);
    const previousBinding = project.characters
      .flatMap((character) => character.expressions)
      .find((expression) => expression.assetId === selectedAsset.id);
    const characters = project.characters.map((character) => {
      const withoutAsset = character.expressions.filter((expression) => expression.assetId !== selectedAsset.id);
      const expression = figureLike && character.id === assetDraft.characterId
        ? {
            id: previousBinding?.id || createId("expr"),
            name: assetDraft.expressionName.trim() || assetDraft.name.trim() || selectedAsset.name,
            assetId: selectedAsset.id,
            aliases: assetDraft.aliases.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
            tags: assetDraft.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          }
        : undefined;
      const expressions = expression ? [...withoutAsset, expression] : withoutAsset;
      const currentDefaultStillExists = expressions.some((item) => item.id === character.defaultExpressionId);
      return {
        ...character,
        expressions,
        defaultExpressionId: expression && assetDraft.setAsDefault
          ? expression.id
          : currentDefaultStillExists
            ? character.defaultExpressionId
            : expressions[0]?.id,
      };
    });
    onChange({
      ...project,
      assets: project.assets.map((asset) => asset.id === selectedAsset.id ? {
        ...asset,
        name: assetDraft.name.trim() || asset.name,
        kind: assetDraft.kind,
        aliases: assetDraft.aliases.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        metadata: {
          ...asset.metadata,
          description: assetDraft.description.trim(),
          recommendedUse: assetDraft.recommendedUse.trim(),
          tags: assetDraft.tags.trim(),
          semanticReady: Boolean(assetDraft.description.trim()),
          ...(["figure", "expression"].includes(assetDraft.kind) ? {
            figureShot: normalizeFigureShot(assetDraft.figureShot),
            ...figureLayoutMetadata(assetDraft.figurePosition, {
              x: assetDraft.figureX,
              y: assetDraft.figureY,
              scale: assetDraft.figureScale,
            }),
          } : {}),
        },
      } : asset),
      characters,
    }, "编辑素材说明");
  };

  const deleteAsset = async () => {
    if (!selectedAsset) return;
    if (!window.confirm(`确认从项目中移除「${selectedAsset.name}」？相关角色差分和场景引用会同步清理。`)) return;
    if (selectedAsset.metadata?.localFile) {
      try {
        await removeLocalAssetFile(selectedAsset.id);
      } catch {
        // Metadata removal remains valid even when browser file storage is unavailable.
      }
    }
    onChange(deleteStoryAsset(project, selectedAsset.id), "移除素材");
    setSelectedAssetId(undefined);
  };

  const createCharacter = () => {
    if (!characterDraft.displayName.trim()) return;
    const character: StoryCharacter = {
      id: createId("char"),
      name: characterDraft.name.trim() || slugify(characterDraft.displayName),
      displayName: characterDraft.displayName.trim(),
      aliases: [characterDraft.displayName.trim()],
      color: "#8878d8",
      description: characterDraft.persona.trim(),
      persona: characterDraft.persona.trim(),
      expressions: [],
    };
    onChange({ ...project, characters: [...project.characters, character] }, "创建角色");
    setCharacterDraft({ displayName: "", name: "", persona: "" });
    setShowCharacter(false);
  };

  const runAssetAssistant = () => {
    const prompt = assistantPrompt.trim();
    if (!prompt) return;
    setUploadIntent(prompt);
    const mentioned = project.assets.filter((asset) => (
      prompt.toLowerCase().includes(asset.name.toLowerCase())
      || asset.aliases.some((alias) => alias && prompt.toLowerCase().includes(alias.toLowerCase()))
    ));
    setAssistantMessages((items) => [...items, { role: "user", text: prompt }]);
    setAssistantPrompt("");
    if (!mentioned.length) {
      const inventory = [
        /角色|立绘|表情/.test(prompt) ? "角色立绘与表情组" : "",
        /背景|场景/.test(prompt) ? "背景与时段" : "",
        /音乐|BGM|音效/.test(prompt) ? "音乐、音效与情绪" : "",
      ].filter(Boolean);
      setAssistantMessages((items) => [...items, {
        role: "assistant",
        text: `已记下这套整理要求${inventory.length ? `，重点是：${inventory.join("、")}` : ""}。现在没有点名已有素材，所以我没有擅自修改项目；之后即使一股脑上传 ZIP、README 和普通文件，也会沿用这段说明。`,
      }]);
      return;
    }
    const cueTags = ["白天", "夜晚", "雨", "雪", "温柔", "紧张", "悲伤", "开心", "默认", "关键演出"].filter((tag) => prompt.includes(tag));
    const next = {
      ...project,
      assets: project.assets.map((asset) => {
        if (!mentioned.some((item) => item.id === asset.id)) return asset;
        const previousTags = String(asset.metadata?.tags || "").split(/[,，]\s*/).filter(Boolean);
        return {
          ...asset,
          metadata: {
            ...asset.metadata,
            recommendedUse: prompt,
            tags: [...new Set([...previousTags, ...cueTags])].join(", "),
            semanticReady: true,
            lastOrganizedBy: "resource-assistant",
          },
        };
      }),
    };
    onChange(next, `素材助理整理 ${mentioned.length} 项`, "system");
    setAssistantMessages((items) => [...items, {
      role: "assistant",
      text: `已把这段用途说明写入：${mentioned.map((asset) => asset.name).join("、")}。本次只改了点名素材，右上角或这里的“撤销本次整理”都能恢复。`,
    }]);
  };

  const semanticCount = project.assets.filter((asset) => asset.metadata?.description).length;
  const availableCount = project.assets.filter((asset) => !asset.missing).length;
  const kindFilters: Array<"all" | AssetKind> = ["all", "background", "figure", "expression", "bgm", "voice", "sfx", "video", "animation", "ui"];
  const selectedAssetUrl = resolveRegisteredAssetUrl(selectedAsset, assetUrls);
  const selectedExpressionBinding = project.characters
    .flatMap((character) => character.expressions.map((expression) => ({ character, expression })))
    .find((item) => item.expression.assetId === selectedAsset?.id);
  const stageBackground = project.assets.find((asset) => asset.kind === "background" && !asset.missing);
  const stageBackgroundUrl = resolveRegisteredAssetUrl(stageBackground, assetUrls);
  const draftFigureTransform = {
    x: assetDraft.figureX,
    y: assetDraft.figureY,
    scale: assetDraft.figureScale,
  };

  return (
    <div className="simple-assets">
      <header className="simple-page-heading">
        <div>
          <span className="simple-kicker">RESOURCE LIBRARY · WebGAL 原生资源</span>
          <h1>管理剧情素材</h1>
          <p>可上传普通素材，也可整包导入立绘 Skill 的 deliverables ZIP；系统会读取 manifest，而不是靠文件名猜嘴型和眨眼。</p>
        </div>
        <div className="simple-heading-actions">
          <button className="soft-button" onClick={() => setShowCharacter(true)}><UserRound size={15} /> 新角色</button>
          <button className="simple-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}><UploadCloud size={16} /> {uploading ? "正在整理…" : "上传素材"}</button>
          <input ref={fileInputRef} type="file" multiple hidden accept="image/*,audio/*,video/*,.json,.zip,application/zip" onChange={handleFiles} />
        </div>
      </header>

      <section className="asset-assistant">
        <header>
          <div><span><Sparkles size={15} /> 素材助理</span><strong>没有上传文件也可以先聊怎么整理</strong><p>当前部署未绑定模型 Provider；对话规划可直接使用，点名已有素材时执行透明的确定性整理，每次都可撤销。</p></div>
          <div><button className="soft-button" onClick={onUndo} disabled={!canUndo}><Undo2 size={14} /> 撤销本次整理</button><button className="simple-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}><UploadCloud size={15} /> 上传文件 / ZIP</button></div>
        </header>
        <div className="asset-assistant__messages">
          {assistantMessages.slice(-5).map((message, index) => <p className={`is-${message.role}`} key={`${message.role}-${index}`}><b>{message.role === "assistant" ? "助理" : "你"}</b><span>{message.text}</span></p>)}
        </div>
        <div className="asset-assistant__compose">
          <textarea value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runAssetAssistant();
          }} placeholder="例如：把“爱丽丝 标准姿势 normal”作为默认日常立绘，Q 版只用于搞笑；以后上传的茶室背景按白天/夜晚分组。" rows={3} />
          <button onClick={runAssetAssistant} disabled={!assistantPrompt.trim()}><Send size={15} /><span>提交整理要求<small>Ctrl / ⌘ + Enter</small></span></button>
        </div>
      </section>

      {packageSummary && (
        <section className={`sprite-package-report ${packageSummary.issues.length ? "has-issues" : "is-ready"}`}>
          <div>
            <span>WEBGAL SPRITE PACKAGE</span>
            <strong>{packageSummary.name} → {packageSummary.character}</strong>
          </div>
          <dl>
            <div><dt>可选表情</dt><dd>{packageSummary.expressions}</dd></div>
            <div><dt>说话动嘴</dt><dd>{packageSummary.mouthSync}</dd></div>
            <div><dt>自动眨眼</dt><dd>{packageSummary.blink}</dd></div>
            <div><dt>检查结果</dt><dd>{packageSummary.issues.length ? `${packageSummary.issues.length} 项待处理` : "可直接编译"}</dd></div>
          </dl>
          {packageSummary.issues.length > 0 && <p>{packageSummary.issues.join(" · ")}</p>}
        </section>
      )}

      <div className="asset-library-summary">
        <span><FolderHeart size={15} /><strong>{availableCount}</strong> 个可用素材</span>
        <span><Sparkles size={15} /><strong>{semanticCount}</strong> 个已填写使用说明</span>
        <span><UsersRound size={15} /><strong>{project.characters.length}</strong> 个角色档案</span>
        {!project.assets.some((asset) => asset.kind === "bgm") && <span className="is-empty"><FileAudio size={15} /> BGM 为空，不会自动补假音乐</span>}
      </div>

      <details className="builtin-performance-library">
        <summary><Film size={14} /><strong>内置 WebGAL 演出库</strong><span>{WEBGAL_ANIMATION_PRESETS.length} 个默认效果，AI 可直接调用，不需要你上传</span><ChevronDown size={14} /></summary>
        <div>{WEBGAL_ANIMATION_PRESETS.map((preset) => <button key={preset.name} onClick={() => copyText(preset.name)} title="点击复制效果名"><Copy size={11} /><span>{preset.label}</span><small>{preset.category} · {preset.durationMs}ms</small></button>)}</div>
      </details>

      <section className="character-library-strip">
        <div className="character-library-title"><span>角色与表情组</span><small>ZIP 按 webgal-manifest.json 建立关系；普通图片才使用名称辅助归类</small></div>
        <div>
          {project.characters.map((character) => (
            <article key={character.id} style={{ "--character-color": character.color } as React.CSSProperties}>
              <span className="character-letter">{character.displayName.slice(0, 1)}</span>
              <div><button className="copyable-name" onClick={() => copyText(character.displayName)} title="点击复制角色名"><strong>{character.displayName}</strong><Copy size={11} /></button><small>{character.expressions.length} 个表情 · {character.expressions.filter((item) => item.webgalAnimation?.mouthSync).length} 个可动嘴 · {character.expressions.filter((item) => item.webgalAnimation?.blink === "dynamic").length} 个可眨眼</small></div>
              <div className="character-expression-pills">
                {character.expressions.slice(0, 4).map((expression) => <span key={expression.id}>{expression.name}</span>)}
                {character.expressions.length > 4 && <b>+{character.expressions.length - 4}</b>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="asset-library-toolbar">
        <div className="asset-kind-tabs">
          {kindFilters.map((kind) => (
            <button key={kind} className={filter === kind ? "active" : ""} onClick={() => setFilter(kind)}>
              {kind === "all" ? "全部" : assetKindLabels[kind]}<span>{kind === "all" ? project.assets.length : project.assets.filter((asset) => asset.kind === kind).length}</span>
            </button>
          ))}
        </div>
        <label className="asset-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索地点、情绪、角色或用途…" /></label>
      </div>
      {uploadMessage && <div className="upload-success"><Check size={15} />{uploadMessage}</div>}

      <div className={`asset-library-layout ${selectedAsset ? "has-inspector" : ""}`} style={selectedAsset ? { gridTemplateColumns: `minmax(0, 1fr) 8px ${assetPane.width}px` } : undefined}>
        <main className="semantic-asset-grid">
          {filteredAssets.map((asset) => {
            const description = String(asset.metadata?.description || "还没有说明。点击卡片记录它适合在什么时候使用。");
            const tags = String(asset.metadata?.tags || "").split(/,\s*/).filter(Boolean);
            const url = resolveRegisteredAssetUrl(asset, assetUrls);
            return (
              <button key={asset.id} className={`semantic-asset-card ${selectedAssetId === asset.id ? "active" : ""}`} onClick={() => openAsset(asset)}>
                <div
                  className={`semantic-asset-visual kind-${asset.kind}`}
                  style={url && asset.mimeType?.startsWith("image/") ? { backgroundImage: `url("${url}")` } : undefined}
                >
                  {!url && (["bgm", "voice", "sfx"].includes(asset.kind) ? <FileAudio size={24} /> : asset.kind === "video" ? <Film size={24} /> : <ImageIcon size={24} />)}
                  <span>{assetKindLabels[asset.kind]}</span>
                  {asset.metadata?.semanticReady && <b><Check size={11} /> 说明完整</b>}
                </div>
                <div className="semantic-asset-content">
                  <strong className="copyable-asset-name" role="button" tabIndex={0} title="点击复制素材名" onClick={(event) => { event.stopPropagation(); copyText(asset.name); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); copyText(asset.name); } }}>{asset.name}<Copy size={11} /></strong>
                  <p>{description}</p>
                  <div>{tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
                </div>
              </button>
            );
          })}
          {!filteredAssets.length && (
            <button className="asset-upload-empty" onClick={() => fileInputRef.current?.click()}>
              <UploadCloud size={28} />
              <strong>把素材拖进你的故事工房</strong>
              <p>支持背景、立绘、表情差分、BGM、语音、音效、视频与动画 JSON。</p>
            </button>
          )}
        </main>
        {selectedAsset && <SplitGrip onPointerDown={(event) => assetPane.startResize(event, "right")} label="拖动调整素材库与设置面板宽度" />}
        {selectedAsset && (
          <aside className="asset-semantic-inspector">
            <header><div><span>素材设置</span><strong>说明、绑定与默认演出</strong></div><button onClick={() => setSelectedAssetId(undefined)}><X size={16} /></button></header>
            {(["figure", "expression"].includes(assetDraft.kind)) ? (
              <FigureStageEditor
                asset={selectedAsset}
                assetUrl={selectedAssetUrl}
                backgroundUrl={stageBackgroundUrl}
                characterName={assetDraft.name || selectedAsset.name}
                position={assetDraft.figurePosition}
                transform={draftFigureTransform}
                shot={normalizeFigureShot(assetDraft.figureShot)}
                onCommit={(layout) => setAssetDraft((current) => ({
                  ...current,
                  figurePosition: layout.position,
                  figureX: layout.transform.x ?? 0,
                  figureY: layout.transform.y ?? 0,
                  figureScale: layout.transform.scale ?? 1,
                  figureShot: figureShotFromTransform(layout.transform, selectedAsset),
                }))}
                onReset={() => {
                  const recommendedShot = inferFigureShot(selectedAsset);
                  const recommended = recommendedFigureTransform(selectedAsset, recommendedShot);
                  setAssetDraft((current) => ({
                    ...current,
                    figurePosition: recommendedShot === "full" ? "center" : "right",
                    figureShot: recommendedShot,
                    figureX: 0,
                    figureY: recommended.y ?? 0,
                    figureScale: recommended.scale ?? 1,
                  }));
                }}
              />
            ) : (
              <div className={`asset-inspector-preview kind-${selectedAsset.kind}`} style={selectedAssetUrl && selectedAsset.mimeType?.startsWith("image/") ? { backgroundImage: `url("${selectedAssetUrl}")` } : undefined}>
                {!selectedAssetUrl && <Palette size={30} />}
                <span>{assetKindLabels[selectedAsset.kind]}</span>
              </div>
            )}
            {selectedAssetUrl && selectedAsset.mimeType?.startsWith("audio/") && <audio controls src={selectedAssetUrl} />}
            {selectedExpressionBinding?.expression.webgalAnimation && (
              <div className="webgal-animation-status">
                <strong>WebGAL 原生动态差分</strong>
                <span className={selectedExpressionBinding.expression.webgalAnimation.mouthSync ? "is-on" : ""}>
                  {selectedExpressionBinding.expression.webgalAnimation.mouthSync ? "说话时动嘴" : "静态嘴型"}
                </span>
                <span className={selectedExpressionBinding.expression.webgalAnimation.blink === "dynamic" ? "is-on" : ""}>
                  {selectedExpressionBinding.expression.webgalAnimation.blink === "dynamic" ? "随机自动眨眼" : selectedExpressionBinding.expression.webgalAnimation.blink === "fixed-closed" ? "固定闭眼（不眨眼）" : "静态眼睛"}
                </span>
                <small>对白会自动带 figureId；有语音时按音量驱动，没有语音时由 WebGAL 模拟嘴型。</small>
              </div>
            )}
            <label>显示名称<input value={assetDraft.name} onChange={(event) => setAssetDraft({ ...assetDraft, name: event.target.value })} /></label>
            <label>素材类型
              <select value={assetDraft.kind} onChange={(event) => setAssetDraft({ ...assetDraft, kind: event.target.value as AssetKind })}>
                {Object.entries(assetKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
              </select>
            </label>
            <label>自然语言说明<textarea rows={5} value={assetDraft.description} onChange={(event) => setAssetDraft({ ...assetDraft, description: event.target.value })} placeholder="例如：爱丽丝轻微开心，嘴角上扬但没有笑出声，适合重逢或温和回应，不适合强烈兴奋。" /></label>
            <label>推荐怎么用<textarea rows={3} value={assetDraft.recommendedUse} onChange={(event) => setAssetDraft({ ...assetDraft, recommendedUse: event.target.value })} placeholder="适合什么场景，不适合什么场景…" /></label>
            {(["figure", "expression"].includes(assetDraft.kind)) && (
              <>
                <div className="figure-binding-fields">
                  <label>绑定角色
                    <select value={assetDraft.characterId} onChange={(event) => setAssetDraft({
                      ...assetDraft,
                      characterId: event.target.value,
                    })}>
                      <option value="">暂不绑定</option>
                      {project.characters.map((character) => <option key={character.id} value={character.id}>{character.displayName}</option>)}
                    </select>
                  </label>
                  <label>差分名称
                    <input value={assetDraft.expressionName} onChange={(event) => setAssetDraft({
                      ...assetDraft,
                      expressionName: event.target.value,
                    })} placeholder="例如：平静微笑" />
                  </label>
                  <label className="figure-default-check">
                    <input type="checkbox" checked={assetDraft.setAsDefault} onChange={(event) => setAssetDraft({
                      ...assetDraft,
                      setAsDefault: event.target.checked,
                    })} />
                    作为角色默认立绘
                  </label>
                </div>
                <div className="figure-framing-summary">
                  <strong>默认演出会被生成器直接继承</strong>
                  <p>上面的画面就是该素材第一次入场时的默认构图；片段里仍可单独覆盖，不必手写坐标。</p>
                  <span>{assetDraft.figurePosition === "left" ? "左侧" : assetDraft.figurePosition === "center" ? "中央" : "右侧"} · {FIGURE_SHOT_LABELS[normalizeFigureShot(assetDraft.figureShot)]} · {assetDraft.figureScale.toFixed(2)}×</span>
                </div>
              </>
            )}
            <label>标签<input value={assetDraft.tags} onChange={(event) => setAssetDraft({ ...assetDraft, tags: event.target.value })} placeholder="夜晚, 茶室, 安静, 轻微担心" /></label>
            <label>别名<input value={assetDraft.aliases} onChange={(event) => setAssetDraft({ ...assetDraft, aliases: event.target.value })} /></label>
            <div className="asset-ai-reading">
              <Bot size={17} />
              <p><strong>本地规则与未来 AI 会同时读取</strong>名称、说明、推荐用途、标签和角色档案；匹配不确定时应提示，不会编造素材。</p>
            </div>
            <div className="asset-inspector-actions">
              <button className="asset-delete" onClick={deleteAsset}><Trash2 size={14} /> 移除</button>
              <button className="simple-primary inspector-save" onClick={saveAsset}><Check size={15} /> 保存素材设置</button>
            </div>
          </aside>
        )}
      </div>

      {showCharacter && (
        <div className="simple-dialog-backdrop">
          <div className="simple-dialog">
            <header><div><span>CHARACTER PROFILE</span><h3>新建角色档案</h3></div><button onClick={() => setShowCharacter(false)}><X size={17} /></button></header>
            <label>角色名<input value={characterDraft.displayName} onChange={(event) => setCharacterDraft({ ...characterDraft, displayName: event.target.value })} placeholder="爱丽丝" /></label>
            <label>英文 / 内部名<input value={characterDraft.name} onChange={(event) => setCharacterDraft({ ...characterDraft, name: event.target.value })} placeholder="Alice（可选）" /></label>
            <label>人物性格与说话方式<textarea rows={5} value={characterDraft.persona} onChange={(event) => setCharacterDraft({ ...characterDraft, persona: event.target.value })} placeholder="优雅、温柔，偶尔用轻微吐槽掩饰担心；称呼浅仪式为主人。" /></label>
            <p>创建后，上传文件名中带有角色名的立绘和表情会自动归入这个角色。</p>
            <footer><button onClick={() => setShowCharacter(false)}>取消</button><button className="simple-primary" onClick={createCharacter}>创建角色</button></footer>
          </div>
        </div>
      )}
    </div>
  );
}

type PreviewWorkspaceProps = Pick<Props, "project" | "selectedSceneId" | "onSelectScene" | "onChange" | "onAdvanced"> & {
  onExitPreview: () => void;
};

const stageActionLabels: Record<Extract<StoryBlock, { type: "stage" }>["action"], string> = {
  "set-background": "切换背景",
  "play-bgm": "播放 BGM",
  "stop-bgm": "停止 BGM",
  "play-sfx": "播放音效",
  "play-video": "播放视频",
  "enter-character": "角色入场",
  "exit-character": "角色退场",
  "move-character": "移动角色",
  "set-expression": "切换差分",
  "clear-stage": "清空舞台",
  transition: "转场演出",
  wait: "等待",
};

function PreviewBlockEditor({
  block,
  index,
  project,
  previousChoice,
  assetUrls,
  backgroundUrl,
  onCommit,
  onGenerateVoice,
  generatingVoice,
}: {
  block: StoryBlock;
  index: number;
  project: StoryProject;
  previousChoice?: Extract<StoryBlock, { type: "choice" }>;
  assetUrls: Record<string, string>;
  backgroundUrl?: string;
  onCommit: (block: StoryBlock) => void;
  onGenerateVoice?: (block: Extract<StoryBlock, { type: "dialogue" }>) => void;
  generatingVoice?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reactionOptionId, setReactionOptionId] = useState<string>("");
  const character = block.type === "dialogue"
    ? project.characters.find((item) => item.id === block.characterId)
    : block.type === "stage" && block.characterId
      ? project.characters.find((item) => item.id === block.characterId)
      : undefined;
  const asset = block.type === "stage" && block.assetId
    ? project.assets.find((item) => item.id === block.assetId)
    : undefined;
  const targetScene = block.type === "jump" && block.targetSceneId
    ? project.scenes.find((item) => item.id === block.targetSceneId)
    : undefined;
  const continueOptions = previousChoice?.options.filter((option) => !option.targetBlockId && !option.targetSceneId && !option.targetRouteNodeId && !option.targetChoiceGroupId && !option.endScene) || [];
  const activeReaction = block.type === "dialogue" && reactionOptionId
    ? block.choiceReactions?.find((item) => item.choiceBlockId === previousChoice?.id && item.optionId === reactionOptionId)
    : undefined;
  const activeCharacterId = block.type === "dialogue" ? activeReaction?.characterId || block.characterId : undefined;
  const activeCharacter = project.characters.find((item) => item.id === activeCharacterId);
  const activeExpressionId = block.type === "dialogue" ? activeReaction?.expressionId || block.expressionId || activeCharacter?.defaultExpressionId : undefined;
  const activeExpression = activeCharacter?.expressions.find((item) => item.id === activeExpressionId);
  const activeAsset = project.assets.find((item) => item.id === activeExpression?.assetId);
  const activeAssetUrl = resolveRegisteredAssetUrl(activeAsset, assetUrls);
  const activePosition = block.type === "dialogue" ? activeReaction?.position || block.position || assetDefaultPosition(activeAsset) : "center";
  const activeTransform = block.type === "dialogue" ? activeReaction?.transform || block.transform || assetDefaultTransform(activeAsset) : {};

  const updateDialogueVariant = (patch: Partial<Extract<StoryBlock, { type: "dialogue" }>> & { text?: string }) => {
    if (block.type !== "dialogue") return;
    if (!reactionOptionId || !previousChoice) {
      onCommit({ ...block, ...patch });
      return;
    }
    const existing = block.choiceReactions || [];
    const current = existing.find((item) => item.choiceBlockId === previousChoice.id && item.optionId === reactionOptionId);
    const reaction = {
      choiceBlockId: previousChoice.id,
      optionId: reactionOptionId,
      text: patch.text ?? current?.text ?? block.text,
      characterId: patch.characterId ?? current?.characterId,
      expressionId: patch.expressionId ?? current?.expressionId,
      position: patch.position ?? current?.position,
      transform: patch.transform ?? current?.transform,
    };
    onCommit({
      ...block,
      choiceReactions: current
        ? existing.map((item) => item.choiceBlockId === previousChoice.id && item.optionId === reactionOptionId ? reaction : item)
        : [...existing, reaction],
    });
  };

  return (
    <article className={`preview-block-card preview-block-card--${block.type}`}>
      <header>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <strong>
          {block.type === "dialogue" && (character?.displayName || "角色对白")}
          {block.type === "narration" && "旁白"}
          {block.type === "stage" && stageActionLabels[block.action]}
          {block.type === "choice" && "玩家选择"}
          {block.type === "jump" && "片段跳转"}
          {block.type === "condition" && "条件分支"}
          {block.type === "input" && "玩家输入"}
          {block.type === "variable" && "变量更新"}
          {block.type === "mode" && "文本模式"}
          {block.type === "save-point" && "存档点"}
          {block.type === "blog-action" && "Blog 动作"}
          {block.type === "ai-turn" && "AI 交互"}
          {block.type === "comment" && "编剧备注"}
        </strong>
        <small>{block.type}</small>
        {(block.type === "dialogue" || block.type === "choice") && <button className="preview-block-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开编辑"}<ChevronDown size={12} /></button>}
      </header>
      {block.type === "dialogue" && continueOptions.length > 0 && (
        <div className="dialogue-reaction-tabs">
          <span>上一组选项的下一句反应</span>
          <button className={!reactionOptionId ? "active" : ""} onClick={() => setReactionOptionId("")}>默认台词</button>
          {continueOptions.map((option) => <button key={option.id} className={reactionOptionId === option.id ? "active" : ""} onClick={() => { setReactionOptionId(option.id); setExpanded(true); }}>{option.label}{block.choiceReactions?.some((item) => item.choiceBlockId === previousChoice?.id && item.optionId === option.id) ? <Check size={10} /> : <Plus size={10} />}</button>)}
        </div>
      )}
      {(block.type === "dialogue" || block.type === "narration") && (
        <textarea
          key={`${block.id}:${reactionOptionId}:${activeReaction?.text || block.text}`}
          defaultValue={block.type === "dialogue" && reactionOptionId ? activeReaction?.text || "" : block.text}
          rows={3}
          aria-label={`${index + 1} ${block.type === "dialogue" ? "对白" : "旁白"}`}
          onBlur={(event) => {
            const text = event.currentTarget.value.trim();
            if (block.type === "dialogue" && reactionOptionId) {
              if (text) updateDialogueVariant({ text });
            } else if (text !== block.text) onCommit({ ...block, text });
          }}
          placeholder={block.type === "dialogue" && reactionOptionId ? "留空表示沿用默认台词；填写后只影响刚才选择这个选项的玩家。" : undefined}
        />
      )}
      {block.type === "dialogue" && expanded && (
        <div className="line-performance-editor">
          <div className="line-performance-fields">
            <label>这一句的角色<select value={activeCharacterId || ""} onChange={(event) => updateDialogueVariant({ characterId: event.target.value, expressionId: undefined })}>{project.characters.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
            <label>表情 / 动态立绘<select value={activeExpressionId || ""} onChange={(event) => updateDialogueVariant({ expressionId: event.target.value || undefined })}><option value="">角色默认</option>{activeCharacter?.expressions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
          <FigureStageEditor
            asset={activeAsset}
            assetUrl={activeAssetUrl}
            backgroundUrl={backgroundUrl}
            characterName={activeCharacter?.displayName || "当前角色"}
            position={activePosition as StagePosition}
            transform={activeTransform}
            shot={figureShotFromTransform(activeTransform, activeAsset)}
            onCommit={(layout) => updateDialogueVariant({ expressionId: activeExpressionId, position: layout.position, transform: layout.transform })}
            onReset={() => updateDialogueVariant({ position: assetDefaultPosition(activeAsset), transform: assetDefaultTransform(activeAsset) })}
            compact
          />
          <p>这里改的是这一句实际出现时的构图；资源页仍保存角色默认值。选项反应可以只改台词，也可以同时换表情、站位和镜头。</p>
        </div>
      )}
      {block.type === "dialogue" && (
        <div className="preview-voice-row">
          <span>{block.voiceAssetId ? <><Check size={12} /> 已绑定语音</> : "未绑定语音；无语音时 WebGAL 仍会模拟嘴型"}</span>
          <button onClick={() => onGenerateVoice?.(block)} disabled={generatingVoice}>
            <FileAudio size={13} /> {generatingVoice ? "正在生成…" : "一键生成 TTS"}
          </button>
        </div>
      )}
      {block.type === "choice" && (
        <div className="preview-choice-editor">
          {block.prompt && <p>{block.groupCode || `Q${index + 1}`} · {block.prompt}</p>}
          {block.options.map((option, optionIndex) => (
            <label key={option.id}>
              <span>{optionIndex + 1}</span>
              <input
                key={`${option.id}:${option.label}`}
                defaultValue={option.label}
                aria-label={`选项 ${optionIndex + 1}`}
                onBlur={(event) => {
                  const label = event.currentTarget.value.trim();
                  if (!label || label === option.label) return;
                  onCommit({
                    ...block,
                    options: block.options.map((item) => item.id === option.id ? { ...item, label } : item),
                  });
                }}
              />
              {expanded && <small>{option.targetChoiceGroupId ? `跳到选项组 ${option.targetChoiceGroupId}` : option.endScene ? "结束片段并按地图继续" : "继续本片段；可影响下一句"}{option.recordId ? ` · 写入记录` : ""}</small>}
            </label>
          ))}
        </div>
      )}
      {block.type === "stage" && (
        <p className="preview-block-summary">
          {character?.displayName || asset?.name || block.transition?.name || "按片段舞台状态执行"}
          {block.position ? ` · ${block.position}` : ""}
        </p>
      )}
      {block.type === "jump" && (
        <p className="preview-block-summary">
          {targetScene ? `前往「${targetScene.name}」` : block.targetBlockId ? "返回片段内指定位置" : "等待设置目标"}
        </p>
      )}
      {block.type === "condition" && (
        <p className="preview-block-summary">{block.branches.length} 条条件路线</p>
      )}
      {block.type === "input" && (
        <p className="preview-block-summary">{block.title}</p>
      )}
    </article>
  );
}

function SimplePreviewWorkspace({
  project,
  selectedSceneId,
  onSelectScene,
  onChange,
  onAdvanced,
  onExitPreview,
}: PreviewWorkspaceProps) {
  const scene = project.scenes.find((item) => item.id === selectedSceneId) || project.scenes[0];
  const previewAssetUrls = useProjectAssetUrls(project);
  const previewBackground = project.assets.find((asset) => asset.id === scene?.entryStage?.backgroundAssetId)
    || project.assets.find((asset) => asset.kind === "background");
  const previewBackgroundUrl = resolveRegisteredAssetUrl(previewBackground, previewAssetUrls);
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<DirectorDraft>();
  const [revisionLog, setRevisionLog] = useState<string[]>([]);
  const [restartKey, setRestartKey] = useState(0);
  const [generatingVoiceId, setGeneratingVoiceId] = useState<string>();
  const [ttsMessage, setTtsMessage] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [webgalUrl, setWebgalUrl] = useState("");
  const [webgalStatus, setWebgalStatus] = useState("正在编译 WebGAL 实机…");
  const [webgalWarnings, setWebgalWarnings] = useState<string[]>([]);
  const previewPane = useResizablePane("gal-preview-editor-width-v2", 390, 360, 760);
  const stageCardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!scene) return;
    queueMicrotask(() => {
      if (cancelled) return;
      setWebgalStatus("正在编译 WebGAL 实机…");
      setWebgalUrl("");
    });
    void prepareWebGalPreview(project, scene.id).then((prepared) => {
      if (cancelled) return;
      setWebgalUrl(prepared.url);
      setWebgalWarnings(prepared.warnings);
      setWebgalStatus("WebGAL 实机已就绪");
    }).catch((error) => {
      if (cancelled) return;
      setWebgalStatus(error instanceof Error ? error.message : "WebGAL 实机预览准备失败");
    });
    return () => { cancelled = true; };
  }, [project, restartKey, scene]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === stageCardRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === stageCardRef.current) {
        await document.exitFullscreen?.();
        return;
      }
      await stageCardRef.current?.requestFullscreen?.();
    } catch {
      setFocusMode(true);
    }
  };

  const updateBlock = (nextBlock: StoryBlock) => {
    if (!scene) return;
    const currentBlock = scene.blocks.find((block) => block.id === nextBlock.id);
    if (!currentBlock || JSON.stringify(currentBlock) === JSON.stringify(nextBlock)) return;
    onChange({
      ...project,
      scenes: project.scenes.map((item) => (
        item.id === scene.id
          ? { ...item, blocks: item.blocks.map((block) => block.id === nextBlock.id ? nextBlock : block) }
          : item
      )),
      updatedAt: nowIso(),
    }, `编辑「${scene.name}」的片段内容`);
    setRestartKey((value) => value + 1);
  };

  const revise = () => {
    if (!scene || !instruction.trim()) return;
    const draft = reviseSceneWithInstruction(project, scene.id, instruction);
    onChange(draft.project, `本地规则修订「${scene.name}」`, "system");
    setResult(draft);
    setRevisionLog((items) => [instruction.trim(), ...items].slice(0, 6));
    setInstruction("");
  };

  const generateVoice = async (block: Extract<StoryBlock, { type: "dialogue" }>) => {
    if (!scene) return;
    setGeneratingVoiceId(block.id);
    setTtsMessage("");
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: block.text }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: "TTS Provider 调用失败" })) as { error?: string };
        throw new Error(result.error || "TTS Provider 调用失败");
      }
      const blob = await response.blob();
      const assetId = createId("voice");
      const file = new File([blob], `${slugify(scene.name)}-${block.id}.mp3`, { type: blob.type || "audio/mpeg" });
      await saveLocalAssetFile(assetId, file);
      const voiceAsset: StoryAsset = {
        id: assetId,
        kind: "voice",
        name: `${scene.name} · ${block.text.slice(0, 18)}`,
        path: `generated-voice/${assetId}.mp3`,
        aliases: [block.text.slice(0, 18)],
        mimeType: file.type,
        metadata: {
          localFile: true,
          generatedBy: "tts-provider",
          description: `对白「${block.text}」的 TTS 语音。`,
          semanticReady: true,
        },
      };
      onChange({
        ...project,
        assets: [...project.assets, voiceAsset],
        scenes: project.scenes.map((item) => item.id === scene.id ? {
          ...item,
          blocks: item.blocks.map((itemBlock) => itemBlock.id === block.id && itemBlock.type === "dialogue"
            ? { ...itemBlock, voiceAssetId: assetId }
            : itemBlock),
        } : item),
        updatedAt: nowIso(),
      }, `为「${scene.name}」生成 TTS 语音`, "ai");
      setTtsMessage("语音已生成并绑定；WebGAL 会按真实音量驱动嘴型。 ");
      setRestartKey((value) => value + 1);
    } catch (error) {
      setTtsMessage(error instanceof Error ? error.message : "TTS 生成失败");
    } finally {
      setGeneratingVoiceId(undefined);
    }
  };

  const quickInstructions = ["让爱丽丝的语气更温柔", "把节奏放慢一些", "切换为 Q 版立绘", "结尾增加三个选项"];

  return (
    <div className={`simple-preview-page ${focusMode ? "is-focus-mode" : ""}`}>
      <header className="preview-workbench-header">
        <div className="preview-workbench-title">
          <button className="preview-icon-button" onClick={onExitPreview} title="返回故事地图" aria-label="返回故事地图">
            <ArrowLeft size={17} />
          </button>
          <div>
            <span>实时试玩</span>
            <strong>{scene?.name || "当前片段"}</strong>
          </div>
        </div>
        <div className="preview-workbench-actions">
          <button className={!focusMode ? "active" : ""} onClick={() => setFocusMode(false)}>
            <PanelLeftOpen size={15} /> 编辑 + 实机
          </button>
          <button className={focusMode ? "active" : ""} onClick={() => setFocusMode(true)}>
            <PanelLeftClose size={15} /> 专注试玩
          </button>
          <button onClick={() => onAdvanced("story")}><Settings2 size={15} /> 细节编辑</button>
        </div>
      </header>
      <div className="preview-scene-strip" aria-label="选择要试玩的剧情片段">
        {project.scenes.map((item, index) => (
          <button key={item.id} className={item.id === scene?.id ? "active" : ""} onClick={() => {
            onSelectScene(item.id);
            setRestartKey((value) => value + 1);
            setInstruction("");
            setResult(undefined);
          }}>
            <small>{String(index + 1).padStart(2, "0")}</small><span>{item.name}</span><Play size={13} />
          </button>
        ))}
      </div>
      {scene && (
        <div className="simple-preview-layout" style={{ gridTemplateColumns: focusMode ? "minmax(0, 1fr)" : `${previewPane.width}px 8px minmax(680px, 1fr)` }}>
          <aside className="preview-editor-panel">
            <section className="preview-block-editor">
              <header>
                <div><span>当前片段</span><strong>{scene.name}</strong></div>
                <small>{scene.blocks.length} 个内容块</small>
              </header>
              <div className="preview-block-list">
                {scene.blocks.map((block, index) => (
                  <PreviewBlockEditor
                    key={block.id}
                    block={block}
                    index={index}
                    project={project}
                    previousChoice={precedingChoice(scene.blocks, index)}
                    assetUrls={previewAssetUrls}
                    backgroundUrl={previewBackgroundUrl}
                    onCommit={updateBlock}
                    onGenerateVoice={generateVoice}
                    generatingVoice={generatingVoiceId === block.id}
                  />
                ))}
                {ttsMessage && <p className="preview-tts-message">{ttsMessage}</p>}
                {!scene.blocks.length && <p className="preview-block-empty">这个片段还是空的。回到故事地图，用一句话生成内容。</p>}
              </div>
            </section>
            <section className="revision-panel">
              <header>
                <span className="revision-avatar"><Sparkles size={18} /></span>
                <div><strong>演出修订</strong><p>只修改当前片段，其他片段和路线保持不动。</p></div>
              </header>
              <label className="revision-compose">
                <span>哪里需要调整？</span>
                <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：让爱丽丝站在右侧，用腰上镜头；语气更温柔。" />
              </label>
              <div className="revision-quick">
                {quickInstructions.map((item) => <button key={item} onClick={() => setInstruction(item)}>{item}</button>)}
              </div>
              <button className="revision-submit" onClick={revise} disabled={!instruction.trim()}><WandSparkles size={16} /> 运行本地规则修订（非 AI） <ChevronRight size={17} /></button>
              {result && <DirectorResultCard result={result} />}
              {revisionLog.length > 0 && (
                <div className="revision-history">
                  <strong>这次试玩的修改</strong>
                  {revisionLog.map((item, index) => <p key={`${item}-${index}`}><span>{index + 1}</span>{item}</p>)}
                </div>
              )}
            </section>
          </aside>
          {!focusMode && <SplitGrip onPointerDown={(event) => previewPane.startResize(event, "left")} label="拖动调整逐句编辑与实机画面宽度" />}
          <main className="play-stage-card" ref={stageCardRef}>
            <div className="play-stage-heading">
              <div><span>{project.chapters.find((chapter) => chapter.id === scene.chapterId)?.name}</span><strong>{scene.name}</strong></div>
              <div className="play-stage-actions">
                <button className="soft-button" onClick={() => setRestartKey((value) => value + 1)}>
                  <RotateCcw size={14} /> 从本段开头重播
                </button>
                <button className="stage-fullscreen-button" onClick={() => void toggleFullscreen()}>
                  <Maximize2 size={15} /> {fullscreen ? "退出全屏" : "全屏试玩"}
                </button>
              </div>
            </div>
            <div className="webgal-live-stage">
              {webgalUrl ? <iframe src={webgalUrl} title={`WebGAL 实机 · ${scene.name}`} allow="autoplay; fullscreen" /> : <div className="webgal-live-stage__loading"><Gamepad2 size={28} /><strong>{webgalStatus}</strong><span>试玩使用当前 Story IR 编译出的 WebGAL 工程。</span></div>}
            </div>
            {webgalWarnings.length > 0 && <p className="webgal-preview-warning">{webgalWarnings.join(" · ")}</p>}
          </main>
        </div>
      )}
    </div>
  );
}

type CreationDialogProps = {
  kind: "scene" | "chapter";
  project: StoryProject;
  selectedSceneId: string;
  onClose: () => void;
  onCreateScene: (draft: { name: string; chapterId: string; summary: string }) => void;
  onCreateChapter: (draft: { name: string; description: string }) => void;
};

function CreationDialog({ kind, project, selectedSceneId, onClose, onCreateScene, onCreateChapter }: CreationDialogProps) {
  const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId);
  const [sceneDraft, setSceneDraft] = useState({
    name: `新片段 ${project.scenes.length + 1}`,
    chapterId: selectedScene?.chapterId || project.chapters[0]?.id || "",
    summary: "",
  });
  const [chapterDraft, setChapterDraft] = useState({ name: `章节 ${project.chapters.length + 1}`, description: "" });
  return (
    <div className="simple-dialog-backdrop">
      <div className="simple-dialog">
        <header>
          <div><span>{kind === "scene" ? "NEW STORY FRAGMENT" : "NEW CHAPTER"}</span><h3>{kind === "scene" ? "新增一小段游戏内容" : "新增大章节"}</h3></div>
          <button onClick={onClose}><X size={17} /></button>
        </header>
        {kind === "scene" ? (
          <>
            <label>片段名称<input value={sceneDraft.name} onChange={(event) => setSceneDraft({ ...sceneDraft, name: event.target.value })} /></label>
            <label>所属章节<select value={sceneDraft.chapterId} onChange={(event) => setSceneDraft({ ...sceneDraft, chapterId: event.target.value })}>{project.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></label>
            <label>一句话概括（可稍后生成）<textarea rows={5} value={sceneDraft.summary} onChange={(event) => setSceneDraft({ ...sceneDraft, summary: event.target.value })} placeholder="白昼的茶室，爱丽丝邀请主人坐下，并给出几个选择……" /></label>
            <p>这里只创建片段，不会偷偷新增分支线。创建后可从节点底部拖线连接；内部选项和循环仍留在片段里。</p>
            <footer><button onClick={onClose}>取消</button><button className="simple-primary" onClick={() => onCreateScene(sceneDraft)} disabled={!sceneDraft.name.trim() || !sceneDraft.chapterId}>创建并开始写</button></footer>
          </>
        ) : (
          <>
            <label>章节标题<input value={chapterDraft.name} onChange={(event) => setChapterDraft({ ...chapterDraft, name: event.target.value })} placeholder="章节 2 · 雪夜来信" /></label>
            <label>章节说明<textarea rows={5} value={chapterDraft.description} onChange={(event) => setChapterDraft({ ...chapterDraft, description: event.target.value })} placeholder="这一章的主题、时间和主要目标…" /></label>
            <p>章节的第一个剧情片段在试玩时会自动出现章节标题演出。</p>
            <footer><button onClick={onClose}>取消</button><button className="simple-primary" onClick={() => onCreateChapter(chapterDraft)} disabled={!chapterDraft.name.trim()}>创建章节</button></footer>
          </>
        )}
      </div>
    </div>
  );
}

export function SimpleStudio({
  project,
  selectedSceneId,
  diagnostics,
  savedAt,
  canUndo,
  canRedo,
  onSelectScene,
  onChange,
  onUndo,
  onRedo,
  onAdvanced,
}: Props) {
  const [section, setSection] = useState<SimpleSection>("story");
  const [creationKind, setCreationKind] = useState<"scene" | "chapter">();
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const activeSection = sectionItems.find((item) => item.id === section)!;
  const ActiveSectionIcon = activeSection.icon;

  const createScene = (draft: { name: string; chapterId: string; summary: string }) => {
    const id = createId("scene");
    const currentScene = project.scenes.find((scene) => scene.id === selectedSceneId);
    const scene: StoryScene = {
      id,
      chapterId: draft.chapterId,
      name: draft.name.trim(),
      slug: slugify(draft.name),
      summary: draft.summary.trim(),
      aiContext: draft.summary.trim(),
      mode: "adv",
      tags: [],
      blocks: [],
      entryStage: currentScene?.entryStage
        ? structuredClone(currentScene.entryStage)
        : undefined,
    };
    const currentRoute = project.routeMap.nodes.find((node) => node.sceneId === selectedSceneId);
    const deepestY = Math.max(40, ...project.routeMap.nodes.map((node) => routeDisplayPosition(node, project.routeMap.layoutDirection).y));
    const route: RouteNode = {
      id: createId("route"),
      kind: "scene",
      title: scene.name,
      sceneId: id,
      ...routeStoredPosition({ x: currentRoute ? routeDisplayPosition(currentRoute, project.routeMap.layoutDirection).x : 360, y: deepestY + 154 }, project.routeMap.layoutDirection),
      replayable: true,
      color: "#8173d5",
    };
    const next = {
      ...project,
      scenes: [...project.scenes, scene],
      chapters: project.chapters.map((chapter) => chapter.id === draft.chapterId ? { ...chapter, sceneIds: [...chapter.sceneIds, id] } : chapter),
      routeMap: {
        ...project.routeMap,
        nodes: [...project.routeMap.nodes, route],
        edges: project.routeMap.edges,
      },
      updatedAt: nowIso(),
    };
    onChange(next, "创建剧情片段");
    onSelectScene(id);
    setCreationKind(undefined);
    setSection("story");
  };

  const createChapter = (draft: { name: string; description: string }) => {
    const id = createId("chapter");
    onChange({
      ...project,
      chapters: [...project.chapters, { id, name: draft.name.trim(), description: draft.description.trim(), order: project.chapters.length, sceneIds: [] }],
      updatedAt: nowIso(),
    }, "创建章节");
    setCreationKind(undefined);
  };

  const deleteScene = (sceneId: string) => {
    const scene = project.scenes.find((item) => item.id === sceneId);
    if (!scene || project.scenes.length <= 1) return;
    if (!window.confirm(`确认删除剧情片段「${scene.name}」？与它相连的分支线和失效跳转会同时清理。`)) return;
    const result = deleteStoryScene(project, sceneId);
    onChange(result.project, `删除剧情片段「${scene.name}」`);
    onSelectScene(result.nextSceneId);
  };

  return (
    <div className="simple-studio">
      <header className="simple-topbar">
        <div className="simple-brand">
          <span className="simple-brand__mark">G</span>
          <div><strong>Gal Story Studio</strong><small>{project.title}</small></div>
        </div>
        <div className="simple-topbar-actions">
          <div className="simple-save-state"><Save size={13} /><span>{savedAt}</span></div>
          <button className="icon-soft" onClick={onUndo} disabled={!canUndo} title="撤销"><Undo2 size={16} /></button>
          <button className="icon-soft" onClick={onRedo} disabled={!canRedo} title="重做"><Redo2 size={16} /></button>
          <button className={`simple-health ${errors.length ? "has-error" : ""}`} onClick={() => onAdvanced("diagnostics")}>
            <span />{errors.length ? `${errors.length} 个问题` : "项目正常"}
          </button>
          <button className="simple-top-preview" onClick={() => setSection("preview")}><Play size={14} fill="currentColor" /> 试玩</button>
          <button className="advanced-entry" onClick={() => onAdvanced()}><Settings2 size={15} /><span>高级模式</span></button>
        </div>
      </header>
      <div className={`simple-editor-body ${section === "preview" ? "is-previewing" : ""}`}>
        <aside className="simple-sidebar">
          <span className="simple-sidebar__title">创作工作区</span>
          <nav className="simple-nav" aria-label="简单创作流程">
            {sectionItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
                  <Icon size={17} />
                  <div><strong>{item.label}</strong><small>{item.description}</small></div>
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </nav>
          <div className="simple-sidebar__project">
            <span>当前项目</span>
            <strong>{project.scenes.length} 个剧情片段</strong>
            <p>{project.assets.length} 个素材 · {project.characters.length} 个角色</p>
            {!project.assets.some((asset) => asset.kind === "bgm") && <small>当前没有 BGM，试玩会保持静音</small>}
          </div>
          {project.scenes.some((scene) => scene.tags.includes("ai-generated-acceptance")) && (
            <div className="simple-sidebar__provenance">
              <Bot size={16} />
              <div>
                <strong>AI 工具验收稿</strong>
                <span>由本轮 ChatGPT 通过编辑器工具 API 生成；站内模型 Provider 尚未接入。</span>
              </div>
            </div>
          )}
        </aside>
        <div className="simple-editor-main">
          <div className="simple-progress-mobile">
            <span>{activeSection.step}</span><ActiveSectionIcon size={16} /><strong>{activeSection.label}</strong><small>{activeSection.description}</small><ChevronDown size={15} />
          </div>
          <main className="simple-workspace">
            {section === "story" && (
              <StoryWorkspace
                project={project}
                selectedSceneId={selectedSceneId}
                onSelectScene={onSelectScene}
                onChange={onChange}
                onAdvanced={onAdvanced}
                onCreate={setCreationKind}
                onDeleteScene={deleteScene}
                onOpenPreview={() => setSection("preview")}
              />
            )}
            {section === "assets" && <SimpleAssetWorkspace project={project} onChange={onChange} onUndo={onUndo} canUndo={canUndo} />}
            {section === "preview" && (
              <SimplePreviewWorkspace
                project={project}
                selectedSceneId={selectedSceneId}
                onSelectScene={onSelectScene}
                onChange={onChange}
                onAdvanced={onAdvanced}
                onExitPreview={() => setSection("story")}
              />
            )}
          </main>
        </div>
      </div>
      {creationKind && (
        <CreationDialog
          kind={creationKind}
          project={project}
          selectedSceneId={selectedSceneId}
          onClose={() => setCreationKind(undefined)}
          onCreateScene={createScene}
          onCreateChapter={createChapter}
        />
      )}
    </div>
  );
}
