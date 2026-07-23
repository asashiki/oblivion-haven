"use client";

import {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import {
  BookOpen,
  Eye,
  EyeOff,
  Flag,
  GitBranch,
  LayoutPanelTop,
  LockKeyhole,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { layoutRoutesTopDown, routeDisplayPosition, routeStoredPosition } from "@/lib/story/routeLayout";
import type { RouteEdge, RouteNode, RouteNodeKind, StoryProject } from "@/lib/story/types";
import { createId } from "@/lib/story/utils";

type RouteNodeData = {
  route: RouteNode;
  sceneName?: string;
  sceneMode?: string;
  blockCount?: number;
  characterName?: string;
  playerView: boolean;
};

type Props = {
  project: StoryProject;
  onChange: (project: StoryProject, label: string) => void;
  onOpenScene: (sceneId: string) => void;
};

const kindLabels: Record<RouteNodeKind, string> = {
  start: "START",
  scene: "场景",
  "common-route": "公共路线",
  "character-route": "角色路线",
  "character-story": "角色故事",
  "scene-story": "场景故事",
  ending: "结局",
  "bad-ending": "BAD END",
  "true-ending": "TRUE END",
};

function KindIcon({ kind }: { kind: RouteNodeKind }) {
  if (kind === "start") return <Flag size={13} />;
  if (kind.includes("character")) return <UserRound size={13} />;
  if (kind.includes("ending")) return <Sparkles size={13} />;
  if (kind === "scene-story") return <BookOpen size={13} />;
  return <GitBranch size={13} />;
}

function RouteNodeCard({ data }: NodeProps<Node<RouteNodeData>>) {
  const { route, sceneName, sceneMode, blockCount, characterName, playerView } = data;
  return (
    <div className={`route-node route-node--${route.kind}`} style={{ "--node-color": route.color || "#8190d5" } as React.CSSProperties}>
      <Handle type="target" position={Position.Top} />
      <div className="route-node__top">
        <span><KindIcon kind={route.kind} /> {kindLabels[route.kind]}</span>
        <span className="route-node__flags">
          {route.unlockCondition && <LockKeyhole size={11} />}
          {route.hiddenFromPlayer && (playerView ? <EyeOff size={11} /> : <Eye size={11} />)}
        </span>
      </div>
      <div className="route-node__content">
        <span className="route-node__thumb"><i />{sceneMode?.toUpperCase() || "—"}</span>
        <div>
          <strong>{route.title}</strong>
          <small>{sceneName || "未绑定场景"}{characterName ? ` · ${characterName}` : ""}</small>
          {blockCount !== undefined && <em>{blockCount} BLOCKS</em>}
        </div>
      </div>
      {route.condition && <code>{route.condition}</code>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { route: RouteNodeCard };

export function NarrativeMap({ project, onChange, onOpenScene }: Props) {
  const [playerView, setPlayerView] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [layoutRevision, setLayoutRevision] = useState(0);
  const direction = project.routeMap.layoutDirection;

  const visibleNodeIds = useMemo(() => new Set(project.routeMap.nodes
    .filter((node) => !playerView || !node.hiddenFromPlayer)
    .map((node) => node.id)), [playerView, project.routeMap.nodes]);

  const nodes = useMemo<Node<RouteNodeData>[]>(() => project.routeMap.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((route) => {
      const scene = project.scenes.find((item) => item.id === route.sceneId);
      return {
        id: route.id,
        type: "route",
        ariaLabel: `路线节点 ${route.title}`,
        position: routeDisplayPosition(route, direction),
        data: {
          route,
          playerView,
          sceneName: scene?.name,
          sceneMode: scene?.mode,
          blockCount: scene?.blocks.length,
          characterName: project.characters.find((character) => character.id === route.characterId)?.displayName,
        },
        selected: route.id === selectedNodeId,
      };
    }), [direction, playerView, project.characters, project.scenes, project.routeMap.nodes, selectedNodeId, visibleNodeIds]);

  const edges = useMemo<Edge[]>(() => project.routeMap.edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target) && (!playerView || !edge.hiddenFromPlayer))
    .map((edge) => ({
      id: edge.id,
      ariaLabel: `剧情分支 ${edge.label || edge.condition || `${edge.source} 到 ${edge.target}`}`,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      label: edge.label || edge.condition,
      selected: edge.id === selectedEdgeId,
      markerEnd: { type: MarkerType.ArrowClosed, color: edge.id === selectedEdgeId ? "#d8c67b" : "#7181b9" },
      style: {
        stroke: edge.id === selectedEdgeId ? "#d8c67b" : edge.condition ? "#b68ac8" : "#66739c",
        strokeWidth: edge.id === selectedEdgeId ? 2.2 : 1.5,
        strokeDasharray: edge.condition ? "5 4" : undefined,
      },
      labelStyle: { fill: "#aeb7d4", fontSize: 10 },
      labelBgStyle: { fill: "#151a2b", fillOpacity: 0.94 },
      labelBgPadding: [5, 3] as [number, number],
      labelBgBorderRadius: 3,
    })), [playerView, project.routeMap.edges, selectedEdgeId, visibleNodeIds]);

  const updateNodePosition = (id: string, x: number, y: number) => {
    const stored = routeStoredPosition({ x: Math.round(x), y: Math.round(y) }, direction);
    onChange({
      ...project,
      routeMap: {
        ...project.routeMap,
        nodes: project.routeMap.nodes.map((node) => node.id === id ? { ...node, ...stored } : node),
      },
    }, "移动路线节点");
  };

  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    if (project.routeMap.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) return;
    const edge: RouteEdge = { id: createId("edge"), source: connection.source, target: connection.target };
    onChange({ ...project, routeMap: { ...project.routeMap, edges: [...project.routeMap.edges, edge] } }, "连接剧情分支");
    setSelectedNodeId(undefined);
    setSelectedEdgeId(edge.id);
  };

  const addNode = (kind: RouteNodeKind) => {
    const scene = project.scenes[0];
    const deepestY = Math.max(18, ...project.routeMap.nodes.map((node) => routeDisplayPosition(node, direction).y));
    const displayPosition = { x: 360, y: deepestY + 142 };
    const node: RouteNode = {
      id: createId("route"),
      kind,
      title: kindLabels[kind],
      sceneId: scene?.id,
      ...routeStoredPosition(displayPosition, direction),
      replayable: true,
      color: kind.includes("ending") ? "#d7b967" : "#8190d5",
    };
    onChange({ ...project, routeMap: { ...project.routeMap, nodes: [...project.routeMap.nodes, node] } }, `添加${kindLabels[kind]}节点`);
    setSelectedEdgeId(undefined);
    setSelectedNodeId(node.id);
  };

  const applyVerticalLayout = () => {
    const displayNodes = project.routeMap.nodes.map((node) => ({
      ...node,
      ...routeDisplayPosition(node, direction),
    }));
    const layouted = layoutRoutesTopDown(displayNodes, project.routeMap.edges);
    onChange({
      ...project,
      routeMap: {
        ...project.routeMap,
        layoutDirection: "top-down",
        nodes: layouted,
      },
    }, "自动整理为竖向剧情树");
    setLayoutRevision((value) => value + 1);
  };

  const selectedNode = project.routeMap.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = project.routeMap.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedScene = project.scenes.find((scene) => scene.id === selectedNode?.sceneId);
  const selectedBackgroundBlock = selectedScene?.blocks.find((block) => block.type === "stage" && block.action === "set-background");
  const selectedBackgroundId = selectedScene?.entryStage?.backgroundAssetId
    || (selectedBackgroundBlock?.type === "stage" ? selectedBackgroundBlock.assetId : undefined);
  const selectedBackground = project.assets.find((asset) => asset.id === selectedBackgroundId);
  const selectedExcerpt = selectedScene?.blocks.find((block) => block.type === "dialogue" || block.type === "narration");

  const updateSelected = (patch: Partial<RouteNode>) => {
    if (!selectedNode) return;
    onChange({
      ...project,
      routeMap: { ...project.routeMap, nodes: project.routeMap.nodes.map((node) => node.id === selectedNode.id ? { ...node, ...patch } : node) },
    }, "编辑路线节点");
  };

  const updateSelectedEdge = (patch: Partial<RouteEdge>) => {
    if (!selectedEdge) return;
    onChange({
      ...project,
      routeMap: { ...project.routeMap, edges: project.routeMap.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, ...patch } : edge) },
    }, "编辑路线分支");
  };

  const removeSelectedEdge = () => {
    if (!selectedEdge) return;
    onChange({
      ...project,
      routeMap: { ...project.routeMap, edges: project.routeMap.edges.filter((edge) => edge.id !== selectedEdge.id) },
    }, "删除路线连线");
    setSelectedEdgeId(undefined);
  };

  return (
    <div className="map-workspace">
      <div className="map-toolbar">
        <div>
          <span className="eyebrow">VERTICAL NARRATIVE ORCHESTRATION</span>
          <h2>叙事地图</h2>
        </div>
        <button className="map-layout-button" onClick={applyVerticalLayout} title="按故事先后自动排成竖向主轴，分支向左右展开">
          <LayoutPanelTop size={14} /> 自动竖排
        </button>
        <div className="segmented">
          <button className={!playerView ? "active" : ""} onClick={() => setPlayerView(false)}>作者视图</button>
          <button className={playerView ? "active" : ""} onClick={() => setPlayerView(true)}>玩家视图</button>
        </div>
        {!playerView && (
          <div className="map-add">
            <button onClick={() => addNode("scene")}><Plus size={14} /> 场景</button>
            <button onClick={() => addNode("character-story")}><Plus size={14} /> 角色故事</button>
            <button onClick={() => addNode("ending")}><Plus size={14} /> 结局</button>
          </div>
        )}
      </div>
      <div className="map-body">
        <div className="map-canvas">
          <ReactFlow
            key={`${playerView ? "player" : "author"}-${layoutRevision}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.3}
            maxZoom={1.8}
            nodesDraggable={!playerView}
            nodesConnectable={!playerView}
            nodesFocusable
            edgesFocusable
            elementsSelectable
            onConnect={connect}
            onNodeClick={(_, node) => {
              setSelectedEdgeId(undefined);
              setSelectedNodeId(node.id);
            }}
            onNodeDoubleClick={(_, node) => {
              const sceneId = project.routeMap.nodes.find((item) => item.id === node.id)?.sceneId;
              if (sceneId) onOpenScene(sceneId);
            }}
            onNodeDragStop={(_, node) => updateNodePosition(node.id, node.position.x, node.position.y)}
            onEdgeClick={(_, edge) => {
              setSelectedNodeId(undefined);
              setSelectedEdgeId(edge.id);
            }}
            onPaneClick={() => {
              setSelectedNodeId(undefined);
              setSelectedEdgeId(undefined);
            }}
            onEdgesDelete={(deleted) => onChange({
              ...project,
              routeMap: { ...project.routeMap, edges: project.routeMap.edges.filter((edge) => !deleted.some((item) => item.id === edge.id)) },
            }, "删除路线连线")}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#343b57" />
            <Controls showInteractive={false} />
            <MiniMap nodeColor={(node) => String((node.data as RouteNodeData)?.route.color || "#8190d5")} maskColor="rgba(8,10,18,.78)" />
          </ReactFlow>
        </div>
        <aside className="map-inspector">
          {selectedNode ? (
            <>
              <span className="eyebrow">{playerView ? "SCENE MEMORY" : "NODE INSPECTOR"}</span>
              <div className="map-scene-card">
                <div className="map-scene-card__visual">
                  <span>{selectedBackground?.name || "NO BACKGROUND ASSET"}</span>
                  <b>{selectedScene?.mode.toUpperCase() || "ROUTE"}</b>
                </div>
                <div>
                  <small>{kindLabels[selectedNode.kind]}</small>
                  <strong>{selectedNode.title}</strong>
                  <p>
                    {selectedExcerpt?.type === "dialogue" || selectedExcerpt?.type === "narration"
                      ? selectedExcerpt.text
                      : selectedScene?.summary || "这个节点还没有可预览的首句文本。"}
                  </p>
                </div>
              </div>
              {playerView ? (
                <div className="player-node-status">
                  <span className={selectedNode.unlockCondition ? "locked" : "open"}>{selectedNode.unlockCondition ? "条件解锁" : "已开放"}</span>
                  <span>{selectedNode.replayable ? "可重玩" : "仅流程进入"}</span>
                  {selectedNode.hiddenFromPlayer && <span>通常隐藏</span>}
                </div>
              ) : (
                <>
                  <label>标题<input value={selectedNode.title} onChange={(event) => updateSelected({ title: event.target.value })} /></label>
                  <label>类型
                    <select value={selectedNode.kind} onChange={(event) => updateSelected({ kind: event.target.value as RouteNodeKind })}>
                      {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>绑定场景
                    <select value={selectedNode.sceneId || ""} onChange={(event) => updateSelected({ sceneId: event.target.value || undefined })}>
                      <option value="">不绑定</option>
                      {project.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
                    </select>
                  </label>
                  <label>解锁条件<input value={selectedNode.unlockCondition || ""} onChange={(event) => updateSelected({ unlockCondition: event.target.value || undefined })} placeholder="alice_affection >= 5" /></label>
                  <label>节点条件<input value={selectedNode.condition || ""} onChange={(event) => updateSelected({ condition: event.target.value || undefined })} /></label>
                  <div className="check-row">
                    <label><input type="checkbox" checked={selectedNode.hiddenFromPlayer || false} onChange={(event) => updateSelected({ hiddenFromPlayer: event.target.checked })} /> 对玩家隐藏</label>
                    <label><input type="checkbox" checked={selectedNode.replayable || false} onChange={(event) => updateSelected({ replayable: event.target.checked })} /> 可重玩</label>
                  </div>
                </>
              )}
              {selectedNode.sceneId && <button className="inspector-open" onClick={() => onOpenScene(selectedNode.sceneId!)}><BookOpen size={14} /> 打开对应场景</button>}
            </>
          ) : selectedEdge ? (
            <>
              <span className="eyebrow">BRANCH INSPECTOR</span>
              <div className="branch-summary">
                <strong>{project.routeMap.nodes.find((node) => node.id === selectedEdge.source)?.title || selectedEdge.source}</strong>
                <GitBranch size={15} />
                <strong>{project.routeMap.nodes.find((node) => node.id === selectedEdge.target)?.title || selectedEdge.target}</strong>
              </div>
              {playerView ? (
                <p className="player-branch-copy">{selectedEdge.label || selectedEdge.condition || "无条件进入下一节点"}</p>
              ) : (
                <>
                  <label>分支名称<input value={selectedEdge.label || ""} onChange={(event) => updateSelectedEdge({ label: event.target.value || undefined })} placeholder="例如：提交成功" /></label>
                  <label>进入条件<input value={selectedEdge.condition || ""} onChange={(event) => updateSelectedEdge({ condition: event.target.value || undefined })} placeholder="alice_affection >= 5" /></label>
                  <label>优先级<input type="number" value={selectedEdge.priority ?? 0} onChange={(event) => updateSelectedEdge({ priority: Number(event.target.value) })} /></label>
                  <label className="inline-check"><input type="checkbox" checked={selectedEdge.hiddenFromPlayer || false} onChange={(event) => updateSelectedEdge({ hiddenFromPlayer: event.target.checked })} /> 对玩家隐藏这条分支</label>
                  <button className="danger-button" onClick={removeSelectedEdge}><Trash2 size={13} /> 删除这条连线</button>
                </>
              )}
            </>
          ) : (
            <div className="empty-inspector">
              <GitBranch size={26} />
              <strong>选择节点或分支</strong>
              <p>
                剧情沿竖向主轴向下推进，条件分支向左右展开。
                {playerView ? "选择节点查看场景记忆，双击可从允许重玩的节点进入。" : "作者视图可拖动、连线和修改条件。"}
              </p>
            </div>
          )}
          <div className="map-legend">
            <span><i style={{ background: "#63d1c7" }} /> 开始 / 公共线</span>
            <span><i style={{ background: "#b584c7" }} /> 角色故事</span>
            <span><i style={{ background: "#d8aa69" }} /> 场景故事</span>
            <span><i style={{ background: "#e6c977" }} /> 结局</span>
            <span><RotateCcw size={12} /> 双击可从节点重玩</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
