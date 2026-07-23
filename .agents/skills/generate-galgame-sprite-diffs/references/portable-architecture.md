# 可迁移架构：Galgame 立绘姿势与表情生成器

## 目录

1. 目标与边界
2. 四层拆分
3. 参考图权限
4. 三阶段状态机
5. 配置与产物
6. Provider 映射
7. 一致性与失败处理

## 目标与边界

默认生成十一张独立图片：

- 一张军姿式标准人设基准 `reference_normal`；
- 四张中性姿势基准 `idle`、`engaged`、`firm`、`reserved`，其中 `engaged` 默认承担整组唯一明显的受控三分之四侧身；
- 六张额外表情编辑，与 `idle` 本身组成七种运行时表情。

标准人设基准负责稳定身份、视觉年龄、脸型、头身比、腿身比、服装、配色和画风；它不是最终的对话表演姿势。姿势必须分别从标准基准生成，表情必须分别从其映射的已批准姿势生成。

透明背景采用“单色色键源图 + 本地 alpha 处理”，不要让图片模型输出白底、棋盘格或伪透明。

## 四层拆分

```text
core/
  config + prompt builder + manifest + state transitions
provider/
  work_imagegen | openai_image_api
image/
  choose key + cutout + normalize + validate + drift compare
ui/
  upload + reference review + pose review + result gallery
```

- `core` 不导入 OpenAI SDK。
- `provider` 只接受提示词、输入图、尺寸、质量和输出路径。
- `image` 不知道图片由哪个模型生成。
- `ui` 不直接拼提示词或跳过确认门。

## 参考图权限

每次运行必须有且仅有一张 `primary-character`。它决定人物身份、视觉年龄、脸型、头身比、腿身比、体型、服装与原始画风。

- `supporting-character`：只补全被遮挡的人设细节。
- `detail-style`：只提供线稿、眼睛、发丝和上色精度。
- `pose-only`：只提供动作。

次级参考不得覆盖主参考的人脸、年龄感或身体比例。标准站姿只允许改变动作、构图和补全遮挡，不允许拉高、瘦身、缩头、拉长颈部或腿部、锐化下巴或增龄。

姿势性格来源优先级：

1. 用户明确设定；
2. 主参考中适合复用的低强度动作；
3. 用户提供的可靠辅助参考；
4. 保守低强度默认值。

不得仅凭角色外貌推断强烈性格。默认让 `engaged` 的身体与胯部向任一侧转约 15–25 度，脸只偏离正面约 8–12 度或轻微回看，肩线、躯干、衣摆、双脚和重心必须沿同一轴线协调变化；其他三个姿势保持正面或近正面。超过约 30 度的转身、侧脸和强动作属于可选 `special_pose`。

## 三阶段状态机

| 当前状态 | 允许动作 | 下一状态 |
| --- | --- | --- |
| `BASE_PENDING` | 生成标准人设基准 | `BASE_REVIEW` |
| `BASE_REVIEW` | 重做基准 | `BASE_PENDING` |
| `BASE_REVIEW` | 批准基准 | `POSES_PENDING` |
| `POSES_PENDING` | 分别生成中性姿势 | 全部完成后 `POSES_REVIEW` |
| `POSES_REVIEW` | 重做姿势组 | `POSES_PENDING` |
| `POSES_REVIEW` | 批准姿势组 | `EXPRESSIONS_PENDING` |
| `EXPRESSIONS_PENDING` | 生成映射表情并校验 | `COMPLETE` |
| `COMPLETE` | 重做姿势组 | `POSES_PENDING` |
| `COMPLETE` | 重做人设基准 | `BASE_PENDING` |

批准基准和姿势组时记录色键源图与透明成品哈希。任何被批准文件发生变化时，后续阶段必须拒绝继续。

## 配置与产物

采用 [default-config.json](default-config.json) 与 [config.schema.json](config.schema.json)。主要配置：

- `character`：角色描述、参考图角色、保留项和禁止项；
- `render`：尺寸、质量、安全边距、锚点和标准参考站姿；
- `pose_design`：性格证据、动作幅度、招牌动作和禁止动作；
- `poses`：可复用中性姿势；
- `expressions`：表情及其姿势映射；
- `chroma_key`、`qa`、`workflow`、`output`。

建议目录：

```text
runs/<run-id>/
  config.json
  manifest.json
  prompts/
    reference_normal.txt
    pose_idle.txt
    pose_engaged.txt
    pose_firm.txt
    pose_reserved.txt
    expression_smile.txt
    ...
  source/
    <slug>_reference_normal_key.png
    <slug>_normal_key.png
    <slug>_engaged_normal_key.png
    ...
  working/
  pose-transforms/
    idle.json
    engaged.json
    firm.json
    reserved.json
  qa/
  <slug>_reference_normal.png
  <slug>_normal.png
  <slug>_engaged_normal.png
  <slug>_firm_normal.png
  <slug>_reserved_normal.png
  <slug>_smile.png
  ...
```

每个姿势拥有自己的规范化 transform；该姿势对应的表情复用它。不得用标准参考的 transform 强行对齐所有姿势。

## Provider 映射

### Codex / Work 内置模式

在 Codex 中调用 `$generate-galgame-sprite-diffs`，生图步骤使用内置 `$imagegen`。内置路径不要求 `OPENAI_API_KEY`。

### 独立 API 模式

仅在用户明确选择 API 模式时使用 `scripts/gpt_image2_adapter.py`：

- 标准参考：无图时 `images.generate`，有图时 `images.edit`；
- 每个姿势：分别编辑批准后的 `reference_normal`；
- 每个表情：分别编辑其映射的批准姿势；
- 不用一个 `n` 请求代替不同提示词；
- 不从上一张姿势或表情继续编辑；
- `gpt-image-2` 不传 `input_fidelity`，继续采用色键流程。

## 一致性与失败处理

1. 每张生成图都重新采样实际边框色，并用自己的采样色验证残留。
2. 默认以 `scope=all` 删除封闭区域中的色键背景。
3. 标准参考使用单独 transform；每个姿势生成并保存自己的 transform。
4. 姿势阶段只做 alpha、边界、完整度和色键 QA，由用户检查动作、人设与比例；同时确认 `engaged` 的侧身来自完整身体轴线变化，而非只换手势。
5. 表情阶段在映射姿势的脸部区域外比较 alpha IoU 与 RGB 差异。
6. 表情超阈值时只重试一次；仍失败则保留最佳结果并报告漂移。

提示词无法保证像素级不变。对服装和身体必须完全不变的产品级流程，可进一步改成“局部脸层生成 + 与批准身体底图合成”。
