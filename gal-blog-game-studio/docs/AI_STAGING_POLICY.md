# AI 立绘演出策略

Studio 的普通 AI 导演只提交 `PerformanceCue`，不直接决定 WebGAL 的位移、缩放、动画名或毫秒数。默认动作是 `hold`；“换了说话人”本身不是动作理由。

## 工作流

1. 读取当前场景、入口舞台、可用角色与差分、当前及最近 6 句 Cue。
2. 标出明确剧情节拍：入场、离场、明确肢体动作、情绪转折、被直接点名、揭示、包袱或冲击。
3. 没有上述节拍时保持不动。
4. 通过 `plan_staging` 提交语义 Cue。
5. 校验器删除重复、越界、无理由、过密或破坏连续性的 Cue。
6. 编译器把有效 Cue 映射到固定安全预设；预览面板显示目标、时机、强度与原因。

低层 `move_character`、`set_stage_animation`、任意 `wait` 和强效果只留在高级手工模式，不属于普通 AI 导演工具面。

## 支持的语义

| Intent | 用途 | 默认实现 |
| --- | --- | --- |
| `hold` | 没有必要动作 | 不生成动画 |
| `enter` / `exit` | 角色真实进出舞台 | 36px + alpha，340–360ms |
| `expression-change` | 同姿势换表情 | 原位 160ms 柔切 |
| `pose-change` | 同角色换整套立绘 | 保持站位、比例与脚点的 160ms 柔切 |
| `listener-react` | 被直接点名或信息落到听者身上 | 至多一次轻微反应，或仅换差分 |
| `micro-emphasis` | 一句中的克制强调 | 上移 14px、放大 1.5%，340ms 后精确复位 |
| `micro-recoil` | 明确的吃惊/退缩 | 横移 24px，340ms 后精确复位 |
| `reframe` | 明确的镜头重构 | MVP 仅记录意图，不自动编造镜头参数 |

## 硬规则

- 每个非 `hold` Cue 必须有 `reason`。
- 一句最多一个可见 Cue；一个听者每句最多一次反应。
- 任意连续 4 句普通对白最多一次身体或镜头动作。
- 同角色同一临时动作默认冷却 6 句；只有剧情明确连续动作可例外。
- 已在场角色不能再次 `enter`；不在场角色不能 `exit` 或执行身体动作。
- `during-line` 必须绑定原文 `anchorText` 或已有 `voiceTimeMs`，禁止随机猜毫秒。
- 临时动作只作用于视觉层并精确归零，不能改写基础 transform，不能累积漂移。
- 表情/姿势切换保持角色位置、比例和脚点；相同状态不重复切换。
- 强度 `high` 只接受明确肢体动作、揭示、冲击、真实进出场等强事件原因。
- 手动点击、自动、快进和重播必须收敛到同一稳定角色状态。

## 当前安全预设

`diff-crossfade`、`micro-emphasis`、`micro-recoil-left/right`、`soft-enter-left/right`、`soft-exit-left/right`。

旧的 ±100px `shake`、1.15 倍 `move-front-and-back`、冲击波和电影滤镜仍可由高级编辑器手工使用，但不会出现在普通 AI 导演工具表中。
