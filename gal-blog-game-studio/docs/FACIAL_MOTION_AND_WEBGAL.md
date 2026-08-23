# WebGAL 动态立绘制作与运行

本项目只有一条正式试玩链：`Studio → 试玩 → WebGAL 4.6.2`。不存在 WebGAL A、Studio B、静态 A、导演 B，也不使用独立实验室页面代替引擎验收。

## 1. 素材规格

每个角色表情至少需要一张透明背景基础立绘。启用独立面部图层时，还需要：

- 眼睛：`open`、`half`、`closed`；
- 嘴巴：`closed`、`half`、`open`；
- 所有部件必须来自同一基础立绘、同一画布与同一坐标系；
- 部件 PNG 只保留替换区域，其余像素透明；
- `rect` 是部件在原画布中的 `x / y / width / height`，不能按 Studio 预览尺寸填写；
- 基础立绘应使用自然闭嘴状态，避免停止语音后仍张嘴。

角色表情在 Story IR 中登记为 `character.expressions[]`。基础图放在 `assetId`，独立部件放在 `facialMotion.parts`，画布放在 `facialMotion.canvas`。两套姿势或表情必须分别登记，不能只替换文件名而共用错误坐标。

## 2. 语音与口型

对白通过 `voiceAssetId` 绑定语音。语音资源的 `metadata.mouthTimelinePath` 可绑定确定性的三态口型时间线：

```json
{
  "segments": [
    { "startMs": 0, "endMs": 120, "state": "closed" },
    { "startMs": 120, "endMs": 260, "state": "half" },
    { "startMs": 260, "endMs": 410, "state": "open" }
  ]
}
```

运行规则：

- 口型只跟随当前 `currentVocal.currentTime`，不按文字随机抖动；
- 暂停、结束、跳转或重播时立即恢复闭嘴；
- 短静音不会造成高频闪烁；
- 浏览器音频分析不可用时，仍使用确定性时间线；
- 没有语音的对白不会自动张嘴。

## 3. 自然眨眼

`figureAnimation.blink = "dynamic"` 启用自然眨眼。运行时使用稳定节奏并带轻微角色差异，不会在每句开头强制眨眼。姿势切换前后会抑制一次眨眼，避免眼睛图层和新立绘同时闪切。暂停后恢复睁眼。

## 4. 表情、姿势与演出

普通逐句切换使用对白的 `expressionId`。句中切换使用 `scene.staging.cues`：

- `timing: "during-line"`；
- `expressionId` 指向已登记的目标表情；
- `voiceTimeMs` 是相对当前语音起点的时间；
- 切换时保留角色位置、缩放、旋转、透明度和 zIndex；
- 默认只做低强度入场、柔和换姿势与必要的轻强调；
- 不因每句台词重复入场、弹跳、震屏或放大。

点击 WebGAL 对话框必须进入下一句；下一句自己的 `expressionId` 继续由 WebGAL 剧本执行。Studio 的逐句“从这里试玩”会先恢复该句之前的背景、BGM、立绘和模式，再跳到目标块。

## 5. Studio 调用流程

1. 在“素材库”上传背景、立绘、语音和音效；给素材填写角色、表情、用途与构图信息。
2. 为角色创建表情并绑定基础立绘；需要分层时填写 `facialMotion`。
3. 在“故事地图”建立片段和路线。
4. 在片段中添加入场、对白、表情、语音和必要的演出 Cue。
5. 打开“试玩”。这里直接运行 WebGAL 4.6.2，不选择其他播放器。
6. 验收语音、口型、眨眼、句中切换、点击下一句、站位和效果。
7. 通过“导出”生成正式可玩包和独立工程备份。

## 6. 正式导出

正式包必须同时包含：

- WebGAL 4.6.2 runtime；
- `game/scene/*.txt`；
- 基础立绘、语音和其他被引用素材；
- `game/face-motion/layers.json`；
- `game/face-motion/mouth-timeline.json`；
- `game/extensions/face-motion-adapter.js`；
- `game/figure/` 下全部眼睛和嘴巴部件。

缺少任一面部部件或时间线时，导出必须报错，不能生成一个表面成功、实际静态的包。

## 7. 最小验收标准

一次交付只有同时满足以下项目才算完成：

- Studio 里没有 A/B、实验室或自定义启动按钮；
- 试玩显示的确实是 WebGAL 4.6.2；
- 语音播放时嘴型至少出现 closed / half / open 的可见变化；
- 语音过程中至少发生一次自然眨眼；
- 指定时间切到第二套真实立绘且位置不跳；
- 点击对话框能进入下一句；
- 重播后状态复位；
- 正式导出包中能找到全部眼嘴部件和口型时间线。
