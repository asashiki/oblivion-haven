import type { RouteEdge, StoryBlock, StoryProject } from "./types";
import { assetDefaultPosition, assetDefaultTransform } from "./figureFraming";

export function linkRouteEdge(project: StoryProject, edge: RouteEdge): StoryProject {
  if (
    edge.source === edge.target
    || project.routeMap.edges.some((item) => item.source === edge.source && item.target === edge.target)
  ) {
    return project;
  }

  return {
    ...project,
    routeMap: {
      ...project.routeMap,
      edges: [...project.routeMap.edges, edge],
    },
  };
}

function removeSceneTargetFromBlock(
  block: StoryBlock,
  sceneId: string,
  routeNodeIds: Set<string>,
  choiceGroupIds: Set<string>,
): StoryBlock | undefined {
  if (block.type === "jump") {
    const pointsToDeletedScene = block.targetSceneId === sceneId
      || Boolean(block.targetRouteNodeId && routeNodeIds.has(block.targetRouteNodeId));
    return pointsToDeletedScene ? undefined : block;
  }
  if (block.type === "choice") {
    return {
      ...block,
      options: block.options.map((option) => {
        const pointsToDeletedScene = option.targetSceneId === sceneId
          || Boolean(option.targetRouteNodeId && routeNodeIds.has(option.targetRouteNodeId))
          || Boolean(option.targetChoiceGroupId && choiceGroupIds.has(option.targetChoiceGroupId));
        if (!pointsToDeletedScene) return option;
        return { ...option, targetSceneId: undefined, targetRouteNodeId: undefined, targetChoiceGroupId: undefined, endScene: undefined };
      }),
    };
  }
  if (block.type === "condition") {
    return {
      ...block,
      branches: block.branches.filter((branch) => branch.targetSceneId !== sceneId),
    };
  }
  if (block.type === "blog-action" && block.resultBranches) {
    return {
      ...block,
      resultBranches: Object.fromEntries(
        Object.entries(block.resultBranches).filter(([, target]) => target !== sceneId),
      ),
    };
  }
  if (block.type === "ai-turn" && block.fallbackSceneId === sceneId) {
    return { ...block, fallbackSceneId: undefined };
  }
  return block;
}

function cleanSceneReferences(
  project: StoryProject,
  sceneId: string,
  routeNodeIds: Set<string>,
  choiceGroupIds: Set<string>,
): StoryProject["scenes"] {
  return project.scenes.map((scene) => ({
    ...scene,
    blocks: scene.blocks
      .map((block) => removeSceneTargetFromBlock(block, sceneId, routeNodeIds, choiceGroupIds))
      .filter((block): block is StoryBlock => Boolean(block)),
  }));
}

export function unlinkRouteEdge(project: StoryProject, edgeId: string): StoryProject {
  if (!project.routeMap.edges.some((item) => item.id === edgeId)) return project;
  return {
    ...project,
    routeMap: {
      ...project.routeMap,
      edges: project.routeMap.edges.filter((item) => item.id !== edgeId),
    },
  };
}

export function unlinkRouteEdges(project: StoryProject, edgeIds: string[]): StoryProject {
  return edgeIds.reduce((current, edgeId) => unlinkRouteEdge(current, edgeId), project);
}

export function deleteStoryScene(
  project: StoryProject,
  sceneId: string,
): { project: StoryProject; nextSceneId: string } {
  const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (sceneIndex < 0 || project.scenes.length <= 1) {
    return { project, nextSceneId: project.settings.startSceneId };
  }

  const routeNodeIds = new Set(
    project.routeMap.nodes.filter((node) => node.sceneId === sceneId).map((node) => node.id),
  );
  const choiceGroupIds = new Set(
    project.scenes.find((scene) => scene.id === sceneId)?.blocks
      .filter((block) => block.type === "choice")
      .map((block) => block.id) || [],
  );
  const remainingScenes = cleanSceneReferences(project, sceneId, routeNodeIds, choiceGroupIds)
    .filter((scene) => scene.id !== sceneId);
  const nextScene = remainingScenes[Math.min(sceneIndex, remainingScenes.length - 1)]
    || remainingScenes[0];
  const nextSceneId = nextScene?.id || "";
  const startSceneId = project.settings.startSceneId === sceneId
    ? nextSceneId
    : project.settings.startSceneId;

  const nodes = project.routeMap.nodes
    .filter((node) => !routeNodeIds.has(node.id))
    .map((node) => (
      node.sceneId === startSceneId && project.settings.startSceneId === sceneId
        ? { ...node, kind: "start" as const }
        : node
    ));
  const validNodeIds = new Set(nodes.map((node) => node.id));

  return {
    nextSceneId,
    project: {
      ...project,
      settings: { ...project.settings, startSceneId },
      scenes: remainingScenes,
      chapters: project.chapters.map((chapter) => ({
        ...chapter,
        sceneIds: chapter.sceneIds.filter((id) => id !== sceneId),
      })),
      routeMap: {
        ...project.routeMap,
        nodes,
        edges: project.routeMap.edges.filter((edge) => (
          validNodeIds.has(edge.source) && validNodeIds.has(edge.target)
        )),
      },
      endings: project.endings.filter((ending) => (
        ending.sceneId !== sceneId && !routeNodeIds.has(ending.routeNodeId)
      )),
      savePoints: project.savePoints.filter((point) => point.sceneId !== sceneId),
    },
  };
}

export function deleteStoryAsset(project: StoryProject, assetId: string): StoryProject {
  if (!project.assets.some((asset) => asset.id === assetId)) return project;
  const removedExpressionIds = new Set(
    project.characters.flatMap((character) => (
      character.expressions
        .filter((expression) => expression.assetId === assetId)
        .map((expression) => expression.id)
    )),
  );
  const assets = project.assets.filter((asset) => asset.id !== assetId);
  const characters = project.characters.map((character) => {
    const expressions = character.expressions
      .filter((expression) => expression.assetId !== assetId)
      .map((expression) => {
        if (!expression.webgalAnimation) return expression;
        const animation = { ...expression.webgalAnimation };
        const keys = [
          "mouthOpenAssetId",
          "mouthHalfOpenAssetId",
          "mouthCloseAssetId",
          "eyesOpenAssetId",
          "eyesCloseAssetId",
        ] as const;
        keys.forEach((key) => {
          if (animation[key] === assetId) delete animation[key];
        });
        return { ...expression, webgalAnimation: animation };
      });
    return {
      ...character,
      expressions,
      defaultExpressionId: expressions.some((expression) => expression.id === character.defaultExpressionId)
        ? character.defaultExpressionId
        : expressions[0]?.id,
    };
  });
  const characterById = new Map(characters.map((character) => [character.id, character]));
  const fallbackExpression = (characterId: string) => {
    const character = characterById.get(characterId);
    return character?.expressions.find((expression) => expression.id === character.defaultExpressionId)
      || character?.expressions[0];
  };

  const scenes = project.scenes.map((scene) => {
    const figures = (scene.entryStage?.figures || []).flatMap((figure) => {
      if (!figure.expressionId || !removedExpressionIds.has(figure.expressionId)) return [figure];
      const expression = fallbackExpression(figure.characterId);
      if (!expression) return [];
      const asset = assets.find((item) => item.id === expression.assetId);
      return [{
        ...figure,
        expressionId: expression.id,
        position: assetDefaultPosition(asset),
        transform: assetDefaultTransform(asset),
      }];
    });
    const blocks = scene.blocks.flatMap((block): StoryBlock[] => {
      if (block.type === "dialogue") {
        const expression = block.expressionId && removedExpressionIds.has(block.expressionId)
          ? fallbackExpression(block.characterId)
          : undefined;
        return [{
          ...block,
          ...(block.voiceAssetId === assetId ? { voiceAssetId: undefined } : {}),
          ...(expression ? { expressionId: expression.id } : block.expressionId && removedExpressionIds.has(block.expressionId) ? { expressionId: undefined } : {}),
        }];
      }
      if (block.type === "stage") {
        if (block.assetId === assetId) return [];
        if (block.expressionId && removedExpressionIds.has(block.expressionId) && block.characterId) {
          const expression = fallbackExpression(block.characterId);
          if (!expression && (block.action === "enter-character" || block.action === "set-expression")) return [];
          return [{
            ...block,
            expressionId: expression?.id,
            transform: undefined,
          }];
        }
      }
      return [block];
    });

    return {
      ...scene,
      entryStage: scene.entryStage ? {
        ...scene.entryStage,
        backgroundAssetId: scene.entryStage.backgroundAssetId === assetId
          ? undefined
          : scene.entryStage.backgroundAssetId,
        bgmAssetId: scene.entryStage.bgmAssetId === assetId
          ? undefined
          : scene.entryStage.bgmAssetId,
        figures,
      } : undefined,
      blocks,
    };
  });

  return {
    ...project,
    assets,
    characters,
    scenes,
  };
}
