import type {
  AssetKind,
  ChoiceOption,
  StagePosition,
  StoryAsset,
  StoryBlock,
  StoryCharacter,
  StoryProject,
  StoryScene,
} from "./types";
import {
  assetDefaultPosition,
  recommendedFigureTransform,
  type FigureShot,
} from "./figureFraming";
import { createId, nowIso } from "./utils";

export type DirectorMatch = {
  role: "background" | "bgm" | "character" | "expression";
  id: string;
  label: string;
  reason: string;
  confidence: number;
};

export type DirectorDraft = {
  project: StoryProject;
  scene: StoryScene;
  matches: DirectorMatch[];
  notes: string[];
  preservedFlowBlocks: number;
};

const emotionCues: Array<{ words: string[]; tags: string[] }> = [
  { words: ["担心", "认真", "严肃", "不安"], tags: ["担心", "认真", "严肃", "serious", "worried"] },
  { words: ["害羞", "犹豫", "不好意思", "克制", "不想责备"], tags: ["害羞", "犹豫", "克制", "shy", "hesitant"] },
  { words: ["开心", "高兴", "笑", "温柔", "轻松"], tags: ["开心", "微笑", "温柔", "positive", "happy", "smile"] },
  { words: ["生气", "愤怒", "责备"], tags: ["生气", "愤怒", "angry"] },
  { words: ["难过", "悲伤", "哭"], tags: ["难过", "悲伤", "sad"] },
];

function searchableAsset(asset: StoryAsset): string {
  return [
    asset.name,
    asset.path,
    ...asset.aliases,
    ...Object.values(asset.metadata || {}).map(String),
  ].join(" ").toLowerCase();
}

function directAliasScore(asset: StoryAsset, brief: string): number {
  const normalized = brief.toLowerCase();
  return [asset.name, ...asset.aliases].reduce((score, alias) => {
    const token = alias.trim().toLowerCase();
    if (!token || !normalized.includes(token)) return score;
    return score + Math.max(5, Math.min(14, token.length * 2));
  }, 0);
}

function cueScore(asset: StoryAsset, brief: string): number {
  const haystack = searchableAsset(asset);
  const normalizedBrief = brief.replace(/晚上/g, "夜晚").replace(/傍晚/g, "黄昏");
  const cues = [
    "白天", "清晨", "黄昏", "傍晚", "夜晚", "深夜", "雨", "雪", "室内", "室外",
    "茶室", "花房", "房间", "学校", "街道", "安静", "温柔", "紧张", "悲伤", "轻快",
  ].filter((cue) => normalizedBrief.includes(cue));
  return cues.reduce((score, cue) => {
    if (!haystack.includes(cue.toLowerCase())) return score;
    return score + (["白天", "清晨", "黄昏", "夜晚", "深夜"].includes(cue) ? 8 : 3);
  }, 0);
}

function bestAsset(
  project: StoryProject,
  kinds: AssetKind[],
  brief: string,
  fallbackId?: string,
): { asset?: StoryAsset; score: number } {
  const candidates = project.assets
    .filter((asset) => kinds.includes(asset.kind) && !asset.missing)
    .map((asset) => ({ asset, score: directAliasScore(asset, brief) + cueScore(asset, brief) }))
    .sort((a, b) => b.score - a.score);
  const matched = candidates[0];
  if (matched && matched.score > 0) return matched;
  return { asset: project.assets.find((asset) => asset.id === fallbackId) || candidates[0]?.asset, score: 0 };
}

function characterSearchText(character: StoryCharacter): string {
  return [character.name, character.displayName, ...character.aliases, character.description, character.persona]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function chooseCharacter(project: StoryProject, scene: StoryScene, brief: string): StoryCharacter | undefined {
  const normalized = brief.toLowerCase();
  const explicit = project.characters.find((character) =>
    [character.name, character.displayName, ...character.aliases]
      .some((name) => name && normalized.includes(name.toLowerCase())),
  );
  if (explicit) return explicit;
  const currentCharacterId = scene.entryStage?.figures?.[0]?.characterId
    || scene.blocks.find((block) => block.type === "dialogue")?.characterId;
  return project.characters.find((character) => character.id === currentCharacterId) || project.characters[0];
}

function chooseExpression(character: StoryCharacter | undefined, brief: string) {
  if (!character) return undefined;
  const normalizedBrief = brief.toLowerCase().replace(/\s+/g, "");
  const wantedTags = emotionCues
    .filter((cue) => cue.words.some((word) => brief.includes(word)))
    .flatMap((cue) => cue.tags);
  const scored = character.expressions
    .map((expression) => {
      const search = [expression.name, ...expression.aliases, ...(expression.tags || [])].join(" ").toLowerCase();
      const aliasScore = [expression.name, ...expression.aliases]
        .reduce((score, alias) => {
          const normalizedAlias = alias.toLowerCase().replace(/\s+/g, "");
          return score + (normalizedAlias && normalizedBrief.includes(normalizedAlias) ? 8 : 0);
        }, 0);
      const score = wantedTags.reduce((sum, tag) => sum + (search.includes(tag.toLowerCase()) ? 3 : 0), 0)
        + aliasScore;
      return { expression, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].expression : character.expressions.find((item) => item.id === character.defaultExpressionId) || character.expressions[0];
}

function explicitPosition(brief: string): StagePosition | undefined {
  if (/最左|画面左边|左侧/.test(brief)) return "left";
  if (/最右|画面右边|右侧/.test(brief)) return "right";
  if (/中央|中间|正中/.test(brief)) return "center";
  return undefined;
}

function detectPosition(brief: string, fallback: StagePosition = "right"): StagePosition {
  return explicitPosition(brief) || fallback;
}

function detectShot(brief: string): FigureShot | undefined {
  if (/胸像|近景|特写|明显放大|大幅放大/.test(brief)) return "bust";
  if (/腰上|半身|普通\s*ADV|标准\s*ADV/.test(brief)) return "waist";
  if (/膝上|中景|七分身/.test(brief)) return "knee";
  if (/全身|远景|缩小|Q版.*全身/.test(brief)) return "full";
  return undefined;
}

function compactBrief(brief: string): string {
  return brief
    .replace(/\s+/g, " ")
    .replace(/^(请|帮我|这一段|这个片段)[，,\s]*/g, "")
    .trim()
    .slice(0, 110);
}

function explicitDialogue(
  brief: string,
  project: StoryProject,
  fallback: StoryCharacter | undefined,
  fallbackPosition: StagePosition,
): StoryBlock[] {
  const lines = brief.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks: StoryBlock[] = [];
  lines.forEach((line) => {
    const match = line.match(/^([^：:]{1,18})[：:]\s*(.+)$/);
    if (!match || /^(选项|选择|背景|场景|BGM|音乐|说明|大意|修改要求)$/.test(match[1])) return;
    const speaker = project.characters.find((character) => characterSearchText(character).includes(match[1].toLowerCase())) || fallback;
    if (!speaker) return;
    const expression = chooseExpression(speaker, line);
    blocks.push({
      id: createId("dialogue"),
      type: "dialogue",
      characterId: speaker.id,
      expressionId: expression?.id,
      position: detectPosition(line, fallbackPosition),
      text: match[2].replace(/^["“]|["”]$/g, ""),
      source: "system",
      createdAt: nowIso(),
    });
  });
  return blocks;
}

function generatedDialogue(
  character: StoryCharacter | undefined,
  brief: string,
  expressionId: string | undefined,
  position: StagePosition,
): StoryBlock[] {
  if (!character) {
    return [{ id: createId("narration"), type: "narration", text: compactBrief(brief), source: "system", createdAt: nowIso() }];
  }
  const lines: string[] = [];
  if (/回来.{0,5}(晚|迟)|很晚才回来/.test(brief) && /担心|不安/.test(brief)) {
    lines.push("欢迎回来，主人。今天比平时晚了一些呢。");
    lines.push(/不想.{0,4}责备|不要责备/.test(brief)
      ? "我不是想责备您……只是一直等不到的时候，稍微有些担心。"
      : "您平安回来就好。我刚才其实有一点担心。");
  } else if (/重逢|回来|欢迎/.test(brief) && /开心|高兴|温柔/.test(brief)) {
    lines.push("欢迎回来，主人。看到您平安回来，我真的很开心。");
  } else if (/害羞|犹豫|不好意思/.test(brief)) {
    lines.push("那、那个……我其实有件事，一直想等主人回来以后再说。");
  } else if (/认真|严肃/.test(brief)) {
    lines.push("主人，有件事我想认真地和您谈谈。");
  } else {
    lines.push("主人，接下来的故事就从这里开始吧。");
  }
  if (/询问|问.+哪里|问.+什么|去了哪里/.test(brief)) {
    lines.push(/去了哪里/.test(brief) ? "如果方便的话，可以告诉我今天去了哪里吗？" : "主人愿意告诉我，刚才发生了什么吗？");
  }
  return lines.map((text) => ({
    id: createId("dialogue"),
    type: "dialogue",
    characterId: character.id,
    expressionId,
    position,
    text,
    source: "system",
    createdAt: nowIso(),
  }));
}

function extractChoiceLabels(brief: string): string[] {
  const explicit = brief.match(/(?:选项|选择)(?:写成|是|为)?[：:]\s*([^\n。]+)/);
  if (explicit) {
    return explicit[1].split(/\s*(?:\/|\||、|，|,)\s*/).map((item) => item.trim()).filter(Boolean).slice(0, 6);
  }
  if (!/选项|选择/.test(brief)) return [];
  if (/去了哪里|今天去了/.test(brief)) return ["去处理了一些工作", "只是随便走了走", "暂时不想说"];
  return ["继续问下去", "换一个话题", "先安静地陪着她"];
}

function createChoice(brief: string, loopTargetId?: string): StoryBlock | undefined {
  const labels = extractChoiceLabels(brief);
  if (!labels.length) return undefined;
  const wantsLoop = /循环|返回(?:最开始|开头|选项菜单)|选完.+返回/.test(brief);
  const options: ChoiceOption[] = labels.map((label) => ({
    id: createId("option"),
    label,
    operations: [],
  }));
  if (wantsLoop && loopTargetId) {
    options.push({ id: createId("option"), label: "返回刚才的话题", targetBlockId: loopTargetId });
  }
  return {
    id: createId("choice"),
    type: "choice",
    prompt: /去了哪里/.test(brief) ? "今天去了哪里？" : "接下来怎么回应？",
    options,
    source: "system",
    createdAt: nowIso(),
  };
}

function isProtectedFlowBlock(block: StoryBlock): boolean {
  if (["blog-action", "save-point", "ai-turn", "native"].includes(block.type)) return true;
  if (block.type === "condition") return true;
  if (block.type === "jump") return Boolean(block.targetSceneId || block.targetRouteNodeId);
  if (block.type === "choice") return block.options.some((option) => Boolean(option.targetSceneId || option.targetRouteNodeId));
  return false;
}

function safeProtectedFlowBlock(block: StoryBlock): StoryBlock {
  if (block.type !== "choice") return block;
  return {
    ...block,
    options: block.options.filter((option) => Boolean(option.targetSceneId || option.targetRouteNodeId)),
  };
}

function matchRecord(role: DirectorMatch["role"], id: string, label: string, score: number, reason: string): DirectorMatch {
  return {
    role,
    id,
    label,
    reason,
    confidence: score > 8 ? 0.96 : score > 2 ? 0.84 : 0.68,
  };
}

export function createDirectorDraft(project: StoryProject, sceneId: string, rawBrief: string): DirectorDraft {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`剧情片段不存在：${sceneId}`);
  const brief = rawBrief.trim() || scene.aiContext || scene.summary || scene.name;
  const background = bestAsset(project, ["background"], brief, scene.entryStage?.backgroundAssetId);
  const bgm = bestAsset(project, ["bgm"], brief, scene.entryStage?.bgmAssetId);
  const character = chooseCharacter(project, scene, brief);
  const expression = chooseExpression(character, brief);
  const expressionAsset = project.assets.find((asset) => asset.id === expression?.assetId);
  const currentFigure = scene.entryStage?.figures?.find((figure) => figure.characterId === character?.id);
  const position = detectPosition(
    brief,
    currentFigure?.position || assetDefaultPosition(expressionAsset),
  );
  const shot = detectShot(brief);
  const transform = shot ? recommendedFigureTransform(expressionAsset, shot) : currentFigure?.transform;
  const matches: DirectorMatch[] = [];
  const notes: string[] = [];

  if (background.asset) matches.push(matchRecord("background", background.asset.id, background.asset.name, background.score, background.score ? "匹配地点、时间与氛围说明" : "沿用当前片段或默认背景"));
  else notes.push("没有可用背景；本地规则没有伪造资源引用。");
  if (bgm.asset) matches.push(matchRecord("bgm", bgm.asset.id, bgm.asset.name, bgm.score, bgm.score ? "匹配情绪与推荐用途" : "沿用当前片段或默认 BGM"));
  else notes.push("没有可用 BGM；这一段将保持静音。");
  if (character) matches.push(matchRecord("character", character.id, character.displayName, 10, "从剧情说明和当前片段识别角色"));
  if (expression) matches.push(matchRecord("expression", expression.id, expression.name, 6, "按情绪强度与表情标签匹配"));

  const blocks: StoryBlock[] = [];
  if (background.asset) {
    blocks.push({
      id: createId("stage"),
      type: "stage",
      action: "set-background",
      assetId: background.asset.id,
      transition: { name: "enter", durationMs: /缓慢|渐渐|慢慢/.test(brief) ? 900 : 550 },
      source: "system",
      createdAt: nowIso(),
    });
  }
  if (bgm.asset) {
    blocks.push({
      id: createId("stage"),
      type: "stage",
      action: "play-bgm",
      assetId: bgm.asset.id,
      volume: /轻|安静|克制/.test(brief) ? 0.48 : 0.62,
      loop: true,
      durationMs: 700,
      source: "system",
      createdAt: nowIso(),
    });
  }
  if (character) {
    blocks.push({
      id: createId("stage"),
      type: "stage",
      action: "enter-character",
      characterId: character.id,
      expressionId: expression?.id,
      position,
      transform,
      transition: {
        name: position === "left" ? "enter-from-left" : position === "right" ? "enter-from-right" : "enter",
        durationMs: /缓慢|慢慢/.test(brief) ? 850 : 520,
      },
      source: "system",
      createdAt: nowIso(),
    });
  }

  const dialogue = explicitDialogue(brief, project, character, position);
  const storyLines = dialogue.length ? dialogue : generatedDialogue(character, brief, expression?.id, position);
  blocks.push(...storyLines);
  const choice = createChoice(brief, storyLines[0]?.id);
  if (choice) blocks.push(choice);

  const protectedFlow = scene.blocks.filter(isProtectedFlowBlock).map(safeProtectedFlowBlock);
  blocks.push(...protectedFlow);
  if (protectedFlow.length) notes.push(`保留了 ${protectedFlow.length} 个既有外部出口或系统动作，本地规则没有覆盖路线逻辑。`);
  if (/循环|返回(?:最开始|开头|选项菜单)/.test(brief) && choice) notes.push("局部返回被编译为片段内部跳转，不会出现在外层叙事地图。");

  const nextScene: StoryScene = {
    ...scene,
    summary: compactBrief(brief),
    aiContext: brief,
    mode: "adv",
    entryStage: {
      backgroundAssetId: background.asset?.id,
      bgmAssetId: bgm.asset?.id,
      figures: character ? [{
        characterId: character.id,
        expressionId: expression?.id,
        position,
        ...(transform ? { transform } : {}),
      }] : [],
    },
    blocks,
  };
  return {
    project: {
      ...project,
      scenes: project.scenes.map((item) => item.id === scene.id ? nextScene : item),
      savePoints: project.savePoints.map((point) => (
        point.sceneId === scene.id && point.blockId && !blocks.some((block) => block.id === point.blockId)
          ? { ...point, blockId: storyLines[0]?.id }
          : point
      )),
      updatedAt: nowIso(),
    },
    scene: nextScene,
    matches,
    notes,
    preservedFlowBlocks: protectedFlow.length,
  };
}

export function reviseSceneWithInstruction(project: StoryProject, sceneId: string, instruction: string): DirectorDraft {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`剧情片段不存在：${sceneId}`);
  const brief = [scene.aiContext || scene.summary || scene.name, `修改要求：${instruction.trim()}`].filter(Boolean).join("\n");
  const result = createDirectorDraft(project, sceneId, brief);
  const revisedScene = {
    ...result.scene,
    summary: scene.summary || compactBrief(scene.aiContext || scene.name),
  };
  return {
    ...result,
    scene: revisedScene,
    project: {
      ...result.project,
      scenes: result.project.scenes.map((item) => item.id === sceneId ? revisedScene : item),
    },
  };
}
