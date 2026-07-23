# gal-blog Bridge 与嵌入

## 启动入口

导出包的 `gal-blog.embed.json` 提供：

- 默认 Start 场景。
- 每个章节/场景。
- 每个存档点及可选 block。
- 每个路线节点及关联场景。

博客标题页的 Start、Load、角色故事、场景故事和路线图都应转换成统一启动参数：

```ts
type GalLaunchTarget = {
  projectId: string;
  sceneId?: string;
  savePointId?: string;
  routeNodeId?: string;
  blockId?: string;
  variables?: Record<string, boolean | number | string>;
};
```

将参数放入 iframe URL 查询、一次性 token 或在收到 `ready` 后通过 Bridge 发送。不要把私密用户信息直接放在 URL。

## 消息信封

游戏请求：

```json
{
  "channel": "gal-blog-game",
  "source": "galgame",
  "id": "gb-123",
  "type": "request",
  "payload": {
    "action": "open-comment-form",
    "payload": { "articleSlug": "hello", "allowImage": true }
  }
}
```

博客回复：

```json
{
  "channel": "gal-blog-game",
  "source": "gal-blog",
  "replyTo": "gb-123",
  "ok": true,
  "payload": { "commentId": "comment-42" }
}
```

失败或取消分别返回 `ok:false,error`，或业务 payload `{status:"cancel"}`。Story IR 的 `blog-action.resultBranches` 可把 success/failure/cancel 连接到不同场景。

## WebGAL 运行适配

编译器不会让博客动作退化成注释。每个 `blog-action` 会生成一个稳定 token、WebGAL 运行变量和可中断 `wait`：

1. `gal-blog-bridge.js` 通过 WebGAL Core 的 `stageManager.subscribe` 捕获 token。
2. 游戏上锁并向父页面发出 request。
3. 父页面回传后，Bridge 写入 `__galblog_status` 和块声明的 `resultVariableId`。
4. Bridge 结束等待，WebGAL 按 success / failure / cancel 条件跳转。

独立打开、没有父级博客时，动作以 `{status:"success",standalone:true}` 返回，保证静态游戏仍可试玩。嵌入博客但超时时返回 failure。页面也可通过 `window.GalBlogBridge.attachWebGAL(core)` 连接自定义 WebGAL 构建。

带 `blog` 或 `ai` target 的 `input` 块会发送：

```ts
window.addEventListener("galblog:player-input", (event) => {
  console.log(event.detail.value, event.detail.targets);
});
```

父页面同时收到 `type:"player-input"` 的 Bridge 消息。AI 运行层可调用 `window.GalBlogBridge.registerAIProvider(provider)`，并实现 `provider.onPlayerInput(detail)`。

## 动作

- open-article
- return-menu
- open-comment-form
- view-comments
- submit-friend-link
- upload-image
- get-user
- get-page-data
- save-progress
- launch-story
- notify-event
- custom

表单由 gal-blog 自身弹出。游戏只发动作并等待结果；这样身份、CSRF、上传限制与后端校验仍由博客负责。

## 博客宿主示例

```ts
const gameOrigin = "https://games.example.com";

window.addEventListener("message", async (event) => {
  if (event.origin !== gameOrigin) return;
  const message = event.data;
  if (message?.channel !== "gal-blog-game" || message?.source !== "galgame") return;
  if (message.type !== "request") return;

  try {
    const result = await dispatchGalAction(
      message.payload.action,
      message.payload.payload
    );
    event.source?.postMessage({
      channel: "gal-blog-game",
      source: "gal-blog",
      replyTo: message.id,
      ok: true,
      payload: result
    }, { targetOrigin: gameOrigin });
  } catch (error) {
    event.source?.postMessage({
      channel: "gal-blog-game",
      source: "gal-blog",
      replyTo: message.id,
      ok: false,
      error: error instanceof Error ? error.message : "Action failed"
    }, { targetOrigin: gameOrigin });
  }
});
```

## 安全要求

- 游戏与博客两侧都校验精确 origin、channel、source、请求 ID。
- 生产环境不要使用 `*`。
- 写操作必须走博客原有身份、权限、CSRF 与速率限制。
- 上传只传博客返回的资源 ID/URL，不通过 postMessage 传大文件。
- Bridge 请求设置超时；场景必须有失败与取消恢复路径。
- 用户信息遵循最小披露，AI 默认看不到邮箱、令牌和未授权文章。

## 视觉融合

博客 Modal 可使用游戏导出的主题 token（主色、字体、遮罩、圆角），覆盖 iframe 上方。完成后回传结果，游戏恢复音频焦点并继续对白。这样表单保持博客原生可访问性，同时视觉上仍属于 Galgame。
