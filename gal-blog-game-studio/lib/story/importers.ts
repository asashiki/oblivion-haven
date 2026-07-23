import type {
  ImportFormat,
  ImportResult,
  StagePosition,
  StoryBlock,
  StoryDiagnostic,
  StoryProject,
} from "./types";
import { createId } from "./utils";

type Context = {
  project: StoryProject;
  characterByAlias: Map<string, { id: string; expressionByAlias: Map<string, string> }>;
  assetByAlias: Map<string, string>;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function makeContext(project: StoryProject): Context {
  const characterByAlias = new Map<string, { id: string; expressionByAlias: Map<string, string> }>();
  project.characters.forEach((character) => {
    const expressionByAlias = new Map<string, string>();
    character.expressions.forEach((expression) => {
      [expression.name, ...expression.aliases].forEach((alias) => expressionByAlias.set(normalize(alias), expression.id));
    });
    [character.name, character.displayName, ...character.aliases].forEach((alias) => characterByAlias.set(normalize(alias), { id: character.id, expressionByAlias }));
  });
  const assetByAlias = new Map<string, string>();
  project.assets.forEach((asset) => [asset.name, asset.path, ...asset.aliases].forEach((alias) => assetByAlias.set(normalize(alias), asset.id)));
  return { project, characterByAlias, assetByAlias };
}

function diagnostic(code: string, message: string, severity: StoryDiagnostic["severity"] = "warning"): StoryDiagnostic {
  return { id: createId("diag"), severity, code, message };
}

function resolveCharacter(ctx: Context, name: string, diagnostics: StoryDiagnostic[]) {
  const result = ctx.characterByAlias.get(normalize(name));
  if (!result) diagnostics.push(diagnostic("IMPORT_CHARACTER_UNRESOLVED", `未匹配角色「${name}」，已保留为待绑定引用。`));
  return result || { id: `unresolved:${name}`, expressionByAlias: new Map<string, string>() };
}

function resolveExpression(character: ReturnType<typeof resolveCharacter>, name: string | undefined, diagnostics: StoryDiagnostic[]) {
  if (!name) return undefined;
  const result = character.expressionByAlias.get(normalize(name));
  if (!result) diagnostics.push(diagnostic("IMPORT_EXPRESSION_UNRESOLVED", `未匹配表情「${name}」，请在资源面板选择、上传或生成。`));
  return result;
}

function resolveAsset(ctx: Context, name: string | undefined, diagnostics: StoryDiagnostic[]) {
  if (!name) return undefined;
  const result = ctx.assetByAlias.get(normalize(name));
  if (!result) diagnostics.push(diagnostic("IMPORT_ASSET_UNRESOLVED", `未匹配资源「${name}」，没有静默写入不存在的文件。`));
  return result;
}

function position(value?: string): StagePosition | undefined {
  if (!value) return undefined;
  const v = normalize(value);
  if (v.includes("左")) return v.includes("最") || v.includes("远") ? "far-left" : "left";
  if (v.includes("右")) return v.includes("最") || v.includes("远") ? "far-right" : "right";
  if (v.includes("中") || v.includes("center")) return "center";
  return undefined;
}

function detectFormat(input: string): { format: ImportFormat; confidence: number } {
  const text = input.trim();
  if (/^\s*\[[^\]]+=.+\]/m.test(text)) return { format: "tagged", confidence: 0.92 };
  if (/^[{[]/.test(text)) return { format: "json", confidence: 0.95 };
  if (/^\s*(label|scene|show|hide|play music|menu|if|\$)\b/m.test(text) || /^\s*\w+\s+"[^"]+"/m.test(text)) return { format: "renpy", confidence: 0.88 };
  if (/^\s*(changeBg|changeFigure|bgm|intro|choose|setVar|getUserInput|changeScene):/m.test(text)) return { format: "webgal", confidence: 0.94 };
  if (/^(#{1,4}\s|\*\*.+\*\*|[-*]\s)/m.test(text)) return { format: "markdown", confidence: 0.78 };
  return { format: "natural", confidence: 0.58 };
}

function parseJson(input: string): ImportResult {
  const diagnostics: StoryDiagnostic[] = [];
  try {
    const parsed = JSON.parse(input) as unknown;
    let blocks: StoryBlock[] = [];
    if (Array.isArray(parsed)) blocks = parsed as StoryBlock[];
    else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { blocks?: unknown[] }).blocks)) blocks = (parsed as { blocks: StoryBlock[] }).blocks;
    else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { scenes?: unknown[] }).scenes)) {
      blocks = ((parsed as { scenes: Array<{ blocks?: StoryBlock[] }> }).scenes[0]?.blocks || []);
      diagnostics.push(diagnostic("IMPORT_PROJECT_SCENE_SELECTED", "检测到完整 Story IR 项目；当前导入工作台预览第一场景，完整项目请使用“打开 Story JSON”。", "info"));
    } else throw new Error("JSON 中没有 blocks 或 scenes");
    return { format: "json", confidence: 0.98, blocks, diagnostics, discovered: { characterNames: [], assetAliases: [] } };
  } catch (error) {
    return { format: "json", confidence: 0.98, blocks: [], diagnostics: [diagnostic("IMPORT_JSON_INVALID", error instanceof Error ? error.message : "JSON 无法解析", "error")], discovered: { characterNames: [], assetAliases: [] } };
  }
}

function parseTagged(input: string, ctx: Context): ImportResult {
  const blocks: StoryBlock[] = [];
  const diagnostics: StoryDiagnostic[] = [];
  const discoveredCharacters = new Set<string>();
  const discoveredAssets = new Set<string>();
  let tags: Record<string, string> = {};
  input.replace(/\r/g, "").split("\n").forEach((line) => {
    const found = [...line.matchAll(/\[([^=\]]+)=([^\]]+)\]/g)];
    if (found.length) {
      tags = Object.fromEntries(found.map((match) => [normalize(match[1]), match[2].trim()]));
      const backgroundName = tags["背景"];
      const bgmName = tags["bgm"];
      if (backgroundName) {
        discoveredAssets.add(backgroundName);
        blocks.push({ id: createId("stage"), type: "stage", action: "set-background", assetId: resolveAsset(ctx, backgroundName, diagnostics), transition: tags["入场"] ? { name: tags["入场"], durationMs: 500 } : undefined, source: "import" });
      }
      if (bgmName) {
        discoveredAssets.add(bgmName);
        blocks.push({ id: createId("stage"), type: "stage", action: "play-bgm", assetId: resolveAsset(ctx, bgmName, diagnostics), loop: true, source: "import" });
      }
    }
    const text = line.replace(/\[[^\]]+\]/g, "").trim();
    if (!text) return;
    const match = text.match(/^([^：:]{1,30})[：:]\s*(.+)$/);
    if (match) {
      discoveredCharacters.add(match[1].trim());
      const character = resolveCharacter(ctx, tags["角色"] || match[1], diagnostics);
      blocks.push({
        id: createId("dialogue"),
        type: "dialogue",
        characterId: character.id,
        expressionId: resolveExpression(character, tags["表情"], diagnostics),
        position: position(tags["位置"]),
        enter: tags["入场"] ? { name: tags["入场"], durationMs: 500 } : undefined,
        text: match[2].trim(),
        source: "import",
      });
    } else if (/(?:让.+(?:淡入|出现|入场|走进|说[“"])|(?:背景|场景)(?:改成|换成|切换到|是|为))/.test(text)) {
      const natural = parseNatural(text, ctx);
      blocks.push(...natural.blocks);
      diagnostics.push(...natural.diagnostics);
      natural.discovered.characterNames.forEach((name) => discoveredCharacters.add(name));
      natural.discovered.assetAliases.forEach((alias) => discoveredAssets.add(alias));
    } else {
      blocks.push({ id: createId("narration"), type: "narration", text, source: "import" });
    }
  });
  return { format: "tagged", confidence: 0.92, blocks, diagnostics, discovered: { characterNames: [...discoveredCharacters], assetAliases: [...discoveredAssets] } };
}

function parseMarkdown(input: string, ctx: Context): ImportResult {
  const blocks: StoryBlock[] = [];
  const diagnostics: StoryDiagnostic[] = [];
  const discoveredCharacters = new Set<string>();
  const choiceLines: string[] = [];
  input.replace(/\r/g, "").split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line)) return;
    const choice = line.match(/^[-*]\s+\[(?:x| )?\]?\s*(.+?)(?:\s*->\s*(.+))?$/i);
    if (choice) {
      choiceLines.push(choice[1].trim());
      return;
    }
    if (choiceLines.length) {
      blocks.push({ id: createId("choice"), type: "choice", options: choiceLines.splice(0).map((label) => ({ id: createId("opt"), label })) });
    }
    const dialogue = line.replace(/^\*\*|\*\*$/g, "").match(/^([^：:]{1,30})[：:]\s*(.+)$/);
    if (dialogue) {
      discoveredCharacters.add(dialogue[1]);
      const character = resolveCharacter(ctx, dialogue[1], diagnostics);
      blocks.push({ id: createId("dialogue"), type: "dialogue", characterId: character.id, text: dialogue[2], source: "import" });
    } else {
      blocks.push({ id: createId("narration"), type: "narration", text: line.replace(/^>\s?/, ""), source: "import" });
    }
  });
  if (choiceLines.length) blocks.push({ id: createId("choice"), type: "choice", options: choiceLines.map((label) => ({ id: createId("opt"), label })) });
  return { format: "markdown", confidence: 0.8, blocks, diagnostics, discovered: { characterNames: [...discoveredCharacters], assetAliases: [] } };
}

function parseRenpy(input: string, ctx: Context): ImportResult {
  const blocks: StoryBlock[] = [];
  const diagnostics: StoryDiagnostic[] = [];
  const characters = new Set<string>();
  const assets = new Set<string>();
  input.replace(/\r/g, "").split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const studioBlock = line.match(/^#\s*studio\s+[\w-]+:\s*(\{.*\})$/);
    if (studioBlock) {
      try {
        const block = JSON.parse(studioBlock[1]) as StoryBlock;
        if (!block.id || !block.type) throw new Error("缺少 id/type");
        blocks.push(block);
      } catch (error) {
        diagnostics.push(diagnostic("IMPORT_STUDIO_BLOCK_INVALID", `无法解析 Studio 保留块：${error instanceof Error ? error.message : "JSON 错误"}`));
      }
      return;
    }
    if (line.startsWith("#")) return;
    const id = line.match(/#.*@id=([\w.-]+)/)?.[1];
    const expressionAlias = line.match(/#.*@expression=([^#]+?)(?:\s+@\w+=|$)/)?.[1]?.trim();
    let baseBlock: StoryBlock | undefined;
    const encodedMetadata = line.match(/#.*@meta=(\S+)/)?.[1];
    if (encodedMetadata) {
      try {
        baseBlock = JSON.parse(decodeURIComponent(encodedMetadata)) as StoryBlock;
      } catch {
        diagnostics.push(diagnostic("IMPORT_STUDIO_METADATA_INVALID", `块 ${id || "unknown"} 的保留元数据损坏；已按可见脚本重建。`));
      }
    }
    const statement = line.replace(/\s+#.*$/, "").trim();
    if (/^label\s/.test(statement)) return;
    let match = statement.match(/^scene\s+(.+?)(?:\s+with\s+(\S+))?(?:\s+duration\s+([\d.]+))?$/);
    if (match) {
      assets.add(match[1]);
      const base = baseBlock?.type === "stage" ? baseBlock : undefined;
      blocks.push({ ...base, id: id || base?.id || createId("stage"), type: "stage", action: "set-background", assetId: resolveAsset(ctx, match[1], diagnostics), transition: match[2] ? { ...base?.transition, name: match[2], durationMs: Number(match[3] || 0.5) * 1000 } : base?.transition, source: base?.source || "import" });
      return;
    }
    match = statement.match(/^show\s+(\S+)(?:\s+(\S+))?(?:\s+at\s+(\S+))?/);
    if (match) {
      characters.add(match[1]);
      const character = resolveCharacter(ctx, match[1], diagnostics);
      const base = baseBlock?.type === "stage" ? baseBlock : undefined;
      blocks.push({ ...base, id: id || base?.id || createId("stage"), type: "stage", action: "enter-character", characterId: character.id, expressionId: resolveExpression(character, match[2], diagnostics), position: position(match[3]), transition: base?.transition || { name: "enter", durationMs: 350 }, source: base?.source || "import" });
      return;
    }
    match = statement.match(/^hide\s+(\S+)/);
    if (match) {
      const character = resolveCharacter(ctx, match[1], diagnostics);
      const base = baseBlock?.type === "stage" ? baseBlock : undefined;
      blocks.push({ ...base, id: id || base?.id || createId("stage"), type: "stage", action: "exit-character", characterId: character.id, source: base?.source || "import" });
      return;
    }
    match = statement.match(/^play\s+(music|sound|voice)\s+(.+)$/);
    if (match) {
      const volume = match[2].match(/\s+volume\s+(\d+(?:\.\d+)?)%?/i)?.[1];
      const assetName = match[2].replace(/\s+volume\s+\d+(?:\.\d+)?%?/i, "").replace(/\s+loop\b/i, "").trim().replace(/^"|"$/g, "");
      assets.add(assetName);
      const base = baseBlock?.type === "stage" ? baseBlock : undefined;
      blocks.push({
        ...base,
        id: id || base?.id || createId("stage"),
        type: "stage",
        action: match[1] === "music" ? "play-bgm" : "play-sfx",
        assetId: resolveAsset(ctx, assetName, diagnostics),
        volume: volume ? Number(volume) / 100 : base?.volume,
        loop: /\s+loop\b/i.test(match[2]),
        source: base?.source || "import",
      });
      return;
    }
    if (/^stop\s+music/.test(statement)) {
      const base = baseBlock?.type === "stage" ? baseBlock : undefined;
      blocks.push({ ...base, id: id || base?.id || createId("stage"), type: "stage", action: "stop-bgm", source: base?.source || "import" });
      return;
    }
    match = statement.match(/^pause\s+([\d.]+)(ms)?/);
    if (match) {
      const base = baseBlock?.type === "stage" ? baseBlock : undefined;
      blocks.push({ ...base, id: id || base?.id || createId("stage"), type: "stage", action: "wait", durationMs: Number(match[1]) * (match[2] ? 1 : 1000), source: base?.source || "import" });
      return;
    }
    match = statement.match(/^\$\s*([\w\u4e00-\u9fff]+)\s*(=|\+=|-=)\s*(.+)$/);
    if (match) {
      const [, variableName, operator, expression] = match;
      const variable = ctx.project.variables.find((item) => normalize(item.name) === normalize(variableName));
      blocks.push({ id: id || createId("var"), type: "variable", operations: [{ variableId: variable?.id || `unresolved:${variableName}`, operation: operator === "+=" ? "add" : operator === "-=" ? "subtract" : "set", expression }], source: "import" });
      if (!variable) diagnostics.push(diagnostic("IMPORT_VARIABLE_UNRESOLVED", `变量「${variableName}」尚未注册。`));
      return;
    }
    match = statement.match(/^([\w\u4e00-\u9fff]+)\s+"(.+)"$/);
    if (match) {
      characters.add(match[1]);
      const character = resolveCharacter(ctx, match[1], diagnostics);
      const base = baseBlock?.type === "dialogue" ? baseBlock : undefined;
      blocks.push({ ...base, id: id || base?.id || createId("dialogue"), type: "dialogue", characterId: character.id, expressionId: expressionAlias ? resolveExpression(character, expressionAlias, diagnostics) : base?.expressionId, text: match[2], source: base?.source || "import" });
      return;
    }
    match = statement.match(/^"(.+)"$/);
    if (match) {
      const base = baseBlock?.type === "narration" ? baseBlock : undefined;
      blocks.push({ ...base, id: id || base?.id || createId("narration"), type: "narration", text: match[1], source: base?.source || "import" });
    }
  });
  return { format: "renpy", confidence: 0.88, blocks, diagnostics, discovered: { characterNames: [...characters], assetAliases: [...assets] } };
}

function parseWebgal(input: string, ctx: Context): ImportResult {
  const blocks: StoryBlock[] = [];
  const diagnostics: StoryDiagnostic[] = [];
  const characters = new Set<string>();
  const assets = new Set<string>();
  input.replace(/\r/g, "").split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith(";")) return;
    const statement = line.replace(/;.*$/, "").trim();
    const [command, ...rest] = statement.split(":");
    const content = rest.join(":").replace(/\s+-\w+(?:=[^\s]+)?/g, "").trim();
    if (command === "changeBg") {
      assets.add(content);
      blocks.push({ id: createId("stage"), type: "stage", action: "set-background", assetId: resolveAsset(ctx, content, diagnostics), source: "import" });
    } else if (command === "bgm") {
      blocks.push({ id: createId("stage"), type: "stage", action: content === "none" ? "stop-bgm" : "play-bgm", assetId: content === "none" ? undefined : resolveAsset(ctx, content, diagnostics), source: "import" });
    } else if (command === "changeFigure") {
      blocks.push({ id: createId("native"), type: "native", engine: "webgal", script: line, source: "native" });
    } else if (command === "intro") {
      blocks.push({ id: createId("narration"), type: "narration", mode: "nvl", text: content, source: "import" });
    } else if (command === "choose") {
      blocks.push({ id: createId("native"), type: "native", engine: "webgal", script: line, source: "native" });
      diagnostics.push(diagnostic("IMPORT_NATIVE_BRANCH", "WebGAL 选择项已保留为原生块；在叙事地图中重新绑定后可转换为 Story IR 选择块。", "info"));
    } else if (["setVar", "getUserInput", "changeScene", "setTransform", "playEffect"].includes(command)) {
      blocks.push({ id: createId("native"), type: "native", engine: "webgal", script: line, source: "native" });
    } else if (rest.length) {
      characters.add(command);
      const character = resolveCharacter(ctx, command, diagnostics);
      blocks.push({ id: createId("dialogue"), type: "dialogue", characterId: character.id, text: content, source: "import" });
    } else {
      blocks.push({ id: createId("narration"), type: "narration", text: command, source: "import" });
    }
  });
  return { format: "webgal", confidence: 0.95, blocks, diagnostics, discovered: { characterNames: [...characters], assetAliases: [...assets] } };
}

function parseNatural(input: string, ctx: Context): ImportResult {
  const blocks: StoryBlock[] = [];
  const diagnostics: StoryDiagnostic[] = [];
  const characters = new Set<string>();
  const assets = new Set<string>();
  const sentences = input.replace(/\r/g, "").split(/\n+|(?<=[。！？])\s*/).map((item) => item.trim()).filter(Boolean);
  sentences.forEach((sentence) => {
    const bg = sentence.match(/(?:背景|场景)(?:改成|换成|切换到|是|为)?[“"]?([^，。；”"]+)/);
    if (bg) {
      assets.add(bg[1]);
      blocks.push({ id: createId("stage"), type: "stage", action: "set-background", assetId: resolveAsset(ctx, bg[1], diagnostics), transition: /淡入|渐变/.test(sentence) ? { name: "enter", durationMs: 600 } : undefined, source: "import" });
    }
    const quotedSpeech = sentence.match(/说[“"](.+?)[”"]/);
    const directed = quotedSpeech && sentence.match(/^让(.+?)(?=从(?:左侧|右侧|中间|中央)|缓慢|淡入|出现|入场|走进|[，,]|表情|显得)/);
    if (quotedSpeech && directed) {
      const characterName = directed[1].trim();
      const positionMatch = sentence.match(/(?:从|到)?(左侧|右侧|中间|中央)/);
      const expressionMatch = sentence.match(/(?:表情|显得|露出)([^，,。]{1,12}?)(?=(?:，|,|然后|说|$))/);
      const expression = expressionMatch?.[1]?.trim();
      const enters = /淡入|出现|入场|走进/.test(sentence);
      characters.add(characterName);
      const character = resolveCharacter(ctx, characterName, diagnostics);
      if (enters) {
        blocks.push({
          id: createId("stage"),
          type: "stage",
          action: "enter-character",
          characterId: character.id,
          expressionId: resolveExpression(character, expression, diagnostics),
          position: position(positionMatch?.[1]),
          transition: {
            name: positionMatch?.[1]?.includes("右") ? "enter-from-right" : positionMatch?.[1]?.includes("左") ? "enter-from-left" : "enter",
            durationMs: /缓慢/.test(sentence) ? 900 : 450,
          },
          source: "import",
        });
      }
      blocks.push({
        id: createId("dialogue"),
        type: "dialogue",
        characterId: character.id,
        expressionId: resolveExpression(character, expression, diagnostics),
        position: position(positionMatch?.[1]),
        text: quotedSpeech[1],
        source: "import",
      });
      return;
    }
    const dialogue = sentence.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
    if (dialogue) {
      characters.add(dialogue[1]);
      const character = resolveCharacter(ctx, dialogue[1], diagnostics);
      blocks.push({ id: createId("dialogue"), type: "dialogue", characterId: character.id, text: dialogue[2], source: "import" });
    } else if (!bg) {
      blocks.push({ id: createId("narration"), type: "narration", text: sentence, source: "import" });
    }
  });
  diagnostics.push(diagnostic("IMPORT_NATURAL_REVIEW", "自然语言采用规则解析；请在导入预览中确认角色、表情、动作和资源匹配。", "info"));
  return { format: "natural", confidence: 0.62, blocks, diagnostics, discovered: { characterNames: [...characters], assetAliases: [...assets] } };
}

export function importStoryText(input: string, project: StoryProject, explicitFormat?: ImportFormat): ImportResult {
  const detected = explicitFormat ? { format: explicitFormat, confidence: 1 } : detectFormat(input);
  const ctx = makeContext(project);
  const parser = {
    json: parseJson,
    markdown: parseMarkdown,
    renpy: parseRenpy,
    webgal: parseWebgal,
    tagged: parseTagged,
    natural: parseNatural,
  }[detected.format];
  const result = parser(input, ctx);
  return { ...result, confidence: explicitFormat ? 1 : result.confidence };
}
