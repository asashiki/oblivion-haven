import type { ChoiceBlock, StoryBlock, StoryProject, StoryScene } from "./types";

export type ChoiceGroupIdentity = {
  groupCode: string;
  groupName: string;
};

function normalized(value: string | undefined): string {
  return (value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function choiceBlocks(scene: StoryScene): ChoiceBlock[] {
  return scene.blocks.filter((block): block is ChoiceBlock => block.type === "choice");
}

export function choiceGroupCode(project: StoryProject, scene: StoryScene, block: ChoiceBlock): string {
  if (block.groupCode?.trim()) return block.groupCode.trim();
  const sceneIndex = Math.max(0, project.scenes.findIndex((item) => item.id === scene.id));
  const groupIndex = Math.max(0, choiceBlocks(scene).findIndex((item) => item.id === block.id));
  return `S${String(sceneIndex + 1).padStart(2, "0")}-Q${String(groupIndex + 1).padStart(2, "0")}`;
}

export function choiceGroupDisplayName(project: StoryProject, scene: StoryScene, block: ChoiceBlock): string {
  if (block.groupName?.trim()) return block.groupName.trim();
  const groupIndex = Math.max(0, choiceBlocks(scene).findIndex((item) => item.id === block.id));
  return `${scene.name} · 选择 ${groupIndex + 1}`;
}

export function isChoiceGroupNameUnique(project: StoryProject, blockId: string, value: string): boolean {
  const key = normalized(value);
  if (!key) return false;
  return !project.scenes.some((scene) => choiceBlocks(scene).some((block) => (
    block.id !== blockId && normalized(choiceGroupDisplayName(project, scene, block)) === key
  )));
}

export function nextChoiceGroupIdentity(project: StoryProject, scene: StoryScene): ChoiceGroupIdentity {
  const sceneIndex = Math.max(0, project.scenes.findIndex((item) => item.id === scene.id));
  const usedCodes = new Set(project.scenes.flatMap((item) => choiceBlocks(item).map((block) => normalized(block.groupCode))));
  const usedNames = new Set(project.scenes.flatMap((item) => choiceBlocks(item).map((block) => normalized(choiceGroupDisplayName(project, item, block)))));
  let ordinal = 1;
  while (usedCodes.has(normalized(`S${String(sceneIndex + 1).padStart(2, "0")}-Q${String(ordinal).padStart(2, "0")}`))) ordinal += 1;
  const groupCode = `S${String(sceneIndex + 1).padStart(2, "0")}-Q${String(ordinal).padStart(2, "0")}`;
  let nameOrdinal = ordinal;
  while (usedNames.has(normalized(`${scene.name} · 选择 ${nameOrdinal}`))) nameOrdinal += 1;
  return { groupCode, groupName: `${scene.name} · 选择 ${nameOrdinal}` };
}

function uniqueValue(base: string, used: Set<string>): string {
  let value = base.trim() || "未命名选项组";
  let suffix = 2;
  while (used.has(normalized(value))) {
    value = `${base} (${suffix})`;
    suffix += 1;
  }
  used.add(normalized(value));
  return value;
}

function simplifiedOption(
  project: StoryProject,
  scene: StoryScene,
  option: ChoiceBlock["options"][number],
): ChoiceBlock["options"][number] {
  if (option.targetChoiceGroupId) {
    return {
      ...option,
      targetBlockId: undefined,
      targetSceneId: undefined,
      targetRouteNodeId: undefined,
      endScene: undefined,
    };
  }
  const internalChoice = option.targetBlockId
    ? choiceBlocks(scene).find((block) => block.id === option.targetBlockId)
    : undefined;
  if (internalChoice) {
    return {
      ...option,
      targetChoiceGroupId: internalChoice.id,
      targetBlockId: undefined,
      targetSceneId: undefined,
      targetRouteNodeId: undefined,
      endScene: undefined,
    };
  }
  const routeSceneId = option.targetRouteNodeId
    ? project.routeMap.nodes.find((node) => node.id === option.targetRouteNodeId)?.sceneId
    : undefined;
  const legacyTargetScene = project.scenes.find((item) => item.id === (option.targetSceneId || routeSceneId));
  if (!legacyTargetScene) {
    return option.targetBlockId || option.targetSceneId || option.targetRouteNodeId
      ? { ...option, targetBlockId: undefined, targetSceneId: undefined, targetRouteNodeId: undefined }
      : option;
  }
  const firstGroup = choiceBlocks(legacyTargetScene)[0];
  return {
    ...option,
    targetBlockId: undefined,
    targetSceneId: undefined,
    targetRouteNodeId: undefined,
    targetChoiceGroupId: firstGroup?.id,
    endScene: firstGroup ? undefined : true,
  };
}

/**
 * Makes the simple editor model explicit without changing Story IR ids.
 * Legacy scene/block destinations are folded into the three author-facing
 * destinations: continue, end, or a named choice group.
 */
export function migrateSimpleChoiceGroups(project: StoryProject): StoryProject {
  const usedCodes = new Set<string>();
  const usedNames = new Set<string>();
  let changed = false;
  const scenes = project.scenes.map((scene, sceneIndex) => {
    let groupIndex = 0;
    const blocks = scene.blocks.map((block): StoryBlock => {
      if (block.type !== "choice") return block;
      groupIndex += 1;
      const suggestedCode = `S${String(sceneIndex + 1).padStart(2, "0")}-Q${String(groupIndex).padStart(2, "0")}`;
      const originalCode = block.groupCode?.trim();
      const groupCode = originalCode && !usedCodes.has(normalized(originalCode))
        ? originalCode
        : uniqueValue(suggestedCode, usedCodes);
      usedCodes.add(normalized(groupCode));
      const originalName = block.groupName?.trim();
      const groupName = originalName && !usedNames.has(normalized(originalName))
        ? originalName
        : uniqueValue(`${scene.name} · 选择 ${groupIndex}`, usedNames);
      usedNames.add(normalized(groupName));
      const options = block.options.map((option) => simplifiedOption(project, scene, option));
      if (groupCode !== block.groupCode || groupName !== block.groupName || options.some((option, index) => JSON.stringify(option) !== JSON.stringify(block.options[index]))) changed = true;
      return { ...block, groupCode, groupName, options };
    });
    return blocks === scene.blocks ? scene : { ...scene, blocks };
  });
  return changed ? { ...project, scenes } : project;
}
