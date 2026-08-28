# 可迁移架构：Galgame 立绘、表情与 WebGAL 口型差分

## 目录

1. 默认产物
2. 五层拆分
3. 四阶段状态机
4. 稀疏运行时差分
5. 目录与正式交付
6. Provider 映射
7. 一致性与失败处理

## 默认产物

默认独立母版共十张：

- 一张军姿式标准人设基准 `reference_normal`；
- 三张差异明确的闭嘴、中性动作基准 `idle`、`side`、`reserved`，它们本身就是三张可运行的 `normal`；
- 六张额外情绪母版 `laugh`、`thinking`、`angry`、`sad`、`surprised`、`shy`。

不再生成独立 `normal` 或普通 `smile`。普通说话感由三张 normal 母版的嘴型切换承担。

默认运行时只生成实际需要的状态：

- 所有启用口型的母版：`mouth_half_open`、`mouth_open`；
- 所有睁眼且 `blink=dynamic` 的母版：`eyes_half`、`eyes_close`；
- `laugh` 与 `thinking` 固定闭眼，不生成眼睛状态；
- `eyes_half` 不是 WebGAL 自动眨眼的必需状态，但默认保留为可单独调用的附加情绪素材。

默认共 42 次图片调用：1 基准 + 3 姿势 + 6 表情 + 32 个稀疏眼嘴候选。每个候选都从自己的批准母版独立生成。相较于给全部母版机械生成四件套，固定闭眼的 `laugh` 与 `thinking` 各省去两次无意义眼睛调用。

## 五层拆分

```text
core/
  config + prompt builder + manifest + state transitions
provider/
  work_imagegen | openai_image_api
image/
  alpha routing + transparent img2img + optional cutout fallback + normalize + region masks + forced composite
export/
  WebGAL full frames + replacement parts + runtime manifests + previews + inventory
ui/
  base review + pose review + expression review + result gallery
```

- `core` 不导入图片 Provider SDK。
- `provider` 只负责单次生成或编辑。
- `image` 不信任模型的蒙版边界，只让本地许可蒙版内的像素进入成品。
- `export` 只接受已批准且哈希未变化的母版与已登记运行时帧，并同时导出完整帧与精确矩形替换片。
- `ui` 不直接跳过批准门；用户明确预授权无人值守时仍逐门记录批准哈希。

## 四阶段状态机

| 当前状态 | 允许动作 | 下一状态 |
| --- | --- | --- |
| `BASE_PENDING` | 生成标准人设基准 | `BASE_REVIEW` |
| `BASE_REVIEW` | 批准基准 | `POSES_PENDING` |
| `POSES_PENDING` | 分别生成三张中性姿势 | 全部完成后 `POSES_REVIEW` |
| `POSES_REVIEW` | 批准姿势组 | `EXPRESSIONS_PENDING` |
| `EXPRESSIONS_PENDING` | 分别生成六张表情母版 | 全部完成后 `EXPRESSIONS_REVIEW` |
| `EXPRESSIONS_REVIEW` | 批准表情组 | `RUNTIME_PENDING` |
| `RUNTIME_PENDING` | 生成并强制合成稀疏眼嘴状态 | 全部完成后 `COMPLETE` |

批准时记录输入 Alpha 路由、透明生成源图与透明成品哈希。只有用户明确开启兼容后备时才记录色键源图。任一已批准文件改变后，后续登记或导出必须失败。

## 稀疏运行时差分

每个姿势配置一个 `mask_profile`。映射到同一姿势的表情复用该姿势的眼、嘴位置，再按实际脸部边界微调。不要用蓝色像素、固定坐标或单一人脸检测器硬猜所有角色。

运行时候选直接使用从批准透明母版按固定坐标制作的局部编辑板，不再先铺色键。为每个 mask profile 输出：

- 本地许可蒙版：白色表示允许进入成品；
- API 编辑蒙版：透明区域表示允许编辑；
- 蒙版叠加预览：眼区红色、眉毛活动区橙色；必须目视确认两者覆盖所有可能残留的旧黑线，同时不切到无关刘海、鼻子或脸轮廓。

最终帧的定义：

```text
final = approved_base outside local mask
      + generated_candidate inside local mask
```

本地 QA 必须证明许可蒙版为零处的变化像素数是 `0`、Alpha 变化为 `0`，并检查许可区内肤色/浅色表面的中位数与 P95 色差。眨眼把眼睛和眉毛视为一个状态：眼角固定，眉毛允许小幅自然联动，但旧眉毛、旧睫毛和远处黑块必须全部清除。两档嘴型只允许小幅差别：`mouth_open` 比 `mouth_half_open` 稍大一步，不得在小嘴与夸张大张嘴之间跳变。

## 目录与正式交付

```text
runs/<run-id>/
  config.json
  manifest.json
  work/
    prompts/
    source/
    cutouts/
    finals/
    transforms/
    masks/
    runtime/
      sources/
      candidates/
      frames/
      parts/
    qa/
  deliverables/
    README.md
    webgal-manifest.json
    inventory.json
    figures/
      <slug>_<runtime-id>_base.png
      <slug>_<runtime-id>_mouth_half_open.png
      <slug>_<runtime-id>_mouth_open.png
      <slug>_<runtime-id>_eyes_half.png
      <slug>_<runtime-id>_eyes_close.png
    parts/
      <slug>_<runtime-id>_<state>_part.png
    runtime/
      runtime-manifest.json
      sprite-compositor.js
      preview.html
    previews/
```

`deliverables/figures` 只放 WebGAL 可直接使用的同画布完整帧。`deliverables/parts` 放自研运行时所需的精确替换片；它们由已验收完整帧按 `mask_bbox` 裁出，必须通过“清空矩形后按坐标画回”使用。蒙版、模型源图、提示词和 QA 仍在 `work/`，不得混入正式资源目录。

默认关闭 GIF。联系表与可选 GIF 都只是验收材料，实时说话与眨眼由 `runtime/sprite-compositor.js` 根据对白时长和随机眨眼计时完成，并保持透明画布与 PNG 原画质。

WebGAL 当前素材契约见 [webgal-mouth-sync.md](webgal-mouth-sync.md)。

## Provider 映射

### Codex / Work

使用内置 `$imagegen` 调用当前最新的 `image2` 生图模型，不得降级到 `gpt-image-1.5`。真实 RGBA 输入直接保留；不透明输入先做一次高保真透明图生图并复核真实 Alpha，再进入眼嘴处理。每个姿势、表情和眼嘴状态各调用一次。运行时候选的输入是批准母版的固定坐标局部编辑板。

### OpenAI API

仅在用户明确选择 API 模式并配置 `OPENAI_API_KEY` 时使用 `scripts/gpt_image2_adapter.py`。运行时候选可同时传完整画布母版与 API 编辑蒙版，但本地强制合成仍不可省略。

Provider 不得改变提示词构建、批准状态、目录布局或最终合成规则。

## 一致性与失败处理

1. 先按文件真实 Alpha 路由：有效 RGBA 直通；不透明图做一次透明图生图；色键抠图只有用户显式允许时才可后备。
2. 每个姿势拥有独立规范化 transform；其表情复用对应姿势 transform。
3. 三张姿势必须在完整身体轴线、手势与重心上有明显差异；若缩略图下仍可互换，姿势组不通过。
4. 表情在映射姿势的脸部以外做漂移比较，失败只重试一次。
5. 运行时候选从各自批准母版独立生成，不从另一嘴型或眼睛状态继续加工。
6. 模型输出只作候选；正式帧必须经过许可蒙版合成、零外漂移、零 Alpha 变化与许可区肤色一致性验证。
7. 每张半闭/闭眼都用包含眉毛与附近发际线的宽上下文复核图检查旧黑线、远处黑块、双眉重影和肤色块。
8. 导出前强制完整解码全部 PNG、JPG 与 GIF，并核对清单哈希。
