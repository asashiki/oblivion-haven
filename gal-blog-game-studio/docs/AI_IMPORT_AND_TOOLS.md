# AI 导入、Patch 与工具 API

## 可接受输入

“AI 创作”面板自动检测以下格式，也可手动指定。

### 标签式

```text
[角色=爱丽丝][表情=标准立绘][背景=白昼茶室][入场=淡入][位置=右侧]
爱丽丝：欢迎回来，主人。今天的茶会已经准备好了。
```

### 自然语言

```text
让爱丽丝从右侧缓慢淡入，使用 Q 版立绘，然后说“今天先试试这场小茶会吧”。
```

### Ren'Py-like

```renpy
scene 白昼茶室 with fade duration 0.8
show 爱丽丝 标准立绘 at right
爱丽丝 "欢迎回来，主人。今天的茶会已经准备好了。"
```

### Markdown

```markdown
## 午后茶会
**爱丽丝（标准立绘，右）**：欢迎回来，主人。
> 阳光穿过玻璃穹顶，落在茶桌上。
```

### WebGAL

```text
changeBg:project-assets/alice-tea-room-day.png -duration=800;
changeFigure:project-assets/alice-standard-normal.png -right -enter=enter-from-right;
爱丽丝:欢迎回来，主人。;
```

WebGAL 导入会进入 Story IR；无法安全反推的高级命令保存在 `native` 块中。JSON 可输入剧情块数组、带 `blocks` 的 fragment 或完整 StoryProject。

## StoryPatch

AI 不应每次覆盖项目。Patch 协议支持：

```json
[
  {
    "op": "test",
    "path": "/scenes/0/blocks/3/id",
    "value": "return_d1"
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
      "text": "窗外的阳光落在茶杯边缘。",
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
      "sceneId": "scene_return",
      "blockId": "return_d1",
      "text": "欢迎回来，主人。今天想先从哪一页开始？"
    }
  }
}
```

响应包含修改后的 `project`、正向 `operations`、可撤销的 `inverse` 和工具数据。生产 AI 服务应只允许项目 `aiConfigs[].allowedTools` 中列出的工具，并限制单回合操作数量。

`add_choice` 的选项支持 `targetChoiceGroupId`、`endScene` 与 `recordId`。不填写跳转目标表示继续播放当前片段，AI 可以把参与感选项插在对白中间，再为紧随其后的 `dialogue.choiceReactions` 生成只生效一行的台词或立绘反应。`connect_branch` 只创建片段结束后的外层主干，不再向片段内容偷偷插入跳转块。

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
