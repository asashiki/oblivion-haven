export type WebGalCapabilityStatus = "ready" | "provider" | "native-only";

export const WEBGAL_CAPABILITIES = [
  { id: "dialogue", label: "对白 / 旁白 / ADV / NVL", command: "say · intro · setTextbox", status: "ready", tools: ["add_dialogue", "set_text_mode"] },
  { id: "figure", label: "立绘进退场、差分、左中右与自由构图", command: "changeFigure · setTransform", status: "ready", tools: ["enter_character", "exit_character", "move_character", "set_expression", "set_figure_position"] },
  { id: "sprite-animation", label: "图片立绘动嘴与自动眨眼", command: "changeFigure mouth* / eyes* · say figureId", status: "ready", tools: ["enter_character", "add_dialogue"] },
  { id: "background", label: "背景与背景转场", command: "changeBg", status: "ready", tools: ["set_background"] },
  { id: "animation", label: "临时动画、舞台动画、变换与缓动", command: "setAnimation · setTempAnimation · setTransform", status: "ready", tools: ["set_stage_animation", "move_character"] },
  { id: "music", label: "BGM、淡入淡出与音量", command: "bgm", status: "ready", tools: ["set_bgm", "stop_bgm"] },
  { id: "voice", label: "角色语音与对白绑定", command: "say -vocal", status: "ready", tools: ["set_voice"] },
  { id: "tts", label: "一键 TTS 生成语音资源", command: "Provider → voice asset → say -vocal", status: "provider", tools: ["generate_tts", "set_voice"] },
  { id: "sfx", label: "音效", command: "playEffect", status: "ready", tools: ["play_sfx"] },
  { id: "video", label: "视频演出", command: "video", status: "ready", tools: ["play_video"] },
  { id: "branch", label: "选择、分支、回环、场景调用", command: "choose · changeScene · jumpLabel · callScene", status: "ready", tools: ["add_choice", "connect_branch"] },
  { id: "variables", label: "变量、条件与玩家输入", command: "setVar · if · getUserInput", status: "ready", tools: ["set_variable", "add_free_input"] },
  { id: "timing", label: "等待与节奏控制", command: "wait", status: "ready", tools: ["wait"] },
  { id: "unlock", label: "CG / BGM 鉴赏解锁", command: "unlockCg · unlockBgm", status: "native-only", tools: [] },
  { id: "pixi", label: "PIXI 特效、滤镜与自定义舞台效果", command: "pixi · setFilter · setTransition", status: "native-only", tools: [] },
  { id: "live2d", label: "Live2D / Spine", command: "changeFigure(json/skel)", status: "native-only", tools: [] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  command: string;
  status: WebGalCapabilityStatus;
  tools: readonly string[];
}>;
