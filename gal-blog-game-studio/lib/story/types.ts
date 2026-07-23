export type Id = string;

export type StoryMode = "adv" | "nvl";
export type AssetKind =
  | "background"
  | "figure"
  | "expression"
  | "bgm"
  | "voice"
  | "sfx"
  | "video"
  | "animation"
  | "ui"
  | "other";

export type StagePosition = "far-left" | "left" | "center" | "right" | "far-right" | "custom";
export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "circIn"
  | "circOut"
  | "circInOut"
  | "backIn"
  | "backOut"
  | "backInOut"
  | "bounceIn"
  | "bounceOut"
  | "bounceInOut"
  | "anticipate";

export type StoryAsset = {
  id: Id;
  kind: AssetKind;
  name: string;
  path: string;
  aliases: string[];
  mimeType?: string;
  remoteUrl?: string;
  missing?: boolean;
  metadata?: Record<string, string | number | boolean>;
};

export type CharacterExpression = {
  id: Id;
  name: string;
  assetId: Id;
  aliases: string[];
  tags?: string[];
};

export type StoryCharacter = {
  id: Id;
  name: string;
  displayName: string;
  aliases: string[];
  color: string;
  description?: string;
  persona?: string;
  defaultExpressionId?: Id;
  expressions: CharacterExpression[];
};

export type StoryVariable = {
  id: Id;
  name: string;
  type: "boolean" | "number" | "string";
  defaultValue: boolean | number | string;
  scope: "scene" | "save" | "global";
  description?: string;
  readonly?: boolean;
};

export type TransitionSpec = {
  name: string;
  durationMs?: number;
  easing?: Easing;
};

export type StageTransform = {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  alpha?: number;
  zIndex?: number;
};

export type BlockBase = {
  id: Id;
  label?: string;
  notes?: string;
  disabled?: boolean;
  source?: "human" | "ai" | "import" | "native";
  createdAt?: string;
  updatedAt?: string;
};

export type DialogueBlock = BlockBase & {
  type: "dialogue";
  characterId: Id;
  text: string;
  expressionId?: Id;
  voiceAssetId?: Id;
  position?: StagePosition;
  enter?: TransitionSpec;
  textEffect?: "none" | "shake" | "fade" | "typewriter";
};

export type NarrationBlock = BlockBase & {
  type: "narration";
  text: string;
  mode?: StoryMode;
  hold?: boolean;
};

export type StageBlock = BlockBase & {
  type: "stage";
  action:
    | "set-background"
    | "play-bgm"
    | "stop-bgm"
    | "play-sfx"
    | "enter-character"
    | "exit-character"
    | "move-character"
    | "set-expression"
    | "clear-stage"
    | "transition"
    | "wait";
  assetId?: Id;
  characterId?: Id;
  expressionId?: Id;
  position?: StagePosition;
  transform?: StageTransform;
  transition?: TransitionSpec;
  animationTarget?: string;
  volume?: number;
  loop?: boolean;
  durationMs?: number;
};

export type VariableOperation = {
  variableId: Id;
  operation: "set" | "add" | "subtract" | "toggle";
  value?: boolean | number | string;
  expression?: string;
};

export type ChoiceOption = {
  id: Id;
  label: string;
  targetSceneId?: Id;
  targetRouteNodeId?: Id;
  condition?: string;
  enabledCondition?: string;
  hidden?: boolean;
  operations?: VariableOperation[];
};

export type ChoiceBlock = BlockBase & {
  type: "choice";
  prompt?: string;
  options: ChoiceOption[];
};

export type InputTarget = "story" | "blog" | "ai";

export type InputBlock = BlockBase & {
  type: "input";
  variableId: Id;
  title: string;
  buttonText?: string;
  placeholder?: string;
  defaultValue?: string;
  validation?: {
    pattern?: string;
    flags?: string;
    message?: string;
  };
  fixedOptions?: Array<{ id: Id; label: string; value: string }>;
  allowFreeText: boolean;
  targets: InputTarget[];
  blogActionId?: string;
  aiHookId?: string;
};

export type ConditionBlock = BlockBase & {
  type: "condition";
  branches: Array<{
    id: Id;
    condition?: string;
    targetSceneId: Id;
    label?: string;
  }>;
};

export type VariableBlock = BlockBase & {
  type: "variable";
  operations: VariableOperation[];
};

export type JumpBlock = BlockBase & {
  type: "jump";
  targetSceneId?: Id;
  targetRouteNodeId?: Id;
  condition?: string;
};

export type ModeBlock = BlockBase & {
  type: "mode";
  mode: StoryMode;
  dimBackground?: number;
};

export type SavePointBlock = BlockBase & {
  type: "save-point";
  savePointId: Id;
  auto?: boolean;
};

export type BlogActionName =
  | "open-article"
  | "return-menu"
  | "open-comment-form"
  | "view-comments"
  | "submit-friend-link"
  | "upload-image"
  | "get-user"
  | "get-page-data"
  | "save-progress"
  | "launch-story"
  | "notify-event"
  | "custom";

export type BlogActionBlock = BlockBase & {
  type: "blog-action";
  action: BlogActionName;
  customAction?: string;
  payload?: Record<string, unknown>;
  resultVariableId?: Id;
  resultBranches?: {
    successSceneId?: Id;
    failureSceneId?: Id;
    cancelSceneId?: Id;
  };
};

export type AiTurnBlock = BlockBase & {
  type: "ai-turn";
  characterIds: Id[];
  configId?: Id;
  prompt?: string;
  allowedTools?: string[];
  maxOperations?: number;
  fallbackSceneId?: Id;
};

export type NativeBlock = BlockBase & {
  type: "native";
  engine: "webgal";
  script: string;
  unsafe?: boolean;
};

export type CommentBlock = BlockBase & {
  type: "comment";
  text: string;
};

export type StoryBlock =
  | DialogueBlock
  | NarrationBlock
  | StageBlock
  | ChoiceBlock
  | InputBlock
  | ConditionBlock
  | VariableBlock
  | JumpBlock
  | ModeBlock
  | SavePointBlock
  | BlogActionBlock
  | AiTurnBlock
  | NativeBlock
  | CommentBlock;

export type StoryScene = {
  id: Id;
  chapterId: Id;
  name: string;
  slug: string;
  summary?: string;
  mode: StoryMode;
  tags: string[];
  blocks: StoryBlock[];
  entryStage?: {
    backgroundAssetId?: Id;
    bgmAssetId?: Id;
    figures?: Array<{
      characterId: Id;
      expressionId?: Id;
      position: StagePosition;
      transform?: StageTransform;
    }>;
  };
  aiContext?: string;
};

export type StoryChapter = {
  id: Id;
  name: string;
  order: number;
  sceneIds: Id[];
  description?: string;
};

export type RouteNodeKind =
  | "start"
  | "scene"
  | "common-route"
  | "character-route"
  | "character-story"
  | "scene-story"
  | "ending"
  | "bad-ending"
  | "true-ending";

export type RouteNode = {
  id: Id;
  kind: RouteNodeKind;
  title: string;
  sceneId?: Id;
  characterId?: Id;
  x: number;
  y: number;
  condition?: string;
  readVariableId?: Id;
  unlockCondition?: string;
  hiddenFromPlayer?: boolean;
  replayable?: boolean;
  color?: string;
};

export type RouteEdge = {
  id: Id;
  source: Id;
  target: Id;
  label?: string;
  condition?: string;
  hiddenFromPlayer?: boolean;
  priority?: number;
};

export type StoryEnding = {
  id: Id;
  name: string;
  kind: "normal" | "bad" | "true";
  routeNodeId: Id;
  sceneId: Id;
  unlockCondition?: string;
};

export type StorySavePoint = {
  id: Id;
  name: string;
  sceneId: Id;
  blockId?: Id;
  thumbnailAssetId?: Id;
  description?: string;
};

export type AiRuntimeConfig = {
  id: Id;
  name: string;
  mode: "authoring" | "live";
  model?: string;
  endpoint?: string;
  systemPrompt?: string;
  temperature?: number;
  maxContextMessages?: number;
  allowedTools: string[];
  requireValidation: boolean;
  saveGeneratedOperations: boolean;
};

export type BlogBridgeConfig = {
  enabled: boolean;
  allowedOrigins: string[];
  channel: string;
  timeoutMs: number;
  capabilities: BlogActionName[];
};

export type StoryProject = {
  schemaVersion: "1.0.0";
  id: Id;
  title: string;
  slug: string;
  version: string;
  description?: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  settings: {
    startSceneId: Id;
    defaultMode: StoryMode;
    webgalVersion: string;
    sharedEngineUrl?: string;
    sharedEngineCssUrl?: string;
    terreBaseUrl?: string;
    blogBridge: BlogBridgeConfig;
  };
  chapters: StoryChapter[];
  scenes: StoryScene[];
  characters: StoryCharacter[];
  assets: StoryAsset[];
  variables: StoryVariable[];
  routeMap: {
    layoutDirection?: "top-down" | "left-right";
    nodes: RouteNode[];
    edges: RouteEdge[];
  };
  endings: StoryEnding[];
  savePoints: StorySavePoint[];
  aiConfigs: AiRuntimeConfig[];
};

export type StoryDiagnostic = {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  sceneId?: Id;
  blockId?: Id;
  assetId?: Id;
  path?: string;
};

export type StoryPatch =
  | { op: "set"; path: string; value: unknown }
  | { op: "insert"; path: string; index?: number; value: unknown }
  | { op: "remove"; path: string; index?: number }
  | { op: "move"; from: string; path: string; index?: number }
  | { op: "test"; path: string; value: unknown };

export type OperationRecord = {
  id: Id;
  label: string;
  actor: "human" | "ai" | "import" | "system";
  timestamp: string;
  operations: StoryPatch[];
  inverse: StoryPatch[];
};

export type CompileFile = {
  path: string;
  content: string;
  contentType: string;
};

export type CompileResult = {
  files: CompileFile[];
  diagnostics: StoryDiagnostic[];
  sceneScripts: Record<Id, string>;
  entrypoint: string;
};

export type ImportFormat = "json" | "markdown" | "renpy" | "webgal" | "tagged" | "natural";

export type ImportResult = {
  format: ImportFormat;
  confidence: number;
  blocks: StoryBlock[];
  diagnostics: StoryDiagnostic[];
  discovered: {
    characterNames: string[];
    assetAliases: string[];
  };
};
