# Story Model / Story IR 1.0

权威 TypeScript 定义位于 `lib/story/types.ts`，运行时结构校验位于 `lib/story/schema.ts`。只含三份真实素材的最小可玩项目位于 `lib/story/example.ts`，也可从 `GET /api/example-project` 获取 JSON。

## 顶层结构

```json
{
  "schemaVersion": "1.0.0",
  "id": "project_alice_minimal",
  "title": "爱丽丝茶室 · WebGAL 实机验收样章",
  "slug": "alice-tea-room",
  "version": "0.4.0",
  "locale": "zh-CN",
  "settings": {
    "startSceneId": "scene_return",
    "defaultMode": "adv",
    "webgalVersion": "4.6.2",
    "sharedEngineUrl": "https://cdn.example.com/webgal/assets/index.js",
    "sharedEngineCssUrl": "https://cdn.example.com/webgal/assets/index.css",
    "blogBridge": {}
  },
  "chapters": [],
  "scenes": [],
  "characters": [],
  "assets": [],
  "variables": [],
  "records": [],
  "routeMap": { "nodes": [], "edges": [] },
  "endings": [],
  "savePoints": [],
  "aiConfigs": []
}
```

## 实体

| 实体 | 关键字段 | 说明 |
|---|---|---|
| Project | id、settings、集合 | 版本化的唯一根对象 |
| Chapter | sceneIds、order | 场景组织，不承担运行时跳转 |
| Scene | mode、entryStage、blocks | 可独立编译和启动 |
| Character | persona、expressions、aliases | 角色与 AI 上下文 |
| Asset | kind、path、aliases、missing | 资源注册表 |
| Variable | type、scope、defaultValue | scene/save/global 变量 |
| StoryRecord | name、description | 选项取得的一次性记录；同一局游戏只从 false 变为 true |
| RouteNode | kind、unlock/read/hidden、sceneId、x/y | 作者与玩家路线图；`routeMap.layoutDirection` 标记纵向或旧版横向坐标 |
| RouteEdge | source、target、recordCondition | 片段结束后的主干；支持全部记录或一组记录至少 N 个 |
| Ending | normal/bad/true | 结局语义 |
| SavePoint | sceneId、blockId | 博客深链与重玩入口 |
| AiConfig | mode、allowedTools、limits | AI 作者/实时策略 |

## 剧情块

`scene.blocks` 是有序联合类型：

- `dialogue`：角色、表情、语音、站位、transform 与 `choiceReactions`；局部反应只影响选项后的这一句。
- `narration`：ADV 旁白或 NVL 累积文本。
- `stage`：背景、BGM、音效、立绘进退场、移动、表情、转场和等待。
- `choice`：带稳定 `groupCode` 的选项组。每个选项可继续、通过 `targetChoiceGroupId` 跳到本段/别段任意选项组、通过 `endScene` 结束片段，或通过 `recordId` 写入一次性记录；旧 `targetSceneId` / `targetBlockId` 仍兼容导入。
- `input`：固定选项、自由输入、校验规则、story/blog/ai 多目标。
- `condition`：多个条件分支。
- `variable`：set/add/subtract/toggle。
- `jump`：场景、路线节点或当前片段内部剧情块跳转。
- `mode`：场景内部 ADV/NVL 切换。
- `save-point`：可定位存档标记。
- `blog-action`：异步 Blog Bridge 动作与 success/failure/cancel 分支。
- `ai-turn`：受约束实时 AI 回合。
- `native`：高级用户插入的 WebGAL 原生指令。
- `comment`：作者注释。

示例：

```json
{
  "id": "return_d1",
  "type": "dialogue",
  "characterId": "char_alice",
  "expressionId": "expr_alice_standard_normal",
  "position": "right",
  "text": "欢迎回来，主人。外面比想象中更热吧？",
  "source": "human"
}
```

## 舞台状态

`entryStage` 描述从博客深链直接进入场景时所需的完整初始状态。后续 `stage` 块是状态变化；`dialogue.transform` 是逐句覆盖。实时 AI 的上下文应发送归一化后的背景、BGM、当前立绘 ID/表情/位置/transform、已有一次性记录与当前选项组，而不是让模型从旧台词猜测。

## 选项组、局部反应与记录

`choice` 在 `scene.blocks` 中的位置就是实际出现位置，可以在片段开头、中间或结尾。选择“继续”时，紧随其后的 `dialogue.choiceReactions` 可按 `choiceBlockId + optionId` 覆盖台词、角色、表情、站位和 transform；执行完这一句后清空局部选择状态，后续对白回到公共线。

选择项的 `recordId` 会编译为全局布尔记录，只允许从未取得变为已取得，内循环重复点击不会累计。片段结束时，编译器按 `routeMap.edges[].recordCondition` 依次判断主干出口。

## 资源别名

资源与角色表情均可声明 `aliases`。解析顺序：

1. 稳定 ID。
2. 精确名称。
3. 不区分大小写的别名。
4. 角色范围内的表情别名。
5. 未解析诊断。

未匹配资源会得到 `unresolved:*` 引用与诊断，编辑器要求用户绑定、上传或生成资源，不会静默产生不存在的文件。

## 兼容与迁移

`schemaVersion` 使用语义版本。新增可选字段属于向后兼容；重命名或删除字段需要显式迁移器。编译产物不参与迁移，升级后从 Story IR 重新编译即可。
