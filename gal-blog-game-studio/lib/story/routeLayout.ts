import type { RouteEdge, RouteNode } from "./types";

type LayoutOptions = {
  centerX?: number;
  top?: number;
  laneGap?: number;
  levelGap?: number;
};

export function layoutRoutesTopDown(
  nodes: RouteNode[],
  edges: RouteEdge[],
  options: LayoutOptions = {},
): RouteNode[] {
  const centerX = options.centerX ?? 360;
  const top = options.top ?? 56;
  const laneGap = options.laneGap ?? 316;
  const levelGap = options.levelGap ?? 142;
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });

  const roots = nodes
    .filter((node) => node.kind === "start" || (indegree.get(node.id) || 0) === 0)
    .sort((a, b) => a.x - b.x);
  const depth = new Map(roots.map((node) => [node.id, 0]));
  const visitFrom = (seed: RouteNode, seedDepth: number) => {
    if (!depth.has(seed.id)) depth.set(seed.id, seedDepth);
    const queue = [seed];
    while (queue.length) {
      const current = queue.shift()!;
      const currentDepth = depth.get(current.id) || 0;
      (outgoing.get(current.id) || []).forEach((targetId) => {
        if (depth.has(targetId)) return;
        depth.set(targetId, currentDepth + 1);
        const target = nodes.find((node) => node.id === targetId);
        if (target) queue.push(target);
      });
    }
  };
  roots.forEach((root) => visitFrom(root, 0));

  let fallbackDepth = Math.max(0, ...depth.values());
  nodes.forEach((node) => {
    if (depth.has(node.id)) return;
    fallbackDepth += 1;
    visitFrom(node, fallbackDepth);
    fallbackDepth = Math.max(fallbackDepth, ...depth.values());
  });

  const levels = new Map<number, RouteNode[]>();
  nodes.forEach((node) => {
    const nodeDepth = depth.get(node.id) || 0;
    levels.set(nodeDepth, [...(levels.get(nodeDepth) || []), node]);
  });

  const positions = new Map<string, { x: number; y: number }>();
  [...levels.entries()].sort(([a], [b]) => a - b).forEach(([nodeDepth, levelNodes]) => {
    const ordered = [...levelNodes].sort((a, b) => a.x - b.x || a.title.localeCompare(b.title));
    const firstX = centerX - ((ordered.length - 1) * laneGap) / 2;
    ordered.forEach((node, index) => {
      positions.set(node.id, { x: Math.round(firstX + index * laneGap), y: top + nodeDepth * levelGap });
    });
  });

  return nodes.map((node) => ({ ...node, ...(positions.get(node.id) || { x: node.x, y: node.y }) }));
}

export function routeDisplayPosition(node: RouteNode, direction: "top-down" | "left-right" | undefined) {
  return direction === "top-down" ? { x: node.x, y: node.y } : { x: node.y, y: node.x };
}

export function routeStoredPosition(
  position: { x: number; y: number },
  direction: "top-down" | "left-right" | undefined,
) {
  return direction === "top-down" ? position : { x: position.y, y: position.x };
}
