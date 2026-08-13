import { routeDisplayPosition, routeStoredPosition } from "./routeLayout";
import type { StoryProject } from "./types";

const CHAPTER_CARD_X = 64;
const CHAPTER_CARD_WIDTH = 320;
const CHAPTER_CARD_HEIGHT = 104;
const ROUTE_WIDTH = 224;
const ROUTE_HEIGHT = 104;

export type ChapterMapCluster = {
  chapterId: string;
  background: { x: number; y: number; width: number; height: number };
  card: { x: number; y: number; width: number; height: number };
  originY: number;
  routePositions: Record<string, { x: number; y: number }>;
  entryRouteIds: string[];
};

export function buildChapterMapClusters(
  project: StoryProject,
  visibleChapterIds: string[],
): ChapterMapCluster[] {
  const visible = new Set(visibleChapterIds);
  let originY = 176;

  return project.chapters
    .filter((chapter) => visible.has(chapter.id))
    .map((chapter) => {
      const sceneIds = new Set(chapter.sceneIds);
      const routes = project.routeMap.nodes.filter((route) => route.sceneId && sceneIds.has(route.sceneId));
      const routeIds = new Set(routes.map((route) => route.id));
      const positions = routes.map((route) => ({ route, position: routeDisplayPosition(route, project.routeMap.layoutDirection) }));
      const minX = positions.length ? Math.min(...positions.map(({ position }) => position.x)) : 360;
      const maxX = positions.length ? Math.max(...positions.map(({ position }) => position.x)) : 360;
      const minY = positions.length ? Math.min(...positions.map(({ position }) => position.y)) : 40;
      const maxY = positions.length ? Math.max(...positions.map(({ position }) => position.y)) : 40;
      const cardY = originY - 128;
      const left = Math.min(28, minX - 52, CHAPTER_CARD_X - 24);
      const right = Math.max(820, maxX + ROUTE_WIDTH + 52, CHAPTER_CARD_X + CHAPTER_CARD_WIDTH + 24);
      const top = Math.min(cardY - 24, originY + minY - 52);
      const bottom = Math.max(cardY + CHAPTER_CARD_HEIGHT + 48, originY + maxY + ROUTE_HEIGHT + 64);
      const incomingWithinChapter = new Set(project.routeMap.edges
        .filter((edge) => routeIds.has(edge.source) && routeIds.has(edge.target))
        .map((edge) => edge.target));
      const roots = routes.filter((route) => !incomingWithinChapter.has(route.id));
      const fallback = routes.find((route) => route.kind === "start") || routes[0];
      const entryRouteIds = roots.length ? roots.map((route) => route.id) : fallback ? [fallback.id] : [];
      const cluster: ChapterMapCluster = {
        chapterId: chapter.id,
        background: { x: left, y: top, width: right - left, height: bottom - top },
        card: { x: CHAPTER_CARD_X, y: cardY, width: CHAPTER_CARD_WIDTH, height: CHAPTER_CARD_HEIGHT },
        originY,
        routePositions: Object.fromEntries(positions.map(({ route, position }) => [
          route.id,
          { x: position.x, y: position.y + originY },
        ])),
        entryRouteIds,
      };
      originY = bottom + 176;
      return cluster;
    });
}

export function routePositionFromChapterMap(
  position: { x: number; y: number },
  cluster: ChapterMapCluster,
  direction: StoryProject["routeMap"]["layoutDirection"],
) {
  return routeStoredPosition({ x: Math.round(position.x), y: Math.round(position.y - cluster.originY) }, direction);
}
