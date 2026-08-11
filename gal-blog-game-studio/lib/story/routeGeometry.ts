import { routeDisplayPosition } from "./routeLayout";
import type { RouteEdge, RouteNode, StoryProject } from "./types";

type Point = { x: number; y: number };

const NODE_WIDTH = 252;
const NODE_HEIGHT = 132;

function anchor(node: RouteNode, direction: "source" | "target", layoutDirection: StoryProject["routeMap"]["layoutDirection"]): Point {
  const position = routeDisplayPosition(node, layoutDirection);
  return direction === "source"
    ? { x: position.x + NODE_WIDTH / 2, y: position.y + NODE_HEIGHT }
    : { x: position.x + NODE_WIDTH / 2, y: position.y };
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isOnSegment(a: Point, b: Point, point: Point): boolean {
  const epsilon = 0.001;
  return Math.abs(orientation(a, b, point)) < epsilon
    && point.x >= Math.min(a.x, b.x) - epsilon
    && point.x <= Math.max(a.x, b.x) + epsilon
    && point.y >= Math.min(a.y, b.y) - epsilon
    && point.y <= Math.max(a.y, b.y) + epsilon;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return isOnSegment(a, b, c) || isOnSegment(a, b, d) || isOnSegment(c, d, a) || isOnSegment(c, d, b);
}

function segment(project: StoryProject, edge: RouteEdge, nodeOverride?: RouteNode): [Point, Point] | undefined {
  const source = nodeOverride?.id === edge.source ? nodeOverride : project.routeMap.nodes.find((node) => node.id === edge.source);
  const target = nodeOverride?.id === edge.target ? nodeOverride : project.routeMap.nodes.find((node) => node.id === edge.target);
  if (!source || !target) return undefined;
  return [anchor(source, "source", project.routeMap.layoutDirection), anchor(target, "target", project.routeMap.layoutDirection)];
}

export function routeEdgeWouldCross(project: StoryProject, candidate: RouteEdge, nodeOverride?: RouteNode): boolean {
  const candidateSegment = segment(project, candidate, nodeOverride);
  if (!candidateSegment) return false;
  return project.routeMap.edges.some((edge) => {
    if (edge.id === candidate.id) return false;
    if ([candidate.source, candidate.target].some((id) => id === edge.source || id === edge.target)) return false;
    const currentSegment = segment(project, edge, nodeOverride);
    return Boolean(currentSegment && segmentsCross(candidateSegment[0], candidateSegment[1], currentSegment[0], currentSegment[1]));
  });
}

export function movingRouteNodeWouldCross(project: StoryProject, node: RouteNode): boolean {
  return project.routeMap.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .some((edge) => routeEdgeWouldCross(project, edge, node));
}
