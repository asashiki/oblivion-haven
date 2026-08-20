# Facial Motion + WebGAL 实机规范

这套 Studio 保留 WebGAL 4.6.2 作为真正的运行引擎。Studio 只负责把角色素材、演出计划和独立眼嘴图层编译成 WebGAL 工程；不是另起一个替代引擎。

## MVP 运行链路

1. `game/scene/*.txt` 仍是 WebGAL 剧本，台词通过 `-vocal` 播放语音。
2. `game/face-motion/layers.json` 登记每个角色/表情的基础立绘、眼睛部件、嘴巴部件与原图坐标。
3. `game/extensions/face-motion-adapter.js` 在 WebGAL 引擎加载后挂接 `pixiStage`。
4. WebGAL 原本会把整张图换成嘴型/闭眼图；适配器改为在同一个 Pixi figure container 中追加 `eyes`、`mouth` 两个 Sprite，因此闭眼与张嘴可以同时存在，互不覆盖。
5. Studio 预览默认是 `WebGAL A`；`Studio B` 只用于和 Story IR 分层播放器做 A/B 对照。

## 素材契约

每个表情的 `facialMotion.parts` 必须使用与母版同一画布坐标。不要把一张图裁成“看起来差不多”的位置再靠 CSS 猜位置。

```json
{
  "base": "face-motion-demo/expressions/welcome-base.png",
  "canvas": { "width": 1024, "height": 1536 },
  "eyes": { "open": { "file": "...", "rect": { "x": 403, "y": 286, "width": 201, "height": 76 } } },
  "mouth": { "open": { "file": "...", "rect": { "x": 482, "y": 364, "width": 70, "height": 54 } } }
}
```

眼睛建议至少 `open / half / closed`，嘴巴建议 `closed / half / open`。侧脸如果远眼被遮挡，应在该表情禁用远眼，不要强行生成一只不符合透视的眼睛。

## 语音与口型

正式素材制作阶段使用 `Facial Motion Lab` 离线分析语音：24ms RMS 窗口、attack/release、迟滞、最短保持时间和静音合并，导出 `mouth-timeline.json`。这样可以避免 50ms 随机抖嘴与静音时误张嘴。

在 MVP 中，WebGAL 的 `-vocal` 仍负责真实音频播放和生命周期，适配器只接管最终眼嘴层的显示；基础图保留闭嘴/睁眼作为安全回退。后续若要把离线时间线直接交给 WebGAL，可在同一适配器中以 `currentVocal.currentTime` 驱动时间线，不改变剧本格式。

## 眨眼与切换

- 眨眼为 `half → closed → half → open`，闭眼约 75ms，间隔使用固定 seed 的随机分布。
- 表情切换前后保留脚点、中心、缩放和 z-index；只在有剧情理由时做柔和换姿势。
- 不在语音开始强制立刻眨眼，不在每句台词都 shake/zoom。
- 台词中演出用 `staging.cues` 表达原因（listener-react、emotional-turn、punchline 等），编译器负责校验资源和时间点。

## Studio 使用

1. 打开 Studio 的“预览/试玩”。
2. 选择 `WebGAL A · 分层适配`，播放默认的 Mai MVP 片段：迎接姿势、语音、眨眼、口型与句中说明手势切换。
3. 点击 `Studio B · 对照`，确认差异只来自运行时，不是换了一套素材。
4. 在 `Facial Motion Lab` 导入自己的语音，拖动时间线检查口型；通过“表情切换”检查换姿势时脚点是否跳动。
5. 导出时保留 `game/face-motion/layers.json` 与 `game/extensions/face-motion-adapter.js`，不能只导出整图。

## 给 AI 的内容生成规则

AI 只提出语义 cue：谁看谁、为什么动、强度、发生在台词前/中/后；不能自由发明资源路径或连续震动。生成后必须通过：资源存在性、图层坐标、表情连续性、pause-safe、auto-mode-safe 和最小动作幅度校验。

推荐工作流是：批准的母版 → 固定区域眼睛双栏板/嘴巴双栏板 → 本地切片 → 像素 QA → Studio A/B → 最后才接剧情。不要在运行时让模型重新猜眼睛和嘴巴位置。

