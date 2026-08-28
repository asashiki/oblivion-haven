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

因此不要把局部眼嘴零件或 `figure.json` 当作当前 WebGAL 口型参数的交付格式。技能仍正式导出透明矩形替换片与 Canvas 合成工具，供自研引擎、调试或未来接入使用；当前 WebGAL 交付仍须同时包含程序强制合成后的完整帧。

## 自研 Canvas 合成契约

每个局部状态同时导出：

- 从已验收完整帧按 `mask_bbox` 裁出的透明矩形替换片；
- `runtime/runtime-manifest.json` 中的 `x/y/width/height`；
- `patch_mode=replace-rect`。

运行时必须先 `clearRect(x, y, width, height)`，再把替换片画回同一矩形。不要把它当普通半透明贴纸直接叠加，否则发丝或抗锯齿边缘可能被重复混色。眼区和嘴区互不重叠时可以同时应用，从而得到眨眼中的说话帧。

## 技能映射

| 技能状态 | WebGAL 参数 | 是否需生图 |
| --- | --- | --- |
| `base` | 默认图、`mouthClose`、动态睁眼时的 `eyesOpen` | 已有母版，不额外生成 |
| `mouth_half_open` | `mouthHalfOpen` | 是 |
| `mouth_open` | `mouthOpen` | 是 |
| `eyes_close` | `eyesClose` | 仅 `blink=dynamic` 时 |
| `eyes_half` | 无正式参数 | 默认随睁眼母版导出，可作为半眯眼／附加情绪素材单独调用 |

模型候选不得直接交付，也不得把整张全身立绘的模型输出按母版同坐标直接裁成眼嘴部件。运行时编辑必须先从母版按固定坐标准备 `1024×1024` 局部面部编辑板，模型只编辑该板；程序可将工具返回的更大正方形整体等比归一化到计划尺寸，再按记录裁框缩回母版，并只允许眼睛或嘴巴蒙版内的像素进入最终完整帧。候选纵横比或裁图语义发生变化时直接判退，禁止自动平移、扭曲或单独拉伸眼睛去对位。

嘴部蒙版只覆盖原闭嘴线、最大计划开口和 2–3 像素抗锯齿安全环，羽化外缘不得触及鼻子或大片脸颊、下巴皮肤。每张嘴型必须以 8 倍最近邻方式检查并与母版慢速切换；鼻子、嘴左上方皮肤、脸颊或下巴出现方块、软焦、色带或纹理变化时直接判退。`outside_mask_changed_pixels: 0` 不能替代这项检查，因为过大的嘴部蒙版本身会把低清皮肤重绘合法地带入最终帧。

眼区蒙版必须把原始虹膜、眼白、上下眼线、睫毛尖及抗锯齿暗边全部收入不透明核心；另为左右眉毛各画一条独立活动核心，覆盖旧眉线及眨眼时允许的小幅移动路径。不要用一个巨大矩形吞掉刘海和脸部。羽化只能向外围干净皮肤扩展，不能降低核心替换强度。`outside_mask_changed_pixels: 0` 只证明没有越界，不代表新眼睛已经对位、旧黑线已经清除或许可区内肤色正确。生成前记录母版双眼四个内外眼角锚点；半闭眼与闭眼的新眼睑端点须落回对应锚点，最终画布误差不得超过 2 像素，眼睑中点不得跳出原眼裂。眉毛属于眨眼状态，默认允许并要求轻微、连贯的联动，同时保持原表情方向；禁止一刀切地固定眉毛，也禁止旧眉与新眉同时存在。每张 `eyes_half`、`eyes_close` 都必须检查包含眉毛、附近皮肤与发际线的宽上下文 4 倍复核图、明暗底成图和变化热图，慢速切换母版与最终帧，并明确记录 `pass/fail`。拒绝眼角跳位、上下漂移、双眼间距或透视比例变化、旧上眼眶、平行灰黑弧线、虹膜／眼白碎片、远处黑块、孤立睫毛尖、断开的旧眉毛、双眉重影、蒙版边缘混回旧眼线，以及任何与母图色相、明度、纹理或抗锯齿不一致的皮肤色块。仅生成复核图不构成通过。

复核图属于 `work/qa` 内部证据，不是运行素材，也不应默认放进交付包或聊天页面。默认只交付完整帧、局部替换片、运行清单与合成工具；GIF 和展示联系表仅在用户明确要求时生成。
