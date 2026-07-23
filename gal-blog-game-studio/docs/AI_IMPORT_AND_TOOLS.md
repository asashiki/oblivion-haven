# AI 导入、Patch 与工具 API

## 可接受输入

“AI 创作”面板自动检测以下格式，也可手动指定。

### 标签式

```text
[角色=爱丽丝][表情=微笑2][背景=茶室夜晚][BGM=quiet][入场=淡入][位置=中间]
爱丽丝：欢迎回来，主人。
```

### 自然语言

```text
让爱丽丝从右侧缓慢淡入，表情有些犹豫，然后说“主人今天回来得有些晚呢”。
```

### Ren'Py-like

```renpy
scene 茶室夜晚 with fade duration 0.8
show 爱丽丝 犹豫 at right
play music quiet
爱丽丝 "主人今天回来得有些晚呢。"
```

### Markdown

```markdown
## 夜间茶会
**爱丽丝（犹豫，右）**：主人今天回来得有些晚呢。
> 玻璃上映出两个人的影子。
```

### WebGAL

```text
changeBg:tea-room-night.webp -duration=800;
changeFigure:alice/shy.png -right -enter=enter-from-right;
爱丽丝:主人今天回来得有些晚呢。;
```

WebGAL 导入会进入 Story IR；无法安全反推的高级命令保存在 `native` 块中。JSON 可输入剧情块数组、带 `blocks` 的 fragment 或完整 StoryProject。

## StoryPatch

AI 不应每次覆盖项目。Patch 协议支持：

```json
[
  {
    "op": "test",
    "path": "/scenes/0/blocks/3/id",
    "value": "b_p_1"
  },
  {
    "op": "set",
    "path": "/scenes/0/blocks/3/text",
    "value": "欢迎回来。茶已经准备好了。"
  },
  {
    "op": "insert",
    "path": "/scenes/0/blocks",
    "index": 4,
    "value": {
      "id": "b_ai_new",
      "type": "narration",
      "text": "窗外的雨声忽然变轻了。",
      "source": "ai"
    }
  }
]
```

每次应用返回 `inverse`，可用于撤销。`test` 用于乐观并发，防止 AI 在旧版本上覆盖用户刚做的修改。

## 语义工具

`GET /api/ai-tools` 返回当前工具目录。已实现：

- create_scene / modify_scene
- add_dialogue / modify_line
- set_expression / set_figure_position
- set_background / set_bgm
- add_choice / add_free_input
- connect_branch / set_variable / create_route_node
- validate_project / compile_scene / start_preview / export_web_game

调用：

```http
POST /api/ai-tools
Content-Type: application/json
```

```json
{
  "project": { "...": "完整 StoryProject" },
  "call": {
    "name": "modify_line",
    "arguments": {
      "sceneId": "scene_prologue",
      "blockId": "b_p_1",
      "text": "欢迎回来，主人。今晚想先读哪一页？"
    }
  }
}
```

响应包含修改后的 `project`、正向 `operations`、可撤销的 `inverse` 和工具数据。生产 AI 服务应只允许项目 `aiConfigs[].allowedTools` 中列出的工具，并限制单回合操作数量。

## 通用 Patch API

`POST /api/story/patch`：

```json
{
  "project": { "...": "完整 StoryProject" },
  "operations": [
    { "op": "set", "path": "/scenes/0/name", "value": "新的场景名" }
  ]
}
```

## AI Provider 接入

推荐服务端流程：

1. 从 Story IR 提取当前场景、舞台状态、角色 persona、变量与最近历史。
2. 把 `allowedTools` 以模型原生 function/tool schema 提供给模型。
3. 拒绝纯文本或未知工具。
4. 调用 `/api/ai-tools` 生成 Patch。
5. 运行 `validate_project`。
6. 若无阻断错误，保存操作记录并 `compile_scene`。
7. 将编译结果推送 Terre 预览，或交给实时渲染层。

密钥与审计应放在可信后端，浏览器只接收已验证的操作。
