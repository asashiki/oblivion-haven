# 可迁移架构：Galgame 立绘差分生成器 v1

## 目录

1. 目标与边界
2. 三层拆分
3. 参考图权限与身份锁定
4. 状态机与按钮
5. 配置与产物
6. gpt-image-2 映射
7. 一致性与失败处理

## 目标与边界

v1 固定生成三张透明全身立绘：`normal`、`smile`、`laugh`。先只生成 `normal`，由用户确认后，再分别生成后两张。

将“透明背景”实现为两步：生成单色色键源图，再由本地脚本生成 alpha。不要让图片模型自行输出白底、黑底、棋盘格或伪透明背景。

## 三层拆分

保持以下边界，迁移时只替换 provider：

```text
core/
  config + prompt builder + manifest + state transitions
provider/
  work_imagegen | openai_image_api
image/
  choose key + cutout + normalize + validate + drift compare
ui/
  upload + base preview + approve/regenerate buttons + result gallery
```

- `core` 不导入 OpenAI SDK。
- `provider` 只接受提示词、输入图、尺寸、质量和输出路径。
- `image` 不知道图片由哪个模型生成。
- `ui` 不直接拼提示词，也不自行改变状态。

## 参考图权限与身份锁定

每次运行必须有且仅有一张 `primary-character`。它决定人物身份、视觉年龄、脸型、头身比、腿身比、体型、服装与原始画风。`supporting-character` 只能补全遮挡细节，`detail-style` 只能提高线稿、眼睛、发丝与上色精度，`pose-only` 只能提供动作。次级参考无论多精细，都不得覆盖主参考的人脸、年龄感或身体比例。

旧式纯路径数组将第一张视为主参考。新运行优先在 `reference_images` 中写入带 `path` 与 `role` 的对象，并按相同顺序传给 provider。

“转换成标准站姿”只授权改变姿势、构图和补全遮挡，不授权美化或重设解剖。固定保留主参考的脸部几何、头部大小、头身比、躯干长度和腿身比；禁止默认拉高、瘦身、缩头、拉长颈部或腿部、锐化下巴以及让角色显得更成熟。缺失部位无法判断时，采用与主参考面部和原作日系二次元风格一致的紧凑解释，不得用成人模特比例填补不确定性。

## 状态机与按钮

持久化以下状态：

| 当前状态 | 允许动作 | 下一状态 |
| --- | --- | --- |
| `BASE_PENDING` | 生成通常立绘 | `BASE_REVIEW` |
| `BASE_REVIEW` | 重做通常立绘 | `BASE_PENDING` |
| `BASE_REVIEW` | 生成表情差分 | `VARIANTS_PENDING` |
| `VARIANTS_PENDING` | 分别生成 smile/laugh 并校验 | `COMPLETE` |
| `COMPLETE` | 重做通常立绘 | `BASE_PENDING`，并使旧差分失效 |

“生成表情差分”按钮必须校验当前 `manifest.state == BASE_REVIEW`，并记录被批准的通常立绘文件哈希。后续两张差分都绑定该哈希，防止用户重做了通常立绘却误用旧差分。

## 配置与产物

采用 [default-config.json](default-config.json) 与 [config.schema.json](config.schema.json)。关键参数包括：

- 人物 slug、描述、按权限标注的参考图、必须保留和必须避免的细节；
- 目标尺寸、质量、安全边距、锚点和基础站姿；
- 色键选择模式、候选色、透明/不透明阈值、软边与去溢色；
- 表情定义；
- 允许变化的脸部区域和非脸部漂移告警阈值；
- 确认门、重试次数和是否保留中间文件。

图像处理依赖见 [requirements.txt](requirements.txt)。`scipy` 用于在大尺寸图上快速寻找与画布边缘连通的色键区域；缺少它时脚本会使用较慢的 Pillow 回退。`openai` 仅在 API provider 中需要。

建议每次运行使用独立目录：

```text
runs/<run-id>/
  config.json
  manifest.json
  prompts/
    normal.txt
    smile.txt
    laugh.txt
  source/
    <slug>_normal_key.png
    <slug>_smile_key.png
    <slug>_laugh_key.png
  working/
  qa/
  base-transform.json
  <slug>_normal.png
  <slug>_smile.png
  <slug>_laugh.png
  <slug>_expressions_preview.png
```

## gpt-image-2 映射

### Codex / Work 内置模式

在 Codex 中显式调用 `$generate-galgame-sprite-diffs`；需要生图时由流程调用内置 `$imagegen`。当前 Codex 内置生图使用 `gpt-image-2` 并计入 Codex 用量，不要求设置 `OPENAI_API_KEY`。在 Work 中使用同一技能及其可用的内置生图能力。

只有在用户明确选择独立 API 模式时，才运行下述适配器并读取 `OPENAI_API_KEY`。Codex 当前生图说明见 [OpenAI Image generation](https://learn.chatgpt.com/docs/image-generation)。

### 独立 API 模式

以 OpenAI Image API 作为独立项目的 provider：

- 没有参考图时，通常立绘调用 `images.generate`。
- 有角色参考图时，通常立绘调用 `images.edit`，将参考图作为 identity/style reference。
- 表情差分始终调用 `images.edit`，输入为批准后的 `<slug>_normal_key.png`。
- `smile` 与 `laugh` 各发一个请求；不要用同一个 `n` 请求代替不同提示词。
- 直接指定 `model="gpt-image-2"`、配置中的 `size` 与 `quality`。
- 不传 `input_fidelity`；`gpt-image-2` 会自动高保真处理图片输入，当前接口不允许修改该参数。
- 不请求 `background="transparent"`；`gpt-image-2` 当前不支持透明背景，继续使用色键流程。
- 默认 PNG，保存返回的 base64 图片数据。

可先检查适配器请求而不联网：

```bash
python scripts/gpt_image2_adapter.py \
  --prompt-file runs/demo/prompts/normal.txt \
  --out runs/demo/source/demo_normal_key.png \
  --size 1024x1536 --quality high --dry-run
```

真正调用时移除 `--dry-run` 并提供 `OPENAI_API_KEY`。官方接口与尺寸约束应以 [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation) 为准。

## 一致性与失败处理

提示词只能约束模型，不能保证非脸部逐像素不变。因此增加第二道程序化检查：

1. 对所有请求使用同一目标色键和阈值，但对每张模型输出重新采样实际边缘色；每张透明成品都用其自身 cutout 报告中的实际色键做残色校验，不能复用全局请求色或另一张图的采样色。
2. 默认删除画面中所有接近实际色键的像素，包括发丝、缎带、手臂或衣服围成的封闭背景孔；只有明确接受主体同色冲突时才使用边缘连通模式。
3. 由通常立绘生成一次 `base-transform.json`；所有差分复用同一裁切、缩放和落点。
4. 在配置的脸部区域以外比较 alpha 轮廓 IoU 与 RGB 平均差异。
5. 超阈值时，用更短的“只改脸部”提示词重试一次。
6. 第二次仍失败时保留最优结果并显式标出漂移，不继续自动消耗请求。

如需更严格的一致性，可在未来版本加入用户可调整的脸部 mask，并传给 Image API edits；mask 仍是指导而非绝对像素锁。对服装、手部和姿势要求完全像素不变的产品级场景，最终应考虑“只生成脸部局部层，再与批准的身体底图合成”的分层方案。
