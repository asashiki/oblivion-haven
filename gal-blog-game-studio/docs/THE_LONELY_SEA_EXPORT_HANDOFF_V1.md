# Studio →《孤独之海》导出与宿主交接规范 v1

> 状态：协议冻结，可供 Blog 端先行实现；Studio 端导出器尚未全部满足本规范。  
> 制定日期：2026-08-02  
> Studio 基线：`asashiki/oblivion-haven@063d9eb`  
> Blog 基线：`asashiki/The-Lonely-Sea@2890700`  
> WebGAL 基线：`4.6.2`（源码提交 `e7f0abeb855b5b442460743bdaa9778ca751b43f`）

这份文档是给《孤独之海》Blog 项目的 Codex 使用的直接交接文件。目标不是一次设计完最终架构，而是先跑通一个真实、可验证的纵向闭环：

```text
Studio 导出版本化 WebGAL 游戏包
        ↓
Blog 读取清单并在 iframe 中启动
        ↓
游戏请求 Blog 打开页面 / 表单 / 读取数据 / 保存进度
        ↓
Blog 返回结果，游戏写入变量并继续
        ↓
LOAD 的玩家存档槽能够再次进入作者定义的检查点
```

## 0. 给 Blog Codex 的最短任务说明

请保持两个仓库独立，不要把 Studio 源码合入《孤独之海》。Blog 只消费 Studio 导出的、不可变的版本化游戏包和这份协议。

Blog 第一轮只实现：

1. 一个 `/start/stories/[slug]/` 游戏宿主页和 `iframe` 宿主。
2. `gal-blog-bridge/v1` 的严格消息校验与握手。
3. `return-menu`、`open-article`、`open-comment-form`、`save-progress`、`get-runtime-data` 五个动作。
4. 用本地存储实现第一版“检查点存档”，并让 LOAD ⅩⅢ 的真实玩家存档槽读取它。
5. `STORY` 读取公开场景入口，`FLOWCHART` 读取导出清单中的公开路线信息。
6. 使用协议测试夹具先完成宿主；等 Studio 新导出器交付爱丽丝游戏包后，只替换版本清单，不重写宿主。

不要在这一轮实现：任意对白位置即时存档、实时 AI 续写、Blog 跨 iframe 修改 WebGAL DOM、真实评论后端或两个仓库合并。

## 1. 当前实现审计：哪些是真的，哪些还不能交接

### 已经存在且可以保留

- Studio 的 Story IR 是唯一源数据，可以确定性编译 WebGAL 脚本。
- 素材二进制能够随 ZIP 写入；读取失败会阻止导出。
- `gal-blog-bridge.js` 已能观察 WebGAL 舞台变量、发出请求、等待宿主回复并恢复剧情。
- `gal-blog.embed.json` 已包含场景、存档点、路线节点和 Bridge 配置的雏形。
- WebGAL 4.6.2 原生运行时已经用于 Studio 试玩，而不是另做播放器。
- 《孤独之海》的 LOAD ⅩⅢ 已预留 `lonely-sea:story-enter` 与 `lonely-sea:save-select` 事件，玩家存档槽、故事场景和流程图界面都已有稳定视觉决策。

### 当前导出尚不合格的地方

以下问题在 Studio 修完以前，Blog 端不得把当前 ZIP 当成 v1 正式游戏包：

1. **清单列出入口，但入口没有真正被消费。** 当前 `index.html` 仍固定运行 `game/scene/start.txt`；`sceneId`、`savePointId`、`routeNodeId` 和 `blockId` 只是元数据。
2. **不是完整的标准 Web 导出。** 当前入口依赖外部 CDN 的 WebGAL JS/CSS，没有把固定版本的官方运行时完整放入 ZIP。
3. **`ready` 时机不可靠。** Bridge 脚本加载时就发出 `ready`，早于 WebGAL Core 连接；宿主无法据此判断是否可以发送启动状态。
4. **动作结果没有写回真实值。** 目前 `resultVariableId` 收到的是 `success/failure/cancel`，而不是例如心率 `72` 这样的 `payload.value`。
5. **任意 block 读档尚不存在。** save point 的 `blockId` 进入清单，但运行时不会恢复到该块。
6. **安全回退过宽。** 某些情况下消息目标会回退为 `*`；正式包必须只允许清单声明的宿主 origin。
7. **独立打开会把宿主动作自动判为成功。** 这便于旧版演示，却会把“没有评论系统”伪装成“评论已提交”。v1 必须按动作声明明确返回 unsupported、cancel 或使用离线替代行为。
8. **游戏产物和编辑源文件混在一起。** 正式游戏包不应强制公开作者的完整 `story.project.json`；工程备份应单独下载。
9. **没有不可变发布标识和文件完整性清单。** Blog 无法安全区分同一语义版本的不同构建。

## 2. 两个仓库的职责边界

| 能力 | Studio / WebGAL | 《孤独之海》Blog |
|---|---|---|
| 对白、旁白、选项、变量、记录、剧情跳转 | 负责 | 不解析 WebGAL 脚本 |
| 角色、表情、站位、镜头、转场、BGM、SE、语音 | 负责 | 只负责进入/退出时的音频所有权交接 |
| 对话框、选项按钮、游戏内标题界面皮肤 | Studio 导出 WebGAL template | 不跨 iframe 改 DOM |
| 站点标题菜单、LOAD、EXTRA、OPTION | 不负责 | 负责 |
| 文章、评论、友链、账号、上传、站点数据库 | 通过 Bridge 请求 | 负责真实 UI、权限与后端 |
| 实时心率、页面状态等宿主数据 | 发受限请求并消费结果 | 调受信接口并返回白名单结果 |
| 游戏包编译与版本 | 生成不可变产物 | 托管并登记当前版本 |
| 第一版存档 | 生成作者定义的检查点与可恢复变量 | 保存检查点记录，LOAD 负责读取 |
| 后续即时存档 | 提供 WebGAL SaveAdapter | 保存版本化引擎快照 |

关键约束：Blog 是宿主，不是第二个 Galgame 引擎；Studio 是制作与编译器，不是评论或账号后端。

## 3. Studio 顶部“导出”应当是什么

默认界面右上角只保留一个清楚的 **导出** 按钮，不显示“高级模式”入口，也不常驻显示问题计数。

点击后打开一个小型发布面板：

1. 先自动运行发布检查。
2. 错误按“必须修复”列出并阻止下载；普通提醒不阻止。
3. 主按钮：**导出可玩包 (.zip)**。
4. 次按钮：**备份 Studio 工程 (.json)**。
5. 面板用一句话说明用途：ZIP 用于部署、嵌入 Blog 或独立试玩；JSON 用于以后回到 Studio 继续编辑。

不要求用户理解 Story IR、运行时地址、资源目录或 Bridge 内部字段。固定的 WebGAL 版本、清单和运行时由导出器处理。

### 发布检查

以下项目阻止导出：

- Story IR 校验错误；
- 起始片段不存在；
- 素材引用存在但文件无法读取；
- 场景、选项组、记录、公开入口或存档点 ID 重复；
- 存档点不满足 v1 的可恢复条件；
- 使用了 Blog 未声明支持的必需动作；
- 正式包的允许宿主 origin 为空或含 `*`；
- WebGAL 运行时文件不完整或版本与清单不一致。

以下只显示提醒：

- 没有 BGM、语音或额外表情；
- 某些场景没有公开重玩入口；
- 包体较大；
- 可选 Blog 动作在离线试玩中不可用。

## 4. 可玩包 v1

推荐文件名：

```text
<slug>-<gameVersion>-<contentHash8>.gal-blog.zip
```

解压后是一个可以由普通静态服务器直接托管的 Web 目录：

```text
index.html
gal-blog-bridge.js
gal-blog.embed.json
integrity.json
README.md
THIRD_PARTY_NOTICES.md
game/
  config.txt
  scene/
    start.txt
    *.txt
  background/
  figure/
  bgm/
  vocal/
  video/
  animation/
  template/
assets/                       # 固定版本的官方 WebGAL Web 构建
webgal-engine.json
webgal-serviceworker.js
```

v1 首先追求“解压即可部署且结果可复现”，因此完整包含 WebGAL 4.6.2 运行时。共享运行时去重可在闭环稳定后作为 v1.1 优化，不能让第一版继续依赖一个未声明的 CDN 文件。

`story.project.json` 不放进公开可玩包；“备份 Studio 工程”单独导出。公开包可以保留不含作者私有备注的 `assets.manifest.json`。

### 不可变发布目录

Blog 解压到：

```text
public/games/<slug>/<releaseId>/
```

其中 `releaseId` 建议为 `<gameVersion>-<contentHash8>`。发布后不得原地覆盖；新版本创建新目录，Blog 的版本清单再把 `currentReleaseId` 指向新版本。旧存档仍能定位到它创建时的版本。

## 5. `gal-blog.embed.json` v1

这是 Blog 唯一需要读取的游戏元数据；Blog 不解析 `story.project.json` 或 WebGAL 脚本。

```json
{
  "schema": "gal-blog-game-package/v1",
  "game": {
    "id": "project_alice_minimal",
    "slug": "alice-tea-room",
    "title": "爱丽丝茶室",
    "gameVersion": "0.5.0",
    "releaseId": "0.5.0-a1b2c3d4",
    "locale": "zh-CN"
  },
  "engine": {
    "name": "WebGAL",
    "version": "4.6.2",
    "bundled": true,
    "entry": "index.html"
  },
  "launchTargets": {
    "start": {
      "kind": "start",
      "id": "start",
      "sceneId": "scene_return"
    },
    "scenes": [
      {
        "kind": "scene",
        "id": "scene_return",
        "title": "初次见面",
        "replayable": true,
        "thumbnail": "game/background/tea-room-day.png"
      }
    ],
    "savePoints": [
      {
        "kind": "save-point",
        "id": "save_after_welcome",
        "title": "茶会开始",
        "sceneId": "scene_teatime",
        "resumeMode": "scene-entry",
        "thumbnail": "game/background/tea-room-day.png"
      }
    ]
  },
  "publicRouteMap": {
    "nodes": [],
    "edges": []
  },
  "stateContract": {
    "saveMode": "checkpoint-v1",
    "launchVariables": ["player_name"],
    "persistVariables": ["player_name", "heart_rate"],
    "records": ["met_alice", "trusted_alice"]
  },
  "bridge": {
    "protocol": "gal-blog-bridge/v1",
    "channel": "gal-blog-game",
    "allowedHostOrigins": ["https://example.com"],
    "requiredActions": ["return-menu", "save-progress"],
    "optionalActions": ["open-article", "open-comment-form", "get-runtime-data"]
  },
  "theme": {
    "tokens": "game/template/gal-blog-theme.json",
    "webgalTemplate": "game/template/template.json"
  },
  "integrity": "integrity.json"
}
```

规则：

- `game.id` 长期稳定；`releaseId` 每次内容构建唯一。
- `launchTargets.scenes` 只列真正可独立进入的故事场景。
- `publicRouteMap` 只放可展示给访客的节点和边，不泄漏隐藏路线。
- `stateContract` 是允许 Blog 保存和重新注入的白名单，宿主不能随意写任意 WebGAL 变量。
- `requiredActions` 缺一项就拒绝启动；`optionalActions` 不支持时返回明确 failure，不伪造成功。

## 6. Bridge v1

### 消息信封

```ts
type GalBlogEnvelopeV1 = {
  protocol: "gal-blog-bridge/v1";
  channel: "gal-blog-game";
  source: "galgame" | "gal-blog";
  gameId: string;
  releaseId: string;
  sessionId: string;
  id?: string;
  replyTo?: string;
  type:
    | "hello"
    | "launch"
    | "ready"
    | "request"
    | "result"
    | "event"
    | "error";
  payload?: unknown;
};
```

### 启动时序

1. Blog 从版本清单解析 `gameId`、`releaseId` 和 iframe URL，生成随机 `sessionId`。
2. iframe URL 只携带非敏感的 `sessionId`；启动目标和存档内容不放在 URL。
3. WebGAL Core 已连接、清单已载入后，游戏发送 `hello`。
4. Blog 同时校验 `event.origin`、`event.source === iframe.contentWindow`、protocol、channel、gameId、releaseId、sessionId。
5. Blog 校验必需动作后发送 `launch`，载荷只允许三种目标：`start`、`scene`、`save-point`。
6. 游戏验证目标与变量白名单，将启动状态注入 WebGAL，再发送 `ready`。
7. Blog 隐藏加载层；玩家在 iframe 内完成浏览器要求的首次点击并开始游戏。

游戏独立打开且没有父宿主时，可以在短暂等待后以 `start` 运行；宿主专属动作必须显示“此功能仅在《孤独之海》中可用”或返回 failure，不能自动 success。

### 启动消息

```json
{
  "protocol": "gal-blog-bridge/v1",
  "channel": "gal-blog-game",
  "source": "gal-blog",
  "gameId": "project_alice_minimal",
  "releaseId": "0.5.0-a1b2c3d4",
  "sessionId": "random-session-id",
  "id": "host-1",
  "type": "launch",
  "payload": {
    "target": { "kind": "save-point", "id": "save_after_welcome" },
    "state": {
      "variables": { "player_name": "主人" },
      "records": ["met_alice"]
    }
  }
}
```

### 请求与结果

游戏请求：

```json
{
  "protocol": "gal-blog-bridge/v1",
  "channel": "gal-blog-game",
  "source": "galgame",
  "gameId": "project_alice_minimal",
  "releaseId": "0.5.0-a1b2c3d4",
  "sessionId": "random-session-id",
  "id": "game-7",
  "type": "request",
  "payload": {
    "action": "get-runtime-data",
    "input": { "key": "heartRate" }
  }
}
```

Blog 返回：

```json
{
  "protocol": "gal-blog-bridge/v1",
  "channel": "gal-blog-game",
  "source": "gal-blog",
  "gameId": "project_alice_minimal",
  "releaseId": "0.5.0-a1b2c3d4",
  "sessionId": "random-session-id",
  "replyTo": "game-7",
  "type": "result",
  "payload": {
    "status": "success",
    "value": 72,
    "observedAt": "2026-08-02T20:00:00-07:00"
  }
}
```

Studio 的剧情块决定把 `payload.value` 写入哪个 Story 变量；Blog 不接受游戏任意指定变量名。

### v1 动作

| 动作 | 游戏输入 | Blog 成功结果 | 失败/取消语义 |
|---|---|---|---|
| `return-menu` | 可选返回位置 | `{status:"success"}` | 导航前无需继续剧情 |
| `open-article` | 白名单 `slug` | `{status:"success", slug}` | 找不到文章为 failure |
| `open-comment-form` | 上下文 ID，不含身份令牌 | `{status:"success", commentId}` | 用户关闭为 cancel；后端失败为 failure |
| `save-progress` | 检查点 ID、白名单状态、显示元数据 | `{status:"success", saveId, savedAt}` | 存储失败为 failure |
| `get-runtime-data` | 白名单 key 与简单参数 | `{status:"success", value, observedAt}` | 权限拒绝/接口失败为 failure |

`view-comments`、`submit-friend-link`、`upload-image`、`player-input` 和 AI Provider 可以继续占用协议动作名，但不属于第一轮闭环；未实现时必须返回 unsupported。

### 安全要求

- 两侧都校验精确 origin、iframe window、协议、channel、gameId、releaseId、sessionId 和请求 ID。
- 正式环境禁止 `postMessage(..., "*")`。
- 宿主动作严格白名单分发；游戏不能传任意 URL、数据库查询或接口地址。
- 写操作继续使用 Blog 自己的身份、CSRF、上传限制与速率限制。
- postMessage 载荷设置大小上限；图片、存档截图和上传文件不直接走消息总线。
- 请求有超时，重复 `id` 幂等处理；切换版本或销毁 iframe 时取消未完成请求。
- URL 中不放用户信息、存档变量、访问令牌或评论内容。

## 7. 第一版存档：作者定义的检查点，不是假即时存档

WebGAL 4.6.2 的内部存档包含当前语句序号、场景栈、舞台状态和 backlog；读取时也会恢复这些内容。但 `saveGame` / `loadGameFromStageData` 并没有作为 `WebgalCore` 的稳定宿主 API 暴露。Studio 当前只有 save point 注释与清单，不能从 Blog 直接调用完整原生存档。

因此 v1 只承诺：

- 从游戏开始进入；
- 从公开故事场景的开头进入；
- 从作者定义、带完整入场状态的检查点进入；
- 恢复 `stateContract` 白名单中的变量和一次性记录。

v1 不承诺“恢复到任意一句对白”。清单中的 `blockId` 不再对 Blog 宣称可用，直到 SaveAdapter 完成。

### Blog 保存的数据

```ts
type GalBlogSaveRecordV1 = {
  schema: "gal-blog-save/v1";
  id: string;
  slot: number;
  gameId: string;
  releaseId: string;
  target: { kind: "save-point"; id: string };
  title: string;
  chapter?: string;
  scene?: string;
  thumbnail?: string;
  elapsedMs?: number;
  variables: Record<string, boolean | number | string>;
  records: string[];
  savedAt: string;
};
```

Blog 只保存清单白名单字段。玩家存档槽读取这些记录；点击槽位时，Blog 打开记录对应的不可变 `releaseId`，完成 Bridge 握手后发送 `launch`。

如果旧版本目录已被明确下线，LOAD 应显示“此存档需要旧版本”，不能偷偷用新版本的语句序号硬读。

### 后续 SaveAdapter

任意位置即时存档需要 Studio 维护一层明确的 WebGAL 版本适配器：生成原生快照、验证快照 schema、恢复场景与舞台、处理资源或脚本版本迁移。它完成并有跨版本测试后，才新增 `saveMode: "webgal-snapshot-v2"`。

## 8. UI 与 iframe 的边界

《孤独之海》的标题菜单、LOAD、EXTRA、OPTION、文章、评论和友链是 Blog 原生界面。游戏中的文本框、选项按钮、角色名框、舞台 HUD 和 WebGAL 标题页由 Studio 导出的 WebGAL template 控制。

Blog 不跨 iframe 查询类名或强改 WebGAL DOM。原因：

- WebGAL 官方已经提供 `game/template/` 下的文本框、选择和标题页样式机制；
- WebGAL 升级可能改变内部 DOM 和 CSS Module 类名；
- 跨 iframe 改 DOM 会破坏隔离、安全与独立试玩；
- 评论表单等 Blog Modal 可以覆盖 iframe，上层完成后通过 Bridge 恢复游戏。

LetsGal 的 `visualUI` 控制器可作为设计参考：运行时 UI 有自己的引用名、打开前准备、打开/关闭生命周期和控制器；它不是本项目的依赖，也不能被当作 WebGAL 已有 API。

## 9. 《孤独之海》实施清单

Blog Codex 应先阅读仓库根目录 `AGENTS.md`、`CONTEXT.md` 和与 LOAD 相关的 ADR；保持“读取页 / 页面入口 / 玩家存档槽 / 故事场景”等既有术语。

建议文件边界：

```text
src/lib/gal-blog/
  contracts.ts             # v1 类型、运行时校验、错误码
  release-registry.ts      # 读取不可变游戏版本清单
  save-store.ts            # v1 检查点存档接口；先 localStorage
src/scripts/experience/
  gal-blog-host.ts          # iframe 生命周期与 Bridge dispatcher
src/pages/start/stories/
  [slug].astro              # 游戏宿主页
public/games/
  <slug>/<releaseId>/       # Studio 导出的不可变包
```

具体顺序：

1. 写一个不依赖真实游戏包的 Bridge 测试 iframe，覆盖 hello → launch → ready → request → result。
2. 建立发布清单；页面只接受清单中存在的 slug/release，不把 URL 直接拼进 iframe。
3. 实现宿主页的加载、错误、重新载入、返回菜单和全屏；进入时暂停 Blog BGM，退出时恢复。
4. 实现五个 v1 动作。真实能力未接入时返回 unsupported/failure，不返回假 success。
5. 把 LOAD ⅩⅢ 的 demo 玩家存档替换为 `GalBlogSaveRecordV1`；继续保留六槽一页的视觉与现有事件名。
6. 让 `lonely-sea:story-enter` 使用场景入口，让 `lonely-sea:save-select` 使用存档记录，不再只显示点击反馈。
7. `FLOWCHART` 和 `STORY` 只消费清单公开字段；不导入 Studio Story IR。
8. 加 Playwright：错误 origin、错误 session、重复请求、动作取消、存档重进、旧 release、reduced-motion、移动端和音频交接。

第一版静态 Blog 可以使用 localStorage 存档；接口应命名为 SaveStore，未来换数据库时不改 LOAD 组件的领域语义。

## 10. Studio 接下来的实施清单

交接文档提交后，Studio 按以下顺序继续：

1. 删除/隐藏所有“高级模式”入口和右上角问题计数；把必要能力并回当前三界面。
2. 在右上角加入唯一“导出”按钮与发布检查面板。
3. 分离“可玩包 ZIP”和“Studio 工程 JSON”。
4. 以官方 WebGAL 4.6.2 Web dist 为基础，生成真正包含运行时和素材的静态包。
5. 升级 `gal-blog.embed.json`，加入不可变 release、状态白名单、公开路线、宿主动作和完整性信息。
6. 实现 hello → launch → ready；让 start/scene/save-point 三种入口真正执行。
7. 把 Blog 动作结果的 `payload.value` 写入声明的 Story 变量。
8. 正式环境取消 `*` 和独立打开自动 success。
9. 为检查点生成可独立恢复的完整 entry stage；不再导出不可执行的 block 深链。
10. 对“独立打开、Blog 嵌入、动作成功/取消/失败、存档重进、旧版本共存”增加端到端验收。

这批导出与 Bridge 基础完成后，再继续本轮其他 Studio UI、AI 助手、选项跳转简化和试玩热更新问题；它们不改变本协议的仓库边界。

## 11. 纵向闭环验收

只有以下流程全部实际通过，才能说两边已经接通：

1. Studio 导出一份爱丽丝可玩包，解压后用普通静态服务器能独立打开。
2. Blog 把包放进新的 release 目录，通过游戏宿主页加载成功。
3. Blog 从 `hello` 得知精确 game/release，发送场景入口后收到 `ready`。
4. 游戏请求 `open-article`，Blog 打开真实文章；返回后游戏继续。
5. 游戏请求 `open-comment-form`；用户关闭得到 cancel，提交成功得到真实 commentId，后端不存在则明确 failure。
6. 游戏请求 `get-runtime-data: heartRate`，测试 Provider 返回 `72`，下一句对白实际显示这个值。
7. 游戏请求 `save-progress`，LOAD 出现真实玩家存档槽。
8. 刷新页面后点击存档槽，重新打开同一 release，并恢复到作者检查点与白名单变量。
9. `return-menu` 正确销毁 iframe、取消 pending request，并恢复 Blog BGM。
10. 错误 origin、错误 session、缺少必需动作、缺失素材和篡改文件都不能静默继续。

## 12. 明确不做

- 不合并 `oblivion-haven` 与 `The-Lonely-Sea` 仓库。
- 不让 Blog 解析或生成 WebGAL 脚本。
- 不让 Blog 跨 iframe 改 WebGAL 对话框 DOM。
- 不把当前 `blockId` 元数据冒充即时读档。
- 不让模型直接生成并执行未校验的 WebGAL 文本。
- 不在第一轮接玩家输入驱动的实时 AI 续写。
- 不为尚未存在的评论、友链或心率后端返回假成功。
- 不为了共享运行时优化而牺牲第一版包的可独立部署性。

## 13. 一手依据

- WebGAL 官方 Web 发布方式：[Web 发布文档](https://docs.openwebgal.com/en/publish/web/)
- WebGAL 官方 UI template：[自定义 UI](https://docs.openwebgal.com/webgal-script/custom-ui.html)、[模板配置](https://docs.openwebgal.com/template-reference/others/config.html)
- WebGAL 变量与存档域：[变量文档](https://docs.openwebgal.com/en/webgal-script/variable.html)
- WebGAL 4.6.2 原生存档快照：[saveGame.ts](https://github.com/OpenWebGAL/WebGAL/blob/e7f0abeb855b5b442460743bdaa9778ca751b43f/packages/webgal/src/Core/controller/storage/saveGame.ts)
- WebGAL 4.6.2 原生恢复：[loadGame.ts](https://github.com/OpenWebGAL/WebGAL/blob/e7f0abeb855b5b442460743bdaa9778ca751b43f/packages/webgal/src/Core/controller/storage/loadGame.ts)
- WebGAL 4.6.2 Core 的公开形状：[webgalCore.ts](https://github.com/OpenWebGAL/WebGAL/blob/e7f0abeb855b5b442460743bdaa9778ca751b43f/packages/webgal/src/Core/webgalCore.ts)
- WebGAL 编辑器内部指定场景/语句快进能力（不能直接冒充稳定宿主 API）：[previewSyncSceneCommand.ts](https://github.com/OpenWebGAL/WebGAL/blob/e7f0abeb855b5b442460743bdaa9778ca751b43f/packages/webgal/src/Core/util/syncWithEditor/runtime/previewSyncSceneCommand.ts)
- LetsGal UI 生命周期参考：[程序控制可视化界面](https://docs.avg-engine.com/extensions/visual-ui-controller/)
- 《孤独之海》现有领域语言：[CONTEXT.md](https://github.com/asashiki/The-Lonely-Sea/blob/28907007f2e77b14d29d0151aee859301c9d876a/CONTEXT.md)
- LOAD ⅩⅢ 已确认结构：[ADR 0005](https://github.com/asashiki/The-Lonely-Sea/blob/28907007f2e77b14d29d0151aee859301c9d876a/docs/adr/0005-load-xiii-rebuild.md)
