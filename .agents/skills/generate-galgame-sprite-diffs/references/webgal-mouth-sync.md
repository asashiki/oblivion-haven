# WebGAL 图片立绘口型与眨眼素材契约

核对日期：2026-07-29。

## 当前正式接口

WebGAL 的图片立绘口型同步使用 `changeFigure` 的完整图片差分参数：

- `mouthOpen`
- `mouthHalfOpen`
- `mouthClose`
- 可选 `eyesOpen`
- 可选 `eyesClose`

官方资料：

- [图片立绘嘴型同步](https://docs.openwebgal.com/webgal-script/animation.html#图片立绘嘴型同步)
- [`changeFigure` 参数参考](https://docs.openwebgal.com/script-reference/commands/changeFigure.html#mouthopen)

默认图通常承担闭嘴状态。引擎在有 `vocal` 时按实时音量切换三张嘴型；没有语音但对话指定了 `figureId`、`left`、`right` 或 `center` 时，会以模拟音量驱动。注册 `eyesOpen` 与 `eyesClose` 后，引擎自动随机眨眼。

这些参数接收图片路径，不接收局部坐标或小图层。因此正式 WebGAL 交付必须满足：

1. 每个差分都是完整画布透明 PNG；
2. 同一组图片的画布尺寸、人物位置、缩放和透明边缘完全一致；
3. `mouthClose` 可直接复用默认图；
4. 睁眼底图可作为 `eyesOpen`；只额外生成 `eyesClose`；
5. 固定闭眼的 `laugh`、`thinking` 不注册眼睛参数，否则引擎会错误地把它们随机切回睁眼。

示例：

```text
changeFigure:alice/alice_normal_idle_base.png -id=alice -mouthOpen=alice/alice_normal_idle_mouth_open.png -mouthHalfOpen=alice/alice_normal_idle_mouth_half_open.png -mouthClose=alice/alice_normal_idle_base.png -eyesOpen=alice/alice_normal_idle_base.png -eyesClose=alice/alice_normal_idle_eyes_close.png;
```

`animationFlag` 不是这套素材的必要参数。

## 与静态组合立绘 RFC 的边界

[RFC 0005：WebGAL 静态组合立绘](https://github.com/OpenWebGAL/WebGAL/issues/1010) 于 2026-07-23 提出，目前仍是开放 RFC。它以 WebGAL 4.6.2 行为为基线，明确把动态部件、局部替换、口型和眨眼列为首期非目标，并拒绝在组合命令中使用上述眼嘴参数。

因此不要把局部眼嘴零件或 `figure.json` 当作当前口型交付格式。技能可以保留透明局部零件供未来引擎、调试或再合成使用，但当前正式输出仍须是程序强制合成后的完整帧。

## 技能映射

| 技能状态 | WebGAL 参数 | 是否需生图 |
| --- | --- | --- |
| `base` | 默认图、`mouthClose`、动态睁眼时的 `eyesOpen` | 已有母版，不额外生成 |
| `mouth_half_open` | `mouthHalfOpen` | 是 |
| `mouth_open` | `mouthOpen` | 是 |
| `eyes_close` | `eyesClose` | 仅 `blink=dynamic` 时 |
| `eyes_half` | 无正式参数 | 仅用户点名时作为可选表情素材 |

模型候选不得直接交付。程序只允许眼睛或嘴巴蒙版内的像素进入最终完整帧，并验证蒙版外变化像素为 `0`。
