# AI 生成 Galgame 内容指南

这是给 Studio 内置 AI、外部 Codex 或内容作者的最小约束。目标是让 AI 生成“能运行、演出有理由、资源不漂移”的 WebGAL 内容。

## 资源登记

- 角色先登记基础姿势和表情母版，再登记眼睛/嘴巴差分。
- 所有差分绑定母版的 SHA-256 与画布坐标；禁止跨姿势复用蒙版。
- 外部抠图后可选做 1px 内侧轮廓线，颜色取局部色并降低对比，不生成粗黑边、白 halo 或贴纸边。
- 生成失败只重试失败 tile，不重跑整套角色。

## 演出语法

AI 只能使用有限 cue：`enter`、`exit`、`expression-change`、`pose-change`、`look-at`、`listener-react`、`micro-emphasis`、`micro-recoil`、`reframe`、`hold`。

每个 cue 必须回答：

1. 谁在动、目标是谁；
2. 为什么动（情绪转折、被点名、包袱、明确肢体动作等）；
3. 在台词前、中还是后发生；
4. 强度和持续时间；
5. 暂停、自动播放时是否仍然成立。

默认保持不动。听者在说话过程中轻微转向、改变表情，比每次点击整张换图自然；大面积 cut-in 只给高情绪节点。

## 编译与验收

AI 输出 Story IR 后交给编译器：

- WebGAL 仍执行场景、语音、文本、选择和转场；
- layered adapter 只负责眼睛/嘴巴 Sprite；
- validator 检查资源存在、表情存在、位置连续、cue 时间不越界；
- A/B 预览必须能证明 WebGAL 实机和 Studio 对照的差异。

最低验收标准：

- 闭眼 + 张嘴能同时显示；
- 眼态不会覆盖嘴态，嘴态不会覆盖眼态；
- 静音可靠闭嘴，无 50ms 随机抖动；
- 不在语音开始强制眨眼；
- 表情切换脚点、尺度、位置不跳；
- 暂停后不会卡在半闭或张嘴；
- 导出的运行包包含 `game/face-motion/layers.json` 和 `game/extensions/face-motion-adapter.js`。

