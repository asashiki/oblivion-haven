# Story Model / Story IR 1.0

权威 TypeScript 定义位于 `lib/story/types.ts`，运行时结构校验位于 `lib/story/schema.ts`。完整样例位于 `lib/story/example.ts`，也可从 `GET /api/example-project` 获取 JSON。

## 顶层结构

```json
{
  "schemaVersion": "1.0.0",
  "id": "project_alice_teaparty",
  "title": "君が読む永远",
  "slug": "kimi-ga-yomu-towa",
  "version": "0.1.0",
  "locale": "zh-CN",
  "settings": {
    "startSceneId": "scene_prologue",
    "defaultMode": "adv",
    "webgalVersion": "4.6.2",
    "sharedEngineUrl": "https://cdn.example.com/webgal/assets/index.js",
    "sharedEngineCssUrl": "https://cdn.example.com/webgal/assets/index.css",
    "terreBaseUrl": "http://localhost:3001",
    "blogBridge": {}
  },
  "chapters": [],
  "scenes": [],
  "characters": [],
  "assets": [],
  "variables": [],
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
| RouteNode | kind、unlock/read/hidden、sceneId、x/y | 作者与玩家路线图；`routeMap.layoutDirection` 标记纵向或旧版横向坐标 |
| RouteEdge | source、target、condition | 路线条件与连线 |
| Ending | normal/bad/true | 结局语义 |
| SavePoint | sceneId、blockId | 博客深链与重玩入口 |
| AiConfig | mode、allowedTools、limits | AI 作者/实时策略 |

## 剧情块

`scene.blocks` 是有序联合类型：

- `dialogue`：角色、表情、语音、站位、文本演出。
- `narration`：ADV 旁白或 NVL 累积文本。
- `stage`：背景、BGM、音效、立绘进退场、移动、表情、转场和等待。
- `choice`：显示条件、可用条件、变量操作和目标。
- `input`：固定选项、自由输入、校验规则、story/blog/ai 多目标。
- `condition`：多个条件分支。
- `variable`：set/add/subtract/toggle。
- `jump`：场景或路线节点跳转。
- `mode`：场景内部 ADV/NVL 切换。
- `save-point`：可定位存档标记。
- `blog-action`：异步 Blog Bridge 动作与 success/failure/cancel 分支。
- `ai-turn`：受约束实时 AI 回合。
- `native`：高级用户插入的 WebGAL 原生指令。
- `comment`：作者注释。

示例：

```json
{
  "id": "b_welcome",
  "type": "dialogue",
  "characterId": "char_alice",
  "expressionId": "expr_alice_smile",
  "position": "center",
  "text": "欢迎回来，{player_name}。",
  "source": "human"
}
```

## 舞台状态

`entryStage` 描述从博客深链直接进入场景时所需的完整初始状态。后续 `stage` 块是状态变化。实时 AI 的上下文应发送归一化后的背景、BGM、当前立绘 ID/表情/位置/transform，而不是让模型从旧台词猜测。

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
