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
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileAudio,
  FileJson,
  Film,
  FolderHeart,
  Gamepad2,
  GitBranch,
  GripVertical,
  ImageIcon,
  LibraryBig,
  LockKeyhole,
  Maximize2,
  MessageCircle,
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
  Sparkles,
  TriangleAlert,
  Trash2,
  UploadCloud,
  UserRound,
  X,
  Undo2,
} from "lucide-react";
import { ChangeEvent, memo, useEffect, useMemo, useRef, useState } from "react";

import { FigureStageEditor } from "./FigureStageEditor";
import { DynamicGalgameStage, sceneUsesLayeredMotion } from "./DynamicGalgameStage";
import { resolveRegisteredAssetUrl } from "@/lib/assetUrl";
import {
  createRuntimeZipWithAssets,
  createStoryJson,
  inspectRuntimeExport,
  projectBackupFileName,
} from "@/lib/story/exporter";
import { createDirectorDraft, reviseSceneWithInstruction, type DirectorDraft } from "@/lib/story/director";
import {
  choiceGroupCode,
  choiceGroupDisplayName,
  isChoiceGroupNameUnique,
  nextChoiceGroupIdentity,
} from "@/lib/story/choiceGroups";
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
import { buildChapterMapClusters, routePositionFromChapterMap } from "@/lib/story/chapterMapLayout";
import type {
  AssetKind,
  PerformanceCue,
  RouteEdge,
  RouteNode,
  StagePosition,
  StoryAsset,
  StoryBlock,
  StoryCharacter,
  StoryChapter,
  StoryProject,
  StoryRecord,
  StoryScene,
} from "@/lib/story/types";
import { createId, downloadBlob, nowIso, slugify } from "@/lib/story/utils";
import { parseWebGalSpritePackage } from "@/lib/story/webgalSpritePackage";

type SnapshotActor = "human" | "ai" | "import" | "system";
type SimpleSection = "story" | "assets" | "preview";

type Props = {
  project: StoryProject;
  selectedSceneId: string;
  savedAt: string;
  canUndo: boolean;
  canRedo: boolean;
  onSelectScene: (sceneId: string) => void;
  onChange: (project: StoryProject, label: string, actor?: SnapshotActor) => void;
  onUndo: () => void;
  onRedo: () => void;
};

type SimpleRouteNodeData = {
  route: RouteNode;
  scene?: StoryScene;
  locked: boolean;
  playerView: boolean;
  onPlay: (sceneId: string) => void;
};

type SimpleChapterNodeData = {
  chapter: StoryChapter;
  index: number;
};

type SimpleChapterGroupData = {
  chapterId: string;
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

const SimpleRouteNode = memo(function SimpleRouteNode({ data, selected }: NodeProps<Node<SimpleRouteNodeData>>) {
  const { route, scene, locked, playerView, onPlay } = data;
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
        <span>{route.kind === "start" ? "入口" : route.kind.includes("ending") ? "结局" : "分支片段"}</span>
        {locked ? <LockKeyhole size={12} /> : route.kind === "start" ? <Sparkles size={12} /> : <GitBranch size={12} />}
      </div>
      <strong>{route.title}</strong>
      <footer>
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

const SimpleChapterNode = memo(function SimpleChapterNode({ data }: NodeProps<Node<SimpleChapterNodeData>>) {
  return (
    <div className="simple-chapter-node">
      <span>CHAPTER {String(data.index + 1).padStart(2, "0")}</span>
      <strong>{data.chapter.name}</strong>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

const SimpleChapterGroup = memo(function SimpleChapterGroup({ data }: NodeProps<Node<SimpleChapterGroupData>>) {
  return <div className="simple-chapter-group" data-chapter-id={data.chapterId} />;
});

const simpleNodeTypes = {
  simpleRoute: SimpleRouteNode,
  simpleChapter: SimpleChapterNode,
  simpleChapterGroup: SimpleChapterGroup,
};

function StudioGuideAssistant({
  project,
  selectedSceneId,
  section,
  onChange,
}: {
  project: StoryProject;
  selectedSceneId: string;
  section: SimpleSection;
  onChange: Props["onChange"];
}) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "assistant" | "user"; text: string }>>([
    { role: "assistant", text: "想写什么？" },
  ]);
  const [pending, setPending] = useState<DirectorDraft>();
  const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId) || project.scenes[0];

  const answerWithGuidance = () => {
    if (section === "assets") return "可以帮你整理素材用途和角色绑定。";
    if (section === "preview") return "可以直接告诉我哪句、哪个动作需要改。";
    if (!selectedScene?.blocks.length) return "描述地点、角色和要发生的事，我来起草。";
    return `要修改「${selectedScene.name}」的哪一部分？`;
  };

  const send = () => {
    const text = prompt.trim();
    if (!text || !selectedScene) return;
    setMessages((items) => [...items, { role: "user", text }]);
    setPrompt("");
    if (!/(生成|写|改|调整|润色|增加|添加|换成|让)/.test(text)) {
      setPending(undefined);
      setMessages((items) => [...items, { role: "assistant", text: answerWithGuidance() }]);
      return;
    }
    const draft = selectedScene.blocks.length && !/(重新生成|整段重写|从头写)/.test(text)
      ? reviseSceneWithInstruction(project, selectedScene.id, text)
      : createDirectorDraft(project, selectedScene.id, text);
    setPending(draft);
    setMessages((items) => [...items, {
      role: "assistant",
      text: `「${selectedScene.name}」草稿已准备。`,
    }]);
  };

  const applyPending = () => {
    if (!pending || !selectedScene) return;
    onChange(pending.project, `创作助手修改「${selectedScene.name}」`, "system");
    setPending(undefined);
    setMessages((items) => [...items, { role: "assistant", text: "已应用。" }]);
  };

  return (
    <section className="studio-guide-assistant">
      <header>
        <span><MessageCircle size={14} /></span>
        <div><strong>创作助手</strong></div>
      </header>
      <div className="studio-guide-assistant__messages" aria-live="polite">
        {messages.slice(-5).map((message, index) => <p className={`is-${message.role}`} key={`${message.role}-${index}`}>{message.text}</p>)}
      </div>
      {pending && <div className="studio-guide-assistant__pending"><Sparkles size={13} /><span>当前片段草稿已准备好</span><button onClick={applyPending}>应用草稿</button></div>}
      <label className="studio-guide-assistant__compose">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="例如：写一段爱丽丝担心主人晚归的对白，并给三个选项"
        />
        <button onClick={send} disabled={!prompt.trim()} aria-label="发送给创作助手"><Send size={15} /></button>
      </label>
    </section>
  );
}

type StoryWorkspaceProps = Pick<Props, "project" | "selectedSceneId" | "onSelectScene" | "onChange"> & {
  onCreate: (kind: "scene" | "chapter") => void;
  onDeleteScene: (sceneId: string) => void;
  onOpenPreview: () => void;
};

function StoryWorkspace({
  project,
  selectedSceneId,
  onSelectScene,
  onChange,
  onCreate,
  onDeleteScene,
  onOpenPreview,
}: StoryWorkspaceProps) {
  const playerView = false;
  const [chapterId, setChapterId] = useState("all");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [recordDraft, setRecordDraft] = useState("");
  const storyPane = useResizablePane("gal-story-inspector-width", 470, 360, 720);
  const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId) || project.scenes[0];

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
  const visibleChapters = useMemo(() => project.chapters.filter((chapter) => chapterId === "all" || chapter.id === chapterId), [chapterId, project.chapters]);
  const chapterClusters = useMemo(
    () => buildChapterMapClusters(project, visibleChapters.map((chapter) => chapter.id)),
    [project, visibleChapters],
  );

  const projectNodes = useMemo<Node<SimpleRouteNodeData | SimpleChapterNodeData | SimpleChapterGroupData>[]>(() => {
    const result: Node<SimpleRouteNodeData | SimpleChapterNodeData | SimpleChapterGroupData>[] = [];
    chapterClusters.forEach((cluster) => {
      const chapter = visibleChapters.find((item) => item.id === cluster.chapterId);
      if (!chapter) return;
      const chapterRoutes = visibleRoutes.filter((route) => route.sceneId && chapter.sceneIds.includes(route.sceneId));
      result.push({
        id: `chapter-group:${chapter.id}`,
        type: "simpleChapterGroup",
        position: { x: cluster.background.x, y: cluster.background.y },
        data: { chapterId: chapter.id },
        draggable: false,
        selectable: false,
        deletable: false,
        focusable: false,
        style: { width: cluster.background.width, height: cluster.background.height },
        zIndex: -1,
      });
      result.push({
        id: `chapter-card:${chapter.id}`,
        type: "simpleChapter",
        position: { x: cluster.card.x, y: cluster.card.y },
        data: { chapter, index: project.chapters.findIndex((item) => item.id === chapter.id) },
        draggable: false,
        selectable: true,
        deletable: false,
        style: { width: cluster.card.width, height: cluster.card.height },
        zIndex: 2,
      });
      chapterRoutes.forEach((route) => {
        const scene = project.scenes.find((item) => item.id === route.sceneId);
        const position = cluster.routePositions[route.id];
        if (!position) return;
        result.push({
          id: route.id,
          type: "simpleRoute",
          position,
          selected: route.sceneId === selectedScene?.id,
          deletable: false,
          draggable: true,
          ariaLabel: route.title,
          zIndex: 2,
          data: {
            route,
            scene,
            playerView,
            locked: playerView && Boolean(route.unlockCondition),
            onPlay: (sceneId: string) => {
              onSelectScene(sceneId);
              onOpenPreview();
            },
          },
        });
      });
    });
    return result;
  }, [chapterClusters, onOpenPreview, onSelectScene, playerView, project.chapters, project.scenes, selectedScene?.id, visibleChapters, visibleRoutes]);
  const [nodes, setNodes, onNodesChange] = useNodesState(projectNodes);

  useEffect(() => {
    setNodes(projectNodes);
  }, [projectNodes, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const routeEdges: Edge[] = project.routeMap.edges
    .filter((edge) => visibleRouteIds.has(edge.source) && visibleRouteIds.has(edge.target) && (!playerView || !edge.hiddenFromPlayer))
    .map((edge) => {
      const reciprocal = project.routeMap.edges.some((candidate) => candidate.source === edge.target && candidate.target === edge.source);
      const selected = edge.id === selectedEdgeId;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: reciprocal ? "smoothstep" : undefined,
        pathOptions: reciprocal ? {
          offset: edge.source.localeCompare(edge.target) < 0 ? 34 : 68,
          stepPosition: edge.source.localeCompare(edge.target) < 0 ? 0.35 : 0.65,
        } : undefined,
        label: edge.label || edge.condition,
        selected,
        markerEnd: { type: MarkerType.ArrowClosed, color: selected ? "#6e5fca" : "#a89fd6" },
        style: {
          stroke: selected ? "#6e5fca" : edge.condition ? "#ba91ba" : "#afa8cf",
          strokeWidth: selected ? 3 : 1.8,
          strokeDasharray: edge.condition ? "5 4" : undefined,
        },
        labelStyle: { fill: "#756e88", fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "#fffdf9", fillOpacity: 0.96 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 8,
      };
    });
    const chapterEdges: Edge[] = chapterClusters.flatMap((cluster) => cluster.entryRouteIds.map((routeId) => ({
      id: `chapter-entry:${cluster.chapterId}:${routeId}`,
      source: `chapter-card:${cluster.chapterId}`,
      target: routeId,
      type: "smoothstep",
      selectable: false,
      focusable: false,
      deletable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#8173c9" },
      style: { stroke: "#8173c9", strokeWidth: 2.2 },
      zIndex: 1,
    })));
    return [...chapterEdges, ...routeEdges];
  }, [chapterClusters, playerView, project.routeMap.edges, selectedEdgeId, visibleRouteIds]);
  const selectedEdge = project.routeMap.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedEdgeSource = project.routeMap.nodes.find((node) => node.id === selectedEdge?.source);
  const selectedEdgeTarget = project.routeMap.nodes.find((node) => node.id === selectedEdge?.target);

  const updateNodePosition = (routeId: string, position: { x: number; y: number }) => {
    const route = project.routeMap.nodes.find((node) => node.id === routeId);
    const scene = project.scenes.find((item) => item.id === route?.sceneId);
    const cluster = chapterClusters.find((item) => item.chapterId === scene?.chapterId);
    if (!route || !cluster) return;
    const stored = routePositionFromChapterMap(position, cluster, project.routeMap.layoutDirection);
    onChange({
      ...project,
      routeMap: {
        ...project.routeMap,
        nodes: project.routeMap.nodes.map((node) => node.id === routeId ? { ...node, ...stored } : node),
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
    .map((block) => ({
      scene,
      block,
      code: choiceGroupCode(project, scene, block),
      name: choiceGroupDisplayName(project, scene, block),
    })));
  const selectedChoiceGroups = selectedScene?.blocks.filter((block): block is Extract<StoryBlock, { type: "choice" }> => block.type === "choice") || [];

  const updateChoiceGroup = (blockId: string, updater: (block: Extract<StoryBlock, { type: "choice" }>) => Extract<StoryBlock, { type: "choice" }>, label: string) => {
    if (!selectedScene) return;
    updateScene({
      blocks: selectedScene.blocks.map((block) => block.type === "choice" && block.id === blockId ? updater(block) : block),
    }, label);
  };

  const addChoiceGroup = () => {
    if (!selectedScene) return;
    const identity = nextChoiceGroupIdentity(project, selectedScene);
    const group: Extract<StoryBlock, { type: "choice" }> = {
      id: createId("choice"),
      type: "choice",
      ...identity,
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
        targetSceneId: undefined,
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
        <h1>故事</h1>
        <div className="simple-heading-actions">
          <button className="soft-button" onClick={() => onCreate("chapter")}><LibraryBig size={15} /> 新章节</button>
          <button className="simple-primary" onClick={() => onCreate("scene")}><Plus size={16} /> 新片段</button>
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
      </div>

      <div className="simple-story-layout" style={{ gridTemplateColumns: `minmax(520px, 1fr) 8px ${storyPane.width}px` }}>
        <section className="simple-map-panel">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={simpleNodeTypes}
            onNodesChange={onNodesChange}
            defaultViewport={{ x: 0, y: 0, zoom: 0.92 }}
            fitView
            fitViewOptions={{ padding: 0.12, minZoom: 0.35, maxZoom: 1.05 }}
            minZoom={0.35}
            maxZoom={1.5}
            nodeDragThreshold={1}
            nodesDraggable={!playerView}
            nodesConnectable={!playerView}
            elementsSelectable
            edgesFocusable={!playerView}
            deleteKeyCode={playerView ? null : ["Backspace", "Delete"]}
            elevateNodesOnSelect={false}
            panOnDrag
            panOnScroll
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
            onConnect={connect}
            onNodeClick={(_, node) => {
              if (node.id.startsWith("chapter-card:")) {
                setChapterId(node.id.slice("chapter-card:".length));
                return;
              }
              const sceneId = project.routeMap.nodes.find((route) => route.id === node.id)?.sceneId;
              if (sceneId) onSelectScene(sceneId);
              setSelectedEdgeId(undefined);
            }}
            onNodeDragStop={(_, node) => {
              if (node.type === "simpleRoute") updateNodePosition(node.id, node.position);
            }}
            onEdgeClick={(event, edge) => {
              if (edge.id.startsWith("chapter-entry:")) return;
              event.stopPropagation();
              setSelectedEdgeId(edge.id);
            }}
            onEdgesDelete={(deleted) => removeEdges(deleted.map((edge) => edge.id))}
            onPaneClick={() => setSelectedEdgeId(undefined)}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="#ded9ea" />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
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
                </div>
              </header>
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
                      {!records.length && <p>暂无记录</p>}
                    </div>
                  )}
                  {selectedEdge.recordCondition?.mode === "at-least" && (
                    <label>至少获得<input type="number" min={1} max={Math.max(1, selectedEdge.recordCondition.recordIds.length)} value={selectedEdge.recordCondition.minimum || 1} onChange={(event) => updateSelectedEdgeRecords({ minimum: Number(event.target.value) })} /></label>
                  )}
                  <button className="danger-button" onClick={() => removeEdge(selectedEdge.id)}><Trash2 size={14} /> 删除这条细线</button>
                </section>
              ) : (
                <>
              <section className="choice-group-workspace">
                <header><strong>选项</strong><button onClick={addChoiceGroup}><Plus size={13} /> 添加</button></header>
                <div className="story-record-strip">
                  <span>一次性记录</span>
                  {records.map((record) => <button key={record.id} onClick={() => copyText(record.name)} title="点击复制记录名"><Copy size={11} />{record.name}</button>)}
                  <span className="story-record-create">
                    <input value={recordDraft} onChange={(event) => setRecordDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createRecord(); }} placeholder="例如：获得线索 A" aria-label="新记录名称" />
                    <button onClick={createRecord} disabled={!recordDraft.trim()}><Plus size={11} />添加</button>
                  </span>
                </div>
                <div className="choice-group-list">
                  {selectedChoiceGroups.map((group) => (
                    <article className="choice-group-card" key={group.id}>
                      <header>
                        <span>{choiceGroupCode(project, selectedScene, group)}</span>
                        <input
                          key={`${group.id}:${group.groupName}`}
                          defaultValue={choiceGroupDisplayName(project, selectedScene, group)}
                          onInput={(event) => event.currentTarget.setCustomValidity("")}
                          onBlur={(event) => {
                            const groupName = event.currentTarget.value.trim();
                            if (!groupName || !isChoiceGroupNameUnique(project, group.id, groupName)) {
                              event.currentTarget.setCustomValidity(groupName ? "选项组名称不能重复" : "请填写选项组名称");
                              event.currentTarget.reportValidity();
                              event.currentTarget.value = choiceGroupDisplayName(project, selectedScene, group);
                              return;
                            }
                            if (groupName !== group.groupName) updateChoiceGroup(group.id, (block) => ({ ...block, groupName }), "修改选项组名称");
                          }}
                          aria-label={`${choiceGroupCode(project, selectedScene, group)} 名称`}
                          placeholder="例如：是否相信爱丽丝"
                        />
                        <button onClick={() => deleteChoiceGroup(group.id)}><Trash2 size={12} /></button>
                      </header>
                      <label className="choice-group-prompt"><span>画面提示</span><input value={group.prompt || ""} onChange={(event) => updateChoiceGroup(group.id, (block) => ({ ...block, prompt: event.target.value }), "修改选项组提示")} placeholder="玩家要怎么回应？" /></label>
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
                            : option.endScene ? "end" : "continue";
                          return (
                            <section className="choice-option-row" key={option.id}>
                              <b>{optionIndex + 1}</b>
                              <input value={option.label} onChange={(event) => updateChoiceGroup(group.id, (block) => ({ ...block, options: block.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) }), "修改选项文字")} aria-label={`${choiceGroupCode(project, selectedScene, group)} 选项 ${optionIndex + 1}`} />
                              <select value={destination} onChange={(event) => setOptionDestination(group.id, option.id, event.target.value)}>
                                <option value="continue">继续本段（只影响下一句）</option>
                                <option value="end">结束本片段，按地图细线继续</option>
                                {allChoiceGroups.map((item) => <option key={item.block.id} value={`group:${item.block.id}`}>跳到「{item.name}」{item.block.id === group.id ? "（循环本组）" : ""}</option>)}
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
                    </article>
                  ))}
                  {!selectedChoiceGroups.length && <button className="choice-group-empty" onClick={addChoiceGroup}><GitBranch size={20} /><strong>添加第一个选项</strong></button>}
                </div>
              </section>
              <button className="scene-preview-shortcut" onClick={onOpenPreview}><Gamepad2 size={14} /> 打开修订 <ChevronRight size={14} /></button>
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
    { role: "assistant", text: "想怎么整理素材？" },
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
        <h1>素材</h1>
        <div className="simple-heading-actions">
          <button className="soft-button" onClick={() => setShowCharacter(true)}><UserRound size={15} /> 新角色</button>
          <button className="simple-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}><UploadCloud size={16} /> {uploading ? "正在整理…" : "上传素材"}</button>
          <input ref={fileInputRef} type="file" multiple hidden accept="image/*,audio/*,video/*,.json,.zip,application/zip" onChange={handleFiles} />
        </div>
      </header>

      <section className="asset-assistant">
        <header>
          <div><span><Sparkles size={15} /> 素材助理</span></div>
          <div><button className="soft-button" onClick={onUndo} disabled={!canUndo}><Undo2 size={14} /> 撤销本次整理</button><button className="simple-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}><UploadCloud size={15} /> 上传文件 / ZIP</button></div>
        </header>
        <div className="asset-assistant__messages">
          {assistantMessages.slice(-5).map((message, index) => <p className={`is-${message.role}`} key={`${message.role}-${index}`}><b>{message.role === "assistant" ? "助理" : "你"}</b><span>{message.text}</span></p>)}
        </div>
        <div className="asset-assistant__compose">
          <textarea value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runAssetAssistant();
          }} placeholder="例如：把“爱丽丝 标准姿势 normal”作为默认日常立绘，Q 版只用于搞笑；以后上传的茶室背景按白天/夜晚分组。" rows={3} />
          <button onClick={runAssetAssistant} disabled={!assistantPrompt.trim()}><Send size={15} /> 发送</button>
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

      <details className="builtin-performance-library">
        <summary><Film size={14} /><strong>演出效果</strong><ChevronDown size={14} /></summary>
        <div>{WEBGAL_ANIMATION_PRESETS.map((preset) => <button key={preset.name} onClick={() => copyText(preset.name)} title="点击复制效果名"><Copy size={11} /><span>{preset.label}</span><small>{preset.category} · {preset.durationMs}ms</small></button>)}</div>
      </details>

      <section className="character-library-strip">
        <div className="character-library-title"><span>角色与表情</span></div>
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
                <div className="figure-framing-summary"><span>{assetDraft.figurePosition === "left" ? "左侧" : assetDraft.figurePosition === "center" ? "中央" : "右侧"} · {FIGURE_SHOT_LABELS[normalizeFigureShot(assetDraft.figureShot)]} · {assetDraft.figureScale.toFixed(2)}×</span></div>
              </>
            )}
            <label>标签<input value={assetDraft.tags} onChange={(event) => setAssetDraft({ ...assetDraft, tags: event.target.value })} placeholder="夜晚, 茶室, 安静, 轻微担心" /></label>
            <label>别名<input value={assetDraft.aliases} onChange={(event) => setAssetDraft({ ...assetDraft, aliases: event.target.value })} /></label>
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

type PreviewWorkspaceProps = Pick<Props, "project" | "selectedSceneId" | "onSelectScene" | "onChange"> & {
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

type InsertBlockKind = "dialogue" | "narration" | "choice" | "background" | "figure" | "bgm" | "sfx" | "wait" | "animation";

function BlockInsertMenu({ onInsert, canDialogue }: { onInsert: (kind: InsertBlockKind) => void; canDialogue: boolean }) {
  const [open, setOpen] = useState(false);
  const insert = (kind: InsertBlockKind) => {
    onInsert(kind);
    setOpen(false);
  };
  return (
    <div className={`block-insert ${open ? "is-open" : ""}`}>
      <button className="block-insert__trigger" onClick={() => setOpen((value) => !value)} aria-label="在这里插入内容"><Plus size={13} /></button>
      {open && (
        <div className="block-insert__menu">
          <button onClick={() => insert("dialogue")} disabled={!canDialogue}>对白</button>
          <button onClick={() => insert("narration")}>旁白</button>
          <button onClick={() => insert("choice")}>选项</button>
          <i />
          <button onClick={() => insert("background")}>背景</button>
          <button onClick={() => insert("figure")}>角色</button>
          <button onClick={() => insert("bgm")}>BGM</button>
          <button onClick={() => insert("sfx")}>音效</button>
          <button onClick={() => insert("animation")}>画面效果</button>
          <button onClick={() => insert("wait")}>等待</button>
        </div>
      )}
    </div>
  );
}

function PreviewBlockEditor({
  block,
  index,
  project,
  previousChoice,
  assetUrls,
  backgroundUrl,
  onCommit,
  onReplayFromGroup,
  onGenerateVoice,
  onReplayFromBlock,
  onMove,
  onDelete,
  total,
  generatingVoice,
  dirty,
}: {
  block: StoryBlock;
  index: number;
  project: StoryProject;
  previousChoice?: Extract<StoryBlock, { type: "choice" }>;
  assetUrls: Record<string, string>;
  backgroundUrl?: string;
  onCommit: (block: StoryBlock) => void;
  onReplayFromGroup?: (blockId: string) => void;
  onGenerateVoice?: (block: Extract<StoryBlock, { type: "dialogue" }>) => void;
  onReplayFromBlock?: (blockId: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  total: number;
  generatingVoice?: boolean;
  dirty?: boolean;
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
  const stageExpression = block.type === "stage" && character
    ? character.expressions.find((item) => item.id === (block.expressionId || character.defaultExpressionId))
    : undefined;
  const stageFigureAsset = project.assets.find((item) => item.id === stageExpression?.assetId);
  const stageFigureUrl = resolveRegisteredAssetUrl(stageFigureAsset, assetUrls);
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
  const activeAnimation = activeExpression?.webgalAnimation;
  const hasMouthDiffs = Boolean(activeAnimation?.mouthOpenAssetId && activeAnimation?.mouthCloseAssetId);
  const hasBlinkDiffs = Boolean(activeAnimation?.eyesCloseAssetId);
  const reactionChoices = block.type === "dialogue" && continueOptions.length
    ? [{ id: "", label: "默认台词" }, ...continueOptions.map((option) => ({ id: option.id, label: option.label }))]
    : [];
  const reactionIndex = Math.max(0, reactionChoices.findIndex((item) => item.id === reactionOptionId));
  const cycleReaction = (direction: -1 | 1) => {
    if (!reactionChoices.length) return;
    const next = (reactionIndex + direction + reactionChoices.length) % reactionChoices.length;
    setReactionOptionId(reactionChoices[next].id);
    setExpanded(true);
  };

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
    <article className={`preview-block-card preview-block-card--${block.type} ${dirty ? "is-dirty" : ""}`}>
      <header>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <strong>
          {block.type === "dialogue" && (activeCharacter?.displayName || character?.displayName || "角色对白")}
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
          {block.type === "native" && "WebGAL 指令"}
          {block.type === "comment" && "编剧备注"}
        </strong>
        {dirty && <i className="preview-block-dirty">草稿</i>}
        <div className="preview-block-actions">
          <button onClick={() => onReplayFromBlock?.(block.id)} title="从这里试玩" aria-label="从这里试玩"><Play size={12} /></button>
          <button onClick={() => onMove(-1)} disabled={index === 0} title="上移" aria-label="上移"><ArrowUp size={12} /></button>
          <button onClick={() => onMove(1)} disabled={index >= total - 1} title="下移" aria-label="下移"><ArrowDown size={12} /></button>
          <button onClick={onDelete} title="删除" aria-label="删除"><Trash2 size={12} /></button>
          {(block.type === "dialogue" || block.type === "choice" || block.type === "stage") && <button className="preview-block-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "编辑"}<ChevronDown size={12} /></button>}
        </div>
      </header>
      {block.type === "dialogue" && continueOptions.length > 0 && (
        <div className="dialogue-reaction-carousel">
          <span>上一组选项对应的这一句</span>
          <button onClick={() => cycleReaction(-1)} aria-label="上一个选项反应"><ChevronLeft size={14} /></button>
          <strong>{reactionChoices[reactionIndex]?.label}</strong>
          <small>{reactionOptionId && block.choiceReactions?.some((item) => item.choiceBlockId === previousChoice?.id && item.optionId === reactionOptionId) ? "已单独修改" : reactionOptionId ? "沿用默认，可直接改" : "所有路线默认"}</small>
          <button onClick={() => cycleReaction(1)} aria-label="下一个选项反应"><ChevronRight size={14} /></button>
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
            <label>角色画面变化<select value={block.enter?.name || "direct"} onChange={(event) => onCommit({ ...block, enter: event.target.value === "direct" ? undefined : { name: event.target.value, durationMs: block.enter?.durationMs || 420 } })}><option value="direct">直接替换（姿势 / 表情默认）</option><option value="enter">柔和入场</option><option value="enter-from-left">从左侧入场</option><option value="enter-from-right">从右侧入场</option><option value="enter-from-bottom">从下方入场</option></select></label>
            <label>变化时长<select value={String(block.enter?.durationMs || 420)} disabled={!block.enter} onChange={(event) => onCommit({ ...block, enter: block.enter ? { ...block.enter, durationMs: Number(event.target.value) } : undefined })}><option value="260">快速 · 260ms</option><option value="420">自然 · 420ms</option><option value="700">缓慢 · 700ms</option></select></label>
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
        </div>
      )}
      {block.type === "dialogue" && (
        <details className="line-animation-controls">
          <summary><span>语音与表情动作</span><b>{block.voiceAssetId ? "有语音" : "无语音"}</b><ChevronDown size={12} /></summary>
          <div>
            <label>语音<select value={block.voiceAssetId || ""} onChange={(event) => onCommit({ ...block, voiceAssetId: event.target.value || undefined })}><option value="">不绑定</option>{project.assets.filter((item) => item.kind === "voice").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button className="line-tts-button" onClick={() => onGenerateVoice?.(block)} disabled={generatingVoice}><FileAudio size={12} /> {generatingVoice ? "生成中" : "生成语音"}</button>
            <label>口型<select value={block.figureAnimation?.mouthSync || "inherit"} disabled={!hasMouthDiffs} onChange={(event) => onCommit({ ...block, figureAnimation: { ...block.figureAnimation, mouthSync: event.target.value as NonNullable<typeof block.figureAnimation>["mouthSync"] } })}><option value="inherit">跟随立绘设置</option><option value="on">开启</option><option value="off">关闭</option></select></label>
            <label>眨眼<select value={block.figureAnimation?.blink || "inherit"} disabled={!hasBlinkDiffs} onChange={(event) => onCommit({ ...block, figureAnimation: { ...block.figureAnimation, blink: event.target.value as NonNullable<typeof block.figureAnimation>["blink"] } })}><option value="inherit">跟随立绘设置</option><option value="dynamic">自然眨眼</option><option value="fixed-open">保持睁眼</option><option value="fixed-closed">保持闭眼</option><option value="none">关闭眨眼</option></select></label>
          </div>
        </details>
      )}
      {block.type === "choice" && (
        <div className="preview-choice-editor">
          <div className="preview-choice-heading">
            <p><strong>{choiceGroupDisplayName(project, project.scenes.find((scene) => scene.blocks.some((item) => item.id === block.id)) || project.scenes[0], block)}</strong><small>{block.groupCode || `Q${index + 1}`} · {block.prompt || "玩家要怎么回应？"}</small></p>
            <button onClick={() => onReplayFromGroup?.(block.id)}><Play size={11} /> 从本组重播</button>
          </div>
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
              {expanded && <small>{option.targetChoiceGroupId ? `跳到「${project.scenes.flatMap((scene) => scene.blocks.filter((item): item is Extract<StoryBlock, { type: "choice" }> => item.type === "choice").map((item) => ({ scene, item }))).find(({ item }) => item.id === option.targetChoiceGroupId)?.item.groupName || "选项组"}」` : option.endScene ? "结束片段并按地图继续" : "继续本片段；只影响下一句"}{option.recordId ? ` · 写入一次性记录` : ""}</small>}
            </label>
          ))}
        </div>
      )}
      {block.type === "stage" && (
        <>
          <p className="preview-block-summary">
            {character?.displayName || asset?.name || block.transition?.name || "按片段舞台状态执行"}
            {block.position ? ` · ${block.position}` : ""}
            {block.transition?.name ? ` · ${block.transition.name} / ${block.transition.durationMs || block.durationMs || 0}ms` : " · 无额外过渡"}
          </p>
          {expanded && (
            <div className="stage-performance-editor">
              <label>操作<select value={block.action} onChange={(event) => onCommit({ ...block, action: event.target.value as typeof block.action, assetId: undefined, characterId: undefined, expressionId: undefined, transition: undefined })}>{Object.entries(stageActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {block.action === "set-background" && <label>背景素材<select value={block.assetId || ""} onChange={(event) => onCommit({ ...block, assetId: event.target.value || undefined })}><option value="">未设置</option>{project.assets.filter((item) => item.kind === "background").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              {["play-bgm", "play-sfx", "play-video"].includes(block.action) && <label>播放素材<select value={block.assetId || ""} onChange={(event) => onCommit({ ...block, assetId: event.target.value || undefined })}><option value="">未设置</option>{project.assets.filter((item) => block.action === "play-bgm" ? item.kind === "bgm" : block.action === "play-sfx" ? item.kind === "sfx" : item.kind === "video").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              {["enter-character", "exit-character", "move-character", "set-expression"].includes(block.action) && <label>角色<select value={block.characterId || ""} onChange={(event) => onCommit({ ...block, characterId: event.target.value || undefined, expressionId: undefined })}><option value="">选择角色</option>{project.characters.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
              {block.characterId && !["exit-character", "move-character"].includes(block.action) && <label>差分<select value={block.expressionId || ""} onChange={(event) => onCommit({ ...block, expressionId: event.target.value || undefined })}><option value="">角色默认</option>{character?.expressions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              <label>演出效果<select value={block.transition?.name || "direct"} onChange={(event) => onCommit({ ...block, transition: event.target.value === "direct" ? undefined : { name: event.target.value, durationMs: WEBGAL_ANIMATION_PRESETS.find((preset) => preset.name === event.target.value)?.durationMs || block.transition?.durationMs || 420 } })}><option value="direct">直接切换</option>{WEBGAL_ANIMATION_PRESETS.filter((preset) => block.action === "transition" || block.action === "exit-character" ? preset.name === "exit" || block.action === "transition" : ["enter", "enter-from-left", "enter-from-right", "enter-from-bottom"].includes(preset.name)).map((preset) => <option key={preset.name} value={preset.name}>{preset.label}</option>)}</select></label>
              <label>效果时长<select value={String(block.transition?.durationMs || block.durationMs || 420)} disabled={!block.transition && !block.durationMs} onChange={(event) => onCommit({ ...block, transition: block.transition ? { ...block.transition, durationMs: Number(event.target.value) } : undefined, durationMs: block.transition ? block.durationMs : Number(event.target.value) })}><option value="260">快速 · 260ms</option><option value="420">自然 · 420ms</option><option value="700">缓慢 · 700ms</option><option value="1000">强调 · 1000ms</option></select></label>
              {block.characterId && ["enter-character", "set-expression", "move-character"].includes(block.action) && (
                <FigureStageEditor
                  asset={stageFigureAsset}
                  assetUrl={stageFigureUrl}
                  backgroundUrl={backgroundUrl}
                  characterName={character?.displayName || "当前角色"}
                  position={block.position || assetDefaultPosition(stageFigureAsset)}
                  transform={block.transform || assetDefaultTransform(stageFigureAsset)}
                  shot={figureShotFromTransform(block.transform || assetDefaultTransform(stageFigureAsset), stageFigureAsset)}
                  onCommit={(layout) => onCommit({ ...block, position: layout.position, transform: layout.transform })}
                  onReset={() => onCommit({ ...block, position: assetDefaultPosition(stageFigureAsset), transform: assetDefaultTransform(stageFigureAsset) })}
                  compact
                />
              )}
            </div>
          )}
        </>
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
      {block.type === "native" && <pre className="preview-native-summary">{block.script}</pre>}
      {block.type === "comment" && <p className="preview-block-summary">{block.text}</p>}
    </article>
  );
}

function SimplePreviewWorkspace({
  project,
  selectedSceneId,
  onSelectScene,
  onChange,
  onExitPreview,
}: PreviewWorkspaceProps) {
  const scene = project.scenes.find((item) => item.id === selectedSceneId) || project.scenes[0];
  const [draftScene, setDraftScene] = useState<StoryScene>(() => structuredClone(scene));
  const [dirtyBlockIds, setDirtyBlockIds] = useState<Set<string>>(() => new Set());
  const [pendingReplayBlockId, setPendingReplayBlockId] = useState<string>();
  const [replayStartBlockId, setReplayStartBlockId] = useState<string>();
  const draftSceneId = useRef(scene.id);
  const workingScene = draftScene.id === scene.id ? draftScene : scene;
  const previewAssetUrls = useProjectAssetUrls(project);
  const previewBackground = project.assets.find((asset) => asset.id === workingScene?.entryStage?.backgroundAssetId)
    || project.assets.find((asset) => asset.kind === "background");
  const previewBackgroundUrl = resolveRegisteredAssetUrl(previewBackground, previewAssetUrls);
  const [restartKey, setRestartKey] = useState(0);
  const [generatingVoiceId, setGeneratingVoiceId] = useState<string>();
  const [ttsMessage, setTtsMessage] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [webgalUrl, setWebgalUrl] = useState("");
  const [webgalStatus, setWebgalStatus] = useState("正在编译 WebGAL 实机…");
  const [webgalWarnings, setWebgalWarnings] = useState<string[]>([]);
  const [directorChoice, setDirectorChoice] = useState<{ sceneId: string; value: boolean }>();
  const directorEnabled = directorChoice?.sceneId === scene.id ? directorChoice.value : scene.staging?.enabled !== false;
  const performanceCues = scene.staging?.cues || [];
  const layeredMotionPreview = Boolean(scene && sceneUsesLayeredMotion(project, scene));
  const previewProject = useMemo(() => ({
    ...project,
    scenes: project.scenes.map((item) => item.id === scene.id
      ? { ...item, staging: { enabled: directorEnabled, cues: item.staging?.cues || [], revision: item.staging?.revision } }
      : item),
  }), [directorEnabled, project, scene.id]);
  const [playerLanguage, setPlayerLanguage] = useState(() => {
    if (typeof window === "undefined") return "2";
    const saved = window.localStorage.getItem("lang");
    return ["0", "1", "2"].includes(saved || "") ? saved! : "2";
  });
  const previewPane = useResizablePane("gal-preview-editor-width-v3", 520, 420, 820);
  const stageCardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const switchingScene = draftSceneId.current !== scene.id;
    if (!switchingScene && dirtyBlockIds.size) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      draftSceneId.current = scene.id;
      setDraftScene(structuredClone(scene));
      if (switchingScene) {
        setDirtyBlockIds(new Set());
        setPendingReplayBlockId(undefined);
        setReplayStartBlockId(undefined);
      }
    });
    return () => { cancelled = true; };
  }, [dirtyBlockIds.size, scene]);

  useEffect(() => {
    window.localStorage.setItem("lang", playerLanguage);
  }, [playerLanguage]);

  useEffect(() => {
    let cancelled = false;
    if (!scene) return;
    if (layeredMotionPreview) {
      queueMicrotask(() => {
        if (cancelled) return;
        setWebgalUrl("");
        setWebgalWarnings([]);
        setWebgalStatus("独立眼嘴运行时已就绪");
      });
      return () => { cancelled = true; };
    }
    queueMicrotask(() => {
      if (cancelled) return;
      setWebgalStatus("正在编译 WebGAL 实机…");
      setWebgalUrl("");
    });
    void prepareWebGalPreview(previewProject, scene.id, { startBlockId: replayStartBlockId }).then((prepared) => {
      if (cancelled) return;
      setWebgalUrl(prepared.url);
      setWebgalWarnings(prepared.warnings);
      setWebgalStatus("WebGAL 实机已就绪");
    }).catch((error) => {
      if (cancelled) return;
      setWebgalStatus(error instanceof Error ? error.message : "WebGAL 实机预览准备失败");
    });
    return () => { cancelled = true; };
  }, [layeredMotionPreview, previewProject, replayStartBlockId, restartKey, scene]);

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

  const updateBlock = (nextBlock: StoryBlock, replayBlockId?: string) => {
    const currentBlock = workingScene.blocks.find((block) => block.id === nextBlock.id);
    if (!currentBlock || JSON.stringify(currentBlock) === JSON.stringify(nextBlock)) return;
    setDraftScene((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === nextBlock.id ? nextBlock : block) }));
    setDirtyBlockIds((items) => new Set(items).add(nextBlock.id));
    setPendingReplayBlockId(replayBlockId || nextBlock.id);
  };

  const applyDraft = () => {
    if (!dirtyBlockIds.size) return;
    const remainingIds = new Set(workingScene.blocks.map((block) => block.id));
    const removedIds = new Set(scene.blocks.filter((block) => !remainingIds.has(block.id)).map((block) => block.id));
    const cleanReferences = (item: StoryScene): StoryScene => ({
      ...item,
      blocks: item.blocks.map((block): StoryBlock => {
        if (block.type === "choice") return {
          ...block,
          options: block.options.map((option) => ({
            ...option,
            targetBlockId: option.targetBlockId && removedIds.has(option.targetBlockId) ? undefined : option.targetBlockId,
            targetChoiceGroupId: option.targetChoiceGroupId && removedIds.has(option.targetChoiceGroupId) ? undefined : option.targetChoiceGroupId,
          })),
        };
        if (block.type === "dialogue") return { ...block, choiceReactions: block.choiceReactions?.filter((reaction) => !removedIds.has(reaction.choiceBlockId)) };
        if (block.type === "jump" && block.targetBlockId && removedIds.has(block.targetBlockId)) return { ...block, targetBlockId: undefined };
        return block;
      }),
    });
    const nextProject = {
      ...project,
      scenes: project.scenes.map((item) => cleanReferences(item.id === scene.id ? workingScene : item)),
      updatedAt: nowIso(),
    };
    setReplayStartBlockId(pendingReplayBlockId);
    setDirtyBlockIds(new Set());
    onChange(nextProject, `应用「${scene.name}」的 ${dirtyBlockIds.size} 处试玩修订`);
    setRestartKey((value) => value + 1);
  };

  const discardDraft = () => {
    setDraftScene(structuredClone(scene));
    setDirtyBlockIds(new Set());
    setPendingReplayBlockId(undefined);
  };

  const replayFromBlock = (blockId: string) => {
    setPendingReplayBlockId(blockId);
    if (dirtyBlockIds.size) return;
    setReplayStartBlockId(blockId);
    setRestartKey((value) => value + 1);
  };

  const updatePerformanceCues = (cues: PerformanceCue[], label: string) => {
    onChange({
      ...project,
      scenes: project.scenes.map((item) => item.id === scene.id
        ? { ...item, staging: { enabled: item.staging?.enabled !== false, cues, revision: (item.staging?.revision || 0) + 1 } }
        : item),
      updatedAt: nowIso(),
    }, label);
  };

  const insertBlock = (at: number, kind: InsertBlockKind) => {
    const firstCharacter = project.characters[0];
    const firstExpressionId = firstCharacter?.defaultExpressionId || firstCharacter?.expressions[0]?.id;
    const base = { id: createId(kind), source: "human" as const, createdAt: nowIso() };
    let block: StoryBlock;
    if (kind === "dialogue" && firstCharacter) block = { ...base, type: "dialogue", characterId: firstCharacter.id, expressionId: firstExpressionId, text: "新台词" };
    else if (kind === "choice") {
      const draftProject = { ...project, scenes: project.scenes.map((item) => item.id === workingScene.id ? workingScene : item) };
      block = {
        ...base,
        type: "choice",
        ...nextChoiceGroupIdentity(draftProject, workingScene),
        prompt: "玩家要怎么回应？",
        options: [{ id: createId("option"), label: "选项一" }, { id: createId("option"), label: "选项二" }],
      };
    } else if (kind === "background") block = { ...base, type: "stage", action: "set-background", assetId: project.assets.find((item) => item.kind === "background")?.id };
    else if (kind === "figure") block = { ...base, type: "stage", action: "enter-character", characterId: firstCharacter?.id, expressionId: firstExpressionId, position: "center" };
    else if (kind === "bgm") block = { ...base, type: "stage", action: "play-bgm", assetId: project.assets.find((item) => item.kind === "bgm")?.id, volume: 0.25 };
    else if (kind === "sfx") block = { ...base, type: "stage", action: "play-sfx", assetId: project.assets.find((item) => item.kind === "sfx")?.id };
    else if (kind === "wait") block = { ...base, type: "stage", action: "wait", durationMs: 500 };
    else if (kind === "animation") block = { ...base, type: "stage", action: "transition", animationTarget: "stage-main", transition: { name: "shake", durationMs: 1000 } };
    else block = { ...base, type: "narration", text: "新旁白" };
    setDraftScene((current) => {
      const blocks = [...current.blocks];
      blocks.splice(Math.max(0, Math.min(at, blocks.length)), 0, block);
      return { ...current, blocks };
    });
    setDirtyBlockIds((items) => new Set(items).add(block.id));
    setPendingReplayBlockId(block.id);
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    const index = workingScene.blocks.findIndex((block) => block.id === blockId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= workingScene.blocks.length) return;
    const blocks = [...workingScene.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    setDraftScene({ ...workingScene, blocks });
    setDirtyBlockIds((items) => new Set(items).add(blockId).add(blocks[index].id));
    setPendingReplayBlockId(blockId);
  };

  const deleteBlock = (blockId: string) => {
    setDraftScene((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== blockId) }));
    setDirtyBlockIds((items) => new Set(items).add(blockId));
    const index = workingScene.blocks.findIndex((block) => block.id === blockId);
    setPendingReplayBlockId(workingScene.blocks[index + 1]?.id || workingScene.blocks[index - 1]?.id);
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
          ...workingScene,
          blocks: workingScene.blocks.map((itemBlock) => itemBlock.id === block.id && itemBlock.type === "dialogue"
            ? { ...itemBlock, voiceAssetId: assetId }
            : itemBlock),
        } : item),
        updatedAt: nowIso(),
      }, `为「${scene.name}」生成 TTS 语音`, "ai");
      setDirtyBlockIds(new Set());
      setTtsMessage("语音已生成并绑定；WebGAL 会按真实音量驱动嘴型。 ");
      setRestartKey((value) => value + 1);
    } catch (error) {
      setTtsMessage(error instanceof Error ? error.message : "TTS 生成失败");
    } finally {
      setGeneratingVoiceId(undefined);
    }
  };

  return (
    <div className={`simple-preview-page ${focusMode ? "is-focus-mode" : ""}`}>
      <header className="preview-workbench-header">
        <div className="preview-workbench-title">
          <button className="preview-icon-button" onClick={onExitPreview} title="返回故事地图" aria-label="返回故事地图">
            <ArrowLeft size={17} />
          </button>
          <div>
            <strong>{scene?.name || "当前片段"}</strong>
          </div>
          <select className="preview-scene-select" value={scene?.id || ""} onChange={(event) => {
            if (dirtyBlockIds.size && !window.confirm("当前片段还有未应用的修改。切换后会放弃，继续吗？")) return;
            onSelectScene(event.target.value);
            setRestartKey((value) => value + 1);
          }} aria-label="选择剧情片段">
            {project.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="preview-workbench-actions">
          <button className={!focusMode ? "active" : ""} onClick={() => setFocusMode(false)}>
            <PanelLeftOpen size={15} /> 编辑 + 实机
          </button>
          <button className={focusMode ? "active" : ""} onClick={() => setFocusMode(true)}>
            <PanelLeftClose size={15} /> 专注试玩
          </button>
        </div>
      </header>
      {scene && (
        <div className="simple-preview-layout" style={{ gridTemplateColumns: focusMode ? "minmax(0, 1fr)" : `${previewPane.width}px 8px minmax(680px, 1fr)` }}>
          <aside className="preview-editor-panel">
            <section className="simple-performance-plan">
              <header>
                <div><strong>立绘演出计划</strong><small>默认保持不动，只在有剧情理由时执行小动作</small></div>
                <div className="simple-director-ab">
                  <button className={!directorEnabled ? "active" : ""} onClick={() => { setDirectorChoice({ sceneId: scene.id, value: false }); setRestartKey((value) => value + 1); }}>静态 A</button>
                  <button className={directorEnabled ? "active" : ""} onClick={() => { setDirectorChoice({ sceneId: scene.id, value: true }); setRestartKey((value) => value + 1); }}>导演 B</button>
                </div>
              </header>
              <div className="simple-performance-cues">
                {performanceCues.length ? performanceCues.map((cue) => {
                  const block = scene.blocks.find((item) => item.id === cue.blockId);
                  const character = project.characters.find((item) => item.id === cue.targetCharacterId);
                  const intent = {
                    hold: "保持", enter: "轻入场", exit: "轻离场", "expression-change": "表情柔切", "pose-change": "姿势柔切",
                    "listener-react": "听者反应", "micro-emphasis": "轻强调", "micro-recoil": "轻退", reframe: "重新构图",
                  }[cue.intent];
                  return (
                    <article key={cue.id} className={cue.disabled ? "is-disabled" : ""}>
                      <button className="simple-cue-play" onClick={() => replayFromBlock(cue.blockId)} title="从此处试玩"><Play size={11} /></button>
                      <div><strong>{intent} · {character?.displayName || "画面"}</strong><p>{block?.type === "dialogue" || block?.type === "narration" ? block.text : block?.id}</p><small>{cue.timing === "before-line" ? "台词前" : cue.timing === "during-line" ? `台词中${cue.anchorText ? ` · “${cue.anchorText}”` : ""}` : "台词后"} · {cue.reason || "hold"}</small></div>
                      <button onClick={() => updatePerformanceCues(performanceCues.map((item) => item.id === cue.id ? { ...item, disabled: !item.disabled } : item), cue.disabled ? "启用演出 Cue" : "停用演出 Cue")}>{cue.disabled ? "启用" : "停用"}</button>
                      <button onClick={() => updatePerformanceCues(performanceCues.filter((item) => item.id !== cue.id), "删除演出 Cue")}><Trash2 size={11} /></button>
                    </article>
                  );
                }) : <p className="simple-performance-empty">本段没有必要的可见动作。</p>}
              </div>
            </section>
            <section className="preview-block-editor">
              <header>
                <strong>{workingScene.name}</strong>
              </header>
              {dirtyBlockIds.size > 0 && <div className="preview-draft-toolbar is-dirty"><strong>{dirtyBlockIds.size} 处未应用</strong><button onClick={discardDraft}>放弃</button><button className="simple-primary" onClick={applyDraft}><Play size={12} /> 应用并从修改处试玩</button></div>}
              <div className="preview-block-list">
                <BlockInsertMenu onInsert={(kind) => insertBlock(0, kind)} canDialogue={project.characters.length > 0} />
                {workingScene.blocks.map((block) => {
                  const index = workingScene.blocks.findIndex((item) => item.id === block.id);
                  return (
                    <div className="preview-block-sequence" key={block.id}>
                      <PreviewBlockEditor
                        block={block}
                        index={index}
                        total={workingScene.blocks.length}
                        project={{ ...project, scenes: project.scenes.map((item) => item.id === workingScene.id ? workingScene : item) }}
                        previousChoice={precedingChoice(workingScene.blocks, index)}
                        assetUrls={previewAssetUrls}
                        backgroundUrl={previewBackgroundUrl}
                        onCommit={(nextBlock) => updateBlock(nextBlock)}
                        onReplayFromGroup={replayFromBlock}
                        onReplayFromBlock={replayFromBlock}
                        onMove={(direction) => moveBlock(block.id, direction)}
                        onDelete={() => deleteBlock(block.id)}
                        onGenerateVoice={generateVoice}
                        generatingVoice={generatingVoiceId === block.id}
                        dirty={dirtyBlockIds.has(block.id)}
                      />
                      <BlockInsertMenu onInsert={(kind) => insertBlock(index + 1, kind)} canDialogue={project.characters.length > 0} />
                    </div>
                  );
                })}
                {ttsMessage && <p className="preview-tts-message">{ttsMessage}</p>}
              </div>
            </section>
          </aside>
          {!focusMode && <SplitGrip onPointerDown={(event) => previewPane.startResize(event, "left")} label="拖动调整逐句编辑与实机画面宽度" />}
          <main className="play-stage-card" ref={stageCardRef}>
            <div className="play-stage-heading">
              <div><span>{project.chapters.find((chapter) => chapter.id === scene.chapterId)?.name}</span><strong>{scene.name}</strong></div>
              <div className="play-stage-actions">
                <div className="preview-language-switch" aria-label="WebGAL 界面语言">
                  {[{ value: "2", label: "日" }, { value: "0", label: "中" }, { value: "1", label: "EN" }].map((language) => <button key={language.value} className={playerLanguage === language.value ? "active" : ""} onClick={() => { setPlayerLanguage(language.value); setRestartKey((value) => value + 1); }}>{language.label}</button>)}
                </div>
                <button className="soft-button" onClick={() => { setReplayStartBlockId(undefined); setRestartKey((value) => value + 1); }}>
                  <RotateCcw size={14} /> 从本段开头重播
                </button>
                <button className="stage-fullscreen-button" onClick={() => void toggleFullscreen()}>
                  <Maximize2 size={15} /> {fullscreen ? "退出全屏" : "全屏试玩"}
                </button>
              </div>
            </div>
            <div className="webgal-live-stage">
              {layeredMotionPreview
                ? <DynamicGalgameStage project={project} scene={scene} directorEnabled={directorEnabled} restartKey={restartKey} />
                : webgalUrl
                  ? <iframe src={webgalUrl} title={`WebGAL 实机 · ${scene.name}`} allow="autoplay; fullscreen" />
                  : <div className="webgal-live-stage__loading"><Gamepad2 size={28} /><strong>{webgalStatus}</strong></div>}
            </div>
            {!layeredMotionPreview && webgalWarnings.length > 0 && <button className="webgal-preview-warning" title={webgalWarnings.join(" · ")}><TriangleAlert size={13} /> {webgalWarnings.length}</button>}
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
            <footer><button onClick={onClose}>取消</button><button className="simple-primary" onClick={() => onCreateScene(sceneDraft)} disabled={!sceneDraft.name.trim() || !sceneDraft.chapterId}>创建并开始写</button></footer>
          </>
        ) : (
          <>
            <label>章节标题<input value={chapterDraft.name} onChange={(event) => setChapterDraft({ ...chapterDraft, name: event.target.value })} placeholder="章节 2 · 雪夜来信" /></label>
            <label>章节说明<textarea rows={5} value={chapterDraft.description} onChange={(event) => setChapterDraft({ ...chapterDraft, description: event.target.value })} placeholder="这一章的主题、时间和主要目标…" /></label>
            <footer><button onClick={onClose}>取消</button><button className="simple-primary" onClick={() => onCreateChapter(chapterDraft)} disabled={!chapterDraft.name.trim()}>创建章节</button></footer>
          </>
        )}
      </div>
    </div>
  );
}

function RuntimeExportDialog({ project, onChange, onClose }: {
  project: StoryProject;
  onChange: Props["onChange"];
  onClose: () => void;
}) {
  const [slug, setSlug] = useState(project.slug);
  const [version, setVersion] = useState(project.version);
  const [originsText, setOriginsText] = useState(project.settings.blogBridge.allowedOrigins.join("\n"));
  const [state, setState] = useState<"idle" | "runtime" | "backup" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const origins = useMemo(() => originsText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean), [originsText]);
  const configured = useMemo<StoryProject>(() => ({
    ...project,
    slug: slug.trim(),
    version: version.trim(),
    settings: {
      ...project.settings,
      webgalVersion: "4.6.2",
      blogBridge: {
        ...project.settings.blogBridge,
        enabled: true,
        channel: "gal-blog-game",
        allowedOrigins: origins,
        capabilities: ["return-menu", "open-article", "save-progress", "open-comment-form", "get-runtime-data"],
      },
    },
  }), [origins, project, slug, version]);
  const issues = useMemo(() => inspectRuntimeExport(configured, { allowedHostOrigins: origins }), [configured, origins]);
  const errors = issues.filter((issue) => issue.severity === "error");

  const persistSettings = () => {
    if (configured.slug === project.slug
      && configured.version === project.version
      && JSON.stringify(configured.settings.blogBridge) === JSON.stringify(project.settings.blogBridge)
      && configured.settings.webgalVersion === project.settings.webgalVersion) return;
    onChange(configured, "更新正式导出设置");
  };

  const exportRuntime = async () => {
    if (errors.length) return;
    setState("runtime");
    setMessage("正在收集内置引擎、剧本和已引用素材…");
    try {
      const result = await createRuntimeZipWithAssets(configured, { allowedHostOrigins: origins });
      downloadBlob(result.blob, result.fileName);
      persistSettings();
      setState("done");
      setMessage(`正式包已生成 · ${result.manifest.game.releaseId}`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "正式包导出失败");
    }
  };

  const exportBackup = () => {
    setState("backup");
    try {
      downloadBlob(createStoryJson(configured), projectBackupFileName(configured));
      persistSettings();
      setState("done");
      setMessage("工程备份已生成；它可重新导入 Studio，不是公开游戏包。");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "工程备份导出失败");
    }
  };

  return (
    <div className="runtime-export-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="runtime-export-dialog" role="dialog" aria-modal="true" aria-labelledby="runtime-export-title">
        <header>
          <div><span>正式发布</span><h2 id="runtime-export-title">导出可玩的游戏</h2><p>公开运行包与可重新编辑的工程备份分开生成。</p></div>
          <button onClick={onClose} aria-label="关闭导出面板"><X size={18} /></button>
        </header>
        <div className="runtime-export-fields">
          <label><span>游戏 slug</span><input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="alice-tea-room" /><small>用于 Blog 的固定目录名；发布后不要随意改名。</small></label>
          <label><span>游戏版本</span><input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="0.1.0" /><small>releaseId 会在版本后追加内容指纹。</small></label>
          <label className="runtime-export-origins"><span>允许嵌入的 Blog origin</span><textarea value={originsText} onChange={(event) => setOriginsText(event.target.value)} rows={3} placeholder={"https://your-blog.example\nhttp://localhost:4321"} /><small>每行一个精确 origin，必须包含 http/https；不允许 *、路径或查询参数。</small></label>
        </div>
        <div className={`runtime-export-check ${errors.length ? "has-errors" : "is-ready"}`}>
          <div><strong>{errors.length ? `还有 ${errors.length} 项会阻止发布` : "发布检查通过"}</strong><span>{errors.length ? "修正后才会读取素材和打包。" : "将内置 WebGAL 4.6.2，并生成版本清单与逐文件校验。"}</span></div>
          <ul>
            {issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={issue.severity}><b>{issue.severity === "error" ? "阻止" : "提醒"}</b><span>{issue.message}</span></li>)}
            {!issues.length && <li><b>完成</b><span>剧情引用、启动目标、Blog 合约和导出路径均可发布。</span></li>}
          </ul>
        </div>
        <div className="runtime-export-products">
          <article><div><Download size={20} /><span><strong>正式可玩包</strong><small>自包含 runtime ZIP · 可独立静态运行 · 可由 Blog iframe 加载</small></span></div><button className="simple-primary" disabled={errors.length > 0 || state === "runtime"} onClick={() => void exportRuntime()}>{state === "runtime" ? "正在打包…" : "导出正式可玩包"}</button></article>
          <article><div><FileJson size={20} /><span><strong>工程备份</strong><small>完整 Story IR · 用于回到 Studio 继续编辑 · 不含 API 密钥</small></span></div><button disabled={state === "backup"} onClick={exportBackup}>{state === "backup" ? "正在生成…" : "导出工程备份"}</button></article>
        </div>
        {message && <p className={`runtime-export-message ${state}`}>{message}</p>}
        <footer><span>正式包根目录可直接部署；不要把工程备份放进公开游戏目录。</span><button onClick={onClose}>完成</button></footer>
      </section>
    </div>
  );
}

export function SimpleStudio({
  project,
  selectedSceneId,
  savedAt,
  canUndo,
  canRedo,
  onSelectScene,
  onChange,
  onUndo,
  onRedo,
}: Props) {
  const [section, setSection] = useState<SimpleSection>("story");
  const [creationKind, setCreationKind] = useState<"scene" | "chapter">();
  const [exportOpen, setExportOpen] = useState(false);
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
          <button className="simple-top-preview" onClick={() => setSection("preview")}><Play size={14} fill="currentColor" /> 试玩</button>
          <button className="simple-top-export" onClick={() => setExportOpen(true)}><Download size={14} /> 导出</button>
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
          <StudioGuideAssistant project={project} selectedSceneId={selectedSceneId} section={section} onChange={onChange} />
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
      {exportOpen && <RuntimeExportDialog project={project} onChange={onChange} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
